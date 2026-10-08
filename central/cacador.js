'use strict';
// Caçador de fornecedores da central.
//
// Ele testa cada fonte de verdade (usando o mesmo motor do aplicativo) em uma
// amostra de títulos e dá uma NOTA DE 0 A 10 seguindo as regras do projeto:
//
//   dublado (3,0) + sem anúncio (2,0) + qualidade HD/Full HD (2,0)
//   + sucesso nas amostras (2,0) + velocidade (1,0)
//
// Também testa candidatas de fora (sites conhecidos) e diz por que cada uma
// entra ou não entra na lista.

const fs = require('fs');
const path = require('path');
const motor = require('../fontes-motor');

const AMOSTRAS = [
    { tipo: 'movie', id: '27205', titulo: 'A Origem' },
    { tipo: 'movie', id: '1523145', titulo: 'Coração Partido' },
    { tipo: 'tv', id: '1399', temporada: '1', episodio: '1', titulo: 'Game of Thrones 1x1' },
    { tipo: 'tv', id: '76479', temporada: '1', episodio: '1', titulo: 'The Boys 1x1' }
];

// Sites que já passaram pela avaliação. O caçador reconfere se continuam fora.
const CANDIDATAS = [
    { nome: 'VidLink', url: 'https://vidlink.pro/movie/27205', motivoEsperado: 'só áudio original' },
    { nome: 'SuperFlix', url: 'https://superflixapi.monster/filme/27205', motivoEsperado: 'verificação e anúncio' },
    { nome: 'StreamBetter', url: 'https://streambetter.shop/filme/27205', motivoEsperado: 'verificação e anúncio' },
    { nome: 'NetMirror', url: 'https://net27.cc/', motivoEsperado: 'sem faixa dublada em português' },
    { nome: 'RedeCanais', url: 'https://redecanais20.lat/', motivoEsperado: 'player só abre com navegador' },
    { nome: '4KHDHub', url: 'https://4khdhub.one/', motivoEsperado: 'sem dublado em português' }
];

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const TEMPO = 20000;

function comPrazo(promessa, ms) {
    return Promise.race([promessa, new Promise(resolve => setTimeout(() => resolve({ __tempo: true }), ms))]);
}

function ehDublado(valor) {
    const texto = String(valor || '').toLowerCase();
    return /pt-br|ptbr|portugu|dubl/.test(texto);
}

function alturaDe(valor) {
    const achado = String(valor || '').match(/(\d{3,4})p?/);
    return achado ? Number(achado[1]) : 0;
}

// ---------------------------------------------------------------- fontes do aplicativo
async function testarFonte(fonte, amostra) {
    if (fonte.seAplica && !fonte.seAplica(amostra)) return null;
    const inicio = Date.now();
    let dados = null;
    try {
        const alvo = amostra.tipo === 'tv'
            ? { tipo: 'tv', tmdbId: amostra.id, temporada: amostra.temporada, episodio: amostra.episodio }
            : { tipo: 'movie', tmdbId: amostra.id };
        dados = await comPrazo(fonte.resolver(alvo), TEMPO);
    } catch { dados = null; }
    const ms = Date.now() - inicio;
    if (!dados || dados.__tempo || !dados.url) return { ok: false, ms, amostra: amostra.titulo };
    return {
        ok: true,
        ms,
        amostra: amostra.titulo,
        audio: dados.audio || '',
        dublado: ehDublado(dados.audio) || ehDublado(dados.fonte),
        resolucao: dados.resolucao || '',
        altura: alturaDe(dados.resolucao),
        tipo: dados.type || 'hls'
    };
}

function notaDoFornecedor(medidas) {
    if (!medidas.length) return { nota: 0, detalhes: {} };
    const sucesso = medidas.filter(m => m.ok);
    const taxa = sucesso.length / medidas.length;
    const dubladas = sucesso.filter(m => m.dublado).length;
    const taxaDublado = sucesso.length ? dubladas / sucesso.length : 0;
    const melhorAltura = Math.max(0, ...sucesso.map(m => m.altura || 0));
    const latencia = sucesso.length ? Math.round(sucesso.reduce((soma, m) => soma + m.ms, 0) / sucesso.length) : 0;

    const pSucesso = taxa * 2;                                              // 0 a 2
    const pDublado = taxaDublado * 3;                                       // 0 a 3
    const pSemAnuncio = 2;                                                  // só entra quem o app resolve sozinho
    const pQualidade = melhorAltura >= 1080 ? 2 : melhorAltura >= 720 ? 1.4 : melhorAltura > 0 ? 0.6 : 0;
    const pVelocidade = latencia && latencia <= 3000 ? 1 : latencia <= 8000 ? 0.6 : 0.3;

    const nota = Math.max(0, Math.min(10, pSucesso + pDublado + pSemAnuncio + pQualidade + pVelocidade));
    return {
        nota: Math.round(nota * 10) / 10,
        detalhes: {
            testes: medidas.length,
            sucessos: sucesso.length,
            taxaSucesso: Math.round(taxa * 100),
            dublados: dubladas,
            melhorQualidade: melhorAltura ? melhorAltura + 'p' : '—',
            latenciaMedia: latencia,
            pontos: {
                sucesso: Math.round(pSucesso * 10) / 10,
                dublado: Math.round(pDublado * 10) / 10,
                semAnuncio: pSemAnuncio,
                qualidade: Math.round(pQualidade * 10) / 10,
                velocidade: Math.round(pVelocidade * 10) / 10
            }
        }
    };
}

