package br.streamtv.app;
import java.io.*;import java.net.*;import java.util.*;import java.nio.charset.StandardCharsets;
public final class LocalMediaRelayTest {
 static void check(boolean value,String what){if(!value)throw new AssertionError(what);}
 static final class Fake extends HttpURLConnection {
  byte[] data;int status;String mime;boolean closed;Map<String,String> headers=new HashMap<>();
  Fake(URL u,String text,String mime,int status){super(u);data=text.getBytes(StandardCharsets.UTF_8);this.mime=mime;this.status=status;}
  public void connect(){}public boolean usingProxy(){return false;}public void disconnect(){closed=true;}
  public int getResponseCode(){return status;}public String getContentType(){return mime;}public String getHeaderField(String key){return headers.get(key);}
  public InputStream getInputStream(){return new ByteArrayInputStream(data);}
 }
 static byte[] read(InputStream in)throws IOException{ByteArrayOutputStream o=new ByteArrayOutputStream();byte[] b=new byte[4096];int n;while((n=in.read(b))!=-1)o.write(b,0,n);in.close();return o.toByteArray();}
 public static void main(String[] args)throws Exception{
  // Endereço local: mesma origem do WebView, nunca destino inseguro.
  String local=LocalMediaRelay.local("https://fenix.example/r/abc/video.mp4","https://fenix.example/");
  check(local.startsWith("/api/midia-local?u=https%3A%2F%2Ffenix.example"),"endereço local");
  for(String bad:Arrays.asList("http://fenix.example/v.mp4","https://127.0.0.1/v.mp4","https://u:p@cdn.example/v.mp4")){try{LocalMediaRelay.local(bad,"");throw new AssertionError("aceitou "+bad);}catch(IOException expected){}}
  try{LocalMediaRelay.local("https://cdn.example/v.mp4","https://a\r\nX: y");throw new AssertionError("referer injetado");}catch(IOException expected){}
  check(LocalMediaRelay.validRange("bytes=0-")&&LocalMediaRelay.validRange("bytes=100-200")&&LocalMediaRelay.validRange("bytes=-500"),"faixas válidas");
  check(!LocalMediaRelay.validRange("bytes=0-1,5-6")&&!LocalMediaRelay.validRange("bytes=0-\r\nX: y"),"faixas inválidas");

  // Redireciona /r/ -> CDN, manda Referer e Range, devolve 206 transmitido.
  final List<Fake> abertas=new ArrayList<>();
  LocalMediaRelay relay=new LocalMediaRelay(u->{
   Fake f;
   if(u.getHost().equals("fenix.example")){f=new Fake(u,"","text/html",302);f.headers.put("Location","http://cdn.example/arquivo-4k");}
   else{f=new Fake(u,"VIDEO","application/octet-stream",206);f.headers.put("Content-Range","bytes 100-104/7000000000");f.headers.put("Content-Length","5");}
   abertas.add(f);return f;
  });
  LocalMediaRelay.Response r=relay.open("https://fenix.example/r/abc/video.mp4","https://fenix.example/","bytes=100-");
  check(r.status==206&&r.reason.equals("Partial Content"),"status 206");
  check(r.mime.equals("video/mp4"),"mime de vídeo");
  check("bytes 100-104/7000000000".equals(r.headers.get("Content-Range")),"content-range");
  check(new String(read(r.body),StandardCharsets.UTF_8).equals("VIDEO"),"corpo transmitido");
  Fake cdn=abertas.get(abertas.size()-1);
  check(cdn.getURL().toString().equals("https://cdn.example/arquivo-4k"),"http virou https");
  check("bytes=100-".equals(cdn.getRequestProperty("Range")),"range repassado");
  check("https://fenix.example/".equals(cdn.getRequestProperty("Referer")),"referer enviado");
  check(cdn.closed,"conexão fechada ao fim");

  // Segundo pedido (avançar no vídeo) vai direto ao destino guardado.
  int antes=abertas.size();
  read(relay.open("https://fenix.example/r/abc/video.mp4","https://fenix.example/","bytes=500-").body);
  check(abertas.size()==antes+1&&abertas.get(antes).getURL().getHost().equals("cdn.example"),"destino reaproveitado");

  // Faixa malformada não é repassada.
  read(relay.open("https://fenix.example/r/abc/video.mp4","https://fenix.example/","bytes=0-\r\nX: y").body);
  check(abertas.get(abertas.size()-1).getRequestProperty("Range")==null,"faixa ruim descartada");

  // Página de erro (HTML) não vira vídeo.
  LocalMediaRelay ruim=new LocalMediaRelay(u->new Fake(u,"<html>","text/html",200));
  try{ruim.open("https://cdn.example/v.mp4","","bytes=0-");throw new AssertionError("aceitou html");}catch(IOException expected){}
  LocalMediaRelay negado=new LocalMediaRelay(u->new Fake(u,"","video/mp4",404));
  try{negado.open("https://cdn.example/v.mp4","","bytes=0-");throw new AssertionError("aceitou 404");}catch(IOException expected){}
  check(LocalMediaRelay.mimeDoEndereco("/a/b.mkv").equals("video/x-matroska"),"mkv");
  System.out.println("ok");
 }
}
