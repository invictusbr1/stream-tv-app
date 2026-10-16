// Listas de canais ao vivo do Conecta TV — o mesmo conteúdo no computador e no
// aplicativo do celular/TV.
//
// As listas do projeto iptv-org são públicas e gratuitas. O caçador
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


    function textoBusca(s) { return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); }
    function gruposTv(grupo, nome, lista) {
        const partes=String(grupo||'').split(';').map(p=>textoBusca(p.trim())).filter(p=>p&&p!=='undefined');
        const aliases={esportes:'sports',noticias:'news',filmes:'movies',series:'series',infantil:'kids',musica:'music',documentarios:'documentary',geral:'general'};
        if(partes.length)return [...new Set(partes.map(p=>aliases[p]||p))];
        const fallback={esportes:'sports',noticias:'news',filmes:'movies',series:'series',infantil:'kids',animacao:'animation',musica:'music',documentarios:'documentary',ciencia:'science',cultura:'culture',comedia:'comedy',familia:'family',viagens:'travel',culinaria:'cooking',clima:'weather'};
        if(fallback[lista])return [fallback[lista]];
        if(/sport|esporte|futebol|xsports|espn/.test(textoBusca(nome)))return ['sports'];
        if(/news|noticias|cnn|bandnews/.test(textoBusca(nome)))return ['news'];
        return ['general'];
    }
    function parseM3u(texto, lista) {
        const canais=[],vistos=new Set();let info='';
        for(const raw of String(texto||'').split(/\r?\n/)) {
            const linha=raw.trim();
            if(/^#EXTINF/i.test(linha)){info=linha;continue;}
            if(!linha||linha.startsWith('#'))continue;
            if(!info)continue;
            const meta=info;info='';let url;
            try { url=new URL(linha);if(url.protocol!=='https:'||url.username||url.password)continue; }catch{continue;}
            if(vistos.has(url.href))continue;vistos.add(url.href);
            const atributos={};const cab=meta.replace(/"[^"]*"/g,m=>' '.repeat(m.length));const virgula=cab.indexOf(',');
            for(const m of meta.matchAll(/([\w-]+)="([^"]*)"/g))atributos[m[1].toLowerCase()]=m[2];
            const nome=(virgula>=0?meta.slice(virgula+1):'Canal').replace(/\s*\[[^\]]*\]/g,'').trim().slice(0,70)||'Canal';
            const categorias=gruposTv(atributos['group-title'],nome,lista);
            canais.push({nome,logo:/^https:\/\//i.test(atributos['tvg-logo']||'')?atributos['tvg-logo']:'',grupo:categorias.join(';'),categorias,url:url.href,lista});
        }
        return canais;
    }
    root.StreamListasTv = { LISTAS, comExtras, parseM3u, gruposTv, textoBusca };
    if (typeof module !== 'undefined' && module.exports) module.exports = root.StreamListasTv;
})(typeof globalThis !== 'undefined' ? globalThis : this);
