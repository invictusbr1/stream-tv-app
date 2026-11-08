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
// Prepara a TorBox de um título SEM tocar nem converter: confere qual
// arquivo dublado serve (link + áudio) e guarda. Usado para o PRÓXIMO
// episódio enquanto o atual passa (série, anime dublado, dorama, novela,
// desenho): ao apertar "próximo", o motor 1 já tem a resposta. Responde na
// hora; o trabalho segue em segundo plano. (Vem antes de /api/torbox/:id.)
app.get('/api/torbox/preparar', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const tipo = req.query.tipo === 'tv' ? 'tv' : 'movie';
    const id = String(req.query.id || ''), temporada = String(req.query.temporada || ''), episodio = String(req.query.episodio || '');
    if (!/^\d{1,10}$/.test(id) || (tipo === 'tv' && (!/^\d{1,3}$/.test(temporada) || !/^[1-9]\d{0,3}$/.test(episodio)))) return res.status(400).json({ ok: false });
    let tb;
    try { tb = require('../torbox-source'); if (!tb.ativa()) return res.json({ ok: false, motivo: 'TorBox desligada' }); } catch { return res.json({ ok: false }); }
    const quer4k = podeReceber4k(req);
    const t = tipo === 'tv' ? temporada : undefined, e = tipo === 'tv' ? episodio : undefined;
    tb.preludio(tipo, id, t, e, { hevcOk: quer4k }).then(pre => {
        if (!pre || !pre.qualidades.length) return;
        if (pre.qualidades.includes('1080p')) tb.resolverMelhor(tipo, id, t, e, { hevcOk: quer4k }).catch(() => {});
        if (quer4k && pre.qualidades.includes('4K')) tb.resolverMelhor(tipo, id, t, e, { quer4k: true, so4k: true }).catch(() => {});
    }).catch(() => {});
    res.json({ ok: true });
});
// Vídeo da TorBox repassado pelo servidor: o aparelho só conhece o código
// aleatório; o link real (com a chave da conta) nunca sai daqui.
app.get('/api/torbox/:id', async (req, res) => {
    const real = require('../cofre-links.cjs').pegar(req.params.id);
    if (!real) return res.status(404).send('link expirado: abra o título de novo');
    const transferencia = new AbortController();
    res.once('close', () => transferencia.abort());
    const cabecalhos = { 'User-Agent': 'ConectaTV' };
    const faixa = String(req.headers.range || '');
    if (/^bytes=\d*-\d*$/.test(faixa)) cabecalhos.Range = faixa;
    try {
        const r = await fetch(real, { headers: cabecalhos, signal: transferencia.signal, redirect: 'follow' });
        if (r.status !== 200 && r.status !== 206) { res.status(r.status === 416 ? 416 : 502).end(); try { await r.body?.cancel(); } catch { /* ok */ } return; }
        res.status(r.status);
        for (const nome of ['content-length', 'content-range', 'accept-ranges', 'last-modified', 'etag']) { const v = r.headers.get(nome); if (v) res.setHeader(nome, v); }
        const tipo = String(r.headers.get('content-type') || '');
        res.setHeader('Content-Type', /^video\//.test(tipo) ? tipo : /\.mp4|\.m4v/i.test(new URL(real).pathname) ? 'video/mp4' : 'video/x-matroska');
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Access-Control-Allow-Origin', '*');
        if (!r.headers.get('accept-ranges')) res.setHeader('Accept-Ranges', 'bytes');
        const { Readable } = require('node:stream');
        Readable.fromWeb(r.body).on('error', () => res.destroy()).pipe(res);
    } catch { if (!res.headersSent) res.status(502).end(); else res.destroy(); }
});
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
    const ehHttpLiberado = endereco.protocol === 'http:' && midia.httpPermitido(endereco.hostname);
    if ((endereco.protocol !== 'https:' && !ehHttpLiberado) || !midia.hostPermitido(endereco.hostname) || seguranca.hostInterno(endereco.hostname)) return res.sendStatus(403);
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
// Pedido do aplicativo do PC (mpv): toca HEVC/4K e MKV sem conversão.
function paraPlayerDoPc(req) {
    return process.env.CONECTA_PC === '1' && req.query.pc === '1';
}

// APK até 2.13.137 recusa resposta com "conversao" (desistia do servidor).
// Do 2.13.138 em diante ele avisa com conversao=1 e toca o MKV convertido
// (ex.: TorBox) pelo transporte autenticado do próprio aparelho.
// Ponto do filme (segundos) onde o player quer começar: a conversão começa
// ali em vez de no 0 (continuar de onde parou / pular para a frente).
// MOTOR 1 (teste, 06/11/2026): TorBox primeiro. Se ela tem o título dublado
// em 800p ou mais (Full HD, inclusive tela larga 1036p), abre direto — sem esperar o avaliador testar todas as
// fontes (que leva até ~9 s). Sem título ou abaixo de 800p: MOTOR 2 (fila
// normal do avaliador). ?motor=torbox pede SÓ o motor 1 (o APK pergunta isso
// antes de procurar no próprio aparelho).
// Filme em tela larga (1920×1036, 1920×800) é Full HD com outra proporção:
// a régua do motor 1 é 800p. Abaixo disso (720p, 480p) vai para o motor 2.
const MOTOR1_MINIMO = 800;
// 4K da TorBox só para quem comprova H.265 (o navegador manda codec=avc
// quando não toca; o APK manda codec=hevc só se o aparelho decodifica), fora
// da rede móvel e sem o pedido de versão compatível / "sem 4K" do player.
function podeReceber4k(req) {
    if (req.query.compat === 'avc' || req.query.sem4k === '1' || req.query.rede === 'movel') return false;
    return codecDoPedido(req) !== 'avc';
}
async function motorTorbox(req, alvo, exceto, idBase = '') {
    if ((exceto || []).includes('torbox')) return null;
    // Torrent que não entregou nada há pouco (o vigia do conversor desistiu)
    // fica de fora sozinho — os outros dublados da TorBox continuam valendo.
    let tb;
    try { tb = require('../torbox-source'); if (!tb.ativa()) return null; } catch { return null; }
    const quer4k = podeReceber4k(req), pc = paraPlayerDoPc(req);
    const tipo = alvo.tipo === 'tv' ? 'tv' : 'movie';
    const espera = (p, ms) => Promise.race([Promise.resolve(p).catch(() => null), new Promise(ok => setTimeout(() => ok(null), Math.max(0, ms)))]);
    const inicio = Date.now(), PRAZO = 18000;
    // 1) Existe dublado pronto em 800p+? Responde em ~1–4 s. Sem nada: motor 2
    //    na hora, sem gastar o prazo esperando.
    const pre = await espera(tb.preludio(tipo, alvo.tmdbId, alvo.temporada, alvo.episodio, { hevcOk: quer4k }), 7000);
    if (!pre) return null;
    const tem4k = pre.qualidades.includes('4K'), temHd = pre.qualidades.includes('1080p');
    if (!temHd && !(quer4k && tem4k)) return null;
    // 2) Tem: confere o arquivo (link + áudio). 4K e Full HD em paralelo — se
    //    o 4K não servir (sem áudio PT, sem disco, H.265 não suportado…), o
    //    Full HD já está pronto, sem esperar uma segunda rodada.
    const serve = d => Boolean(d && d.url && (parseInt(d.resolucao, 10) || 0) >= MOTOR1_MINIMO && !(d.converter && semConversaoNoPedido(req)));
    const p4k = quer4k && tem4k ? tb.resolverMelhor(tipo, alvo.tmdbId, alvo.temporada, alvo.episodio, { quer4k: true, so4k: true }) : null;
    const pHd = temHd ? tb.resolverMelhor(tipo, alvo.tmdbId, alvo.temporada, alvo.episodio, { hevcOk: quer4k }) : null;
    let boa = null;
    if (p4k) {
        const r4 = await espera(p4k, PRAZO - (Date.now() - inicio));
        // Um 4K convertido por vez e só com disco folgado (o PC toca o original).
        if (serve(r4) && !(r4.converter && !pc && !require('../conversor').pode4k(idBase, r4.tamanho))) boa = r4;
    }
    if (!boa && pHd) {
        const rHd = await espera(pHd, PRAZO - (Date.now() - inicio));
        if (serve(rHd) && !rHd.quatroK) boa = rHd;
    }
    return boa ? { ...boa, fonteId: 'torbox' } : null;
}
function inicioDoPedido(req) {
    const n = /^\d{1,6}$/.test(String(req.query.inicio || '')) ? Number(req.query.inicio) : 0;
    return n >= 60 ? n : 0;
}
function semConversaoNoPedido(req) {
    return req.query.transporte === 'servidor' && req.query.conversao !== '1';
}
// Quando o celular já achou 720p no próprio aparelho (?upgrade=1), só vale
// trocar pelo servidor se houver Full HD/4K dublado medido (ex.: TorBox 1080p).
function atendeUpgradeFullHd(escolhido, avaliacao) {
    const topo = Array.isArray(avaliacao) ? avaliacao[0] : null;
    const det = (topo && topo.detalhes) || {};
    if (det.audioEmOutroIdioma || det.dubladoNaoConfirmado) return false;
    const m = String(det.dimensoes || '').match(/(\d+)\s*[×x]\s*(\d+)/);
    if (m) {
        const { alturaEquivalente } = require('../politica-fontes');
        return alturaEquivalente(Number(m[1]), Number(m[2])) >= 1080 * 0.98;
    }
    return Boolean(escolhido && escolhido.fonteId === 'torbox' && parseInt(escolhido.resolucao, 10) >= 1080);
}
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
        const resultado = await require('../avaliador').escolherMelhor('dublado', alvo, { semCache: true, codec: 'avc', semConversao: true }).catch(() => null);
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
// O aparelho já mediu e escolheu (ex.: FenixFlix 4K 3840×1600 com português)
// e só precisa do servidor para mandar o Referer que o WebView não manda.
// Antes o servidor refazia a escolha do zero e podia devolver OUTRA fonte —
// pior, ou que nem abre no aparelho (27/10/2026: Homem-Aranha saía do 4K para
// uma lista HLS que falhava). Agora ele só confere que o endereço é mesmo
// daquela fonte (mesmo servidor e caminho de um resultado dela, nada de
// endereço livre) e encaminha.
async function responderEscolhaDoAparelho(req, res, alvo) {
    const fonteId = String(req.query.escolhida || '').slice(0, 60);
    const bruto = String(req.query.u || '');
    const exceto = String(req.query.exceto || '').split(',').map(s => s.trim()).filter(Boolean);
    // O servidor de vídeo da BsCine recusa conexão vinda da Oracle: nunca encaminha por aqui.
    if (!fonteId || !bruto || exceto.includes(fonteId) || /^bscine/i.test(fonteId)) return false;
    let pedido;
    try { pedido = new URL(midia.textoDeBase64url(bruto)); } catch { return false; }
    const pedidoHttpLiberado = pedido.protocol === 'http:' && midia.httpPermitido(pedido.hostname);
    if ((pedido.protocol !== 'https:' && !pedidoHttpLiberado) || pedido.username || pedido.password || seguranca.hostInterno(pedido.hostname)) return false;
    const motor = require('../fontes-motor');
    const fonte = motor.fontesAtivas().find(f => String(f.id) === fonteId);
    if (!fonte) return false;
    const consultar = Promise.resolve().then(() => typeof fonte.resolverTodos === 'function' ? fonte.resolverTodos(alvo) : fonte.resolver(alvo));
    const resposta = await Promise.race([consultar, new Promise(ok => setTimeout(() => ok(null), 9000))]).catch(() => null);
    const opcoes = Array.isArray(resposta) ? resposta : resposta ? [resposta] : [];
    const mesma = opcoes.find(o => { try { const u = new URL(o.url); return u.origin === pedido.origin && u.pathname === pedido.pathname; } catch { return false; } });
    if (!mesma) return false;
    const pronto = motor.prepararParaPlayer({ ...mesma, url: pedido.href, fonteId, final: false });
    const altura = /^\d{3,4}$/.test(String(req.query.altura || '')) ? `${req.query.altura}p` : (pronto.resolucao || '');
    res.json({ url: require('../rede-playback.cjs').enderecoPlayback(req, pronto), audio: 'pt-BR', source: pronto.fonte || fonte.nome || fonteId, fonteId, type: pronto.type || 'file', resolucao: altura, videoCodec: pronto.videoCodec || '', escolhaDoAparelho: true });
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
        // Motor 1 vem antes de tudo (inclusive do pedido "versão compatível",
        // que recebe o Full HD da TorBox); a escolha já medida pelo aparelho
        // (?escolhida=) só chega depois que o motor 1 disse "indisponível".
        const rapido = req.query.escolhida ? null : await motorTorbox(req, alvo, exceto, `filme-${req.params.id}`);
        if (!rapido && req.query.motor === 'torbox') return res.json({ indisponivel: true });
        if (!rapido && await responderCompatibilidade(req,res,alvo)) return;
        if (!rapido && await responderEscolhaDoAparelho(req,res,alvo).catch(() => false)) return;
        // Avaliador em tempo real: testa as melhores fontes do título em
        // paralelo e escolhe a que entrega mais qualidade seguindo as regras.
        let escolhido = rapido;
        let avaliacao = null;
        if (!escolhido && process.env.AVALIADOR !== '0') {
            const resultado = await avaliador.escolherMelhor('dublado', alvo, { exceto, codec: codecDoPedido(req), semConversao: semConversaoNoPedido(req) }).catch(() => null);
            if (resultado) { escolhido = resultado.escolhido; avaliacao = resultado.avaliacao; }
        }
        if (req.query.upgrade === '1' && !atendeUpgradeFullHd(escolhido, avaliacao)) {
            return res.json({ indisponivel: true });
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
            // O player do PC toca o MKV original (com o som em português): sem conversão.
            if (escolhido.converter && paraPlayerDoPc(req)) escolhido = { ...motor.prepararParaPlayer({ ...escolhido, final: false }), converter: false };
            if (escolhido.converter) {
                const conversor = require('../conversor');
                // `id` estável: o mesmo filme reaproveita a conversão em vez de criar
                // uma pasta nova a cada abertura (era isso que enchia o disco).
                const trabalho = await conversor.iniciarNoPonto(escolhido.url, { id: `filme-${req.params.id}`, referer: escolhido.referer || '', etiqueta: escolhido.hash || '', inicio: inicioDoPedido(req), faixa: escolhido.faixa || null, quatroK: Boolean(escolhido.quatroK), novo: req.query.novo === '1' });
                return res.json({
                    url: `/api/convertido/${trabalho.id}/index.m3u8`,
                    audio: escolhido.audio || 'pt-BR',
                    source: escolhido.fonte || 'Dublado (conversão)',
                    type: 'hls',
                    resolucao: escolhido.resolucao || '',
                    fonteId: escolhido.fonteId || '',
                    conversao: trabalho.id,
                    inicio: trabalho.inicio || 0,
                    duracao: trabalho.duracao || 0,
                    videoCodec: escolhido.videoCodec || '',
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
        // Motor 1 vem antes de tudo (inclusive do pedido "versão compatível",
        // que recebe o Full HD da TorBox); a escolha já medida pelo aparelho
        // (?escolhida=) só chega depois que o motor 1 disse "indisponível".
        const rapido = req.query.escolhida ? null : await motorTorbox(req, alvo, exceto, `serie-${id}-T${season}E${episode}`);
        if (!rapido && req.query.motor === 'torbox') return res.json({ indisponivel: true });
        if (!rapido && await responderCompatibilidade(req,res,alvo)) return;
        if (!rapido && await responderEscolhaDoAparelho(req,res,alvo).catch(() => false)) return;
        let escolhido = rapido;
        if (!escolhido) escolhido = await require('../crystal-lake-source').resolver(alvo, { exceto });
        let avaliacao = null;
        if (!escolhido && process.env.AVALIADOR !== '0') {
            const resultado = await require('../avaliador').escolherMelhor('dublado', alvo, { exceto, codec: codecDoPedido(req), semConversao: semConversaoNoPedido(req) }).catch(() => null);
            if (req.query.upgrade === '1' && (!resultado || !atendeUpgradeFullHd(resultado.escolhido, resultado.avaliacao))) {
                return res.json({ indisponivel: true });
            }
            if (resultado) {
                escolhido = require('../fontes-motor').prepararParaPlayer(resultado.escolhido);
                avaliacao = resultado.avaliacao;
            }
        }
        if (req.query.upgrade === '1' && !escolhido) return res.json({ indisponivel: true });
        if (!escolhido) escolhido = await require('../series-source').resolverEpisodio({ tmdbId: id, temporada: season, episodio: episode, cookie, exceto });
        if (!escolhido) throw new Error('sem fonte');
        // O player do PC toca o MKV original (com o som em português): sem conversão.
        if (escolhido.converter && paraPlayerDoPc(req)) escolhido = { ...require('../fontes-motor').prepararParaPlayer({ ...escolhido, final: false }), converter: false };
        if (escolhido.converter) {
            const conversor = require('../conversor');
            // `id` estável por episódio: reaproveita a conversão já feita.
            const trabalho = await conversor.iniciarNoPonto(escolhido.url, { id: `serie-${id}-T${season}E${episode}`, referer: escolhido.referer || '', etiqueta: escolhido.hash || '', inicio: inicioDoPedido(req), faixa: escolhido.faixa || null, quatroK: Boolean(escolhido.quatroK), novo: req.query.novo === '1' });
            return res.json({
                url: `/api/convertido/${trabalho.id}/index.m3u8`,
                audio: escolhido.audio || 'pt-BR',
                source: escolhido.fonte || 'Dublado (conversão)',
                type: 'hls',
                resolucao: escolhido.resolucao || '',
                fonteId: escolhido.fonteId || '',
                conversao: trabalho.id,
                inicio: trabalho.inicio || 0,
                duracao: trabalho.duracao || 0,
                videoCodec: escolhido.videoCodec || '',
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
// ANIME LEGENDADO pela TorBox — SÓ ANIME (pedido do Marlon, 07/11/2026).
// Áudio original + legenda em português que vem DENTRO do arquivo; o
// conversor transforma a legenda em legenda do player. Sem arquivo assim
// pronto, responde "indisponivel" e o anime segue para as fontes de sempre.
app.get('/api/playback/anime-legendado/:id/:season/:episode', async (req, res) => {
    const { id, season, episode } = req.params;
    if (!/^\d{1,10}$/.test(id) || !/^\d{1,3}$/.test(season) || !/^[1-9]\d{0,3}$/.test(episode)) return res.sendStatus(400);
    res.setHeader('Cache-Control', 'no-store');
    try {
        const exceto = String(req.query.exceto || '').split(',').map(x => x.trim()).filter(Boolean);
        let tb;
        try { tb = require('../torbox-source'); } catch { return res.json({ indisponivel: true }); }
        if (exceto.includes('torbox-legendado') || !tb.ativa()) return res.json({ indisponivel: true });
        const hevcOk = codecDoPedido(req) !== 'avc';
        // A primeira busca de um episódio pode passar de 14 s (10 listas de
        // anime + conferir o arquivo na TorBox + legenda). Antes ela perdia o
        // prazo e o app dizia "não tem" — e na 2ª vez tocava (08/11/2026,
        // Black Clover T2E2). Agora o app pergunta com ?preparar=1 (espera até
        // 20 s, e repete) e só depois pede o vídeo, que já sai na hora.
        const ESGOTOU = Symbol('esgotou');
        const achado = await Promise.race([
            tb.resolverAnimeLegendado(id, season, episode, { hevcOk }).catch(() => null),
            new Promise(ok => setTimeout(() => ok(ESGOTOU), req.query.preparar === '1' ? 20000 : 14000)),
        ]);
        if (req.query.preparar === '1') return res.json(achado === ESGOTOU ? { procurando: true } : achado ? { pronto: true, resolucao: achado.resolucao, legendaOnline: Boolean(achado.legendaExterna) } : { indisponivel: true });
        if (!achado || achado === ESGOTOU) return res.json(achado === ESGOTOU ? { indisponivel: true, procurando: true } : { indisponivel: true });
        // O player do PC toca o arquivo original (legenda incluída) direto.
        if (paraPlayerDoPc(req) && !achado.legendaExterna) {
            const pronto = require('../fontes-motor').prepararParaPlayer({ ...achado, final: false });
            return res.json({ url: pronto.urlAplicativo, audio: 'original', source: achado.fonte, fonteId: 'torbox-legendado', type: 'file', resolucao: achado.resolucao, legendaPortugues: true, legendaEmbutida: true, anime: true });
        }
        const conversor = require('../conversor');
        const trabalho = await conversor.iniciarNoPonto(achado.url, { id: `anime-${id}-T${season}E${episode}`, inicio: inicioDoPedido(req), faixa: achado.faixa, legenda: achado.legenda, legendaExterna: achado.legendaExterna || '', novo: req.query.novo === '1' });
        res.json({
            url: `/api/convertido/${trabalho.id}/index.m3u8`, audio: 'original', source: achado.fonte, fonteId: 'torbox-legendado',
            type: 'hls', resolucao: achado.resolucao, videoCodec: achado.videoCodec || '', conversao: trabalho.id,
            inicio: trabalho.inicio || 0, duracao: trabalho.duracao || 0,
            legendaPortugues: true, legendaEmbutida: true, anime: true,
        });
    } catch { if (!res.headersSent) res.json({ indisponivel: true }); }
});
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
// Diagnóstico de UMA fonte neste servidor: o que ela devolve para um título
// (endereços e rótulos, sem tocar vídeo). Para fichas de addon, mostra também a
// resposta crua do addon — é assim que se descobre se o fornecedor bloqueia a Oracle.
app.get('/api/motor/testar', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const motor = require('../fontes-motor');
    const id = String(req.query.id || ''), fonteId = String(req.query.fonte || '').slice(0, 60);
    if (!/^\d{1,10}$/.test(id) || !fonteId) return res.status(400).json({ error: 'informe fonte e id' });
    const alvo = motor.alvoDoEvento(req.query.tipo === 'tv' ? 'tv' : 'movie', id, req.query.temporada, req.query.episodio);
    const fonte = motor.fontesAtivas().find(f => String(f.id) === fonteId);
    if (!fonte) return res.status(404).json({ error: 'fonte não está ativa neste servidor', ativas: motor.fontesAtivas().map(f => f.id) });
    const saida = { fonte: fonteId, alvo };
    try {
        const ficha = require('../perfis-locais').perfis().find(p => String(p.id) === fonteId);
        if (ficha && /\{imdb\}/.test(String(ficha.urlMovie || '') + String(ficha.urlTv || ''))) {
            const axios = require('axios');
            const tmdb = await axios.get(`https://api.themoviedb.org/3/${alvo.tipo === 'tv' ? 'tv' : 'movie'}/${id}/external_ids?api_key=${TMDB_KEY}`, { timeout: 10000 }).catch(() => null);
            const imdb = tmdb && tmdb.data && tmdb.data.imdb_id;
            const endereco = require('../perfis-motor').preencher(alvo.tipo === 'tv' ? ficha.urlTv : ficha.urlMovie, { ...alvo, imdb });
            const t0 = Date.now();
            const r = await axios.get(endereco, { timeout: 15000, responseType: 'text', validateStatus: () => true, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36' } }).catch(e => ({ status: 0, data: String(e.message) }));
            saida.addon = { endereco, status: r.status, ms: Date.now() - t0, inicio: String(r.data || '').slice(0, 300) };
        }
    } catch (erro) { saida.addonErro = String(erro.message).slice(0, 160); }
    const t0 = Date.now();
    try {
        const resposta = await Promise.race([Promise.resolve().then(() => typeof fonte.resolverTodos === 'function' ? fonte.resolverTodos(alvo) : fonte.resolver(alvo)), new Promise((_, n) => setTimeout(() => n(new Error('passou de 20 s')), 20000))]);
        const lista = Array.isArray(resposta) ? resposta : resposta ? [resposta] : [];
        saida.opcoes = lista.slice(0, 8).map(o => ({ fonte: o.fonte, resolucao: o.resolucao, type: o.type, exigeProva: Boolean(o.exigeProva), host: (() => { try { return new URL(o.url).host; } catch { return ''; } })() }));
    } catch (erro) { saida.erro = String(erro.message).slice(0, 160); }
    saida.ms = Date.now() - t0;
    res.json(saida);
});
app.get('/api/motor/estado', (req, res) => {
    const motor = require('../fontes-motor');
    const id = String(req.query.id || '');
    const alvo = /^\d{1,10}$/.test(id) ? motor.alvoDoEvento(req.query.tipo === 'tv' ? 'tv' : 'movie', id, req.query.temporada, req.query.episodio) : null;
    res.json({ fontes: motor.estado(), fila: motor.explicar(alvo) });
});

return { midia, codecDoPedido, responderCompatibilidade };
};
