package br.streamtv.app;
public final class CrystalLakeSourceTest {
    static void check(boolean value){if(!value)throw new AssertionError();}
    public static void main(String[] args){
        check(CrystalLakeSource.applies("213562","1","1"));check(CrystalLakeSource.applies("213562","1","8"));
        check(!CrystalLakeSource.applies("1399","1","1"));check(!CrystalLakeSource.applies("213562","2","1"));check(!CrystalLakeSource.applies("213562","1","9"));
        String hash="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",asset="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
        String[] words=new String[62];java.util.Arrays.fill(words,"");words[61]="FirePlayer";
        String packed="return p}('Z(\""+hash+"\",{\"fields\":{\"imdb\":\"213562-1-1\"}},false,source)',62,62,'"+String.join("|",words)+"'.split('|')";
        CrystalLakeSource.Settings settings=CrystalLakeSource.settings(packed);check(settings!=null&&hash.equals(settings.hash)&&settings.json.contains("213562-1-1"));
        check(CrystalLakeSource.settings("document.location='evil'")==null);
        long now=1792176000000L;String url="https://vaiquecol.com/cdn/hls/"+asset+"/master.m3u8?md5=aaaaaaaaaaaaaaaaaaaaaa&expires="+(now/1000+7200);
        String source="https://vaiquecol.com/cdn/hls/"+asset+"/master.txt";
        check(CrystalLakeSource.validLink(true,source,url,now));check(!CrystalLakeSource.validLink(true,source,url,now+7200000));check(!CrystalLakeSource.validLink(true,source,url+"&other=1",now));check(!CrystalLakeSource.validLink(true,source,url.replace("vaiquecol.com","127.0.0.1"),now));
        String master="#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID=\"audio\",LANGUAGE=\"eng\",DEFAULT=NO,URI=\"https://vaiquecol.com/hls/en\"\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID=\"audio\",LANGUAGE=\"por\",DEFAULT=NO,URI=\"https://vaiquecol.com/hls/pt\"\n#EXT-X-STREAM-INF:RESOLUTION=842x480,AUDIO=\"audio\"\nhttps://vaiquecol.com/hls/video\n";
        String pt=CrystalLakeSource.portuguesePlaylist(master);check(pt!=null&&!pt.contains("LANGUAGE=\"eng\"")&&pt.contains("DEFAULT=YES"));
        check(CrystalLakeSource.portuguesePlaylist(master+"#EXT-X-DISCONTINUITY\n")==null);check(CrystalLakeSource.portuguesePlaylist(master.replace("LANGUAGE=\"por\"","LANGUAGE=\"spa\""))==null);check(CrystalLakeSource.portuguesePlaylist(master.replace("/hls/video","/other/video"))==null);
        check(new CrystalLakeSource.Result(url,pt,now).resolution.equals("480p"));
        String upgraded=master+"#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID=\"original\",LANGUAGE=\"eng\",DEFAULT=NO,URI=\"https://vaiquecol.com/hls/original\"\n#EXT-X-STREAM-INF:RESOLUTION=3840x2160,AUDIO=\"original\"\nhttps://vaiquecol.com/hls/english4k\n";
        String onlyPt=CrystalLakeSource.portuguesePlaylist(upgraded);check(onlyPt!=null&&!onlyPt.contains("english4k"));check(new CrystalLakeSource.Result(url,onlyPt,now).resolution.equals("480p"));
        for(int[] size:new int[][]{{1280,720},{1920,1080},{2560,1440},{3840,2160}}){
            upgraded+="#EXT-X-STREAM-INF:RESOLUTION="+size[0]+"x"+size[1]+",AUDIO=\"audio\"\nhttps://vaiquecol.com/hls/pt"+size[1]+"\n";
            onlyPt=CrystalLakeSource.portuguesePlaylist(upgraded);CrystalLakeSource.Result result=new CrystalLakeSource.Result(url,onlyPt,now);check(result.width==size[0]&&result.height==size[1]&&result.resolution.equals(size[1]+"p"));
        }
        check(CrystalLakeSource.portuguesePlaylist(upgraded+"#EXT-X-CUE-OUT:30\n")==null);
        check(new CrystalLakeSource.Result(url,master.replace("842x480","3840x1600"),now).resolution.equals("2160p"));
        String media="#EXTM3U\n#EXTINF:10,\nhttps://nensec.xyz/cdn/segment.html\n#EXT-X-ENDLIST\n";
        check(CrystalLakeSource.cleanMediaPlaylist(media));check(!CrystalLakeSource.cleanMediaPlaylist(media+"#EXT-X-CUE-OUT:30\n"));check(!CrystalLakeSource.cleanMediaPlaylist(media.replace("nensec.xyz","evil.test")));
        if(args.length>0){try{String html=new String(java.nio.file.Files.readAllBytes(java.nio.file.Paths.get(args[0])),java.nio.charset.StandardCharsets.UTF_8);check(CrystalLakeSource.settings(html)!=null);}catch(Exception e){throw new AssertionError(e);}}
    }
}
