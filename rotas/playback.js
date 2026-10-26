// rotas/playback.js — Reprodução: proxy de mídia, escolha da fonte de filme/episódio, anime, HD e diagnóstico do motor.
// Separado do server.js na reorganização de 10/2026: o código é o mesmo,
// só mudou de arquivo. RAIZ é a pasta do server.js (antes, __dirname).
module.exports = function registrar(app, ctx) {
const { LOCAL_CONFIG, RAIZ, TMDB_KEY, fs, path, seguranca } = ctx;

// ============================================================
// ENCAMINHAMENTO DO VÍDEO — o provedor de mídia exige um "referer"
// próprio que o navegador não consegue enviar. O aplicativo busca o
// vídeo no servidor e repassa ao player, sem abrir páginas externas
// (ou seja: sem anúncio no caminho do usuário).
// ============================================================
const midia = require('../midia-proxy');
app.get('/api/hls', async (req, res) => {
    let endereco;
    let referer = '';
    let pai = '';
    try {
        endereco = new URL(midia.textoDeBase64url(req.query.u));
        if (req.query.r) referer = midia.textoDeBase64url(req.query.r);
        if (req.query.p) pai = midia.textoDeBase64url(req.query.p);
    } catch {
        return res.sendStatus(400);
    }
    // Só https, só host conhecido e nunca a rede de casa (proteção contra SSRF).
    if (endereco.protocol !== 'https:' || !midia.hostPermitido(endereco.hostname) || seguranca.hostInterno(endereco.hostname)) return res.sendStatus(403);
    const transferencia = new AbortController();
    res.once('close', () => transferencia.abort());
    const cabecalhosBase = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        Accept: '*/*',
        ...midia.cabecalhosDaMidia(endereco.href)
    };
    if (req.headers.range) cabecalhosBase.Range = req.headers.range;
    // Alguns provedores só liberam o vídeo quando o pedido vem da própria página
    // do player. Tenta o endereço de origem informado e, se falhar, o endereço que
    // indicou o vídeo.
    const tentativas = [...new Set([referer, pai, midia.refererPadrao(endereco.hostname)].filter(Boolean))];
    if (!tentativas.length) tentativas.push('');
    let resposta = null;
    for (const referencia of tentativas) {
        const cabecalhos = { ...cabecalhosBase };
        if (referencia) {
            cabecalhos.Referer = referencia;
            try { cabecalhos.Origin = new URL(referencia).origin; } catch { /* referer sem origem */ }
        }
        try {
            const r = await fetch(endereco.href, { headers: cabecalhos, redirect: 'follow', signal: transferencia.signal });
            if (r.ok || r.status === 206 || tentativas.length === 1) { resposta = { r, referencia }; break; }
        } catch { /* tenta a próxima referência */ }
    }
    if (!resposta) return res.sendStatus(502);
    const { r: respostaFinal, referencia: referenciaFinal } = resposta;
    try {
        const tipo = String(respostaFinal.headers.get('content-type') || '');
        const ehLista = /mpegurl|m3u8/i.test(tipo) || /\.m3u8$/i.test(endereco.pathname);
        if (ehLista) {
            const texto = await respostaFinal.text();
            // O provedor pode ter redirecionado a lista para outro servidor:
            // libera também o endereço final antes de reescrever os pedaços.
            try { midia.liberarHost(new URL(respostaFinal.url || endereco.href).hostname.toLowerCase()); } catch { /* endereço estranho */ }
            // A lista pode apontar para servidores de vídeo de outros domínios
            // (é assim no FenixFlix: a lista vem de um endereço e os pedaços do
            // filme vêm de outro). Como a lista veio de uma fonte já autorizada,
            // liberamos os domínios que ELA indica — sem isso o navegador tenta
            // falar direto com eles e o vídeo não abre.
            for (const achado of texto.matchAll(/https?:\/\/([a-z0-9.-]+\.[a-z]{2,})/gi)) {
                try { midia.liberarHost(achado[1].toLowerCase()); } catch { /* endereço estranho */ }
            }
            res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
            res.setHeader('Cache-Control', 'no-store');
            return res.send(midia.reescreverPlaylist(texto, respostaFinal.url || endereco.href, referenciaFinal));
        }
        res.status(respostaFinal.status);
        for (const nome of ['content-type', 'content-length', 'accept-ranges', 'content-range', 'last-modified', 'etag']) {
            const valor = respostaFinal.headers.get(nome);
            if (valor) res.setHeader(nome, valor);
        }
        if (!respostaFinal.body) return res.end();
        const { Readable } = require('stream');
        const fluxo = Readable.fromWeb(respostaFinal.body);
        fluxo.on('error', () => { if (!res.destroyed) res.destroy(); });
        return fluxo.pipe(res);
    } catch {
        res.sendStatus(502);
    }
});

