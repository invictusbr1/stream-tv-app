package br.streamtv.app;

import java.net.URI;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Exceção exclusiva de Crystal Lake; não altera a seleção de outros títulos. */
final class CrystalLakeSource {
    static final String ID="crystal-lake-dublado", ORIGIN="https://vaiquecol.com", REFERER="https://plenoflu.com/";
    static boolean applies(String id,String season,String episode){return "213562".equals(id)&&"1".equals(season)&&episode!=null&&episode.matches("[1-8]");}
    static final class Settings {
        final String hash,json;
        Settings(String hash,String json){this.hash=hash;this.json=json;}
    }
    static final class Result {
        final String url,playlist,resolution;final int width,height;final long until;
        Result(String url,String playlist,long until){this.url=url;this.playlist=playlist;this.until=until;int[] size=quality(playlist);width=size[0];height=size[1];double equivalent=Math.max(Math.min(width,height),Math.max(width,height)*9.0/16);resolution=equivalent>0?Math.round(equivalent)+"p":"";}
    }
    private static String base62(int n){return n<62?n<36?Integer.toString(n,36):String.valueOf((char)(n+29)):base62(n/62)+base62(n%62);}
    static Settings settings(String html){
        if(html==null||html.length()>262144)return null;
        Matcher packed=Pattern.compile("return p\\}\\('((?:\\\\.|[^'\\\\])*)',62,(\\d+),'([^']*)'\\.split\\('\\|'\\)").matcher(html);
        if(!packed.find())return null;
        int count=Integer.parseInt(packed.group(2));if(count>2048)return null;
        String body=packed.group(1).replace("\\'","'").replace("\\\\","\\");String[] words=packed.group(3).split("\\|",-1);
        for(int n=count-1;n>=0;n--)if(n<words.length&&!words[n].isEmpty())body=body.replaceAll("\\b"+base62(n)+"\\b",Matcher.quoteReplacement(words[n]));
        Matcher call=Pattern.compile("FirePlayer\\(\"([a-f0-9]{32})\",(\\{[\\s\\S]*?\\}),(?:false|true),source\\)").matcher(body);
        return call.find()?new Settings(call.group(1),call.group(2)):null;
    }
    static long expiry(String secured){
        try{Matcher e=Pattern.compile("(?:\\?|&)expires=([0-9]+)(?:&|$)").matcher(secured);return e.find()?Long.parseLong(e.group(1))*1000:0;}catch(Exception invalid){return 0;}
    }
    static boolean validLink(boolean hls,String source,String secured,long now){
        try{
            URI u=new URI(secured);Matcher asset=Pattern.compile("/cdn/hls/([a-f0-9]{32})/master\\.m3u8").matcher(u.getPath());
            if(!hls||!"https".equals(u.getScheme())||!"vaiquecol.com".equals(u.getHost())||u.getPort()!=-1||u.getUserInfo()!=null||u.getFragment()!=null||!asset.matches()||!(ORIGIN+"/cdn/hls/"+asset.group(1)+"/master.txt").equals(source))return false;
            String query=u.getRawQuery();if(query==null||!query.matches("(?:md5=[A-Za-z0-9_-]{22}&expires=[0-9]+|expires=[0-9]+&md5=[A-Za-z0-9_-]{22})"))return false;
            long expires=expiry(secured);return expires>now+90000&&expires<=now+14400000;
        }catch(Exception invalid){return false;}
    }
    static String portuguesePlaylist(String text){
        if(text==null||!text.startsWith("#EXTM3U")||text.length()>131072||Pattern.compile("#EXT-X-(?:DATERANGE|CUE-|DISCONTINUITY)|SCTE|INTERSTITIAL",Pattern.CASE_INSENSITIVE).matcher(text).find())return null;
        String[] lines=text.split("\\r?\\n");java.util.Set<String> groups=new java.util.HashSet<>();
        for(String line:lines)if(line.startsWith("#EXT-X-MEDIA:TYPE=AUDIO")&&Pattern.compile("LANGUAGE=\"(?:por|pt(?:-BR)?)\"",Pattern.CASE_INSENSITIVE).matcher(line).find()){Matcher group=Pattern.compile("GROUP-ID=\"([^\"]+)\"").matcher(line);if(group.find())groups.add(group.group(1));}
        StringBuilder kept=new StringBuilder();boolean portuguese=false,variant=false;
        try{for(int i=0;i<lines.length;i++){String line=lines[i];
            if(line.startsWith("#EXT-X-STREAM-INF:")){
                Matcher group=Pattern.compile("AUDIO=\"([^\"]+)\"").matcher(line);String audio=group.find()?group.group(1):"";
                if(++i>=lines.length||lines[i].startsWith("#"))return null;String target=lines[i];
                if(!groups.contains(audio))continue;if(!child(target))return null;
                kept.append(line).append('\n').append(target).append('\n');variant=true;continue;
            }
            if(line.startsWith("#EXT-X-I-FRAME-STREAM-INF:"))continue;
            if(line.startsWith("#EXT-X-MEDIA:TYPE=AUDIO")){
                if(!Pattern.compile("LANGUAGE=\"(?:por|pt(?:-BR)?)\"",Pattern.CASE_INSENSITIVE).matcher(line).find())continue;
                portuguese=true;kept.append(line.replaceAll("DEFAULT=(?:YES|NO)","DEFAULT=YES")).append('\n');
            }else kept.append(line).append('\n');
            if(line.startsWith("#")){
                Matcher target=Pattern.compile("URI=\"([^\"]+)\"").matcher(line);while(target.find())if(!child(target.group(1)))return null;
            }else if(!line.trim().isEmpty()&&!child(line.trim()))return null;
        }}catch(Exception invalid){return null;}
        return portuguese&&variant?kept.toString():null;
    }
    static int[] quality(String text){
        int width=0,height=0;double best=0;
        for(String line:text.split("\\r?\\n"))if(line.startsWith("#EXT-X-STREAM-INF:")){
            Matcher m=Pattern.compile("RESOLUTION=(\\d{2,5})x(\\d{2,5})",Pattern.CASE_INSENSITIVE).matcher(line);if(!m.find())continue;
            int w=Integer.parseInt(m.group(1)),h=Integer.parseInt(m.group(2));double equivalent=Math.max(Math.min(w,h),Math.max(w,h)*9.0/16);
            if(equivalent>best){best=equivalent;width=w;height=h;}
        }return new int[]{width,height};
    }
    private static boolean child(String target)throws Exception{
        URI u=new URI(target);return "https".equals(u.getScheme())&&"vaiquecol.com".equals(u.getHost())&&u.getPort()==-1&&u.getUserInfo()==null&&u.getFragment()==null&&u.getRawPath().matches("/hls/[A-Za-z0-9%+/=_-]+");
    }
    static boolean cleanMediaPlaylist(String text){
        if(text==null||!text.startsWith("#EXTM3U")||!text.contains("#EXT-X-ENDLIST")||Pattern.compile("#EXT-X-(?:DATERANGE|CUE-|DISCONTINUITY)|SCTE|INTERSTITIAL",Pattern.CASE_INSENSITIVE).matcher(text).find())return false;
        boolean segment=false;
        try{for(String line:text.split("\\r?\\n")){String value=line.trim();if(value.isEmpty()||value.startsWith("#"))continue;
            URI u=new URI(value);if(!"https".equals(u.getScheme())||u.getHost()==null||!u.getHost().matches("nense(?:c|[f-i]|[l-u])\\.xyz")||u.getUserInfo()!=null||u.getPort()!=-1||u.getFragment()!=null)return false;segment=true;
        }}catch(Exception invalid){return false;}return segment;
    }
}
