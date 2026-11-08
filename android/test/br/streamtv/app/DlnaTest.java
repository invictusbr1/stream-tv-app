package br.streamtv.app;

import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

public class DlnaTest {
    static void ok(boolean c, String m) { if (!c) throw new AssertionError(m); }
    public static void main(String[] a) throws Exception {
        List<String> acoes = new ArrayList<>(); List<String> corpos = new ArrayList<>();
        HttpServer s = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        int porta = s.getAddress().getPort();
        s.createContext("/dmr.xml", ex -> { byte[] b = ("<?xml version=\"1.0\"?><root><device><friendlyName>[TV] Samsung Sala</friendlyName><manufacturer>Samsung Electronics</manufacturer><serviceList><service><serviceType>urn:schemas-upnp-org:service:RenderingControl:1</serviceType><controlURL>/rc</controlURL></service><service><serviceType>urn:schemas-upnp-org:service:AVTransport:1</serviceType><controlURL>/upnp/control/AVTransport1</controlURL></service></serviceList></device></root>").getBytes(StandardCharsets.UTF_8); ex.sendResponseHeaders(200, b.length); ex.getResponseBody().write(b); ex.close(); });
        s.createContext("/upnp/control/AVTransport1", ex -> { acoes.add(ex.getRequestHeaders().getFirst("SOAPAction")); corpos.add(new String(ex.getRequestBody().readAllBytes(), StandardCharsets.UTF_8)); byte[] b = "<ok/>".getBytes(); ex.sendResponseHeaders(200, 0); ex.getResponseBody().write(b); ex.close(); });
        s.start();
        try {
            Dlna.Tv tv = Dlna.descrever("http://127.0.0.1:" + porta + "/dmr.xml");
            ok(tv != null, "descreveu");
            ok(tv.nome.equals("[TV] Samsung Sala"), "nome " + tv.nome);
            ok(tv.controle.equals("http://127.0.0.1:" + porta + "/upnp/control/AVTransport1"), "controle " + tv.controle);
            Dlna.tocar(tv, "http://147.15.28.222/tv/abc.def/video.ts", "http://147.15.28.222/tv/abc.def/legenda.srt", "Black Clover T2E2 & cia");
            ok(acoes.size() == 3 && acoes.get(1).endsWith("#SetAVTransportURI\"") && acoes.get(2).endsWith("#Play\""), "acoes " + acoes);
            String set = corpos.get(1);
            ok(set.contains("<CurrentURI>http://147.15.28.222/tv/abc.def/video.ts</CurrentURI>"), "uri");
            ok(set.contains("&lt;DIDL-Lite") && set.contains("video/mp2t") && set.contains("CaptionInfoEx") && set.contains("Black Clover T2E2 &amp;amp; cia"), "didl " + set);
            Dlna.comando(tv, "pausar");
            ok(acoes.get(3).endsWith("#Pause\""), "pausa");
            ok(!Dlna.redeLocal("http://8.8.8.8/x") && Dlna.redeLocal("http://192.168.0.10:9197/x") && !Dlna.redeLocal("https://192.168.0.1/"), "rede local");
            ok(Dlna.desfazerChunked("5\r\nhello\r\n6\r\n world\r\n0\r\n\r\n").equals("hello world"), "chunked");
            ok(Dlna.json(java.util.List.of(tv)).contains("\"nome\":\"[TV] Samsung Sala\""), "json");
            System.out.println("OK");
        } finally { s.stop(0); }
    }
}
