package br.streamtv.app;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.net.SocketTimeoutException;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * "Assistir na TV" sem o app na TV (08/11/2026): DLNA/UPnP. Acha as TVs do
 * Wi-Fi (SSDP) e manda tocar um link (AVTransport). Só fala com aparelhos da
 * rede local (endereços privados) e por socket simples — a TV não fala HTTPS.
 * Java puro, sem Android: o MainActivity só liga o multicast e chama aqui.
 */
final class Dlna {
    static final class Tv {
        final String id, nome, fabricante, controle, local;
        Tv(String id, String nome, String fabricante, String controle, String local) { this.id = id; this.nome = nome; this.fabricante = fabricante; this.controle = controle; this.local = local; }
    }
    private static final Map<String, Tv> conhecidas = new LinkedHashMap<>();
    private static final String AVT = "urn:schemas-upnp-org:service:AVTransport:1";

    private Dlna() {}

    static synchronized Tv tv(String id) { return conhecidas.get(id); }

    /** Procura por até {@code ms} milissegundos. */
    static List<Tv> procurar(int ms) throws IOException {
        Set<String> locais = new LinkedHashSet<>();
        try (DatagramSocket socket = new DatagramSocket()) {
            socket.setSoTimeout(400);
            InetAddress grupo = InetAddress.getByName("239.255.255.250");
            for (String st : new String[]{"urn:schemas-upnp-org:device:MediaRenderer:1", AVT}) {
                byte[] pedido = ("M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: \"ssdp:discover\"\r\nMX: 2\r\nST: " + st + "\r\n\r\n").getBytes(StandardCharsets.US_ASCII);
                socket.send(new DatagramPacket(pedido, pedido.length, grupo, 1900));
            }
            long fim = System.currentTimeMillis() + ms;
            byte[] buf = new byte[4096];
            while (System.currentTimeMillis() < fim) {
                DatagramPacket p = new DatagramPacket(buf, buf.length);
                try { socket.receive(p); } catch (SocketTimeoutException nada) { continue; }
                String resp = new String(p.getData(), 0, p.getLength(), StandardCharsets.UTF_8);
                String local = cabecalho(resp, "LOCATION");
                if (local != null && redeLocal(local)) locais.add(local.trim());
            }
        }
        List<Tv> achadas = new ArrayList<>();
        for (String local : locais) {
            try { Tv t = descrever(local); if (t != null) achadas.add(t); } catch (Exception semResposta) { /* aparelho não respondeu */ }
        }
        synchronized (Dlna.class) { for (Tv t : achadas) conhecidas.put(t.id, t); }
        return achadas;
    }

    static Tv descrever(String local) throws IOException {
        String xml = http("GET", local, null, null, 3000);
        if (xml == null) return null;
        String nome = tag(xml, "friendlyName"), fab = tag(xml, "manufacturer");
        String base = tag(xml, "URLBase");
        String controle = null;
        Matcher servicos = Pattern.compile("<service>(.*?)</service>", Pattern.DOTALL | Pattern.CASE_INSENSITIVE).matcher(xml);
        while (servicos.find()) {
            String s = servicos.group(1);
            if (s.contains("AVTransport")) { controle = tag(s, "controlURL"); break; }
        }
        if (controle == null) return null;
        String absoluto = URI.create(base != null && !base.isEmpty() ? base : local).resolve(controle.trim()).toString();
        if (!redeLocal(absoluto)) return null;
        return new Tv(idDe(local), nome == null || nome.isEmpty() ? "TV" : limpar(nome), fab == null ? "" : limpar(fab), absoluto, local);
    }

    static void tocar(Tv tv, String video, String legenda, String titulo) throws IOException {
        try { soap(tv, "Stop", "<InstanceID>0</InstanceID>"); } catch (IOException nadaTocando) { /* normal */ }
        soap(tv, "SetAVTransportURI", "<InstanceID>0</InstanceID><CurrentURI>" + xml(video) + "</CurrentURI><CurrentURIMetaData>" + xml(didl(video, legenda, titulo)) + "</CurrentURIMetaData>");
        soap(tv, "Play", "<InstanceID>0</InstanceID><Speed>1</Speed>");
    }

