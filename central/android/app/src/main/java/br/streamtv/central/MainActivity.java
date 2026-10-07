package br.streamtv.central;

// Aplicativo da Central do Conecta TV.
//
// Ele é só a janela do painel: guarda o endereço da central e a chave (uma vez,
// no primeiro uso), entra com elas e mostra o painel em tela cheia. Também
// avisa quando a central não responde e deixa tentar de novo.

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

public final class MainActivity extends Activity {
    private static final String PREFERENCIAS = "central";
    private static final String CHAVE_COOKIE = "central_chave";

    private SharedPreferences preferencias;
    private FrameLayout raiz;
    private WebView painel;
    private LinearLayout barra;
    private TextView enderecoAtual;
    private LinearLayout configuracao;

    @Override public void onCreate(Bundle estado) {
        super.onCreate(estado);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        preferencias = getSharedPreferences(PREFERENCIAS, MODE_PRIVATE);
        raiz = new FrameLayout(this);
        raiz.setBackgroundColor(Color.parseColor("#0B0E15"));
        setContentView(raiz);
        montarPainel();
        if (!pronto()) mostrarConfiguracao(); else abrirPainel();
    }

    private boolean pronto() {
        return !endereco().isEmpty() && !chave().isEmpty();
    }
    private String endereco() { return preferencias.getString("endereco", "").trim().replaceAll("/+$", ""); }
    private String chave() { return preferencias.getString("chave", "").trim(); }

