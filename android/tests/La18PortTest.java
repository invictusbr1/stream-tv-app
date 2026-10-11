package br.streamtv.app;
public final class La18PortTest {
 public static void main(String[] args) throws Exception {
  String media = La18Source.extract("var playbackURL=\"https://media.fubo18.com:443/premiere1/mono.m3u8?token=test\";");
  if(media.isEmpty() || !La18Source.httpsPort(new java.net.URI(media).getPort())) throw new AssertionError("O Android deve encaminhar a URL real com :443");
  if(!La18Source.httpsPort(-1)||La18Source.httpsPort(80)||La18Source.httpsPort(444))throw new AssertionError("Somente portas HTTPS padrão");
  if(!La18Source.extract("var playbackURL=\"https://media.fubo18.com:444/premiere1/mono.m3u8\";").isEmpty())throw new AssertionError("Porta alternativa recusada");
  System.out.println("Regressão Android HTTPS :443 aprovada");
 }
}
