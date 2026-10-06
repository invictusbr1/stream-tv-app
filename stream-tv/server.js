const express = require('express');
const axios   = require('axios');
const app     = express();
const PORT    = process.env.PORT || 3000;

// ============================================================
// CORS
// ============================================================
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin',  '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});
app.use(express.json());

const TMDB_KEY = 'b803dfcad0baeafbb66a673ffe98a5ef';

const H = {
    'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8',
    'Accept-Encoding': 'gzip, deflate, br',
    'Cache-Control':   'no-cache',
    'Upgrade-Insecure-Requests': '1',
};

// ============================================================
// FONTES — resultado de pesquisa e testes reais
//
// GRUPO 1 — PT-BR Dub real (fontes brasileiras confirmadas)
//   watchcdn    → seletor dublado/legendado nativo
//   cdn-embed   → API BR, aceita TMDB/IMDB
//   ultraembed  → API BR, aceita TMDB/IMDB
//
// GRUPO 2 — Fallback legendado (HTML simples, sem Cloudflare)
//   vidsrc.me, autoembed, moviesapi, vidsrc.in
//
// DESCARTADAS definitivamente:
//   ❌ multiembed.mov  — Cloudflare Turnstile + JS Base64
//   ❌ embedsito.com   — mesmo padrão
//   ❌ warezcdn        — ENOTFOUND
//   ❌ vidsrc.cc       — timeout constante
// ============================================================
function getFontes(filmeId, imdbId) {
    const imdb = imdbId || filmeId; // fallback para tmdb se sem imdb
    return [

        // ── GRUPO 1: PT-BR Dub real ───────────────────────────
        {
            nome:    'WatchCDN (Dub)',
            // watchcdn usa IMDB ID com prefixo tt
            url:     `https://embed.watchcdn.org/filme/${imdb}`,
            referer: 'https://watchcdn.org/',
            dub:     true,
            modo:    'direto',
            timeout: 8000,
        },
        {
            nome:    'CdnEmbed (Dub)',
            // cdn-embed aceita TMDB numérico direto
            url:     `https://cdn-embed.com/filme/${filmeId}`,
            referer: 'https://embedmovies.org/',
            dub:     true,
            modo:    'direto',
            timeout: 8000,
        },
        {
            nome:    'UltraEmbed (Dub)',
            // ultraembed usa IMDB com tt
            url:     `https://ultraembed.com/filme/${imdb}`,
            referer: 'https://ultraembed.com/',
            dub:     true,
            modo:    'direto',
            timeout: 8000,
        },

        // ── GRUPO 2: Fallback legendado ───────────────────────
        {
            nome:    'VidSrc.me',
            url:     `https://vidsrc.me/embed/movie?tmdb=${filmeId}`,
            referer: 'https://vidsrc.me/',
            dub:     false,
            modo:    'proxy',
            timeout: 10000,
        },
        {
            nome:    'AutoEmbed',
            url:     `https://autoembed.co/movie/tmdb/${filmeId}`,
            referer: 'https://autoembed.co/',
            dub:     false,
            modo:    'proxy',
            timeout: 8000,
        },
        {
            nome:    'MoviesAPI',
            url:     `https://moviesapi.club/movie/${filmeId}`,
            referer: 'https://moviesapi.club/',
            dub:     false,
            modo:    'proxy',
            timeout: 8000,
        },
        {
            nome:    'VidSrc.in',
            url:     `https://vidsrc.in/embed/movie?tmdb=${filmeId}`,
            referer: 'https://vidsrc.in/',
            dub:     false,
            modo:    'proxy',
            timeout: 8000,
        },
    ];
}

// ============================================================
// BUSCA IMDB ID pelo TMDB ID
// Necessário para fontes que usam IMDB (watchcdn, ultraembed)
// ============================================================
async function getImdbId(tmdbId) {
    try {
        const r = await axios.get(
            `https://api.themoviedb.org/3/movie/${tmdbId}/external_ids?api_key=${TMDB_KEY}`,
            { timeout: 5000 }
        );
        return r.data.imdb_id || null; // ex: "tt1234567"
    } catch {
        return null;
    }
}

// ============================================================
// Detectores de bloqueio — fontes com esses padrões são descartadas
// ============================================================
const BLOQUEIOS = [
    'challenges.cloudflare.com',
    'captcha-gate',
    'hcaptcha.com',
    'recaptcha',
    'disable-devtool',
    'turnstile',
    'ZpQw9XkLmN8',
    "window['",
    'atob(',
];

const ERROS_HTML = ['not found', 'not available', 'access denied', 'forbidden', '404 error'];

