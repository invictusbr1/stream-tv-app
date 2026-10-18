'use strict';
const crypto = require('crypto');
const VALIDADE = 7 * 24 * 60 * 60 * 1000;
function tituloValido(titulo) { return /^(?:movie:\d{1,10}|tv:\d{1,10}:\d{1,3}:[1-9]\d{0,3})$/.test(String(titulo)); }
// A identidade inclui o endereço completo: trocar token/arquivo exige nova prova.
function identidade(titulo, fonteId, url, referer = '') {
    return crypto.createHash('sha256').update([titulo, fonteId, url, referer || ''].join('\n'), 'utf8').digest('hex');
}
function publicas(registros, titulo, agora = Date.now()) {
    if (!tituloValido(titulo)) return [];
    return Object.values(registros || {}).filter(r => r && r.titulo === titulo && /^[a-f0-9]{64}$/.test(r.midiaHash || '')
        && ['pt', 'outro'].includes(r.idioma) && Date.parse(r.em) <= agora && Date.parse(r.em) + VALIDADE > agora)
        .sort((a,b)=>Date.parse(b.em)-Date.parse(a.em)).slice(0,128)
        .map(r=>({hash:r.midiaHash, idioma:r.idioma, expira:Date.parse(r.em)+VALIDADE}));
}
function idioma(registros, titulo, fonteId, dados) {
    const hash=identidade(titulo, fonteId, dados.url, dados.referer);
    return publicas(registros,titulo).find(r=>r.hash===hash)?.idioma || '';
}
module.exports={VALIDADE,tituloValido,identidade,publicas,idioma};
