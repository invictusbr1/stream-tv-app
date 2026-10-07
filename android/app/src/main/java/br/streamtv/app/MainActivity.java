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
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.URL;
import javax.net.ssl.HttpsURLConnection;
import java.nio.charset.StandardCharsets;
import java.util.regex.Pattern;
import java.util.regex.Matcher;
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
        main.loadUrl(HOME);
        updater = new AppUpdater(this);
        main.postDelayed(() -> { if (!isFinishing() && !isDestroyed()) updater.check(false); }, 4000);
        if (Build.VERSION.SDK_INT >= 33) getOnBackInvokedDispatcher().registerOnBackInvokedCallback(0, this::back);
    }

    private boolean local(Uri uri) {
        return "https".equals(uri.getScheme()) && HOST.equals(uri.getHost()) && uri.getPort() == -1 && uri.getUserInfo() == null;
    }

    private WebResourceResponse error(int code) {
        return new WebResourceResponse("text/plain", "UTF-8", code, "Unavailable", Collections.emptyMap(), new ByteArrayInputStream("Página indisponível".getBytes(java.nio.charset.StandardCharsets.UTF_8)));
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
        try {
            JSONObject result = new JSONObject();
            result.put("url", url); result.put("audio", "pt-BR"); result.put("type", tipo); result.put("source", fonte);
            return new WebResourceResponse("application/json", "UTF-8", 200, "OK", Collections.singletonMap("Cache-Control", "no-store"), new ByteArrayInputStream(result.toString().getBytes(StandardCharsets.UTF_8)));
        } catch (Exception e) { return error(502); }
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

    // Segunda opção dublada: o episódio que o PipocaCine publica em arquivo MP4
    // (720p, áudio em português). Lido da página da série, sem abrir nada.
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
        return pipocaEpisodio(id, temporada, episodio);
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
                if (path != null && path.matches("/api/playback/[0-9]{1,10}")) return directPlayback("https://v2.watchplay.shop/movie/" + path.substring("/api/playback/".length()));
                if (path != null && path.matches("/api/playback/serie/[0-9]{1,10}/[0-9]{1,3}/[1-9][0-9]{0,3}")) {
                    String[] partes = path.split("/");
                    return directEpisode(partes[4], partes[5], partes[6]);
                }
                String name = "/".equals(path) ? "index.html" : path.substring(1);
                // Only the bundled public assets can be served; no arbitrary file paths.
                if (!name.matches("(?:index\\.html|assistir\\.html|personal\\.js|library\\.js|auth\\.js|jarvis\\.js|acesso\\.js|legendas\\.js|fontes\\.json|catalog\\.js|android\\.js|config\\.json|playback\\.js|hls\\.min\\.js|vidsrc-source\\.js)")) return error(404);
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
