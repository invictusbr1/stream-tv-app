package br.streamtv.app;

import java.util.Collections;
import java.util.HashSet;
import java.util.Set;

/** IDs compartilhados com o player: evita tentar de novo a mesma fonte. */
final class PlaybackSources {
    static Set<String> exclusions(String raw) {
        if (raw == null || raw.length() > 2048) return Collections.emptySet();
        Set<String> result = new HashSet<>();
        for (String value : raw.split(",")) {
            String id = value.trim();
            if (id.matches("[a-z0-9_-]{1,64}")) result.add(id);
        }
        return result;
    }
    static String idFor(String name) {
        if ("WatchPlay".equals(name)) return "watchplay";
        if ("PipocaCine".equals(name)) return "pipoca";
        if ("MGEB · dublado".equals(name)) return "mgeb";
        if ("HD com legenda em português".equals(name)) return "vixsrc";
        return "";
    }
}
