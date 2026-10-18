package br.streamtv.app;
import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;
import java.io.IOException;
import java.net.*;

public final class QualitySelectorTest {
    private static byte[] box(String name,byte[]...parts)throws Exception{
        int length=8;for(byte[] p:parts)length+=p.length;
        java.nio.ByteBuffer b=java.nio.ByteBuffer.allocate(length);b.putInt(length).put(name.getBytes("US-ASCII"));for(byte[] p:parts)b.put(p);return b.array();
    }
    private static byte[] track(String kind,String codec,int w,int h,byte[] table)throws Exception{
        byte[] header=new byte[84];header[3]=1;java.nio.ByteBuffer.wrap(header).putInt(76,w<<16).putInt(80,h<<16);
        byte[] handler=new byte[12];System.arraycopy(kind.getBytes("US-ASCII"),0,handler,8,4);
        byte[] mdhd=new byte[24];int por=(16<<10)|(15<<5)|18;java.nio.ByteBuffer.wrap(mdhd).putShort(20,(short)por);
        byte[] entry=new byte[kind.equals("vide")?78:28];
        if(kind.equals("vide"))java.nio.ByteBuffer.wrap(entry).putShort(24,(short)w).putShort(26,(short)h);
        else java.nio.ByteBuffer.wrap(entry).putShort(16,(short)2).putInt(24,48000<<16);
        byte[] count=new byte[8];count[7]=1;
        return box("trak",box("tkhd",header),box("mdia",box("mdhd",mdhd),box("hdlr",handler),box("minf",box("stbl",box("stsd",count,box(codec,entry)),table))));
    }
    private static void check(boolean ok){if(!ok)throw new AssertionError();}
    private static QualitySelector.Candidate candidate(String id){return new QualitySelector.Candidate(id,"https://media.invalid/"+id+".mp4","https://media.invalid/","file","{}",0);}
    private static QualitySelector.Measure measure(int w,int h,int lang){return new QualitySelector.Measure(w,h,lang,0,true);}
    public static void main(String[] args)throws Exception{
        switch(args[0]){
        case "history":{
            java.io.File file=java.io.File.createTempFile("conecta-history-",".bin");
            try{
                VerifiedMediaStore first=new VerifiedMediaStore(file);
                QualitySelector.Candidate old=candidate("fenix");old.measure=measure(3832,1600,2);
                first.save("movie:969681",Arrays.asList(old));
                VerifiedMediaStore restart=new VerifiedMediaStore(file);
                check(restart.load("movie:969681",Collections.singleton("fenix")).size()==1);
                check(restart.load("movie:1",Collections.singleton("fenix")).isEmpty());
                check(restart.load("movie:969681",Collections.singleton("disabled")).isEmpty());
                List<QualitySelector.Source> current=Arrays.asList(d->candidate("current"));
                try(QualitySelector selector=new QualitySelector(restart)){
                    AtomicInteger probes=new AtomicInteger();
                    QualitySelector.Probe probe=(c,d)->{probes.incrementAndGet();return measure(c.id.equals("fenix")?3832:1920,c.id.equals("fenix")?1600:800,2);};
                    QualitySelector.Candidate winner=selector.choose("one",current,Collections.emptySet(),probe,2000,"movie:969681",new HashSet<>(Arrays.asList("fenix","current")));
                    check(winner.id.equals("fenix")&&winner.measure.width==3832);int before=probes.get();
                    winner=selector.choose("one",current,Collections.emptySet(),(c,d)->c.id.equals("fenix")?measure(3832,1600,-1):measure(1920,800,2),2000,"movie:969681",new HashSet<>(Arrays.asList("fenix","current")));
                    check(winner.id.equals("current"));
                    check(new VerifiedMediaStore(file).load("movie:969681",Collections.singleton("fenix")).isEmpty());
                    check(before>=2);
                }
                first.save("tv:1:1:1",Arrays.asList(old));
                check(first.load("tv:1:1:2",Collections.singleton("fenix")).isEmpty());
                try(QualitySelector selector=new QualitySelector(first)){
                    QualitySelector.Candidate winner=selector.choose("unknown",current,Collections.emptySet(),(c,d)->c.id.equals("fenix")?null:measure(1920,800,2),2000,"tv:1:1:1",new HashSet<>(Arrays.asList("fenix","current")));
                    check(winner.id.equals("current"));
                }
            }finally{file.delete();}break;
        }
        case "mp4":{
            byte[] data=box("moov",track("vide","avc1",3832,1600,box("stsz",new byte[9*1024*1024])),track("soun","mp4a",0,0,new byte[0]));
            AtomicInteger transferred=new AtomicInteger();
            try(BoundedMediaReader reader=new BoundedMediaReader((p,n,end)->{transferred.addAndGet(n);return new BoundedMediaReader.Block(206,p,data.length,Arrays.copyOfRange(data,(int)p,(int)p+n),"video/mp4");},QualitySelector.now()+2000)){
                Mp4Metadata.Result metadata=Mp4Metadata.read(reader);QualitySelector.Measure m=metadata.measure();check(m.width==3832&&m.height==1600&&m.language==2);check(metadata.tracks.size()==2);check(metadata.tracks.get(0).mime.equals("video/avc"));check(metadata.tracks.get(1).mime.equals("audio/mp4a-latm"));check(transferred.get()<200000);
            }
            byte[] invalid={0,0,0,7,'m','o','o','v'};
            try(BoundedMediaReader reader=new BoundedMediaReader((p,n,end)->new BoundedMediaReader.Block(206,p,invalid.length,Arrays.copyOfRange(invalid,(int)p,(int)p+n),"video/mp4"),QualitySelector.now()+1000)){
                try{Mp4Metadata.read(reader);throw new AssertionError("tamanho inválido aceito");}catch(IOException expected){}
            }break;
        }
        case "redirects":{
            List<HttpURLConnection> opened=new ArrayList<>();
            MediaHttp.Connector connector=url->{
                final int i=opened.size();HttpURLConnection c=new HttpURLConnection(url){
                    public void disconnect(){} public boolean usingProxy(){return false;} public void connect(){}
                    public int getResponseCode(){return i==0?307:i==1?302:206;}
                    public String getHeaderField(String name){return "Location".equals(name)?i==0?"http://cdn.invalid/media.mp4":i==1?"/final.mp4":null:null;}
                    public String getContentType(){return i<2?"text/html":"video/mp4";}
                };opened.add(c);return c;
            };
            HttpURLConnection finalResponse=MediaHttp.open("https://addon.invalid/r/video.mp4","https://addon.invalid/","bytes=9000-9100",QualitySelector.now()+1000,connector);
            MediaHttp.requireMedia(finalResponse);check(opened.size()==3);check(finalResponse.getURL().toString().equals("https://cdn.invalid/final.mp4"));
            for(HttpURLConnection c:opened){check(c.getURL().getProtocol().equals("https"));check(c.getRequestProperty("Range").equals("bytes=9000-9100"));check(c.getRequestProperty("Referer").equals("https://addon.invalid/"));check(!c.getInstanceFollowRedirects());}
            for(String target:Arrays.asList("https://127.0.0.1/a","https://192.168.1.2/a","https://user:password@cdn.invalid/a","https://cdn.invalid:8080/a","https://addon.invalid/a")){
                try{MediaHttp.open("https://addon.invalid/a","","bytes=0-1",QualitySelector.now()+1000,url->new HttpURLConnection(url){public void disconnect(){}public boolean usingProxy(){return false;}public void connect(){}public int getResponseCode(){return 302;}public String getHeaderField(String name){return target;}});throw new AssertionError("destino ou ciclo aceito");}catch(IOException expected){}
            }
            HttpURLConnection html=new HttpURLConnection(new URL("https://cdn.invalid/a")){public void disconnect(){}public boolean usingProxy(){return false;}public void connect(){}public int getResponseCode(){return 404;}public String getContentType(){return "application/json";}};
            try{MediaHttp.requireMedia(html);throw new AssertionError("404 aceito");}catch(MediaHttp.Unavailable expected){}
            try{MediaHttp.open("https://addon.invalid/a","",null,QualitySelector.now()-1,url->{throw new AssertionError("abriu fora do prazo");});throw new AssertionError();}catch(IOException expected){}
            break;
        }
        case "batch":{
            try(QualitySelector s=new QualitySelector()){
                AtomicInteger queries=new AtomicInteger();
                QualitySelector.Source addon=new QualitySelector.Source(){
                    public QualitySelector.Candidate resolve(long end){throw new AssertionError("usou só streams[0]");}
                    public List<QualitySelector.Candidate> resolveAll(long end){queries.incrementAndGet();return Arrays.asList(candidate("broken-4k"),candidate("good-fhd"),candidate("foreign-4k"));}
                };
                List<QualitySelector.Source> sources=Arrays.asList(end->candidate("fast-hd"),addon);
                QualitySelector.Probe probe=(c,end)->c.id.equals("broken-4k")?new QualitySelector.Measure(0,0,1,0,false):c.id.equals("foreign-4k")?measure(3840,1600,-1):c.id.equals("good-fhd")?measure(1920,800,2):measure(1280,720,2);
                check(s.choose("movie:batch",sources,Collections.emptySet(),probe,1000).id.equals("good-fhd"));
                check(s.choose("movie:batch",sources,Collections.emptySet(),probe,1000).id.equals("good-fhd"));check(queries.get()==1);
            }break;
        }
        case "addon":{
            check(AddonPolicy.dubbed("FenixFlix 4K · 🇧🇷 Dublado"));check(AddonPolicy.dubbed("1080p · 🇧🇷🇺🇸 Dual Áudio"));
            check(!AddonPolicy.dubbed("1080p Legendado"));check(!AddonPolicy.dubbed("CAM Dublado"));check(!AddonPolicy.dubbed("1080p"));check(!AddonPolicy.dubbed("🇧🇷 Legendado"));
            check(AddonPolicy.height("FenixFlix 4K")==2160);check(AddonPolicy.height("FenixFlix 1080p")==1080);break;
        }
        case "ranking":{
            QualitySelector.Candidate hd=candidate("hd"),fhd=candidate("fhd"),uhd=candidate("uhd"),cinema=candidate("cinema"),foreign=candidate("foreign");
            hd.measure=measure(1280,720,2);fhd.measure=measure(1920,1080,2);uhd.measure=measure(3840,1600,2);cinema.measure=measure(1920,800,2);foreign.measure=measure(3840,2160,-1);
            check(QualitySelector.compare(fhd,hd)<0);check(QualitySelector.compare(uhd,fhd)<0);check(QualitySelector.compare(cinema,hd)<0);check(QualitySelector.compare(hd,foreign)<0);
            QualitySelector.Candidate promised=new QualitySelector.Candidate("promised","https://media.invalid/promised.mp4","","file","{}",2160);
            check(QualitySelector.compare(hd,promised)<0);break;
        }
        case "parallel":{
            try(QualitySelector s=new QualitySelector()){
                List<QualitySelector.Source> sources=new ArrayList<>();
                for(int i=0;i<7;i++){final int n=i;sources.add(end->candidate("source-"+n));}
                QualitySelector.Candidate winner=s.choose("movie:1",sources,Collections.emptySet(),(c,end)->{if(c.id.equals("source-6")){Thread.sleep(50);return measure(1920,1080,2);}return measure(1280,720,2);},1000);
                check(winner!=null&&winner.id.equals("source-6"));
            }break;
        }
        case "cache":{
            try(QualitySelector s=new QualitySelector()){
                AtomicInteger calls=new AtomicInteger();
                List<QualitySelector.Source> sources=Arrays.asList(end->{calls.incrementAndGet();return candidate("hd");},end->{calls.incrementAndGet();return candidate("fhd");});
                QualitySelector.Probe probe=(c,end)->measure(c.id.equals("fhd")?1920:1280,c.id.equals("fhd")?1080:720,2);
                check(s.choose("tv:1:1:1",sources,Collections.emptySet(),probe,1000).id.equals("fhd"));
                check(s.choose("tv:1:1:1",sources,Collections.emptySet(),probe,1000).id.equals("fhd"));check(calls.get()==2);
                check(s.choose("tv:1:1:2",sources,Collections.emptySet(),probe,1000).id.equals("fhd"));check(calls.get()==4);
                check(s.choose("tv:1:1:1:except-fhd",sources,new HashSet<>(Arrays.asList("fhd")),probe,1000).id.equals("hd"));
                s.forget("tv:1:1:1");s.choose("tv:1:1:1",sources,Collections.emptySet(),probe,1000);check(calls.get()==8);
            }break;
        }
        case "deadline":{
            try(QualitySelector s=new QualitySelector()){
                AtomicInteger slowCalls=new AtomicInteger();
                List<QualitySelector.Source> sources=Arrays.asList(end->candidate("hd"),end->{if(slowCalls.incrementAndGet()==1)Thread.sleep(1500);return candidate("fhd");});
                QualitySelector.Probe probe=(c,end)->measure(c.id.equals("fhd")?1920:1280,c.id.equals("fhd")?1080:720,2);
                s.choose("warmup",Collections.singletonList(end->candidate("hd")),Collections.emptySet(),probe,1000);
                long start=QualitySelector.now();check(s.choose("movie:2",sources,Collections.emptySet(),probe,300).id.equals("hd"));check(QualitySelector.now()-start<1200);
                check(s.choose("movie:2",sources,Collections.emptySet(),probe,1000).id.equals("fhd"));check(slowCalls.get()==2);
            }break;
        }
        case "playlist":{
            QualitySelector.Measure m=QualitySelector.playlist("#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,LANGUAGE=\"pt-BR\"\n#EXT-X-STREAM-INF:BANDWIDTH=8000000,RESOLUTION=3840x2160,CODECS=\"hvc1\"\n4k.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=4000000,RESOLUTION=1920x800,CODECS=\"avc1.640028\"\nfhd.m3u8");
            check(m.width==1920&&m.height==800&&m.language==2);check(m.bitrate==4000000);
            check(QualitySelector.playlist("#EXTM3U\n#EXTINF:6,\nsegment.js").height==0);
            check(QualitySelector.playlist("<html>anúncio</html>")==null);
            check(QualitySelector.playlist("#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,LANGUAGE=\"en\"").language==-1);break;
        }
        case "ranges":{
            AtomicInteger calls=new AtomicInteger();
            try(BoundedMediaReader reader=new BoundedMediaReader((p,n,end)->{calls.incrementAndGet();byte[] b=new byte[n];Arrays.fill(b,(byte)(p%127));return new BoundedMediaReader.Block(206,p,1000000,b,"video/mp4");},QualitySelector.now()+2000)){
                check(reader.size()==1000000);byte[] b=new byte[32];check(reader.readAt(999900,b,0,32)==32);check(b[0]==(byte)(999900%127));check(reader.readAt(1000000,b,0,1)==-1);check(calls.get()==2);
                check(reader.readAt(999932,b,0,32)==32);check(calls.get()==2);
            }
            for(int bad=0;bad<4;bad++){
                final int mode=bad;
                try(BoundedMediaReader r=new BoundedMediaReader((p,n,end)->new BoundedMediaReader.Block(mode==0?302:206,mode==1?p+1:p,100,new byte[mode==2?n+1:n],mode==3?"text/html":"video/mp4"),QualitySelector.now()+1000)){
                    try{r.size();throw new AssertionError("aceitou resposta inválida");}catch(IOException expected){}
                }
            }
            try(BoundedMediaReader r=new BoundedMediaReader((p,n,end)->{throw new AssertionError("leitura fora do prazo");},QualitySelector.now()-1)){
                try{r.size();throw new AssertionError();}catch(IOException expected){}
            }break;
        }
        default:throw new AssertionError(args[0]);
        }
    }
}
