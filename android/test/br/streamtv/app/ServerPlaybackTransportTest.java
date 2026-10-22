package br.streamtv.app;
import java.io.*;import java.net.*;import java.util.*;import java.nio.charset.StandardCharsets;
public final class ServerPlaybackTransportTest {
 static void check(boolean value){if(!value)throw new AssertionError();}
 static final class Fake extends HttpURLConnection {
  byte[] data;int status;String mime;boolean closed;int read;Map<String,String> headers=new HashMap<>();
  Fake(URL u,String text,String mime,int status){super(u);data=text.getBytes(StandardCharsets.UTF_8);this.mime=mime;this.status=status;}
  public void connect(){}public boolean usingProxy(){return false;}public void disconnect(){closed=true;}
  public int getResponseCode(){return status;}public String getContentType(){return mime;}public String getHeaderField(String key){return headers.get(key);}
  public InputStream getInputStream(){return new ByteArrayInputStream(data){public synchronized int read(byte[] b,int off,int len){int n=super.read(b,off,len);if(n>0)Fake.this.read+=n;return n;}};}
 }
 public static void main(String[] args)throws Exception{
  for(String bad:Arrays.asList("https://evil.invalid/api/hls?u=x","//evil.invalid/api/hls?u=x","/api/../hls?u=x","/api/hls?u=x#fragment","/api/acesso","/api/hls?u=x\r\nInjected: y","/api/convertido/a/../b"))check(!ServerPlaybackTransport.mediaPath(bad));
  check(ServerPlaybackTransport.mediaPath("/api/hls?u=signed&r=origin"));check(ServerPlaybackTransport.mediaPath("/api/convertido/filme-1/index.m3u8"));
  for(String bad:Arrays.asList("http://backend.invalid","https://u:p@backend.invalid","https://127.0.0.1","https://backend.invalid/other","https://backend.invalid?code=x")){try{new ServerPlaybackTransport(bad,"code");throw new AssertionError();}catch(IOException expected){}}
  final Fake[] connection={null};
  ServerPlaybackTransport t=new ServerPlaybackTransport("https://backend.invalid","private-code",u->connection[0]=new Fake(u,"#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI=\"/api/hls?u=key\"\n/api/hls?u=segment\n","application/vnd.apple.mpegurl",200));
  ServerPlaybackTransport.Response r=t.media("/api/hls?u=master",null);String text=new String(read(r.body),StandardCharsets.UTF_8);check(text.contains("/api/rede-midia?p="));check(!text.contains("private-code"));check(connection[0].getRequestProperty("X-Conecta-Codigo").equals("private-code"));check(!connection[0].getInstanceFollowRedirects());check(connection[0].closed);
  t=new ServerPlaybackTransport("https://backend.invalid","code",u->{Fake f=new Fake(u,"binary-video","video/mp4",206);f.headers.put("Content-Range","bytes 10-21/5000000000");connection[0]=f;return f;});
  r=t.media("/api/hls?u=mp4","bytes=10-21");check(connection[0].read==0&&!connection[0].closed);check(r.status==206&&r.headers.containsKey("Content-Range"));check(connection[0].getRequestProperty("Range").equals("bytes=10-21"));r.body.close();check(connection[0].closed);
  for(String content:Arrays.asList("#EXTM3U\nhttps://evil.invalid/movie.ts\n","<html>not video</html>")){
   final String body=content;t=new ServerPlaybackTransport("https://backend.invalid","code",u->new Fake(u,body,body.startsWith("#")?"application/vnd.apple.mpegurl":"text/html",200));
   try{t.media("/api/hls?u=movie",null);throw new AssertionError();}catch(IOException expected){}
  }
  t=new ServerPlaybackTransport("https://backend.invalid","code",u->new Fake(u,"", "video/mp4",302));try{t.media("/api/hls?u=movie",null);throw new AssertionError();}catch(IOException expected){}
  t=new ServerPlaybackTransport("https://backend.invalid","code",u->{connection[0]=new Fake(u,"{\"type\":\"hls\"}","application/json",200);return connection[0];});
  check(t.json("/api/playback/serie/306956/1/134?transporte=servidor&codec=hevc",20000).contains("hls"));check(connection[0].getReadTimeout()==20000);
  try{t.json("/api/acesso?x=1",20000);throw new AssertionError();}catch(IOException expected){}
  System.out.println("Transporte: origem, autenticação, HLS, Range, streaming e falhas conferidos.");
 }
 static byte[] read(InputStream in)throws IOException{ByteArrayOutputStream out=new ByteArrayOutputStream();byte[] b=new byte[8192];int n;while((n=in.read(b))!=-1)out.write(b,0,n);in.close();return out.toByteArray();}
}
