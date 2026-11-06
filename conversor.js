'use strict';
// Conversor do Conecta TV.
//
// Alguns fornecedores entregam o filme em MKV com som EAC3/AC3 — o navegador
// toca o vídeo, mas fica MUDO (medido no FenixFlix em 08/10/2026). Aqui o
// aplicativo converte o arquivo, sem perder qualidade de imagem:
//
//   - o vídeo é COPIADO (não perde nada e é rápido);
//   - só o áudio é convertido para AAC (formato que toca em qualquer aparelho);
//   - a faixa escolhida é a de PORTUGUÊS (quando o arquivo informa o idioma);
//   - a saída é HLS (a mesma lista que o player já usa): começa a tocar em
//     segundos, enquanto o resto ainda converte, e permite avançar dentro do
//     trecho já convertido.
//
// O ffmpeg é o mesmo usado pela central (baixado uma única vez). Tudo fica em
// %USERPROFILE%\.conecta-tv\conversoes, com limpeza automática.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const PASTA = path.join(os.homedir(), '.conecta-tv', 'conversoes');
const MAXIMO_ARQUIVOS = 3;
// Uma conversão é uma PASTA. Enquanto alguém estiver buscando a lista ou os
// pedaços, a pasta fica protegida por este tempo — sem isso a limpeza apagaria
// o filme no meio da reprodução.
const PROTECAO_ACESSO = 2 * 60 * 60 * 1000; // 2 horas
const VALIDADE = 3 * 24 * 60 * 60 * 1000; // 3 dias
const PRONTO_PARA_TOCAR = 0.03;            // 3% já dá para começar
const MINIMO_TOCAVEL = 12;                 // ou 12 segundos de vídeo (3 pedaços de 4 s)

const trabalhos = new Map();
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

