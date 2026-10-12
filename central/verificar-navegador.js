'use strict';
// Mede reprodução e observa pedidos públicos no mesmo navegador que o app usa.
// As duas tarefas dividem uma vaga: uma caçada não abre vários Chromium no PC.
const fs = require('fs');
const path = require('path');
const http = require('http');
const axios = require('axios');
const midia = require('../midia-proxy');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const REDES_DE_ANUNCIO = /(effectivecpmnetwork|bunkedfusels|profitablecpmgate|popads|popcash|adsterra|monetag|propellerads|onclck|googlesyndication|adnxs|taboola|outbrain|clickadu|hilltopads|exoclick|revenuehits|mgid|zergnet|21wiz|inmobi|doubleclick)/i;
const LIMITES = Object.freeze({
    fila: 6, filaMs: 120000, abrirMs: 20000, fecharMs: 3000, etapaMs: 20000,
    respostaMs: 1500, encaminharMs: 25000, playlistBytes: 1024 * 1024,
    midiaBytes: 128 * 1024 * 1024, espiaoBytes: 24 * 1024 * 1024,
    pedidosProxy: 100, simultaneosProxy: 8, corpoBytes: 400000,
});

function acharNavegador() {
    return [process.env.CHROME_PATH || '',
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
        '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    ].find(caminho => caminho && fs.existsSync(caminho)) || '';
}
function carregarPuppeteer() { try { return require('puppeteer-core'); } catch { return null; } }
function cancelado() { return new Error('sondagem cancelada'); }
function comPrazo(promessa, ms, signal, motivo = 'tempo da sondagem esgotado') {
    return new Promise((resolve, reject) => {
        let terminou = false;
        const finalizar = (funcao, valor) => {
            if (terminou) return;
            terminou = true;
            clearTimeout(timer);
            if (signal) signal.removeEventListener('abort', cancelar);
            funcao(valor);
        };
        const cancelar = () => finalizar(reject, cancelado());
        const timer = setTimeout(() => finalizar(reject, new Error(motivo)), ms);
        Promise.resolve(promessa).then(valor => finalizar(resolve, valor), erro => finalizar(reject, erro));
        if (signal) { signal.addEventListener('abort', cancelar, { once: true }); if (signal.aborted) cancelar(); }
    });
}
function esperar(ms, signal) {
    return new Promise((resolve, reject) => {
        const cancelar = () => { clearTimeout(timer); if (signal) signal.removeEventListener('abort', cancelar); reject(cancelado()); };
        const timer = setTimeout(() => { if (signal) signal.removeEventListener('abort', cancelar); resolve(); }, ms);
        if (signal) { signal.addEventListener('abort', cancelar, { once: true }); if (signal.aborted) cancelar(); }
    });
}
function segundosLimitados(valor, padrao) {
    const numero = Number(valor);
    return Number.isFinite(numero) ? Math.min(45, Math.max(4, numero)) : padrao;
}

// A fábrica permite testes de falha sem visitar fornecedores. A instância de
// produção é única; tocar e espionar compartilham a fila dessa instância.
function criarVerificadorNavegador(deps = {}) {
    const cliente = deps.axios || axios;
    const rede = deps.http || http;
    const arquivos = deps.fs || fs;
    const carregar = deps.carregarPuppeteer || carregarPuppeteer;
    const encontrar = deps.acharNavegador || acharNavegador;
    const pausa = deps.esperar || esperar;
    const limites = { ...LIMITES, ...deps.limites };
    let ocupado = false;
    let ultimoErroDoRobo = '';
    const fila = [];

    function reservar(signal) {
        if (signal && signal.aborted) return Promise.reject(cancelado());
        if (ocupado && fila.length >= limites.fila) return Promise.reject(new Error('fila do navegador cheia; tentar em outra rodada'));
        return new Promise((resolve, reject) => {
            const pedido = { timer: null, cancelar: null };
            const remover = () => {
                const indice = fila.indexOf(pedido);
                if (indice >= 0) fila.splice(indice, 1);
                clearTimeout(pedido.timer);
                if (signal) signal.removeEventListener('abort', pedido.cancelar);
            };
            pedido.cancelar = () => { remover(); reject(cancelado()); };
            pedido.conceder = () => {
                remover(); ocupado = true;
                let liberado = false;
                resolve(() => {
                    if (liberado) return;
                    liberado = true; ocupado = false;
                    const seguinte = fila.shift();
                    if (seguinte) seguinte.conceder();
                });
            };
            if (!ocupado) { pedido.conceder(); return; }
            fila.push(pedido);
            pedido.timer = setTimeout(() => { remover(); reject(new Error('tempo de espera pelo navegador esgotado')); }, limites.filaMs);
            if (signal) signal.addEventListener('abort', pedido.cancelar, { once: true });
        });
    }

    async function fecharNavegador(browser) {
        if (!browser) return;
        try { await comPrazo(Promise.resolve().then(() => browser.close()), limites.fecharMs); }
        catch { try { const processo = browser.process(); if (processo && !processo.killed) processo.kill(); } catch { /* já encerrou */ } }
    }
    async function abrirNavegador(puppeteer, opcoes, signal) {
        const lancamento = Promise.resolve().then(() => puppeteer.launch({ ...opcoes, timeout: limites.abrirMs, protocolTimeout: 45000 }));
        try { return await comPrazo(lancamento, limites.abrirMs, signal, 'navegador não abriu no prazo'); }
        catch (erro) {
            // A chamada retorna no prazo, mas a vaga só libera quando esse
            // lançamento tardio terminar e fechar; não nasce outro Chromium.
            const falha = erro instanceof Error ? erro : new Error(String(erro));
            falha.encerramentoPendente = lancamento.then(fecharNavegador, () => {});
            throw falha;
        }
    }

    function criarEncaminhador(signal) {
        return new Promise((resolve, reject) => {
            const ativos = new Set();
            const conexoes = new Set();
            let totalBytes = 0, totalPedidos = 0, encerrado = false, pronto = false, fechamento = null;
            const servidor = rede.createServer(async (req, res) => {
                let endereco;
                try { endereco = new URL(req.url, 'http://127.0.0.1'); } catch { res.writeHead(400); res.end(); return; }
                if (endereco.pathname === '/' || endereco.pathname === '/index.html') {
                    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                    res.end('<!doctype html><html><body style="margin:0;background:#000"></body></html>'); return;
                }
                if (endereco.pathname !== '/video' && endereco.pathname !== '/api/hls') { res.writeHead(404); res.end(); return; }
                if (encerrado || ++totalPedidos > limites.pedidosProxy || ativos.size >= limites.simultaneosProxy || totalBytes >= limites.midiaBytes) {
                    res.writeHead(503); res.end('limite da sondagem'); return;
                }
                const controller = new AbortController();
                const ativo = { controller, stream: null };
                ativos.add(ativo);
                const cancelar = () => { controller.abort(); if (ativo.stream) ativo.stream.destroy(); };
                const limpar = () => {
                    clearTimeout(timer); req.removeListener('aborted', cancelar); res.removeListener('close', cancelar); ativos.delete(ativo);
                };
                const timer = setTimeout(() => { cancelar(); res.destroy(); limpar(); }, limites.encaminharMs);
                req.once('aborted', cancelar); res.once('close', cancelar); res.once('close', limpar); res.once('finish', limpar);
                let repassando = false;
                try {
                    const alvo = midia.textoDeBase64url(endereco.searchParams.get('u'));
                    const host = new URL(alvo).hostname;
                    const referer = endereco.searchParams.get('r') ? midia.textoDeBase64url(endereco.searchParams.get('r')) : midia.refererPadrao(host);
                    midia.liberarHost(host); // mesma regra de encaminhamento do aplicativo
                    const cabecalhos = { 'User-Agent': UA, Accept: '*/*' };
                    if (referer) cabecalhos.Referer = referer;
                    if (req.headers.range) cabecalhos.Range = req.headers.range;
                    const resposta = await cliente.get(alvo, { headers: cabecalhos, timeout: limites.encaminharMs,
                        signal: controller.signal, responseType: 'stream', maxRedirects: 4, validateStatus: status => status < 400 });
                    ativo.stream = resposta.data;
                    if (controller.signal.aborted || encerrado || res.destroyed) { cancelar(); return; }
                    const tipo = String(resposta.headers['content-type'] || '');
                    if (/mpegurl/i.test(tipo) || /\.m3u8(\?|$)/i.test(alvo)) {
                        const pedacos = []; let bytes = 0;
                        for await (const pedaco of resposta.data) {
                            bytes += pedaco.length; totalBytes += pedaco.length;
                            if (bytes > limites.playlistBytes || totalBytes > limites.midiaBytes) { cancelar(); throw new Error('playlist excedeu o limite'); }
                            pedacos.push(pedaco);
                        }
                        const texto = midia.reescreverPlaylist(Buffer.concat(pedacos).toString('utf8'), alvo, referer);
                        res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' }); res.end(texto); return;
                    }
                    res.writeHead(resposta.status, { 'Content-Type': tipo || 'application/octet-stream', 'Accept-Ranges': 'bytes',
                        ...(resposta.headers['content-range'] ? { 'Content-Range': resposta.headers['content-range'] } : {}),
                        ...(resposta.headers['content-length'] ? { 'Content-Length': resposta.headers['content-length'] } : {}) });
                    resposta.data.on('data', pedaco => { totalBytes += pedaco.length; if (totalBytes > limites.midiaBytes) { cancelar(); res.destroy(); } });
                    resposta.data.once('error', () => { res.destroy(); limpar(); });
                    repassando = true; resposta.data.pipe(res);
                } catch {
                    cancelar();
                    if (!res.destroyed) {
                        if (res.headersSent) res.destroy();
                        else { res.writeHead(502, { 'Content-Type': 'text/plain' }); res.end('erro no encaminhamento'); }
                    }
                } finally { if (!repassando) limpar(); }
            });
            servidor.on('connection', socket => { conexoes.add(socket); socket.once('close', () => conexoes.delete(socket)); });
            const fechar = () => {
                if (fechamento) return fechamento;
                encerrado = true;
                if (signal) signal.removeEventListener('abort', cancelarServidor);
                for (const ativo of ativos) { ativo.controller.abort(); if (ativo.stream) ativo.stream.destroy(); }
                for (const socket of conexoes) socket.destroy();
                fechamento = new Promise(resolver => { if (!servidor.listening) resolver(); else servidor.close(() => resolver()); });
                return fechamento;
            };
            const cancelarServidor = () => { if (!pronto) reject(cancelado()); void fechar(); };
            servidor.on('error', erro => { if (!pronto) reject(erro); void fechar(); });
            if (signal) { signal.addEventListener('abort', cancelarServidor, { once: true }); if (signal.aborted) { cancelarServidor(); return; } }
            try {
                servidor.listen(0, '127.0.0.1', () => {
                    if (encerrado) { servidor.close(); return; }
                    pronto = true;
                    resolve({ servidor, porta: servidor.address().port, fechar });
                });
            } catch (erro) { reject(erro); void fechar(); }
        });
    }

    async function tocarNoNavegador(url, { referer = '', tipo = 'hls', segundos = 25, registrar = () => {}, signal } = {}) {
        const puppeteer = carregar(), navegador = encontrar();
        if (!puppeteer || !navegador) {
            ultimoErroDoRobo = !puppeteer ? 'robô indisponível neste modo (biblioteca do navegador não carregou)' : 'nenhum navegador (Chrome/Edge) encontrado no computador';
            return { tocou: false, erro: ultimoErroDoRobo, popups: [], anuncios: [], semRobo: true };
        }
        const popups = [], anuncios = new Set();
        let liberar = null, encaminhador = null, browser = null, encerramentoPendente = null;
        try {
            liberar = await reservar(signal);
            encaminhador = await criarEncaminhador(signal);
            const porta = encaminhador.porta;
            const destino = `http://127.0.0.1:${porta}/${tipo === 'file' ? 'video' : 'api/hls'}?u=${midia.base64url(url)}${referer ? '&r=' + midia.base64url(referer) : ''}`;
            browser = await abrirNavegador(puppeteer, { executablePath: navegador, headless: true,
                args: ['--no-first-run', '--mute-audio', '--autoplay-policy=no-user-gesture-required', '--disable-blink-features=AutomationControlled'],
                defaultViewport: { width: 1280, height: 720 } }, signal);
            ultimoErroDoRobo = '';
            const pag = await comPrazo(browser.newPage(), limites.etapaMs, signal);
            browser.on('targetcreated', async alvo => {
                try {
                    if (alvo.type() === 'page' && alvo.url() !== 'about:blank' && !alvo.url().startsWith('http://127.0.0.1')) {
                        if (popups.length < 12) popups.push(alvo.url().slice(0, 120));
                        const pagina = await comPrazo(alvo.page(), limites.etapaMs, signal);
                        if (pagina) await comPrazo(pagina.close(), limites.fecharMs, signal).catch(() => {});
                    }
                } catch { /* janela já fechou */ }
            });
            pag.on('request', pedido => { try { const host = new URL(pedido.url()).hostname; if (anuncios.size < 12 && REDES_DE_ANUNCIO.test(host)) anuncios.add(host); } catch { /* endereço estranho */ } });
            let hlsJs = '';
            try { hlsJs = arquivos.readFileSync(path.join(__dirname, '..', 'node_modules', 'hls.js', 'dist', 'hls.min.js'), 'utf8'); } catch { /* reprodução nativa ainda pode funcionar */ }
            await comPrazo(pag.goto(`http://127.0.0.1:${porta}/`, { waitUntil: 'domcontentloaded', timeout: limites.etapaMs }), limites.etapaMs, signal);
            await comPrazo(pag.setContent('<!doctype html><html><body style="margin:0;background:#000"></body></html>'), limites.etapaMs, signal);
            if (hlsJs) await comPrazo(pag.addScriptTag({ content: hlsJs }), limites.etapaMs, signal).catch(erro => { if (signal && signal.aborted) throw erro; });
            registrar('abrindo o vídeo no navegador escondido…');
            const inicio = Date.now(), duracao = segundosLimitados(segundos, 25);
            // Texto para funcionar também no executável compilado.
            const script = `(async () => {
                const endereco = ${JSON.stringify(destino)}, espera = ${JSON.stringify(duracao)};
                const video = document.createElement('video');
                video.muted = true; video.playsInline = true; video.preload = 'auto';
                video.style.cssText = 'width:100%;height:100%'; document.body.append(video);
                const eventos = []; let hls = null;
                try {
                    if (/\\/api\\/hls/.test(endereco) && window.Hls && window.Hls.isSupported()) {
                        hls = new window.Hls({ enableWorker: false });
                        hls.on(window.Hls.Events.ERROR, (_, d) => { if (d.fatal && eventos.length < 12) eventos.push('erro hls: ' + d.details); });
                        hls.loadSource(endereco); hls.attachMedia(video);
                    } else { video.src = endereco; }
                } catch (erro) { eventos.push('preparo: ' + erro.message); }
                video.play().catch(erro => eventos.push('play: ' + erro.message));
                const limite = Date.now() + espera * 1000;
                while (Date.now() < limite) { if (video.videoWidth && video.currentTime > 1) break; await new Promise(r => setTimeout(r, 500)); }
                const medido = { tocou: Boolean(video.videoWidth && video.currentTime > 1), largura: video.videoWidth || 0,
                    altura: video.videoHeight || 0, tempo: Math.round((video.currentTime || 0) * 10) / 10, pronto: video.readyState,
                    travouEmAlgumMomento: !video.videoWidth ? (video.readyState < 3) : false, eventos };
                video.pause(); if (hls) hls.destroy(); video.removeAttribute('src'); video.load();
                return medido;
            })()`;
            const medido = await comPrazo(pag.evaluate(script), duracao * 1000 + 5000, signal);
            return { ...medido, ms: Date.now() - inicio, popups, anuncios: [...anuncios].slice(0, 6) };
        } catch (erro) {
            encerramentoPendente = erro.encerramentoPendente;
            ultimoErroDoRobo = String(erro.message || erro).slice(0, 140);
            return { tocou: false, erro: ultimoErroDoRobo, popups, anuncios: [...anuncios].slice(0, 6), ...(!browser || (signal && signal.aborted) ? { semRobo: true } : {}) };
        } finally {
            await fecharNavegador(browser);
            if (encaminhador) await encaminhador.fechar();
            if (liberar) {
                if (encerramentoPendente) encerramentoPendente.finally(liberar).catch(() => {});
                else liberar();
            }
        }
    }

    async function espionarPagina(url, { referer = '', segundos = 18, registrar = () => {}, signal } = {}) {
        const puppeteer = carregar(), navegador = encontrar();
        if (!puppeteer || !navegador) { ultimoErroDoRobo = 'sem navegador disponível'; return { ok: false, erro: ultimoErroDoRobo, videos: [], api: [], pedidos: [], semRobo: true }; }
        const videos = new Set(), pedidos = new Set(), api = [], chamadas = [], leituras = new Set();
        let tentativasDeLeitura = 0, coletando = true, liberar = null, browser = null, encerramentoPendente = null;
        let sessao = null, bytesDeRede = 0, excedeuRede = false;
        const sinalExterno = signal;
        const controle = new AbortController();
        const cancelarExterno = () => controle.abort();
        if (sinalExterno) {
            sinalExterno.addEventListener('abort', cancelarExterno, { once: true });
            if (sinalExterno.aborted) cancelarExterno();
        }
        signal = controle.signal;
        const resultado = () => ({ videos: [...videos].slice(0, 10), api: api.slice(0, 8), chamadas: chamadas.slice(0, 20), pedidos: [...pedidos].slice(0, 120) });
        try {
            liberar = await reservar(signal);
            browser = await abrirNavegador(puppeteer, { executablePath: navegador, headless: 'new',
                args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--mute-audio', '--autoplay-policy=no-user-gesture-required'] }, signal);
            ultimoErroDoRobo = '';
            const pag = await comPrazo(browser.newPage(), limites.etapaMs, signal);
            await comPrazo(pag.setUserAgent(UA), limites.etapaMs, signal);
            await comPrazo(pag.setViewport({ width: 1280, height: 720 }), limites.etapaMs, signal);
            // Conta dados enquanto chegam, antes de response.text() materializar
            // o corpo. Conteúdo sem Content-Length também tem um orçamento.
            if (typeof pag.createCDPSession === 'function') {
                sessao = await comPrazo(pag.createCDPSession(), limites.etapaMs, signal);
                await comPrazo(sessao.send('Network.enable'), limites.etapaMs, signal);
                sessao.on('Network.dataReceived', evento => {
                    const recebido = Number(evento.dataLength || evento.encodedDataLength || 0);
                    if (Number.isFinite(recebido) && recebido > 0) bytesDeRede += recebido;
                    if (bytesDeRede > limites.espiaoBytes) { excedeuRede = true; controle.abort(); }
                });
            }
            pag.on('request', pedido => {
                if (!coletando) return;
                try {
                    const alvo = pedido.url();
                    if (pedidos.size < 120) pedidos.add(alvo.slice(0, 300));
                    if (videos.size < 10 && /\.(m3u8|mp4)(\?|$)/i.test(alvo)) videos.add(alvo.slice(0, 500));
                    const metodo = pedido.method();
                    if (chamadas.length < 20 && (metodo !== 'GET' || /player|play|api|embed|stream|videos?|source|episodio|assistir/i.test(alvo))) {
                        const registro = { url: alvo.slice(0, 400), metodo, corpo: String(pedido.postData() || '').slice(0, 800) };
                        if (!chamadas.some(c => c.url === registro.url && c.metodo === registro.metodo)) chamadas.push(registro);
                    }
                } catch { /* endereço estranho */ }
            });
            pag.on('response', resposta => {
                if (!coletando) return;
                try {
                    const alvo = resposta.url();
                    if (/\.(m3u8|mp4)(\?|$)/i.test(alvo)) { if (videos.size < 10) videos.add(alvo.slice(0, 500)); return; }
                    const headers = resposta.headers() || {}, tipo = String(headers['content-type'] || '');
                    if (api.length >= 8 || leituras.size >= 2 || tentativasDeLeitura >= 16 || !/json|text|javascript/i.test(tipo) || /text\/css/i.test(tipo)) return;
                    const tamanho = Number(headers['content-length']);
                    if (Number.isFinite(tamanho) && tamanho > limites.corpoBytes) return;
                    tentativasDeLeitura++;
                    const leitura = (async () => {
                        try {
                            const corpo = await comPrazo(Promise.resolve().then(() => resposta.text()), limites.respostaMs, signal);
                            if (!coletando || !corpo || Buffer.byteLength(corpo, 'utf8') > limites.corpoBytes || api.length >= 8) return;
                            if (/\.(m3u8|mp4)/i.test(corpo) || /player|play|api|embed|stream|source|videos?/i.test(alvo)) api.push({ url: alvo.slice(0, 400), corpo: corpo.slice(0, 200000) });
                        } catch { /* resposta incompleta/fechada: segue para as demais */ }
                    })();
                    leituras.add(leitura); leitura.finally(() => leituras.delete(leitura));
                } catch { /* resposta já foi */ }
            });
            registrar('abrindo a página no navegador escondido para ver o que ela pede…');
            try { await comPrazo(pag.goto(url, { waitUntil: 'domcontentloaded', timeout: limites.etapaMs, referer: referer || undefined }), limites.etapaMs, signal); }
            catch (erro) { if ((signal && signal.aborted) || !pedidos.size) throw erro; }
            await comPrazo(pag.evaluate(`(() => {
                const alvos = [...document.querySelectorAll('button, .play, [class*=play], #play, [id*=play]')].slice(0, 4);
                for (const item of alvos) { try { item.click(); } catch (e) { /* segue */ } }
                const video = document.querySelector('video');
                if (video) { try { const tentativa = video.play(); if (tentativa && tentativa.catch) tentativa.catch(() => {}); } catch (e) { /* segue */ } }
            })()`), limites.etapaMs, signal).catch(erro => { if (signal && signal.aborted) throw erro; });
            await comPrazo(pausa(segundosLimitados(segundos, 18) * 1000, signal), 46000, signal);
            await comPrazo(Promise.allSettled([...leituras]), limites.respostaMs, signal).catch(erro => { if (signal && signal.aborted) throw erro; });
            coletando = false;
            return { ok: true, ...resultado() };
        } catch (erro) {
            encerramentoPendente = erro.encerramentoPendente;
            ultimoErroDoRobo = excedeuRede ? 'página excedeu o orçamento de dados da sondagem' : String(erro.message || erro).slice(0, 120);
            return { ok: false, erro: ultimoErroDoRobo, ...resultado(), ...(!browser || (signal && signal.aborted) ? { semRobo: true } : {}) };
        } finally {
            coletando = false;
            if (sinalExterno) sinalExterno.removeEventListener('abort', cancelarExterno);
            if (sessao) {
                sessao.removeAllListeners('Network.dataReceived');
                await comPrazo(Promise.resolve().then(() => sessao.detach()), limites.fecharMs).catch(() => {});
            }
            await fecharNavegador(browser);
            if (liberar) {
                if (encerramentoPendente) encerramentoPendente.finally(liberar).catch(() => {});
                else liberar();
            }
        }
    }
    return { tocarNoNavegador, espionarPagina, criarEncaminhador, erroDoRobo: () => ultimoErroDoRobo };
}

const verificador = criarVerificadorNavegador();
module.exports = { tocarNoNavegador: verificador.tocarNoNavegador, espionarPagina: verificador.espionarPagina,
    erroDoRobo: verificador.erroDoRobo, acharNavegador, REDES_DE_ANUNCIO, criarVerificadorNavegador };
