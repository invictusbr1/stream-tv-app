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

module.exports = { tocarNoNavegador, acharNavegador, REDES_DE_ANUNCIO, erroDoRobo };
