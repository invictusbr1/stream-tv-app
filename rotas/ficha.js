// rotas/ficha.js — Ficha do título (07/11/2026). Antes a sinopse aparecia
// duas vezes; no lugar da repetida vêm informações (duração, elenco,
// classificação, trailer…), o que a crítica diz (TMDB) e os COMENTÁRIOS DA
// FAMÍLIA: quem usa o app deixa nota e um comentário curto para os outros.
const fs = require('node:fs');
const path = require('node:path');

module.exports = function registrar(app, ctx) {
    const { DADOS_DIR, TMDB_KEY } = ctx;
    const IMG = 'https://image.tmdb.org/t/p/';
    const fichas = new Map();
    const tipoOk = t => (t === 'tv' ? 'tv' : t === 'movie' ? 'movie' : '');

    async function pedirJson(url, ms = 12000) {
        const controle = new AbortController();
        const relogio = setTimeout(() => controle.abort(), ms);
        try { const r = await fetch(url, { signal: controle.signal, headers: { Accept: 'application/json' } }); return r.ok ? await r.json() : null; }
        catch { return null; } finally { clearTimeout(relogio); }
    }

    function montarFicha(d, tipo, criticasEn) {
        const credits = d.credits || {};
        const classificacao = tipo === 'movie'
            ? (((d.release_dates && d.release_dates.results) || []).find(r => r.iso_3166_1 === 'BR') || { release_dates: [] }).release_dates.map(x => x.certification).find(Boolean) || ''
            : ((((d.content_ratings && d.content_ratings.results) || []).find(r => r.iso_3166_1 === 'BR')) || {}).rating || '';
        const videos = ((d.videos && d.videos.results) || []).filter(v => v.site === 'YouTube' && /^[A-Za-z0-9_-]{6,20}$/.test(v.key || ''));
        const trailer = videos.find(v => v.type === 'Trailer' && /^pt/.test(v.iso_639_1 || '')) || videos.find(v => v.type === 'Trailer') || videos.find(v => v.type === 'Teaser') || null;
        const todasCriticas = [...(((d.reviews && d.reviews.results) || [])), ...criticasEn];
        const criticas = todasCriticas.filter((c, i, a) => c && c.content && a.findIndex(x => x.id === c.id) === i).slice(0, 3).map(c => ({
            autor: String(c.author || 'Anônimo').slice(0, 60),
            nota: Number(c.author_details && c.author_details.rating) || null,
            texto: String(c.content).replace(/\s+/g, ' ').trim().slice(0, 420),
            ingles: !/[ãõçáéíóúâêô]/i.test(String(c.content).slice(0, 400)),
        }));
        return {
            tipo,
            duracao: tipo === 'movie' ? Number(d.runtime) || 0 : Number((d.episode_run_time || [])[0]) || 0,
            temporadas: Number(d.number_of_seasons) || 0,
            episodios: Number(d.number_of_episodes) || 0,
            estreia: String(d.release_date || d.first_air_date || ''),
            situacao: tipo === 'tv' ? ({ 'Returning Series': 'Em produção', Ended: 'Finalizada', Canceled: 'Cancelada', 'In Production': 'Em produção' }[d.status] || '') : '',
            classificacao,
            idiomaOriginal: String(d.original_language || ''),
            tituloOriginal: String(d.original_title || d.original_name || ''),
            pais: ((d.production_countries || []).map(p => p.name)).slice(0, 2),
            produtoras: ((d.production_companies || d.networks || []).map(p => p.name)).slice(0, 3),
            direcao: tipo === 'movie' ? (credits.crew || []).filter(c => c.job === 'Director').map(c => c.name).slice(0, 2) : (d.created_by || []).map(c => c.name).slice(0, 3),
            elenco: (credits.cast || []).slice(0, 10).map(c => ({ nome: String(c.name || ''), personagem: String(c.character || ''), foto: c.profile_path ? IMG + 'w185' + c.profile_path : '' })),
            nota: Number(d.vote_average) ? Math.round(Number(d.vote_average) * 10) / 10 : null,
            votos: Number(d.vote_count) || 0,
            colecao: d.belongs_to_collection ? String(d.belongs_to_collection.name || '') : '',
            frase: String(d.tagline || ''),
            trailer: trailer ? trailer.key : '',
            criticas,
        };
    }

    app.get('/api/ficha/:tipo/:id', async (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        const tipo = tipoOk(req.params.tipo), id = String(req.params.id);
        if (!tipo || !/^\d{1,10}$/.test(id)) return res.status(400).json({ ok: false });
        const chave = tipo + ':' + id, guardada = fichas.get(chave);
        if (guardada && Date.now() - guardada.em < 24 * 60 * 60 * 1000) return res.json(guardada.ficha);
        const extra = tipo === 'movie' ? 'credits,release_dates,reviews,videos' : 'credits,content_ratings,reviews,videos';
        const d = await pedirJson(`https://api.themoviedb.org/3/${tipo}/${id}?api_key=${TMDB_KEY}&language=pt-BR&append_to_response=${extra}&include_video_language=pt,en`);
        if (!d) return res.status(502).json({ ok: false });
        // Crítica em português é rara: completa com as em inglês.
        const en = (d.reviews && d.reviews.results && d.reviews.results.length >= 3) ? null : await pedirJson(`https://api.themoviedb.org/3/${tipo}/${id}/reviews?api_key=${TMDB_KEY}&language=en-US`);
        const ficha = montarFicha(d, tipo, (en && en.results) || []);
        fichas.set(chave, { em: Date.now(), ficha });
        if (fichas.size > 500) fichas.delete(fichas.keys().next().value);
        res.json(ficha);
    });

    // ------------------------------------------------ comentários da família
    const arquivo = path.join(DADOS_DIR || '.', 'comentarios.json');
    let dados = null;
    const ler = () => { if (dados) return dados; try { dados = JSON.parse(fs.readFileSync(arquivo, 'utf8')); } catch { dados = {}; } if (!dados || typeof dados !== 'object') dados = {}; return dados; };
    const gravar = () => { try { fs.mkdirSync(path.dirname(arquivo), { recursive: true }); const tmp = arquivo + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(dados)); fs.renameSync(tmp, arquivo); } catch { /* sem disco: fica na memória */ } };
    // Quem comentou: o aparelho autorizado (nome que a pessoa cadastrou).
    // O app Android fala com o servidor pelo código do público (sem crachá):
    // aí ele manda o id do aparelho e o nome vem do cadastro, se houver.
    const autorDe = req => {
        let a = req.dispositivoAutorizado;
        if (!a || !a.dispositivo) {
            const disp = String((req.query && req.query.disp) || '');
            if (/^[a-z0-9]{6,32}$/.test(disp)) {
                let nome = '';
                try { const todos = (ctx.seguranca && ctx.seguranca.autorizados && ctx.seguranca.autorizados()) || {}; nome = (Object.values(todos).find(x => x && x.dispositivo === disp) || {}).nome || ''; } catch { /* sem cadastro */ }
                a = { dispositivo: disp, nome };
            }
        }
        a = a || {};
        return { chave: String(a.dispositivo || a.aparelho || req.ip || 'anon').slice(0, 80), nome: String(a.nome || 'Alguém da família').slice(0, 40) };
    };
    const publico = (lista, eu) => (lista || []).slice().sort((a, b) => b.em - a.em).map(c => ({ nome: c.nome, nota: c.nota, texto: c.texto, em: c.em, meu: c.chave === eu }));

    app.get('/api/comentarios/:tipo/:id', (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        const tipo = tipoOk(req.params.tipo), id = String(req.params.id);
        if (!tipo || !/^\d{1,10}$/.test(id)) return res.status(400).json([]);
        res.json(publico(ler()[tipo + ':' + id], autorDe(req).chave));
    });
    function salvar(req, res, corpo) {
        res.setHeader('Cache-Control', 'no-store');
        const tipo = tipoOk(req.params.tipo), id = String(req.params.id);
        if (!tipo || !/^\d{1,10}$/.test(id)) return res.status(400).json({ ok: false });
        const nota = Math.round(Number(corpo && corpo.nota));
        const texto = String((corpo && corpo.texto) || '').replace(/[\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 280);
        if (!(nota >= 1 && nota <= 5) && !texto) return res.status(400).json({ ok: false, motivo: 'escreva algo ou dê uma nota' });
        const eu = autorDe(req), chave = tipo + ':' + id, todos = ler();
        const lista = (todos[chave] || []).filter(c => c.chave !== eu.chave);
        lista.push({ chave: eu.chave, nome: eu.nome, nota: nota >= 1 && nota <= 5 ? nota : null, texto, em: Date.now() });
        todos[chave] = lista.slice(-100);
        gravar();
        res.json(publico(todos[chave], eu.chave));
    }
    function apagar(req, res) {
        res.setHeader('Cache-Control', 'no-store');
        const tipo = tipoOk(req.params.tipo), id = String(req.params.id);
        if (!tipo || !/^\d{1,10}$/.test(id)) return res.status(400).json({ ok: false });
        const eu = autorDe(req), chave = tipo + ':' + id, todos = ler();
        todos[chave] = (todos[chave] || []).filter(c => c.chave !== eu.chave);
        gravar();
        res.json(publico(todos[chave], eu.chave));
    }
    app.post('/api/comentarios/:tipo/:id', (req, res) => salvar(req, res, req.body));
    app.delete('/api/comentarios/:tipo/:id', apagar);
    // O app Android só encaminha GET ao servidor: mesmas ações por GET.
    app.get('/api/comentarios/:tipo/:id/enviar', (req, res) => salvar(req, res, req.query));
    app.get('/api/comentarios/:tipo/:id/apagar', apagar);
    return {};
};
