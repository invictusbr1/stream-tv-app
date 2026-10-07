const test = require('node:test');
const assert = require('node:assert/strict');
const { montarComToken } = require('./vidsrc-source');

test('o token substitui o marcador __TOKEN__ do provedor', () => {
    const url = 'https://video.exemplo/pl/abc/master.m3u8?x=__TOKEN__';
    assert.equal(montarComToken(url, 'ABC123'), 'https://video.exemplo/pl/abc/master.m3u8?x=ABC123');
});

test('sem marcador, o token entra como parâmetro no fim do endereço', () => {
    assert.equal(montarComToken('https://video.exemplo/pl/abc/master.m3u8', 'XYZ'), 'https://video.exemplo/pl/abc/master.m3u8?token=XYZ');
    assert.equal(montarComToken('https://video.exemplo/pl/abc/master.m3u8?h=1', 'XYZ'), 'https://video.exemplo/pl/abc/master.m3u8?h=1&token=XYZ');
});

test('sem token, o endereço continua igual', () => {
    const url = 'https://video.exemplo/pl/abc/master.m3u8';
    assert.equal(montarComToken(url, ''), url);
});

test('id inválido não gera consulta', async () => {
    const { resolver } = require('./vidsrc-source');
    assert.equal(await resolver('movie', 'nada'), null);
    assert.equal(await resolver('movie', ''), null);
});
