package br.streamtv.app;
import java.net.URI;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

final class La18Source {
    static boolean httpsPort(int port) { return port == -1 || port == 443; }
    static final String PAGE = "https://la18hd.su/vivo/canales.php?stream=premiere1";
    static String extract(String html) {
        try {
            Matcher m = Pattern.compile("var\\s+playbackURL\\s*=\\s*[\"']([^\"']+)[\"']").matcher(html == null ? "" : html);
            if (!m.find()) return "";
            URI u = new URI(m.group(1));
            String host = u.getHost();
            if (!"https".equals(u.getScheme()) || u.getUserInfo() != null || u.getFragment() != null ||
                (u.getPort() != -1 && u.getPort() != 443) || host == null ||
                !host.toLowerCase(java.util.Locale.ROOT).matches("(?:[a-z0-9-]+\\.)*fubo18\\.com") ||
                !"/premiere1/mono.m3u8".equals(u.getPath())) return "";
            return u.toString();
        } catch (Exception e) { return ""; }
    }
    static boolean playlist(String text) {
        return text != null && text.trim().startsWith("#EXTM3U") && text.contains("#EXTINF:");
    }
}