    static void comando(Tv tv, String acao) throws IOException {
        switch (acao) {
            case "pausar": soap(tv, "Pause", "<InstanceID>0</InstanceID>"); break;
            case "continuar": soap(tv, "Play", "<InstanceID>0</InstanceID><Speed>1</Speed>"); break;
            case "parar": soap(tv, "Stop", "<InstanceID>0</InstanceID>"); break;
            default: throw new IOException("ação desconhecida");
        }
    }

    static String didl(String video, String legenda, String titulo) {
        String l = legenda == null ? "" : legenda;
        String res = "<res protocolInfo=\"http-get:*:video/mp2t:DLNA.ORG_OP=00;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01700000000000000000000000000000\""
                + (l.isEmpty() ? "" : " pv:subtitleFileUri=\"" + xml(l) + "\" pv:subtitleFileType=\"srt\"") + ">" + xml(video) + "</res>";
        String sub = l.isEmpty() ? "" : "<res protocolInfo=\"http-get:*:text/srt:*\">" + xml(l) + "</res><sec:CaptionInfoEx sec:type=\"srt\">" + xml(l) + "</sec:CaptionInfoEx><sec:CaptionInfo sec:type=\"srt\">" + xml(l) + "</sec:CaptionInfo>";
        return "<DIDL-Lite xmlns=\"urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/\" xmlns:dc=\"http://purl.org/dc/elements/1.1/\" xmlns:upnp=\"urn:schemas-upnp-org:metadata-1-0/upnp/\" xmlns:sec=\"http://www.sec.co.kr/\" xmlns:pv=\"http://www.pv.com/pvns/\" xmlns:dlna=\"urn:schemas-dlna-org:metadata-1-0/\">"
                + "<item id=\"0\" parentID=\"-1\" restricted=\"1\"><dc:title>" + xml(titulo == null || titulo.isEmpty() ? "Conecta TV" : titulo) + "</dc:title><upnp:class>object.item.videoItem.movie</upnp:class>" + res + sub + "</item></DIDL-Lite>";
    }

    private static void soap(Tv tv, String acao, String corpo) throws IOException {
        String env = "<?xml version=\"1.0\" encoding=\"utf-8\"?><s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\" s:encodingStyle=\"http://schemas.xmlsoap.org/soap/encoding/\"><s:Body><u:" + acao + " xmlns:u=\"" + AVT + "\">" + corpo + "</u:" + acao + "></s:Body></s:Envelope>";
        Map<String, String> cab = new LinkedHashMap<>();
        cab.put("Content-Type", "text/xml; charset=\"utf-8\"");
        cab.put("SOAPAction", "\"" + AVT + "#" + acao + "\"");
        String r = http("POST", tv.controle, cab, env, 6000);
        if (r == null) throw new IOException("a TV recusou " + acao);
    }

    /** HTTP/1.1 mínimo por socket (só rede local). Devolve o corpo se 2xx; null se não. */
    static String http(String metodo, String url, Map<String, String> cab, String corpo, int ms) throws IOException {
        if (!redeLocal(url)) throw new IOException("fora da rede local");
        URI u = URI.create(url);
        int porta = u.getPort() > 0 ? u.getPort() : 80;
        String caminho = (u.getRawPath() == null || u.getRawPath().isEmpty() ? "/" : u.getRawPath()) + (u.getRawQuery() == null ? "" : "?" + u.getRawQuery());
        byte[] dados = corpo == null ? new byte[0] : corpo.getBytes(StandardCharsets.UTF_8);
        try (Socket s = new Socket()) {
            s.connect(new InetSocketAddress(u.getHost(), porta), ms);
            s.setSoTimeout(ms);
            StringBuilder req = new StringBuilder(metodo + " " + caminho + " HTTP/1.1\r\nHost: " + u.getHost() + ":" + porta + "\r\nConnection: close\r\nUser-Agent: ConectaTV/1 UPnP/1.0\r\n");
            if (cab != null) for (Map.Entry<String, String> e : cab.entrySet()) req.append(e.getKey()).append(": ").append(e.getValue()).append("\r\n");
            if (corpo != null) req.append("Content-Length: ").append(dados.length).append("\r\n");
            req.append("\r\n");
            OutputStream out = s.getOutputStream();
            out.write(req.toString().getBytes(StandardCharsets.UTF_8)); out.write(dados); out.flush();
            InputStream in = s.getInputStream();
            ByteArrayOutputStream tudo = new ByteArrayOutputStream();
            byte[] b = new byte[8192]; int n;
            while ((n = in.read(b)) > 0) { tudo.write(b, 0, n); if (tudo.size() > 512 * 1024) break; }
            String resp = new String(tudo.toByteArray(), StandardCharsets.UTF_8);
            int fimCab = resp.indexOf("\r\n\r\n");
            if (fimCab < 0) return null;
            String cabecalhos = resp.substring(0, fimCab);
            Matcher st = Pattern.compile("^HTTP/1\\.[01] (\\d{3})").matcher(cabecalhos);
            if (!st.find()) return null;
            int codigo = Integer.parseInt(st.group(1));
            String body = resp.substring(fimCab + 4);
            if ("chunked".equalsIgnoreCase(String.valueOf(cabecalho(cabecalhos, "Transfer-Encoding")).trim())) body = desfazerChunked(body);
            return codigo >= 200 && codigo < 300 ? body : null;
        }
    }

