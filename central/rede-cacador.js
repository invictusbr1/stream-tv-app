'use strict';
// Rede de descoberta: orçamento, fila curta e pausa pedida pelo fornecedor.
// O player do usuário não passa por esta fila.
const axios = require('axios');
const { hostInterno } = require('../seguranca');
const { AsyncLocalStorage } = require('async_hooks');
const contexto = new AsyncLocalStorage();

function erro(codigo, mensagem) { return Object.assign(new Error(mensagem), { code: codigo }); }
function enderecoPublico(valor) {
    let u;
    try { u = new URL(valor); } catch { throw erro('URL_INVALIDA', 'Endereço de descoberta inválido'); }
    if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || hostInterno(u.hostname)) {
        throw erro('URL_INVALIDA', 'A descoberta exige endereço público sem credenciais');
    }
    return u;
}
function esperaPedida(valor, agora = Date.now()) {
    const segundos = Number(valor);
    const ms = String(valor || '').trim() && Number.isFinite(segundos) ? segundos * 1000 : Date.parse(valor) - agora;
    return Math.max(1000, Math.min(24 * 60 * 60 * 1000, Number.isFinite(ms) && ms > 0 ? ms : 60000));
}
function checarRodada() {
    const ctx = contexto.getStore();
    if (ctx && (ctx.signal?.aborted || ctx.fim <= Date.now())) throw erro('RODADA_INTERROMPIDA', 'Rodada pausada; as descobertas serão retomadas depois');
    return ctx;
}
function sinalRodada() { return contexto.getStore()?.signal; }
function comRodada(opcoes, tarefa) { return contexto.run(opcoes, tarefa); }

function criarRede({ transporte = axios.get.bind(axios), simultaneos = 3, porDominio = 1, agora = Date.now } = {}) {
    const fila = [], ativos = new Map(), pausas = new Map();
    const contadores = { pedidos: 0, falhas: 0, pausados: 0, cancelados: 0 };
    let total = 0;
    function drenar() {
        for (let i = 0; i < fila.length && total < simultaneos;) {
            const item = fila[i];
            if ((ativos.get(item.host) || 0) >= porDominio) { i++; continue; }
            fila.splice(i, 1); total++; ativos.set(item.host, (ativos.get(item.host) || 0) + 1);
            item.iniciar().finally(() => {
                total--; const n = (ativos.get(item.host) || 1) - 1;
                if (n) ativos.set(item.host, n); else ativos.delete(item.host);
                drenar();
            });
        }
    }
    async function get(url, opcoes = {}) {
        const u = enderecoPublico(url), ctx = checarRodada();
        const pausa = pausas.get(u.hostname) || 0;
        if (pausa > agora()) { contadores.pausados++; throw erro('FORNECEDOR_EM_PAUSA', 'Fornecedor pediu uma pausa nas consultas'); }
        if (pausa) pausas.delete(u.hostname);
        if (fila.length >= 100) throw erro('FILA_REDE_CHEIA', 'Fila de consultas ocupada; tente na próxima rodada');
        const controller = new AbortController();
        const sinais = [...new Set([opcoes.signal, ctx?.signal].filter(Boolean))];
        const timeout = Math.max(1, Math.min(Number(opcoes.timeout) || 20000, ctx ? ctx.fim - Date.now() : 30000));
        return new Promise((resolve, reject) => {
            let terminou = false, item;
            const limpar = () => { clearTimeout(timer); sinais.forEach(s => s.removeEventListener('abort', cancelar)); };
            const falhar = e => { if (!terminou) { terminou = true; limpar(); reject(e); } };
            const cancelar = () => {
                const indice = fila.indexOf(item); if (indice >= 0) fila.splice(indice, 1);
                contadores.cancelados++; controller.abort(); falhar(erro('CONSULTA_CANCELADA', 'Consulta cancelada ou fora do prazo'));
            };
            const timer = setTimeout(cancelar, timeout);
            item = { host: u.hostname, iniciar: async () => {
                if (terminou) return;
                try {
                    if ((pausas.get(u.hostname) || 0) > agora()) throw erro('FORNECEDOR_EM_PAUSA', 'Fornecedor pediu uma pausa nas consultas');
                    contadores.pedidos++;
                    const response = await transporte(u.href, {
                        ...opcoes, signal: controller.signal, timeout,
                        maxContentLength: Math.min(Number(opcoes.maxContentLength) > 0 ? Number(opcoes.maxContentLength) : 4 * 1024 * 1024, 16 * 1024 * 1024),
                        maxRedirects: Math.min(Number(opcoes.maxRedirects ?? 3), 4),
                        beforeRedirect: (destino, resposta) => {
                            const proximo = enderecoPublico(destino.href || `${destino.protocol}//${destino.hostname}${destino.path || '/'}`);
                            if (proximo.hostname !== u.hostname && destino.headers) {
                                for (const nome of Object.keys(destino.headers)) if (/^(authorization|cookie)$/i.test(nome)) delete destino.headers[nome];
                            }
                            if (opcoes.beforeRedirect) opcoes.beforeRedirect(destino, resposta);
                        },
                        validateStatus: () => true,
                    });
                    if ([429, 503].includes(response.status)) {
                        pausas.set(u.hostname, agora() + esperaPedida(response.headers?.['retry-after'], agora()));
                        contadores.pausados++;
                        throw erro('FORNECEDOR_EM_PAUSA', 'Fornecedor pediu uma pausa nas consultas');
                    }
                    const aceitar = opcoes.validateStatus || (s => s >= 200 && s < 300);
                    if (!aceitar(response.status)) throw Object.assign(erro('RESPOSTA_HTTP', 'Consulta respondeu HTTP ' + response.status), { response });
                    if (!terminou) { terminou = true; limpar(); resolve(response); }
                } catch (e) { contadores.falhas++; falhar(e); }
            } };
            sinais.forEach(s => s.addEventListener('abort', cancelar, { once: true }));
            if (sinais.some(s => s.aborted)) cancelar(); else { fila.push(item); drenar(); }
        });
    }
    function resumo() {
        for (const [host, fim] of pausas) if (fim <= agora()) pausas.delete(host);
        return { ...contadores, ativas: total, aguardando: fila.length, dominiosEmPausa: pausas.size };
    }
    return { get, resumo };
}
const rede = criarRede();
module.exports = { ...rede, criarRede, enderecoPublico, esperaPedida, comRodada, checarRodada, sinalRodada };
