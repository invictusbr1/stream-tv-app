'use strict';
const axios = require('axios');
const { paginaPermitida } = require('./mininovelas-source');
async function buscarPagina(url) {
    for (let salto = 0; salto < 3; salto++) {
        if (!paginaPermitida(url)) throw Error('Página não permitida');
        const r = await axios.get(url, { timeout: 15000, maxRedirects: 0, maxContentLength: 3000000, validateStatus: () => true, headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (r.status === 200 && typeof r.data === 'string') return r.data;
        if ([301,302,307,308].includes(r.status) && r.headers.location) {
            url = new URL(r.headers.location, url).href;
            continue;
        }
        throw Error('Fornecedor indisponível');
    }
    throw Error('Redirecionamentos em excesso');
}
module.exports = { buscarPagina };