// ============================================================
// Testa fontes proxy (baixa HTML e valida)
// ============================================================
async function testarProxy(fonte) {
    try {
        const r = await axios.get(fonte.url, {
            headers: { ...H, 'Referer': fonte.referer, 'Origin': new URL(fonte.url).origin },
            responseType:   'text',
            timeout:        fonte.timeout,
            maxRedirects:   10,
            validateStatus: s => s === 200,
        });

        const html = r.data || '';
        if (!r.headers['content-type']?.includes('text/html')) return { ok: false, motivo: 'não é HTML' };
        if (html.length < 400) return { ok: false, motivo: 'resposta vazia' };

        for (const b of BLOQUEIOS) {
            if (html.includes(b)) return { ok: false, motivo: `bloqueado (${b.substring(0,20)})` };
        }

        const low = html.toLowerCase();
        for (const e of ERROS_HTML) {
            if (low.includes(e) && html.length < 5000) return { ok: false, motivo: `erro: ${e}` };
        }

        return { ok: true };
    } catch (err) {
        return { ok: false, motivo: err.code || err.message };
    }
}

// ============================================================
// Testa fontes diretas (só verifica se domínio responde)
// ============================================================
async function testarDireto(fonte) {
    try {
        const r = await axios.get(fonte.url, {
            headers:        { ...H, 'Referer': fonte.referer },
            timeout:        fonte.timeout,
            maxRedirects:   5,
            responseType:   'stream',
            validateStatus: s => s < 500,
        });
        r.data.destroy();
        return { ok: true };
    } catch (err) {
        return { ok: false, motivo: err.code || err.message };
    }
}

