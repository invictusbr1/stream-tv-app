package br.streamtv.app;
import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;
import java.io.IOException;

public final class QualitySelectorTest {
    private static void check(boolean ok){if(!ok)throw new AssertionError();}
    private static QualitySelector.Candidate candidate(String id){return new QualitySelector.Candidate(id,"https://media.invalid/"+id+".mp4","https://media.invalid/","file","{}",0);}
    private static QualitySelector.Measure measure(int w,int h,int lang){return new QualitySelector.Measure(w,h,lang,0,true);}
    public static void main(String[] args)throws Exception{
        switch(args[0]){
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
                List<QualitySelector.Source> sources=Arrays.asList(end->candidate("hd"),end->{if(slowCalls.incrementAndGet()==1)Thread.sleep(200);return candidate("fhd");});
                QualitySelector.Probe probe=(c,end)->measure(c.id.equals("fhd")?1920:1280,c.id.equals("fhd")?1080:720,2);
                long start=QualitySelector.now();check(s.choose("movie:2",sources,Collections.emptySet(),probe,60).id.equals("hd"));check(QualitySelector.now()-start<190);
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
