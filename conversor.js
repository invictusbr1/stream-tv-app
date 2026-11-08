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
const semDados = new Map(); // lastro → quando a fonte não entregou nada
function falhouSemDados(lastro) { const em = semDados.get(String(lastro || '')); return Boolean(em && Date.now() - em < 2 * 60 * 60 * 1000); }
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

function inspecionarDisco(pasta) {
    try {
        const m3u8 = path.join(pasta, 'index.m3u8');
        if (!fs.existsSync(m3u8)) return null;
        let texto = fs.readFileSync(m3u8, 'utf8');
        // Lista mestra (anime legendado): o vídeo está em index0.m3u8.
        if (/#EXT-X-STREAM-INF/.test(texto)) { try { texto = fs.readFileSync(path.join(pasta, 'index0.m3u8'), 'utf8'); } catch { return null; } }
        let soma = 0;
        for (const m of texto.matchAll(/#EXTINF:([0-9.]+)/g)) soma += Number(m[1]) || 0;
        return { arquivo: m3u8, completo: /#EXT-X-ENDLIST/.test(texto), segundos: Math.round(soma) };
    } catch { return null; }
}

// Legenda de fora (SRT): o ffmpeg alinha cada entrada pelo PRIMEIRO trecho
// dela — então a legenda é deslocada aqui para o ponto de início e ganha um
// trecho invisível em 00:00, e assim casa com o vídeo (testado 08/11/2026).
function srtTempo(t) { const m = String(t).match(/(\d+):(\d{2}):(\d{2})[,.](\d{1,3})/); return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4].padEnd(3, '0')) / 1000 : NaN; }
function srtFormato(s) { const ms = Math.max(0, Math.round(s * 1000)); const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, seg = Math.floor(ms / 1000) % 60, r = ms % 1000; return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(seg).padStart(2, '0')},${String(r).padStart(3, '0')}`; }
function ajustarSrt(texto, inicio = 0) {
    const blocos = String(texto || '').replace(/^\uFEFF/, '').replace(/\r/g, '').split(/\n{2,}/);
    const saida = [`1\n${srtFormato(0)} --> ${srtFormato(0.01)}\n\u200b`];
    for (const bloco of blocos) {
        const linhas = bloco.split('\n').filter(l => l.trim() !== '');
        const i = linhas.findIndex(l => l.includes('-->'));
        if (i < 0) continue;
        const [a, b] = linhas[i].split('-->');
        let ini = srtTempo(a) - inicio, fim = srtTempo(b) - inicio;
        if (!Number.isFinite(ini) || !Number.isFinite(fim) || fim <= 0.02) continue;
        ini = Math.max(0.02, ini);
        const texto = linhas.slice(i + 1).join('\n').trim();
        if (texto) saida.push(`${saida.length + 1}\n${srtFormato(ini)} --> ${srtFormato(fim)}\n${texto}`);
    }
    return saida.length > 1 ? saida.join('\n\n') + '\n' : '';
}
async function baixarLegenda(url, ms = 12000) {
    const controle = new AbortController(); const relogio = setTimeout(() => controle.abort(), ms);
    try { const r = await fetch(url, { signal: controle.signal, headers: { 'User-Agent': UA } }); if (!r.ok) return ''; const t = await r.text(); return t.length > 3_000_000 ? '' : t; }
    catch { return ''; } finally { clearTimeout(relogio); }
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
        // Sem faixa em português e com outra língua declarada (ex.: "ita",
        // "eng"): NÃO converte a primeira faixa — 06/11/2026, Dexter T3E4 saiu
        // em italiano. Faixas sem idioma ("und") seguem valendo.
        const outra = faixas.faixas.some(f => f.idioma && f.idioma !== 'und' && !/^pt|por/.test(f.idioma));
        return { indice: portuguesa ? portuguesa.ordem : 0, duracao: Number(faixas.duracao) || 0, semPortugues: !portuguesa && outra };
    } catch { return { indice: 0, duracao: 0 }; }
}

// Inicia (ou reaproveita) a conversão de um endereço.
async function iniciar(url, { titulo = '', referer = '', id = '', inicio = 0, faixa = null, quatroK = false, legenda = null, legendaExterna = '' } = {}) {
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
    const registro = { arquivo, pasta, lastro, quatroK: Boolean(quatroK), inicio: Math.max(0, Math.floor(Number(inicio) || 0)), segundos: 0, duracao: 0, pronto: false, terminou: false, erro: '', iniciadoEm: Date.now(), ultimoAcesso: Date.now(), processo: null };
    trabalhos.set(chave, registro);

    let binario;
    try { binario = await ffmpegPath(); } catch (erro) { registro.erro = 'conversor indisponível: ' + String(erro.message).slice(0, 80); return resumo(chave); }
    // A fonte pode já ter lido o arquivo (TorBox confere o áudio antes).
    const lida = faixa && Number.isInteger(faixa.indice) ? { indice: faixa.indice, duracao: Number(faixa.duracao) || 0 } : await faixaPortuguesa(url, referer);
    const { indice, duracao } = lida;
    const comLegenda = Boolean(legenda && Number.isInteger(legenda.indice) && legenda.indice >= 0);
    // Legenda de fora (OpenSubtitles, só endereço https do strem.io) vira a
    // segunda entrada do ffmpeg; sai igual à legenda embutida.
    const externa = !comLegenda && /^https:\/\/[a-z0-9.-]+\.strem\.io\/[\w./%-]+$/i.test(String(legendaExterna || '')) ? String(legendaExterna) : '';
    let arquivoLegenda = '';
    if (externa) {
        const ajustada = ajustarSrt(await baixarLegenda(externa), registro.inicio);
        if (ajustada) { try { fs.mkdirSync(pasta, { recursive: true }); arquivoLegenda = path.join(pasta, 'legenda-externa.srt'); fs.writeFileSync(arquivoLegenda, ajustada); } catch { arquivoLegenda = ''; } }
    }
    registro.legenda = comLegenda || Boolean(arquivoLegenda);
    registro.duracao = duracao;
    if (lida.semPortugues) { registro.erro = 'o arquivo não tem áudio em português'; registro.terminou = true; return resumo(chave); }

    const cabecalhos = `User-Agent: ${UA}\r\n` + (referer ? `Referer: ${referer}\r\n` : '');
    const argumentos = [
        '-hide_banner', '-y', '-loglevel', 'info',
        '-headers', cabecalhos,
        // Conexão com o arquivo (TorBox/CDN) que trava no meio: sem isto o
        // ffmpeg ficava parado para sempre e o player esperava "Voltando de
        // onde você parou" até desistir (07/11/2026, Homem-Aranha). Agora a
        // leitura parada há 15 s cai e ele reconecta sozinho do mesmo ponto.
        ...(/^https?:/i.test(url) ? ['-rw_timeout', '15000000', '-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_on_network_error', '1', '-reconnect_delay_max', '5'] : []),
        // Começar no meio do filme (continuar de onde parou / pular para a
        // frente): o ffmpeg pula direto para o ponto (o MKV tem índice) e a
        // conversão começa ali, em segundos, em vez de converter desde o 0.
        ...(registro.inicio > 0 ? ['-ss', String(registro.inicio)] : []),
        '-i', url,
        ...(arquivoLegenda ? ['-i', arquivoLegenda] : []),
        '-map', '0:v:0',
        '-map', `0:a:${indice}`,
        ...(comLegenda ? ['-map', `0:s:${legenda.indice}`] : arquivoLegenda ? ['-map', '1:0'] : []),
        '-c:v', 'copy',
        '-c:a', 'aac', '-b:a', '160k', '-ac', '2',
        ...(comLegenda || arquivoLegenda ? ['-c:s', 'webvtt'] : []),
        // HLS: o player começa com os primeiros pedaços e a lista cresce
        // enquanto a conversão continua (formato que o aplicativo já domina).
        '-f', 'hls',
        '-hls_time', '4',
        '-hls_playlist_type', 'event',
        '-hls_flags', 'independent_segments',
        // Anime legendado (TorBox): a legenda portuguesa do arquivo vira
        // legenda do player, em pedaços junto com o vídeo. A lista principal
        // continua sendo index.m3u8 (vira a "mestra": vídeo em index0.m3u8,
        // legenda em index0_vtt.m3u8) — o resto do app não muda.
        ...(comLegenda || arquivoLegenda
            ? ['-master_pl_name', 'index.m3u8', '-var_stream_map', 'v:0,a:0,s:0,sgroup:legendas,language:por',
                '-hls_segment_filename', path.join(pasta, 'seg%v_%05d.ts'), path.join(pasta, 'index%v.m3u8')]
            : ['-hls_segment_filename', path.join(pasta, 'seg%05d.ts'), arquivo]),
    ];
    try {
        const processo = spawn(binario, argumentos, { windowsHide: true });
        registro.processo = processo;
        // Fonte que não entrega NADA (08/11/2026, Off Campus T1E1: TorBox dizia
        // "pronto", o ffmpeg ficou em 0 s para sempre e o app esperava até o
        // tempo limite). Sem nenhum segundo convertido em 45 s, desiste com
        // erro — o player passa para a próxima fonte em vez de esperar.
        const vigia = setTimeout(() => {
            if (!registro.terminou && !(registro.segundos > 0)) {
                registro.erro = 'a fonte não entregou o vídeo (nada chegou em 45 s)';
                semDados.set(String(lastro).replace(/^ini\d+-/, ''), Date.now());
                try { processo.kill('SIGKILL'); } catch { /* já saiu */ }
            }
        }, 45000);
        if (vigia.unref) vigia.unref();
        let ultimoErro = '';
        processo.stderr.on('data', (pedaco) => {
            const texto = String(pedaco);
            const achado = texto.match(/time=(\d+):(\d+):(\d+)\.(\d+)/);
            if (achado) {
                const agoraSeg = Number(achado[1]) * 3600 + Number(achado[2]) * 60 + Number(achado[3]);
                if (agoraSeg > (registro.segundos || 0)) registro.ultimoProgresso = Date.now();
                registro.segundos = agoraSeg;
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
            clearTimeout(vigia);
            registro.terminou = true;
            registro.emUso = false;
            if (codigo === 0) { registro.pronto = true; registro.progresso = 100; }
            else if (registro.erro) { /* o vigia já explicou */ }
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
        parado: !registro.terminou && Date.now() - (registro.ultimoProgresso || registro.iniciadoEm || 0) > 20000,
        segundos: registro.segundos || 0,
        duracao: registro.duracao || 0,
        convertido: Boolean(registro.terminou),
        tamanho,
        erro: registro.erro || '',
        inicio: registro.inicio || 0,
    };
}

function estado(chave) { return resumo(chave); }

// 4K convertido ocupa 15–25 GB: só um filme 4K por vez no servidor e só com
// folga de disco (30 GB livres). Quem pedir outro 4K ao mesmo tempo recebe o
// Full HD. `id` é a obra (filme-550 / serie-1399-T1E1): a mesma obra pode
// continuar no 4K (outro ponto do filme, mesma pessoa).
const LIVRE_PARA_4K = Number(process.env.CONVERSOES_LIVRE_4K_GB || 30) * 1024 ** 3;
function pode4k(id = '', tamanho = 0) {
    const base = String(id).replace(/^ini\d+-/, '');
    for (const t of trabalhos.values()) {
        if (!t.quatroK || t.erro) continue;
        if (String(t.lastro || '').replace(/^ini\d+-/, '') === base) continue;
        const emUso = !t.terminou || Date.now() - (t.ultimoAcesso || 0) < PARADA_SEM_USO;
        if (emUso) return false;
    }
    try {
        fs.mkdirSync(PASTA, { recursive: true });
        if (typeof fs.statfsSync === 'function') {
            const d = fs.statfsSync(PASTA);
            // Folga = tamanho do arquivo 4K + 5 GB (quando a fonte informa);
            // sem o tamanho, os 30 GB de antes.
            const precisa = Number(tamanho) > 0 ? Number(tamanho) + 5 * 1024 ** 3 : LIVRE_PARA_4K;
            if (Number(d.bavail) * Number(d.bsize) < precisa) return false;
        }
    } catch { return false; }
    return true;
}

// Conversão que já cobre o ponto `inicio` (segundos do filme) ou uma nova que
// começa nele. Devolve o resumo + `inicio` (onde o vídeo convertido começa no
// filme). Janelas: "filme-550" (desde o 0) e "ini1980-filme-550" (desde 33 min).
async function iniciarNoPonto(url, { id = '', referer = '', inicio = 0, faixa = null, quatroK = false, novo = false, legenda = null, legendaExterna = '' } = {}) {
    const ponto = Math.max(0, Math.floor(Number(inicio) || 0));
    if (novo && ponto < 60) for (const [chave, t] of trabalhos) if (t.lastro === id && !(t.terminou && t.pronto && inspecionarDisco(t.pasta)?.completo)) { try { if (t.processo && !t.terminou) t.processo.kill(); } catch { /* já saiu */ } trabalhos.delete(chave); }
    if (!id || ponto < 60) return { ...(await module.exports.iniciar(url, { id, titulo: id, referer, faixa, quatroK, legenda, legendaExterna })), inicio: 0 };
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
        // Só espera uma conversão que está andando (avançou nos últimos 20 s).
        const andando = Date.now() - (t.ultimoProgresso || t.iniciadoEm || 0) < 20000;
        const vaiChegar = !t.terminou && andando && ponto - ini <= 180;
        if ((completo && (!t.duracao || ini + (t.segundos || t.duracao) >= ponto + 15)) || alcancou || vaiChegar) {
            if (!melhor || ini > melhor.ini) melhor = { chave, ini, t };
        }
    }
    // `novo`: o player viu a conversão reaproveitada parada e pede outra.
    if (melhor && novo) {
        try { if (melhor.t.processo && !melhor.t.terminou) melhor.t.processo.kill(); } catch { /* já saiu */ }
        trabalhos.delete(melhor.chave);
        melhor = null;
    }
    // A janela nova não pode cair de volta na parada (mesmo nome de trabalho).
    if (novo) for (const [chave, t] of trabalhos) if (t.lastro === `ini${ponto}-${id}` && !(t.terminou && t.pronto && inspecionarDisco(t.pasta)?.completo)) { try { if (t.processo && !t.terminou) t.processo.kill(); } catch { /* já saiu */ } trabalhos.delete(chave); }
    if (melhor) { melhor.t.ultimoAcesso = Date.now(); return { ...resumo(melhor.chave), inicio: melhor.ini }; }
    // Janela nova: para as conversões deste filme que ninguém está vendo.
    for (const [, t] of trabalhos) {
        if (deste.test(String(t.lastro || '')) && !t.terminou && t.processo && Date.now() - (t.ultimoAcesso || 0) > 30000) {
            try { t.processo.kill(); } catch { /* já saiu */ }
        }
    }
    const resultado = await module.exports.iniciar(url, { id: `ini${ponto}-${id}`, titulo: id, referer, faixa, quatroK, legenda, legendaExterna, inicio: ponto });
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

module.exports = {
    falhouSemDados, ajustarSrt, pode4k, arrumarDisco, iniciar, iniciarNoPonto, estado, arquivoDe, caminhoDoPedaço, resumo, encerrarTudo, PASTA, identificar };
