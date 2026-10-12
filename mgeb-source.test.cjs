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

test('resolução declarada maior vence MP4 menor, sem mudar a preferência nos empates', () => {
    const pagina = `<script>var sources = [
        {"file":"https://cdn.video.test/720.mp4","label":"720p"},
        {"file":"https://cdn.video.test/1080.m3u8","label":"Dublado 1080p"},
        {"file":"https://cdn.video.test/1080.mp4","label":"1080"},
        {"file":"https://cdn.video.test/sem-resolucao.mp4","label":"Opção 1"}
    ];</script>`;
    assert.deepEqual(extrairFontes(pagina).map(f => f.url), [
        'https://cdn.video.test/1080.mp4',
        'https://cdn.video.test/1080.m3u8',
        'https://cdn.video.test/720.mp4',
        'https://cdn.video.test/sem-resolucao.mp4',
    ]);
});

test('resolver restringe IPv4 à página MGEB, preserva o prazo e entrega o referenciador', async t => {
    const axios = require('axios');
    const mgeb = require('./mgeb-source');
    const getOriginal = axios.get;
    t.after(() => { axios.get = getOriginal; });
    axios.get = async (url, opcoes) => {
        assert.equal(url, 'https://mgeb.top/embed/910001');
        assert.equal(opcoes.timeout, 15000);
        assert.equal(opcoes.httpsAgent.options.family, 4);
        assert.equal(opcoes.headers.Referer, 'https://mgeb.top/');
        assert.notEqual(axios.defaults.httpsAgent, opcoes.httpsAgent, 'nenhuma configuração global de rede é alterada');
        return { data: PAGINA_OPCOES };
    };
    const dados = await mgeb.resolver('movie', '910001');
    assert.equal(dados.referer, 'https://mgeb.top/');
    assert.equal(dados.type, 'file');
    assert.equal(dados.final, true);
    assert.equal(dados.audio, 'pt-BR');
    assert.equal(dados.resolucao, '', 'MP4 sem rótulo de resolução não recebe 720p inventado');
});

test('resolver conserva resolução declarada no rótulo sem apresentá-la como medição', async t => {
    const axios = require('axios');
    const mgeb = require('./mgeb-source');
    const getOriginal = axios.get;
    t.after(() => { axios.get = getOriginal; });
    axios.get = async () => ({ data: '<script>var sources = [{"file":"https://cdn.video.test/1080.m3u8","label":"1080p"}];</script>' });
    const dados = await mgeb.resolver('movie', '910002');
    assert.equal(dados.resolucao, '1080p');
    assert.equal(dados.type, 'hls');
    assert.equal(dados.final, false);
    assert.equal(dados.referer, 'https://mgeb.top/');
});

test('a playlist antiga de episódio recebe referenciador e não recebe resolução presumida', async t => {
    const axios = require('axios');
    const mgeb = require('./mgeb-source');
    const getOriginal = axios.get;
    t.after(() => { axios.get = getOriginal; });
    axios.get = async url => {
        assert.equal(url, 'https://mgeb.top/embed/910003/2/7');
        return { data: PAGINA };
    };
    const dados = await mgeb.resolverEpisodio('910003', '2', '7');
    assert.equal(dados.url, 'https://mgeb.top/cache/hls/903130965b2e92c1e640a0b0c2591952.m3u8');
    assert.equal(dados.resolucao, '');
    assert.equal(dados.referer, 'https://mgeb.top/');
    assert.equal(dados.type, 'hls');
});

test('falha na página MGEB continua retornando vazio para o fallback do motor', async t => {
    const axios = require('axios');
    const mgeb = require('./mgeb-source');
    const getOriginal = axios.get;
    t.after(() => { axios.get = getOriginal; });
    axios.get = async () => { throw new Error('timeout'); };
    assert.equal(await mgeb.resolver('movie', '910004'), null);
});
