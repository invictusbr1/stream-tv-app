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
    // Preserva o canal de desenhos "Adult Swim".
    const PADRAO_ADULTO_TV = /\b(cam4|chaturbate|stripchat|xvideos|pornhub|xnxx|xhamster|redtube|youporn|brazzers|onlyfans|adults|xxx|nsfw|erotic|erotico|playboy|penthouse|hustler|venus|sexy|sex ?tv|gtv-workers)\b|\badult(?!\s*swim)\b|cam4-hls|xcdnpro\.com|\+18\b|\b18\+/i;

    function ehCanalAdulto(canalOuTexto) {
        if (!canalOuTexto) return false;
        if (typeof canalOuTexto === 'string') return PADRAO_ADULTO_TV.test(canalOuTexto);
        const junto = `${canalOuTexto.nome || ''} ${canalOuTexto.grupo || ''} ${canalOuTexto.url || ''} ${canalOuTexto.logo || ''} ${canalOuTexto.lista || ''}`;
        return PADRAO_ADULTO_TV.test(junto);
    }

    // Identifica se um canal é estrangeiro (EUA, Europa, países de língua espanhola, etc.)
    // para que as abas principais (TV Aberta, Esportes, Filmes e Séries, Desenhos/Infantil,
    // Notícias, Documentários, Música) mostrem apenas canais do Brasil e os estrangeiros
    // fiquem isolados na aba "🌎 Estrangeiros".
    const MARCADOR_ESTRANGEIRO_NOME = /\((sweden|denmark|norway|finland|germany|austria|switzerland|italy|france|spain|uk|united kingdom|canada|australia|india|arabia|poland|romania|turkey|russia|japan|korea|china|taiwan|vietnam|thailand|indonesia|mexico|argentina|chile|colombia|peru|venezuela|ecuador|bolivia|paraguay|uruguay)\)|\b(dk|gb|de|fr|it|es|nl|se|no|pl|ru|tr|ar|cl|co|mx|pe|uy|ec|ve|bo|py)\b\s*(\(\d+p\))?$/i;
    const TERMOS_ESTRANGEIROS_NOME = /\b(latam|latin america|tegnefilm|juniorklubben|tecknat|ungdomsserier|dokumentar|kultfilme|commedia|series de crimen|asharq|cartoon network asia|rtp ?1|rtp ?2|rtp ?3|rtp ?noticias|rtp ?internacional|rtp ?memoria|rtp ?africa|tvi|tvi ?ficcao|tvi ?reality|tvi ?internacional|sic|sic ?noticias|sic ?radical|sic ?mulher|sic ?caras|sic ?replay|sic ?alta|cnn ?portugal|cmt ?tv|porto ?canal|sport ?tv ?portugal)\b/i;
    const GRUPOS_ESTRANGEIROS = /\b(estrangeir|internaciona|international|estados unidos|argentina|bolivia|chile|colombia|equador|paraguai|peru|uruguai|venezuela|portugal|mexico|espanha|europa|latam)\b/i;
    const LISTAS_ESTRANGEIRAS = new Set(['latam', 'eua-espanhol']);
    const MARCADOR_BRASIL_FORTE = /\b(brasil|brazil|br|globo|sbt|record|band|rede ?tv|cultura|gazeta|aparecida|futura|canal ?brasil|tv ?brasil|sportv|premiere|combate|caze ?tv|nosso ?futebol|bandsports|xsports|n ?sports|goat|canal ?do ?inter|telecine|megapix|multishow|bis|gloob|gloobinho|ra-?tim-?bum|curta|arte ?1|canal ?uol|cnn ?brasil|globonews|band ?news|jovem ?pan|record ?news|sbt ?news|times ?brasil|bm&?c|canal ?do ?boi|terra ?viva|canal ?agro|rede ?brasil|com ?brasil|despertar ?tv|amazon ?sat|catve|aratu|tcm ?10|unisul|bem ?mais ?tv|bob ?esponja|avatar.*lenda|naruto ?brazil|one ?piece ?br|nick.*br|pluto ?tv ?(esportes|animais|investigacao|policial|misterios|record|canal ?uol))\b|\.com\.br\b|ntcstudios\.com\.br/i;

    function ehCanalEstrangeiro(canal) {
        if (!canal || typeof canal !== 'object') return false;
        if (canal.estrangeiro === true || canal.setor === 'estrangeiros') return true;
        if (canal.estrangeiro === false) return false;
        const nome = String(canal.nome || '');
        const grupo = String(canal.grupo || '');
        const url = String(canal.url || '');
        const lista = String(canal.lista || '').toLowerCase();
        if (LISTAS_ESTRANGEIRAS.has(lista)) return true;
        if (GRUPOS_ESTRANGEIROS.test(grupo)) return true;
        if (MARCADOR_ESTRANGEIRO_NOME.test(nome) || TERMOS_ESTRANGEIROS_NOME.test(nome)) return true;
        if (/tvs-de-portugal|rtp\.pt\/|iol\.pt\/|okast\.tv\/|boldmss\.com\/|skygo\.mn\/|itworkscdn\.net\//i.test(url)) return true;
        // Canais vindos de listas mundiais genéricas (sports, movies, series, kids, news, etc.)
        // que não tenham marcador explícito do Brasil vão para "estrangeiros".
        if (['esportes', 'filmes', 'series', 'noticias', 'infantil', 'animacao', 'documentarios', 'ciencia', 'cultura', 'musica', 'comedia', 'familia', 'viagens', 'culinaria', 'clima'].includes(lista)) {
            if (!MARCADOR_BRASIL_FORTE.test(`${nome} ${url}`)) return true;
        }
        // Canais em inglês da Pluto US (cfd-v4-service-channel-stitcher...country=US) sem marcador BR
        if (/pluto\.tv\/.*country=US/i.test(url) && !MARCADOR_BRASIL_FORTE.test(nome)) {
            return true;
        }
        return false;
    }

    function ehCanalBrasileiro(canal) {
        if (!canal || typeof canal !== 'object') return false;
        return !ehCanalEstrangeiro(canal);
    }

    // Listas que abastecem automaticamente cada setor: todas priorizam as fontes
    // verificadas pelo caçador + listas brasileiras (sem misturar listas mundiais).
    const LISTAS_POR_SETOR = {
        'todos': ['cacador-verificados', 'brasil', 'free-tv-brasil', 'iptv-brazil'],
        'tv-aberta': ['cacador-verificados', 'brasil', 'free-tv-brasil', 'iptv-brazil'],
        'esportes': ['cacador-verificados', 'brasil'],
        'filmes': ['cacador-verificados', 'brasil'],
        'noticias': ['cacador-verificados', 'brasil', 'free-tv-brasil', 'iptv-brazil'],
        'infantil': ['cacador-verificados', 'brasil'],
        'documentarios': ['cacador-verificados', 'brasil'],
        'musica': ['cacador-verificados', 'brasil'],
        'fornecedores': ['cacador-verificados', 'free-tv-brasil', 'iptv-brazil'],
        'estrangeiros': ['cacador-verificados', 'portugues', 'latam'],
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
        { id: 'todos', nome: 'Todos (Brasil)', icone: '🇧🇷', descricao: 'Todos os canais brasileiros verificados e separados por categoria' },
        { id: 'tv-aberta', nome: 'TV Aberta', icone: '📡', descricao: 'Globo, SBT, Record, Band, Cultura, RedeTV!, Gazeta, Aparecida e regionais do Brasil' },
        { id: 'esportes', nome: 'Esportes', icone: '⚽', descricao: 'Premiere, SporTV, ESPN Brasil, BandSports, CazéTV, Combate, GOAT e jogos ao vivo' },
        { id: 'filmes', nome: 'Filmes e Séries', icone: '🎬', descricao: 'Telecine, HBO, Megapix, TNT, Space, Warner, AXN, Universal, Canal Brasil e séries 24h' },
        { id: 'infantil', nome: 'Infantil e Desenhos', icone: '🧒', descricao: 'Cartoon Network, Gloob, Discovery Kids, Nickelodeon, Cartoonito, Rá-Tim-Bum e animes BR' },
        { id: 'noticias', nome: 'Notícias', icone: '📰', descricao: 'CNN Brasil, GloboNews, BandNews, Jovem Pan News, Record News, SBT News e Canal UOL' },
        { id: 'documentarios', nome: 'Documentários e Cultura', icone: '🌍', descricao: 'Discovery Channel, History, Animal Planet, Discovery Science, Curta!, Arte1 e culinária' },
        { id: 'musica', nome: 'Música e Variedades', icone: '🎵', descricao: 'Multishow, Bis, MTV Brasil, clipes, shows e variedades brasileiras ao vivo' },
        { id: 'fornecedores', nome: 'Verificados IPTV', icone: '✅', descricao: 'Canais brasileiros testados e aprovados diretamente pelo caçador da Central' },
        { id: 'estrangeiros', nome: 'Canais Estrangeiros', icone: '🌎', descricao: 'Canais internacionais (Portugal, EUA, América Latina e Europa) separados dos brasileiros' }
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
        const aliases={esportes:'sports',esporte:'sports',futebol:'sports','jogos do dia':'sports',lutas:'sports',noticias:'news',jornalismo:'news',filmes:'movies',filme:'movies',cinema:'movies',filmeseseries:'movies','filmes e series':'movies',telecine:'movies',hbo:'movies',series:'series',serie:'series',novelas:'series',infantil:'kids',desenhos:'animation','infantil e desenhos':'kids',musica:'music',musical:'music','musica e variedades':'music',documentarios:'documentary',documentario:'documentary','documentarios e cultura':'documentary',discovery:'documentary',cultura:'culture',educacao:'education',geral:'general',aberta:'general',tvaberta:'general','tv aberta':'general',abertos:'general',globos:'general',sbt:'general',record:'general',band:'general',variedades:'entertainment',entretenimento:'entertainment','fornecedores iptv':'general','verificados iptv':'general','canais estrangeiros':'foreign',estrangeiros:'foreign',internacional:'foreign'};
        if(partes.length)return [...new Set(partes.map(p=>aliases[p]||p))];
        const fallback={esportes:'sports',noticias:'news',filmes:'movies',series:'series',infantil:'kids',animacao:'animation',musica:'music',documentarios:'documentary',ciencia:'science',cultura:'culture',comedia:'comedy',familia:'family',viagens:'travel',culinaria:'cooking',clima:'weather'};
        if(fallback[lista])return [fallback[lista]];
        const n=textoBusca(nome);
        if(/sport|esporte|futebol|xsports|x sports|espn|premiere|combate|cazetv|caze tv|nosso futebol|bandsports|band sports|fifa|goat|snooker|fishing|ufc|lutas|f1 live|sportynet|nsports|n sports|ge tv/.test(n))return ['sports'];
        if(/news|noticias|cnn|bandnews|band news|globonews|globo news|jovem pan|record news|sbt news|times brasil|bmc|bm&c|canal uol|rtp noticias|tcm 10/.test(n))return ['news'];
        if(/telecine|hbo|megapix|cine|filmes|film|movie|movies|tnt|space|warner|universal|axn|sony|paramount|amc|studio universal|cinemax|star channel|fx|syfy|series|ficcao|crime|horror|action|k-drama|sci-fi|staff picks|kultfilme|spike|chaves|comedia|comedy central|reelshorts|runtime|canal brasil/.test(n))return ['movies'];
        if(/kids|gloob|gloobinho|cartoon|cartoonito|nickelodeon|nick jr|disney|discovery kids|tooncast|animacao|anime|one piece|naruto|avatar|bob esponja|jetsons|ra-tim-bum|zoomoo|adult swim|toons|tecknat|tegnefilm|juniorklubben|ungdomsserier/.test(n))return ['kids'];
        if(/multishow|bis|mtv|music|musicas|trace|radio tv|chamame|rfptv|louvor/.test(n))return ['music'];
        if(/discovery|history|natgeo|national geographic|animal planet|animals|animais|curta|arte1|documentary|dokumentar|science|food|kfood|cars|petrolheads|tough jobs|unisul|bemmais|investigacao|misterios|detetives|encantador/.test(n))return ['documentary'];
        return ['general'];
    }

    // Classifica qualquer canal (das listas públicas ou de fornecedores IPTV
    // descobertos pelo caçador) em um setor principal da TV ao vivo.
    function setorDoCanal(canal) {
        if (!canal || typeof canal !== 'object') return 'tv-aberta';
        if (ehCanalEstrangeiro(canal)) return 'estrangeiros';
        if (canal.setor && SETORES.some(s => s.id === canal.setor && s.id !== 'todos' && s.id !== 'fornecedores' && s.id !== 'tv-aberta')) return canal.setor;
        const cats = Array.isArray(canal.categorias) && canal.categorias.length
            ? canal.categorias.map(textoBusca)
            : gruposTv(canal.grupo, canal.nome, canal.lista);
        const nome = textoBusca(canal.nome);
        const lista = textoBusca(canal.lista);
        if (cats.includes('foreign')) return 'estrangeiros';
        if (cats.includes('sports') || lista === 'esportes' || /\b(sport|esporte|futebol|premiere|sportv|espn|bandsports|band sports|xsports|x sports|cazetv|caze tv|combate|fifa|goat|canal do inter|snooker|fishing|ufc|lutas|f1 live|sportynet|nsports|n sports|ge tv)\b/.test(nome)) return 'esportes';
        if (cats.includes('news') || cats.includes('business') || cats.includes('weather') || lista === 'noticias' || /\b(news|noticias|cnn|globonews|globo news|bandnews|band news|jovem pan|sbt news|record news|times brasil|bm&c|bmc|canal uol|rtp noticias|tcm 10)\b/.test(nome)) return 'noticias';
        if (cats.includes('kids') || cats.includes('animation') || cats.includes('family') || lista === 'infantil' || lista === 'animacao' || /\b(kids|gloob|gloobinho|cartoon|cartoonito|nickelodeon|nick|disney|tooncast|infantil|icarly|kenan|one piece|naruto|avatar|bob esponja|jetsons|ra-tim-bum|zoomoo|adult swim|anime|toons)\b/.test(nome)) return 'infantil';
        if (cats.includes('movies') || cats.includes('series') || cats.includes('classic') || cats.includes('comedy') || lista === 'filmes' || lista === 'series' || /\b(telecine|hbo|megapix|cine|filmes|film|movie|movies|series|novelas|tnt|space|warner|universal|axn|sony|paramount|amc|cinemax|star trek|ncis|csi|masterchef|ficcao|crime|horror|action|k-drama|sci-fi|staff picks|spike|chaves|comedia|comedy central|reelshorts|runtime|canal brasil)\b/.test(nome)) return 'filmes';
        if (cats.includes('documentary') || cats.includes('science') || cats.includes('culture') || cats.includes('education') || cats.includes('cooking') || cats.includes('travel') || cats.includes('outdoor') || lista === 'documentarios' || lista === 'ciencia' || lista === 'cultura' || /\b(discovery|history|natgeo|national geographic|animal planet|animals|animais|curta|arte1|documentary|ciencia|science|food|kfood|cars|petrolheads|tough jobs|unisul|bem mais tv|cultura 24|investigacao|misterios|detetives|encantador)\b/.test(nome)) return 'documentarios';
        if (cats.includes('music') || lista === 'musica' || /\b(music|musica|musicas|mtv|multishow|bis|trace|fm|radio tv|chamame|rfptv|louvor)\b/.test(nome)) return 'musica';
        if (/\b(globo|sbt|record|band|cultura|rede ?tv|gazeta|aparecida|futura|tv brasil|canal gov|rede brasil|com brasil|despertar tv|cnt|canal do boi|terra viva|canal agro|amazon sat|catve|tv diario|tv tem|tv rio sul)\b/.test(nome)) return 'tv-aberta';
        if (canal.setor && SETORES.some(s => s.id === canal.setor && s.id !== 'todos')) return canal.setor;
        if (canal.doCacador || lista.includes('cacador') || lista.includes('iptv') || lista.includes('fornecedor')) return 'fornecedores';
        return 'tv-aberta';
    }

    function pertenceAoSetor(canal, setor) {
        if (!canal || typeof canal !== 'object') return false;
        const ehEstrangeiro = ehCanalEstrangeiro(canal);
        if (setor === 'estrangeiros') return ehEstrangeiro;
        // Em todos os outros setores (inclusive 'todos' e 'fornecedores'), só entram canais brasileiros!
        if (ehEstrangeiro) return false;
        if (!setor || setor === 'todos') return true;
        if (setor === 'fornecedores') {
            return Boolean(canal.doCacador || /cacador|iptv|fornecedor|verificado/i.test(String(canal.lista || '')) || canal.setor === 'fornecedores');
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
            if (/canais estrangeiros|estrangeiros/i.test(atributos['group-title'] || '')) item.estrangeiro = true;
            item.setor = setorDoCanal(item);
            canais.push(item);
        }
        return canais;
    }
    root.StreamListasTv = { LISTAS, SETORES, LISTAS_POR_SETOR, listasDoSetor, ehCanalAdulto, ehCanalEstrangeiro, ehCanalBrasileiro, comExtras, parseM3u, gruposTv, setorDoCanal, pertenceAoSetor, textoBusca };
    if (typeof module !== 'undefined' && module.exports) module.exports = root.StreamListasTv;
})(typeof globalThis !== 'undefined' ? globalThis : this);
