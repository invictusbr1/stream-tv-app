package br.streamtv.app;

import java.net.URI;
import java.net.URLDecoder;
import java.text.Normalizer;
import java.util.Map;
import java.util.HashSet;
import java.util.Locale;
import java.util.regex.Pattern;
import java.util.regex.Matcher;

/** Somente MP4 no player do aplicativo; nenhum script ou iframe é executado. */
final class ProplayerSource {
    static final String ID = "proplayer-legendado";
    static final String MEDIA_HOST = "meusanimes.blog.alibabacdn.net";
    private static final Pattern ADS = Pattern.compile("\\b(popunder|popads|popcash|adsterra|monetag|outbrain|taboola|doubleclick|googlesyndication)\\b|advertising\\s*:|\\b(vast|vmap)\\s*[:=]", Pattern.CASE_INSENSITIVE);
    static final class Meta {
        final int id; final String name; final boolean anime; final Map<Integer,Integer> seasons;
        Meta(int id,String name,boolean anime,Map<Integer,Integer> seasons) { this.id=id;this.name=name;this.anime=anime;this.seasons=seasons; }
    }
    interface Catalog { Meta title(int id,long deadline) throws Exception; int[] episodes(int id,int season,long deadline) throws Exception; }
    interface Text { String get(String url,String referer,long deadline,int limit) throws Exception; }
    static final class Result {
        final String url,page; final int height;
        Result(String url,String page,int height) { this.url=url;this.page=page;this.height=height; }
    }
    static Result resolve(AnimeSource.Request request,Catalog catalog,Text text,AnimeSource.Clock clock) {
        if(request==null || !"legendado".equals(request.audio))return null;
        long deadline=clock.now()+20000;
        try {
            Meta meta=catalog.title(request.id,deadline);
            if(clock.now()>=deadline || meta==null || meta.id!=request.id || !meta.anime)return null;
            int[] numbers=catalog.episodes(request.id,request.season,deadline);
            int number=absolute(meta,request.season,request.episode,numbers);
            String slug=slug(meta.name);
            if(clock.now()>=deadline || number<1 || slug.isEmpty())return null;
            String page="https://assistiranimesonline.net/episodio/"+slug+"-episodio-"+number+"/";
            String html=text.get(page,"",deadline,1048576);
            String player=player(html,request.id,request.season,request.episode);
            if(clock.now()>=deadline || player==null)return null;
            String source=text.get(player,page,deadline,262144);
            Result result=media(source,query(new URI(player),"id"),page);
            return clock.now()>=deadline?null:result;
        } catch(Exception unavailable) { return null; }
    }
    static int absolute(Meta meta,int season,int episode,int[] numbers) {
        int min=Integer.MAX_VALUE;boolean found=false;
        if(numbers==null || numbers.length==0 || numbers.length>2000)return -1;
        for(int number:numbers){min=Math.min(min,number);if(number==episode)found=true;}
        if(!found)return -1;
        if(min>1)return episode;
        int result=episode;
        for(int t=1;t<season;t++){Integer count=meta.seasons.get(t);if(count==null||count<1||count>2000)return -1;result+=count;}
        return result<=10000?result:-1;
    }
    static String slug(String name) {
        if(name==null)return "";
        String result=Normalizer.normalize(name,Normalizer.Form.NFD).replaceAll("[\\u0300-\\u036f]","").toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]+","-").replaceAll("^-|-$","");
        return result.length()>180?result.substring(0,180):result;
    }
    private static URI secure(String value,String host) {
        try{URI u=new URI(value);return "https".equals(u.getScheme())&&host.equals(u.getHost())&&u.getUserInfo()==null&&u.getPort()==-1&&u.getFragment()==null?u:null;}catch(Exception invalid){return null;}
    }
    private static String attribute(String tag,String name) {
        Matcher m=Pattern.compile("\\b"+Pattern.quote(name)+"=[\"']([^\"']+)[\"']",Pattern.CASE_INSENSITIVE).matcher(tag);
        return m.find()?m.group(1).replace("&amp;","&"):null;
    }
    static String player(String html,int id,int season,int episode) {
        if(html==null || ADS.matcher(html).find())return null;
        Matcher buttons=Pattern.compile("<button\\b([^>]*)>([\\s\\S]*?)</button>",Pattern.CASE_INSENSITIVE).matcher(html);
        String identity="https://myembed.biz/serie/"+id+"/"+season+"/"+episode;
        boolean matched=false;java.util.Set<String> players=new HashSet<>();
        while(buttons.find()){
            String provider=attribute(buttons.group(1),"data-provider"),url=attribute(buttons.group(1),"data-player-url");
            if("myembed".equals(provider)&&identity.equals(url))matched=true;
            if("proplayer_leg".equals(provider)&&buttons.group(2).replaceAll("<[^>]*>"," ").matches("(?is).*PROPLAYER\\s+LEG.*")&&url!=null)players.add(url);
        }
        if(!matched || players.size()!=1)return null;
        String value=players.iterator().next();URI u=secure(value,"sk-ru.alibabacdn.net");
        if(u==null || !"/".equals(u.getPath()))return null;
        String file=query(u,"id");
        return file!=null&&file.matches("video/[a-zA-Z0-9/_-]+\\.[a-zA-Z0-9._-]*mp4")?value:null;
    }
    private static String query(URI uri,String key) {
        try{String result=null;for(String part:(uri.getRawQuery()==null?"":uri.getRawQuery()).split("&")){String[] pair=part.split("=",2);if(key.equals(pair[0])){if(result!=null)return null;result=URLDecoder.decode(pair.length>1?pair[1]:"","UTF-8");}}return result;}catch(Exception invalid){return null;}
    }
    static boolean validMedia(String value,String file) {
        URI u=secure(value,MEDIA_HOST);
        if(u==null || !u.getPath().matches("/video/[a-zA-Z0-9/_-]+\\.[a-zA-Z0-9._-]*mp4") || (file!=null&&!u.getPath().equals("/"+file)))return false;
        String signature=query(u,"X-Amz-Signature"),date=query(u,"X-Amz-Date"),expires=query(u,"X-Amz-Expires");
        if(signature==null||!signature.matches("[a-f0-9]{64}")||date==null||!date.matches("[0-9]{8}T[0-9]{6}Z")||expires==null||!expires.matches("[1-9][0-9]{0,4}"))return false;
        if(Integer.parseInt(expires)>10800)return false;
        java.util.Set<String> keys=new HashSet<>();
        for(String part:u.getRawQuery().split("&")){String key=part.split("=",2)[0];if(!key.matches("X-Amz-(Algorithm|Credential|Date|Expires|SignedHeaders|Signature)")||!keys.add(key))return false;}
        return true;
    }
    private static String jsonField(String value,String key) {
        Matcher m=Pattern.compile("\""+key+"\"\\s*:\\s*\"([^\"]*)\"").matcher(value);
        if(!m.find())return null;String result=m.group(1).replace("\\/","/").replace("\\u0026","&");return result.indexOf('\\')<0?result:null;
    }
    static Result media(String html,String file,String page) {
        if(html==null || ADS.matcher(html).find())return null;
        Matcher array=Pattern.compile("\\bsources\\s*:\\s*(\\[[^\\r\\n]*\\])",Pattern.CASE_INSENSITIVE).matcher(html);
        if(!array.find())return null;
        Matcher objects=Pattern.compile("\\{[^{}]*\\}").matcher(array.group(1));Result best=null;
        while(objects.find()){
            String object=objects.group(),url=jsonField(object,"file"),type=jsonField(object,"type"),label=jsonField(object,"label");
            if(!"video/mp4".equals(type)||label==null||!label.matches("[0-9]{3,4}p")||!validMedia(url,file))continue;
            int height=Integer.parseInt(label.substring(0,label.length()-1));if(height>=720&&(best==null||height>best.height))best=new Result(url,page,height);
        }
        return best;
    }
}
