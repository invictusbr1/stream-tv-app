const test = require('node:test');
const assert = require('node:assert/strict');
const { escolherFonte, BASE } = require('./pipoca-source');

const BLOCO = '[{"src":"\\/stream.php?t=AAA","label":"HD DUB","subtitle":""},{"src":"\\/stream.php?t=BBB","label":"HD","subtitle":""}]';

test('a fonte escolhida é a dublada quando existe', () => {
    assert.equal(escolherFonte(BLOCO), `${BASE}/stream.php?t=AAA`);
});

test('sem rótulo de dublado, usa a primeira fonte disponível', () => {
    const semDub = '[{"src":"\\/stream.php?t=CCC","label":"HD"}]';
    assert.equal(escolherFonte(semDub), `${BASE}/stream.php?t=CCC`);
});

test('bloco inválido ou vazio devolve nulo (o aplicativo segue para a próxima fonte)', () => {
    assert.equal(escolherFonte('nada aqui'), null);
    assert.equal(escolherFonte('[]'), null);
    assert.equal(escolherFonte('[{"label":"HD DUB"}]'), null);
});

test('endereço relativo é convertido em endereço completo do provedor', () => {
    const url = escolherFonte('[{"src":"\\/stream.php?t=XYZ","label":"HD DUB"}]');
    assert.match(url, /^https:\/\/pipocacine\.lat\/stream\.php/);
});
