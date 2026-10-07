const test = require('node:test');
const assert = require('node:assert/strict');
const { escolherFonte, escolherEpisodio, BASE } = require('./pipoca-source');

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

const EPISODIOS = JSON.stringify({
    1: { name: 'Temporada 1', episodes: { 1: { name: 'Episódio 1', url_dub: 'https://nixplay.lat/series/pipocacine-vods/WoQDqAjmh/1399/1/1.mp4', url_leg: null }, 2: { name: 'Episódio 2', url_dub: 'https://nixplay.lat/series/pipocacine-vods/WoQDqAjmh/1399/1/2.mp4' } } },
    2: { name: 'Temporada 2', episodes: { 1: { name: 'Episódio 1', url_dub: 'https://nixplay.lat/series/pipocacine-vods/WoQDqAjmh/1399/2/1.mp4' } } }
});

test('o episódio dublado é encontrado pela temporada e pelo número certos', () => {
    assert.equal(escolherEpisodio(EPISODIOS, '1', '2'), 'https://nixplay.lat/series/pipocacine-vods/WoQDqAjmh/1399/1/2.mp4');
    assert.equal(escolherEpisodio(EPISODIOS, '2', '1'), 'https://nixplay.lat/series/pipocacine-vods/WoQDqAjmh/1399/2/1.mp4');
});

test('episódio que só tem versão legendada não entra (regra do dublado)', () => {
    const soLegendado = JSON.stringify({ 1: { episodes: { 1: { url_dub: null, url_leg: 'https://nixplay.lat/series/x/y/1/1/1.mp4' } } } });
    assert.equal(escolherEpisodio(soLegendado, '1', '1'), null);
});

test('endereço de outro site ou fora do padrão é recusado', () => {
    const outroSite = JSON.stringify({ 1: { episodes: { 1: { url_dub: 'https://site-estranho.com/serie/1/1/1.mp4' } } } });
    assert.equal(escolherEpisodio(outroSite, '1', '1'), null);
    const semPadrao = JSON.stringify({ 1: { episodes: { 1: { url_dub: 'https://nixplay.lat/qualquer-coisa.mp4' } } } });
    assert.equal(escolherEpisodio(semPadrao, '1', '1'), null);
    assert.equal(escolherEpisodio('não é json', '1', '1'), null);
    assert.equal(escolherEpisodio(JSON.stringify({ 1: { episodes: {} } }), '3', '1'), null);
});
