'use strict';
// Verificação de reprodução da central: abre a fonte num navegador de verdade
// (escondido), do mesmo jeito que o aplicativo faz, e mede:
//
//   - o vídeo começou? em quanto tempo? em que qualidade?
//   - abriu janela/pop-up de anúncio? chamou rede de anúncio?
//   - travou no meio?
//
// Usa o encaminhamento do próprio aplicativo (mesma reescrita de lista), então
// o que for aprovado aqui é o que o usuário vai receber.

const fs = require('fs');
const path = require('path');
const http = require('http');
const axios = require('axios');
const midia = require('../midia-proxy');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const REDES_DE_ANUNCIO = /(effectivecpmnetwork|bunkedfusels|profitablecpmgate|popads|popcash|adsterra|monetag|propellerads|onclck|googlesyndication|adnxs|taboola|outbrain|clickadu|hilltopads|exoclick|revenuehits|mgid|zergnet|21wiz|inmobi|doubleclick)/i;

function acharNavegador() {
    const tentativas = [
        process.env.CHROME_PATH || '',
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    ];
    return tentativas.find(caminho => caminho && fs.existsSync(caminho)) || '';
}

function carregarPuppeteer() {
    try { return require('puppeteer-core'); } catch { return null; }
}

// Fica registrado o motivo quando o robô não está disponível (por exemplo, no
// programa compilado que não trouxe a biblioteca) — a central mostra isso no
// lugar de simplesmente falhar.
let ultimoErroDoRobo = '';
function erroDoRobo() { return ultimoErroDoRobo; }

// Servidor local que repassa o vídeo COM o referenciador certo e reescreve a
// lista de reprodução — igual ao que o aplicativo faz para o usuário.
function criarEncaminhador() {
    return new Promise(resolve => {
        const servidor = http.createServer(async (req, res) => {
            const url = new URL(req.url, 'http://127.0.0.1');
            if (url.pathname === '/' || url.pathname === '/index.html') {
                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end('<!doctype html><html><body style="margin:0;background:#000"></body></html>');
                return;
            }
            if (url.pathname === '/video' || url.pathname === '/api/hls') {
                try {
                    const alvo = midia.textoDeBase64url(url.searchParams.get('u'));
                    const referer = url.searchParams.get('r') ? midia.textoDeBase64url(url.searchParams.get('r')) : midia.refererPadrao(new URL(alvo).hostname);
                    // Libera o servidor de vídeo no encaminhamento (mesma regra do aplicativo).
                    try { midia.liberarHost(new URL(alvo).hostname); } catch { /* endereço inválido */ }
                    const cabecalhos = { 'User-Agent': UA, Accept: '*/*' };
                    if (referer) cabecalhos.Referer = referer;
                    if (req.headers.range) cabecalhos.Range = req.headers.range;
                    const resposta = await axios.get(alvo, { headers: cabecalhos, timeout: 45000, responseType: 'stream', maxRedirects: 4, validateStatus: s => s < 400 });
                    const tipo = String(resposta.headers['content-type'] || '');
                    if (/mpegurl/i.test(tipo) || /\.m3u8(\?|$)/i.test(alvo)) {
                        const pedacos = [];
                        for await (const pedaco of resposta.data) pedacos.push(pedaco);
                        const texto = midia.reescreverPlaylist(Buffer.concat(pedacos).toString('utf8'), alvo, referer);
                        res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' });
                        res.end(texto);
                        return;
                    }
                    res.writeHead(resposta.status, {
                        'Content-Type': tipo || 'application/octet-stream',
                        'Accept-Ranges': 'bytes',
                        ...(resposta.headers['content-range'] ? { 'Content-Range': resposta.headers['content-range'] } : {}),
                        ...(resposta.headers['content-length'] ? { 'Content-Length': resposta.headers['content-length'] } : {}),
                    });
                    resposta.data.pipe(res);
                    resposta.data.on('error', () => { try { res.end(); } catch { /* já fechou */ } });
                } catch (erro) {
                    res.writeHead(502, { 'Content-Type': 'text/plain' });
                    res.end('erro no encaminhamento');
                }
                return;
            }
            res.writeHead(404);
            res.end();
        });
        servidor.listen(0, '127.0.0.1', () => resolve({ servidor, porta: servidor.address().port }));
    });
}

