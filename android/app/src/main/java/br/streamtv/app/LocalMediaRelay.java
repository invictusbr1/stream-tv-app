package br.streamtv.app;

import java.io.*;
import java.net.*;
import java.util.*;

/**
 * Encaminhador de vídeo DENTRO do aparelho.
 *
 * Arquivos com proteção de origem (FenixFlix, FrostStream, Kairou) recusam o
 * pedido sem Referer, e o <video> do WebView não manda Referer. Antes, esses
 * arquivos — inclusive o 4K de 7 GB — passavam pela Oracle, que tem só ~40 Mbps
 * e travava com duas pessoas assistindo. Aqui o próprio celular pede o vídeo ao
 * fornecedor com o Referer certo e entrega ao player: a Oracle não gasta banda.
 *
 * O vídeo é transmitido em pedaços (Range), nunca acumulado na memória.
 */
final class LocalMediaRelay {
    static final String PATH="/api/midia-local";
    private static final int IO_TIMEOUT=30000;
    private static final long REDIRECT_TTL=10*60*1000L;
    private final MediaHttp.Connector connector;
    // O endereço publicado (ex.: /r/<código>) redireciona para o CDN. Cada salto
    // do player (avançar/voltar) refaria essa cadeia; o destino fica guardado.
    private final Map<String,String[]> destinos=new LinkedHashMap<String,String[]>(16,0.75f,true){
        @Override protected boolean removeEldestEntry(Map.Entry<String,String[]> e){return size()>48;}
    };

    LocalMediaRelay(){this(u->(HttpURLConnection)u.openConnection());}
    LocalMediaRelay(MediaHttp.Connector connector){this.connector=connector;}

    /** Endereço local (mesma origem do WebView) para o arquivo com o Referer exigido. */
    static String local(String url,String referer)throws IOException{
        MediaHttp.safe(url);
        String ref=referer==null?"":referer;
        if(ref.contains("\r")||ref.contains("\n"))throw new IOException("Referer inválido");
        return PATH+"?u="+URLEncoder.encode(url,"UTF-8")+"&r="+URLEncoder.encode(ref,"UTF-8");
    }

    static final class Response {
        final int status;final String reason;final String mime;final Map<String,String> headers;final InputStream body;
        Response(int status,String mime,Map<String,String> headers,InputStream body){this.status=status;this.reason=status==206?"Partial Content":"OK";this.mime=mime;this.headers=headers;this.body=body;}
    }

    static boolean validRange(String range){return range!=null&&range.matches("bytes=([0-9]{1,15}-[0-9]{0,15}|-[0-9]{1,15})");}

    Response open(String url,String referer,String range)throws IOException{
        MediaHttp.safe(url);
        String pedido=validRange(range)?range:null;
        String[] guardado;synchronized(destinos){guardado=destinos.get(url);}
        HttpURLConnection c=null;
        if(guardado!=null&&Long.parseLong(guardado[1])>QualitySelector.now()){
            try{c=MediaHttp.open(guardado[0],referer,pedido,QualitySelector.now()+15000,connector,IO_TIMEOUT);if(!aceitavel(c)){c.disconnect();c=null;}}
            catch(IOException expirado){c=null;}
            if(c==null)synchronized(destinos){destinos.remove(url);}
        }
        if(c==null){
            c=MediaHttp.open(url,referer,pedido,QualitySelector.now()+15000,connector,IO_TIMEOUT);
            if(!aceitavel(c)){int s=c.getResponseCode();c.disconnect();throw new MediaHttp.Unavailable(s);}
            String destino=c.getURL().toString();
            if(!destino.equals(url))synchronized(destinos){destinos.put(url,new String[]{destino,String.valueOf(QualitySelector.now()+REDIRECT_TTL)});}
        }
        final HttpURLConnection conexao=c;
        try{
            int status=conexao.getResponseCode();
            String mime=conexao.getContentType()==null?"video/mp4":conexao.getContentType().split(";")[0].trim();
            if(mime.isEmpty()||mime.equalsIgnoreCase("application/octet-stream")||mime.equalsIgnoreCase("binary/octet-stream"))mime=mimeDoEndereco(conexao.getURL().getPath());
            Map<String,String> headers=new HashMap<>();
            headers.put("Cache-Control","no-store");
            headers.put("Accept-Ranges","bytes");
            for(String name:Arrays.asList("Content-Range","Content-Length")){String v=conexao.getHeaderField(name);if(v!=null&&!v.contains("\r")&&!v.contains("\n"))headers.put(name,v);}
            InputStream body=new FilterInputStream(conexao.getInputStream()){
                @Override public void close()throws IOException{try{super.close();}finally{conexao.disconnect();}}
            };
            return new Response(status,mime,headers,body);
        }catch(IOException|RuntimeException e){conexao.disconnect();throw e;}
    }

    private static boolean aceitavel(HttpURLConnection c)throws IOException{
        int status=c.getResponseCode();String mime=c.getContentType();
        return (status==200||status==206)&&(mime==null||!mime.matches("(?is).*(text/html|application/json|text/xml|text/plain).*"));
    }

    static String mimeDoEndereco(String path){
        String p=path==null?"":path.toLowerCase(Locale.ROOT);
        if(p.endsWith(".mkv"))return "video/x-matroska";
        if(p.endsWith(".webm"))return "video/webm";
        if(p.endsWith(".ts"))return "video/mp2t";
        return "video/mp4";
    }
}
