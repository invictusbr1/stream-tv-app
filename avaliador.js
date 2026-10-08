'use strict';
// Avaliador de qualidade em tempo real.
//
// Antes de tocar, o aplicativo pergunta às melhores fontes daquele título —
// EM PARALELO — o que cada uma entrega de verdade, e escolhe a melhor segundo
// as regras do projeto:
//
//     dublado (de preferência CONFIRMADO pela central)   peso maior
//   + sem anúncio (todas as fontes internas são limpas; a sonda confirma)
//   + qualidade HD/Full HD medida (altura + taxa de bits)
//   + velocidade (quanto tempo a fonte demora para responder)
//
// A decisão tem prazo curto: se a checagem passar do orçamento, toca o que já
// respondeu (nunca deixamos quem assiste esperando).

const axios = require('axios');
const motor = require('./fontes-motor');
const midia = require('./midia-proxy');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const MAX_FONTES = 3;              // quantas fontes entram na disputa
const TEMPO_RESOLVER = 7000;       // limite por fonte
const TEMPO_SONDAR = 4000;         // limite por sonda
const ORCAMENTO = 6000;            // prazo total da pré-checagem
const VALIDADE = 10 * 60 * 1000;   // quanto tempo a decisão fica lembrada

const cache = new Map();

const prazo = (promessa, ms, padrao = null) => Promise.race([
    Promise.resolve(promessa).catch(() => padrao),
    new Promise(resolve => setTimeout(() => resolve(padrao), ms)),
]);

