// rotas/tv.js — Vigia das fontes, TV ao vivo, futebol e mini novelas.
// Separado do server.js na reorganização de 10/2026: o código é o mesmo,
// só mudou de arquivo. RAIZ é a pasta do server.js (antes, __dirname).
module.exports = function registrar(app, ctx) {
const { RAIZ, TMDB_KEY, axios, central, fs, path } = ctx;
// ============================================================
// VIGIA DAS FONTES — o robô que testa filmes em rodízio, 24 horas por dia,
// e alimenta a saúde das fontes. A correção é automática: o motor e o
// avaliador passam a evitar a fonte que não entrega vídeo.
// ============================================================
app.get('/api/vigia', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try { res.json(require('../vigia-fontes').resumo()); } catch (erro) { res.status(500).json({ erro: erro.message }); }
});
app.post('/api/vigia/rodar', async (req, res) => {
    try {
        const resultado = await require('../vigia-fontes').rodarRodada({
            tmdbKey: TMDB_KEY,
            registrar: mensagem => console.log('[vigia] ' + mensagem),
            reportar: evento => central.reportar(evento),
        });
        res.json({ ok: true, resultado });
    } catch (erro) { res.status(500).json({ ok: false, erro: erro.message }); }
});

// ============================================================
// TV AO VIVO — canais das listas públicas (iptv-org) que o caçador
// da central aprovou com nota acima de 8.
// ============================================================
const tvAoVivo = require('../tv-ao-vivo');
const futebolCache = new Map();
app.get('/futebol.js', (req,res) => {res.setHeader('Cache-Control','no-store');res.type('js').send(fs.readFileSync(path.join(RAIZ,'futebol.js')));});
app.get('/api/futebol/agenda', async (req,res) => {
    res.setHeader('Cache-Control','no-store');
    const agenda = require('../futebol');
    const league = String(req.query.liga || ''), date = String(req.query.data || '');
    if (!Object.hasOwn(agenda.leagues,league) || !agenda.validDate(date)) return res.status(400).json({error:'Escolha campeonato e data válidos.'});
    const key = league + date;
    const cached = futebolCache.get(key);
    if(cached && Date.now()-cached.at < 45000) return res.json(cached.data);
    try {
        const response = await axios.get('https://site.api.espn.com/apis/site/v2/sports/soccer/'+league+'/scoreboard', {params:{dates:date.replace(/-/g,''),limit:100,lang:'pt',region:'br'},timeout:18000,maxContentLength:4*1024*1024});
        if(!Array.isArray(response.data?.events)) throw Error('Agenda indisponível');
        if(futebolCache.size>=30) futebolCache.delete(futebolCache.keys().next().value);
        futebolCache.set(key,{at:Date.now(),data:response.data});res.json(response.data);
    } catch {res.status(502).json({error:'Não foi possível consultar esta programação agora.'});}
});
app.get('/api/tv/la18hd', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
        const source = await require('../la18hd-source').resolve(async (url, referer) => {
            const r = await axios.get(url, {timeout:15000, maxRedirects:0, responseType:'text', maxContentLength:1024*1024,
                headers:{'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36', Referer:referer}});
            return r.data;
        });
        const proxy = require('../midia-proxy');
        proxy.liberarHost(new URL(source.url).hostname);
        res.json({...source, url:proxy.urlViaProxy(source.url, source.referer)});
    } catch { res.status(502).json({error:'LA18HD não respondeu. Tente novamente ou escolha outra transmissão.'}); }
});
app.get('/api/tv/listas', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ listas: tvAoVivo.LISTAS.map(l => ({ id: l.id, nome: l.nome, nota: l.nota })) });
});
app.get('/api/tv/canais', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
        const lista = String(req.query.lista || 'brasil').slice(0, 20);
        const canais = await tvAoVivo.canais(lista);
        const busca = String(req.query.q || '').toLowerCase().slice(0, 40);
        const filtrados = busca ? canais.filter(c => c.nome.toLowerCase().includes(busca) || c.grupo.toLowerCase().includes(busca)) : canais;
        res.json({ lista, total: filtrados.length, canais: filtrados.slice(0, 400) });
    } catch {
        res.status(502).json({ error: 'Não foi possível carregar os canais agora.' });
    }
});

// Categorias (grupos) dos canais da lista escolhida — é o que alimenta as
// abas de categoria na tela de TV ao vivo.
app.get('/api/tv/categorias', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
        const lista = String(req.query.lista || 'brasil').slice(0, 20);
        const canais = await tvAoVivo.canais(lista);
        const contagem = new Map();
        for (const canal of canais) {
            const grupo = (canal.grupo || 'Outros').trim() || 'Outros';
            contagem.set(grupo, (contagem.get(grupo) || 0) + 1);
        }
        const categorias = [...contagem.entries()]
            .map(([nome, total]) => ({ nome, total }))
            .sort((a, b) => b.total - a.total);
        res.json({ lista, total: canais.length, categorias });
    } catch {
        res.status(502).json({ error: 'Não foi possível listar as categorias agora.' });
    }
});

// Catálogo público de mininovelas; não aceita destinos arbitrários nem redirecionamentos.
app.get('/api/mininovelas/pagina', async (req, res) => {
    const url = String(req.query.url || '');
    if (!require('../mininovelas-source').paginaPermitida(url)) return res.status(400).json({ error: 'Página não permitida' });
    try {
        const html = await require('../mininovelas-http').buscarPagina(url);
        res.setHeader('Cache-Control', 'no-store'); res.type('text/plain').send(html);
    } catch { res.status(502).json({ error: 'Fornecedor indisponível' }); }
});
app.get('/mininovelas-source.js', (req, res) => res.sendFile(path.join(RAIZ, 'mininovelas-source.js')));
app.get('/mininovelas.js', (req, res) => res.sendFile(path.join(RAIZ, 'mininovelas.js')));

return { tvAoVivo, futebolCache };
};
