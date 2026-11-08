'use strict';
const test = require('node:test');
const assert = require('node:assert');
const registrar = require('./rotas/tela');
function app() { const rotas = {}; return { rotas, get: (p, h) => { rotas[p] = h; } }; }
function chamar(a, p, query, extra = {}) {
    let saida = null, code = 200;
    const res = { setHeader() {}, status(c) { code = c; return this; }, json(d) { saida = d; } };
    a.rotas[p]({ query, ...extra }, res);
    return { code, d: saida };
}
test('assistir na TV: a TV se anuncia, o celular vê, manda, e a TV recebe uma vez', () => {
    const a = app(); registrar(a);
    assert.deepEqual(chamar(a, '/api/tela/receber', { eu: 'tvsala123', tipo: 'Samsung', nome: 'TV Samsung' }).d, { ok: true, pedido: null });
    const lista = chamar(a, '/api/tela/receptores', { eu: 'celular99' }).d;
    assert.deepEqual(lista, [{ id: 'tvsala123', nome: 'TV Samsung', tipo: 'Samsung' }]);
    assert.deepEqual(chamar(a, '/api/tela/receptores', { eu: 'tvsala123' }).d, [], 'a TV não aparece para ela mesma');
    const envio = chamar(a, '/api/tela/enviar', { para: 'tvsala123', id: '73223', titulo: 'Black Clover', tipo: 'tv', temporada: '2', episodio: '2', anime: '1', audio: 'legendado', posicao: '312.7' }, { dispositivoAutorizado: { nome: 'Marlon' } });
    assert.equal(envio.d.ok, true);
    const p = chamar(a, '/api/tela/receber', { eu: 'tvsala123' }).d.pedido;
    assert.equal(p.id, '73223'); assert.equal(p.posicao, 312); assert.equal(p.de, 'Marlon');
    assert.deepEqual(p.episode, { season: 2, number: 2, anime: true, audio: 'legendado' });
    assert.equal(chamar(a, '/api/tela/receber', { eu: 'tvsala123' }).d.pedido, null, 'pedido entregue uma vez só');
    assert.equal(chamar(a, '/api/tela/enviar', { para: 'naoexiste1', id: '1' }).code, 404);
    assert.equal(chamar(a, '/api/tela/enviar', { para: 'tvsala123', id: 'x' }).code, 400);
});
