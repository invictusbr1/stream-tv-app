package br.streamtv.app;

import java.net.URI;
import java.util.Collections;
import java.util.Set;

/** Fonte de anime isolada: o player público renova o vídeo no próprio contexto. */
final class AnimeSource {
    static final long BUDGET_MS = 20000;
    static final String SUPPLIER_ID = "meus-animes";

    static final class Request {
        final int id, season, episode;
        final String audio;
        private Request(int id, int season, int episode, String audio) {
            this.id = id; this.season = season; this.episode = episode; this.audio = audio;
        }
    }

    static Request request(String type, String id, String season, String episode, String audio) {
        try {
            if (type != null && !"tv".equals(type)) return null;
            if (id == null || !id.matches("[1-9][0-9]{0,9}") || season == null || !season.matches("[1-9][0-9]{0,2}") || episode == null || !episode.matches("[1-9][0-9]{0,3}")) return null;
            String language = audio == null ? "legendado" : audio;
            if (!"legendado".equals(language) && !"dublado".equals(language)) return null;
            return new Request(Integer.parseInt(id), Integer.parseInt(season), Integer.parseInt(episode), language);
        } catch (NumberFormatException failure) { return null; }
    }

    static final class Title {
        final int id;
        final boolean animation;
        final Set<String> countries;
        final String language;
        Title(int id, boolean animation, Set<String> countries, String language) {
            this.id = id; this.animation = animation;
            this.countries = countries == null ? Collections.emptySet() : countries;
            this.language = language == null ? "" : language;
        }
    }

    static boolean isAnime(Title title) {
        return title != null && title.animation && (title.countries.contains("JP") || title.countries.contains("KR") || "ja".equals(title.language));
    }

    interface Catalog {
        Title title(int id, long deadline) throws Exception;
        int[] episodes(int id, int season, long deadline) throws Exception;
    }
    interface Player { String video(int id, int season, int episode, long deadline) throws Exception; }
    interface Clock { long now(); }

    static final class Result {
        final String url, page;
        final int season, episode;
        private Result(String url, String page, Request request) {
            this.url = url; this.page = page; this.season = request.season; this.episode = request.episode;
        }
    }

    static Result resolve(Request request, Catalog catalog, Player player, Clock clock) {
        // Não introduz uma fonte presumida dublada: a escolha usa as fontes existentes.
        if (request == null || !"legendado".equals(request.audio) || (request.id != 37854 && request.id != 127532)) return null;
        long deadline = clock.now() + BUDGET_MS;
        try {
            Title title = catalog.title(request.id, deadline);
            if (clock.now() >= deadline || !isAnime(title) || title.id != request.id) return null;
            int[] numbers = catalog.episodes(request.id, request.season, deadline);
            if (clock.now() >= deadline || !contains(numbers, request.episode)) return null;
            int sourceSeason = 1, sourceEpisode = request.episode;
            String slug = "one-piece";
            if (request.id == 37854 && request.season > 1 && request.episode <= 61) return null;
            if (request.id == 127532) {
                // TMDB tem 25 episódios na T1; o catálogo separa em 12 + 13.
                if (request.season != 1 || request.episode > 25) return null;
                slug = "solo-leveling";
                if (sourceEpisode > 12) { sourceSeason = 2; sourceEpisode -= 12; }
            }
            // One Piece usa numeração absoluta. Nunca soma temporadas nem troca E1 por outro episódio.
            String video = player.video(request.id, sourceSeason, sourceEpisode, deadline);
            if (clock.now() >= deadline || !blogger(video)) return null;
            String page = "https://meusanimes.blog/e/" + slug + "-" + sourceSeason + "-episodio-" + sourceEpisode + "/";
            return new Result(video, page, request);
        } catch (Exception unavailable) { return null; }
    }

    private static boolean contains(int[] numbers, int value) {
        if (numbers != null) for (int number : numbers) if (number == value) return true;
        return false;
    }

    static String api(int id, int season, int episode) {
        return "https://serv01.meusdoramas.club/posts/get-video.php?episode_number=" + episode + "&season_number=" + season + "&tmdb=" + id;
    }

    static boolean blogger(String value) {
        try {
            if (value == null || value.length() > 4096) return false;
            URI uri = new URI(value);
            if (!"https".equals(uri.getScheme()) || uri.getUserInfo() != null || uri.getPort() != -1 || uri.getFragment() != null) return false;
            if (!"www.blogger.com".equals(uri.getHost()) || !"/video.g".equals(uri.getRawPath())) return false;
            String query = uri.getRawQuery();
            return query != null && query.matches("token=[A-Za-z0-9_-]{20,2048}");
        } catch (Exception invalid) { return false; }
    }
}
