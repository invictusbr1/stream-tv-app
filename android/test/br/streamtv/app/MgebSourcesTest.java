package br.streamtv.app;

import java.io.IOException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

public final class MgebSourcesTest {
    private static void check(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }
    private static MgebSources.Source source(String file, String label) {
        MgebSources.Source result = MgebSources.parse("https://cdn.test/" + file, label);
        check(result != null, "fixture must be media");
        return result;
    }
    public static void main(String[] args) {
        switch (args[0]) {
            case "quality": {
                List<MgebSources.Source> ordered = MgebSources.order(Arrays.asList(
                    source("720.mp4", "720p"), source("1080.m3u8", "Dublado 1080p"),
                    source("1080.mp4", "1080"), source("unknown.mp4", "Opção 1")));
                check(ordered.get(0).url.endsWith("1080.mp4"), "MP4 wins equal declared resolution");
                check(ordered.get(1).url.endsWith("1080.m3u8"), "higher declared HLS precedes lower MP4");
                check(ordered.get(2).height == 720, "declared lower resolution follows");
                check(ordered.get(3).height == 0, "unknown quality is not invented");
                break;
            }
            case "legacy": {
                List<MgebSources.Source> ordered = MgebSources.order(Arrays.asList(
                    source("first.m3u8", "Opção 1"), source("first.mp4", "Opção 2"), source("second.mp4", "Opção 3")));
                check(ordered.get(0).url.endsWith("first.mp4"), "unlabelled MP4 remains preferred");
                check(ordered.get(1).url.endsWith("second.mp4"), "same-format order remains stable");
                check(ordered.get(2).url.endsWith("first.m3u8"), "legacy HLS remains fallback");
                break;
            }
            case "normalization": {
                MgebSources.Source normalized = MgebSources.parse("http://mgeb.top:80/../cache/./video.mp4?token=/../keep&amp;k=1", "720p");
                check(normalized != null && normalized.url.equals("https://mgeb.top/cache/video.mp4?token=/../keep&k=1"), "HTTPS/path normalization must preserve signed query");
                check(MgebSources.parse("ftp://cdn.test/a.mp4", "1080p") == null, "non-HTTP schemes refused");
                check(MgebSources.parse("https://user:password@cdn.test/a.mp4", "1080p") == null, "embedded credentials refused");
                check(MgebSources.parse("https://cdn.test/embed.html?x=a.mp4", "1080p") == null, "media-looking query is not media");
                break;
            }
            case "fallback": {
                List<String> attempts = new ArrayList<>();
                String result = MgebSources.firstWorking(Arrays.asList(source("backup.m3u8", "Opção 2"), source("broken.mp4", "Opção 1")), candidate -> {
                    attempts.add(candidate.url);
                    if (candidate.file) throw new IOException("unavailable MP4");
                    return "playing HLS";
                });
                check("playing HLS".equals(result), "failed MP4 must not suppress working HLS");
                check(attempts.size() == 2 && attempts.get(0).endsWith("broken.mp4"), "legacy preference plus fallback");
                break;
            }
            case "budget": {
                List<String> attempts = new ArrayList<>();
                MgebSources.Source first = source("1.mp4", "");
                String result = MgebSources.firstWorking(Arrays.asList(first, first, source("2.mp4", ""), source("3.mp4", ""), source("4.mp4", "")), candidate -> {
                    attempts.add(candidate.url);
                    return candidate.url.endsWith("4.mp4") ? "must not be reached" : null;
                });
                check(result == null, "only three unique candidates may be tried");
                check(attempts.size() == 3 && attempts.get(2).endsWith("3.mp4"), "duplicate must not consume a slot");
                break;
            }
            case "success": {
                List<String> attempts = new ArrayList<>();
                String result = MgebSources.firstWorking(Arrays.asList(source("first.mp4", "720p"), source("backup.m3u8", "720p")), candidate -> {
                    attempts.add(candidate.url);
                    return "playing";
                });
                check("playing".equals(result) && attempts.size() == 1, "success must stop further requests");
                break;
            }
            default: throw new AssertionError("unknown test");
        }
    }
}
