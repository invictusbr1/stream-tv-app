// rotas/catalogo.js — Catálogo TMDB: explorar, gêneros, em alta, rankings e busca.
// Separado do server.js na reorganização de 10/2026: o código é o mesmo,
// só mudou de arquivo. RAIZ é a pasta do server.js (antes, __dirname).
module.exports = function registrar(app, ctx) {
const { TMDB_KEY, axios } = ctx;
const libraryCatalog=require('../android/app/src/main/assets/catalog').createCatalog(async (url,options)=>{const r=await axios.get(url,{signal:options?.signal});return {ok:true,json:async()=>r.data};},TMDB_KEY);
app.get(['/api/explore','/api/genres','/api/top-br','/api/alta',/^\/api\/(tv|season|episode)\//],async(req,res)=>{try{res.json(await libraryCatalog.request(req.originalUrl));}catch{res.status(502).json({error:'Catálogo indisponível'});}});


const OSCAR_SELECTION = [
    238, 240, 424, 13, 122, 497, 680, 389, 11216, 244786,
    129, 857, 313369,
];

const CACHE = new Map();
const CACHE_TTL = 10 * 60 * 1000;

function mapFilme(f) {
    return {
        id:      f.id,
        titulo:  f.title || f.name,
        sinopse: f.overview || '',
        nota:    f.vote_average ? Number(f.vote_average).toFixed(1) : 'N/A',
        ano:     (f.release_date || f.first_air_date || '').substring(0, 4),
        capa:    f.poster_path ? `https://image.tmdb.org/t/p/w500${f.poster_path}` : '',
        fundo:   f.backdrop_path ? `https://image.tmdb.org/t/p/w1280${f.backdrop_path}` : '',
        popularidade: Number(f.popularity || 0),
        votos:   Number(f.vote_count || 0),
    };
}

async function tmdbGet(url) {
    const cached = CACHE.get(url);
    if (cached && cached.expires > Date.now()) return cached.value;
    const r = await axios.get(url, { timeout: 15000 });
    CACHE.set(url, { value: r.data, expires: Date.now() + CACHE_TTL });
    return r.data;
}

async function descobrir(params) {
    const query = new URLSearchParams({ api_key: TMDB_KEY, language: 'pt-BR', include_adult: 'false', page: '1', ...params });
    const data = await tmdbGet(`https://api.themoviedb.org/3/discover/movie?${query}`);
    return (data.results || []).map(mapFilme);
}

async function oscarPremiados() {
    const data = await Promise.all(OSCAR_SELECTION.map(async id => {
        try { return mapFilme(await tmdbGet(`https://api.themoviedb.org/3/movie/${id}?api_key=${TMDB_KEY}&language=pt-BR`)); }
        catch { return null; }
    }));
    return data.filter(Boolean).sort((a, b) => Number(b.nota === 'N/A' ? 0 : b.nota) - Number(a.nota === 'N/A' ? 0 : a.nota));
}

const H = {
    'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8',
    'Accept-Encoding': 'gzip, deflate, br',
    'Cache-Control':   'no-cache',
    'Upgrade-Insecure-Requests': '1',
};


// ============================================================
// ROTA 1 — Em alta
// ============================================================
app.get('/api/em-alta', async (req, res) => {
    try {
        const r = await tmdbGet(`https://api.themoviedb.org/3/movie/popular?api_key=${TMDB_KEY}&language=pt-BR&page=1`);
        res.json((r.results || []).map(mapFilme));
    } catch (e) { res.status(500).json([]); }
});

// ============================================================
// ROTA 1B — Rankings para a tela inicial
// ============================================================
app.get('/api/rankings', async (req, res) => {
    try {
        res.json(await libraryCatalog.request(req.originalUrl));
    } catch (e) {
        console.error('[rankings] falha:', e.message);
        res.status(502).json({ error: 'Não foi possível carregar os rankings.' });
    }
});

// ============================================================
// ROTA 2 — Busca
// ============================================================
app.get('/api/buscar', async (req, res) => {
    const nome = req.query.nome;
    if (!nome) return res.status(400).json([]);
    try {
        const r = await axios.get(`https://api.themoviedb.org/3/search/movie?api_key=${TMDB_KEY}&query=${encodeURIComponent(nome)}&language=pt-BR`);
        res.json((r.data.results || []).map(mapFilme));
    } catch (e) { res.status(500).json([]); }
});

return { libraryCatalog, OSCAR_SELECTION, CACHE, CACHE_TTL, mapFilme, tmdbGet, descobrir, oscarPremiados, H };
};
