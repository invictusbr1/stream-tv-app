'use strict';
const test = require('node:test');
const assert = require('node:assert');
const cofre = require('./cofre-links.cjs');

const LINK = 'https://store-018.weur.tb-cdn.st/dld/abc?token=00000000-1111-2222-3333-444444444444';

test('cofre guarda o link e devolve só um código; código inválido não abre nada', () => {
    const id = cofre.guardar(LINK);
    assert.match(id, /^[a-f0-9]{32}$/);
    assert.strictEqual(cofre.pegar(id), LINK);
    assert.strictEqual(cofre.guardar(LINK), id);
    assert.strictEqual(cofre.pegar('../../etc'), '');
    assert.strictEqual(cofre.pegar('f'.repeat(32)), '');
});

test('fonte com segredo: o aparelho recebe /api/torbox/<código>, nunca o link com a chave', () => {
    const motor = require('./fontes-motor');
    const pronto = motor.prepararParaPlayer({ url: LINK, segredo: true, final: true, fonte: 'TorBox' });
    assert.strictEqual(pronto.final, false);
    assert.match(pronto.urlAplicativo, /^\/api\/torbox\/[a-f0-9]{32}$/);
    const rede = require('./rede-playback.cjs');
    for (const transporte of ['', 'servidor']) {
        const url = rede.enderecoPlayback({ query: { transporte } }, { url: LINK, segredo: true, final: true });
        assert.match(url, /^\/api\/torbox\/[a-f0-9]{32}$/);
        assert.ok(!url.includes('token'));
    }
});

test('mensagem de erro do conversor sai sem o token', () => {
    const t = cofre.semSegredo(`${LINK}: Server returned 403 Forbidden`);
    assert.ok(!t.includes('4444'));
    assert.match(t, /token=\*\*\*/);
});

test('APK (transporte=servidor) não recebe fonte que precisa de conversão', () => {
    const { _filtrarPorCodec } = require('./avaliador');
    if (typeof _filtrarPorCodec !== 'function') return;
    const r = [{ item: { dados: { converter: true, type: 'convertido' } }, sonda: { videoCodec: 'h264' } }, { item: { dados: { type: 'file' } }, sonda: { videoCodec: 'h264' } }];
    assert.strictEqual(_filtrarPorCodec(r, 'avc', true).length, 1);
    assert.strictEqual(_filtrarPorCodec(r, 'avc', false).length, 2);
});
