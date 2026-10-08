const test = require('node:test');
const assert = require('node:assert/strict');
const { escolherStream } = require('./fenix-source');

// Página real do addon (filme "A Queda 2"): tem uma opção legendada e uma
// dublada, as duas em HLS.
test('escolhe o stream dublado quando existe', () => {
    const streams = [
        { name: 'FenixFlix 720p', title: 'A Queda 2 🇺🇸 Legendado', url: 'https://cdn.exemplo/master.m3u8?md5=1' },
        { name: 'FenixFlix 720p', title: 'A Queda 2 🇧🇷 Dublado', url: 'https://cdn.exemplo/master2.m3u8?md5=2' },
    ];
    assert.equal(escolherStream(streams).url, 'https://cdn.exemplo/master2.m3u8?md5=2');
});

// Alguns títulos só existem em MKV (o navegador toca mudo) ou em página HTML —
// esses são recusados para o motor seguir para outra fonte.
test('recusa opções que não são lista de reprodução', () => {
    assert.equal(escolherStream([{ title: 'Filme Dublado', url: 'https://cdn.exemplo/filme.mkv' }]), null);
    assert.equal(escolherStream([{ title: 'Página', url: 'https://site.exemplo/player/123' }]), null);
    assert.equal(escolherStream([]), null);
    assert.equal(escolherStream(null), null);
});

test('sem rótulo dublado, aceita a primeira lista disponível', () => {
    const streams = [{ title: 'Filme', url: 'https://cdn.exemplo/master.m3u8' }];
    assert.equal(escolherStream(streams).url, 'https://cdn.exemplo/master.m3u8');
});
