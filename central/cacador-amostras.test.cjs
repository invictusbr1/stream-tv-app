const test = require('node:test');
const assert = require('node:assert/strict');
const { amostrasComFalhas, acharVideoNaPagina, acharPlayerNaPagina } = require('./cacador.js');

// Registro de títulos no mesmo formato do registro da central.
function registro(itens) {
    return { comProblema: () => itens };
}

test('os títulos que falharam viram amostras (e os piores vêm primeiro)', () => {
    const titulos = registro([
        { id: '317883', tipo: 'tv', titulo: 'Daha 17', falhas: 20, falhasSeguidas: 6, temporada: '1', numero: '1' },
        { id: '999999', tipo: 'movie', titulo: 'Filme sem fonte', falhas: 9, falhasSeguidas: 4 },
        { id: '123', tipo: 'tv', titulo: 'Série que falhou menos', falhas: 2, falhasSeguidas: 1 },
        { id: '555', tipo: 'movie', titulo: 'Filme que abriu', falhas: 0, falhasSeguidas: 0 },
    ]);
    const filmes = amostrasComFalhas(titulos, 'movie');
    assert.equal(filmes.length, 1);
    assert.equal(filmes[0].id, '999999');
    assert.equal(filmes[0].dasFalhas, true);
    const series = amostrasComFalhas(titulos, 'tv');
    assert.deepEqual(series.map(a => a.id), ['317883', '123']);
    assert.equal(series[0].temporada, '1');
    assert.equal(series[0].episodio, '1');
    // Sem registro (ou registro vazio) não quebra nada.
    assert.deepEqual(amostrasComFalhas(null, 'movie'), []);
    assert.deepEqual(amostrasComFalhas({}, 'movie'), []);
});

test('acha o endereço do vídeo em várias formas de página', () => {
    const casos = [
        ['var player = { file: "https://cdn.test/a.m3u8" };', 'https://cdn.test/a.m3u8'],
        ['{"file":"https:\\/\\/cdn.test\\/b.mp4"}', 'https://cdn.test/b.mp4'],
        ['<source src="https://cdn.test/c.m3u8" type="application/x-mpegURL">', 'https://cdn.test/c.m3u8'],
        ['player.setup({file: "/hls/d.m3u8"})', '/hls/d.m3u8'],
    ];
    for (const [html, esperado] of casos) {
        const achado = acharVideoNaPagina(html);
        assert.ok(achado, html);
        assert.equal(achado.url, esperado);
    }
    assert.equal(acharVideoNaPagina('<html>sem vídeo</html>'), null);
});

test('acha o player embutido e ignora os que não são player', () => {
    assert.equal(acharPlayerNaPagina('<iframe src="https://player.test/e/1"></iframe>'), 'https://player.test/e/1');
    assert.equal(acharPlayerNaPagina('<iframe src="https://www.youtube.com/embed/x"></iframe>'), '');
    assert.equal(acharPlayerNaPagina('<html>sem iframe</html>'), '');
});
