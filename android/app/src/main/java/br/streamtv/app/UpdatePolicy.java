package br.streamtv.app;
import java.net.URI;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;

final class UpdatePolicy {
    static final String REPOSITORY = "invictusbr1/stream-tv-atualizacoes";
    static final String FEED = "https://raw.githubusercontent.com/" + REPOSITORY + "/main/latest.json";
    // O mesmo manifesto é procurado em mais de um endereço: se uma operadora ou
    // rede doméstica bloqueia um deles, o aviso de atualização continua chegando.
    static final String[] FEEDS = {
        FEED,
        "https://github.com/" + REPOSITORY + "/raw/main/latest.json",
        "https://cdn.jsdelivr.net/gh/" + REPOSITORY + "@main/latest.json",
        "https://invictusbr1.github.io/stream-tv-app/latest.json"
    };
    // Canal de teste: a versão nova vai primeiro só para os aparelhos listados
    // em "aparelhos" deste arquivo. Depois de aprovada, vira o latest.json.
    static final String[] FEEDS_TESTE = {
        "https://raw.githubusercontent.com/" + REPOSITORY + "/main/latest-teste.json",
        "https://cdn.jsdelivr.net/gh/" + REPOSITORY + "@main/latest-teste.json"
    };
    static boolean aparelhoDeTeste(org.json.JSONObject teste,String dispositivo){
        if(teste==null||dispositivo==null||!dispositivo.matches("[a-z0-9]{6,32}"))return false;
        org.json.JSONArray lista=teste.optJSONArray("aparelhos");
        for(int i=0;lista!=null&&i<lista.length();i++)if(dispositivo.equals(lista.optString(i)))return true;
        return false;
    }
    static final long MAX_BYTES = 100L * 1024 * 1024;
    static boolean secure(String value) {
        try { URI u=new URI(value); return "https".equals(u.getScheme()) && u.getUserInfo()==null && u.getPort()==-1 && u.getFragment()==null; }
        catch(Exception e){return false;}
    }
    static boolean downloadUrl(String value, boolean redirect) {
        if(!secure(value))return false;
        URI u=URI.create(value);
        if("github.com".equals(u.getHost()))return u.getPath().startsWith("/"+REPOSITORY+"/releases/download/") && u.getPath().endsWith(".apk") && !u.getPath().contains("/../");
        if("raw.githubusercontent.com".equals(u.getHost()))return u.getPath().startsWith("/"+REPOSITORY+"/") && u.getPath().endsWith(".apk") && !u.getPath().contains("/../");
        return redirect && ("release-assets.githubusercontent.com".equals(u.getHost()) || "objects.githubusercontent.com".equals(u.getHost()));
    }
    static boolean valid(long version,long current,long bytes,String hash,String url) {
        return version>current && version<=Integer.MAX_VALUE && bytes>0 && bytes<=MAX_BYTES && hash!=null && hash.matches("[a-fA-F0-9]{64}") && downloadUrl(url,false);
    }
    static String hex(byte[] bytes){StringBuilder b=new StringBuilder();for(byte n:bytes)b.append(String.format(java.util.Locale.ROOT,"%02x",n&255));return b.toString();}
    static boolean sameSigners(byte[][] a,byte[][] b) {
        if(a==null||b==null||a.length==0||a.length!=b.length)return false;
        Set<String> x=new HashSet<>(),y=new HashSet<>();
        for(byte[] n:a)x.add(Arrays.toString(n));for(byte[] n:b)y.add(Arrays.toString(n));return x.equals(y);
    }
}
