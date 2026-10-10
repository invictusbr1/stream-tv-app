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

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            if (fullscreen == null && !inlineFullscreen) view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(), insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
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

    /** Texto das fichas: guardado no aparelho, senão o que veio junto da versão. */
    private String perfis() {
        if (perfisTexto != null) return perfisTexto;
        try {
            File guardado = arquivoPerfis();
            if (guardado.isFile()) {
                perfisTexto = lerTexto(new FileInputStream(guardado));
                if (perfisTexto != null && perfisTexto.length() > 10) return perfisTexto;
            }
        } catch (Exception e) { /* segue para o arquivo embutido */ }
        try { perfisTexto = lerTexto(getAssets().open("perfis.json")); } catch (Exception e) { perfisTexto = ""; }
        return perfisTexto == null ? "" : perfisTexto;
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
                if (texto == null || !texto.contains("\"perfis\"")) return;
                try (FileOutputStream saida = new FileOutputStream(arquivoPerfis())) { saida.write(texto.getBytes(StandardCharsets.UTF_8)); }
                perfisTexto = texto;
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
            if (!"https".equals(uri.getScheme()) || uri.getHost() == null || uri.getPort() != -1 || uri.getUserInfo() != null) return false;
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
                if (ficha == null || !ficha.optBoolean("ativo", true)) continue;
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
                String pagina = lerPagina(endereco, referer.isEmpty() ? null : referer);
                if (pagina == null) continue;
                JSONArray passos = ficha.optJSONArray("passos");
                String video = "";
                String atual = pagina;
                String base = referer.isEmpty() ? endereco : referer;
                for (int i = 0; passos != null && i < passos.length(); i++) {
                    JSONObject passo = passos.optJSONObject(i);
                    if (passo == null) break;
                    String achado = aplicarPasso(passo, atual, base);
                    // Passo de endereço: o molde vem com {id}/{temporada}/
                    // {episodio}/{imdb} e é preenchido aqui.
                    if (achado.contains("{id}") || achado.contains("{temporada}") || achado.contains("{episodio}")) {
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
                WebResourceResponse resposta = jsonMidia(video, tipoMidia, ficha.optString("nome", "Fonte nova"));
                if (resposta != null && resposta.getStatusCode() == 200) return resposta;
            }
            return error(502);
        } catch (Exception e) { return error(502); }
    }

    private boolean blockNavigation(Uri uri, boolean trusted) {
        return trusted ? !local(uri) : !"https".equals(uri.getScheme()) || HOST.equals(uri.getHost());
    }

    private void setInlineFullscreen(boolean enabled) {
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
        main.evaluateJavascript("window.StreamSetFullscreen && window.StreamSetFullscreen(" + enabled + ")", null);
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
            connection.setConnectTimeout(10000); connection.setReadTimeout(10000);
            connection.setInstanceFollowRedirects(false);
            connection.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36");
            connection.setRequestProperty("Accept-Language", "pt-BR,pt;q=0.9");
            if (referer != null) connection.setRequestProperty("Referer", referer);
            if (connection.getResponseCode() != 200) return null;
            try (InputStream input = connection.getInputStream(); ByteArrayOutputStream bytes = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[8192]; int count;
                while ((count = input.read(buffer)) != -1) { bytes.write(buffer, 0, count); if (bytes.size() > 4194304) return null; }
                return new String(bytes.toByteArray(), StandardCharsets.UTF_8);
            }
        } catch (Exception e) { return null; }
        finally { if (connection != null) connection.disconnect(); }
    }

    private WebResourceResponse jsonMidia(String url, String tipo, String fonte) {
        return jsonMidia(url, tipo, fonte, "pt-BR");
    }

    private WebResourceResponse jsonMidia(String url, String tipo, String fonte, String audio) {
        // Antes de entregar o endereço ao player, confere se ele realmente
        // devolve VÍDEO. As fontes trocam de servidor sem avisar (o PipocaCine
        // passou a devolver página de erro em 09/10/2026) e, sem esta
        // checagem, o aparelho ficava esperando uma imagem que nunca vinha.
        if (!entregaVideo(url, refererDaFonte(url))) return error(502);
        try {
            JSONObject result = new JSONObject();
            result.put("url", url); result.put("audio", audio); result.put("type", tipo); result.put("source", fonte);
            return new WebResourceResponse("application/json", "UTF-8", 200, "OK", Collections.singletonMap("Cache-Control", "no-store"), new ByteArrayInputStream(result.toString().getBytes(StandardCharsets.UTF_8)));
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

    private boolean entregaVideo(String url, String referer) {
        if (url == null || url.isEmpty()) return false;
        HttpsURLConnection conexao = null;
        try {
            conexao = (HttpsURLConnection) new URL(url).openConnection();
            conexao.setConnectTimeout(6000); conexao.setReadTimeout(6000);
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
            conexao.setConnectTimeout(10000); conexao.setReadTimeout(12000);
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
            String html = lerPagina(endereco, "https://mgeb.top/");
            if (html == null) return error(502);
            Matcher bloco = Pattern.compile("var\\s+sources\\s*=\\s*(\\[[\\s\\S]*?\\]);").matcher(html);
            if (!bloco.find()) return error(502);
            JSONArray lista = new JSONArray(bloco.group(1));
            String arquivo = "", playlist = "";
            for (int i = 0; i < lista.length(); i++) {
                JSONObject item = lista.optJSONObject(i);
                if (item == null) continue;
                String url = item.optString("file", "");
                if (url.isEmpty()) continue;
                if (url.startsWith("http://")) url = url.replaceFirst("http://", "https://").replace(":80/", "/");
                // A MGEB às vezes devolve caminho com ".." no meio
                // (ex.: mgeb.site/../cache/hls/...). Sem normalizar, o player e
                // a conferência de entrega falham e o título não abre no
                // aparelho — era o caso de várias minisséries e filmes.
                url = url.replace("/../", "/").replace("/./", "/");
                if (url.contains(".mp4")) { if (arquivo.isEmpty()) arquivo = url; }
                else if (url.contains(".m3u8")) { if (playlist.isEmpty()) playlist = url; }
            }
            if (!arquivo.isEmpty()) return jsonMidia(arquivo, "file", "MGEB · dublado");
            if (!playlist.isEmpty()) return jsonMidia(playlist, "hls", "MGEB · dublado");
            return error(502);
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
            return jsonMidia(url, "file", "PipocaCine");
        } catch (Exception e) { return error(502); }
    }

    // Episódio: tenta a fonte dublada principal e, se ela não tiver este
    // episódio, a segunda opção dublada — sempre dentro do aplicativo.
    private WebResourceResponse directEpisode(String id, String temporada, String episodio) {
        WebResourceResponse principal = directPlayback("https://v2.watchplay.shop/tvshow/" + id + "/" + temporada + "/" + episodio);
        if (principal != null && principal.getStatusCode() == 200) return principal;
        WebResourceResponse dublado = pipocaEpisodio(id, temporada, episodio);
        if (dublado != null && dublado.getStatusCode() == 200) return dublado;
        WebResourceResponse mgeb = mgebEpisodio(id, temporada, episodio);
        if (mgeb != null && mgeb.getStatusCode() == 200) return mgeb;
        // Fichas de fonte descobertas pelo caçador (fornecedores novos).
        WebResourceResponse ficha = perfilPlayback("tv", id, temporada, episodio);
        if (ficha != null && ficha.getStatusCode() == 200) return ficha;
        // Sem dublado: alta definição limpa com legenda em português.
        return vixsrcMidia("tv", id, temporada, episodio);
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

    // Lista as legendas em português do filme (código IMDb, buscado no TMDB).
    private WebResourceResponse legendasOnline(Uri uri) {
        try {
            String imdb = uri.getQueryParameter("imdb") == null ? "" : uri.getQueryParameter("imdb");
            if (!imdb.matches("tt\\d{5,10}")) {
                String id = uri.getQueryParameter("id") == null ? "" : uri.getQueryParameter("id");
                if (id.matches("\\d{1,10}")) {
                    String externo = lerPagina("https://api.themoviedb.org/3/movie/" + id + "/external_ids?api_key=" + chaveTmdb(), null);
                    if (externo != null) {
                        Matcher achado = Pattern.compile("\"imdb_id\"\\s*:\\s*\"(tt\\d{5,10})\"").matcher(externo);
                        if (achado.find()) imdb = achado.group(1);
                    }
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
                if (path != null && path.matches("/api/playback/[0-9]{1,10}")) {
                    String id = path.substring("/api/playback/".length());
                    // Dublado CONFERIDO primeiro: o arquivo do PipocaCine tem a
                    // faixa em português marcada como padrão. A WatchPlay apenas
                    // "avisa" que é dublada e em alguns títulos entrega o idioma
                    // original (caso do "A Luta pela Esperança", medido em
                    // 08/10/2026 por transcrição do áudio) — por isso vem depois.
                    WebResourceResponse dublado = pipocaFilme(id);
                    if (dublado != null && dublado.getStatusCode() == 200) return dublado;
                    WebResourceResponse principal = directPlayback("https://v2.watchplay.shop/movie/" + id);
                    if (principal != null && principal.getStatusCode() == 200) return principal;
                    // A MGEB fica por último entre as dubladas: o catálogo dela é
                    // "latino" e em alguns títulos entrega outro idioma.
                    WebResourceResponse mgeb = mgebFilme(id);
                    if (mgeb != null && mgeb.getStatusCode() == 200) return mgeb;
                    // Fichas de fonte descobertas pelo caçador (fornecedores novos).
                    WebResourceResponse ficha = perfilPlayback("movie", id, null, null);
                    if (ficha != null && ficha.getStatusCode() == 200) return ficha;
                    // Nada dublado? Segunda opção da regra: alta definição
                    // limpa com legenda em português (antes o aparelho ficava
                    // sem nada e o usuário via "nenhuma fonte").
                    return vixsrcMidia("movie", id, null, null);
                }
                if (path != null && path.matches("/api/playback/serie/[0-9]{1,10}/[0-9]{1,3}/[1-9][0-9]{0,3}")) {
                    String[] partes = path.split("/");
                    return directEpisode(partes[4], partes[5], partes[6]);
                }
                // Legendas no aparelho: quando o filme toca com o áudio original,
                // o telefone busca sozinho a legenda em português (sem cadastro).
                if (path != null && "/api/legendas/online".equals(path)) return legendasOnline(uri);
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
                if (!name.matches("(?:index\\.html|assistir\\.html|personal\\.js|library\\.js|auth\\.js|jarvis\\.js|acesso\\.js|legendas\\.js|fontes\\.json|catalog\\.js|android\\.js|config\\.json|playback\\.js|hls\\.min\\.js|vidsrc-source\\.js|listas-tv\\.js|perfis\\.json)")) return error(404);
                try {
                    String mime = name.endsWith(".html") ? "text/html" : name.endsWith(".js") ? "text/javascript" : "application/json";
                    return new WebResourceResponse(mime, "UTF-8", 200, "OK", Collections.singletonMap("Cache-Control", "no-store"), getAssets().open(name));
                } catch (Exception e) { return error(404); }
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (trusted && request.isForMainFrame() && request.hasGesture() && local(uri) && "/check-updates".equals(uri.getPath())) { updater.check(true); return true; }
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
        if (inlineFullscreen) { setInlineFullscreen(false); return; }
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
        if (updater != null) updater.close();
        closePopup(); exitFullscreen(); root.removeView(main); main.destroy(); super.onDestroy();
    }
}
