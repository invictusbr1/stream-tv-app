package br.streamtv.app;

import android.media.MediaDataSource;
import android.media.MediaExtractor;
import android.media.MediaFormat;
import android.media.MediaCodecList;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.regex.*;
import javax.net.ssl.HttpsURLConnection;

/** Usa o leitor de mídia do Android; nenhuma página ou script é executado. */
final class NativeMediaProbe {
    private static final String UA="Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";
    static QualitySelector.Measure read(QualitySelector.Candidate c,long deadline)throws Exception {
        if("hls".equals(c.type)){
            String text=text(c.url,c.referer,deadline);
            QualitySelector.Measure manifest=QualitySelector.playlist(text);
            if(manifest==null)return null;
            if(manifest.width>0&&manifest.height>0)return manifest;
            if(Pattern.compile("#EXT-X-KEY:.*METHOD=(?!NONE)",Pattern.CASE_INSENSITIVE).matcher(text).find())return manifest;
            for(String raw:text.split("\n")){
                String line=raw.trim();if(line.isEmpty()||line.startsWith("#"))continue;
                URL base=safe(c.url),part=safe(new URL(base,line).toString());
                if(!base.getAuthority().equals(part.getAuthority())||part.getPath().endsWith(".m3u8"))return manifest;
                QualitySelector.Measure measured=file(part.toString(),c.referer,deadline);
                return measured==null?manifest:new QualitySelector.Measure(measured.width,measured.height,manifest.language==2?2:measured.language,manifest.bitrate,measured.playable);
            }
            return manifest;
        }
        return file(c.url,c.referer,deadline);
    }
    static URL safe(String raw)throws IOException{
        URL u=new URL(raw);String h=u.getHost().toLowerCase(java.util.Locale.ROOT);
        if(!u.getProtocol().equals("https")||u.getUserInfo()!=null||(u.getPort()!=-1&&u.getPort()!=443)||h.isEmpty()||h.equals("localhost")||h.endsWith(".local")||h.matches("^(127\\.|10\\.|192\\.168\\.|169\\.254\\.|0\\.).*")||h.matches("^172\\.(1[6-9]|2[0-9]|3[01])\\..*")||h.startsWith("["))throw new IOException("Endereço de mídia inválido");
        return u;
    }
    private static HttpsURLConnection open(String url,String referer,long deadline)throws IOException{
        long left=deadline-QualitySelector.now();if(left<=0||Thread.currentThread().isInterrupted())throw new IOException("Medição encerrada");
        HttpsURLConnection c=(HttpsURLConnection)safe(url).openConnection();
        c.setConnectTimeout((int)Math.min(2000,left));c.setReadTimeout((int)Math.min(2000,left));c.setInstanceFollowRedirects(false);
        c.setRequestProperty("User-Agent",UA);c.setRequestProperty("Accept-Encoding","identity");
        if(referer!=null&&!referer.isEmpty()&&!referer.contains("\r")&&!referer.contains("\n"))c.setRequestProperty("Referer",referer);
        return c;
    }
    private static String text(String url,String referer,long deadline)throws IOException{
        HttpsURLConnection c=open(url,referer,deadline);
        try{
            if(c.getResponseCode()!=200)throw new IOException("Lista indisponível");
            try(InputStream in=c.getInputStream();ByteArrayOutputStream out=new ByteArrayOutputStream()){
                byte[] buffer=new byte[8192];int n;
                while((n=in.read(buffer))!=-1){if(QualitySelector.now()>=deadline||Thread.currentThread().isInterrupted()||out.size()+n>1024*1024)throw new IOException("Limite da lista");out.write(buffer,0,n);}
                return new String(out.toByteArray(),StandardCharsets.UTF_8);
            }
        }finally{c.disconnect();}
    }
    private static BoundedMediaReader.Block block(String url,String referer,long position,int count,long deadline)throws IOException{
        HttpsURLConnection c=open(url,referer,deadline);c.setRequestProperty("Range","bytes="+position+"-"+(position+count-1));
        try{
            int status=c.getResponseCode();long total=-1,start=0;
            String range=c.getHeaderField("Content-Range");
            if(status==206){Matcher m=Pattern.compile("bytes (\\d+)-(\\d+)/(\\d+)").matcher(range==null?"":range);if(!m.matches())throw new IOException("Faixa não identificada");start=Long.parseLong(m.group(1));total=Long.parseLong(m.group(3));}
            else if(status==200&&position==0){try{total=Long.parseLong(c.getHeaderField("Content-Length"));}catch(Exception ignored){}}
            else throw new IOException("Faixa indisponível");
            String mime=c.getContentType();if(mime!=null&&mime.matches("(?is).*(text/html|application/json|text/xml).*"))throw new IOException("Não é mídia");
            try(InputStream in=c.getInputStream();ByteArrayOutputStream out=new ByteArrayOutputStream()){
                byte[] buffer=new byte[Math.min(count,8192)];int n;
                while(out.size()<count&&(n=in.read(buffer,0,Math.min(buffer.length,count-out.size())))!=-1){if(QualitySelector.now()>=deadline||Thread.currentThread().isInterrupted())throw new IOException("Medição encerrada");out.write(buffer,0,n);}
                return new BoundedMediaReader.Block(status,start,total,out.toByteArray(),mime);
            }
        }finally{c.disconnect();}
    }
    private static QualitySelector.Measure file(String url,String referer,long deadline)throws Exception{
        BoundedMediaReader reader=new BoundedMediaReader((start,count,end)->block(url,referer,start,count,end),deadline);
        MediaDataSource source=new MediaDataSource(){
            @Override public int readAt(long p,byte[] b,int o,int s)throws IOException{return reader.readAt(p,b,o,s);}
            @Override public long getSize()throws IOException{return reader.size();}
            @Override public void close(){reader.close();}
        };
        MediaExtractor extractor=new MediaExtractor();
        try{
            extractor.setDataSource(source);int width=0,height=0;boolean pt=false,other=false,ptDefault=false,otherDefault=false,playable=true;long bitrate=0;
            for(int i=0;i<extractor.getTrackCount();i++){
                MediaFormat format=extractor.getTrackFormat(i);String mime=format.getString(MediaFormat.KEY_MIME);
                if(mime!=null&&mime.startsWith("video/")){
                    width=format.containsKey(MediaFormat.KEY_WIDTH)?format.getInteger(MediaFormat.KEY_WIDTH):0;
                    height=format.containsKey(MediaFormat.KEY_HEIGHT)?format.getInteger(MediaFormat.KEY_HEIGHT):0;
                    bitrate=format.containsKey(MediaFormat.KEY_BIT_RATE)?format.getInteger(MediaFormat.KEY_BIT_RATE):0;
                    if(new MediaCodecList(MediaCodecList.ALL_CODECS).findDecoderForFormat(format)==null)playable=false;
                }
                if(mime!=null&&mime.startsWith("audio/")){
                    String lang=format.containsKey(MediaFormat.KEY_LANGUAGE)?format.getString(MediaFormat.KEY_LANGUAGE):"";
                    boolean defaultTrack=format.containsKey("is-default")&&format.getInteger("is-default")==1;
                    if(QualitySelector.portuguese(lang)){pt=true;ptDefault|=defaultTrack;}
                    else if(lang!=null&&!lang.isEmpty()&&!lang.equals("und")){other=true;otherDefault|=defaultTrack;}
                }
            }
            int language=ptDefault||pt&&!other?2:otherDefault||other&&!pt?-1:1;
            return width>0&&height>0?new QualitySelector.Measure(width,height,language,bitrate,playable):null;
        }finally{extractor.release();source.close();}
    }
}
