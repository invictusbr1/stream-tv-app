package br.streamtv.app;
import java.util.HashMap;
import java.util.Map;
import java.nio.file.Files;
import java.nio.file.Paths;

public final class ProplayerSourceTest {
    static void check(boolean value){if(!value)throw new AssertionError("Falha no conector sem anúncios");}
    public static void main(String[] args)throws Exception{
        String media="https://meusanimes.blog.alibabacdn.net/video/pasta/a.aaa.mp4?X-Amz-Date=20261016T120000Z&X-Amz-Expires=10800&X-Amz-Signature="+new String(new char[64]).replace('\0','a');
        String frame="https://sk-ru.alibabacdn.net/?id=video/pasta/a.aaa.mp4";
        String html="<button data-provider=\"proplayer_leg\" data-player-url=\""+frame+"\">PROPLAYER LEG</button><button data-provider=\"myembed\" data-player-url=\"https://myembed.biz/serie/134667/2/3\">MyEmbed</button>";
        String player="sources: [{\"file\":\""+media+"\",\"type\":\"video/mp4\",\"label\":\"1080p\"}]";
        Map<Integer,Integer> counts=new HashMap<>();counts.put(1,12);
        ProplayerSource.Meta meta=new ProplayerSource.Meta(134667,"Reincarnated as a Sword",true,counts);
        final int[] calls={0};
        ProplayerSource.Catalog catalog=new ProplayerSource.Catalog(){public ProplayerSource.Meta title(int id,long d){return meta;}public int[] episodes(int id,int t,long d){return new int[]{1,2,3};}};
        AnimeSource.Request request=AnimeSource.request("tv","134667","2","3","legendado");
        ProplayerSource.Result result=ProplayerSource.resolve(request,catalog,(url,referer,deadline,limit)->{calls[0]++;if(calls[0]==1){check(url.endsWith("-episodio-15/"));return html;}check(referer.endsWith("-episodio-15/"));return player;},()->0);
        check(result!=null&&result.height==1080&&result.url.equals(media)&&calls[0]==2);
        check(ProplayerSource.resolve(AnimeSource.request("tv","134667","2","3","dublado"),catalog,(u,r,d,l)->{throw new AssertionError("Dublado não pode consultar");},()->0)==null);
        check(ProplayerSource.player(html,134667,2,4)==null);
        check(ProplayerSource.player(html+"<script src='https://popads.net/a.js'></script>",134667,2,3)==null);
        check(ProplayerSource.player(html.replace("proplayer_leg","proplayer_dub"),134667,2,3)==null);
        check(ProplayerSource.media(player+" advertising: {}","video/pasta/a.aaa.mp4","")==null);
        check(ProplayerSource.media(player.replace("1080p","480p"),"video/pasta/a.aaa.mp4","")==null);
        check(ProplayerSource.media(player,"video/pasta/outro.mp4","")==null);
        check(!ProplayerSource.validMedia(media.replace(".net/",".net.evil.test/"),null));
        check(!ProplayerSource.validMedia(media+"&redirect=https://evil.test",null));
        check(!ProplayerSource.validMedia(media.replace("https:","http:"),null));
        check(ProplayerSource.absolute(meta,2,3,new int[]{1,2,3})==15);
        check(ProplayerSource.absolute(meta,2,63,new int[]{62,63})==63);
        check(ProplayerSource.slug("Título com ação!").equals("titulo-com-acao"));
        if(args.length==2){String live=new String(Files.readAllBytes(Paths.get(args[0])),"UTF-8");String livePlayer=new String(Files.readAllBytes(Paths.get(args[1])),"UTF-8");String link=ProplayerSource.player(live,134667,2,3);check(link!=null);String raw=new java.net.URI(link).getRawQuery().split("&")[0].substring(3);check(ProplayerSource.media(livePlayer,java.net.URLDecoder.decode(raw,"UTF-8"),"")!=null);}
        System.out.println("OK: isolamento, identidade, publicidade, resolução e mídia validados");
    }
}
