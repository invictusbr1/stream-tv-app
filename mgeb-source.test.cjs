const test = require('node:test');
const assert = require('node:assert/strict');
const { extrairPlaylist } = require('./mgeb-source');

// Página real do MGEB (série): o endereço do vídeo vem no HTML, com o "/../"
// que o próprio provedor usa no caminho.
const PAGINA = `
<html><body><div id="player"></div>
<script>var player = new Playerjs({id:"player", file:"https://mgeb.top/../cache/hls/903130965b2e92c1e640a0b0c2591952.m3u8"});</script>
</body></html>`;

test('o MGEB entrega o endereço da lista de reprodução direto no HTML', () => {
    assert.equal(
        extrairPlaylist(PAGINA),
        'https://mgeb.top/cache/hls/903130965b2e92c1e640a0b0c2591952.m3u8'
    );
});

test('endereço de vídeo de outro site é recusado (regra da fonte limpa)', () => {
    const outro = '<script>file:"https://site-estranho.com/cache/hls/abc.m3u8"</script>';
    assert.equal(extrairPlaylist(outro), '');
});

test('página sem vídeo devolve vazio (o motor segue para a próxima fonte)', () => {
    assert.equal(extrairPlaylist('<html><body>sem player</body></html>'), '');
    assert.equal(extrairPlaylist(''), '');
    assert.equal(extrairPlaylist(null), '');
});
