// Listas de canais ao vivo do Conecta TV — o mesmo conteúdo no computador e no
// aplicativo do celular/TV.
//
// As listas do projeto iptv-org são públicas, grátis e sem anúncio. O caçador
// da central mede cada uma (quantos canais respondem, qualidade, velocidade) e
// pode acrescentar listas novas sem ninguém mexer no código: elas chegam pelo
// arquivo de fichas publicado pela central.
(function (root) {
    'use strict';
    const LISTAS = [
        { id: 'brasil', nome: 'Canais do Brasil', url: 'https://iptv-org.github.io/iptv/countries/br.m3u', nota: 9.0 },
        { id: 'portugues', nome: 'Canais em português', url: 'https://iptv-org.github.io/iptv/languages/por.m3u', nota: 8.5 },
        { id: 'esportes', nome: 'Esportes', url: 'https://iptv-org.github.io/iptv/categories/sports.m3u', nota: 9.8 },
        { id: 'noticias', nome: 'Notícias', url: 'https://iptv-org.github.io/iptv/categories/news.m3u', nota: 10 },
        { id: 'latam', nome: 'América Latina', url: 'https://iptv-org.github.io/iptv/regions/latam.m3u', nota: 9.5 },
        { id: 'filmes', nome: 'Filmes (TV aberta)', url: 'https://iptv-org.github.io/iptv/categories/movies.m3u', nota: 8.0 },
        { id: 'series', nome: 'Séries (TV aberta)', url: 'https://iptv-org.github.io/iptv/categories/series.m3u', nota: 8.0 },
        { id: 'infantil', nome: 'Infantil', url: 'https://iptv-org.github.io/iptv/categories/kids.m3u', nota: 8.5 },
        { id: 'animacao', nome: 'Animação', url: 'https://iptv-org.github.io/iptv/categories/animation.m3u', nota: 8.0 },
        { id: 'musica', nome: 'Música', url: 'https://iptv-org.github.io/iptv/categories/music.m3u', nota: 8.5 },
        { id: 'documentarios', nome: 'Documentários', url: 'https://iptv-org.github.io/iptv/categories/documentary.m3u', nota: 8.5 },
        { id: 'ciencia', nome: 'Ciência', url: 'https://iptv-org.github.io/iptv/categories/science.m3u', nota: 8.0 },
        { id: 'cultura', nome: 'Cultura', url: 'https://iptv-org.github.io/iptv/categories/culture.m3u', nota: 8.0 },
        { id: 'comedia', nome: 'Comédia', url: 'https://iptv-org.github.io/iptv/categories/comedy.m3u', nota: 8.0 },
        { id: 'familia', nome: 'Família', url: 'https://iptv-org.github.io/iptv/categories/family.m3u', nota: 8.0 },
        { id: 'viagens', nome: 'Viagens e lazer', url: 'https://iptv-org.github.io/iptv/categories/travel.m3u', nota: 7.5 },
        { id: 'culinaria', nome: 'Culinária', url: 'https://iptv-org.github.io/iptv/categories/cooking.m3u', nota: 7.5 },
        { id: 'clima', nome: 'Previsão do tempo', url: 'https://iptv-org.github.io/iptv/categories/weather.m3u', nota: 7.5 },
        { id: 'eua-espanhol', nome: 'EUA em espanhol', url: 'https://iptv-org.github.io/iptv/countries/us.m3u', nota: 7.0 }
    ];

    // Junta as listas do aplicativo com as que o caçador aprovou (sem repetir).
    function comExtras(extras) {
        const juntas = [...LISTAS];
        const vistos = new Set(LISTAS.map(l => l.id));
        for (const lista of Array.isArray(extras) ? extras : []) {
            if (!lista || !lista.url || !lista.id) continue;
            if (vistos.has(lista.id)) continue;
            vistos.add(lista.id);
            juntas.push({
                id: String(lista.id).slice(0, 40),
                nome: String(lista.nome || lista.id).slice(0, 60),
                url: String(lista.url),
                nota: Number(lista.nota) || 0,
                doCacador: true,
            });
        }
        return juntas.sort((a, b) => (Number(b.nota) || 0) - (Number(a.nota) || 0));
    }

    root.StreamListasTv = { LISTAS, comExtras };
    if (typeof module !== 'undefined' && module.exports) module.exports = root.StreamListasTv;
})(typeof globalThis !== 'undefined' ? globalThis : this);
