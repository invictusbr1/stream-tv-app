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
    static QualitySelector.Measure read(QualitySelector.Candidate c,long deadline)throws Exception {
        return read(c,deadline,false);
    }
    // O teto AVC só vale quando o aparelho não decodifica HEVC; sem isso a
    // própria medição escondia o 4K e a fonte certa perdia a disputa.
    static QualitySelector.Measure read(QualitySelector.Candidate c,long deadline,boolean allowHevc)throws Exception {
        try{return inspect(c,deadline,allowHevc);}catch(MediaHttp.Unavailable e){return new QualitySelector.Measure(0,0,1,0,false);}
    }
    private static QualitySelector.Measure inspect(QualitySelector.Candidate c,long deadline,boolean allowHevc)throws Exception {
        if("hls".equals(c.type)){
            String text=text(c.url,c.referer,deadline);
            QualitySelector.Measure manifest=QualitySelector.playlist(text,allowHevc);
            if(manifest==null)return null;
            if(manifest.width>0&&manifest.height>0)return manifest;
            if(Pattern.compile("#EXT-X-KEY:.*METHOD=(?!NONE)",Pattern.CASE_INSENSITIVE).matcher(text).find())return manifest;
            for(String raw:text.split("\n")){
                String line=raw.trim();if(line.isEmpty()||line.startsWith("#"))continue;
                URL base=safe(c.url),part=safe(new URL(base,line).toString());
                if(!base.getAuthority().equals(part.getAuthority())||part.getPath().endsWith(".m3u8"))return manifest;
                QualitySelector.Measure measured=file(part.toString(),c.referer,deadline,null,allowHevc);
                return measured==null?manifest:new QualitySelector.Measure(measured.width,measured.height,manifest.language==2?2:measured.language,manifest.bitrate,measured.playable);
            }
            return manifest;
        }
        return file(c.url,c.referer,deadline,c,allowHevc);
    }
    static URL safe(String raw)throws IOException{
        return MediaHttp.safe(raw);
    }
    private static String text(String url,String referer,long deadline)throws IOException{
        HttpURLConnection c=MediaHttp.open(url,referer,null,deadline);
        try{
            MediaHttp.requireMedia(c);
            if(c.getResponseCode()!=200)throw new IOException("Lista indisponível");
            try(InputStream in=c.getInputStream();ByteArrayOutputStream out=new ByteArrayOutputStream()){
                byte[] buffer=new byte[8192];int n;
                while((n=in.read(buffer))!=-1){if(QualitySelector.now()>=deadline||Thread.currentThread().isInterrupted()||out.size()+n>1024*1024)throw new IOException("Limite da lista");out.write(buffer,0,n);}
                return new String(out.toByteArray(),StandardCharsets.UTF_8);
            }
        }finally{c.disconnect();}
    }
    private static BoundedMediaReader.Block block(String[] url,String referer,long position,int count,long deadline)throws IOException{
        HttpURLConnection c=MediaHttp.open(url[0],referer,"bytes="+position+"-"+(position+count-1),deadline);
        try{
            MediaHttp.requireMedia(c);
            url[0]=c.getURL().toString();
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
    private static QualitySelector.Measure file(String url,String referer,long deadline,QualitySelector.Candidate candidate,boolean allowHevc)throws Exception{
        String[] resolved={url};
        BoundedMediaReader reader=new BoundedMediaReader((start,count,end)->block(resolved,referer,start,count,end),deadline);
        MediaDataSource source=new MediaDataSource(){
            @Override public int readAt(long p,byte[] b,int o,int s)throws IOException{return reader.readAt(p,b,o,s);}
            @Override public long getSize()throws IOException{return reader.size();}
            @Override public void close(){reader.close();}
        };
        MediaExtractor extractor=new MediaExtractor();
        try{
            // Verifica status e conteúdo antes da API de mídia, que pode
            // encapsular um 404/HTML em uma exceção genérica de extração.
            reader.size();
            try{
                Mp4Metadata.Result metadata=Mp4Metadata.read(reader);QualitySelector.Measure measured=metadata.measure();
                if(measured!=null){
                    boolean playable=true;MediaCodecList codecs=new MediaCodecList(MediaCodecList.ALL_CODECS);
                    for(Mp4Metadata.Track track:metadata.tracks){
                        if(!track.kind.equals("vide")&&!track.kind.equals("soun"))continue;
                        if(track.mime.isEmpty()){playable=false;break;}
                        if(!allowHevc&&"video/hevc".equals(track.mime)){playable=false;continue;}
                        MediaFormat format=track.kind.equals("vide")?MediaFormat.createVideoFormat(track.mime,track.width,track.height):MediaFormat.createAudioFormat(track.mime,Math.max(1,track.sampleRate),Math.max(1,track.channels));
                        if(codecs.findDecoderForFormat(format)==null)playable=false;
                    }
                    if(candidate!=null)candidate.deliveryUrl=resolved[0];
                    return new QualitySelector.Measure(measured.width,measured.height,measured.language,measured.bitrate,playable);
                }
            }catch(MediaHttp.Unavailable e){throw e;}catch(IOException ignored){ /* Outros contêineres seguem para o leitor do Android. */ }
            extractor.setDataSource(source);int width=0,height=0;boolean pt=false,other=false,ptDefault=false,otherDefault=false,playable=true;long bitrate=0;
            for(int i=0;i<extractor.getTrackCount();i++){
                MediaFormat format=extractor.getTrackFormat(i);String mime=format.getString(MediaFormat.KEY_MIME);
                if(mime!=null&&mime.startsWith("video/")){
                    if(!allowHevc&&"video/hevc".equals(mime))playable=false;
                    width=format.containsKey(MediaFormat.KEY_WIDTH)?format.getInteger(MediaFormat.KEY_WIDTH):0;
                    height=format.containsKey(MediaFormat.KEY_HEIGHT)?format.getInteger(MediaFormat.KEY_HEIGHT):0;
                    bitrate=format.containsKey(MediaFormat.KEY_BIT_RATE)?format.getInteger(MediaFormat.KEY_BIT_RATE):0;
                    if(new MediaCodecList(MediaCodecList.ALL_CODECS).findDecoderForFormat(format)==null)playable=false;
                }
                if(mime!=null&&mime.startsWith("audio/")){
                    if(new MediaCodecList(MediaCodecList.ALL_CODECS).findDecoderForFormat(format)==null)playable=false;
                    String lang=format.containsKey(MediaFormat.KEY_LANGUAGE)?format.getString(MediaFormat.KEY_LANGUAGE):"";
                    boolean defaultTrack=format.containsKey("is-default")&&format.getInteger("is-default")==1;
                    if(QualitySelector.portuguese(lang)){pt=true;ptDefault|=defaultTrack;}
                    else if(lang!=null&&!lang.isEmpty()&&!lang.equals("und")){other=true;otherDefault|=defaultTrack;}
                }
            }
            int language=ptDefault||pt&&!other?2:otherDefault||other&&!pt?-1:1;
            if(candidate!=null&&width>0&&height>0)candidate.deliveryUrl=resolved[0];
            return width>0&&height>0?new QualitySelector.Measure(width,height,language,bitrate,playable):null;
        }finally{extractor.release();source.close();}
    }
}