// ---------------------------------------------------------------- candidatas de fora
async function conferirCandidata(candidata) {
    try {
        const resposta = await fetch(candidata.url, {
            headers: { 'User-Agent': UA, 'Accept-Language': 'pt-BR,pt;q=0.9' },
            redirect: 'follow',
            signal: AbortSignal.timeout(12000)
        });
        const corpo = await resposta.text().catch(() => '');
        const verificacao = /turnstile|hcaptcha|recaptcha|não sou robô|nao sou robo|just a moment|checking your browser/i.test(corpo);
        const anuncio = /popads|popcash|adsterra|propellerads|googlesyndication|adsbygoogle|monetag|clickadu/i.test(corpo);
        const vazio = corpo.length < 800;
        let situacao = 'candidata';
        let motivo = 'não avaliada a fundo';
        if (verificacao) { situacao = 'descartada'; motivo = 'pede verificação no navegador (e traz anúncio)'; }
        else if (anuncio) { situacao = 'descartada'; motivo = 'página com anúncio; o app não teria como abrir limpo'; }
        else if (vazio) { situacao = 'descartada'; motivo = 'página vazia ou bloqueada'; }
        else if (/dublad|portugu/i.test(corpo)) { situacao = 'em análise'; motivo = 'cita dublado, mas o vídeo não é entregue direto ao app'; }
        else { situacao = 'descartada'; motivo = candidata.motivoEsperado; }
        return { nome: candidata.nome, url: candidata.url, status: resposta.status, situacao, motivo, esperado: candidata.motivoEsperado };
    } catch (erro) {
        return { nome: candidata.nome, url: candidata.url, status: 0, situacao: 'descartada', motivo: 'sem resposta (' + (erro.name === 'TimeoutError' ? 'demorou demais' : erro.message.slice(0, 40)) + ')', esperado: candidata.motivoEsperado };
    }
}

// ---------------------------------------------------------------- execução
function criarCacador(opcoes = {}) {
    const pastaDados = opcoes.pastaDados;
    const arquivo = path.join(pastaDados, 'fontes.json');
    let rodando = false;

    async function cacar() {
        if (rodando) return { rodando: true };
        rodando = true;
        try {
            // Cada fonte é testada em todos os títulos da amostra, uma por vez,
            // para não confundir lentidão com fonte ruim.
            const resultados = [];
            for (const fonte of motor.FONTES) {
                const medidas = [];
                for (const amostra of AMOSTRAS) {
                    const medida = await testarFonte(fonte, amostra).catch(() => null);
                    if (medida) medidas.push(medida);
                }
                const { nota, detalhes } = notaDoFornecedor(medidas);
                resultados.push({ id: fonte.id, nome: fonte.nome, papel: fonte.papel, nota, detalhes, medidas });
            }
            resultados.sort((a, b) => b.nota - a.nota);

            const candidatas = [];
            for (const candidata of CANDIDATAS) candidatas.push(await conferirCandidata(candidata));

            const saida = {
                atualizadoEm: new Date().toISOString(),
                amostras: AMOSTRAS.map(a => a.titulo),
                regra: 'dublado (3) + sem anúncio (2) + qualidade HD/Full HD (2) + sucesso (2) + velocidade (1)',
                ranking: resultados,
                candidatas
            };
            fs.mkdirSync(pastaDados, { recursive: true });
            fs.writeFileSync(arquivo, JSON.stringify(saida, null, 1));
            return saida;
        } finally { rodando = false; }
    }

    function ultimo() {
        try { return JSON.parse(fs.readFileSync(arquivo, 'utf8')); } catch { return null; }
    }

    return { cacar, ultimo, rodando: () => rodando };
}

module.exports = { criarCacador, notaDoFornecedor, AMOSTRAS };
