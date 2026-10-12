const test = require('node:test');
const assert = require('node:assert/strict');
const { amostrasComFalhas, acharVideoNaPagina, acharPlayerNaPagina, comPrazo } = require('./cacador.js');

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

test('prazo retorna timeout sem manter o timer quando a operação termina antes', async () => {
    const realSet = global.setTimeout, realClear = global.clearTimeout;
    const pendentes = new Set();
    global.setTimeout = (...args) => { const t = realSet(...args); pendentes.add(t); return t; };
    global.clearTimeout = t => { pendentes.delete(t); return realClear(t); };
    try {
        assert.equal(await comPrazo(Promise.resolve('pronto'), 1000), 'pronto');
        assert.equal(pendentes.size, 0);
        await assert.rejects(comPrazo(Promise.reject(new Error('falha')), 1000), /falha/);
        assert.equal(pendentes.size, 0);
        const timeout = await comPrazo(new Promise(() => {}), 5);
        assert.equal(timeout.__tempo, true);
        assert.equal(pendentes.size, 0);
    } finally { global.setTimeout = realSet; global.clearTimeout = realClear; }
});

test('amostras preservam episódios diferentes e dão prioridade às falhas reais', () => {
    const { juntarAmostras } = require('./cacador');
    const pedido = { id:'123', temporada:'2', episodio:'3', pedido:true };
    const falha = { id:'123', temporada:'2', episodio:'4', dasFalhas:true };
    const fixo = { id:'123', temporada:'1', episodio:'1' };
    assert.deepEqual(juntarAmostras('tv', [pedido], [falha, pedido], [fixo, falha]), [pedido, falha, fixo]);
    assert.deepEqual(juntarAmostras('movie', [pedido], [falha], [fixo]), [pedido]);
    assert.deepEqual(juntarAmostras('tv', [null, {id:''}, {id:'não é título'}]), []);
});

test('falta de título e rejeição de qualidade não derrubam o domínio inteiro', () => {
    const { falhaDeDominio } = require('./cacador');
    assert.equal(falhaDeDominio({status:200,situacao:'descartada'}), false);
    assert.equal(falhaDeDominio({status:403,situacao:'descartada'}), false);
    assert.equal(falhaDeDominio({status:0,situacao:'já implementada'}), false);
    assert.equal(falhaDeDominio({status:0,situacao:'descartada'}), true);
    assert.equal(falhaDeDominio(null), true);
});

test('provas de séries e addons conservam tipo TV e coordenadas em todos os caminhos', () => {
    const { amostrasParaCategoria } = require('./cacador');
    const [serie, addon] = amostrasParaCategoria({tipo:'tv'}, [{id:'1399',temporada:'2',episodio:'3'}, {id:'tt123456'}]);
    assert.equal(serie.tipo, 'tv'); assert.equal(serie.temporada, '2'); assert.equal(serie.episodio, '3');
    assert.equal(addon.tipo, 'tv'); assert.equal(addon.imdb, 'tt123456'); assert.equal(addon.episodio, '1');
    assert.equal(amostrasParaCategoria({tipo:'movie'}, [{id:'27205'}])[0].tipo, 'movie');
});
