'use strict';
// Cada tentativa tem medições próprias. Os resumos de encerramento são neutros
// para o placar: fechar ou trocar de fonte não é uma nova falha/sucesso.
const path = require('path');
const { lerJson, gravarJson } = require('./armazenamento');

const LIMITES = Object.freeze({ sessoes: 200, tentativas: 20, historico: 12, dias: 21 });
const RESULTADOS = new Set(['abriu', 'falhou', 'fechou', 'concluiu', 'trocou']);
const TIPOS = new Set(['play', 'confirmacao', 'falha', 'reproducao']);
const TERMINAIS = new Set(['falhou', 'fechou', 'concluiu', 'trocou']);

function textoSeguro(valor, limite = 120) {
    if (typeof valor !== 'string' && typeof valor !== 'number') return '';
    return String(valor).replace(/[\u0000-\u001f]/g, ' ')
        .replace(/\b(?:https?|wss?):\/\/[^\s<>"']+/gi, '[endereço omitido]')
        .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [omitido]')
        .replace(/\b(?:token|api[_-]?key|chave|senha|password|authorization|secret)\s*[=:]\s*[^\s,;]+/gi, '[credencial omitida]')
        .trim().slice(0, limite);
}
function identificador(valor, limite = 64) {
    return typeof valor === 'string' && valor.length <= limite && /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(valor) ? valor : '';
}
function numero(valor, maximo, inteiro = false) {
    if (typeof valor !== 'number' && typeof valor !== 'string' || valor === '') return null;
    const n = Number(valor);
    if (!Number.isFinite(n) || n < 0) return null;
    const limitado = Math.min(n, maximo);
    return inteiro ? Math.floor(limitado) : Math.round(limitado * 100) / 100;
}
function normalizarEvento(corpo = {}) {
    const tentativa = Number(corpo.tentativa);
    const sessao = identificador(corpo.sessao);
    if (!sessao || !Number.isInteger(tentativa) || tentativa < 1 || tentativa > LIMITES.tentativas) return null;
    const resultado = RESULTADOS.has(corpo.resultado) ? corpo.resultado : '';
    return {
        sessao, tentativa, resultado,
        tempoAberturaMs: numero(corpo.tempoAberturaMs, 600000, true),
        posicao: numero(corpo.posicao, 86400),
        travamentos: numero(corpo.travamentos, 10000, true),
        tempoTravadoMs: numero(corpo.tempoTravadoMs, 86400000, true),
        recuperacoes: numero(corpo.recuperacoes, 20, true),
    };
}

function criarDiagnostico({ pastaDados, agora = Date.now, limites = LIMITES } = {}) {
    const arquivo = path.join(pastaDados || path.join(__dirname, 'dados'), 'reproducao.json');
    const limitesEfetivos = { ...LIMITES, ...limites };
    const salvo = lerJson(arquivo, { versao: 1, sessoes: [] }, d => d.versao === 1 && Array.isArray(d.sessoes));
    let sessoes = [];
    let persistenciaErro = '';

    function podar() {
        const corte = agora() - limitesEfetivos.dias * 86400000;
        sessoes = sessoes.filter(s => Date.parse(s.atualizadoEm) >= corte)
            .sort((a, b) => b.atualizadoEm.localeCompare(a.atualizadoEm)).slice(0, limitesEfetivos.sessoes);
    }
    function guardar() {
        podar();
        try { gravarJson(arquivo, { versao: 1, sessoes }); persistenciaErro = ''; }
        catch { persistenciaErro = 'Não foi possível gravar o diagnóstico de reprodução. Os relatos continuam disponíveis nesta execução.'; }
    }
    function registrar(evento, persistir = true) {
        if (!evento || !TIPOS.has(evento.tipo)) return null;
        const medidas = normalizarEvento(evento);
        if (!medidas || evento.tipo === 'reproducao' && !medidas.resultado) return null;
        const instante = Date.parse(evento.em);
        if (!Number.isFinite(instante) || instante > agora() + 300000 || instante < agora() - limitesEfetivos.dias * 86400000) return null;
        const em = new Date(instante).toISOString();
        const dispositivo = identificador(evento.dispositivo, 40);
        let sessao = sessoes.find(s => s.sessao === medidas.sessao && s.dispositivo === dispositivo);
        if (!sessao) {
            sessao = { sessao: medidas.sessao, dispositivo, criadoEm: em, atualizadoEm: em, tentativas: [] };
            sessoes.push(sessao);
        }
        for (const [campo, limite] of Object.entries({ nome: 60, aparelho: 40, app: 20, versao: 20, titulo: 120, id: 10, episodio: 20 })) {
            const valor = textoSeguro(evento[campo], limite);
            if (valor) sessao[campo] = valor;
        }
        sessao.atualizadoEm = em > sessao.atualizadoEm ? em : sessao.atualizadoEm;
        let tentativa = sessao.tentativas.find(t => t.tentativa === medidas.tentativa);
        if (!tentativa) {
            tentativa = { tentativa: medidas.tentativa, criadoEm: em, atualizadoEm: em, resultado: 'aguardando', tempoAberturaMs: null, posicao: null, travamentos: 0, tempoTravadoMs: 0, recuperacoes: 0, historico: [] };
            sessao.tentativas.push(tentativa);
        }
        const posterior = em >= tentativa.atualizadoEm;
        tentativa.atualizadoEm = em > tentativa.atualizadoEm ? em : tentativa.atualizadoEm;
        for (const [campo, limite] of Object.entries({ fonte: 40, resolucao: 20, audio: 20, motivo: 120 })) {
            const valor = textoSeguro(evento[campo], limite);
            if (valor && posterior) tentativa[campo] = valor;
        }
        const fonteId = identificador(evento.fonteId, 40);
        if (fonteId && posterior) tentativa.fonteId = fonteId;
        if (medidas.tempoAberturaMs !== null && tentativa.tempoAberturaMs === null) tentativa.tempoAberturaMs = medidas.tempoAberturaMs;
        if (medidas.posicao !== null && posterior) tentativa.posicao = medidas.posicao;
        for (const campo of ['travamentos', 'tempoTravadoMs', 'recuperacoes']) if (medidas[campo] !== null) tentativa[campo] = Math.max(tentativa[campo], medidas[campo]);
        const resultado = medidas.resultado || (evento.tipo === 'confirmacao' ? 'abriu' : evento.tipo === 'falha' ? 'falhou' : 'aguardando');
        // Um relato atrasado de abertura não reabre uma tentativa já finalizada.
        if (posterior && (!TERMINAIS.has(tentativa.resultado) || TERMINAIS.has(resultado))) tentativa.resultado = resultado;
        tentativa.historico.push({ em, tipo: evento.tipo, resultado, motivo: textoSeguro(evento.motivo) });
        tentativa.historico = tentativa.historico.slice(-limitesEfetivos.historico);
        sessao.tentativas.sort((a, b) => a.tentativa - b.tentativa);
        if (persistir) guardar();
        return tentativa;
    }

    // Revalida também a cópia recuperada do disco; nenhum campo extra é retido.
    for (const s of salvo.sessoes.slice(0, limitesEfetivos.sessoes)) {
        if (!s || !Array.isArray(s.tentativas)) continue;
        for (const t of s.tentativas.slice(0, limitesEfetivos.tentativas)) {
            if (!t) continue;
            const resultado = RESULTADOS.has(t.resultado) ? t.resultado : '';
            const restaurada = registrar({ ...s, ...t, sessao: s.sessao, dispositivo: s.dispositivo, em: t.atualizadoEm || s.atualizadoEm, tipo: resultado ? 'reproducao' : 'play', resultado }, false);
            if (!restaurada) continue;
            if (Number.isFinite(Date.parse(t.criadoEm)) && t.criadoEm <= restaurada.atualizadoEm) restaurada.criadoEm = new Date(t.criadoEm).toISOString();
            restaurada.historico = (Array.isArray(t.historico) ? t.historico : []).filter(h => h && TIPOS.has(h.tipo) && Number.isFinite(Date.parse(h.em)))
                .slice(-limitesEfetivos.historico).map(h => ({ em: new Date(h.em).toISOString(), tipo: h.tipo, resultado: RESULTADOS.has(h.resultado) ? h.resultado : 'aguardando', motivo: textoSeguro(h.motivo) }));
            const restauradaSessao = sessoes.find(item => item.sessao === s.sessao && item.dispositivo === identificador(s.dispositivo, 40));
            if (restauradaSessao && Number.isFinite(Date.parse(s.criadoEm)) && s.criadoEm <= restauradaSessao.atualizadoEm) restauradaSessao.criadoEm = new Date(s.criadoEm).toISOString();
        }
    }
    podar();
    function resumo(limite = 30) {
        podar();
        const lista = sessoes.slice(0, Math.min(200, Math.max(1, Number(limite) || 30))).map(s => ({
            ...s,
            resultado: s.tentativas.at(-1)?.resultado || 'aguardando',
            travamentos: s.tentativas.reduce((n, t) => n + t.travamentos, 0),
            tempoTravadoMs: s.tentativas.reduce((n, t) => n + t.tempoTravadoMs, 0),
            recuperacoes: Math.max(0, ...s.tentativas.map(t => t.recuperacoes)),
            tentativas: s.tentativas.map(t => ({ ...t, historico: t.historico.map(h => ({ ...h })) })),
        }));
        return { total: sessoes.length, sessoes: lista, persistenciaErro, limites: { ...limitesEfetivos } };
    }
    return { registrar, resumo };
}
module.exports = { criarDiagnostico, normalizarEvento, textoSeguro, identificador, LIMITES, RESULTADOS };
