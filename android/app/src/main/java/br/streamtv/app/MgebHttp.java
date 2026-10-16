package br.streamtv.app;
import java.net.URL;
import java.io.*;
import java.nio.charset.StandardCharsets;
import javax.net.ssl.HttpsURLConnection;

final class MgebHttp {
    static URL safe(String raw) throws IOException {
        URL url = new URL(raw);
        String host = url.getHost().toLowerCase(java.util.Locale.ROOT);
        if (!"https".equals(url.getProtocol()) || url.getUserInfo() != null
            || (url.getPort() != -1 && url.getPort() != 443)
            || !("mgeb.top".equals(host) || "mgeb.site".equals(host))) throw new IOException("unsupported provider address");
        return url;
    }
    static String read(String raw) throws IOException {
        URL url = safe(raw);
        for (int attempt=0; attempt<5; attempt++) {
            HttpsURLConnection c=(HttpsURLConnection)url.openConnection();
            try {
                c.setConnectTimeout(10000); c.setReadTimeout(10000); c.setInstanceFollowRedirects(false);
                c.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36");
                c.setRequestProperty("Accept-Language", "pt-BR,pt;q=0.9"); c.setRequestProperty("Referer", "https://mgeb.top/");
                int status=c.getResponseCode();
                if (status==301 || status==302 || status==303 || status==307 || status==308) {
                    String location=c.getHeaderField("Location");
                    if (location==null) throw new IOException("missing provider redirect");
                    url=safe(new URL(url,location).toString()); continue;
                }
                if (status!=200) throw new IOException("provider HTTP "+status);
                try(InputStream in=c.getInputStream();ByteArrayOutputStream out=new ByteArrayOutputStream()) {
                    byte[] block=new byte[8192];int n;
                    while((n=in.read(block))!=-1){if(out.size()+n>4*1024*1024)throw new IOException("provider page too large");out.write(block,0,n);}
                    return new String(out.toByteArray(),StandardCharsets.UTF_8);
                }
            } finally {c.disconnect();}
        }
        throw new IOException("too many provider redirects");
    }
}