    static String desfazerChunked(String s) {
        StringBuilder out = new StringBuilder(); int i = 0;
        while (i < s.length()) {
            int fim = s.indexOf("\r\n", i); if (fim < 0) break;
            int tam; try { tam = Integer.parseInt(s.substring(i, fim).split(";")[0].trim(), 16); } catch (NumberFormatException e) { break; }
            if (tam == 0) break;
            int ini = fim + 2; if (ini + tam > s.length()) { out.append(s.substring(ini)); break; }
            out.append(s, ini, ini + tam); i = ini + tam + 2;
        }
        return out.toString();
    }

    /** Só endereços da casa: 10.x, 172.16-31.x, 192.168.x (e 127.x para teste). */
    static boolean redeLocal(String url) {
        try {
            URI u = URI.create(url.trim());
            if (!"http".equalsIgnoreCase(u.getScheme()) || u.getHost() == null) return false;
            Matcher m = Pattern.compile("^(\\d{1,3})\\.(\\d{1,3})\\.\\d{1,3}\\.\\d{1,3}$").matcher(u.getHost());
            if (!m.find()) return false;
            int a = Integer.parseInt(m.group(1)), b = Integer.parseInt(m.group(2));
            return a == 10 || a == 127 || (a == 192 && b == 168) || (a == 172 && b >= 16 && b <= 31);
        } catch (Exception e) { return false; }
    }

    static String cabecalho(String texto, String nome) {
        Matcher m = Pattern.compile("(?im)^" + Pattern.quote(nome) + ":\\s*(.+?)\\s*$").matcher(texto);
        return m.find() ? m.group(1) : null;
    }
    static String tag(String xml, String nome) {
        Matcher m = Pattern.compile("<(?:\\w+:)?" + nome + "[^>]*>(.*?)</(?:\\w+:)?" + nome + ">", Pattern.DOTALL | Pattern.CASE_INSENSITIVE).matcher(xml);
        return m.find() ? m.group(1).trim() : null;
    }
    static String xml(String s) { return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;"); }
    private static String limpar(String s) { return s.replaceAll("&amp;", "&").replaceAll("[<>\"]", "").trim(); }
    static String idDe(String local) {
        try { byte[] h = MessageDigest.getInstance("SHA-1").digest(local.getBytes(StandardCharsets.UTF_8)); StringBuilder sb = new StringBuilder(); for (int i = 0; i < 6; i++) sb.append(String.format(Locale.ROOT, "%02x", h[i])); return sb.toString(); }
        catch (Exception e) { return Integer.toHexString(local.hashCode()); }
    }
    static synchronized void lembrar(Tv tv) { conhecidas.put(tv.id, tv); }

    /** JSON da lista para a página. */
    static String json(List<Tv> tvs) {
        StringBuilder sb = new StringBuilder("[");
        for (int i = 0; i < tvs.size(); i++) {
            Tv t = tvs.get(i); if (i > 0) sb.append(',');
            sb.append("{\"id\":\"").append(t.id).append("\",\"nome\":\"").append(js(t.nome)).append("\",\"fabricante\":\"").append(js(t.fabricante)).append("\"}");
        }
        return sb.append(']').toString();
    }
    private static String js(String s) { StringBuilder sb = new StringBuilder(); for (char c : s.toCharArray()) { if (c == '"' || c == '\\') sb.append('\\').append(c); else if (c < 0x20) sb.append(' '); else sb.append(c); } return sb.toString(); }
}
