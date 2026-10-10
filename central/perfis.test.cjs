const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const fs = require('fs');
const path = require('path');
const perfis = require('./perfis');

const PAGINA = '<html><script>var player={file:"https://cdn.exemplo.test/hls/27205.m3u8",poster:"x"}</script></html>';

test('o molde do endereço guarda o lugar do título, da temporada e do episódio', () => {
    assert.equal(
        perfis.modeloDeUrl('https://site.test/filme/27205', { tmdbId: '27205' }),
        'https://site.test/filme/{id}'
    );
    assert.equal(
        perfis.modeloDeUrl('https://site.test/serie/1399/1/2', { tmdbId: '1399', temporada: '1', episodio: '2' }),
        'https://site.test/serie/{id}/{temporada}/{episodio}'
    );
    // O número da versão no endereço não pode virar marcador.
    assert.equal(
        perfis.modeloDeUrl('https://v2.site.test/movie/27205', { tmdbId: '27205' }),
        'https://v2.site.test/movie/{id}'
    );
});

test('a regra da ficha acha o vídeo mesmo com espaços ou sinal de igual', () => {
    const padrao = perfis.padraoPara(PAGINA, 'https://cdn.exemplo.test/hls/27205.m3u8');
    assert.ok(padrao && padrao.includes('file'));
    const variantes = [
        'player.file = "https://cdn.exemplo.test/x.m3u8"',
        'player.file:   "https://cdn.exemplo.test/x.m3u8"',
        '{"file":"https://cdn.exemplo.test/x.m3u8"}',
    ];
    for (const variante of variantes) {
        const achado = new RegExp(padrao, 'i').exec(variante);
        assert.ok(achado && achado[1] === 'https://cdn.exemplo.test/x.m3u8', variante);
    }
});

test('monta a ficha da página medida', () => {
    const ficha = perfis.inferirDePagina({
        candidata: {
            nome: 'Site Exemplo', url: 'https://site.test/filme/27205', origem: 'código do site',
            dublado: true, qualidade: '1080p', alvo: { tipo: 'movie', tmdbId: '27205' },
        },
        html: PAGINA,
        video: 'https://cdn.exemplo.test/hls/27205.m3u8',
    });
    assert.ok(ficha);
    assert.equal(ficha.urlMovie, 'https://site.test/filme/{id}');
    assert.deepEqual(ficha.tipos, ['movie']);
    assert.equal(ficha.ativo, false, 'ficha nasce desativada: só liga depois de validar');
    assert.equal(ficha.passos[0].tipo, 'regex');
    assert.equal(ficha.id, 'site-exemplo');
});

test('ficha de página com anúncio é recusada (regra do projeto)', () => {
    const ficha = perfis.inferirDePagina({
        candidata: { nome: 'Com anúncio', url: 'https://site.test/filme/27205', alvo: { tipo: 'movie', tmdbId: '27205' } },
        html: PAGINA + '<script src="https://googlesyndication.com/ads.js"></script>',
        video: 'https://cdn.exemplo.test/hls/27205.m3u8',
    });
    assert.equal(ficha, null);
});

test('quando o vídeo está no player embutido, a ficha leva dois passos', () => {
    const html = '<html><body><iframe src="https://player.test/e/27205"></iframe></body></html>';
    const ficha = perfis.inferirDePagina({
        candidata: { nome: 'Com player', url: 'https://site.test/f/{id}', alvo: { tipo: 'movie', tmdbId: '27205' } },
        html,
        video: 'https://cdn.exemplo.test/hls/outro.m3u8',
    });
    assert.ok(ficha);
    assert.equal(ficha.passos.length, 2);
    assert.ok(ficha.passos[0].padrao.includes('iframe'));
});

test('ficha de addon do Stremio guarda o molde com o código IMDb', () => {
    const ficha = perfis.inferirDeStremio({
        candidata: {
            nome: 'Addon Exemplo', url: 'https://addon.test/v1/stream/movie/tt0111161.json',
            alvo: { tipo: 'movie', imdb: 'tt0111161' },
        },
    });
    assert.ok(ficha);
    assert.equal(ficha.urlMovie, 'https://addon.test/v1/stream/movie/{imdb}.json');
    assert.deepEqual(ficha.passos, [{ tipo: 'json', caminho: 'streams[0].url' }]);
    assert.equal(ficha.stremio, true);
});

test('a mesma fonte guarda filme e série na mesma ficha', () => {
    const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'perfis-'));
    perfis.registrarFicha(pasta, { id: 'exemplo', nome: 'Exemplo', tipos: ['movie'], urlMovie: 'https://s.test/f/{id}', ativo: false });
    perfis.registrarFicha(pasta, { id: 'exemplo', nome: 'Exemplo', tipos: ['tv'], urlTv: 'https://s.test/t/{id}/{temporada}/{episodio}', ativo: false });
    const lista = perfis.listar(pasta);
    assert.equal(lista.length, 1);
    assert.deepEqual(lista[0].tipos.sort(), ['movie', 'tv']);
    assert.equal(lista[0].urlMovie, 'https://s.test/f/{id}');
    assert.equal(lista[0].urlTv, 'https://s.test/t/{id}/{temporada}/{episodio}');
    assert.equal(perfis.removerFicha(pasta, 'exemplo'), true);
    assert.deepEqual(perfis.listar(pasta), []);
    fs.rmSync(pasta, { recursive: true, force: true });
});

test('validação exige dois títulos abrindo de verdade', async () => {
    const ficha = { id: 'x', nome: 'X', urlMovie: 'https://site.test/f/{id}', passos: [{ tipo: 'texto' }] };
    const buscar = async () => 'https://cdn.exemplo.test/v.m3u8';
    // sondagemRapida vai bater na rede e falhar aqui: sem dois "abriu", reprova.
    const resultado = await perfis.validar(ficha, [{ id: '1', titulo: 'Um', tipo: 'movie' }, { id: '2', titulo: 'Dois', tipo: 'movie' }], { buscar });
    assert.equal(resultado.aprovada, false);
});