    @SuppressLint("SetJavaScriptEnabled")
    private void montarPainel() {
        LinearLayout coluna = new LinearLayout(this);
        coluna.setOrientation(LinearLayout.VERTICAL);
        coluna.setBackgroundColor(Color.parseColor("#0B0E15"));

        barra = new LinearLayout(this);
        barra.setOrientation(LinearLayout.HORIZONTAL);
        barra.setGravity(Gravity.CENTER_VERTICAL);
        barra.setBackgroundColor(Color.parseColor("#111725"));
        barra.setPadding(28, 14, 28, 14);

        TextView titulo = new TextView(this);
        titulo.setText("Central Conecta TV");
        titulo.setTextColor(Color.parseColor("#E8ECF3"));
        titulo.setTextSize(17);
        titulo.setTypeface(null, android.graphics.Typeface.BOLD);
        barra.addView(titulo);

        enderecoAtual = new TextView(this);
        enderecoAtual.setTextColor(Color.parseColor("#8D97A8"));
        enderecoAtual.setTextSize(12);
        enderecoAtual.setPadding(20, 0, 0, 0);
        barra.addView(enderecoAtual, new LinearLayout.LayoutParams(0, -2, 1f));

        Button atualizar = new Button(this);
        atualizar.setText("Atualizar");
        atualizar.setOnClickListener(v -> { if (painel != null) painel.reload(); });
        barra.addView(atualizar);

        Button configurar = new Button(this);
        configurar.setText("Configurar");
        configurar.setOnClickListener(v -> mostrarConfiguracao());
        barra.addView(configurar);

        coluna.addView(barra, new LinearLayout.LayoutParams(-1, -2));

        painel = new WebView(this);
        WebSettings ajustes = painel.getSettings();
        ajustes.setJavaScriptEnabled(true);
        ajustes.setDomStorageEnabled(true);
        ajustes.setLoadWithOverviewMode(true);
        ajustes.setUseWideViewPort(true);
        ajustes.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(painel, true);
        painel.setBackgroundColor(Color.parseColor("#0B0E15"));
        painel.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest pedido) {
                // O painel é local à central: links de fora abrem no navegador do aparelho.
                Uri destino = pedido.getUrl();
                String base = endereco();
                if (base.isEmpty() || destino == null) return true;
                try {
                    String alvo = new Uri.Builder().scheme("https").authority(Uri.parse(base).getAuthority()).build().toString();
                    if (destino.toString().startsWith(alvo) || destino.toString().startsWith(base)) return false;
                } catch (Exception ignorado) { /* endereço torto: segue para fora */ }
                try { startActivity(new android.content.Intent(android.content.Intent.ACTION_VIEW, destino)); } catch (Exception ignorado) { /* sem navegador */ }
                return true;
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest pedido, WebResourceError erro) {
                if (pedido.isForMainFrame()) mostrarAviso("Não consegui falar com a central. Confira se o servidor está ligado e se o endereço está certo.");
            }
        });
        coluna.addView(painel, new LinearLayout.LayoutParams(-1, 0, 1f));
        raiz.addView(coluna, new FrameLayout.LayoutParams(-1, -1));
    }

    private void abrirPainel() {
        if (configuracao != null) { raiz.removeView(configuracao); configuracao = null; }
        String base = endereco();
        Uri alvo = Uri.parse(base);
        // O painel pede a chave; aqui ela entra como crachá do aparelho.
        CookieManager.getInstance().setCookie(base + "/", CHAVE_COOKIE + "=" + chave() + "; Path=/");
        if (alvo.getScheme() != null && alvo.getScheme().equals("http")) {
            CookieManager.getInstance().setCookie("http://" + alvo.getAuthority() + "/", CHAVE_COOKIE + "=" + chave() + "; Path=/");
        }
        String mostrado = alvo.getAuthority() == null ? base : alvo.getAuthority();
        enderecoAtual.setText(mostrado);
        painel.loadUrl(base + "/");
    }

    // ------------------------------------------------------------ configuração
    private void mostrarConfiguracao() {
        if (configuracao != null) { configuracao.setVisibility(View.VISIBLE); return; }
        configuracao = new LinearLayout(this);
        configuracao.setOrientation(LinearLayout.VERTICAL);
        configuracao.setBackgroundColor(Color.parseColor("#0B0E15"));
        configuracao.setPadding(60, 80, 60, 60);

        TextView titulo = new TextView(this);
        titulo.setText("Central do Conecta TV");
        titulo.setTextColor(Color.parseColor("#E8ECF3"));
        titulo.setTextSize(24);
        titulo.setTypeface(null, android.graphics.Typeface.BOLD);
        configuracao.addView(titulo);

        TextView ajuda = new TextView(this);
        ajuda.setText("Informe o endereço onde a central está rodando e a chave do painel. Fica guardado neste aparelho: você só precisa preencher uma vez.");
        ajuda.setTextColor(Color.parseColor("#8D97A8"));
        ajuda.setTextSize(14);
        ajuda.setPadding(0, 12, 0, 28);
        configuracao.addView(ajuda);

        configuracao.addView(rotulo("Endereço da central"));
        EditText campoEndereco = campo(endereco(), "http://192.168.1.6:4100", InputType.TYPE_TEXT_VARIATION_URI);
        configuracao.addView(campoEndereco);

        configuracao.addView(rotulo("Chave do painel"));
        EditText campoChave = campo(chave(), "a chave que você configurou", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        configuracao.addView(campoChave);

        Button salvar = new Button(this);
        salvar.setText("Salvar e abrir o painel");
        salvar.setBackgroundColor(Color.parseColor("#E50914"));
        salvar.setTextColor(Color.WHITE);
        salvar.setTextSize(16);
        LinearLayout.LayoutParams parametros = new LinearLayout.LayoutParams(-1, -2);
        parametros.topMargin = 30;
        salvar.setOnClickListener(v -> {
            String novoEndereco = campoEndereco.getText().toString().trim().replaceAll("/+$", "");
            String novaChave = campoChave.getText().toString().trim();
            if (novoEndereco.isEmpty()) { avisoRapido("Informe o endereço da central."); return; }
            if (!novoEndereco.startsWith("http")) novoEndereco = "http://" + novoEndereco;
            if (novaChave.length() < 8) { avisoRapido("A chave precisa de pelo menos 8 caracteres."); return; }
            preferencias.edit().putString("endereco", novoEndereco).putString("chave", novaChave).apply();
            abrirPainel();
        });
        configuracao.addView(salvar, parametros);

        TextView nota = new TextView(this);
        nota.setText("Dica: no computador que roda a central, o endereço aparece quando você executa “node central/servidor.js”. Use o endereço da rede (192.168...) para o celular achar o servidor.");
        nota.setTextColor(Color.parseColor("#5F6879"));
        nota.setTextSize(12);
        nota.setPadding(0, 22, 0, 0);
        configuracao.addView(nota);

        raiz.addView(configuracao, new FrameLayout.LayoutParams(-1, -1));
    }

    private TextView rotulo(String texto) {
        TextView vista = new TextView(this);
        vista.setText(texto);
        vista.setTextColor(Color.parseColor("#9AA4B4"));
        vista.setTextSize(12);
        vista.setPadding(0, 18, 0, 6);
        return vista;
    }

    private EditText campo(String valor, String dica, int tipo) {
        EditText campo = new EditText(this);
        campo.setText(valor);
        campo.setHint(dica);
        campo.setInputType(tipo);
        campo.setSingleLine(true);
        campo.setTextColor(Color.parseColor("#E8ECF3"));
        campo.setHintTextColor(Color.parseColor("#5F6879"));
        return campo;
    }

    private void mostrarAviso(String mensagem) {
        avisoRapido(mensagem);
    }
    private void avisoRapido(String mensagem) {
        Toast.makeText(this, mensagem, Toast.LENGTH_LONG).show();
    }

    @Override public void onBackPressed() {
        if (configuracao != null && configuracao.getVisibility() == View.VISIBLE && pronto()) {
            configuracao.setVisibility(View.GONE);
            return;
        }
        if (painel != null && painel.canGoBack()) { painel.goBack(); return; }
        super.onBackPressed();
    }
}
