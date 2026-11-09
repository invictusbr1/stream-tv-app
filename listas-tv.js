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

    // Setores da tela de TV ao vivo: separam TV aberta, esportes, filmes/séries,
    // notícias, infantil, cultura/documentários, música e canais verificados/IPTV.
    // Quando um fornecedor novo entra pelo caçador (ou manualmente em perfis.json),
    // cada canal é direcionado automaticamente para o setor correspondente.
    const SETORES = [
        { id: 'todos', nome: 'Todos', icone: '📺', descricao: 'Todos os canais disponíveis nesta lista' },
        { id: 'tv-aberta', nome: 'TV Aberta', icone: '📡', descricao: 'Emissoras abertas, regionais e variedades do Brasil' },
        { id: 'esportes', nome: 'Esportes', icone: '⚽', descricao: 'Canais de esporte, futebol e transmissões ao vivo' },
        { id: 'filmes', nome: 'Filmes e Séries', icone: '🎬', descricao: 'Canais de cinema, séries, novelas e clássicos 24h' },
        { id: 'noticias', nome: 'Notícias', icone: '📰', descricao: 'Jornalismo 24 horas, economia e canais públicos' },
        { id: 'infantil', nome: 'Infantil', icone: '🧒', descricao: 'Desenhos, animação e programação para a família' },
        { id: 'documentarios', nome: 'Documentários e Cultura', icone: '🌍', descricao: 'História, ciência, natureza, culinária e educação' },
        { id: 'musica', nome: 'Música', icone: '🎵', descricao: 'Clipes, shows e canais musicais ao vivo' },
        { id: 'fornecedores', nome: 'Fornecedores IPTV', icone: '✅', descricao: 'Canais e listas extras verificados pelo caçador da Central' }
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
                setor: String(lista.setor || '').slice(0, 30),
                doCacador: true,
            });
        }
        return juntas.sort((a, b) => (Number(b.nota) || 0) - (Number(a.nota) || 0));
    }

    function textoBusca(s) { return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); }
    function gruposTv(grupo, nome, lista) {
        const partes=String(grupo||'').split(';').map(p=>textoBusca(p.trim())).filter(p=>p&&p!=='undefined');
        const aliases={esportes:'sports',esporte:'sports',futebol:'sports',noticias:'news',jornalismo:'news',filmes:'movies',filme:'movies',cinema:'movies',series:'series',serie:'series',novelas:'series',infantil:'kids',desenhos:'animation',musica:'music',musical:'music',documentarios:'documentary',documentario:'documentary',cultura:'culture',educacao:'education',geral:'general',aberta:'general',tvaberta:'general',variedades:'entertainment',entretenimento:'entertainment'};
        if(partes.length)return [...new Set(partes.map(p=>aliases[p]||p))];
        const fallback={esportes:'sports',noticias:'news',filmes:'movies',series:'series',infantil:'kids',animacao:'animation',musica:'music',documentarios:'documentary',ciencia:'science',cultura:'culture',comedia:'comedy',familia:'family',viagens:'travel',culinaria:'cooking',clima:'weather'};
        if(fallback[lista])return [fallback[lista]];
        const n=textoBusca(nome);
        if(/sport|esporte|futebol|xsports|espn|premiere|combate|cazetv|nosso futebol|bandsports|fifa|goat/.test(n))return ['sports'];
        if(/news|noticias|cnn|bandnews|globonews|jovem pan|record news|sbt news|times brasil|bmc/.test(n))return ['news'];
        if(/telecine|hbo|megapix|cine|filmes|tnt|space|warner|universal|axn|sony|paramount|amc|studio universal|cinemax|star channel|fx|syfy|series/.test(n))return ['movies'];
        if(/kids|gloob|cartoon|nickelodeon|nick jr|disney|discovery kids|tooncast|animacao|anime/.test(n))return ['kids'];
        if(/multishow|bis|mtv|music|trace/.test(n))return ['music'];
        if(/discovery|history|natgeo|national geographic|animal planet|curta|arte1|documentary/.test(n))return ['documentary'];
        return ['general'];
    }

    // Classifica qualquer canal (das listas públicas ou de fornecedores IPTV
    // descobertos pelo caçador) em um setor principal da TV ao vivo.
    function setorDoCanal(canal) {
        if (!canal || typeof canal !== 'object') return 'tv-aberta';
        if (canal.setor && SETORES.some(s => s.id === canal.setor && s.id !== 'todos')) return canal.setor;
        const cats = Array.isArray(canal.categorias) && canal.categorias.length
            ? canal.categorias.map(textoBusca)
            : gruposTv(canal.grupo, canal.nome, canal.lista);
        const nome = textoBusca(canal.nome);
        const lista = textoBusca(canal.lista);
        if (cats.includes('sports') || lista === 'esportes' || /\b(sport|esporte|futebol|premiere|sportv|espn|bandsports|xsports|cazetv|combate|fifa|goat|canal do inter)\b/.test(nome)) return 'esportes';
        if (cats.includes('news') || cats.includes('business') || cats.includes('weather') || lista === 'noticias' || /\b(news|noticias|cnn|globonews|bandnews|jovem pan|sbt news|record news|times brasil|bm&c|bmc)\b/.test(nome)) return 'noticias';
        if (cats.includes('movies') || cats.includes('series') || cats.includes('classic') || cats.includes('comedy') || lista === 'filmes' || lista === 'series' || /\b(telecine|hbo|megapix|cine|filmes|series|novelas|tnt|space|warner|universal|axn|sony|paramount|amc|cinemax|star trek|ncis|csi|masterchef)\b/.test(nome)) return 'filmes';
        if (cats.includes('kids') || cats.includes('animation') || cats.includes('family') || lista === 'infantil' || lista === 'animacao' || /\b(kids|gloob|cartoon|nickelodeon|nick|disney|tooncast|infantil|icarly|kenan)\b/.test(nome)) return 'infantil';
        if (cats.includes('documentary') || cats.includes('science') || cats.includes('culture') || cats.includes('education') || cats.includes('cooking') || cats.includes('travel') || cats.includes('outdoor') || lista === 'documentarios' || lista === 'ciencia' || lista === 'cultura' || /\b(discovery|history|natgeo|national geographic|animal planet|curta|arte1|documentary|ciencia)\b/.test(nome)) return 'documentarios';
        if (cats.includes('music') || lista === 'musica' || /\b(music|musica|mtv|multishow|bis|trace|fm)\b/.test(nome)) return 'musica';
        if (canal.doCacador || lista.includes('cacador') || lista.includes('iptv') || lista.includes('fornecedor')) return 'fornecedores';
        return 'tv-aberta';
    }

    function pertenceAoSetor(canal, setor) {
        if (!setor || setor === 'todos') return true;
        if (setor === 'fornecedores') {
            return Boolean(canal && (canal.doCacador || /cacador|iptv|fornecedor|verificado/i.test(String(canal.lista || '')) || canal.setor === 'fornecedores'));
        }
        return setorDoCanal(canal) === setor;
    }

    function parseM3u(texto, lista, opcoes) {
        const opts = opcoes && typeof opcoes === 'object' ? opcoes : {};
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
            const item={nome,logo:/^https:\/\//i.test(atributos['tvg-logo']||'')?atributos['tvg-logo']:'',grupo:categorias.join(';'),categorias,url:url.href,lista};
            if (opts.doCacador) item.doCacador = true;
            if (opts.setor) item.setor = String(opts.setor);
            item.setor = setorDoCanal(item);
            canais.push(item);
        }
        return canais;
    }
    root.StreamListasTv = { LISTAS, SETORES, comExtras, parseM3u, gruposTv, setorDoCanal, pertenceAoSetor, textoBusca };
    if (typeof module !== 'undefined' && module.exports) module.exports = root.StreamListasTv;
})(typeof globalThis !== 'undefined' ? globalThis : this);