// O WebView do APK não toca HEVC em arquivo direto e não pede a versão
// compatível sozinho. Quando o aparelho não confirma suporte (?codec=hevc),
// a rota entrega o melhor H.264 — melhor 1080p tocando do que 4K que não abre.
// O navegador (web/TV) continua livre: ele mesmo pede ?compat=avc quando precisa.
// A partir da 2.13.88 o APK acrescenta " StreamTVHevc" ao agente quando o
// aparelho tem decodificador HEVC (MediaCodecList). Sem essa marca ele recebe
// H.264; com ela pode receber 4K HEVC.
function codecDoPedido(req) {
    if (req.query.codec === 'hevc') return 'hevc';
    if (req.query.codec === 'avc') return 'avc';
    const agente = String(req.headers['user-agent'] || '');
    if (!/StreamTVAndroid/i.test(agente)) return '';
    return /StreamTVHevc/i.test(agente) ? 'hevc' : 'avc';
}
async function responderCompatibilidade(req, res, alvo) {
    if (req.query.compat !== 'avc') return false;
    // Tenta a fila normal só com fontes que comprovadamente tocam em H.264.
    // Só se nenhuma servir é que cai na conversão do FenixFlix.
    let pronto = null;
    try {
        const resultado = await require('../avaliador').escolherMelhor('dublado', alvo, { semCache: true, codec: 'avc' }).catch(() => null);
        if (resultado && resultado.escolhido) pronto = require('../fontes-motor').prepararParaPlayer(resultado.escolhido);
    } catch { /* segue para a conversão */ }
    if (!pronto) {
        const fonte = await require('../fenix-compativel').resolver(alvo);
        if (!fonte) { res.status(502).json({error:'Não foi encontrada uma versão dublada compatível neste fornecedor.'}); return true; }
        pronto = require('../fontes-motor').prepararParaPlayer(fonte);
    }
    res.json({url:require('../rede-playback.cjs').enderecoPlayback(req,pronto),audio:pronto.audio,source:pronto.fonte,fonteId:pronto.fonteId,type:pronto.type||'file',resolucao:pronto.resolucao,videoCodec:pronto.videoCodec||''});
    return true;
}
app.get('/api/playback/:id', async (req, res) => {
    if (!/^\d{1,10}$/.test(req.params.id)) return res.sendStatus(400);
    res.setHeader('Cache-Control', 'no-store');
    // O motor escolhe a fonte dublada limpa (e lembra qual deu certo).
    try {
        const motor = require('../fontes-motor');
        const avaliador = require('../avaliador');
        const exceto = String(req.query.exceto || '').split(',').map(item => item.trim()).filter(Boolean);
        const alvo = { tipo: 'movie', tmdbId: req.params.id };
        if (await responderCompatibilidade(req,res,alvo)) return;
        // Avaliador em tempo real: testa as melhores fontes do título em
        // paralelo e escolhe a que entrega mais qualidade seguindo as regras.
        let escolhido = null;
        let avaliacao = null;
        if (process.env.AVALIADOR !== '0') {
            const resultado = await avaliador.escolherMelhor('dublado', alvo, { exceto, codec: codecDoPedido(req) }).catch(() => null);
            if (resultado) { escolhido = resultado.escolhido; avaliacao = resultado.avaliacao; }
        }
        if (!escolhido) escolhido = await motor.escolher('dublado', alvo, { exceto });
        if (escolhido) {
            // A decisão do avaliador fica registrada na central (alimenta a
            // evolução das fontes com a escolha real do momento).
            if (avaliacao) {
                try {
                    require('../central-reporter').reportar({
                        tipo: 'avaliacao', id: String(req.params.id), titulo: '',
                        fonte: escolhido.fonte || '', fonteId: escolhido.fonteId || '',
                        // Quem pediu: o crachá do aparelho identifica o relato
                        // (antes chegava como "Anônimo" na central).
                        ...(req.dispositivoAutorizado ? {
                            nome: req.dispositivoAutorizado.nome || 'Anônimo',
                            aparelho: req.dispositivoAutorizado.aparelho || '',
                            dispositivo: req.dispositivoAutorizado.dispositivo || '',
                        } : {}),
                        avaliacao: avaliacao.map(a => ({ fonte: a.fonteId, nota: a.nota, idioma: a.detalhes && a.detalhes.idioma, qualidade: a.detalhes && a.detalhes.qualidade, taxa: a.detalhes && a.detalhes.taxa })),
                    }).catch(() => {});
                } catch { /* central é opcional */ }
            }
            // Fonte que precisa de conversão (MKV com som que o navegador não
            // toca): o aplicativo converte e só o áudio muda; a imagem é a
            // original, sem perda.
            if (escolhido.converter) {
                const conversor = require('../conversor');
                // `id` estável: o mesmo filme reaproveita a conversão em vez de criar
                // uma pasta nova a cada abertura (era isso que enchia o disco).
                const trabalho = await conversor.iniciar(escolhido.url, { titulo: `filme-${req.params.id}`, id: `filme-${req.params.id}`, referer: escolhido.referer || '' });
                return res.json({
                    url: `/api/convertido/${trabalho.id}/index.m3u8`,
                    audio: escolhido.audio || 'pt-BR',
                    source: escolhido.fonte || 'Dublado (conversão)',
                    type: 'hls',
                    resolucao: escolhido.resolucao || '',
                    conversao: trabalho.id,
                });
            }
            const pronto = motor.prepararParaPlayer(escolhido);
            return res.json({
                url: require('../rede-playback.cjs').enderecoPlayback(req,pronto),
                audio: pronto.audio || 'pt-BR',
                source: pronto.fonte || 'Dublado limpo',
                fonteId: pronto.fonteId || '',
                type: pronto.type || 'hls',
                resolucao: pronto.resolucao || '',
                videoCodec: pronto.videoCodec || '',
                avaliacao: avaliacao || undefined,
            });
        }
    } catch { /* segue para o aviso */ }
    res.status(502).json({ error: 'Reprodução direta dublada indisponível.' });
});