// ============================================================
// Limpa HTML antes de servir (fontes proxy)
// ============================================================
function limparHtml(html, baseUrl) {
    html = html.replace(
        /<script[^>]+src=["'][^"']*(?:popads|popcash|adsterra|adnxs|histats|doubleclick|googlesyndication|amazon-adsystem)[^"']*["'][^>]*><\/script>/gi, ''
    );
    html = html.replace(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/gi, (match, code) => {
        const low = code.toLowerCase();
        if (low.includes('window.open(') || low.includes('location.replace(') ||
            (low.includes('window.location') && low.includes('=') && !low.includes('addeventlistener'))) {
            return '<!-- removido -->';
        }
        return match;
    });
    html = html.replace(/<meta[^>]*http-equiv=["'](?:X-Frame-Options|Content-Security-Policy)["'][^>]*>/gi, '');
    if (/<head/i.test(html)) {
        html = html.replace(/<head([^>]*)>/i, `<head$1><base href="${baseUrl}/">`);
    } else {
        html = `<base href="${baseUrl}/">` + html;
    }
    return html;
}

// ============================================================
// ROTA 1 — Em alta
// ============================================================
app.get('/api/em-alta', async (req, res) => {
    try {
        const r = await axios.get(`https://api.themoviedb.org/3/movie/popular?api_key=${TMDB_KEY}&language=pt-BR&page=1`);
        res.json(r.data.results.map(f => ({
            id:      f.id,
            titulo:  f.title,
            sinopse: f.overview,
            nota:    f.vote_average ? f.vote_average.toFixed(1) : 'N/A',
            ano:     f.release_date ? f.release_date.substring(0, 4) : '',
            capa:    f.poster_path ? `https://image.tmdb.org/t/p/w500${f.poster_path}` : '',
        })));
    } catch (e) { res.status(500).json([]); }
});

// ============================================================
// ROTA 2 — Busca
// ============================================================
app.get('/api/buscar', async (req, res) => {
    const nome = req.query.nome;
    if (!nome) return res.status(400).json([]);
    try {
        const r = await axios.get(`https://api.themoviedb.org/3/search/movie?api_key=${TMDB_KEY}&query=${encodeURIComponent(nome)}&language=pt-BR`);
        res.json(r.data.results.map(f => ({
            id:      f.id,
            titulo:  f.title,
            sinopse: f.overview,
            nota:    f.vote_average ? f.vote_average.toFixed(1) : 'N/A',
            ano:     f.release_date ? f.release_date.substring(0, 4) : '',
            capa:    f.poster_path ? `https://image.tmdb.org/t/p/w500${f.poster_path}` : '',
        })));
    } catch (e) { res.status(500).json([]); }
});

// ============================================================
// ROTA 3 — Detecta players
// Busca IMDB ID do filme em paralelo com os testes de fonte
// ============================================================
app.get('/api/player/:id', async (req, res) => {
    const filmeId = req.params.id;

    // Busca IMDB ID em paralelo (necessário para fontes BR)
    const imdbId = await getImdbId(filmeId);
    console.log(`\n[player] ID ${filmeId} → IMDB: ${imdbId || 'não encontrado'}`);

    const fontes = getFontes(filmeId, imdbId);
    console.log(`[player] Testando ${fontes.length} fontes...`);

    const resultados = await Promise.allSettled(
        fontes.map(async (fonte, i) => {
            const t0    = Date.now();
            const teste = fonte.modo === 'proxy'
                ? await testarProxy(fonte)
                : await testarDireto(fonte);
            console.log(`  [${i}] ${fonte.nome.padEnd(22)} ${teste.ok?'✅':'❌'} ${Date.now()-t0}ms  ${teste.motivo||''}`);
            return { fonte, teste, i };
        })
    );

    const players = resultados
        .filter(r => r.status === 'fulfilled')
        .map(({ value: { fonte, teste, i } }) => ({
            nome:      fonte.nome,
            dub:       fonte.dub,
            funcionou: teste.ok,
            motivo:    teste.motivo || null,
            url:       fonte.modo === 'direto'
                           ? fonte.url
                           : `${req.protocol}://${req.get('host')}/proxy/player/${filmeId}/${i}`,
        }))
        .sort((a, b) => {
            const s = p => p.funcionou ? (p.dub ? 2 : 1) : 0;
            return s(b) - s(a);
        });

    const melhor = players.find(p => p.funcionou) || null;
    console.log(`[player] Melhor: ${melhor?.nome || 'nenhuma'}\n`);
    res.json({ players, melhor });
});

// ============================================================
// ROTA 4 — Proxy reverso (fontes modo "proxy")
// ============================================================
app.get('/proxy/player/:filmeId/:fonteIndex', async (req, res) => {
    const { filmeId, fonteIndex } = req.params;
    const imdbId = await getImdbId(filmeId);
    const fontes = getFontes(filmeId, imdbId);
    const fonte  = fontes[parseInt(fonteIndex)];

    if (!fonte) return res.status(400).send('Fonte inválida');
    console.log(`[proxy] → ${fonte.nome}`);

    res.removeHeader('X-Frame-Options');
    res.removeHeader('Content-Security-Policy');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');

    try {
        const r = await axios.get(fonte.url, {
            headers: { ...H, 'Referer': fonte.referer, 'Origin': new URL(fonte.url).origin },
            responseType: 'arraybuffer',
            timeout:      fonte.timeout + 5000,
            maxRedirects: 10,
        });

        const html = Buffer.from(r.data).toString('utf-8');

        for (const b of BLOQUEIOS) {
            if (html.includes(b)) {
                return res.send(htmlErro(fonte.nome, 'Proteção detectada — tente outra fonte'));
            }
        }

        res.send(limparHtml(html, new URL(fonte.url).origin));
    } catch (err) {
        res.status(502).send(htmlErro(fonte.nome, err.code || err.message));
    }
});

// ============================================================
// ROTA 5 — Debug
// ============================================================
app.get('/debug/player/:filmeId/:fonteIndex', async (req, res) => {
    const { filmeId, fonteIndex } = req.params;
    const imdbId = await getImdbId(filmeId);
    const fontes = getFontes(filmeId, imdbId);
    const fonte  = fontes[parseInt(fonteIndex)];
    if (!fonte) return res.status(400).send('Fonte inválida');

    try {
        const r = await axios.get(fonte.url, {
            headers: { ...H, 'Referer': fonte.referer || fonte.url },
            responseType: 'text', timeout: 15000, maxRedirects: 10,
        });
        const html = r.data || '';
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.send([
            `=== DEBUG [${fonteIndex}] ${fonte.nome} ===`,
            `TMDB ID   : ${filmeId}`,
            `IMDB ID   : ${imdbId || 'não encontrado'}`,
            `URL       : ${fonte.url}`,
            `Modo      : ${fonte.modo}`,
            `Status    : ${r.status}`,
            `Ct-Type   : ${r.headers['content-type']}`,
            `Tamanho   : ${html.length} chars`,
            ``,
            `=== IFRAMEs ===`,
            ...[...html.matchAll(/<iframe[^>]+src=["']([^"']+)["']/gi)].map(m => '  ' + m[1]),
            ``,
            `=== BLOQUEIOS ===`,
            ...BLOQUEIOS.filter(b => html.includes(b)).map(b => '  ⚠ ' + b),
            ``,
            `=== PRIMEIROS 3000 CHARS ===`,
            html.substring(0, 3000),
        ].join('\n'));
    } catch (err) {
        res.status(502).send(`Erro: ${err.message}`);
    }
});

// ============================================================
// Helpers HTML
// ============================================================
function htmlErro(nome, motivo) {
    return `<!DOCTYPE html><html><body style="background:#111;color:#fff;font-family:sans-serif;
display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column;gap:14px;text-align:center;padding:24px">
<div style="font-size:2.5rem">⚠️</div>
<h2 style="color:#E50914">Fonte indisponível</h2>
<p style="color:#888">${nome}</p>
<p style="color:#555;font-size:.8rem">${motivo || ''}</p>
<p style="color:#444;font-size:.75rem">Tente outra fonte na barra acima.</p>
</body></html>`;
}

// ============================================================
app.listen(PORT, '0.0.0.0', () => {
    console.log(`
╔══════════════════════════════════════════╗
║   🚀  CLOUDSTREAM BACKEND  —  v4.0      ║
╠══════════════════════════════════════════╣
║  Porta           : ${String(PORT).padEnd(21)}║
║  Fontes DUB BR   : WatchCDN, CdnEmbed,  ║
║                    UltraEmbed           ║
║  Fontes Fallback : VidSrc, AutoEmbed,   ║
║                    MoviesAPI, VidSrc.in ║
║  IMDB resolver   : ativo ✅             ║
╚══════════════════════════════════════════╝
    `);
});
