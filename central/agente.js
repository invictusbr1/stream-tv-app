'use strict';
// Agente de investigação da central.
//
// Quando um player não abre, o aplicativo conta para a central. Este agente
// pega o caso, testa as fontes uma a uma (pelas rotas do próprio aplicativo) e
// anota qual funcionou — sem mexer em nada na estrutura do aplicativo.
//
// Regras do agente:
//   - investiga o título que falhou (filme ou episódio);
//   - tenta de novo a cada 10 minutos, até 6 vezes ou até achar solução;
//   - guarda o resultado: por qual fonte abriu, em que áudio e qualidade;
//   - nunca bloqueia o aplicativo: se a central estiver fora, nada muda.

const fs = require('fs');
const path = require('path');

const INTERVALO = 10 * 60 * 1000; // espera entre tentativas do mesmo caso
const MAX_TENTATIVAS = 6;
const TEMPO_LIMITE = 45000;       // desiste de um teste depois disso

function criarAgente(opcoes = {}) {
    const pastaDados = opcoes.pastaDados;
    const appUrl = String(opcoes.appUrl || 'http://127.0.0.1:3000').replace(/\/$/, '');
    const codigoApp = String(opcoes.codigoApp || '').trim();
    const arquivoCasos = path.join(pastaDados, 'investigacoes.json');
    let token = '';
    let casos = {};
    let rodando = false;

    try { casos = JSON.parse(fs.readFileSync(arquivoCasos, 'utf8')) || {}; } catch { casos = {}; }
    function gravar() { try { fs.mkdirSync(pastaDados, { recursive: true }); fs.writeFileSync(arquivoCasos, JSON.stringify(casos, null, 1)); } catch { /* sem disco */ } }

    function chaveDe(alvo) {
        return alvo.tipo === 'tv'
            ? `tv:${alvo.id}:${alvo.temporada}:${alvo.episodio}`
            : `movie:${alvo.id}`;
    }

    // O aplicativo é privado: o agente entra com o código e guarda o crachá.
    async function garantirToken() {
        if (token) return token;
        if (!codigoApp) return '';
        try {
            const resposta = await fetch(`${appUrl}/api/entrar`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ nome: 'Agente da central', dispositivo: 'central-agente', codigo: codigoApp }),
                signal: AbortSignal.timeout(10000)
            });
            if (!resposta.ok) return '';
            const dados = await resposta.json();
            token = String(dados.token || '');
            return token;
        } catch { return ''; }
    }

    async function pedir(caminho) {
        const cracha = await garantirToken();
        const cabecalhos = cracha ? { 'X-Acesso': cracha } : {};
        const resposta = await fetch(appUrl + caminho, { headers: cabecalhos, signal: AbortSignal.timeout(TEMPO_LIMITE) });
        if (resposta.status === 401 && cracha) { token = ''; const novo = await garantirToken(); if (novo) return pedir(caminho); }
        if (!resposta.ok) return null;
        return resposta.json().catch(() => null);
    }

    // Tenta o caminho dublado e, se não houver, a alta definição.
    async function testarFontes(alvo) {
        const tentativas = [];
        const inicio = Date.now();
        const dublado = alvo.tipo === 'tv'
            ? `/api/playback/serie/${alvo.id}/${alvo.temporada}/${alvo.episodio}`
            : `/api/playback/${alvo.id}`;
        const dadosDublado = await pedir(dublado).catch(() => null);
        tentativas.push({
            caminho: 'dublado',
            ok: Boolean(dadosDublado && dadosDublado.url),
            fonte: dadosDublado?.source || '',
            audio: dadosDublado?.audio || '',
            resolucao: dadosDublado?.resolucao || '',
            tipo: dadosDublado?.type || ''
        });
        if (tentativas[0].ok) return { ok: true, ms: Date.now() - inicio, escolhida: tentativas[0], tentativas };

        const consulta = alvo.tipo === 'tv'
            ? `/api/stream-hd?tipo=tv&id=${alvo.id}&season=${alvo.temporada}&episode=${alvo.episodio}`
            : `/api/stream-hd?tipo=movie&id=${alvo.id}`;
        const dadosHd = await pedir(consulta).catch(() => null);
        tentativas.push({
            caminho: 'alta definição',
            ok: Boolean(dadosHd && dadosHd.ok && (dadosHd.url || dadosHd.urlAplicativo)),
            fonte: dadosHd?.fonte || '',
            audio: 'original',
            resolucao: dadosHd?.qualidade || '',
            legendas: Array.isArray(dadosHd?.legendas) ? dadosHd.legendas.length : 0
        });
        if (tentativas[1].ok) return { ok: true, ms: Date.now() - inicio, escolhida: tentativas[1], tentativas };
        return { ok: false, ms: Date.now() - inicio, escolhida: null, tentativas };
    }

    async function investigar(alvo, motivo = '') {
        const chave = chaveDe(alvo);
        const caso = casos[chave] || {
            chave, alvo, titulo: alvo.titulo || '', motivo, tentativas: 0, estado: 'pendente',
            criadoEm: new Date().toISOString(), historico: []
        };
        caso.tentativas += 1;
        caso.ultimaTentativa = new Date().toISOString();
        caso.motivo = motivo || caso.motivo;
        const resultado = await testarFontes(alvo);
        caso.historico = [...(caso.historico || []).slice(-5), { em: caso.ultimaTentativa, ok: resultado.ok, ms: resultado.ms, tentativas: resultado.tentativas }];
        if (resultado.ok) {
            caso.estado = 'resolvido';
            caso.solucao = {
                fonte: resultado.escolhida.fonte || resultado.escolhida.caminho,
                caminho: resultado.escolhida.caminho,
                audio: resultado.escolhida.audio,
                resolucao: resultado.escolhida.resolucao,
                ms: resultado.ms
            };
        } else if (caso.tentativas >= MAX_TENTATIVAS) {
            caso.estado = 'sem solucao';
        }
        casos[chave] = caso;
        gravar();
        return caso;
    }

    // Chamado quando chega um relato de erro do aplicativo.
    function registrarFalha(evento = {}) {
        const id = String(evento.id || '').trim();
        if (!/^\d{1,10}$/.test(id)) return null;
        const alvo = {
            tipo: evento.episodio ? 'tv' : 'movie',
            id,
            titulo: String(evento.titulo || '').slice(0, 120),
            temporada: String(evento.temporada || '1').slice(0, 3),
            episodio: String(evento.numero || evento.episodio || '').replace(/\D/g, '').slice(0, 4)
        };
        if (alvo.tipo === 'tv' && !/^[1-9]\d{0,3}$/.test(alvo.episodio)) return null;
        const chave = chaveDe(alvo);
        if (casos[chave] && casos[chave].estado === 'resolvido') return casos[chave];
        casos[chave] = {
            chave, alvo, titulo: alvo.titulo, motivo: String(evento.motivo || 'player não abriu').slice(0, 120),
            tentativas: 0, estado: 'pendente', criadoEm: new Date().toISOString(), historico: []
        };
        gravar();
        // Investiga na hora, sem travar quem chamou.
        investigar(alvo, casos[chave].motivo).catch(() => {});
        return casos[chave];
    }

    // Casos que ainda merecem nova tentativa.
    function pendentes() {
        const agora = Date.now();
        return Object.values(casos).filter(caso => {
            if (caso.estado === 'resolvido' || caso.estado === 'sem solucao') return false;
            const ultima = new Date(caso.ultimaTentativa || caso.criadoEm).getTime();
            return (agora - ultima) > INTERVALO && caso.tentativas < MAX_TENTATIVAS;
        });
    }

    async function ciclo() {
        if (rodando) return { rodando: true, investigados: 0 };
        rodando = true;
        let investigados = 0;
        try {
            for (const caso of pendentes()) {
                await investigar(caso.alvo, caso.motivo).catch(() => {});
                investigados++;
            }
        } finally { rodando = false; }
        return { rodando: false, investigados };
    }

    function iniciar() {
        const relogio = setInterval(() => { ciclo().catch(() => {}); }, INTERVALO);
        if (relogio.unref) relogio.unref();
        return relogio;
    }

    function resumo() {
        const lista = Object.values(casos).sort((a, b) => String(b.ultimaTentativa || b.criadoEm).localeCompare(String(a.ultimaTentativa || a.criadoEm)));
        return {
            total: lista.length,
            pendentes: lista.filter(c => c.estado === 'pendente').length,
            resolvidos: lista.filter(c => c.estado === 'resolvido').length,
            semSolucao: lista.filter(c => c.estado === 'sem solucao').length,
            lista: lista.slice(0, 20).map(c => ({
                titulo: c.titulo || `${c.alvo.tipo} ${c.alvo.id}`,
                alvo: c.alvo,
                estado: c.estado,
                tentativas: c.tentativas,
                motivo: c.motivo,
                solucao: c.solucao || null,
                quando: c.ultimaTentativa || c.criadoEm
            }))
        };
    }

    return { registrarFalha, investigar, ciclo, iniciar, resumo, pendentes, testarFontes };
}

module.exports = { criarAgente };
