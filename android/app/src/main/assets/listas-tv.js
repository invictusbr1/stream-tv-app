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
        { id: 'brasil', nome: 'Canais do Brasil', url: 'https://iptv-org.github.io/iptv/countries/br.m3u', nota: 9.0, setor: 'tv-aberta' },
        { id: 'cacador-verificados', nome: 'Verificados pelo Caçador (IPTV)', url: 'https://raw.githubusercontent.com/invictusbr1/stream-tv-atualizacoes/main/tv-cacador-verificados.m3u', nota: 9.8, setor: 'fornecedores', doCacador: true },
        { id: 'free-tv-brasil', nome: 'Free-TV Brasil (TV Aberta)', url: 'https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists/playlist_brazil.m3u8', nota: 8.8, setor: 'tv-aberta', doCacador: true },
        { id: 'iptv-brazil', nome: 'Brasil Extra (IPTV)', url: 'https://github.com/iptv-com/iptv/raw/refs/heads/main/lists/brazil.m3u', nota: 8.4, setor: 'tv-aberta', doCacador: true },
        { id: 'portugues', nome: 'Canais em português', url: 'https://iptv-org.github.io/iptv/languages/por.m3u', nota: 8.5, setor: 'tv-aberta' },
        { id: 'esportes', nome: 'Esportes', url: 'https://iptv-org.github.io/iptv/categories/sports.m3u', nota: 9.8, setor: 'esportes' },
        { id: 'noticias', nome: 'Notícias', url: 'https://iptv-org.github.io/iptv/categories/news.m3u', nota: 10, setor: 'noticias' },
        { id: 'latam', nome: 'América Latina', url: 'https://iptv-org.github.io/iptv/regions/latam.m3u', nota: 9.5, setor: 'tv-aberta' },
        { id: 'filmes', nome: 'Filmes (TV aberta)', url: 'https://iptv-org.github.io/iptv/categories/movies.m3u', nota: 8.7, setor: 'filmes' },
        { id: 'series', nome: 'Séries (TV aberta)', url: 'https://iptv-org.github.io/iptv/categories/series.m3u', nota: 9.0, setor: 'filmes' },
        { id: 'infantil', nome: 'Infantil', url: 'https://iptv-org.github.io/iptv/categories/kids.m3u', nota: 9.2, setor: 'infantil' },
        { id: 'animacao', nome: 'Animação', url: 'https://iptv-org.github.io/iptv/categories/animation.m3u', nota: 8.5, setor: 'infantil' },
        { id: 'musica', nome: 'Música', url: 'https://iptv-org.github.io/iptv/categories/music.m3u', nota: 9.3, setor: 'musica' },
        { id: 'documentarios', nome: 'Documentários', url: 'https://iptv-org.github.io/iptv/categories/documentary.m3u', nota: 9.7, setor: 'documentarios' },
        { id: 'ciencia', nome: 'Ciência', url: 'https://iptv-org.github.io/iptv/categories/science.m3u', nota: 8.0, setor: 'documentarios' },
        { id: 'cultura', nome: 'Cultura', url: 'https://iptv-org.github.io/iptv/categories/culture.m3u', nota: 8.7, setor: 'documentarios' },
        { id: 'comedia', nome: 'Comédia', url: 'https://iptv-org.github.io/iptv/categories/comedy.m3u', nota: 8.0, setor: 'filmes' },
        { id: 'familia', nome: 'Família', url: 'https://iptv-org.github.io/iptv/categories/family.m3u', nota: 8.0, setor: 'infantil' },
        { id: 'viagens', nome: 'Viagens e lazer', url: 'https://iptv-org.github.io/iptv/categories/travel.m3u', nota: 7.5, setor: 'documentarios' },
        { id: 'culinaria', nome: 'Culinária', url: 'https://iptv-org.github.io/iptv/categories/cooking.m3u', nota: 7.5, setor: 'documentarios' },
        { id: 'clima', nome: 'Previsão do tempo', url: 'https://iptv-org.github.io/iptv/categories/weather.m3u', nota: 7.5, setor: 'noticias' },
        { id: 'eua-espanhol', nome: 'EUA em espanhol', url: 'https://iptv-org.github.io/iptv/countries/us.m3u', nota: 7.0, setor: 'tv-aberta' }
    ];

    // Bloqueio familiar de conteúdo adulto/webcam em listas públicas ou addons IPTV.
    const PADRAO_ADULTO_TV = /\b(cam4|chaturbate|stripchat|xvideos|pornhub|xnxx|xhamster|redtube|youporn|brazzers|onlyfans|adult|adults|xxx|nsfw|erotic|erotico|playboy|penthouse|hustler|venus|sexy|sex ?tv|gtv-workers)\b|cam4-hls|xcdnpro\.com|\+18\b|\b18\+/i;

    function ehCanalAdulto(canalOuTexto) {
        if (!canalOuTexto) return false;
        if (typeof canalOuTexto === 'string') return PADRAO_ADULTO_TV.test(canalOuTexto);
        const junto = `${canalOuTexto.nome || ''} ${canalOuTexto.grupo || ''} ${canalOuTexto.url || ''} ${canalOuTexto.logo || ''} ${canalOuTexto.lista || ''}`;
        return PADRAO_ADULTO_TV.test(junto);
    }

    // Listas que abastecem automaticamente cada setor quando o seletor está no modo
    // "Automático por setor" (ou em Canais do Brasil).
    const LISTAS_POR_SETOR = {
        'todos': ['brasil', 'cacador-verificados', 'free-tv-brasil', 'iptv-brazil'],
        'tv-aberta': ['brasil', 'cacador-verificados', 'free-tv-brasil', 'iptv-brazil', 'portugues'],
        'esportes': ['esportes', 'cacador-verificados', 'brasil'],
        'filmes': ['filmes', 'series', 'cacador-verificados', 'brasil'],
        'noticias': ['noticias', 'cacador-verificados', 'brasil'],
        'infantil': ['infantil', 'animacao', 'cacador-verificados', 'brasil'],
        'documentarios': ['documentarios', 'cultura', 'cacador-verificados', 'brasil'],
        'musica': ['musica', 'cacador-verificados', 'brasil'],
        'fornecedores': ['cacador-verificados', 'iptv-brazil', 'free-tv-brasil'],
    };

    function listasDoSetor(setor, listasExtras = []) {
        const s = setor && LISTAS_POR_SETOR[setor] ? setor : 'todos';
        const ids = [...LISTAS_POR_SETOR[s]];
        for (const extra of Array.isArray(listasExtras) ? listasExtras : []) {
            if (!extra || !extra.id) continue;
            if ((extra.setor === s || (s === 'fornecedores' && extra.doCacador)) && !ids.includes(extra.id)) {
                ids.push(extra.id);
            }
        }
        return ids;
    }

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
        const aliases={esportes:'sports',esporte:'sports',futebol:'sports',noticias:'news',jornalismo:'news',filmes:'movies',filme:'movies',cinema:'movies',filmeseseries:'movies','filmes e series':'movies',series:'series',serie:'series',novelas:'series',infantil:'kids',desenhos:'animation',musica:'music',musical:'music',documentarios:'documentary',documentario:'documentary','documentarios e cultura':'documentary',cultura:'culture',educacao:'education',geral:'general',aberta:'general',tvaberta:'general','tv aberta':'general',variedades:'entertainment',entretenimento:'entertainment','fornecedores iptv':'general'};
        if(partes.length)return [...new Set(partes.map(p=>aliases[p]||p))];
        const fallback={esportes:'sports',noticias:'news',filmes:'movies',series:'series',infantil:'kids',animacao:'animation',musica:'music',documentarios:'documentary',ciencia:'science',cultura:'culture',comedia:'comedy',familia:'family',viagens:'travel',culinaria:'cooking',clima:'weather'};
        if(fallback[lista])return [fallback[lista]];
        const n=textoBusca(nome);
        if(/sport|esporte|futebol|xsports|espn|premiere|combate|cazetv|nosso futebol|bandsports|fifa|goat|snooker|fishing/.test(n))return ['sports'];
        if(/news|noticias|cnn|bandnews|globonews|jovem pan|record news|sbt news|times brasil|bmc|canal uol|rtp noticias|tcm 10/.test(n))return ['news'];
        if(/telecine|hbo|megapix|cine|filmes|film|movie|movies|tnt|space|warner|universal|axn|sony|paramount|amc|studio universal|cinemax|star channel|fx|syfy|series|ficcao|crime|horror|action|k-drama|sci-fi|staff picks|kultfilme|spike/.test(n))return ['movies'];
        if(/kids|gloob|cartoon|nickelodeon|nick jr|disney|discovery kids|tooncast|animacao|anime|one piece|toons|tecknat|tegnefilm|juniorklubben|ungdomsserier/.test(n))return ['kids'];
        if(/multishow|bis|mtv|music|trace|radio tv|chamame|rfptv/.test(n))return ['music'];
        if(/discovery|history|natgeo|national geographic|animal planet|animals|curta|arte1|documentary|dokumentar|science|food|cars|petrolheads|tough jobs|unisul|bemmais/.test(n))return ['documentary'];
        return ['general'];
    }

    // Classifica qualquer canal (das listas públicas ou de fornecedores IPTV
    // descobertos pelo caçador) em um setor principal da TV ao vivo.
    function setorDoCanal(canal) {
        if (!canal || typeof canal !== 'object') return 'tv-aberta';
        if (canal.setor && SETORES.some(s => s.id === canal.setor && s.id !== 'todos' && s.id !== 'fornecedores' && s.id !== 'tv-aberta')) return canal.setor;
        const cats = Array.isArray(canal.categorias) && canal.categorias.length
            ? canal.categorias.map(textoBusca)
            : gruposTv(canal.grupo, canal.nome, canal.lista);
        const nome = textoBusca(canal.nome);
        const lista = textoBusca(canal.lista);
        if (cats.includes('sports') || lista === 'esportes' || /\b(sport|esporte|futebol|premiere|sportv|espn|bandsports|xsports|cazetv|combate|fifa|goat|canal do inter|snooker|fishing)\b/.test(nome)) return 'esportes';
        if (cats.includes('news') || cats.includes('business') || cats.includes('weather') || lista === 'noticias' || /\b(news|noticias|cnn|globonews|bandnews|jovem pan|sbt news|record news|times brasil|bm&c|bmc|canal uol|rtp noticias|tcm 10)\b/.test(nome)) return 'noticias';
        if (cats.includes('movies') || cats.includes('series') || cats.includes('classic') || cats.includes('comedy') || lista === 'filmes' || lista === 'series' || /\b(telecine|hbo|megapix|cine|filmes|film|movie|movies|series|novelas|tnt|space|warner|universal|axn|sony|paramount|amc|cinemax|star trek|ncis|csi|masterchef|ficcao|crime|horror|action|k-drama|sci-fi|staff picks|kultfilme|spike)\b/.test(nome)) return 'filmes';
        if (cats.includes('kids') || cats.includes('animation') || cats.includes('family') || lista === 'infantil' || lista === 'animacao' || /\b(kids|gloob|cartoon|nickelodeon|nick|disney|tooncast|infantil|icarly|kenan|one piece|anime|toons|tecknat|tegnefilm|juniorklubben|ungdomsserier)\b/.test(nome)) return 'infantil';
        if (cats.includes('documentary') || cats.includes('science') || cats.includes('culture') || cats.includes('education') || cats.includes('cooking') || cats.includes('travel') || cats.includes('outdoor') || lista === 'documentarios' || lista === 'ciencia' || lista === 'cultura' || /\b(discovery|history|natgeo|national geographic|animal planet|animals|curta|arte1|documentary|dokumentar|ciencia|science|food|cars|petrolheads|tough jobs|unisul|bem mais tv|cultura 24)\b/.test(nome)) return 'documentarios';
        if (cats.includes('music') || lista === 'musica' || /\b(music|musica|mtv|multishow|bis|trace|fm|radio tv|chamame|rfptv)\b/.test(nome)) return 'musica';
        if (/\b(globo|sbt|record|band|cultura|rede ?tv|gazeta|aparecida|futura|tv brasil|canal gov|rede brasil|com brasil|despertar tv|rtp1|rtp 1|tvi|sic|v\+)\b/.test(nome)) return 'tv-aberta';
        if (canal.setor && SETORES.some(s => s.id === canal.setor && s.id !== 'todos')) return canal.setor;
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
            if (ehCanalAdulto(item) || ehCanalAdulto(atributos['group-title'])) continue;
            if (opts.doCacador) item.doCacador = true;
            if (opts.setor) item.setor = String(opts.setor);
            item.setor = setorDoCanal(item);
            canais.push(item);
        }
        return canais;
    }
    root.StreamListasTv = { LISTAS, SETORES, LISTAS_POR_SETOR, listasDoSetor, ehCanalAdulto, comExtras, parseM3u, gruposTv, setorDoCanal, pertenceAoSetor, textoBusca };
    if (typeof module !== 'undefined' && module.exports) module.exports = root.StreamListasTv;
})(typeof globalThis !== 'undefined' ? globalThis : this);
