package br.streamtv.app;

import java.util.regex.*;

/** Lê somente a configuração de mídia; nunca executa o player do fornecedor. */
final class ClickHostSource {
    static final String BASE="https://embed-api.clickhost.xyz";
    static final class Link {
        final String url,type;
        Link(String url,String type){this.url=url;this.type=type;}
    }
    interface Page { String read(String endpoint,long deadline)throws Exception; }
    static Link resolve(String endpoint,long deadline,Page page){
        if(endpoint==null)return null;
        for(int attempt=0;attempt<2&&deadline-QualitySelector.now()>500&&!Thread.currentThread().isInterrupted();attempt++){
            try{Link link=extract(page.read(endpoint,Math.min(deadline,QualitySelector.now()+(attempt==0?4500:2500))));if(link!=null)return link;}
            catch(Exception ignored){if(Thread.currentThread().isInterrupted())return null;}
        }
        return null;
    }
    static String endpoint(String type,String id,String season,String episode){
        if(id==null||!id.matches("[1-9][0-9]{0,9}"))return null;
        if("movie".equals(type))return BASE+"/embed/filme/"+id+"?ad_played=1";
        if(!"tv".equals(type)||season==null||episode==null||!season.matches("[1-9][0-9]{0,2}")||!episode.matches("[1-9][0-9]{0,3}"))return null;
        return BASE+"/embed/serie/"+id+"/"+season+"/"+episode+"?ad_played=1";
    }
    static Link extract(String html){
        if(html==null||html.length()>2*1024*1024)return null;
        Matcher m=Pattern.compile("\\bstreamUrl\\s*:\\s*\"((?:\\\\.|[^\"\\\\])*)\"").matcher(html);
        if(!m.find())return null;
        try{
            String url=unescape(m.group(1));
            java.net.URL parsed=MediaHttp.safe(url);
            String path=parsed.getPath().toLowerCase(java.util.Locale.ROOT);
            boolean hls=Pattern.compile("\\bstreamIsHls\\s*:\\s*true\\b").matcher(html).find();
            if(!path.endsWith(hls?".m3u8":".mp4")&&Pattern.compile("\\.[a-z0-9]{1,5}$").matcher(path).find())return null;
            if(url.length()>4096)return null;
            return new Link(url,hls?"hls":"file");
        }catch(Exception invalid){return null;}
    }
    private static String unescape(String text){
        StringBuilder out=new StringBuilder();
        for(int i=0;i<text.length();i++){
            char c=text.charAt(i);if(c<' ')throw new IllegalArgumentException();
            if(c!='\\'){out.append(c);continue;}
            if(++i>=text.length())throw new IllegalArgumentException();
            c=text.charAt(i);
            if(c=='u'){
                if(i+4>=text.length())throw new IllegalArgumentException();
                out.append((char)Integer.parseInt(text.substring(i+1,i+5),16));i+=4;
            }else if(c=='/'||c=='\\'||c=='"')out.append(c);
            else throw new IllegalArgumentException();
        }
        String result=out.toString();if(result.contains("\n")||result.contains("\r"))throw new IllegalArgumentException();return result;
    }
}
