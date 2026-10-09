'use strict';
// Vigia das fontes — o robô que fica trabalhando 24 horas.
//
// A cada rodada ele pega alguns filmes do catálogo (em rodízio, sempre
// avançando) e faz exatamente o que o aplicativo faz quando alguém clica:
// resolve as fontes, confere se elas entregam vídeo e mede a qualidade.
//
// O que ele aprende vira SAÚDE das fontes (arquivo do motor) e relatório na
// central. Como o motor e o avaliador leem essa saúde, a correção é automática:
// a fonte quebrada sai da frente sozinha e volta quando melhorar.

const fs = require('fs');
const path = require('path');
const axios = require('axios');

const INTERVALO = Number(process.env.VIGIA_INTERVALO_MS || 8 * 60 * 1000);
const POR_RODADA = Number(process.env.VIGIA_POR_RODADA || 3);
const PASTA = path.join(__dirname, 'relatorios');
const ARQUIVO = path.join(PASTA, 'vigia-fontes.json');

const estado = {
    ligado: false,
    rodando: false,
    rodadas: 0,
    ultimaRodada: 0,
    proximaRodada: 0,
    titulos: [],
    cursor: 0,
    semFonte: [],
    ultimoResumo: null,
    historico: [],
};

function gravar() {
    try {
        fs.mkdirSync(PASTA, { recursive: true });
        fs.writeFileSync(ARQUIVO, JSON.stringify(estado, null, 1));
    } catch { /* sem permissão: segue só na memória */ }
}

// Lista de títulos para testar: os populares do momento + os que já falharam.
async function montarLista(tmdbKey) {
    const achados = new Map();
    const enderecos = [
        `https://api.themoviedb.org/3/movie/popular?api_key=${tmdbKey}&language=pt-BR&page=1`,
        `https://api.themoviedb.org/3/movie/popular?api_key=${tmdbKey}&language=pt-BR&page=2`,
        `https://api.themoviedb.org/3/trending/movie/day?api_key=${tmdbKey}&language=pt-BR`,
        // Séries também entram na fila: é o caso das turcas/novidades, que
        // aparecem nas fontes semanas depois do lançamento.
        `https://api.themoviedb.org/3/tv/popular?api_key=${tmdbKey}&language=pt-BR&page=1`,
        `https://api.themoviedb.org/3/trending/tv/day?api_key=${tmdbKey}&language=pt-BR`,
        // Lançamentos turcos: é o caso da série que o usuário pediu — novelas
        // turcas entram nas fontes brasileiras semanas depois do lançamento.
        `https://api.themoviedb.org/3/discover/tv?api_key=${tmdbKey}&language=pt-BR&with_origin_country=TR&sort_by=popularity.desc&page=1`,
    ];
    for (const endereco of enderecos) {
        try {
            const r = await axios.get(endereco, { timeout: 20000 });
            for (const item of (r.data && r.data.results) || []) {
                if (!item || !item.id) continue;
                const serie = !item.title && Boolean(item.name);
                achados.set(String(item.id), {
                    id: String(item.id),
                    titulo: String(item.title || item.name || ''),
                    tipo: serie ? 'tv' : 'movie',
                });
            }
        } catch { /* tenta o próximo */ }
    }
    // Títulos que já deram problema entram na frente (precisam de atenção).
    try {
        const problemas = JSON.parse(fs.readFileSync(path.join(PASTA, 'vigia-fontes.json'), 'utf8'));
        for (const item of estado.semFonte || []) if (item && item.id) achados.set(String(item.id), { id: String(item.id), titulo: String(item.titulo || ''), tipo: item.tipo || 'movie' });
    } catch { /* primeiro uso */ }
    return [...achados.values()];
}

function alvoDe(titulo) {
    return titulo.tipo === 'tv'
        ? { tipo: 'tv', tmdbId: String(titulo.id), temporada: '1', episodio: '1' }
        : { tipo: 'movie', tmdbId: String(titulo.id) };
}