function inspecionarDisco(pasta) {
    try {
        const m3u8 = path.join(pasta, 'index.m3u8');
        if (!fs.existsSync(m3u8)) return null;
        const texto = fs.readFileSync(m3u8, 'utf8');
        let soma = 0;
        for (const m of texto.matchAll(/#EXTINF:([0-9.]+)/g)) soma += Number(m[1]) || 0;
        return { arquivo: m3u8, completo: /#EXT-X-ENDLIST/.test(texto), segundos: Math.round(soma) };
    } catch { return null; }
}

function limparAntigos() {
    try {
        fs.mkdirSync(PASTA, { recursive: true });
        const pastas = fs.readdirSync(PASTA)
            .map(nome => ({ nome, caminho: path.join(PASTA, nome), info: fs.statSync(path.join(PASTA, nome)) }))
            .filter(item => item.info.isDirectory())
            .sort((a, b) => b.info.mtimeMs - a.info.mtimeMs);
        let mantidas = 0;
        for (const item of pastas) {
            const registro = [...trabalhos.values()].find(t => t.pasta === item.caminho);
            const trabalhando = Boolean(registro && !registro.terminou);
            const vistoAgora = Boolean(registro && registro.ultimoAcesso && Date.now() - registro.ultimoAcesso < PROTECAO_ACESSO);
            if (trabalhando || vistoAgora) { mantidas++; continue; }
            const disco = inspecionarDisco(item.caminho);
            const orfaIncompleta = !registro && (!disco || !disco.completo);
            const velho = Date.now() - item.info.mtimeMs > VALIDADE;
            const excedente = mantidas >= MAXIMO_ARQUIVOS;
            if (orfaIncompleta || velho || excedente) { try { fs.rmSync(item.caminho, { recursive: true, force: true }); } catch { /* segue */ } }
            else mantidas++;
        }
    } catch { /* sem permissão: segue */ }
}

// ---------------------------------------------------------------- disco
// 06/11/2026: o disco da Oracle encheu (o "Atualizar servidor" falhou no scp).
// Cada filme convertido ocupa quase o tamanho do original (a imagem é
// copiada) e as conversões seguiam até o fim mesmo sem ninguém assistindo.
// Agora: conversão sem ninguém pedindo pedaços há 10 min é parada, e a pasta
// inteira tem teto — passou dele, apaga as mais antigas que não estão em uso.
const LIMITE_DISCO = Number(process.env.CONVERSOES_LIMITE_GB || 8) * 1024 ** 3;
const PARADA_SEM_USO = 10 * 60 * 1000;

function tamanhoDaPasta(pasta) {
    let total = 0;
    try { for (const nome of fs.readdirSync(pasta)) { try { total += fs.statSync(path.join(pasta, nome)).size; } catch { /* sumiu */ } } } catch { /* sem pasta */ }
    return total;
}

function arrumarDisco() {
    const agora = Date.now();
    for (const t of trabalhos.values()) {
        if (!t.terminou && t.processo && agora - (t.ultimoAcesso || t.iniciadoEm || 0) > PARADA_SEM_USO) {
            try { t.processo.kill(); } catch { /* já saiu */ }
            t.parouSemUso = true;
        }
    }
    try {
        if (!fs.existsSync(PASTA)) return;
        const pastas = fs.readdirSync(PASTA)
            .map(nome => { const caminho = path.join(PASTA, nome); let info = null; try { info = fs.statSync(caminho); } catch { /* sumiu */ } return { nome, caminho, info }; })
            .filter(item => item.info && item.info.isDirectory())
            .map(item => ({ ...item, tamanho: tamanhoDaPasta(item.caminho), registro: [...trabalhos.values()].find(t => t.pasta === item.caminho) }))
            .sort((a, b) => ((a.registro && a.registro.ultimoAcesso) || a.info.mtimeMs) - ((b.registro && b.registro.ultimoAcesso) || b.info.mtimeMs));
        let total = pastas.reduce((soma, item) => soma + item.tamanho, 0);
        for (const item of pastas) {
            if (total <= LIMITE_DISCO) break;
            const emUso = item.registro && agora - (item.registro.ultimoAcesso || 0) < PARADA_SEM_USO;
            if (emUso) continue;
            if (item.registro && !item.registro.terminou && item.registro.processo) { try { item.registro.processo.kill(); } catch { /* já saiu */ } }
            try { fs.rmSync(item.caminho, { recursive: true, force: true }); total -= item.tamanho; } catch { /* segue */ }
            for (const [chave, t] of trabalhos) if (t.pasta === item.caminho) trabalhos.delete(chave);
        }
    } catch { /* sem permissão: segue */ }
}
const relogioDisco = setInterval(arrumarDisco, 60 * 1000);
if (relogioDisco.unref) relogioDisco.unref();

function identificar(titulo) {
    const limpo = String(titulo || 'video').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'video';
    return `${limpo}-${Date.now().toString(36)}`;
}

async function ffmpegPath() {
    const central = require('./central/verificar-midia');
    const ferramentas = await central.garantirFerramentas(() => { /* silencioso no aplicativo */ });
    return ferramentas.ffmpeg;
}

// Descobre a faixa de áudio em português (e a duração) do arquivo de origem.
// Mesma fonte aberta de novo (ou em outro ponto do filme): reaproveita a
// leitura do arquivo em vez de rodar o ffprobe outra vez.
const faixasLidas = new Map();
async function faixaPortuguesa(url, referer) {
    const guardada = faixasLidas.get(url);
    if (guardada && guardada.expira > Date.now()) return guardada.valor;
    const valor = await lerFaixaPortuguesa(url, referer);
    if (valor.duracao > 0) {
        if (faixasLidas.size >= 100) faixasLidas.delete(faixasLidas.keys().next().value);
        faixasLidas.set(url, { valor, expira: Date.now() + 2 * 60 * 60 * 1000 });
    }
    return valor;
}
async function lerFaixaPortuguesa(url, referer) {
    try {
        const central = require('./central/verificar-midia');
        // Prazo curto: é o que segura o "abrir" do filme convertido.
        const faixas = await central.faixasDeAudio(url, referer, { timeout: 15000 });
        if (!faixas || !faixas.faixas.length) return { indice: 0, duracao: 0 };
        const portuguesa = faixas.faixas.find(f => /^pt|por/.test(f.idioma));
        return { indice: portuguesa ? portuguesa.ordem : 0, duracao: Number(faixas.duracao) || 0 };
    } catch { return { indice: 0, duracao: 0 }; }
}

// Inicia (ou reaproveita) a conversão de um endereço.
async function iniciar(url, { titulo = '', referer = '', id = '', inicio = 0 } = {}) {
    // `id` é a identidade do TRABALHO (filme-550 / serie-1399-T1E1), estável entre
    // aberturas. A chave real leva um carimbo de tempo porque a mesma obra pode
    // voltar com endereço novo: reaproveitar a conversão velha serviria um vídeo
    // que já não responde. O carimbo separa "mesma obra" de "mesma conversão" —
    // sem ele, cada abertura criava uma pasta nova para sempre.
    const lastro = id || identificar(titulo);
    const chave = `${lastro}-${Date.now().toString(36)}`;

    // Já existe conversão desta obra que ainda serve? Reaproveita, sem reconverter.
    const prontas = [...trabalhos.entries()]
        .filter(([, t]) => t.lastro === lastro && t.arquivo && fs.existsSync(t.arquivo))
        .sort((a, b) => b[1].iniciadoEm - a[1].iniciadoEm);
    if (prontas.length) {
        const [chaveBoa, registroBom] = prontas[0];
        registroBom.ultimoAcesso = Date.now();
        return resumo(chaveBoa);
    }
    try {
        if (fs.existsSync(PASTA)) {
            const candidatas = fs.readdirSync(PASTA)
                .filter(nome => nome === lastro || nome.startsWith(lastro + '-'))
                .map(nome => ({ nome, caminho: path.join(PASTA, nome), info: fs.statSync(path.join(PASTA, nome)) }))
                .filter(item => item.info.isDirectory())
                .sort((a, b) => b.info.mtimeMs - a.info.mtimeMs);
            for (const item of candidatas) {
                const disco = inspecionarDisco(item.caminho);
                if (disco && disco.completo) {
                    trabalhos.set(item.nome, { arquivo: disco.arquivo, pasta: item.caminho, lastro, segundos: disco.segundos, duracao: disco.segundos, progresso: 100, pronto: true, terminou: true, erro: '', iniciadoEm: item.info.mtimeMs, ultimoAcesso: Date.now(), processo: null });
                    return resumo(item.nome);
                }
            }
        }
    } catch { /* segue para nova conversão */ }

    limparAntigos();
    const existente = trabalhos.get(chave);
    if (existente && !existente.terminou && !existente.erro) return resumo(chave);
    if (existente && existente.arquivo && fs.existsSync(existente.arquivo) && existente.terminou) return resumo(chave);

    limparAntigos();
    const pasta = path.join(PASTA, chave);
    try { fs.mkdirSync(pasta, { recursive: true }); } catch { /* sem permissão */ }
    const arquivo = path.join(pasta, 'index.m3u8');
    const registro = { arquivo, pasta, lastro, inicio: Math.max(0, Math.floor(Number(inicio) || 0)), segundos: 0, duracao: 0, pronto: false, terminou: false, erro: '', iniciadoEm: Date.now(), ultimoAcesso: Date.now(), processo: null };
    trabalhos.set(chave, registro);

    let binario;
    try { binario = await ffmpegPath(); } catch (erro) { registro.erro = 'conversor indisponível: ' + String(erro.message).slice(0, 80); return resumo(chave); }
    const { indice, duracao } = await faixaPortuguesa(url, referer);
    registro.duracao = duracao;

    const cabecalhos = `User-Agent: ${UA}\r\n` + (referer ? `Referer: ${referer}\r\n` : '');
    const argumentos = [
        '-hide_banner', '-y', '-loglevel', 'info',
        '-headers', cabecalhos,
        // Começar no meio do filme (continuar de onde parou / pular para a
        // frente): o ffmpeg pula direto para o ponto (o MKV tem índice) e a
        // conversão começa ali, em segundos, em vez de converter desde o 0.
        ...(registro.inicio > 0 ? ['-ss', String(registro.inicio)] : []),
        '-i', url,
        '-map', '0:v:0',
        '-map', `0:a:${indice}`,
        '-c:v', 'copy',
        '-c:a', 'aac', '-b:a', '160k', '-ac', '2',
        // HLS: o player começa com os primeiros pedaços e a lista cresce
        // enquanto a conversão continua (formato que o aplicativo já domina).
        '-f', 'hls',
        '-hls_time', '4',
        '-hls_playlist_type', 'event',
        '-hls_flags', 'independent_segments',
        '-hls_segment_filename', path.join(pasta, 'seg%05d.ts'),
        arquivo,
    ];
    try {
        const processo = spawn(binario, argumentos, { windowsHide: true });
        registro.processo = processo;
        let ultimoErro = '';
        processo.stderr.on('data', (pedaco) => {
            const texto = String(pedaco);
            const achado = texto.match(/time=(\d+):(\d+):(\d+)\.(\d+)/);
            if (achado) {
                registro.segundos = Number(achado[1]) * 3600 + Number(achado[2]) * 60 + Number(achado[3]);
                if (registro.duracao > 0) registro.progresso = Math.min(99, Math.round((registro.segundos / registro.duracao) * 100));
                else registro.progresso = Math.min(99, Math.round((registro.segundos / 3600) * 10));
                // Velocidade da conversão ("speed=3.4x"): abaixo de 1x o filme
                // alcança a conversão e trava. Conversão lenta só libera o play
                // com folga maior (60 s prontos) para aguentar as oscilações.
                const vel = texto.match(/speed=\s*([\d.]+)x/);
                if (vel) { const v = Number(vel[1]) || 0; registro.velocidade = registro.velocidade ? Math.round((registro.velocidade * 0.7 + v * 0.3) * 10) / 10 : v; }
                const folga = (registro.velocidade || 0) >= 1.5 ? MINIMO_TOCAVEL : 60;
                if (!registro.pronto && (registro.progresso >= PRONTO_PARA_TOCAR * 100 && registro.segundos >= folga || registro.segundos >= folga)) registro.pronto = true;
            }
            if (/error|Invalid data|Server returned/i.test(texto)) ultimoErro = require('./cofre-links.cjs').semSegredo(texto.trim()).slice(-120);
        });
        processo.on('exit', (codigo) => {
            registro.terminou = true;
            registro.emUso = false;
            if (codigo === 0) { registro.pronto = true; registro.progresso = 100; }
            else if (!registro.pronto && !fs.existsSync(arquivo)) registro.erro = ultimoErro || 'não consegui converter o arquivo';
            else registro.pronto = true; // parou no meio, mas o trecho já serve
        });
        processo.on('error', (erro) => { registro.erro = String(erro.message).slice(0, 100); registro.terminou = true; });
    } catch (erro) { registro.erro = String(erro.message).slice(0, 100); registro.terminou = true; }
    return resumo(chave);
}

function resumo(chave) {
    let registro = trabalhos.get(chave);
    if (!registro && /^[A-Za-z0-9_-]{1,96}$/.test(String(chave || ''))) {
        const pasta = path.join(PASTA, String(chave));
        const disco = inspecionarDisco(pasta);
        if (disco && disco.completo) {
            registro = { arquivo: disco.arquivo, pasta, lastro: String(chave).replace(/-[a-z0-9]+$/i, ''), segundos: disco.segundos, duracao: disco.segundos, progresso: 100, pronto: true, terminou: true, erro: '', iniciadoEm: Date.now(), ultimoAcesso: Date.now(), processo: null };
            trabalhos.set(String(chave), registro);
        }
    }
    if (!registro) return { id: chave, pronto: false, progresso: 0, erro: 'conversão não encontrada' };
    let tamanho = 0;
    try {
        if (registro.pasta && fs.existsSync(registro.pasta)) {
            tamanho = fs.readdirSync(registro.pasta).reduce((soma, nome) => {
                try { return soma + fs.statSync(path.join(registro.pasta, nome)).size; } catch { return soma; }
            }, 0);
        }
    } catch { /* sem arquivo ainda */ }
    return {
        id: chave,
        pronto: Boolean(registro.pronto),
        progresso: registro.progresso || 0,
        velocidade: registro.velocidade || 0,
        segundos: registro.segundos || 0,
        duracao: registro.duracao || 0,
        convertido: Boolean(registro.terminou),
        tamanho,
        erro: registro.erro || '',
        inicio: registro.inicio || 0,
    };
}

function estado(chave) { return resumo(chave); }

// Conversão que já cobre o ponto `inicio` (segundos do filme) ou uma nova que
// começa nele. Devolve o resumo + `inicio` (onde o vídeo convertido começa no
// filme). Janelas: "filme-550" (desde o 0) e "ini1980-filme-550" (desde 33 min).
async function iniciarNoPonto(url, { id = '', referer = '', inicio = 0 } = {}) {
    const ponto = Math.max(0, Math.floor(Number(inicio) || 0));
    if (!id || ponto < 60) return { ...(await module.exports.iniciar(url, { id, titulo: id, referer })), inicio: 0 };
    const deste = new RegExp(`^(?:ini(\\d+)-)?${id.replace(/[^\w-]/g, '')}$`);
    let melhor = null;
    for (const [chave, t] of trabalhos) {
        const m = String(t.lastro || '').match(deste);
        if (!m || t.erro || !t.arquivo) continue;
        const ini = Number(m[1] || 0);
        if (ini > ponto) continue;
        const disco = t.terminou ? inspecionarDisco(t.pasta) : null;
        const completo = Boolean(disco && disco.completo);
        // Conversão parada no meio (sem uso / erro): só serve com folga de 5 min,
        // senão o filme alcança o fim dela e trava.
        const alcancou = ini + (t.segundos || 0) >= ponto + (t.terminou && !completo ? 300 : 15);
        const vaiChegar = !t.terminou && ponto - ini <= 180;
        if ((completo && (!t.duracao || ini + (t.segundos || t.duracao) >= ponto + 15)) || alcancou || vaiChegar) {
            if (!melhor || ini > melhor.ini) melhor = { chave, ini, t };
        }
    }
    if (melhor) { melhor.t.ultimoAcesso = Date.now(); return { ...resumo(melhor.chave), inicio: melhor.ini }; }
    // Janela nova: para as conversões deste filme que ninguém está vendo.
    for (const [, t] of trabalhos) {
        if (deste.test(String(t.lastro || '')) && !t.terminou && t.processo && Date.now() - (t.ultimoAcesso || 0) > 30000) {
            try { t.processo.kill(); } catch { /* já saiu */ }
        }
    }
    const resultado = await module.exports.iniciar(url, { id: `ini${ponto}-${id}`, titulo: id, referer, inicio: ponto });
    return { ...resultado, inicio: ponto };
}
function arquivoDe(chave) {
    const registro = trabalhos.get(chave);
    if (registro && fs.existsSync(registro.arquivo)) { registro.ultimoAcesso = Date.now(); return registro.arquivo; }
    const direto = path.join(PASTA, String(chave || '').replace(/[^\w.-]/g, ''), 'index.m3u8');
    return fs.existsSync(direto) ? direto : '';
}

// Caminho seguro de um pedaço da conversão (lista e segmentos).
function caminhoDoPedaço(chave, nome) {
    const registro = trabalhos.get(String(chave || ''));
    if (registro) registro.ultimoAcesso = Date.now();
    const pasta = path.join(PASTA, String(chave || '').replace(/[^\w.-]/g, ''));
    const alvo = path.join(pasta, String(nome || 'index.m3u8').replace(/[^\w.-]/g, ''));
    if (!alvo.startsWith(pasta)) return '';
    return fs.existsSync(alvo) ? alvo : '';
}

function encerrarTudo() {
    for (const registro of trabalhos.values()) {
        try { if (registro.processo) registro.processo.kill(); } catch { /* já saiu */ }
    }
}

module.exports = { arrumarDisco, iniciar, iniciarNoPonto, estado, arquivoDe, caminhoDoPedaço, resumo, encerrarTudo, PASTA, identificar };
