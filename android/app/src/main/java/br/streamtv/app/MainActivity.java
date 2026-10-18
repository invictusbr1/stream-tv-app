package br.streamtv.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.UiModeManager;
import android.content.res.Configuration;
import android.content.pm.ActivityInfo;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Message;
import android.view.View;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.os.SystemClock;
import android.graphics.drawable.GradientDrawable;
import android.view.WindowManager;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.*;
import android.widget.*;
import java.io.ByteArrayInputStream;
import java.util.Collections;
import java.util.ArrayList;
import java.util.List;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.net.URL;
import javax.net.ssl.HttpsURLConnection;
import java.nio.charset.StandardCharsets;
import java.util.regex.Pattern;
import java.util.regex.Matcher;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import org.json.JSONObject;
import org.json.JSONArray;

/** Local HTTPS assets, with no native JavaScript bridge or computer connection. */
public final class MainActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";
    private static final String HOME = "https://" + HOST + "/index.html";
    private FrameLayout root;
    private AppUpdater updater;
    private WebView main, popup;
    private LinearLayout popupPanel;
    private View fullscreen;
    private WebChromeClient.CustomViewCallback fullscreenCallback;
    private int previousOrientation;
    private boolean inlineFullscreen;
    private int inlineOrientation;
    private View pointer;
    private boolean pointerMode;
    private float pointerX, pointerY;
    private QualitySelector qualitySelector;
    private final ThreadLocal<Long> qualityDeadline = new ThreadLocal<>();

    private int qualityTimeout(int normal) throws java.io.IOException {
        Long deadline=qualityDeadline.get();
        if(Thread.currentThread().isInterrupted())throw new java.io.IOException("Consulta encerrada");
        if(deadline==null)return normal;
        long left=deadline-QualitySelector.now();
        if(left<=0)throw new java.io.IOException("Prazo da escolha encerrado");
        return (int)Math.min(Math.min(normal,3000),left);
    }

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        VerifiedMediaStore verifiedStore=new VerifiedMediaStore(new File(getFilesDir(),"midias-verificadas.bin"));
        seedVerifiedMedia(verifiedStore);
        qualitySelector=new QualitySelector(verifiedStore);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            if (fullscreen == null && !inlineFullscreen) {
                view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(), insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            } else if (Build.VERSION.SDK_INT >= 28 && !BuildConfig.TV) {
                // Video reaches the edges; only controls avoid the camera cutout.
                android.view.DisplayCutout cutout = insets.getDisplayCutout();
                view.setPadding(0, 0, 0, 0);
                if (main != null) {
                    float density = getResources().getDisplayMetrics().density;
                    int left = cutout == null ? 0 : Math.round(cutout.getSafeInsetLeft() / density);
                    int right = cutout == null ? 0 : Math.round(cutout.getSafeInsetRight() / density);
                    main.evaluateJavascript("document.documentElement.style.setProperty('--player-safe-left','" + left + "px');document.documentElement.style.setProperty('--player-safe-right','" + right + "px');", null);
                }
            }
            return insets.consumeSystemWindowInsets();
        });
        setContentView(root);
        main = createWebView(true);
        root.addView(main, new FrameLayout.LayoutParams(-1, -1));
        // Aparelho sem tela de toque = TV / TV box (Xiaomi, Fire TV e afins).
        // Nesse caso a interface abre em modo TV (letras e capas maiores, foco
        // para o controle remoto). No telefone nada muda.
        boolean temToque = getPackageManager().hasSystemFeature(android.content.pm.PackageManager.FEATURE_TOUCHSCREEN);
        // O aplicativo da TV (pacote próprio) abre sempre na interface de 10 pés.
        main.loadUrl(BuildConfig.TV || !temToque ? HOME + "?canal=tv" : HOME);
        // Fichas de fonte descobertas pelo caçador: busca a lista publicada em
        // segundo plano (a abertura do aplicativo não espera por isso).
        atualizarPerfis();
        updater = new AppUpdater(this);
        main.postDelayed(() -> { if (!isFinishing() && !isDestroyed()) updater.check(false); }, 4000);
        if (Build.VERSION.SDK_INT >= 33) getOnBackInvokedDispatcher().registerOnBackInvokedCallback(0, this::back);
    }

    private boolean local(Uri uri) {
        return "https".equals(uri.getScheme()) && HOST.equals(uri.getHost()) && uri.getPort() == -1 && uri.getUserInfo() == null;
    }

    /** Entrega à interface o resultado da consulta de atualização feita pelo Java. */
    void relatarAtualizacao(String chamada) {
        if (main != null) main.evaluateJavascript(chamada, null);
    }

    private WebResourceResponse error(int code) {
        return new WebResourceResponse("text/plain", "UTF-8", code, "Unavailable", Collections.emptyMap(), new ByteArrayInputStream("Página indisponível".getBytes(java.nio.charset.StandardCharsets.UTF_8)));
    }

    // Esta rota existe só dentro do WebView. O GET local nunca sai do aparelho;
    // descoberta e POST ao servidor são feitos pelo Java, em thread de interceptação.
    private synchronized WebResourceResponse relatoNativo(Uri uri) {
        try {
            String rota = uri.getQueryParameter("rota");
            String dados = uri.getQueryParameter("dados");
            if (!("acesso".equals(rota) || "evento".equals(rota)) || dados == null || dados.length() > 32768) return error(400);
            JSONObject config;
            try (InputStream entrada = getAssets().open("config.json")) {
                config = new JSONObject(lerTexto(entrada));
            }
            String descoberta = config.optString("descoberta");
            // A interface não pode escolher uma URL: usamos a configuração do APK.
            JSONObject atual = new JSONObject(RelatoHttp.enviar(descoberta, null));
            String endereco = atual.getString("endereco").replaceAll("/+$", "");
            URL destino = new URL(endereco);
            if (!destino.getPath().isEmpty() || destino.getQuery() != null || destino.getRef() != null) return error(400);
            JSONObject corpo = new JSONObject(dados);
            String codigo = config.optString("acessoCodigo").trim();
            if (codigo.isEmpty()) codigo = config.optString("codigo").trim();
            if (codigo.isEmpty()) codigo = atual.optString("codigo").trim();
            corpo.put("codigo", codigo);
            String resposta = RelatoHttp.enviar(endereco + "/api/" + rota, corpo.toString());
            JSONObject resultado = new JSONObject(resposta);
            if (!resultado.optBoolean("ok", false)) throw new java.io.IOException("Servidor não confirmou o relato");
            android.util.Log.i("ConectaRelato", "Confirmado: " + rota);
            return respostaTexto("application/json", resposta);
        } catch (Exception e) {
            android.util.Log.w("ConectaRelato", "Falha no relato nativo: " + e.getClass().getSimpleName() + ": " + e.getMessage());
            return new WebResourceResponse("application/json", "UTF-8", 502, "Bad Gateway",
                Collections.singletonMap("Cache-Control", "no-store"),
                new ByteArrayInputStream("{\"ok\":false,\"erro\":\"Falha no envio nativo\"}".getBytes(StandardCharsets.UTF_8)));
        }
    }

    private String avisosEndereco="";
    private long avisosDescobertaAte=0;
    private synchronized WebResourceResponse notificacoesServidor(){
        try{
            if(avisosEndereco.isEmpty()||System.currentTimeMillis()>=avisosDescobertaAte){
                JSONObject config;try(InputStream in=getAssets().open("config.json")){config=new JSONObject(lerTexto(in));}
                JSONObject atual=new JSONObject(RelatoHttp.enviar(config.optString("descoberta"),null));
                String base=atual.getString("endereco").replaceAll("/+$","");URL u=new URL(base);
                if(!"https".equals(u.getProtocol())||u.getUserInfo()!=null||(u.getPort()!=-1&&u.getPort()!=443)||!u.getPath().isEmpty()||u.getQuery()!=null||u.getRef()!=null)return error(502);
                avisosEndereco=base;avisosDescobertaAte=System.currentTimeMillis()+60000;
            }
            String response=RelatoHttp.enviar(avisosEndereco+"/api/notificacoes",null);
            if(new JSONObject(response).optJSONArray("avisos")==null)return error(502);
            return respostaTexto("application/json",response);
        }catch(Exception unavailable){return error(502);}
    }

    // ---------------------------------------------------------------- fichas
    // Fornecedor novo descoberto pelo caçador da central: aqui o aparelho lê a
    // FICHA (endereço por título + regra de leitura do vídeo) e resolve sozinho,
    // como faz com as fontes fixas. O arquivo é o mesmo que o computador usa —
    // ele chega pelo aviso de versão e fica guardado no aparelho.
    private static final String PERFIS_URL = "https://raw.githubusercontent.com/invictusbr1/stream-tv-atualizacoes/main/perfis.json";
    private volatile String perfisTexto = null;
    // Código IMDb já consultado nesta execução (tipo|id → código).
    private final java.util.Map<String, String> imdbConhecido = new java.util.concurrent.ConcurrentHashMap<>();

    private String imdbNaMemoria(String tipo, String id) {
        String guardado = imdbConhecido.get(tipo + "|" + id);
        return guardado == null ? "" : guardado;
    }

    private void guardarImdb(String tipo, String id, String imdb) {
        if (imdb != null && !imdb.isEmpty()) imdbConhecido.put(tipo + "|" + id, imdb);
    }

    private File arquivoPerfis() { return new File(getFilesDir(), "perfis.json"); }

    private String lerTexto(InputStream entrada) {
        try (InputStream fluxo = entrada; ByteArrayOutputStream saida = new ByteArrayOutputStream()) {
            byte[] bloco = new byte[8192]; int lidos;
            while ((lidos = fluxo.read(bloco)) != -1) { saida.write(bloco, 0, lidos); if (saida.size() > 2 * 1024 * 1024) break; }
            return new String(saida.toByteArray(), StandardCharsets.UTF_8);
        } catch (Exception e) { return null; }
    }

    private String dataPerfis(String texto) {
        try{JSONObject d=new JSONObject(texto);return d.optJSONArray("perfis")==null?"":d.optString("atualizadoEm","");}catch(Exception e){return "";}
    }

    /** Uma ficha antiga do aparelho não substitui a cópia mais nova do APK. */
    private String perfis() {
        if (perfisTexto != null) return perfisTexto;
        String embutido="",guardado="";
        try { embutido=lerTexto(getAssets().open("perfis.json")); }catch(Exception ignored){}
        try {
            if(arquivoPerfis().isFile())guardado=lerTexto(new FileInputStream(arquivoPerfis()));
        }catch(Exception ignored){}
        String escolhido=!dataPerfis(guardado).isEmpty()&&dataPerfis(guardado).compareTo(dataPerfis(embutido))>=0?guardado:embutido;
        // A busca de rede pode ter terminado durante a leitura do disco.
        synchronized(this){if(perfisTexto==null)perfisTexto=escolhido==null?"":escolhido;return perfisTexto;}
    }

    /** Busca a versão publicada das fichas (silencioso, em segundo plano). */
    private void atualizarPerfis() {
        new Thread(() -> {
            HttpsURLConnection conexao = null;
            try {
                conexao = (HttpsURLConnection) new URL(PERFIS_URL + "?t=" + System.currentTimeMillis()).openConnection();
                conexao.setConnectTimeout(10000); conexao.setReadTimeout(15000);
                conexao.setInstanceFollowRedirects(true);
                conexao.setRequestProperty("User-Agent", "ConectaTV-Updater");
                conexao.setRequestProperty("Cache-Control", "no-cache");
                if (conexao.getResponseCode() != 200) return;
                String texto = lerTexto(conexao.getInputStream());
                if (texto == null || dataPerfis(texto).isEmpty()) return;
                try (FileOutputStream saida = new FileOutputStream(arquivoPerfis())) { saida.write(texto.getBytes(StandardCharsets.UTF_8)); }
                synchronized(this){if(dataPerfis(texto).compareTo(dataPerfis(perfisTexto))>=0)perfisTexto=texto;}
            } catch (Exception e) { /* sem internet: segue com o que já tem */ }
            finally { if (conexao != null) conexao.disconnect(); }
        }).start();
    }

    private String preencher(String modelo, String id, String temporada, String episodio) {
        String texto = modelo.replace("{id}", Uri.encode(id));
        if (temporada != null) texto = texto.replace("{temporada}", Uri.encode(temporada));
        if (episodio != null) texto = texto.replace("{episodio}", Uri.encode(episodio));
        return texto;
    }

    /** Código IMDb do título (as fichas de addon são pedidas por esse código). */
    private String imdbDoTitulo(String tipo, String id) {
        try {
            String caminho = "tv".equals(tipo) ? "tv" : "movie";
            String externo = lerPagina("https://api.themoviedb.org/3/" + caminho + "/" + id + "/external_ids?api_key=" + chaveTmdb(), null);
            if (externo != null) {
                Matcher achado = Pattern.compile("\"imdb_id\"\\s*:\\s*\"(tt\\d{5,10})\"").matcher(externo);
                if (achado.find()) return achado.group(1);
            }
        } catch (Exception e) { /* segue sem o código */ }
        return "";
    }

    private boolean enderecoSeguro(String endereco) {
        try {
            Uri uri = Uri.parse(endereco);
            if (!"https".equals(uri.getScheme()) || uri.getHost() == null || !La18Source.httpsPort(uri.getPort()) || uri.getUserInfo() != null) return false;
            String host = uri.getHost().toLowerCase();
            if (host.equals("localhost") || host.endsWith(".local")) return false;
            if (host.matches("^(127\\.|10\\.|192\\.168\\.|169\\.254\\.|0\\.).*")) return false;
            return true;
        } catch (Exception e) { return false; }
    }

    /** Aplica um passo da ficha (expressão regular, campo de JSON ou texto cru). */
    private String aplicarPasso(JSONObject passo, String texto, String base) {
        try {
            String tipo = passo.optString("tipo", "regex");
            String achado = "";
            if ("texto".equals(tipo)) {
                achado = texto.trim().replaceAll("^[\"']|[\"']$", "");
                return achado.startsWith("http") ? achado : "";
            }
            // O caçador pode gravar um passo de ENDEREÇO: em vez de ler a
            // página, a ficha já traz o endereço que a fonte pede (aprendido
            // pelo navegador escondido da central).
            if ("endereco".equals(tipo)) return passo.optString("url", "");
            if ("json".equals(tipo)) {
                Object atual = new JSONObject(texto);
                for (String parte : passo.optString("caminho", "").split("\\.")) {
                    Matcher indice = Pattern.compile("^([^\\[\\]]*)\\[(\\d+)\\]$").matcher(parte);
                    if (indice.matches()) {
                        String nome = indice.group(1);
                        JSONArray lista = nome.isEmpty() ? (JSONArray) atual : ((JSONObject) atual).optJSONArray(nome);
                        if (lista == null) return "";
                        atual = lista.opt(Integer.parseInt(indice.group(2)));
                    } else if (atual instanceof JSONObject) {
                        atual = ((JSONObject) atual).opt(parte);
                    } else return "";
                    if (atual == null) return "";
                }
                achado = String.valueOf(atual);
            } else {
                String padrao = passo.optString("padrao", "");
                if (padrao.isEmpty()) return "";
                Matcher encontrado = Pattern.compile(padrao, Pattern.CASE_INSENSITIVE).matcher(texto);
                if (!encontrado.find()) return "";
                int grupo = passo.optInt("grupo", 1);
                achado = encontrado.group(Math.min(grupo, encontrado.groupCount()));
            }
            if (achado == null) return "";
            // Páginas escrevem o endereço com a barra escapada em JavaScript.
            achado = achado.replace("\\/", "/").trim();
            if (achado.isEmpty()) return "";
            if (!achado.startsWith("http")) {
                if (passo.optBoolean("juntarComBase", false) || passo.has("prefixo")) {
                    String prefixo = passo.optString("prefixo", "");
                    if (!prefixo.isEmpty()) return prefixo + achado;
                    return new URL(new URL(base), achado).toString();
                }
            }
            return achado;
        } catch (Exception e) { return ""; }
    }

    /** Resolve um título por uma ficha aprovada pelo caçador. */
    private WebResourceResponse perfilPlayback(String tipo, String id, String temporada, String episodio) {
        return perfilPlayback(tipo, id, temporada, episodio, Collections.emptySet());
    }

    private WebResourceResponse perfilPlayback(String tipo, String id, String temporada, String episodio, java.util.Set<String> exceto) {
        return perfilPlayback(tipo,id,temporada,episodio,exceto,null);
    }

    private WebResourceResponse perfilPlayback(String tipo, String id, String temporada, String episodio, java.util.Set<String> exceto, String somenteId) {
        try {
            String texto = perfis();
            if (texto == null || texto.isEmpty()) return error(502);
            JSONArray lista = new JSONObject(texto).optJSONArray("perfis");
            if (lista == null) return error(502);
            // Melhor nota primeiro; no máximo três tentativas por abertura (o
            // aparelho não pode ficar esperando página de fornecedor).
            List<JSONObject> fichas = new ArrayList<>();
            for (int i = 0; i < lista.length(); i++) {
                JSONObject ficha = lista.optJSONObject(i);
                if (ficha == null || !ficha.optBoolean("ativo", true) || exceto.contains(ficha.optString("id", ""))) continue;
                if(somenteId!=null&&!somenteId.equals(ficha.optString("id","")))continue;
                JSONArray tipos = ficha.optJSONArray("tipos");
                boolean serve = false;
                for (int j = 0; tipos != null && j < tipos.length(); j++) if (tipo.equals(tipos.optString(j))) serve = true;
                if (!serve) continue;
                if ("movie".equals(tipo) && ficha.optString("urlMovie", "").isEmpty()) continue;
                if ("tv".equals(tipo) && ficha.optString("urlTv", "").isEmpty()) continue;
                fichas.add(ficha);
            }
            Collections.sort(fichas, (a, b) -> Double.compare(b.optDouble("nota", 0), a.optDouble("nota", 0)));
            for (JSONObject ficha : fichas.subList(0, Math.min(3, fichas.size()))) {
                String modelo = "tv".equals(tipo) ? ficha.optString("urlTv", "") : ficha.optString("urlMovie", "");
                // Ficha de addon do Stremio: o endereço é montado com o código
                // IMDb, que o aparelho busca no TMDB na hora (e guarda na memória
                // da abertura, para não repetir a consulta).
                String imdb = "";
                if (modelo.contains("{imdb}")) {
                    imdb = imdbNaMemoria(tipo, id);
                    if (imdb.isEmpty()) { imdb = imdbDoTitulo(tipo, id); if (!imdb.isEmpty()) guardarImdb(tipo, id, imdb); }
                    if (imdb.isEmpty()) continue;
                }
                String endereco = preencher(modelo, id, temporada, episodio).replace("{imdb}", Uri.encode(imdb));
                if (!enderecoSeguro(endereco)) continue;
                String referer = ficha.optString("referer", "");
                JSONArray passos = ficha.optJSONArray("passos");
                JSONObject primeiroPasso = passos != null ? passos.optJSONObject(0) : null;
                String pagina = "";
                if (primeiroPasso == null || !"endereco".equals(primeiroPasso.optString("tipo", "regex"))) {
                    pagina = lerPagina(endereco, referer.isEmpty() ? null : referer);
                    if (pagina == null) continue;
                }
                String video = "";
                String atual = pagina;
                String base = referer.isEmpty() ? endereco : referer;
                for (int i = 0; passos != null && i < passos.length(); i++) {
                    JSONObject passo = passos.optJSONObject(i);
                    if (passo == null) break;
                    String achado = aplicarPasso(passo, atual, base);
                    // Passo de endereço: o molde vem com {id}/{temporada}/
                    // {episodio}/{imdb} e é preenchido aqui.
                    if (achado.contains("{id}") || achado.contains("{temporada}") || achado.contains("{episodio}") || achado.contains("{imdb}")) {
                        achado = preencher(achado, id, temporada, episodio).replace("{imdb}", Uri.encode(imdb));
                    }
                    if (achado.isEmpty()) { video = ""; break; }
                    boolean ultimo = i == passos.length() - 1;
                    if (ultimo) { video = achado; break; }
                    if (!achado.startsWith("http")) achado = new URL(new URL(base), achado).toString();
                    if (!enderecoSeguro(achado)) { video = ""; break; }
                    String seguinte = lerPagina(achado, base);
                    if (seguinte == null) { video = ""; break; }
                    atual = seguinte;
                    base = achado;
                }
                // Fornecedor que entrega http://: o app exige https (o WebView
                // bloqueia a mistura). O mesmo endereço costuma servir em https.
                if (video.startsWith("http://")) video = "https://" + video.substring("http://".length());
                if (video.isEmpty() || !enderecoSeguro(video)) continue;
                String tipoMidia = video.matches("(?i).*\\.m3u8(\\?.*)?$") ? "hls" : "file";
                WebResourceResponse resposta = jsonMidia(video, tipoMidia, ficha.optString("nome", "Fonte nova"), ficha.optBoolean("dublado", false) ? "pt-BR" : "original", ficha.optString("id", ""), enderecoSeguro(referer) ? referer : base, ficha.optString("qualidade",""));
                if (resposta != null && resposta.getStatusCode() == 200) return resposta;
            }
            return error(502);
        } catch (Exception e) { return error(502); }
    }

    private boolean blockNavigation(Uri uri, boolean trusted) {
        return trusted ? !local(uri) : !"https".equals(uri.getScheme()) || HOST.equals(uri.getHost());
    }

    private void setInlineFullscreen(boolean enabled) {
        if (Build.VERSION.SDK_INT >= 28 && !BuildConfig.TV) {
            WindowManager.LayoutParams attributes = getWindow().getAttributes();
            attributes.layoutInDisplayCutoutMode = enabled
                ? WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
                : WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_DEFAULT;
            getWindow().setAttributes(attributes);
        }
        if (inlineFullscreen == enabled) return;
        inlineFullscreen = enabled;
        if (enabled) {
            inlineOrientation = getRequestedOrientation();
            setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
            root.setPadding(0, 0, 0, 0);
            root.setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
            if (Build.VERSION.SDK_INT >= 30 && getWindow().getInsetsController() != null) getWindow().getInsetsController().hide(WindowInsets.Type.systemBars());
        } else {
            setRequestedOrientation(inlineOrientation);
            getWindow().clearFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
            root.setSystemUiVisibility(View.SYSTEM_UI_FLAG_VISIBLE);
            if (Build.VERSION.SDK_INT >= 30 && getWindow().getInsetsController() != null) getWindow().getInsetsController().show(WindowInsets.Type.systemBars());
            root.requestApplyInsets();
        }
        root.requestApplyInsets();
        main.evaluateJavascript("window.StreamSetFullscreen && window.StreamSetFullscreen(" + enabled + ")", null);
    }

    private boolean abrirFutebol(Uri uri) {
        if (!"/abrir-futebol".equals(uri.getPath())) return false;
        String id = uri.getQueryParameter("id");
        String url = "premier".equals(id) ? "https://www.youtube.com/@CazeTV/streams" :
            ("brasileirao".equals(id) || "copa".equals(id)) ? "https://www.youtube.com/@getv/streams" : null;
        if (url == null) return true;
        for (String pacote : new String[]{"com.google.android.youtube.tv", "com.google.android.youtube"}) {
            android.content.Intent intent = new android.content.Intent(android.content.Intent.ACTION_VIEW, Uri.parse(url));
            intent.setPackage(pacote);
            try { startActivity(intent); return true; } catch (android.content.ActivityNotFoundException ignored) { }
        }
        Toast.makeText(this, "Instale o aplicativo do YouTube para abrir as transmissões gratuitas.", Toast.LENGTH_LONG).show();
        return true;
    }

    private boolean fullscreenAction(Uri uri) {
        if (!local(uri) || !"/player-fullscreen".equals(uri.getPath())) return false;
        String enabled = uri.getQueryParameter("enabled");
        if ("1".equals(enabled) || "0".equals(enabled)) setInlineFullscreen("1".equals(enabled));
        return true;
    }

    // Lê uma página do provedor no próprio aparelho. Nenhuma página de terceiro
    // é aberta para o usuário: só o endereço do vídeo é aproveitado.
    private String lerPagina(String pagina, String referer) {
        HttpsURLConnection connection = null;
        try {
            connection = (HttpsURLConnection) new URL(pagina).openConnection();
            connection.setConnectTimeout(qualityTimeout(10000)); connection.setReadTimeout(qualityTimeout(10000));
            connection.setInstanceFollowRedirects(false);
            connection.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36");
            connection.setRequestProperty("Accept-Language", "pt-BR,pt;q=0.9");
            if (referer != null) connection.setRequestProperty("Referer", referer);
            if (connection.getResponseCode() != 200) return null;
            try (InputStream input = connection.getInputStream(); ByteArrayOutputStream bytes = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[8192]; int count;
                while ((count = input.read(buffer)) != -1) { qualityTimeout(10000);bytes.write(buffer, 0, count); if (bytes.size() > 4194304) return null; }
                return new String(bytes.toByteArray(), StandardCharsets.UTF_8);
            }
        } catch (Exception e) { return null; }
        finally { if (connection != null) connection.disconnect(); }
    }

    private WebResourceResponse jsonMidia(String url, String tipo, String fonte) {
        return jsonMidia(url, tipo, fonte, "pt-BR");
    }

    private WebResourceResponse jsonMidia(String url, String tipo, String fonte, String audio) {
        return jsonMidia(url, tipo, fonte, audio, PlaybackSources.idFor(fonte));
    }

    private WebResourceResponse jsonMidia(String url, String tipo, String fonte, String audio, String fonteId) {
        return jsonMidia(url, tipo, fonte, audio, fonteId, "");
    }

    private WebResourceResponse jsonMidia(String url, String tipo, String fonte, String audio, String fonteId, String referencia) {
        return jsonMidia(url,tipo,fonte,audio,fonteId,referencia,"");
    }

    private WebResourceResponse jsonMidia(String url, String tipo, String fonte, String audio, String fonteId, String referencia, String resolucao) {
        // Antes de entregar o endereço ao player, confere se ele realmente
        // devolve VÍDEO. As fontes trocam de servidor sem avisar (o PipocaCine
        // passou a devolver página de erro em 09/10/2026) e, sem esta
        // checagem, o aparelho ficava esperando uma imagem que nunca vinha.
        String referer = enderecoSeguro(referencia) ? referencia : refererDaFonte(url);
        if (!entregaVideo(url, referer)) return error(502);
        try {
            JSONObject result = new JSONObject();
            // Lista de reprodução passa pelo encaminhador do aparelho: é o que
            // evita o 403 do CDN quando o pedido vem do WebView. Arquivo direto
            // (MP4) continua indo direto — assim o avançar/voltar segue igual.
            String servido = url.contains(".m3u8") ? enderecoEncaminhado(url, referer) : url;
            result.put("url", servido); result.put("audio", audio); result.put("type", tipo); result.put("source", fonte); result.put("fonteId", fonteId);
            result.put("_referer",referer==null?"":referer);result.put("resolucao",resolucao);
            return new WebResourceResponse("application/json", "UTF-8", 200, "OK", Collections.singletonMap("Cache-Control", "no-store"), new ByteArrayInputStream(result.toString().getBytes(StandardCharsets.UTF_8)));
        } catch (Exception e) { return error(502); }
    }

    private WebResourceResponse la18Playback() {
        try {
            String url = La18Source.extract(lerPagina(La18Source.PAGE, La18Source.PAGE));
            if (url.isEmpty() || !La18Source.playlist(lerPagina(url, La18Source.PAGE))) return error(502);
            JSONObject result = new JSONObject();
            result.put("url", enderecoEncaminhado(url, La18Source.PAGE));
            result.put("audio", "fonte"); result.put("type", "hls"); result.put("live", true);
            result.put("source", "LA18HD · Premiere"); result.put("fonteId", "la18hd-premiere1");
            return respostaTexto("application/json", result.toString());
        } catch (Exception e) { return error(502); }
    }

    private WebResourceResponse futebolAgenda(Uri uri) {
        String league = uri.getQueryParameter("liga"), date = uri.getQueryParameter("data");
        if (league == null || !(league.equals("eng.1") || league.equals("bra.1") || league.equals("bra.copa_do_brazil")) || date == null || !date.matches("\\d{4}-\\d{2}-\\d{2}")) return error(400);
        try {
            java.text.SimpleDateFormat format = new java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.ROOT);
            format.setLenient(false);
            if (!date.equals(format.format(format.parse(date)))) return error(400);
            String data = lerPagina("https://site.api.espn.com/apis/site/v2/sports/soccer/" + league + "/scoreboard?dates=" + date.replace("-", "") + "&limit=100&lang=pt&region=br", null);
            if (data == null || new JSONObject(data).optJSONArray("events") == null) return error(502);
            return respostaTexto("application/json", data);
        } catch (Exception e) { return error(502); }
    }

    private String refererDaFonte(String url) {
        if (url == null) return null;
        if (url.contains("nixplay") || url.contains("pipocacine")) return "https://pipocacine.lat/";
        if (url.contains("hclod.qzz.io")) return "https://watchplay.shop/";
        // O MGEB entrega o arquivo por CDs próprios (123pelicula, delivery-limit…).
        // Sem o referenciador certo o CDN recusa e o aparelho mostrava "nenhuma
        // fonte" mesmo com o vídeo resolvido — foi o caso do One Piece.
        if (url.contains("mgeb") || url.contains("solo-latino") || url.contains("97bf1") || url.contains("playercdn") || url.contains("123pelicula") || url.contains("delivery-limit")) return "https://mgeb.top/";
        if (url.contains("vixsrc") || url.contains("mistyreef")) return "https://vixsrc.to/";
        return null;
    }

    // ------------------------------------------------------- encaminhador
    // Alguns CDs (Akamai) recusam pedidos que chegam com a origem do WebView
    // (medido em 10/10/2026: 403 com a origem do aplicativo, 200 sem). Aqui o
    // vídeo passa pelo próprio aparelho — como já acontece no computador — e a
    // lista de reprodução é reescrita para os pedaços também passarem por ele.
    private static final String UA_ANDROID = "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";

    private String codificar(String valor) {
        return android.util.Base64.encodeToString(String.valueOf(valor == null ? "" : valor).getBytes(StandardCharsets.UTF_8),
            android.util.Base64.URL_SAFE | android.util.Base64.NO_PADDING | android.util.Base64.NO_WRAP);
    }

    private String decodificar(String valor) {
        try {
            return new String(android.util.Base64.decode(valor, android.util.Base64.URL_SAFE | android.util.Base64.NO_PADDING | android.util.Base64.NO_WRAP), StandardCharsets.UTF_8);
        } catch (Exception e) { return ""; }
    }

    private String enderecoEncaminhado(String url, String referer) {
        return "/api/hls?u=" + codificar(url) + "&r=" + codificar(referer);
    }

    private byte[] lerBytes(InputStream entrada) {
        try (InputStream fluxo = entrada; ByteArrayOutputStream saida = new ByteArrayOutputStream()) {
            byte[] bloco = new byte[32768]; int lidos;
            while ((lidos = fluxo.read(bloco)) != -1) { saida.write(bloco, 0, lidos); if (saida.size() > 48 * 1024 * 1024) break; }
            return saida.toByteArray();
        } catch (Exception e) { return new byte[0]; }
    }

    private String encaminharEndereco(String valor, String base, String referer) {
        try {
            String absoluto = valor.startsWith("http") ? valor : new URL(new URL(base), valor).toString();
            return enderecoEncaminhado(absoluto, referer);
        } catch (Exception e) { return valor; }
    }

    private WebResourceResponse encaminharMidia(Uri uri) {
        String alvo = decodificar(uri.getQueryParameter("u"));
        String referer = decodificar(uri.getQueryParameter("r"));
        if (alvo.isEmpty() || !enderecoSeguro(alvo)) return error(502);
        HttpsURLConnection conexao = null;
        try {
            conexao = (HttpsURLConnection) new URL(alvo).openConnection();
            conexao.setConnectTimeout(12000); conexao.setReadTimeout(25000);
            conexao.setInstanceFollowRedirects(true);
            conexao.setRequestProperty("User-Agent", UA_ANDROID);
            conexao.setRequestProperty("Accept", "*/*");
            if (referer != null && !referer.isEmpty()) conexao.setRequestProperty("Referer", referer);
            int codigo = conexao.getResponseCode();
            if (codigo >= 400) return error(codigo);
            String tipo = conexao.getContentType() == null ? "application/octet-stream" : conexao.getContentType();
            byte[] corpo = lerBytes(conexao.getInputStream());
            if (codigo == 200 && (tipo.toLowerCase().contains("mpegurl") || alvo.contains(".m3u8"))) {
                String base = alvo.substring(0, alvo.lastIndexOf('/') + 1);
                StringBuilder saida = new StringBuilder();
                for (String linha : new String(corpo, StandardCharsets.UTF_8).split("\n")) {
                    String limpa = linha.replace("\r", "");
                    if (limpa.startsWith("#")) {
                        Matcher dentro = Pattern.compile("URI=\"([^\"]+)\"").matcher(limpa);
                        StringBuffer pedaco = new StringBuffer();
                        while (dentro.find()) dentro.appendReplacement(pedaco, Matcher.quoteReplacement("URI=\"" + encaminharEndereco(dentro.group(1), base, referer) + "\""));
                        dentro.appendTail(pedaco);
                        saida.append(pedaco).append('\n');
                    } else if (limpa.trim().isEmpty()) {
                        saida.append('\n');
                    } else {
                        saida.append(encaminharEndereco(limpa.trim(), base, referer)).append('\n');
                    }
                }
                return new WebResourceResponse("application/vnd.apple.mpegurl", "UTF-8", 200, "OK",
                    Collections.singletonMap("Cache-Control", "no-store"),
                    new ByteArrayInputStream(saida.toString().getBytes(StandardCharsets.UTF_8)));
            }
            return new WebResourceResponse(tipo, "UTF-8", codigo, "OK", Collections.singletonMap("Cache-Control", "no-store"), new ByteArrayInputStream(corpo));
        } catch (Exception e) { return error(502); }
        finally { if (conexao != null) conexao.disconnect(); }
    }

    private boolean entregaVideo(String url, String referer) {
        if (url == null || url.isEmpty()) return false;
        HttpsURLConnection conexao = null;
        try {
            conexao = (HttpsURLConnection) new URL(url).openConnection();
            conexao.setConnectTimeout(qualityTimeout(6000)); conexao.setReadTimeout(qualityTimeout(6000));
            conexao.setInstanceFollowRedirects(true);
            conexao.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36");
            conexao.setRequestProperty("Accept", "*/*");
            conexao.setRequestProperty("Range", "bytes=0-2047");
            if (referer != null && !referer.isEmpty()) conexao.setRequestProperty("Referer", referer);
            int codigo = conexao.getResponseCode();
            String tipo = conexao.getContentType() == null ? "" : conexao.getContentType().toLowerCase();
            if (codigo >= 400) return false;
            if (tipo.contains("text/html") || tipo.contains("application/json") || tipo.contains("text/xml")) return false;
            return true;
        } catch (Exception e) {
            // Sem resposta conclusiva (rede, tempo), deixa o player tentar —
            // só recusamos quando a fonte responde claramente que não é vídeo.
            return true;
        } finally {
            if (conexao != null) conexao.disconnect();
        }
    }

    // Fonte dublada principal: filme em /movie e episódio em /tvshow.
    // (O caminho /serie do provedor exige sessão paga e manda para o login.)
    private WebResourceResponse directPlayback(String pagina) {
        try {
            String html = lerPagina(pagina, "https://v2.watchplay.shop/");
            if (html == null) return error(502);
            String quoted = "\"(?:[^\"\\\\]|\\\\.)*\"";
            Matcher audio = Pattern.compile("window\\.MyPlayerAudio\\s*=\\s*(" + quoted + ")").matcher(html);
            Matcher source = Pattern.compile("\\burl\\s*:\\s*(" + quoted + ")").matcher(html);
            if (!audio.find() || !source.find() || !"Dublado".equals(new JSONArray("[" + audio.group(1) + "]").getString(0))) return error(502);
            String url = new JSONArray("[" + source.group(1) + "]").getString(0);
            Uri uri = Uri.parse(url);
            if (!"https".equals(uri.getScheme()) || uri.getHost() == null || !uri.getHost().matches("[a-zA-Z0-9-]+\\.hclod\\.qzz\\.io") || uri.getPort() != -1 || uri.getUserInfo() != null || !uri.getPath().endsWith(".m3u8")) return error(502);
            return jsonMidia(url, "hls", "WatchPlay");
        } catch (Exception e) { return error(502); }
    }

    // ------------------------------------------------------- segunda opção
    // Quando NENHUMA fonte dublada tem o título, o aplicativo não pode ficar
    // sem nada: a regra do projeto manda cair para alta definição limpa com
    // legenda em português (mesmo caminho que o computador já usa). Medido em
    // 10/10/2026 no Vixsrc: HLS em 1080p com faixa de legenda.
    private String obter(String endereco, String referer, String accept) {
        HttpsURLConnection conexao = null;
        try {
            conexao = (HttpsURLConnection) new URL(endereco).openConnection();
            conexao.setConnectTimeout(qualityTimeout(10000)); conexao.setReadTimeout(qualityTimeout(12000));
            conexao.setInstanceFollowRedirects(true);
            conexao.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36");
            conexao.setRequestProperty("Accept", accept);
            conexao.setRequestProperty("Accept-Language", "pt-BR,pt;q=0.9,en;q=0.8");
            if (referer != null && !referer.isEmpty()) {
                conexao.setRequestProperty("Referer", referer);
                conexao.setRequestProperty("Origin", "https://vixsrc.to");
            }
            if (conexao.getResponseCode() != 200) return null;
            return lerTexto(conexao.getInputStream());
        } catch (Exception e) { return null; }
        finally { if (conexao != null) conexao.disconnect(); }
    }

    private WebResourceResponse vixsrcMidia(String tipo, String id, String temporada, String episodio) {
        final String BASE = "https://vixsrc.to";
        try {
            String rota = "tv".equals(tipo) ? "/api/tv/" + id + "/" + temporada + "/" + episodio : "/api/movie/" + id;
            String corpo = obter(BASE + rota, BASE, "application/json, text/javascript, */*; q=0.01");
            if (corpo == null) return error(502);
            Matcher src = Pattern.compile("\"src\"\\s*:\\s*\"([^\"]+)").matcher(corpo);
            if (!src.find()) return error(502);
            String pagina = obter(BASE + src.group(1), BASE + rota, "text/html,application/xhtml+xml,*/*");
            if (pagina == null) return error(502);
            Matcher token = Pattern.compile("token[\"']\\s*:\\s*[\"']([^\"']+)").matcher(pagina);
            Matcher expires = Pattern.compile("expires[\"']\\s*:\\s*[\"']([^\"']+)").matcher(pagina);
            Matcher playlist = Pattern.compile("url\\s*:\\s*[\"']([^\"']+)").matcher(pagina);
            if (!token.find() || !expires.find() || !playlist.find()) return error(502);
            if (Long.parseLong(expires.group(1)) * 1000L - 60000L < System.currentTimeMillis()) return error(502);
            String separador = playlist.group(1).contains("?") ? "&" : "?";
            String url = playlist.group(1) + separador + "token=" + token.group(1) + "&expires=" + expires.group(1) + "&h=1";
            if (!enderecoSeguro(url)) return error(502);
            // Áudio ORIGINAL: é assim que a interface entende que precisa
            // procurar legenda em português (regra 3 do projeto).
            return jsonMidia(url, "hls", "HD com legenda em português", "original");
        } catch (Exception e) { return error(502); }
    }

    // Segunda opção dublada: o episódio que o PipocaCine publica em arquivo MP4
    // (720p, áudio em português). Lido da página da série, sem abrir nada.
    private WebResourceResponse pipocaFilme(String id) {
        try {
            String html = lerPagina("https://pipocacine.lat/embed/" + id, "https://pipocacine.lat/");
            if (html == null) return error(502);
            Matcher bloco = Pattern.compile("var\\s+videoSources\\s*=\\s*(\\[[^\\]]*\\])").matcher(html);
            if (!bloco.find()) return error(502);
            JSONArray lista = new JSONArray(bloco.group(1).replace("\\/", "/"));
            String escolhida = "";
            for (int i = 0; i < lista.length(); i++) {
                JSONObject item = lista.optJSONObject(i);
                if (item == null) continue;
                String src = item.optString("src", "");
                if (src.isEmpty()) continue;
                // Só aceita a opção rotulada como dublada ("HD DUB"). Sem esse
                // rótulo o arquivo pode estar no idioma original — nesse caso é
                // melhor deixar o aplicativo seguir para a próxima fonte.
                if (item.optString("label", "").toLowerCase().contains("dub")) { escolhida = src; break; }
            }
            if (escolhida.isEmpty()) return error(502);
            String url = escolhida.startsWith("http") ? escolhida : new URL(new URL("https://pipocacine.lat/"), escolhida).toString();
            Uri uri = Uri.parse(url);
            if (!"https".equals(uri.getScheme()) || uri.getHost() == null || !uri.getHost().endsWith("pipocacine.lat")) return error(502);
            return jsonMidia(url, "file", "PipocaCine");
        } catch (Exception e) { return error(502); }
    }

    // MGEB (mgeb.top): entrega as opções de vídeo no próprio HTML. O arquivo
    // MP4 toca direto (sem anúncio) e a lista HLS serve para o resto; medido em
    // 08/10/2026 — áudio em português e CORS liberado para o player.
    private WebResourceResponse mgebFilme(String id) {
        return mgeb("https://mgeb.top/embed/" + id);
    }
    private WebResourceResponse mgebEpisodio(String id, String temporada, String episodio) {
        return mgeb("https://mgeb.top/embed/" + id + "/" + temporada + "/" + episodio);
    }
    private WebResourceResponse mgeb(String endereco) {
        try {
            Long deadline=qualityDeadline.get();
            String html = MgebHttp.read(endereco,deadline==null?Long.MAX_VALUE:deadline);
            if (html == null) return error(502);
            Matcher bloco = Pattern.compile("var\\s+sources\\s*=\\s*(\\[[\\s\\S]*?\\]);").matcher(html);
            if (!bloco.find()) return error(502);
            JSONArray lista = new JSONArray(bloco.group(1));
            List<MgebSources.Source> fontes = new ArrayList<>();
            for (int i = 0; i < lista.length(); i++) {
                JSONObject item = lista.optJSONObject(i);
                if (item == null) continue;
                MgebSources.Source fonte = MgebSources.parse(item.optString("file", ""), item.optString("label", ""));
                if (fonte != null && enderecoSeguro(fonte.url)) fontes.add(fonte);
            }
            WebResourceResponse resposta = MgebSources.firstWorking(fontes, fonte -> {
                WebResourceResponse candidata = jsonMidia(fonte.url, fonte.file ? "file" : "hls", "MGEB · dublado", "pt-BR", "mgeb", "https://mgeb.top/",fonte.height>0?fonte.height+"p":"");
                return candidata != null && candidata.getStatusCode() == 200 ? candidata : null;
            });
            return resposta != null ? resposta : error(502);
        } catch (Exception e) { return error(502); }
    }
    private WebResourceResponse pipocaEpisodio(String id, String temporada, String episodio) {
        try {
            String html = lerPagina("https://pipocacine.lat/media/tv?id=" + id + "&s=" + temporada + "&e=" + episodio, "https://pipocacine.lat/");
            if (html == null) return error(502);
            Matcher bloco = Pattern.compile("var\\s+SEASONS_DATA\\s*=\\s*(\\{.*?\\});", Pattern.DOTALL).matcher(html);
            if (!bloco.find()) return error(502);
            JSONObject dados = new JSONObject(bloco.group(1));
            JSONObject daTemporada = dados.optJSONObject(String.valueOf(Integer.parseInt(temporada)));
            if (daTemporada == null) daTemporada = dados.optJSONObject(temporada);
            if (daTemporada == null) return error(502);
            JSONObject episodios = daTemporada.optJSONObject("episodes");
            if (episodios == null) return error(502);
            JSONObject alvo = episodios.optJSONObject(String.valueOf(Integer.parseInt(episodio)));
            if (alvo == null) alvo = episodios.optJSONObject(episodio);
            if (alvo == null || alvo.isNull("url_dub")) return error(502);
            String url = alvo.optString("url_dub", "");
            if (!url.matches("https://nixplay\\.lat/series/[a-z0-9-]+/[A-Za-z0-9_-]+/\\d{1,10}/\\d{1,3}/\\d{1,4}\\.mp4")) return error(502);
            return jsonMidia(url, "file", "PipocaCine", "pt-BR", "pipoca-serie");
        } catch (Exception e) { return error(502); }
    }

    private QualitySelector.Candidate qualityCandidate(WebResourceResponse response) {
        if(response==null||response.getStatusCode()!=200)return null;
        try(InputStream input=response.getData()){
            JSONObject data=new JSONObject(lerTexto(input));
            if(!"pt-BR".equals(data.optString("audio")))return null;
            String id=data.optString("fonteId"),type=data.optString("type"),raw=data.optString("url"),referer=data.optString("_referer","");
            if(!id.matches("[a-z0-9_-]{1,64}"))return null;
            if(raw.startsWith("/api/hls?")){Uri uri=Uri.parse(raw);raw=decodificar(uri.getQueryParameter("u"));referer=decodificar(uri.getQueryParameter("r"));}
            NativeMediaProbe.safe(raw);
            if(!"hls".equals(type)&&!("file".equals(type)&&new URL(raw).getPath().toLowerCase(java.util.Locale.ROOT).endsWith(".mp4")))return null;
            Matcher height=Pattern.compile("(?i)(\\d{3,4})\\s*p\\b").matcher(data.optString("resolucao"));
            int declared=height.find()?Integer.parseInt(height.group(1)):0;
            data.remove("_referer");
            return new QualitySelector.Candidate(id,raw,referer,type,data.toString(),declared);
        }catch(Exception ignored){return null;}
    }

    private QualitySelector.Source qualitySource(java.util.concurrent.Callable<WebResourceResponse> resolver) {
        return deadline->{qualityDeadline.set(deadline);try{return qualityCandidate(resolver.call());}finally{qualityDeadline.remove();}};
    }

    private QualitySelector.Source qualityProfileSource(JSONObject ficha,String tipo,String id,String temporada,String episodio,java.util.Set<String> excluded) {
        final String profileId=ficha.optString("id");
        return new QualitySelector.Source(){
            @Override public QualitySelector.Candidate resolve(long deadline)throws Exception {
                return qualitySource(()->perfilPlayback(tipo,id,temporada,episodio,excluded,profileId)).resolve(deadline);
            }
            @Override public List<QualitySelector.Candidate> resolveAll(long deadline)throws Exception {
                JSONArray steps=ficha.optJSONArray("passos");JSONObject step=steps==null?null:steps.optJSONObject(0);
                if(steps==null||steps.length()!=1||step==null||!"json".equals(step.optString("tipo"))||!"streams[0].url".equals(step.optString("caminho")))return QualitySelector.Source.super.resolveAll(deadline);
                qualityDeadline.set(deadline);
                try{
                    String model=ficha.optString("tv".equals(tipo)?"urlTv":"urlMovie");String imdb=imdbNaMemoria(tipo,id);
                    if(model.contains("{imdb}")&&imdb.isEmpty()){imdb=imdbDoTitulo(tipo,id);guardarImdb(tipo,id,imdb);}
                    if(model.contains("{imdb}")&&imdb.isEmpty())return Collections.emptyList();
                    String endpoint=preencher(model,id,temporada,episodio).replace("{imdb}",Uri.encode(imdb));
                    if(!enderecoSeguro(endpoint))return Collections.emptyList();
                    String ref=ficha.optString("referer",endpoint);String body=lerPagina(endpoint,ref);
                    if(body==null)return Collections.emptyList();JSONArray streams=new JSONObject(body).optJSONArray("streams");
                    List<QualitySelector.Candidate> candidates=new ArrayList<>();
                    for(int i=0;streams!=null&&i<streams.length()&&i<128;i++){
                        JSONObject stream=streams.optJSONObject(i);if(stream==null)continue;
                        String name=stream.optString("name"),title=stream.optString("title"),label=name+" "+title;
                        if(!AddonPolicy.dubbed(label))continue;
                        String raw=stream.optString("url");if(raw.startsWith("http://"))raw="https://"+raw.substring(7);
                        if(!enderecoSeguro(raw))continue;
                        String path=new URL(raw).getPath().toLowerCase(java.util.Locale.ROOT);
                        boolean opaque=!Pattern.compile("\\.[a-z0-9]{1,5}$").matcher(path).find();
                        String mediaType=path.endsWith(".m3u8")?"hls":path.endsWith(".mp4")||opaque?"file":"";
                        if(mediaType.isEmpty())continue;
                        int declared=AddonPolicy.height(label);
                        JSONObject data=new JSONObject();data.put("url","hls".equals(mediaType)?enderecoEncaminhado(raw,ref):raw);
                        data.put("audio","pt-BR");data.put("type",mediaType);data.put("source",ficha.optString("nome","Fonte")+" · "+name);data.put("fonteId",profileId);
                        data.put("resolucao",declared>0?declared+"p":"");
                        QualitySelector.Candidate candidate=new QualitySelector.Candidate(profileId,raw,ref,mediaType,data.toString(),declared);candidate.requiresProof=opaque;candidates.add(candidate);
                    }
                    Collections.sort(candidates,(a,b)->Integer.compare(b.declared,a.declared));return candidates.subList(0,Math.min(8,candidates.size()));
                }finally{qualityDeadline.remove();}
            }
        };
    }

    private void seedVerifiedMedia(VerifiedMediaStore store) {
        try(InputStream in=getAssets().open("midias-verificadas-seed.json")) {
            ByteArrayOutputStream bytes=new ByteArrayOutputStream();byte[] buffer=new byte[4096];int n;
            while((n=in.read(buffer))!=-1){if(bytes.size()+n>100000)return;bytes.write(buffer,0,n);}
            JSONObject seed=new JSONObject(bytes.toString("UTF-8"));int version=seed.optInt("version");
            android.content.SharedPreferences prefs=getSharedPreferences("verified-media",MODE_PRIVATE);
            if(version<=prefs.getInt("seed",0)&&store.healthy())return;
            JSONArray items=seed.optJSONArray("items");
            for(int i=0;items!=null&&i<items.length();i++){
                JSONObject r=items.optJSONObject(i);if(r==null||System.currentTimeMillis()-r.optLong("at")>7L*86400000)continue;
                String id=r.optString("id"),url=r.optString("url"),ref=r.optString("referer");int w=r.optInt("width"),h=r.optInt("height");
                JSONObject data=new JSONObject().put("url",url).put("referer",ref).put("type","file").put("audio","pt-BR").put("fonteId",id).put("fonte",r.optString("name",id));
                QualitySelector.Candidate c=new QualitySelector.Candidate(id,url,ref,"file",data.toString(),0);
                c.measure=new QualitySelector.Measure(w,h,2,0,true);
                store.save(r.optString("key"),Collections.singletonList(c));
            }
            if(store.healthy())prefs.edit().putInt("seed",version).apply();
        }catch(Exception optional){ /* A descoberta normal segue disponível. */ }
    }

    private WebResourceResponse qualityPlayback(String tipo,String id,String temporada,String episodio,java.util.Set<String> excluded) {
        final java.util.Set<String> exceto=Collections.unmodifiableSet(new java.util.HashSet<>(excluded));
        List<QualitySelector.Source> sources=new ArrayList<>();
        boolean tv="tv".equals(tipo);
        java.util.Set<String> allowed=new java.util.HashSet<>();
        Collections.addAll(allowed,tv?"pipoca-serie":"pipoca","watchplay","mgeb");
        if(!exceto.contains("pipoca")&&!tv)sources.add(qualitySource(()->pipocaFilme(id)));
        if(!exceto.contains("watchplay"))sources.add(qualitySource(()->directPlayback(tv?"https://v2.watchplay.shop/tvshow/"+id+"/"+temporada+"/"+episodio:"https://v2.watchplay.shop/movie/"+id)));
        if(!exceto.contains("pipoca-serie")&&tv)sources.add(qualitySource(()->pipocaEpisodio(id,temporada,episodio)));
        if(!exceto.contains("mgeb"))sources.add(qualitySource(()->tv?mgebEpisodio(id,temporada,episodio):mgebFilme(id)));
        String profiles=perfis();
        try{
            JSONArray lista=new JSONObject(profiles).optJSONArray("perfis");java.util.Set<String> seen=new java.util.HashSet<>();
            for(int i=0;lista!=null&&i<lista.length();i++){
                JSONObject ficha=lista.optJSONObject(i);if(ficha==null||!ficha.optBoolean("ativo",true)||!ficha.optBoolean("dublado",false))continue;
                final String profileId=ficha.optString("id");if(!profileId.matches("[a-z0-9_-]{1,64}")||exceto.contains(profileId)||!seen.add(profileId))continue;
                if(ficha.optString(tv?"urlTv":"urlMovie").isEmpty())continue;
                JSONArray tipos=ficha.optJSONArray("tipos");boolean applies=false;for(int j=0;tipos!=null&&j<tipos.length();j++)if(tipo.equals(tipos.optString(j)))applies=true;
                if(applies){allowed.add(profileId);sources.add(qualityProfileSource(ficha,tipo,id,temporada,episodio,exceto));}
            }
        }catch(Exception ignored){ /* Segue com as fontes fixas se a ficha não estiver disponível. */ }
        String key=tipo+":"+id+":"+temporada+":"+episodio+":"+new java.util.TreeSet<>(exceto)+":"+(profiles==null?0:profiles.hashCode());
        String title=tv?"tv:"+id+":"+temporada+":"+episodio:"movie:"+id;
        QualitySelector.Candidate chosen=qualitySelector.choose(key,sources,exceto,NativeMediaProbe::read,6500,title,allowed);
        if(chosen!=null){
            try{
                JSONObject data=new JSONObject(chosen.json);QualitySelector.Measure m=chosen.measure;
                if("file".equals(chosen.type)){
                    // O WebView recebe o destino HTTPS final, sem passar pelos
                    // redirecionamentos http publicados por alguns fornecedores.
                    java.net.HttpURLConnection connection=MediaHttp.open(chosen.deliveryUrl==null?chosen.url:chosen.deliveryUrl,chosen.referer,"bytes=0-2047",QualitySelector.now()+5000);
                    try{MediaHttp.requireMedia(connection);data.put("url",connection.getURL().toString());data.put("midiaConferida",m!=null&&m.width>0&&m.height>0);}finally{connection.disconnect();}
                }else if(!entregaVideo(chosen.url,chosen.referer)){qualitySelector.forget(key);return error(502);}
                if(m!=null&&m.width>0&&m.height>0){data.put("resolucao",m.height+"p");data.put("largura",m.width);data.put("altura",m.height);data.put("evidenciaQualidade","medido");}
                else if(chosen.declared>0)data.put("evidenciaQualidade","informado pela fonte");
                return respostaTexto("application/json",data.toString());
            }catch(Exception ignored){qualitySelector.forget(key);return error(502);}
        }
        return exceto.contains("vixsrc")?error(502):vixsrcMidia(tipo,id,temporada,episodio);
    }

    private final java.util.Map<String,CrystalLakeSource.Result> crystalLakeCache=new java.util.concurrent.ConcurrentHashMap<>();

    private CrystalLakeSource.Result crystalLakeHd(String episode)throws Exception {
        String html=MgebHttp.read("https://mgeb.top/embed/213562/1/"+episode,QualitySelector.now()+14000);
        Matcher block=Pattern.compile("var\\s+sources\\s*=\\s*(\\[[\\s\\S]*?\\]);").matcher(html==null?"":html);if(!block.find())return null;
        JSONArray sources=new JSONArray(block.group(1));CrystalLakeSource.Result best=null;
        for(int i=0;i<sources.length()&&i<8;i++){
            JSONObject source=sources.optJSONObject(i);if(source==null)continue;String url=source.optString("file");
            if(!CrystalLakeSource.hdUrl(url)||!new URL(url).getPath().endsWith(".m3u8"))continue;
            String playlist=CrystalLakeSource.hdPlaylist(lerPagina(url,"https://mgeb.top/"),url);if(playlist==null)continue;
            java.util.Set<String> targets=new java.util.HashSet<>();Matcher match=Pattern.compile("URI=\"([^\"]+)\"").matcher(playlist);while(match.find())targets.add(match.group(1));
            for(String l:playlist.split("\\n"))if(!l.trim().isEmpty()&&!l.startsWith("#"))targets.add(l.trim());
            if(targets.size()>16)continue;boolean valid=true;
            for(String child:targets)if(!CrystalLakeSource.cleanHdMedia(lerPagina(child,"https://mgeb.top/"),child)){valid=false;break;}
            if(!valid)continue;
            CrystalLakeSource.Result candidate=new CrystalLakeSource.Result(url,playlist,System.currentTimeMillis()+300000,"https://mgeb.top/");
            if(best==null||(long)candidate.width*candidate.height>(long)best.width*best.height)best=candidate;
        }
        return best;
    }
    private synchronized CrystalLakeSource.Result crystalLakeResolve(String episode,boolean refresh)throws Exception {
        if(!CrystalLakeSource.applies("213562","1",episode))return null;
        CrystalLakeSource.Result cached=crystalLakeCache.get(episode);if(!refresh&&cached!=null&&cached.until>System.currentTimeMillis())return cached;
        CrystalLakeSource.Result original=null,hd=null;
        Long previous=qualityDeadline.get();qualityDeadline.set(QualitySelector.now()+14000);
        try{hd=crystalLakeHd(episode);}catch(Exception unavailable){ /* Usa a reserva aprovada. */ }
        finally{if(previous==null)qualityDeadline.remove();else qualityDeadline.set(previous);}
        try{original=crystalLakeOriginal(episode,refresh);}catch(Exception unavailable){ /* HD pode seguir disponível. */ }
        CrystalLakeSource.Result chosen=hd!=null&&(original==null||(long)hd.width*hd.height>(long)original.width*original.height)?hd:original;
        if(chosen!=null)crystalLakeCache.put(episode,chosen);return chosen;
    }
    private CrystalLakeSource.Result crystalLakeOriginal(String episode,boolean refresh)throws Exception {
        if(!CrystalLakeSource.applies("213562","1",episode))return null;
        long now=System.currentTimeMillis();CrystalLakeSource.Result cached=crystalLakeCache.get(episode);
        if(!refresh&&cached!=null&&cached.until>now)return cached;
        Long previousDeadline=qualityDeadline.get();if(previousDeadline==null)qualityDeadline.set(QualitySelector.now()+14000);
        try{
        String embed=CrystalLakeSource.ORIGIN+"/embed2/213562-1-"+episode;
        CrystalLakeSource.Settings settings=CrystalLakeSource.settings(lerPagina(embed,CrystalLakeSource.REFERER));
        if(settings==null)return null;
        JSONObject config=new JSONObject(settings.json);JSONArray ads=config.optJSONArray("advertising");JSONObject fields=config.optJSONObject("fields");
        if(fields==null||!("213562-1-"+episode).equals(fields.optString("imdb"))||ads==null||ads.length()!=0||!Boolean.FALSE.equals(config.opt("popactive"))||!"0".equals(String.valueOf(config.opt("poplimit")))||!"".equals(config.opt("popurl"))||!Boolean.FALSE.equals(config.opt("p2p")))return null;
        HttpsURLConnection connection=null;String raw;
        try{
            connection=(HttpsURLConnection)new URL(CrystalLakeSource.ORIGIN+"/player/index.php?data="+settings.hash+"&do=getVideo").openConnection();
            connection.setConnectTimeout(qualityTimeout(5000));connection.setReadTimeout(qualityTimeout(5000));connection.setInstanceFollowRedirects(false);connection.setRequestMethod("POST");connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type","application/x-www-form-urlencoded");connection.setRequestProperty("X-Requested-With","XMLHttpRequest");connection.setRequestProperty("Referer",embed);
            byte[] body=("hash="+settings.hash+"&r="+java.net.URLEncoder.encode(CrystalLakeSource.REFERER,"UTF-8")).getBytes(StandardCharsets.UTF_8);
            connection.setFixedLengthStreamingMode(body.length);try(java.io.OutputStream output=connection.getOutputStream()){output.write(body);}
            if(connection.getResponseCode()!=200)return null;
            byte[] bytes=lerBytes(connection.getInputStream());if(bytes.length>262144)return null;raw=new String(bytes,StandardCharsets.UTF_8);
        }finally{if(connection!=null)connection.disconnect();}
        JSONObject data=new JSONObject(raw);String url=data.optString("securedLink"),source=data.optString("videoSource");
        if(!CrystalLakeSource.validLink(data.optBoolean("hls"),source,url,System.currentTimeMillis()))return null;
        String playlist=CrystalLakeSource.portuguesePlaylist(lerPagina(url,null));if(playlist==null)return null;
        java.util.Set<String> children=new java.util.HashSet<>();Matcher child=Pattern.compile("URI=\"([^\"]+)\"").matcher(playlist);while(child.find())children.add(child.group(1));
        for(String line:playlist.split("\\n"))if(!line.trim().isEmpty()&&!line.startsWith("#"))children.add(line.trim());
        if(children.size()>16)return null;
        for(String target:children)if(!CrystalLakeSource.cleanMediaPlaylist(lerPagina(target,null)))return null;
        CrystalLakeSource.Result result=new CrystalLakeSource.Result(url,playlist,Math.min(System.currentTimeMillis()+300000,CrystalLakeSource.expiry(url)-90000));
        crystalLakeCache.put(episode,result);return result;
        }finally{if(previousDeadline==null)qualityDeadline.remove();else qualityDeadline.set(previousDeadline);}
    }

    private WebResourceResponse crystalLakePlaylist(String episode){
        try{
            CrystalLakeSource.Result data=crystalLakeResolve(episode,false);if(data==null)return error(502);
            StringBuilder output=new StringBuilder();
            for(String line:data.playlist.split("\\n")){
                if(line.startsWith("#")){
                    Matcher target=Pattern.compile("URI=\"([^\"]+)\"").matcher(line);StringBuffer rewritten=new StringBuffer();
                    while(target.find())target.appendReplacement(rewritten,Matcher.quoteReplacement("URI=\""+enderecoEncaminhado(target.group(1),data.referer)+"\""));
                    target.appendTail(rewritten);output.append(rewritten);
                }else if(!line.trim().isEmpty())output.append(enderecoEncaminhado(line.trim(),data.referer));
                output.append('\n');
            }
            return respostaTexto("application/vnd.apple.mpegurl",output.toString());
        }catch(Exception unavailable){return error(502);}
    }

    private WebResourceResponse directEpisode(String id,String temporada,String episodio,java.util.Set<String> exceto) {
        if(CrystalLakeSource.applies(id,temporada,episodio)&&!exceto.contains(CrystalLakeSource.ID)){
            try{CrystalLakeSource.Result resolved=crystalLakeResolve(episodio,true);if(resolved!=null){
                JSONObject data=new JSONObject();data.put("url","/api/crystal-lake/1/"+episodio+"/master.m3u8");data.put("audio","pt-BR");data.put("type","hls");data.put("source","Crystal Lake · dublado");data.put("fonteId",CrystalLakeSource.ID);data.put("resolucao",resolved.resolution);data.put("largura",resolved.width);data.put("altura",resolved.height);
                return respostaTexto("application/json",data.toString());
            }}catch(Exception unavailable){ /* Mantém as alternativas atuais se a exceção falhar. */ }
        }
        return qualityPlayback("tv",id,temporada,episodio,exceto);
    }

    // ---------------------------------------------------------------
    // Legendas no aparelho (não existe servidor no celular)
    // ---------------------------------------------------------------
    private WebResourceResponse respostaTexto(String tipo, String corpo) {
        return new WebResourceResponse(tipo, "UTF-8", 200, "OK",
            Collections.singletonMap("Cache-Control", "no-store"),
            new ByteArrayInputStream(corpo.getBytes(StandardCharsets.UTF_8)));
    }

    private String chaveTmdb() {
        try (InputStream entrada = getAssets().open("config.json"); ByteArrayOutputStream saida = new ByteArrayOutputStream()) {
            byte[] bloco = new byte[4096]; int lidos;
            while ((lidos = entrada.read(bloco)) != -1) saida.write(bloco, 0, lidos);
            Matcher achado = Pattern.compile("\"tmdbKey\"\\s*:\\s*\"([^\"]+)\"").matcher(new String(saida.toByteArray(), StandardCharsets.UTF_8));
            return achado.find() ? achado.group(1) : "";
        } catch (Exception e) { return ""; }
    }

    // Lista as legendas em português do filme ou da série (código IMDb, buscado no TMDB).
    private WebResourceResponse legendasOnline(Uri uri) {
        try {
            String imdb = uri.getQueryParameter("imdb") == null ? "" : uri.getQueryParameter("imdb");
            if (!imdb.matches("tt\\d{5,10}")) {
                String id = uri.getQueryParameter("id") == null ? "" : uri.getQueryParameter("id");
                if (id.matches("\\d{1,10}")) {
                    String tipo = uri.getQueryParameter("tipo") == null ? "" : uri.getQueryParameter("tipo");
                    // A série tem ficha própria no TMDB: na rota /movie/ o TMDB devolve
                    // "imdb_id": null, por isso o tipo do pedido decide a rota.
                    boolean serie = "tv".equals(tipo) || "serie".equals(tipo) || "series".equals(tipo);
                    imdb = imdbDoTitulo(serie ? "tv" : "movie", id);
                    // A interface do aparelho ainda pede só o id (sem ?tipo=): quando a
                    // ficha de filme não traz o código, o título é série — tenta a de série.
                    if (tipo.isEmpty() && !imdb.matches("tt\\d{5,10}")) imdb = imdbDoTitulo("tv", id);
                }
            }
            JSONArray lista = new JSONArray();
            if (imdb.matches("tt\\d{5,10}")) {
                String html = lerPagina("https://yifysubtitles.ch/movie-imdb/" + imdb, "https://yifysubtitles.ch/");
                if (html != null) {
                    Matcher linhas = Pattern.compile("<tr[\\s\\S]*?</tr>").matcher(html);
                    while (linhas.find()) {
                        String linha = linhas.group();
                        boolean portugues = Pattern.compile("flag-(br|pt)\\b").matcher(linha).find()
                            || Pattern.compile("portugu", Pattern.CASE_INSENSITIVE).matcher(linha).find();
                        if (!portugues) continue;
                        Matcher caminho = Pattern.compile("href=\"(/subtitles/[^\"]+)\"").matcher(linha);
                        if (!caminho.find()) continue;
                        Matcher idioma = Pattern.compile("sub-lang\">([^<]+)<").matcher(linha);
                        Matcher nota = Pattern.compile("label-success\">\\s*(\\d+)").matcher(linha);
                        JSONObject item = new JSONObject();
                        item.put("nome", "Legenda em português");
                        item.put("idioma", idioma.find() ? idioma.group(1) : "Português");
                        item.put("nota", nota.find() ? Integer.parseInt(nota.group(1)) : 0);
                        item.put("pagina", "https://yifysubtitles.ch" + caminho.group(1));
                        item.put("baixar", "https://yifysubtitles.ch" + caminho.group(1).replace("/subtitles/", "/subtitle/") + ".zip");
                        lista.put(item);
                    }
                }
            }
            JSONObject resposta = new JSONObject();
            resposta.put("fonte", "YIFY");
            resposta.put("imdb", imdb);
            resposta.put("encontradas", lista);
            return respostaTexto("application/json", resposta.toString());
        } catch (Exception e) {
            return respostaTexto("application/json", "{\"fonte\":\"YIFY\",\"encontradas\":[]}");
        }
    }

    // Baixa o arquivo .zip da legenda e entrega o texto pronto para o player.
    private WebResourceResponse legendaOnline(Uri uri) {
        String arquivo = uri.getQueryParameter("arquivo") == null ? "" : uri.getQueryParameter("arquivo");
        if (!arquivo.matches("https://(www\\.)?yifysubtitles\\.ch/subtitle/[A-Za-z0-9._\\-/%]+\\.zip")) return error(400);
        HttpsURLConnection conexao = null;
        try {
            conexao = (HttpsURLConnection) new URL(arquivo).openConnection();
            conexao.setConnectTimeout(10000); conexao.setReadTimeout(15000);
            conexao.setInstanceFollowRedirects(true);
            conexao.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36");
            conexao.setRequestProperty("Referer", arquivo.replace("/subtitle/", "/subtitles/").replaceAll("\\.zip$", ""));
            if (conexao.getResponseCode() != 200) return error(404);
            try (InputStream entrada = conexao.getInputStream(); ZipInputStream zip = new ZipInputStream(entrada)) {
                ZipEntry item;
                while ((item = zip.getNextEntry()) != null) {
                    if (item.isDirectory() || !item.getName().matches("(?i).*\\.(srt|vtt)$")) continue;
                    ByteArrayOutputStream saida = new ByteArrayOutputStream();
                    byte[] bloco = new byte[8192]; int lidos;
                    while ((lidos = zip.read(bloco)) != -1) { saida.write(bloco, 0, lidos); if (saida.size() > 3000000) break; }
                    String texto = new String(saida.toByteArray(), StandardCharsets.UTF_8);
                    if (!texto.trim().isEmpty()) return respostaTexto("text/plain", texto);
                }
            }
        } catch (Exception e) { /* cai no erro abaixo */ }
        finally { if (conexao != null) conexao.disconnect(); }
        return error(404);
    }

    @SuppressLint("SetJavaScriptEnabled")
    // Apenas páginas públicas dos dois conectores; não é um proxy de destinos livres.
    // Anime tem uma rota própria; nenhum pedido comum de filme/série muda de fornecedor.
    private WebResourceResponse animePlayer(Uri uri) {
        AnimeSource.Request pedido = AnimeSource.request(uri.getQueryParameter("tipo"), uri.getQueryParameter("id"),
            uri.getQueryParameter("temporada"), uri.getQueryParameter("episodio"), uri.getQueryParameter("audio"));
        if (pedido == null) return error(400);
        AnimeSource.Clock relogio = () -> SystemClock.elapsedRealtime();
        AnimeSource.Catalog catalogo = new AnimeSource.Catalog() {
            @Override public AnimeSource.Title title(int id, long prazo) throws Exception {
                JSONObject dados = lerAnimeJson("https://api.themoviedb.org/3/tv/" + id + "?api_key=" + Uri.encode(chaveTmdb()) + "&language=pt-BR", prazo);
                if (dados == null || dados.optInt("id", -1) != id) return null;
                boolean animacao = false;
                JSONArray generos = dados.optJSONArray("genres");
                for (int i = 0; generos != null && i < generos.length(); i++) {
                    JSONObject genero = generos.optJSONObject(i);
                    if (genero != null && genero.optInt("id", -1) == 16) animacao = true;
                }
                java.util.Set<String> paises = new java.util.HashSet<>();
                JSONArray origem = dados.optJSONArray("origin_country");
                for (int i = 0; origem != null && i < origem.length(); i++) paises.add(origem.optString(i));
                return new AnimeSource.Title(id, animacao, paises, dados.optString("original_language", ""));
            }
            @Override public int[] episodes(int id, int temporada, long prazo) throws Exception {
                JSONObject dados = lerAnimeJson("https://api.themoviedb.org/3/tv/" + id + "/season/" + temporada + "?api_key=" + Uri.encode(chaveTmdb()), prazo);
                if (dados == null || dados.optInt("season_number", -1) != temporada) return null;
                JSONArray episodios = dados.optJSONArray("episodes");
                if (episodios == null || episodios.length() > 2000) return null;
                int[] numeros = new int[episodios.length()];
                for (int i = 0; i < numeros.length; i++) {
                    JSONObject episodio = episodios.optJSONObject(i);
                    numeros[i] = episodio == null || episodio.optInt("season_number", -1) != temporada ? -1 : episodio.optInt("episode_number", -1);
                }
                return numeros;
            }
        };
        AnimeSource.Player fornecedor = (id, temporada, episodio, prazo) -> {
            JSONObject dados = lerAnimeJson(AnimeSource.api(id, temporada, episodio), prazo);
            return dados != null && dados.optBoolean("success", false) ? dados.optString("videoUrl", "") : null;
        };
        AnimeSource.Result fonte = AnimeSource.resolve(pedido, catalogo, fornecedor, relogio);
        if (fonte == null) return animeDireto(pedido, catalogo);
        try {
            JSONObject dados = new JSONObject();
            dados.put("ok", true); dados.put("tipo", "embed"); dados.put("type", "embed"); dados.put("embed", true);
            dados.put("url", fonte.url); dados.put("source", "Meus Animes · legendado"); dados.put("nome", "Meus Animes · legendado");
            dados.put("supplierId", AnimeSource.SUPPLIER_ID); dados.put("fonteId", AnimeSource.SUPPLIER_ID);
            dados.put("audio", "original"); dados.put("legendado", true); dados.put("legenda", "pt-BR");
            dados.put("legendaPortugues", true); dados.put("legendaEmbutida", true); dados.put("anime", true);
            dados.put("pagina", fonte.page);
            JSONObject episodio = new JSONObject(); episodio.put("season", fonte.season); episodio.put("number", fonte.episode);
            dados.put("episode", episodio);
            // A preparação do iframe não comprova primeira imagem nem informa resolução.
            return respostaTexto("application/json", dados.toString());
        } catch (Exception falha) { return respostaTexto("application/json", "{\"ok\":false}"); }
    }

    private WebResourceResponse animeDireto(AnimeSource.Request pedido, AnimeSource.Catalog catalogo) {
        ProplayerSource.Catalog fontes = new ProplayerSource.Catalog() {
            @Override public ProplayerSource.Meta title(int id, long prazo) throws Exception {
                JSONObject dados = lerAnimeJson("https://api.themoviedb.org/3/tv/" + id + "?api_key=" + Uri.encode(chaveTmdb()) + "&language=en-US", prazo);
                if (dados == null || dados.optInt("id", -1) != id) return null;
                boolean animacao = false, origem = "ja".equals(dados.optString("original_language"));
                JSONArray generos = dados.optJSONArray("genres"), paises = dados.optJSONArray("origin_country"), temporadas = dados.optJSONArray("seasons");
                for (int i=0; generos!=null && i<generos.length(); i++) if (generos.optJSONObject(i)!=null && generos.optJSONObject(i).optInt("id")==16) animacao=true;
                for (int i=0; paises!=null && i<paises.length(); i++) if ("JP".equals(paises.optString(i)) || "KR".equals(paises.optString(i))) origem=true;
                java.util.Map<Integer,Integer> contagens = new java.util.HashMap<>();
                for (int i=0; temporadas!=null && i<temporadas.length(); i++) { JSONObject t=temporadas.optJSONObject(i); if(t!=null)contagens.put(t.optInt("season_number",-1),t.optInt("episode_count",0)); }
                return new ProplayerSource.Meta(id, dados.optString("name", ""), animacao && origem, contagens);
            }
            @Override public int[] episodes(int id,int temporada,long prazo) throws Exception { return catalogo.episodes(id,temporada,prazo); }
        };
        ProplayerSource.Result fonte = ProplayerSource.resolve(pedido, fontes, this::lerProplayerTexto, () -> SystemClock.elapsedRealtime());
        if (fonte == null) return respostaTexto("application/json", "{\"ok\":false}");
        try {
            JSONObject dados = new JSONObject();
            dados.put("ok",true);dados.put("tipo","file");dados.put("type","file");dados.put("tmdbId",pedido.id);dados.put("url",fonte.url);
            dados.put("fonteId",ProplayerSource.ID);dados.put("supplierId",ProplayerSource.ID);dados.put("source","PROPLAYER · legendado");dados.put("nome","PROPLAYER · legendado");
            dados.put("audio","original");dados.put("anime",true);dados.put("semAnuncio",true);dados.put("legendaPortugues",true);dados.put("legendaEmbutida",true);
            dados.put("pagina",fonte.page);dados.put("qualidade",fonte.height+"p");
            JSONObject episodio=new JSONObject();episodio.put("season",pedido.season);episodio.put("number",pedido.episode);dados.put("episode",episodio);
            return respostaTexto("application/json",dados.toString());
        } catch(Exception unavailable) { return respostaTexto("application/json","{\"ok\":false}"); }
    }

    private String lerProplayerTexto(String endereco,String referer,long prazo,int limite) throws Exception {
        long restante=prazo-SystemClock.elapsedRealtime();if(restante<=0)return null;
        URL url=new URL(endereco);String host=url.getHost();
        if(!"https".equals(url.getProtocol())||url.getUserInfo()!=null||url.getPort()!=-1||url.getRef()!=null||
            !("assistiranimesonline.net".equals(host)||"sk-ru.alibabacdn.net".equals(host)))return null;
        HttpsURLConnection conexao=(HttpsURLConnection)url.openConnection();
        try {
            conexao.setConnectTimeout((int)Math.min(restante,6000));conexao.setReadTimeout((int)Math.min(restante,6000));conexao.setInstanceFollowRedirects(false);
            conexao.setRequestProperty("User-Agent","Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36");
            if(!referer.isEmpty())conexao.setRequestProperty("Referer",referer);
            if(conexao.getResponseCode()!=200)return null;
            try(InputStream input=conexao.getInputStream();ByteArrayOutputStream bytes=new ByteArrayOutputStream()){
                byte[] buffer=new byte[8192];int count;
                while(true){restante=prazo-SystemClock.elapsedRealtime();if(restante<=0)return null;conexao.setReadTimeout((int)Math.min(restante,6000));count=input.read(buffer);if(count==-1)break;if(bytes.size()+count>limite)return null;bytes.write(buffer,0,count);}
                return new String(bytes.toByteArray(),StandardCharsets.UTF_8);
            }
        } finally { conexao.disconnect(); }
    }

    private JSONObject lerAnimeJson(String endereco, long prazo) throws Exception {
        HttpsURLConnection conexao = null;
        try {
            long restante = prazo - SystemClock.elapsedRealtime();
            if (restante <= 0) return null;
            URL destino = new URL(endereco);
            if (!"https".equals(destino.getProtocol()) || destino.getUserInfo() != null ||
                !("api.themoviedb.org".equals(destino.getHost()) || "serv01.meusdoramas.club".equals(destino.getHost()))) return null;
            conexao = (HttpsURLConnection) destino.openConnection();
            conexao.setConnectTimeout((int) Math.min(restante, 6000)); conexao.setReadTimeout((int) Math.min(restante, 6000));
            conexao.setInstanceFollowRedirects(false);
            conexao.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36");
            conexao.setRequestProperty("Accept", "application/json");
            if ("serv01.meusdoramas.club".equals(destino.getHost())) conexao.setRequestProperty("Referer", "https://serv01.meusdoramas.club/");
            conexao.connect();
            restante = prazo - SystemClock.elapsedRealtime();
            if (restante <= 0) return null;
            conexao.setReadTimeout((int) Math.min(restante, 6000));
            if (conexao.getResponseCode() != 200 || SystemClock.elapsedRealtime() >= prazo) return null;
            try (InputStream entrada = conexao.getInputStream(); ByteArrayOutputStream bytes = new ByteArrayOutputStream()) {
                byte[] bloco = new byte[8192]; int lidos;
                while (true) {
                    restante = prazo - SystemClock.elapsedRealtime();
                    if (restante <= 0) return null;
                    conexao.setReadTimeout((int) Math.min(restante, 6000));
                    lidos = entrada.read(bloco);
                    if (lidos == -1) break;
                    int limite = "serv01.meusdoramas.club".equals(destino.getHost()) ? 32768 : 1048576;
                    if (SystemClock.elapsedRealtime() >= prazo || bytes.size() + lidos > limite) return null;
                    bytes.write(bloco, 0, lidos);
                }
                return new JSONObject(new String(bytes.toByteArray(), StandardCharsets.UTF_8));
            }
        } finally { if (conexao != null) conexao.disconnect(); }
    }

    private WebResourceResponse mininovelaPagina(Uri uri) { return mininovelaPagina(uri, 0); }
    private WebResourceResponse mininovelaPagina(Uri uri, int salto) {
        String alvo = uri.getQueryParameter("url");
        if (alvo == null || alvo.length() > 1000) return error(400);
        Uri destino = Uri.parse(alvo);
        String host = destino.getHost(), caminho = destino.getEncodedPath();
        boolean reel = "www.reelshort.com".equals(host) && caminho != null && caminho.matches("/(pt/?|(pt/)?(episodes/([a-z0-9-]|%[a-fA-F0-9]{2})+|full-episodes/([a-z0-9-]|%[a-fA-F0-9]{2})+(/[1-9][0-9]?)?))");
        boolean box = "www.dramaboxdb.com".equals(host) && caminho != null && caminho.matches("/(pt/?|(pt/)?movie/[0-9]{1,20}/[a-z0-9-]+)");
        boolean net = "netshort.com".equals(host) && caminho != null && caminho.matches("/(pt/?|(pt/)?episode/[a-z0-9-]+)");
        boolean dora = "doraminhatv.com.br".equals(host) && caminho != null && destino.getQuery() == null && caminho.matches("/((serie/[a-z0-9-]+-rs[a-f0-9]{24})?)");
        boolean doraApi = false;
        if ("doraminhatv.com.br".equals(host) && "/api/hoshiyomi".equals(caminho)) {
            java.util.Set<String> nomes = destino.getQueryParameterNames();
            String tipo = destino.getQueryParameter("p"), livro = destino.getQueryParameter("id"), numero = destino.getQueryParameter("ep");
            boolean parametros = destino.getEncodedQuery() != null && destino.getEncodedQuery().split("&", -1).length == nomes.size();
            for (String nome : nomes) if (!java.util.Arrays.asList("p","lang","id","ep").contains(nome)) parametros = false;
            doraApi = parametros && "pt".equals(destino.getQueryParameter("lang")) && livro != null && livro.matches("[a-f0-9]{24}")
                && (("reelshort/detail".equals(tipo) && nomes.size() == 3) || ("reelshort/episode".equals(tipo) && nomes.size() == 4 && numero != null && numero.matches("[1-9][0-9]{0,3}")));
        }
        if (!"https".equals(destino.getScheme()) || destino.getPort() != -1 || destino.getUserInfo() != null || (destino.getQuery() != null && !doraApi) || destino.getFragment() != null || !(reel || box || net || dora || doraApi)) return error(400);
        HttpsURLConnection conexao = null;
        try {
            conexao = (HttpsURLConnection) new URL(alvo).openConnection();
            conexao.setConnectTimeout(15000); conexao.setReadTimeout((dora || doraApi) ? 50000 : 15000);
            if (dora || doraApi) conexao.setRequestProperty("Referer", "https://doraminhatv.com.br/");
            conexao.setInstanceFollowRedirects(false);
            conexao.setRequestProperty("User-Agent", "Mozilla/5.0");
            int status = conexao.getResponseCode();
            if (status == 301 || status == 302 || status == 307 || status == 308) {
                String location = conexao.getHeaderField("Location");
                if (salto >= 2 || location == null) return error(502);
                String proxima = new URL(new URL(alvo), location).toString();
                return mininovelaPagina(uri.buildUpon().clearQuery().appendQueryParameter("url", proxima).build(), salto + 1);
            }
            if (status != 200) return error(502);
            byte[] corpo;
            try (InputStream entrada = conexao.getInputStream(); ByteArrayOutputStream saida = new ByteArrayOutputStream()) {
                byte[] bloco = new byte[8192]; int n;
                while ((n = entrada.read(bloco)) != -1) {
                    if (saida.size() + n > 3000000) return error(502);
                    saida.write(bloco, 0, n);
                }
                corpo = saida.toByteArray();
            }
            return new WebResourceResponse("text/plain", "UTF-8", 200, "OK", Collections.singletonMap("Cache-Control", "no-store"), new ByteArrayInputStream(corpo));
        } catch (Exception erro) { return error(502); }
        finally { if (conexao != null) conexao.disconnect(); }
    }

    private WebView createWebView(boolean trusted) {
        WebView web = new WebView(this);
        web.setBackgroundColor(Color.BLACK);
        web.setFocusable(true);
        web.setFocusableInTouchMode(true);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        UiModeManager mode = (UiModeManager) getSystemService(UI_MODE_SERVICE);
        if ((mode != null && mode.getCurrentModeType() == Configuration.UI_MODE_TYPE_TELEVISION) || getPackageManager().hasSystemFeature("android.software.leanback") || getPackageManager().hasSystemFeature("android.hardware.type.television")) settings.setUserAgentString(settings.getUserAgentString() + " StreamTVAndroidTV");
        if (!settings.getUserAgentString().contains("StreamTVAndroid")) settings.setUserAgentString(settings.getUserAgentString() + " StreamTVAndroid");
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setSupportMultipleWindows(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true);
        web.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (!HOST.equals(uri.getHost())) {
                    // Robô das séries: se a página da fonte responder que não tem este
                    // episódio, o aplicativo troca de fonte sozinho.
                    if (request.isForMainFrame() && main != null && main.getUrl() != null && local(Uri.parse(main.getUrl()))) {
                        try {
                            HttpsURLConnection checagem = (HttpsURLConnection) new URL(uri.toString()).openConnection();
                            checagem.setConnectTimeout(6000); checagem.setReadTimeout(6000);
                            checagem.setInstanceFollowRedirects(true);
                            checagem.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36");
                            if (checagem.getResponseCode() == 200) {
                                String corpo;
                                try (InputStream entrada = checagem.getInputStream(); ByteArrayOutputStream saida = new ByteArrayOutputStream()) {
                                    byte[] bloco = new byte[8192]; int lidos; int total = 0;
                                    while ((lidos = entrada.read(bloco)) != -1 && total < 262144) { saida.write(bloco, 0, lidos); total += lidos; }
                                    corpo = new String(saida.toByteArray(), StandardCharsets.UTF_8);
                                }
                                if (Pattern.compile("not available|couldn't find|not found|não disponível|nao disponivel|conteúdo indisponível|conteudo indisponivel", Pattern.CASE_INSENSITIVE).matcher(corpo).find()) {
                                    main.post(() -> main.evaluateJavascript("window.StreamFonteFalhou && window.StreamFonteFalhou('a fonte não tem este episódio')", null));
                                    checagem.disconnect();
                                    return new WebResourceResponse("text/html", "UTF-8", 200, "OK", Collections.singletonMap("Cache-Control", "no-store"),
                                        new ByteArrayInputStream("<html><body style='background:#000;color:#999;font:14px sans-serif;padding:24px'>Trocando de fonte…</body></html>".getBytes(StandardCharsets.UTF_8)));
                                }
                            }
                            checagem.disconnect();
                        } catch (Exception e) { /* segue o carregamento normal */ }
                    }
                    return null;
                }
                if (!trusted || !local(uri) || !"GET".equals(request.getMethod())) return error(403);
                String path = uri.getPath();
                if("/api/notificacoes".equals(path))return notificacoesServidor();
                if ("/api/anime-player".equals(path)) return animePlayer(uri);
                if ("/api/mininovelas/pagina".equals(path)) return mininovelaPagina(uri);
                if ("/api/relato-nativo".equals(path)) {
                    // Header não simples impede que uma página externa acione a rota
                    // por imagem ou fetch sem preflight; só a interface local o envia.
                    boolean autorizado = false;
                    for (java.util.Map.Entry<String, String> item : request.getRequestHeaders().entrySet()) {
                        if ("X-Conecta-Relato".equalsIgnoreCase(item.getKey()) && "1".equals(item.getValue())) autorizado = true;
                    }
                    if (!autorizado) return error(403);
                    return relatoNativo(uri);
                }
                if (path != null && path.matches("/api/playback/[0-9]{1,10}")) {
                    String id = path.substring("/api/playback/".length());
                    java.util.Set<String> exceto = PlaybackSources.exclusions(uri.getQueryParameter("exceto"));
                    return qualityPlayback("movie",id,null,null,exceto);
                }
                if (path != null && path.matches("/api/playback/serie/[0-9]{1,10}/[0-9]{1,3}/[1-9][0-9]{0,3}")) {
                    String[] partes = path.split("/");
                    return directEpisode(partes[4], partes[5], partes[6], PlaybackSources.exclusions(uri.getQueryParameter("exceto")));
                }
                // Legendas no aparelho: quando o filme toca com o áudio original,
                // o telefone busca sozinho a legenda em português (sem cadastro).
                if (path != null && "/api/legendas/online".equals(path)) return legendasOnline(uri);
                // Encaminhador do vídeo (ver encaminharMidia): sem isso o CDN
                // recusa o pedido que vem do WebView e o anime não abre.
                if (path != null && "/api/tv/la18hd".equals(path)) return la18Playback();
                if (path != null && "/api/futebol/agenda".equals(path)) return futebolAgenda(uri);
                if (path != null && path.matches("/api/crystal-lake/1/[1-8]/master\\.m3u8")) return crystalLakePlaylist(path.split("/")[4]);
                if (path != null && "/api/hls".equals(path)) return encaminharMidia(uri);
                // Fichas de fonte (o mesmo arquivo que o computador usa): a
                // interface lê aqui para montar as listas de canais novas.
                if (path != null && "/perfis.json".equals(path)) {
                    String texto = perfis();
                    if (texto == null || texto.isEmpty()) return error(404);
                    return new WebResourceResponse("application/json", "UTF-8", 200, "OK", Collections.singletonMap("Cache-Control", "no-store"), new ByteArrayInputStream(texto.getBytes(StandardCharsets.UTF_8)));
                }
                if (path != null && "/api/legenda-online".equals(path)) return legendaOnline(uri);
                if (path != null && "/api/legendas".equals(path)) {
                    return respostaTexto("application/json", "{\"encontradas\":[]}");
                }
                String name = "/".equals(path) ? "index.html" : path.substring(1);
                // Only the bundled public assets can be served; no arbitrary file paths.
                if (!name.matches("(?:index\\.html|assistir\\.html|tv\\.css|personal\\.js|episodios\\.js|avisos-servidor\\.js|library\\.js|auth\\.js|jarvis\\.js|acesso\\.js|legendas\\.js|fontes\\.json|catalog\\.js|android\\.js|config\\.json|enquadramento\\.js|playback\\.js|reproducao-sessao\\.js|anime-player\\.js|hls\\.min\\.js|vidsrc-source\\.js|listas-tv\\.js|futebol\\.js|mininovelas\\.js|mininovelas-source\\.js|perfis\\.json)")) return error(404);
                try {
                    String mime = name.endsWith(".html") ? "text/html" : name.endsWith(".css") ? "text/css" : name.endsWith(".js") ? "text/javascript" : "application/json";
                    return new WebResourceResponse(mime, "UTF-8", 200, "OK", Collections.singletonMap("Cache-Control", "no-store"), getAssets().open(name));
                } catch (Exception e) { return error(404); }
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (trusted && request.isForMainFrame() && request.hasGesture() && local(uri) && "/check-updates".equals(uri.getPath())) { updater.check(true); return true; }
                if (trusted && request.isForMainFrame() && request.hasGesture() && local(uri) && abrirFutebol(uri)) return true;
                if (trusted && request.isForMainFrame() && fullscreenAction(uri)) return true;
                if (trusted && request.isForMainFrame() && local(uri) && "/assistir.html".equals(uri.getPath())) setInlineFullscreen(true);
                if (trusted && request.isForMainFrame() && local(uri) && "/index.html".equals(uri.getPath())) setInlineFullscreen(false);
                if (trusted && request.isForMainFrame() && local(uri) && "/remote-pointer".equals(uri.getPath())) {
                    if (request.hasGesture()) setPointerMode(!pointerMode);
                    return true;
                }
                if (!request.isForMainFrame()) return !"https".equals(uri.getScheme()) && !"about".equals(uri.getScheme());
                return blockNavigation(uri, trusted); // Third-party content cannot replace the catalog.
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, String url) {
                Uri uri = Uri.parse(url);
                if (trusted && local(uri) && "/check-updates".equals(uri.getPath())) { updater.check(true); return true; }
                if (trusted && local(uri) && abrirFutebol(uri)) return true;
                if (trusted && fullscreenAction(uri)) return true;
                if (trusted && local(uri) && "/assistir.html".equals(uri.getPath())) setInlineFullscreen(true);
                if (trusted && local(uri) && "/remote-pointer".equals(uri.getPath())) { setPointerMode(!pointerMode); return true; }
                return blockNavigation(uri, trusted); // Android 6 compatibility.
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) Toast.makeText(MainActivity.this, "Não foi possível abrir a página. Use Voltar e tente outra fonte.", Toast.LENGTH_LONG).show();
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onCreateWindow(WebView view, boolean dialog, boolean userGesture, Message result) {
                // Optional compatibility mode alone permits one visible popup from a tap.
                if (!trusted || !userGesture || popup != null || view.getUrl() == null || !view.getUrl().startsWith("https://" + HOST + "/assistir.html?")) return false;
                popupPanel = new LinearLayout(MainActivity.this);
                popupPanel.setOrientation(LinearLayout.VERTICAL);
                popupPanel.setBackgroundColor(Color.BLACK);
                Button close = new Button(MainActivity.this);
                close.setText("Voltar ao Conecta TV");
                close.setOnClickListener(v -> closePopup());
                popupPanel.addView(close, new LinearLayout.LayoutParams(-1, -2));
                popup = createWebView(false);
                popupPanel.addView(popup, new LinearLayout.LayoutParams(-1, 0, 1));
                root.addView(popupPanel, new FrameLayout.LayoutParams(-1, -1));
                ((WebView.WebViewTransport) result.obj).setWebView(popup);
                result.sendToTarget();
                close.requestFocus();
                return true;
            }
            @Override public void onCloseWindow(WebView window) { if (window == popup) closePopup(); }
            @Override public void onShowCustomView(View view, CustomViewCallback callback) {
                if (fullscreen != null) { callback.onCustomViewHidden(); return; }
                fullscreen = view;
                fullscreenCallback = callback;
                previousOrientation = getRequestedOrientation();
                setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
                getWindow().addFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
                main.setVisibility(View.GONE);
                root.addView(view, new FrameLayout.LayoutParams(-1, -1));
                root.setPadding(0, 0, 0, 0);
                root.setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
                if (Build.VERSION.SDK_INT >= 30 && getWindow().getInsetsController() != null) {
                    getWindow().getInsetsController().hide(WindowInsets.Type.systemBars());
                    getWindow().getInsetsController().setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                }
            }
            @Override public void onHideCustomView() { exitFullscreen(); }
            @Override public void onPermissionRequest(PermissionRequest request) { request.deny(); }
        });
        return web;
    }

    // A local pointer sends normal touch events, so non-focusable controls in nested external players remain reachable.
    private void setPointerMode(boolean enabled) {
        pointerMode = enabled;
        if (!enabled) { if (pointer != null) pointer.setVisibility(View.GONE); return; }
        if (pointer == null) {
            pointer = new View(this);
            GradientDrawable shape = new GradientDrawable();
            shape.setShape(GradientDrawable.OVAL); shape.setColor(0x70FFFFFF); shape.setStroke(3, Color.RED);
            pointer.setBackground(shape); pointer.setClickable(false); pointer.setFocusable(false);
            pointer.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
            root.addView(pointer, new FrameLayout.LayoutParams(24, 24));
        }
        pointerX = root.getWidth() / 2f; pointerY = root.getHeight() / 2f;
        pointer.setVisibility(View.VISIBLE); movePointer(0, 0);
        Toast.makeText(this, "Cursor: setas movem, OK clica, Voltar sai", Toast.LENGTH_LONG).show();
    }
    private void movePointer(float dx, float dy) {
        pointerX = Math.max(12, Math.min(root.getWidth()-12, pointerX+dx));
        pointerY = Math.max(12, Math.min(root.getHeight()-12, pointerY+dy));
        pointer.setX(pointerX-12); pointer.setY(pointerY-12); pointer.bringToFront();
    }
    private void clickPointer() {
        View target = fullscreen != null ? fullscreen : popup != null ? popup : main;
        int[] rootPos = new int[2], targetPos = new int[2];
        root.getLocationOnScreen(rootPos); target.getLocationOnScreen(targetPos);
        float x = pointerX+rootPos[0]-targetPos[0], y = pointerY+rootPos[1]-targetPos[1];
        if (x < 0 || y < 0 || x >= target.getWidth() || y >= target.getHeight()) return;
        long now = SystemClock.uptimeMillis();
        MotionEvent down = MotionEvent.obtain(now, now, MotionEvent.ACTION_DOWN, x, y, 0);
        MotionEvent up = MotionEvent.obtain(now, now+60, MotionEvent.ACTION_UP, x, y, 0);
        target.dispatchTouchEvent(down); target.dispatchTouchEvent(up); down.recycle(); up.recycle();
    }
    @Override public boolean dispatchKeyEvent(KeyEvent event) {
        int key = event.getKeyCode();
        if(key==KeyEvent.KEYCODE_VOLUME_UP||key==KeyEvent.KEYCODE_VOLUME_DOWN||key==KeyEvent.KEYCODE_VOLUME_MUTE||key==KeyEvent.KEYCODE_MUTE)return super.dispatchKeyEvent(event);
        if (event.getAction() == KeyEvent.ACTION_DOWN && main != null && main.getUrl() != null && local(Uri.parse(main.getUrl()))) main.evaluateJavascript("window.StreamChrome && window.StreamChrome.wake()", null);
        if (key == KeyEvent.KEYCODE_MENU) {
            if (event.getAction() == KeyEvent.ACTION_DOWN && event.getRepeatCount() == 0) setPointerMode(!pointerMode);
            return true;
        }
        if (pointerMode) {
            boolean direction = key == KeyEvent.KEYCODE_DPAD_LEFT || key == KeyEvent.KEYCODE_DPAD_RIGHT || key == KeyEvent.KEYCODE_DPAD_UP || key == KeyEvent.KEYCODE_DPAD_DOWN;
            if (direction) {
                if (event.getAction() == KeyEvent.ACTION_DOWN) {
                    float step = getResources().getDisplayMetrics().density * (event.getRepeatCount()>5?28:12);
                    movePointer(key==KeyEvent.KEYCODE_DPAD_LEFT?-step:key==KeyEvent.KEYCODE_DPAD_RIGHT?step:0,
                            key==KeyEvent.KEYCODE_DPAD_UP?-step:key==KeyEvent.KEYCODE_DPAD_DOWN?step:0);
                }
                return true;
            }
            if (key == KeyEvent.KEYCODE_DPAD_CENTER || key == KeyEvent.KEYCODE_ENTER) {
                if (event.getAction() == KeyEvent.ACTION_UP && !event.isCanceled()) clickPointer();
                return true;
            }
            if (key == KeyEvent.KEYCODE_BACK) { if (event.getAction() == KeyEvent.ACTION_UP) setPointerMode(false); return true; }
        }
        return super.dispatchKeyEvent(event);
    }

    private void exitFullscreen() {
        if (fullscreen == null) return;
        root.removeView(fullscreen);
        fullscreen = null;
        WebChromeClient.CustomViewCallback callback = fullscreenCallback;
        fullscreenCallback = null;
        main.setVisibility(View.VISIBLE);
        setRequestedOrientation(previousOrientation);
        getWindow().clearFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
        if (Build.VERSION.SDK_INT >= 30 && getWindow().getInsetsController() != null) getWindow().getInsetsController().show(WindowInsets.Type.systemBars());
        root.setSystemUiVisibility(View.SYSTEM_UI_FLAG_VISIBLE);
        root.requestApplyInsets();
        if (inlineFullscreen) {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
            root.setPadding(0, 0, 0, 0);
            root.setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
            if (Build.VERSION.SDK_INT >= 30 && getWindow().getInsetsController() != null) getWindow().getInsetsController().hide(WindowInsets.Type.systemBars());
        }
        if (callback != null) callback.onCustomViewHidden();
    }
    private void closePopup() {
        exitFullscreen();
        if (popup == null) return;
        popup.stopLoading();
        popup.loadUrl("about:blank");
        popupPanel.removeView(popup);
        root.removeView(popupPanel);
        popup.destroy();
        popup = null;
        popupPanel = null;
        main.requestFocus();
    }
    private void back() {
        if (pointerMode) { setPointerMode(false); return; }
        if (fullscreen != null) { exitFullscreen(); return; }
        if (inlineFullscreen) {
            setInlineFullscreen(false);
            if (!BuildConfig.TV && getPackageManager().hasSystemFeature(android.content.pm.PackageManager.FEATURE_TOUCHSCREEN)) {
                // One handset Back press leaves playback and returns to the title page.
                main.evaluateJavascript("Boolean(window.streamBack && window.streamBack())", null);
            }
            return;
        }
        if (popup != null) { closePopup(); return; }
        Uri current = Uri.parse(main.getUrl() == null ? HOME : main.getUrl());
        if (local(current) && "/assistir.html".equals(current.getPath())) { main.loadUrl(HOME); return; }
        if (local(current)) main.evaluateJavascript("Boolean(window.streamBack && window.streamBack())", result -> { if (!"true".equals(result)) finish(); });
        else main.loadUrl(HOME);
    }
    @Override public void onBackPressed() { back(); }
    @Override protected void onPause() {
        if (updater != null) updater.pause();
        if (main != null && main.getUrl() != null && local(Uri.parse(main.getUrl()))) main.evaluateJavascript("window.StreamPlayback && window.StreamPlayback.saveProgress(); document.querySelectorAll('video').forEach(v => v.pause())", null);
        if (popup != null) popup.onPause();
        main.onPause(); main.pauseTimers(); CookieManager.getInstance().flush();
        setPointerMode(false);
        super.onPause();
    }
    @Override protected void onResume() {
        super.onResume();
        if (updater != null) updater.resume();
        if (main != null) { main.resumeTimers(); main.onResume(); }
        if (popup != null) popup.onResume();
    }
    @Override protected void onDestroy() {
        if(qualitySelector!=null)qualitySelector.close();
        if (updater != null) updater.close();
        closePopup(); exitFullscreen(); root.removeView(main); main.destroy(); super.onDestroy();
    }
}