// ============================================================
// EPISÓDIOS — o robô procura sozinho a melhor opção, na ordem da regra do
// aplicativo: primeiro dublado e limpo; depois alta definição limpa, com
// legenda em português quando a fonte tiver. Sempre entregue pelo próprio
// aplicativo, então nada abre em página de terceiros e não há anúncio.
// A sessão da fonte dublada (opcional) vem de config.local.json
// (watchplayCookie) ou da variável WATCHPLAY_COOKIE.
// ============================================================
app.get('/api/crystal-lake/1/:episode/master.m3u8', async (req, res) => {
    if (!/^[1-8]$/.test(req.params.episode)) return res.sendStatus(404);
    try {
        const lista = await require('../crystal-lake-source').playlist(req.params.episode);
        res.setHeader('Cache-Control', 'no-store');
        res.type('application/vnd.apple.mpegurl').send(lista);
    } catch { res.sendStatus(502); }
});

app.get('/api/playback/serie/:id/:season/:episode', async (req, res) => {
    // (a rota usa o conversor quando a fonte só existe em arquivo que o
    // navegador toca mudo — ver abaixo)
    const { id, season, episode } = req.params;
    if (!/^\d{1,10}$/.test(id) || !/^\d{1,3}$/.test(season) || !/^[1-9]\d{0,3}$/.test(episode)) return res.sendStatus(400);
    res.setHeader('Cache-Control', 'no-store');
    const cookie = process.env.WATCHPLAY_COOKIE || LOCAL_CONFIG.watchplayCookie || '';
    try {
        const exceto = String(req.query.exceto || '').split(',').map(item => item.trim()).filter(Boolean);
        const alvo = { tipo: 'tv', tmdbId: id, temporada: season, episodio: episode };
        if (await responderCompatibilidade(req,res,alvo)) return;
        let escolhido = await require('../crystal-lake-source').resolver(alvo, { exceto });
        let avaliacao = null;
        if (!escolhido && process.env.AVALIADOR !== '0') {
            const resultado = await require('../avaliador').escolherMelhor('dublado', alvo, { exceto, codec: codecDoPedido(req) }).catch(() => null);
            if (resultado) {
                escolhido = require('../fontes-motor').prepararParaPlayer(resultado.escolhido);
                avaliacao = resultado.avaliacao;
            }
        }
        if (!escolhido) escolhido = await require('../series-source').resolverEpisodio({ tmdbId: id, temporada: season, episodio: episode, cookie, exceto });
        if (!escolhido) throw new Error('sem fonte');
        if (escolhido.converter) {
            const conversor = require('../conversor');
            // `id` estável por episódio: reaproveita a conversão já feita.
            const trabalho = await conversor.iniciar(escolhido.url, { titulo: `serie-${id}-T${season}E${episode}`, id: `serie-${id}-T${season}E${episode}`, referer: escolhido.referer || '' });
            return res.json({
                url: `/api/convertido/${trabalho.id}/index.m3u8`,
                audio: escolhido.audio || 'pt-BR',
                source: escolhido.fonte || 'Dublado (conversão)',
                type: 'hls',
                resolucao: escolhido.resolucao || '',
                conversao: trabalho.id,
            });
        }
        res.json({
            // Fonte de arquivo direto (dublada) não passa pelo encaminhamento.
            url: require('../rede-playback.cjs').enderecoPlayback(req,escolhido),
            audio: escolhido.audio,
            source: escolhido.fonte,
            fonteId: escolhido.fonteId || '',
            type: escolhido.type || 'hls',
            resolucao: escolhido.resolucao,
            videoCodec: escolhido.videoCodec || '',
            legendas: escolhido.legendas || [],
            legendaPortugues: Boolean(escolhido.legendaPortugues),
            avaliacao: avaliacao || undefined,
        });
    } catch {
    res.status(502).json({ error: 'Nenhuma fonte sem anúncio tem este episódio ainda. O robô do aplicativo continua procurando: assim que aparecer, o episódio abre sozinho — não precisa atualizar nada.' });
    }
});


