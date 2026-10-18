'use strict';
// Ponte entre o Conecta TV e a central de status.
//
// A central é opcional: se não estiver configurada, nada é enviado e o
// aplicativo segue funcionando igual. Quando está, cada sessão (o que abriu,
// por qual fonte, se deu certo) aparece no painel.

const fs = require('fs');
const path = require('path');

const LOCAL_CONFIG = (() => {
    const arquivos = [path.join(process.cwd(), 'config.local.json'), path.join(path.dirname(process.execPath), 'config.local.json'), path.join(__dirname, 'config.local.json')];
    for (const arquivo of arquivos) { try { return JSON.parse(fs.readFileSync(arquivo, 'utf8')); } catch { /* opcional */ } }
    return {};
})();

// "localhost" pode resolver para IPv6 (::1) e a central do PC escuta em IPv4.
// Trocamos por 127.0.0.1 para o relato nunca se perder nesse detalhe.
const ENDERECO = String(process.env.CENTRAL_URL || LOCAL_CONFIG.central || '')
    .replace(/\/$/, '')
    .replace(/\/\/localhost(?=[:/]|$)/i, '//127.0.0.1');
const TOKEN = String(process.env.CENTRAL_TOKEN || LOCAL_CONFIG.centralToken || '').trim();

function configurada() { return Boolean(ENDERECO); }

async function enviar(caminho, corpo) {
    if (!ENDERECO) return false;
    try {
        const resposta = await fetch(ENDERECO + caminho, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(TOKEN ? { 'X-Central': TOKEN } : {}) },
            body: JSON.stringify(corpo),
            signal: AbortSignal.timeout(5000)
        });
        return resposta.ok;
    } catch {
        return false; // central fora do ar não pode travar o aplicativo
    }
}

function reportar(evento) {
    return enviar('/api/evento', evento).catch(() => false);
}
function reportarAcesso(acesso) {
    return enviar('/api/acesso', acesso).catch(() => false);
}

const pedidosDeIdioma = new Map();
function solicitarIdioma(titulo) {
    if (!require('./provas-idioma').tituloValido(titulo) || !ENDERECO) return;
    if ((pedidosDeIdioma.get(titulo) || 0) > Date.now()) return;
    if (pedidosDeIdioma.size >= 256) pedidosDeIdioma.delete(pedidosDeIdioma.keys().next().value);
    pedidosDeIdioma.set(titulo, Date.now() + 60000);
    enviar('/api/qualidade/idiomas', { titulo }).then(ok=>{if(!ok)pedidosDeIdioma.delete(titulo);});
}
module.exports = { configurada, endereco: () => ENDERECO, reportar, reportarAcesso, solicitarIdioma };
