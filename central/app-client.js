'use strict';
// Ponte da central com o aplicativo.
//
// A central é quem mostra (e o dono decide), mas quem guarda a lista de
// aparelhos autorizados é o aplicativo. Aqui a central entra com o código de
// acesso, pega o crachá e consulta/bloqueia aparelhos em nome do dono.

function criarClienteApp({ appUrl = 'http://127.0.0.1:3000', codigo = '' } = {}) {
    const base = String(appUrl || '').replace(/\/$/, '');
    let cracha = '';
    let ultimoErro = '';

    async function entrar(renovar = false) {
        if (cracha && !renovar) return cracha;
        if (!codigo) { ultimoErro = 'sem código de acesso configurado na central'; return ''; }
        try {
            const resposta = await fetch(`${base}/api/entrar`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ nome: 'Central Conecta TV', aparelho: 'Computador (central)', dispositivo: 'central-conecta-tv', codigo }),
                signal: AbortSignal.timeout(12000),
            });
            if (!resposta.ok) { ultimoErro = 'o aplicativo recusou o acesso (HTTP ' + resposta.status + ')'; return ''; }
            const dados = await resposta.json().catch(() => ({}));
            cracha = String(dados.token || '');
            const cookie = resposta.headers.get('set-cookie');
            if (!cracha && cookie) cracha = String(cookie).split(';')[0].split('=')[1] || '';
            ultimoErro = cracha ? '' : 'o aplicativo não devolveu o crachá';
            return cracha;
        } catch (erro) { ultimoErro = 'não falei com o aplicativo: ' + String(erro.message).slice(0, 60); return ''; }
    }

    async function pedir(caminho, opcoes = {}, repetir = true) {
        const token = await entrar();
        if (!token) return null;
        try {
            const resposta = await fetch(base + caminho, {
                ...opcoes,
                headers: {
                    'Content-Type': 'application/json',
                    ...(opcoes.headers || {}),
                    ...(token.length > 40 ? { 'X-Acesso': token } : {}),
                    Cookie: token.length > 40 ? `conecta_acesso=${encodeURIComponent(token)}` : token,
                },
                signal: AbortSignal.timeout(15000),
            });
            if (resposta.status === 401 || resposta.status === 403) {
                if (repetir) { cracha = ''; return pedir(caminho, opcoes, false); }
                ultimoErro = 'o aplicativo pediu o código de novo';
                return null;
            }
            if (!resposta.ok) { ultimoErro = 'HTTP ' + resposta.status; return null; }
            return resposta.json().catch(() => null);
        } catch (erro) { ultimoErro = String(erro.message).slice(0, 60); return null; }
    }

    async function listarAparelhos() {
        const dados = await pedir('/api/dispositivos');
        return {
            ok: Boolean(dados),
            aparelhos: (dados && dados.dispositivos) || [],
            erro: dados ? '' : ultimoErro,
        };
    }

    async function bloquear(token) {
        const dados = await pedir('/api/dispositivos/bloquear', { method: 'POST', body: JSON.stringify({ token }) });
        return { ok: Boolean(dados && dados.ok), removido: dados && dados.removido, erro: dados ? '' : ultimoErro };
    }

    return { listarAparelhos, bloquear, entrar, erro: () => ultimoErro };
}

module.exports = { criarClienteApp };