async function rodarRodada({ tmdbKey, registrar = () => {}, reportar = () => {} }) {
    if (estado.rodando) return { rodando: true };
    estado.rodando = true;
    try {
        if (!estado.titulos.length) {
            estado.titulos = await montarLista(tmdbKey);
            registrar(`lista do vigia pronta: ${estado.titulos.length} títulos`);
        }
        if (!estado.titulos.length) return { rodando: false, testados: 0 };

        const avaliar = require('./avaliador');
        const motor = require('./fontes-motor');
        const escolhidos = [];
        for (let i = 0; i < POR_RODADA && i < estado.titulos.length; i++) {
            escolhidos.push(estado.titulos[(estado.cursor + i) % estado.titulos.length]);
        }
        estado.cursor = (estado.cursor + escolhidos.length) % Math.max(1, estado.titulos.length);

        const resultados = [];
        for (const titulo of escolhidos) {
            const alvo = alvoDe(titulo);
            let resultado = null;
            try {
                resultado = await avaliar.escolherMelhor('dublado', alvo, { semCache: true }).catch(() => null);
            } catch { resultado = null; }
            const linhas = resultado && resultado.avaliacao ? resultado.avaliacao.map(a => ({
                fonte: a.fonteId,
                nota: a.nota,
                idioma: a.detalhes && a.detalhes.idioma,
                qualidade: a.detalhes && a.detalhes.qualidade,
            })) : [];
            const semDublado = !resultado;
            let apenasOriginal = false;
            if (semDublado) {
                // Sem fonte dublada: confere se existe a versão em alta
                // definição (som original + legenda) para o app já oferecer.
                try {
                    const hd = await motor.escolher('hd', alvo, {}).catch(() => null);
                    apenasOriginal = Boolean(hd && hd.url);
                } catch { apenasOriginal = false; }
            }
            resultados.push({
                id: titulo.id,
                titulo: titulo.titulo,
                tipo: titulo.tipo || 'movie',
                ok: Boolean(resultado && resultado.escolhido && resultado.escolhido.url),
                fonte: resultado ? resultado.escolhido.fonteId : '',
                fontesTestadas: linhas,
                semDublado,
                apenasOriginal,
            });
            // Guarda quem ficou sem fonte: esses títulos voltam na frente das
            // próximas rodadas (é assim que a novidade aparece quando sai).
            const registrado = estado.semFonte.find(item => item.id === titulo.id);
            if (semDublado) {
                if (!registrado) estado.semFonte.push({ id: titulo.id, titulo: titulo.titulo, tipo: titulo.tipo || 'movie', desde: new Date().toISOString() });
            } else if (registrado) {
                estado.semFonte = estado.semFonte.filter(item => item.id !== titulo.id);
            }
            registrar(resultado
                ? `"${titulo.titulo}": abriu com ${resultado.escolhido.fonteId}`
                : `"${titulo.titulo}": nenhuma fonte dublada respondeu${apenasOriginal ? ' (tem versão em HD com legenda)' : ''}`);
        }

        const saudaveis = motor.estado();
        const resumo = {
            em: new Date().toISOString(),
            testados: resultados.length,
            abriram: resultados.filter(r => r.ok).length,
            resultados,
            fontes: saudaveis.map(f => ({ id: f.id, acertos: f.acertos, falhas: f.falhas, falhasSeguidas: f.falhasSeguidas, castigada: f.castigada, ultimoMotivo: f.ultimoMotivo })),
        };
        estado.rodadas += 1;
        estado.ultimaRodada = Date.now();
        estado.ultimoResumo = resumo;
        estado.historico = [resumo, ...estado.historico].slice(0, 40);
        gravar();

        const resumoCurto = `vigia: ${resumo.abriram}/${resumo.testados} abriram · ` +
            resumo.fontes.filter(f => f.castigada).map(f => f.id + ' de castigo').join(', ');
        reportar({ tipo: 'vigia', nome: 'Vigia das fontes', aparelho: 'servidor', motivo: resumoCurto.slice(0, 118), versao: '' }).catch(() => {});
        return resumo;
    } finally {
        estado.rodando = false;
    }
}

function iniciar({ tmdbKey, registrar = () => {}, reportar = () => {} }) {
    if (estado.ligado || !tmdbKey) return;
    estado.ligado = true;
    const comecar = () => rodarRodada({ tmdbKey, registrar, reportar }).catch(() => {});
    setTimeout(comecar, 60 * 1000);                       // primeira rodada depois de 1 minuto
    setInterval(comecar, Math.max(60 * 1000, INTERVALO));
    registrar('vigia das fontes ligado (testa filmes em rodízio 24h)');
}

function resumo() {
    return {
        ligado: estado.ligado,
        rodando: estado.rodando,
        rodadas: estado.rodadas,
        ultimaRodada: estado.ultimaRodada,
        proximaRodada: estado.ultimaRodada ? estado.ultimaRodada + INTERVALO : 0,
        titulos: estado.titulos.length,
        cursor: estado.cursor,
        ultimoResumo: estado.ultimoResumo,
    };
}

module.exports = { iniciar, rodarRodada, resumo, estado, INTERVALO, POR_RODADA };
