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
app.get('/listas-tv.js', (req,res) => {res.setHeader('Cache-Control','no-store');res.type('js').send(fs.readFileSync(path.join(RAIZ,'listas-tv.js')));});
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

// FUTEMAX — jogo ao vivo. `?url=` abre o jogo escolhido. O endereço do vídeo é
// resolvido na hora e passa pelo encaminhador do aplicativo (o player nunca
// abre a página com anúncio).
const futemax = require('../futemax-source');
const futemaxCache = new Map();
function futemaxGet() {
    return async (url, referer) => {
        const r = await axios.get(url, {
            timeout: 15000, maxRedirects: 5, responseType: 'text', maxContentLength: 4 * 1024 * 1024,
            headers: { 'User-Agent': futemax.UA, Accept: '*/*', ...(referer ? { Referer: referer } : {}) },
            validateStatus: status => status < 500,
        });
        return r.data;
    };
}
app.get('/api/tv/futemax', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const jogo = String(req.query.url || req.query.jogo || '').slice(0, 300);
    if (!jogo) return res.status(400).json({ error: 'Informe o endereço do jogo no Futemax.' });
    try {
        const guardado = futemaxCache.get(jogo);
        if (guardado && Date.now() - guardado.at < 4 * 60 * 1000) return res.json(guardado.dados);
        const source = await futemax.resolve(jogo, futemaxGet());
        const proxy = require('../midia-proxy');
        proxy.liberarHost(new URL(source.url).hostname);
        const dados = { ...source, url: proxy.urlViaProxy(source.url, source.referer) };
        if (futemaxCache.size >= 20) futemaxCache.delete(futemaxCache.keys().next().value);
        futemaxCache.set(jogo, { at: Date.now(), dados });
        res.json(dados);
    } catch (erro) {
        res.status(502).json({ error: 'O Futemax não abriu este jogo sem anúncio agora.', detalhe: String(erro.message).slice(0, 160) });
    }
});
// Lista "ao vivo agora": os jogos que o Futemax publica hoje na página inicial.
const futemaxListaCache = { at: 0, dados: null };
app.get('/api/tv/futemax/jogos', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const agora = new Date();
    const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(agora);
    if (futemaxListaCache.dados && Date.now() - futemaxListaCache.at < 5 * 60 * 1000) {
        return res.json({ ...futemaxListaCache.dados, cache: true });
    }
    try {
        const html = await futemaxGet()('https://futemax.ltda/', 'https://futemax.ltda/');
        const todos = futemax.jogosDoDia(html);
        const doDia = todos.filter(jogo => jogo.data === hoje);
        const dados = { data: hoje, total: (doDia.length ? doDia : todos).length, jogos: (doDia.length ? doDia : todos).slice(0, 30) };
        futemaxListaCache.at = Date.now(); futemaxListaCache.dados = dados;
        res.json(dados);
    } catch {
        res.status(502).json({ error: 'Não foi possível listar os jogos do Futemax agora.' });
    }
});
app.get('/api/tv/listas', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const todas = typeof tvAoVivo.listarTodas === 'function' ? tvAoVivo.listarTodas() : tvAoVivo.LISTAS;
    res.json({ listas: todas.map(l => ({ id: l.id, nome: l.nome, nota: l.nota, setor: l.setor || '', doCacador: Boolean(l.doCacador) })) });
});
app.get('/api/tv/canais', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
        const lista = String(req.query.lista || 'brasil').slice(0, 40);
        const setor = String(req.query.setor || '').slice(0, 30);
        const canais = await tvAoVivo.canais(lista);
        const listasTv = require('../listas-tv');
        const busca = String(req.query.q || '').toLowerCase().slice(0, 40);
        const porSetor = setor ? canais.filter(c => listasTv.pertenceAoSetor(c, setor)) : canais;
        const filtrados = busca ? porSetor.filter(c => c.nome.toLowerCase().includes(busca) || c.grupo.toLowerCase().includes(busca)) : porSetor;
        res.json({ lista, setor: setor || 'todos', total: filtrados.length, canais: filtrados.slice(0, 400) });
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
