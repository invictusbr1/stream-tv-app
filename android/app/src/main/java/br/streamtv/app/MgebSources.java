package br.streamtv.app;

import java.net.URL;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Seleção das opções MGEB, sem dependência de WebView ou de rede. */
final class MgebSources {
    private static final int MAX_CANDIDATES = 3;
    private static final Pattern HEIGHT = Pattern.compile("\\b(2160|1440|1080|720|576|540|480|360|240|180)\\s*p\\b", Pattern.CASE_INSENSITIVE);
    private static final Pattern NUMERIC_HEIGHT = Pattern.compile("^(2160|1440|1080|720|576|540|480|360|240|180)$");

    static final class Source {
        final String url;
        final boolean file;
        final int height;
        private Source(String url, boolean file, int height) {
            this.url = url;
            this.file = file;
            this.height = height;
        }
    }

    static Source parse(String raw, String label) {
        try {
            URL original = new URL(String.valueOf(raw == null ? "" : raw).trim().replace("&amp;", "&"));
            String protocol = original.getProtocol();
            if (!("http".equalsIgnoreCase(protocol) || "https".equalsIgnoreCase(protocol)) || original.getUserInfo() != null) return null;
            String path = original.toURI().normalize().getRawPath();
            // URI conserva um '..' acima da raiz; o servidor usa esse formato
            // no HTML antigo. Não toca na query de endereços assinados.
            while (path.startsWith("/../")) path = path.substring(3);
            String lowered = path.toLowerCase(java.util.Locale.ROOT);
            boolean file = lowered.endsWith(".mp4");
            if (!file && !lowered.endsWith(".m3u8")) return null;
            int port = original.getPort() == 80 ? -1 : original.getPort();
            String query = original.getQuery() == null ? "" : "?" + original.getQuery();
            String normalized = new URL("https", original.getHost(), port, path + query).toString();
            String text = label == null ? "" : label.trim();
            Matcher height = HEIGHT.matcher(text);
            if (!height.find()) {
                height = NUMERIC_HEIGHT.matcher(text);
                if (!height.find()) return new Source(normalized, file, 0);
            }
            return new Source(normalized, file, Integer.parseInt(height.group(1)));
        } catch (Exception error) { return null; }
    }

    static List<Source> order(List<Source> sources) {
        List<Source> ordered = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        for (Source source : sources) if (source != null && seen.add(source.url)) ordered.add(source);
        // Collections.sort é estável: sem altura, mantém a ordem original de
        // cada formato, com MP4 antes de HLS como no resolvedor do computador.
        Collections.sort(ordered, new Comparator<Source>() {
            @Override public int compare(Source a, Source b) {
                int quality = Integer.compare(b.height, a.height);
                if (quality != 0) return quality;
                return Boolean.compare(b.file, a.file);
            }
        });
        return ordered;
    }

    interface Resolver<T> { T resolve(Source source) throws Exception; }

    static <T> T firstWorking(List<Source> sources, Resolver<T> resolver) {
        List<Source> ordered = order(sources);
        for (int i = 0; i < Math.min(MAX_CANDIDATES, ordered.size()); i++) {
            try {
                T result = resolver.resolve(ordered.get(i));
                if (result != null) return result;
            } catch (Exception error) { /* segue para a próxima opção */ }
        }
        return null;
    }
}
