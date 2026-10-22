package br.streamtv.app;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.regex.*;

/** Recuperação autenticada pela mesma origem do navegador; nunca um proxy livre. */
final class ServerPlaybackTransport {
 interface Connector {HttpURLConnection open(URL url)throws IOException;}
 final URL base;private final String code;private final Connector connector;
 ServerPlaybackTransport(String origin,String code)throws IOException{this(origin,code,u->(HttpURLConnection)u.openConnection());}
 ServerPlaybackTransport(String origin,String code,Connector connector)throws IOException{
  base=MediaHttp.safe(origin);if(!base.getPath().isEmpty()&&!base.getPath().equals("/")||base.getQuery()!=null||base.getRef()!=null||code==null||code.isEmpty()||code.matches("(?s).*[\\r\\n].*"))throw new IOException("Origem de recuperação inválida");this.code=code;this.connector=connector;
 }
 static boolean mediaPath(String path){
  if(path==null||path.length()>16384||path.contains("#")||path.matches("(?s).*[\\r\\n].*"))return false;
  try{URI u=new URI(path);if(u.isAbsolute()||u.getRawAuthority()!=null)return false;String p=u.getRawPath();return p.equals("/api/hls")&&u.getRawQuery()!=null||p.matches("/api/convertido/[A-Za-z0-9_-]{1,96}/[A-Za-z0-9_-]+\\.(m3u8|ts|m4s|mp4)")||p.matches("/api/crystal-lake/1/[1-8]/master\\.m3u8");}catch(Exception e){return false;}
 }
 static String local(String path)throws IOException{if(!mediaPath(path))throw new IOException("Caminho de mídia não permitido");return "/api/rede-midia?p="+URLEncoder.encode(path,"UTF-8");}
 private HttpURLConnection connect(String path,String range,int timeout)throws IOException{
  URL url=new URL(base,path);if(!url.getAuthority().equals(base.getAuthority())||!url.getProtocol().equals("https"))throw new IOException("Origem alterada");
  if(range!=null&&!range.matches("bytes=([0-9]+-[0-9]*|-[0-9]+)"))throw new IOException("Faixa inválida");
  HttpURLConnection c=connector.open(url);c.setInstanceFollowRedirects(false);c.setConnectTimeout(timeout);c.setReadTimeout(timeout);c.setRequestProperty("X-Conecta-Codigo",code);c.setRequestProperty("Accept-Encoding","identity");if(range!=null&&range.matches("bytes=([0-9]+-[0-9]*|-[0-9]+)"))c.setRequestProperty("Range",range);return c;
 }
 String json(String path,int timeout)throws IOException{
  if(!path.matches("/api/playback/(?:[0-9]{1,10}|serie/[0-9]{1,10}/[0-9]{1,3}/[1-9][0-9]{0,3})\\?[^\\r\\n#]*"))throw new IOException("Consulta não permitida");
  HttpURLConnection c=connect(path,null,timeout);try{if(c.getResponseCode()!=200)throw new IOException("Consulta do servidor indisponível");return new String(read(c.getInputStream(),262144),StandardCharsets.UTF_8);}finally{c.disconnect();}
 }
 static final class Response {final int status;final String mime;final Map<String,String> headers;final InputStream body;Response(int s,String m,Map<String,String> h,InputStream b){status=s;mime=m;headers=h;body=b;}}
 Response media(String path,String range)throws IOException{
  if(!mediaPath(path))throw new IOException("Caminho não permitido");final HttpURLConnection c=connect(path,range,15000);
  try{
   int status=c.getResponseCode();if(status!=200&&status!=206)throw new IOException("Mídia do servidor indisponível");String mime=c.getContentType()==null?"application/octet-stream":c.getContentType().split(";")[0];
   if(mime.matches("(?i).*(text/html|application/json|text/xml).*"))throw new IOException("Resposta não é mídia");
   Map<String,String> headers=new HashMap<>();headers.put("Cache-Control","no-store");for(String name:Arrays.asList("Content-Range","Accept-Ranges","Content-Length")){String value=c.getHeaderField(name);if(value!=null)headers.put(name,value);}
   if(mime.toLowerCase(Locale.ROOT).contains("mpegurl")||new URI(path).getPath().endsWith(".m3u8")){
    String text=new String(read(c.getInputStream(),2097152),StandardCharsets.UTF_8);if(!text.trim().startsWith("#EXTM3U"))throw new IOException("Lista inválida");
    StringBuilder out=new StringBuilder();for(String line:text.split("\\r?\\n")){if(line.startsWith("#")){Matcher m=Pattern.compile("URI=\"([^\"]+)\"").matcher(line);StringBuffer b=new StringBuffer();while(m.find())m.appendReplacement(b,Matcher.quoteReplacement("URI=\""+child(path,m.group(1))+"\""));m.appendTail(b);out.append(b);}else if(!line.trim().isEmpty())out.append(child(path,line.trim()));out.append('\n');}
    c.disconnect();headers.remove("Content-Length");return new Response(200,"application/vnd.apple.mpegurl",headers,new ByteArrayInputStream(out.toString().getBytes(StandardCharsets.UTF_8)));
   }
   // Arquivos e segmentos são transmitidos; nunca acumulados inteiros na memória.
   return new Response(status,mime,headers,new FilterInputStream(c.getInputStream()){@Override public void close()throws IOException{try{super.close();}finally{c.disconnect();}}});
  }catch(Exception e){c.disconnect();throw new IOException("Falha na recuperação de mídia",e);}
 }
 private String child(String parent,String value)throws IOException{URL u=new URL(new URL(base,parent),value);if(!u.getProtocol().equals("https")||!u.getAuthority().equals(base.getAuthority()))throw new IOException("Mídia fora do servidor");return local(u.getFile());}
 private static byte[] read(InputStream in,int max)throws IOException{try(InputStream input=in;ByteArrayOutputStream out=new ByteArrayOutputStream()){byte[] b=new byte[8192];int n;while((n=input.read(b))!=-1){if(out.size()+n>max)throw new IOException("Resposta excessiva");out.write(b,0,n);}return out.toByteArray();}}
}
