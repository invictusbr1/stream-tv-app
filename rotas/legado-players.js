// rotas/legado-players.js — Lista de players e modo de compatibilidade antigo (/api/player, /assistir, /proxy/player, /debug/player).
// Separado do server.js na reorganização de 10/2026: o código é o mesmo,
// só mudou de arquivo. RAIZ é a pasta do server.js (antes, __dirname).
module.exports = function registrar(app, ctx) {
const { H, TMDB_KEY, axios, libraryCatalog } = ctx;
// ============================================================
// FONTES — atualizado em 06/10/2026 com teste em navegador real
//
// ATIVAS (entregaram vídeo no teste):
//   PipocaCine → 720p, faixas de áudio PT e EN. Tem anúncio: só como último caso.
//   VidLink    → 1080p (HEVC), a única opção Full HD encontrada. Tem anúncio.
//
// DESLIGADAS (dub:false e sem optional): ficam fora da lista do aplicativo.
//   watchcdn, cdn-embed, ultraembed → página vazia ou anúncio, sem vídeo
//   vidsrc.me, autoembed, moviesapi, vidsrc.in → resposta vazia, erro ou anúncio
//   vidsrc.wtf, vidfast, vidbinge, 2embed, multiembed, videasy, nontongo, 111movies,
//   embed.su, vidjoy, smashy, filmxy, vidsrc.to, vidsrc.net, vidsrc.mov, vidora.su
//     → Cloudflare, verificação humana ou pop-up de anúncio; nenhum entregou vídeo limpo
//   superflixapi.monster, streambetter.shop → pedem confirmação humana ("não sou robô")
//
// REGRA DO PROJETO: fonte sem anúncio primeiro; anúncio somente como último caso,
// sempre fora do aplicativo, na janela separada do modo com anúncios.
// ============================================================
function getFontes(filmeId, imdbId) {
    const imdb = imdbId || filmeId; // fallback para tmdb se sem imdb
    return [

        // ── Último caso: abre em janela separada para os anúncios da fonte ──
        {
            nome:     'PipocaCine (720p · PT e original)',
            url:      `https://pipocacine.lat/embed/${filmeId}`,
            referer:  'https://pipocacine.lat/',
            dub:      false,
            optional: true,
            comAnuncios: true,
            qualidade:'720p · áudio PT e EN',
            modo:     'direto',
            timeout:  8000,
        },
        {
            nome:     'VidLink (Full HD)',
            url:      `https://vidlink.pro/movie/${filmeId}`,
            referer:  'https://vidlink.pro/',
            dub:      false,
            optional: true,
            comAnuncios: true,
            qualidade:'1080p (HEVC)',
            modo:     'direto',
            timeout:  8000,
        },

        // ── Desligadas: não entregaram vídeo em 06/10/2026 ────
        {
            nome:    'WatchCDN (indisponível)',
            url:     `https://embed.watchcdn.org/filme/${imdb}`,
            referer: 'https://watchcdn.org/',
            dub:     false,
            modo:    'direto',
            timeout: 8000,
        },
        {
            nome:    'CdnEmbed (somente anúncio)',
            url:     `https://cdn-embed.com/filme/${filmeId}`,
            referer: 'https://embedmovies.org/',
            dub:     false,
            modo:    'direto',
            timeout: 8000,
        },
        {
            nome:    'UltraEmbed (indisponível)',
            url:     `https://ultraembed.com/filme/${imdb}`,
            referer: 'https://ultraembed.com/',
            dub:     false,
            modo:    'direto',
            timeout: 8000,
        },
        {
            nome:    'VidSrc.me (indisponível)',
            url:     `https://vidsrc.me/embed/movie?tmdb=${filmeId}`,
            referer: 'https://vidsrc.me/',
            dub:     false,
            modo:    'proxy',
            timeout: 10000,
        },
        {
            nome:    'AutoEmbed (somente anúncio)',
            url:     `https://autoembed.co/movie/tmdb/${filmeId}`,
            referer: 'https://autoembed.co/',
            dub:     false,
            modo:    'proxy',
            timeout: 8000,
        },
        {
            nome:    'MoviesAPI (indisponível)',
            url:     `https://moviesapi.club/movie/${filmeId}`,
            referer: 'https://moviesapi.club/',
            dub:     false,
            modo:    'proxy',
            timeout: 8000,
        },
        {
            nome:    'VidSrc.in (indisponível)',
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
async function getImdbId(tmdbId, tipo = 'movie') {
    try {
        // Série só resolve o IMDb na rota /tv/ — em /movie/ o TMDB devolve imdb_id null
        const rota = ['tv', 'serie', 'series'].includes(String(tipo).toLowerCase()) ? 'tv' : 'movie';
        const r = await axios.get(
            `https://api.themoviedb.org/3/${rota}/${tmdbId}/external_ids?api_key=${TMDB_KEY}`,
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
            if (html.includes(b)) return { ok: false, manual: true, motivo: 'Esta fonte precisa ser aberta no navegador para verificação' };
        }

        const low = html.toLowerCase();
        for (const e of ERROS_HTML) {
            if (low.includes(e) && html.length < 5000) return { ok: false, motivo: `erro: ${e}` };
        }

        return { ok: true };
    } catch (err) {
        return { ok: false, manual: [401, 403, 429, 503].includes(err.response?.status), motivo: err.code || err.message };
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
            responseType:   'text',
            maxContentLength: 2 * 1024 * 1024,
            validateStatus: s => s >= 200 && s < 300,
        });
        const html = String(r.data || '').trim();
        if (!r.headers['content-type']?.includes('text/html')) return { ok: false, motivo: 'Resposta não é uma página de vídeo' };
        if (html.length < 400) return { ok: false, motivo: 'Fonte retornou uma página vazia' };
        if (/challenges\.cloudflare\.com|hcaptcha\.com|captcha-gate|turnstile|recaptcha/i.test(html)) return { ok: false, manual: true, motivo: 'Fonte exige verificação no navegador' };
        if (ERROS_HTML.some(e => html.toLowerCase().includes(e)) && html.length < 5000) return { ok: false, motivo: 'Conteúdo indisponível na fonte' };
        return { ok: true };
    } catch (err) {
        return { ok: false, manual: [401, 403, 429, 503].includes(err.response?.status), motivo: err.code || err.message };
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
// ROTA 3 — Detecta players
// Busca IMDB ID do filme em paralelo com os testes de fonte
// ============================================================
app.get('/api/player/:id', async (req, res) => {
    const filmeId = req.params.id;
    if (!/^\d{1,10}$/.test(filmeId)) return res.status(400).json({ error: 'Identificador de filme inválido' });

    // Busca IMDB ID em paralelo (necessário para fontes BR)
    const imdbId = await getImdbId(filmeId);
    console.log(`\n[player] ID ${filmeId} → IMDB: ${imdbId || 'não encontrado'}`);

    const fontes = getFontes(filmeId, imdbId);
    console.log(`[player] Testando ${fontes.length} fontes...`);

    const resultados = await Promise.allSettled(
        fontes.map((fonte, i) => ({ fonte, i })).filter(({ fonte }) => fonte.dub || fonte.optional).map(async ({ fonte, i }) => {
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
            optional: Boolean(fonte.optional),
            funcionou: teste.ok,
            qualidade: fonte.qualidade || null,
            manual:    Boolean(teste.manual)||Boolean(fonte.comAnuncios),
            status:    teste.ok ? 'pagina-acessivel' : teste.manual ? 'verificacao-no-navegador' : 'indisponivel',
            motivo:    teste.motivo || null,
            url:       fonte.url,
            urlCompatibilidade: `/assistir/${filmeId}/${i}`,
        }))
        .sort((a, b) => {
            const s = p => (p.funcionou ? 10 : 0) + (p.nome.startsWith('CdnEmbed') ? 1 : 0);
            return s(b) - s(a);
        });

    try { const additional=await libraryCatalog.sources(filmeId); players.push(...additional.filter(p=>p.index>=8)); } catch {}
    const melhor = players.find(p => p.dub && p.funcionou) || null;
    console.log(`[player] Melhor: ${melhor?.nome || 'nenhuma'}\n`);
    res.json({ players, melhor });
});

// ============================================================
// Modo opcional em aba separada. Mantém o contexto de incorporação exigido
// pelo fornecedor, permitindo seus formulários, pop-ups e verificações.
// A abertura é sempre uma escolha do usuário, nunca um fallback automático.
app.get('/assistir/:filmeId/:fonteIndex', async (req, res) => {
    const { filmeId, fonteIndex } = req.params;
    if (!/^\d{1,10}$/.test(filmeId) || !/^[0-7]$/.test(fonteIndex)) return res.status(400).send('Fonte inválida');
    return res.redirect(`/assistir.html?id=${filmeId}&source=${fonteIndex}`);
});

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
    res.setHeader('Content-Security-Policy', 'sandbox allow-scripts allow-presentation');

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

return { getFontes, getImdbId, BLOQUEIOS, ERROS_HTML, testarProxy, testarDireto, limparHtml, htmlErro };
};