// ============================================================
// FULL HD SEM ANÚNCIO — resolvedor do Vixsrc (endereço direto do vídeo).
// Usado como opção de melhor qualidade; o áudio é o da fonte (normalmente original).
// ============================================================
app.get('/anime-player.js',(req,res)=>{res.setHeader('Cache-Control','no-store');res.type('js').send(fs.readFileSync(path.join(RAIZ,'anime-player.js')));});
app.get('/api/anime-player',async(req,res)=>{
 const id=String(req.query.id||''),temporada=String(req.query.temporada||''),episodio=String(req.query.episodio||''),audio=String(req.query.audio||'legendado');
 res.setHeader('Cache-Control','no-store');
 if(!/^[1-9]\d{0,9}$/.test(id)||!/^\d{1,3}$/.test(temporada)||!/^\d{1,4}$/.test(episodio)||Number(temporada)<1||Number(episodio)<1||!['legendado','dublado'].includes(audio)||(req.query.tipo&&req.query.tipo!=='tv'))return res.status(400).json({ok:false});
 const controller=new AbortController();const cancelar=()=>{if(!res.writableEnded)controller.abort();};res.once('close',cancelar);
 try{const pedido={tmdbId:id,temporada,episodio,audio,tmdbKey:TMDB_KEY,signal:controller.signal};let dados=await require('../anime-source').resolverEpisodio(pedido);if(!dados&&!controller.signal.aborted)dados=await require('../anime-proplayer-source').resolverEpisodio(pedido);if(!res.destroyed)res.json(dados||{ok:false,motivo:'Fonte legendada indisponível para este episódio agora.'});}
 catch{if(!res.destroyed)res.json({ok:false,motivo:'Fonte legendada indisponível para este episódio agora.'});}
 finally{res.removeListener('close',cancelar);}
});

app.get('/api/stream-hd', async (req, res) => {
    const tipo = String(req.query.tipo || 'movie') === 'tv' ? 'tv' : 'movie';
    const id = String(req.query.id || '');
    const temporada = String(req.query.season || '1');
    const episodio = String(req.query.episode || '1');
    if (!/^\d{1,10}$/.test(id)) return res.status(400).json({ ok: false });
    res.setHeader('Cache-Control', 'no-store');
    // O motor tenta as fontes de alta definição na ordem que ele aprendeu.
    try {
        const motor = require('../fontes-motor');
        const alvo = { tipo, tmdbId: id, temporada, episodio };
        const escolhido = await motor.escolher('hd', alvo);
        if (escolhido) {
            const pronto = motor.prepararParaPlayer(escolhido);
            res.json({
                ok: true,
                url: pronto.final ? pronto.url : (pronto.urlAplicativo || pronto.url),
                urlAplicativo: pronto.final ? pronto.url : pronto.urlAplicativo,
                qualidade: pronto.resolucao || 'Full HD',
                type: pronto.type || 'hls',
                fonteId: pronto.fonteId || '',
                legendas: pronto.legendas || [],
                legendaPortugues: Boolean(pronto.legendaPortugues),
                fonte: pronto.fonte || 'Alta definição'
            });
            return;
        }
    } catch { /* sem fonte de alta definição */ }
    res.json({ ok: false, motivo: 'Fonte Full HD indisponível para este título.' });
});



// Diagnóstico do motor de fontes: quais estão saudáveis agora.
// Diagnóstico do motor: estado de cada fonte e a fila de cada papel com o
// porquê de cada posição (política única: politica-fontes.json).
// ?tipo=tv&id=1399&temporada=1&episodio=1 mostra a fila para um título.
app.get('/api/motor/estado', (req, res) => {
    const motor = require('../fontes-motor');
    const id = String(req.query.id || '');
    const alvo = /^\d{1,10}$/.test(id) ? motor.alvoDoEvento(req.query.tipo === 'tv' ? 'tv' : 'movie', id, req.query.temporada, req.query.episodio) : null;
    res.json({ fontes: motor.estado(), fila: motor.explicar(alvo) });
});

return { midia, codecDoPedido, responderCompatibilidade };
};
