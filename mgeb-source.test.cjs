const test = require('node:test');
const assert = require('node:assert/strict');
const { extrairPlaylist, extrairFontes } = require('./mgeb-source');

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

// Página real de filme do MGEB: a lista de opções traz duas qualidades (MP4
// em HD e lista HLS). O MP4 precisa vir primeiro, já com HTTPS e sem porta 80.
const PAGINA_OPCOES = `
<html><body><script>
    var sources = [{"file":"http://servidor.video.com:80/filmes/28/21280.mp4?token=abc","type":"mp4","label":"Opção 1"},{"file":"https://servidor.video.com/filmes/28/lista.m3u8?token=def","type":"hls","label":"Opção 2"}];
</script></body></html>`;

test('a lista de opções prioriza o arquivo MP4 (HD) e corrige o endereço', () => {
    const fontes = extrairFontes(PAGINA_OPCOES);
    assert.equal(fontes.length, 2);
    assert.equal(fontes[0].url, 'https://servidor.video.com/filmes/28/21280.mp4?token=abc');
    assert.equal(fontes[0].label, 'Opção 1');
    assert.equal(fontes[1].url, 'https://servidor.video.com/filmes/28/lista.m3u8?token=def');
});

test('itens que não são arquivo de vídeo são descartados da lista de opções', () => {
    const pagina = `<script>var sources = [{"file":"https://outro.site/embed/iframe.html","type":"iframe"},{"file":"https://servidor.video.com/a/b.mp4","type":"mp4"}];</script>`;
    const fontes = extrairFontes(pagina);
    assert.equal(fontes.length, 1);
    assert.equal(fontes[0].url, 'https://servidor.video.com/a/b.mp4');
});

test('página sem a lista de opções devolve lista vazia', () => {
    assert.deepEqual(extrairFontes('<html>sem opções</html>'), []);
    assert.deepEqual(extrairFontes(null), []);
});
