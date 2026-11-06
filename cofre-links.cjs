'use strict';
// Cofre de links que NÃO podem ir ao aparelho.
//
// O link de arquivo da TorBox leva a chave da conta dentro (parâmetro
// token=, conferido em 05/11/2026: sem ele o CDN responde 400). O servidor
// guarda o link aqui e entrega ao aparelho só um código aleatório
// (/api/torbox/<código>); o vídeo passa pelo servidor. Fica só na memória.

const crypto = require('node:crypto');

const links = new Map();
const MAXIMO = 500;

function guardar(url, validadeMs = 3 * 60 * 60 * 1000) {
    for (const [id, item] of links) if (item.url === url && item.expira > Date.now() + 10 * 60 * 1000) return id;
    const id = crypto.randomBytes(16).toString('hex');
    if (links.size >= MAXIMO) links.delete(links.keys().next().value);
    links.set(id, { url: String(url), expira: Date.now() + validadeMs });
    return id;
}

function pegar(id) {
    if (!/^[a-f0-9]{32}$/.test(String(id || ''))) return '';
    const item = links.get(id);
    if (!item) return '';
    if (item.expira <= Date.now()) { links.delete(id); return ''; }
    return item.url;
}

// Tira qualquer token de um texto (mensagem de erro do ffmpeg, registro...).
function semSegredo(texto) {
    return String(texto || '').replace(/([?&](?:token|key|apikey|api_key)=)[^&\s"']+/gi, '$1***');
}

module.exports = { guardar, pegar, semSegredo };
