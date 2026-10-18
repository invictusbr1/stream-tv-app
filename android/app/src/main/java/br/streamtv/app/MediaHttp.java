package br.streamtv.app;

import java.io.IOException;
import java.net.*;
import java.util.*;

/** Segue somente endereços de mídia HTTPS, conservando Range e o prazo. */
final class MediaHttp {
    static final class Unavailable extends IOException { Unavailable(){super("O destino não entrega mídia");} }
    interface Connector { HttpURLConnection open(URL url)throws IOException; }
    private static final String UA="Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";
    static URL safe(String raw)throws IOException {
        URL u=new URL(raw);String h=u.getHost().toLowerCase(Locale.ROOT);
        if(!u.getProtocol().equals("https")||u.getUserInfo()!=null||(u.getPort()!=-1&&u.getPort()!=443)||h.isEmpty()||h.equals("localhost")||h.endsWith(".local")||h.matches("^(127\\.|10\\.|192\\.168\\.|169\\.254\\.|0\\.).*")||h.matches("^172\\.(1[6-9]|2[0-9]|3[01])\\..*")||h.startsWith("["))throw new IOException("Endereço de mídia inválido");
        return u;
    }
    static HttpURLConnection open(String raw,String referer,String range,long deadline)throws IOException {
        return open(raw,referer,range,deadline,u->(HttpURLConnection)u.openConnection());
    }
    static void requireMedia(HttpURLConnection c)throws IOException {
        int status=c.getResponseCode();String mime=c.getContentType();
        if(status<200||status>=300||mime!=null&&mime.matches("(?is).*(text/html|application/json|text/xml).*"))throw new Unavailable();
    }
    // Provedor que exige a própria origem recusa o referer de outro site com
    // 403 cross_site (o Zunder faz isso). O mesmo pedido sem Referer passa;
    // tentamos uma vez, e só quando o referer é de outro domínio.
    private static boolean mesmaOrigem(String referer,URL url){
        try{
            String ref=new URL(referer).getHost().toLowerCase(Locale.ROOT),alvo=url.getHost().toLowerCase(Locale.ROOT);
            return ref.equals(alvo)||alvo.endsWith("."+ref)||ref.endsWith("."+alvo);
        }catch(Exception e){return true;}
    }
    static HttpURLConnection open(String raw,String referer,String range,long deadline,Connector connector)throws IOException {
        URL url=safe(raw);Set<String> seen=new HashSet<>();
        for(int redirects=0;;redirects++){
            long left=deadline-QualitySelector.now();
            if(left<=0||Thread.currentThread().isInterrupted()||!seen.add(url.toString()))throw new IOException("Medição encerrada ou redirecionamento circular");
            String ref=referer;boolean semReferer=false;
            for(;;){
                long restante=deadline-QualitySelector.now();
                if(restante<=0||Thread.currentThread().isInterrupted())throw new IOException("Medição encerrada ou redirecionamento circular");
                HttpURLConnection c=connector.open(url);
                boolean redirecionou=false;
                try{
                    c.setConnectTimeout((int)Math.min(3000,restante));c.setReadTimeout((int)Math.min(3000,restante));c.setInstanceFollowRedirects(false);
                    c.setRequestProperty("User-Agent",UA);c.setRequestProperty("Accept","*/*");c.setRequestProperty("Accept-Encoding","identity");
                    if(range!=null)c.setRequestProperty("Range",range);
                    if(ref!=null&&!ref.isEmpty()&&!ref.contains("\r")&&!ref.contains("\n"))c.setRequestProperty("Referer",ref);
                    int status=c.getResponseCode();
                    if((status==401||status==403)&&!semReferer&&ref!=null&&!ref.isEmpty()&&!mesmaOrigem(ref,url)){
                        semReferer=true;ref="";
                        c.disconnect();
                        continue;
                    }
                    if(status!=301&&status!=302&&status!=303&&status!=307&&status!=308)return c;
                    if(redirects>=5)throw new IOException("Limite de redirecionamentos");
                    String location=c.getHeaderField("Location");if(location==null||location.isEmpty())throw new IOException("Destino ausente");
                    // O fornecedor também publica Location com http. O app usa a
                    // versão HTTPS desse mesmo endereço; nunca habilita tráfego claro.
                    String next=new URL(url,location).toString();if(next.startsWith("http://"))next="https://"+next.substring(7);
                    url=safe(next);
                    redirecionou=true;
                }catch(IOException|RuntimeException e){c.disconnect();throw e;}
                if(redirecionou){c.disconnect();break;}
            }
        }
    }
}