// Toca a fonte e devolve o que foi medido.
async function tocarNoNavegador(url, { referer = '', tipo = 'hls', segundos = 25, registrar = () => {} } = {}) {
    const puppeteer = carregarPuppeteer();
    const navegador = acharNavegador();
    if (!puppeteer) {
        ultimoErroDoRobo = 'robô indisponível neste modo (biblioteca do navegador não carregou)';
        return { tocou: false, erro: ultimoErroDoRobo, popups: [], anuncios: [], semRobo: true };
    }
    if (!navegador) {
        ultimoErroDoRobo = 'nenhum navegador (Chrome/Edge) encontrado no computador';
        return { tocou: false, erro: ultimoErroDoRobo, popups: [], anuncios: [], semRobo: true };
    }

    const { servidor, porta } = await criarEncaminhador();
    const destino = tipo === 'file'
        ? `http://127.0.0.1:${porta}/video?u=${midia.base64url(url)}${referer ? '&r=' + midia.base64url(referer) : ''}`
        : `http://127.0.0.1:${porta}/api/hls?u=${midia.base64url(url)}${referer ? '&r=' + midia.base64url(referer) : ''}`;

    const popups = [];
    const anuncios = new Set();
    let navegadorAberto = null;
    try {
        navegadorAberto = await puppeteer.launch({
            executablePath: navegador, headless: true,
            protocolTimeout: 90000,
            args: ['--no-first-run', '--mute-audio', '--autoplay-policy=no-user-gesture-required', '--disable-blink-features=AutomationControlled'],
            defaultViewport: { width: 1280, height: 720 },
        });
        const pag = await navegadorAberto.newPage();
        navegadorAberto.on('targetcreated', async (alvo) => {
            try {
                if (alvo.type() === 'page' && alvo.url() !== 'about:blank' && !alvo.url().startsWith('http://127.0.0.1')) {
                    popups.push(alvo.url().slice(0, 120));
                    const pagina = await alvo.page();
                    if (pagina) await pagina.close().catch(() => {});
                }
            } catch { /* janela já fechou */ }
        });
        pag.on('request', (pedido) => {
            try { if (REDES_DE_ANUNCIO.test(new URL(pedido.url()).hostname)) anuncios.add(new URL(pedido.url()).hostname); } catch { /* endereço estranho */ }
        });

        const hlsJs = (() => { try { return fs.readFileSync(path.join(__dirname, '..', 'node_modules', 'hls.js', 'dist', 'hls.min.js'), 'utf8'); } catch { return ''; } })();
        await pag.goto(`http://127.0.0.1:${porta}/`, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await pag.setContent('<!doctype html><html><body style="margin:0;background:#000"></body></html>');
        if (hlsJs) await pag.addScriptTag({ content: hlsJs }).catch(() => {});

        registrar('abrindo o vídeo no navegador escondido…');
        const inicio = Date.now();
        // O script vai como TEXTO: dentro do programa compilado as funções
        // passadas direto para o navegador não podem ser serializadas.
        const script = `(async () => {
            const endereco = ${JSON.stringify(destino)};
            const espera = ${JSON.stringify(segundos)};
            const video = document.createElement('video');
            video.muted = true; video.playsInline = true; video.preload = 'auto';
            video.style.cssText = 'width:100%;height:100%';
            document.body.append(video);
            const eventos = [];
            let hls = null;
            const ehLista = /\\/api\\/hls/.test(endereco);
            try {
                if (ehLista && window.Hls && window.Hls.isSupported()) {
                    hls = new window.Hls({ enableWorker: false });
                    hls.on(window.Hls.Events.ERROR, (_, d) => { if (d.fatal) eventos.push('erro hls: ' + d.details); });
                    hls.loadSource(endereco);
                    hls.attachMedia(video);
                } else {
                    video.src = endereco;
                }
            } catch (erro) { eventos.push('preparo: ' + erro.message); }
            video.play().catch((erro) => eventos.push('play: ' + erro.message));
            const limite = Date.now() + espera * 1000;
            while (Date.now() < limite) {
                if (video.videoWidth && video.currentTime > 1) break;
                await new Promise(r => setTimeout(r, 500));
            }
            return {
                tocou: Boolean(video.videoWidth && video.currentTime > 1),
                largura: video.videoWidth || 0,
                altura: video.videoHeight || 0,
                tempo: Math.round((video.currentTime || 0) * 10) / 10,
                pronto: video.readyState,
                travouEmAlgumMomento: !video.videoWidth ? (video.readyState < 3) : false,
                eventos,
            };
        })()`;
        const medido = await pag.evaluate(script);
        const ms = Date.now() - inicio;
        return { ...medido, ms, popups, anuncios: [...anuncios].slice(0, 6) };
    } catch (erro) {
        return { tocou: false, erro: String(erro.message).slice(0, 140), popups, anuncios: [...anuncios].slice(0, 6) };
    } finally {
        if (navegadorAberto) await navegadorAberto.close().catch(() => {});
        servidor.close();
    }
}

// ---------------------------------------------------------------- espião
// O "cão de caça": abre a página do fornecedor no navegador escondido e fica
// olhando o que ELA pede. É assim que o caçador descobre o endereço que o site
// usa para entregar o vídeo quando isso não aparece no HTML (caso do
// RedeCanais, medido em 10/10/2026: o player só carrega por chamada interna).
//
// Devolve:
//   videos  — endereços de vídeo (.m3u8/.mp4) que a página pediu;
//   api     — chamadas cujo corpo traz um endereço de vídeo (com o corpo, para
//             o caçador aprender a regra de leitura);
//   pedidos — todos os endereços pedidos pela página (para achar o padrão).
async function espionarPagina(url, { referer = '', segundos = 18, registrar = () => {} } = {}) {
    const puppeteer = carregarPuppeteer();
    const navegador = acharNavegador();
    if (!puppeteer || !navegador) { ultimoErroDoRobo = 'sem navegador disponível'; return { ok: false, erro: ultimoErroDoRobo, videos: [], api: [], pedidos: [] }; }
    let aberto = null;
    const videos = new Set();
    const api = [];
    const pedidos = new Set();
        const chamadas = [];
    try {
        aberto = await puppeteer.launch({
            executablePath: navegador,
            headless: 'new',
            args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--mute-audio', '--autoplay-policy=no-user-gesture-required'],
        });
        const pag = await aberto.newPage();
        await pag.setUserAgent(UA);
        await pag.setViewport({ width: 1280, height: 720 });
        pag.on('request', pedido => {
            try {
                const alvo = pedido.url();
                pedidos.add(alvo.slice(0, 300));
                if (/\.(m3u8|mp4)(\?|$)/i.test(alvo)) videos.add(alvo.slice(0, 500));
                // Guarda COMO a página pediu (método, corpo e referenciador):
                // é isso que a ficha precisa repetir depois.
                const metodo = pedido.method();
                if (metodo !== 'GET' || /player|play|api|embed|stream|videos?|source|episodio|assistir/i.test(alvo)) {
                    const registro = { url: alvo.slice(0, 400), metodo, corpo: String(pedido.postData() || '').slice(0, 800) };
                    if (!chamadas.some(c => c.url === registro.url && c.metodo === registro.metodo)) chamadas.push(registro);
                }
            } catch { /* endereço estranho */ }
        });
        // Respostas que trazem um endereço de vídeo no corpo (JSON de player).
        pag.on('response', async resposta => {
            try {
                const alvo = resposta.url();
                if (/\.(m3u8|mp4)(\?|$)/i.test(alvo)) { videos.add(alvo.slice(0, 500)); return; }
                const tipo = String((resposta.headers() || {})['content-type'] || '');
                if (api.length >= 8) return;
                if (!/json|text|javascript/i.test(tipo)) return;
                const corpo = await resposta.text().catch(() => '');
                if (!corpo || corpo.length > 400000) return;
                const interessante = /\.(m3u8|mp4)/i.test(corpo) || /player|play|api|embed|stream|source|videos?/i.test(alvo);
                if (interessante) api.push({ url: alvo.slice(0, 400), corpo: corpo.slice(0, 200000) });
            } catch { /* resposta já foi */ }
        });
        registrar('abrindo a página no navegador escondido para ver o que ela pede…');
        await pag.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000, referer: referer || undefined }).catch(() => {});
        // Alguns players só carregam depois de um clique no "play".
        await pag.evaluate(`(() => {
            const alvos = [...document.querySelectorAll('button, .play, [class*=play], #play, [id*=play]')].slice(0, 4);
            for (const item of alvos) { try { item.click(); } catch (e) { /* segue */ } }
            const video = document.querySelector('video');
            if (video) { try { video.play(); } catch (e) { /* segue */ } }
        })()`).catch(() => {});
        await new Promise(resolve => setTimeout(resolve, Math.max(4, segundos) * 1000));
        return { ok: true, videos: [...videos].slice(0, 10), api: api.slice(0, 12), chamadas: chamadas.slice(0, 20), pedidos: [...pedidos].slice(0, 120) };
    } catch (erro) {
        ultimoErroDoRobo = String(erro.message).slice(0, 120);
        return { ok: false, erro: ultimoErroDoRobo, videos: [...videos], api, chamadas, pedidos: [...pedidos] };
    } finally {
        if (aberto) await aberto.close().catch(() => {});
    }
}

module.exports = { tocarNoNavegador, espionarPagina, acharNavegador, REDES_DE_ANUNCIO, erroDoRobo };