// ---------------------------------------------------------------- sondagens
// Lê a lista mestre do HLS: melhor formato, idiomas de áudio e legendas.
function analisarPlaylist(texto) {
    const linhas = String(texto || '').split('\n').map(l => l.trim());
    let altura = 0, banda = 0, mestre = false;
    const audios = [], legendas = [];
    for (const linha of linhas) {
        if (linha.startsWith('#EXT-X-STREAM-INF')) {
            mestre = true;
            const a = Number((linha.match(/RESOLUTION=\d+x(\d+)/i) || [])[1] || 0);
            const b = Number((linha.match(/BANDWIDTH=(\d+)/i) || [])[1] || 0);
            if (a > altura) altura = a;
            if (b > banda) banda = b;
        } else if (linha.startsWith('#EXT-X-MEDIA:TYPE=AUDIO')) {
            audios.push({
                lang: ((linha.match(/LANGUAGE="([^"]+)"/i) || [])[1] || '').toLowerCase(),
                name: (linha.match(/NAME="([^"]+)"/i) || [])[1] || '',
            });
        } else if (linha.startsWith('#EXT-X-MEDIA:TYPE=SUBTITLES')) {
            const lang = ((linha.match(/LANGUAGE="([^"]+)"/i) || [])[1] || '').toLowerCase();
            if (lang && !legendas.includes(lang)) legendas.push(lang);
        }
    }
    return { mestre, altura, banda, audios, legendas };
}

async function sondarLista(url, referer) {
    const cabecalhos = { 'User-Agent': UA, Accept: '*/*' };
    const referencia = referer || midia.refererPadrao(new URL(url).hostname);
    if (referencia) cabecalhos.Referer = referencia;
    const resposta = await axios.get(url, { headers: cabecalhos, timeout: TEMPO_SONDAR, responseType: 'text', maxContentLength: 1024 * 1024 });
    return analisarPlaylist(String(resposta.data || ''));
}

async function sondarArquivo(url, referer) {
    const central = require('./central/verificar-midia');
    const faixas = await central.faixasDeAudio(url, referer || '');
    if (!faixas) return null;
    const portuguesa = faixas.faixas.find(f => /^pt|por/.test(f.idioma));
    return {
        mestre: false,
        altura: faixas.imagem ? faixas.imagem.altura : 0,
        banda: 0,
        audios: faixas.faixas.map(f => ({ lang: f.idioma, name: f.codec, padrao: f.padrao })),
        legendas: [],
        portuguesa: Boolean(portuguesa),
        padraoPortugues: Boolean(portuguesa && portuguesa.padrao),
    };
}

// Sonda o que a fonte realmente entrega (lista ou arquivo).
async function sondar(dados) {
    if (!dados || !dados.url) return null;
    if (dados.converter) return { conversao: true, altura: Number(String(dados.resolucao || '').replace(/\D/g, '')) || 0, banda: 0, audios: [], legendas: [] };
    const ehLista = /\.m3u8(\?|$)/i.test(dados.url);
    try {
        return ehLista ? await sondarLista(dados.url, dados.referer) : await sondarArquivo(dados.url, dados.referer);
    } catch { return null; }
}

// ---------------------------------------------------------------- nota
// A régua: dublado (confirmado vale mais) + qualidade medida + velocidade.
function notaDaFonte(medida) {
    const { dados, sonda, idiomaVerificado, ms } = medida;
    const detalhes = {};
    let nota = 0;

    // 1) Idiomas — a regra número um. Vale a MELHOR prova disponível:
    //    ouvir da central > faixa padrão do arquivo > faixa existir > aviso da fonte.
    if (idiomaVerificado === 'outro') { nota -= 6; detalhes.idioma = 'a central ouviu outro idioma'; }
    else if (idiomaVerificado === 'pt') { nota += 3; detalhes.idioma = 'português confirmado pela central'; }
    else if (sonda && sonda.padraoPortugues) { nota += 2.5; detalhes.idioma = 'faixa em português é a padrão do arquivo'; }
    else if (sonda && sonda.portuguesa) { nota += 2.2; detalhes.idioma = 'o arquivo tem faixa em português'; }
    else if (sonda && sonda.audios && sonda.audios.some(a => /^pt|por/.test(a.lang || ''))) { nota += 2.2; detalhes.idioma = 'lista com faixa em português'; }
    else if (dados.audio === 'pt-BR') { nota += 2; detalhes.idioma = 'a fonte informa dublado'; }
    else if (dados.audio === 'original') { detalhes.idioma = 'som original (com legenda)'; }
    else { detalhes.idioma = 'idioma não informado'; }

    // 2) Qualidade — medida quando possível; senão, a informada pela fonte.
    const alturaMedida = sonda && sonda.altura ? sonda.altura : 0;
    const alturaInformada = Number(String(dados.resolucao || '').replace(/\D/g, '')) || 0;
    const altura = Math.max(alturaMedida, alturaInformada);
    if (altura >= 1080) { nota += 2; detalhes.qualidade = altura + 'p medido'; }
    else if (altura >= 720) { nota += 1.5; detalhes.qualidade = altura + 'p'; }
    else if (altura >= 480) { nota += 0.6; detalhes.qualidade = altura + 'p'; }
    else { nota += 0.4; detalhes.qualidade = 'não mediu a altura'; }

    // 3) Taxa de bits (quando a lista informa).
    const banda = (sonda && sonda.banda) || 0;
    if (banda >= 4000000) { nota += 0.5; detalhes.taxa = (banda / 1e6).toFixed(1) + ' Mbps'; }
    else if (banda >= 2000000) { nota += 0.3; detalhes.taxa = (banda / 1e6).toFixed(1) + ' Mbps'; }
    else if (banda >= 1000000) { nota += 0.15; detalhes.taxa = (banda / 1e6).toFixed(1) + ' Mbps'; }

    // 4) Velocidade de resposta.
    if (ms <= 1500) { nota += 1; detalhes.velocidade = 'rápida'; }
    else if (ms <= 3000) { nota += 0.7; detalhes.velocidade = 'boa'; }
    else if (ms <= 6000) { nota += 0.4; detalhes.velocidade = 'normal'; }
    else { nota += 0.2; detalhes.velocidade = 'lenta'; }

    // 5) Conversão é útil, mas custa: só vence se a qualidade compensar.
    if (dados.converter) { nota -= 0.4; detalhes.conversao = 'precisa converter o áudio (o vídeo é copiado)'; }

    return { nota: Math.round(nota * 100) / 100, detalhes };
}

// ---------------------------------------------------------------- escolha
async function escolherMelhor(papel, alvo, opcoes = {}) {
    const inicio = Date.now();
    const chave = `${papel}:${motor.chaveDoTitulo(alvo)}:${(opcoes.exceto || []).join(',')}`;
    const guardado = cache.get(chave);
    if (guardado && guardado.expira > Date.now() && !opcoes.semCache) return { ...guardado.resultado, cache: true };

    const fila = motor.filaDeFontes(papel, alvo, { exceto: opcoes.exceto || [] }).slice(0, opcoes.maxFontes || MAX_FONTES);
    if (!fila.length) return null;

    // Resolve todas em paralelo — a primeira que responder já garante a reserva.
    const resolvidas = (await Promise.all(fila.map(async fonte => {
        const comeco = Date.now();
        const dados = await prazo(fonte.resolver(alvo), TEMPO_RESOLVER);
        if (!dados || !dados.url) return null;
        return { fonte, dados, ms: Date.now() - comeco };
    }))).filter(Boolean);
    if (!resolvidas.length) return null;

    const idiomas = motor.lerIdiomasVerificados()[motor.chaveDoTitulo(alvo)] || {};
    // Sondagens em paralelo, dentro do orçamento total da checagem.
    const sondas = await prazo(
        Promise.all(resolvidas.map(item => prazo(sondar({ url: item.dados.url, referer: item.dados.referer, converter: item.dados.converter, resolucao: item.dados.resolucao }), TEMPO_SONDAR))),
        Math.max(1200, ORCAMENTO - (Date.now() - inicio)),
        null);
    const lista = sondas || resolvidas.map(() => null);

    const avaliacoes = resolvidas.map((item, i) => {
        const { nota, detalhes } = notaDaFonte({
            dados: item.dados, sonda: lista[i], idiomaVerificado: idiomas[item.fonte.id] || '', ms: item.ms,
        });
        return { fonteId: item.fonte.id, fonte: item.dados.fonte || item.fonte.nome, nota, detalhes, dados: item.dados, ms: item.ms };
    }).sort((a, b) => b.nota - a.nota || a.ms - b.ms);

    const melhor = avaliacoes[0];
    const escolhido = { ...melhor.dados, fonteId: melhor.fonteId };
    motor.registrarSucesso(melhor.fonteId);
    motor.anotarEscolha(papel, alvo, escolhido);
    const resultado = { escolhido, avaliacao: avaliacoes.map(({ dados, ...resto }) => resto), tempoMs: Date.now() - inicio };
    cache.set(chave, { resultado, expira: Date.now() + VALIDADE });
    return resultado;
}

function limparCache() { cache.clear(); }

module.exports = { escolherMelhor, sondar, sondarLista, sondarArquivo, analisarPlaylist, notaDaFonte, limparCache, MAX_FONTES, ORCAMENTO };
