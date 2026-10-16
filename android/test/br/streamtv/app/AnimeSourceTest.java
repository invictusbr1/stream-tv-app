package br.streamtv.app;

import java.util.Arrays;
import java.util.HashSet;

public final class AnimeSourceTest {
    private static final String BLOGGER = "https://www.blogger.com/video.g?token=public_fixture_token_123456789";
    private static void check(boolean condition, String message) { if (!condition) throw new AssertionError(message); }
    private static AnimeSource.Request request(int id, int season, int episode) {
        return AnimeSource.request("tv", String.valueOf(id), String.valueOf(season), String.valueOf(episode), "legendado");
    }
    private static final class Fixture implements AnimeSource.Catalog, AnimeSource.Player, AnimeSource.Clock {
        int titleCalls, episodeCalls, playerCalls, sourceSeason, sourceEpisode;
        long time;
        boolean animation = true;
        String country = "JP", language = "ja", url = BLOGGER;
        int[] numbers = {1};
        public long now() { return time; }
        public AnimeSource.Title title(int id, long deadline) { titleCalls++; return new AnimeSource.Title(id, animation, new HashSet<>(Arrays.asList(country)), language); }
        public int[] episodes(int id, int season, long deadline) { episodeCalls++; return numbers; }
        public String video(int id, int season, int episode, long deadline) { playerCalls++; sourceSeason = season; sourceEpisode = episode; return url; }
        AnimeSource.Result resolve(AnimeSource.Request request) { return AnimeSource.resolve(request, this, this, this); }
    }
    public static void main(String[] args) {
        Fixture f = new Fixture();
        switch (args[0]) {
            case "validation":
                check(AnimeSource.request("movie", "37854", "1", "1", "legendado") == null, "movies cannot request the anime provider");
                check(AnimeSource.request("tv", "37854", "1", "0", "legendado") == null, "zero episode is invalid");
                check(AnimeSource.request("tv", "37854", "1", "1", "fr") == null, "unknown audio is rejected");
                check(AnimeSource.request(null, "37854", "1", "1", null) != null, "default selects subtitled TV");
                check(AnimeSource.request("tv", "9999999999", "1", "1", "legendado") == null, "ID overflow is rejected");
                break;
            case "isolation":
                check(f.resolve(request(1399, 1, 1)) == null && f.titleCalls == 0, "unsupported TV never contacts provider");
                check(f.resolve(AnimeSource.request("tv", "37854", "1", "1", "dublado")) == null && f.titleCalls == 0, "dubbed choice does not accidentally select original audio");
                f.animation = false;
                check(f.resolve(request(37854, 1, 1)) == null && f.playerCalls == 0, "non-animation never contacts provider");
                f.animation = true; f.country = "US"; f.language = "en";
                check(f.resolve(request(37854, 1, 1)) == null && f.playerCalls == 0, "western animation is not assumed anime");
                break;
            case "one-piece": {
                f.numbers = new int[]{1156, 1180};
                AnimeSource.Result r = f.resolve(request(37854, 23, 1180));
                check(r != null && f.sourceSeason == 1 && f.sourceEpisode == 1180, "TMDB global episode maps to provider season one without adding offsets");
                check(r.season == 23 && r.episode == 1180 && r.page.endsWith("one-piece-1-episodio-1180/"), "response preserves original episode coordinates");
                check(f.resolve(request(37854, 23, 1)) == null && f.playerCalls == 1, "ambiguous local number is never mapped to global episode one");
                break;
            }
            case "solo": {
                f.numbers = new int[]{1, 12, 13, 25};
                AnimeSource.Result r = f.resolve(request(127532, 1, 13));
                check(r != null && f.sourceSeason == 2 && f.sourceEpisode == 1 && r.season == 1 && r.episode == 13, "provider T2E1 is app TMDB T1E13");
                r = f.resolve(request(127532, 1, 25));
                check(r != null && f.sourceSeason == 2 && f.sourceEpisode == 13, "last verified split episode maps correctly");
                r = f.resolve(request(127532, 1, 12));
                check(r != null && f.sourceSeason == 1 && f.sourceEpisode == 12, "first part stays literal");
                check(f.resolve(request(127532, 2, 1)) == null && f.playerCalls == 3, "unsupported TMDB season is not guessed from provider numbering");
                break;
            }
            case "allowlist":
                check(AnimeSource.blogger(BLOGGER), "only public Blogger embed is accepted");
                for (String bad : Arrays.asList("http://www.blogger.com/video.g?token=public_fixture_token", "https://www.blogger.com.evil.test/video.g?token=public_fixture_token", "https://user@www.blogger.com/video.g?token=public_fixture_token", "https://www.blogger.com:444/video.g?token=public_fixture_token", "https://www.blogger.com/video.g?token=public_fixture_token&redirect=http%3A%2F%2Flocalhost", "https://www.blogger.com/video.g?token=public_fixture_token#fragment", "https://r1.googlevideo.com/videoplayback?token=public_fixture_token")) check(!AnimeSource.blogger(bad), "unexpected host, scheme or path must not enter player");
                f.url = "https://r1.googlevideo.com/videoplayback";
                check(f.resolve(request(37854, 1, 1)) == null, "direct temporary video is never used as embed");
                break;
            case "deadline": {
                AnimeSource.Catalog slow = new AnimeSource.Catalog() {
                    public AnimeSource.Title title(int id, long deadline) { f.time = deadline; return f.title(id, deadline); }
                    public int[] episodes(int id, int season, long deadline) { throw new AssertionError("deadline must prevent next request"); }
                };
                check(AnimeSource.resolve(request(37854, 1, 1), slow, f, f) == null && f.playerCalls == 0, "global budget stops the request before provider lookup");
                break;
            }
            case "not-found":
                f.numbers = new int[]{2};
                check(f.resolve(request(37854, 1, 1)) == null && f.playerCalls == 0, "TMDB missing episode must prevent wrong provider episode");
                f.numbers = new int[]{1}; f.url = null;
                check(f.resolve(request(37854, 1, 1)) == null, "provider unavailable is a clean absence");
                break;
            default: throw new AssertionError("unknown scenario");
        }
    }
}
