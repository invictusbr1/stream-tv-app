package br.streamtv.app;

import java.net.URL;
import java.io.InputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import javax.net.ssl.HttpsURLConnection;

/** Transporte HTTPS nativo: não depende de cookies nem de CORS do WebView. */
final class RelatoHttp {
    static String enviar(String endereco, String corpo) throws Exception {
        return enviar(endereco,corpo,10000);
    }
    static String enviar(String endereco, String corpo,int timeout) throws Exception {
        URL url = new URL(endereco);
        if (!"https".equals(url.getProtocol()) || url.getUserInfo() != null
                || (url.getPort() != -1 && url.getPort() != 443)) {
            throw new IllegalArgumentException("Destino HTTPS inválido");
        }
        HttpsURLConnection conexao = (HttpsURLConnection) url.openConnection();
        try {
            conexao.setConnectTimeout(Math.max(1,timeout));
            conexao.setReadTimeout(Math.max(1,timeout));
            conexao.setInstanceFollowRedirects(false);
            conexao.setRequestProperty("Accept", "application/json");
            if (corpo != null) {
                byte[] dados = corpo.getBytes(StandardCharsets.UTF_8);
                conexao.setRequestMethod("POST");
                conexao.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                conexao.setDoOutput(true);
                conexao.setFixedLengthStreamingMode(dados.length);
                try (java.io.OutputStream saida = conexao.getOutputStream()) { saida.write(dados); }
            }
            int status = conexao.getResponseCode();
            if (status < 200 || status >= 300) throw new java.io.IOException("HTTP " + status);
            try (InputStream entrada = conexao.getInputStream(); ByteArrayOutputStream saida = new ByteArrayOutputStream()) {
                byte[] bloco = new byte[4096]; int lidos;
                while ((lidos = entrada.read(bloco)) != -1) {
                    saida.write(bloco, 0, lidos);
                    if (saida.size() > 65536) throw new java.io.IOException("Resposta muito grande");
                }
                return new String(saida.toByteArray(), StandardCharsets.UTF_8);
            }
        } finally { conexao.disconnect(); }
    }
}
