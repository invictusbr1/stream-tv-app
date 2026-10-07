const test = require('node:test');
const assert = require('node:assert/strict');
const { resolverEpisodio, definirDependenciasParaTeste } = require('./series-source');

function limpar() {
    definirDependenciasParaTeste({ limparCache: true });
    definirDependenciasParaTeste({
        tentarDublada: async () => null,
        tentarAltaDefinicao: async () => null
    });
}

test('a série abre dublada quando a fonte dublada responde', async () => {
    limpar();
    let tentouAlta = false;
    definirDependenciasParaTeste({
        tentarDublada: async () => ({ url: 'https://vid1.hclod.qzz.io/serie/ep.m3u8', audio: 'pt-BR', fonte: 'Dublado', resolucao: '720p', legendas: [] }),
        tentarAltaDefinicao: async () => { tentouAlta = true; return null; }
    });
    const escolhido = await resolverEpisodio({ tmdbId: '111', temporada: '1', episodio: '1' });
    assert.equal(escolhido.audio, 'pt-BR');
    assert.equal(tentouAlta, false, 'não precisa procurar a segunda opção quando a dublada funciona');
    assert.match(escolhido.urlAplicativo, /^\/api\/hls\?u=/);
});

test('sem fonte dublada, entrega a alta definição com legenda em português', async () => {
    limpar();
    definirDependenciasParaTeste({
        tentarDublada: async () => null,
        tentarAltaDefinicao: async () => ({
            url: 'https://vixsrc.to/playlist/1?token=abc',
            audio: 'original',
            fonte: 'Alta definição',
            resolucao: '720p',
            legendas: ['English', 'Portuguese (Brazilian)'],
            legendaPortugues: true
        })
    });
    const escolhido = await resolverEpisodio({ tmdbId: '222', temporada: '2', episodio: '3' });
    assert.equal(escolhido.audio, 'original');
    assert.equal(escolhido.legendaPortugues, true);
    const referer = Buffer.from(escolhido.urlAplicativo.split('&r=')[1], 'base64').toString('utf8');
    assert.equal(referer, 'https://vixsrc.to/');
});

test('quando nada responde, o aplicativo sabe que não há fonte (e tenta de novo depois)', async () => {
    limpar();
    const escolhido = await resolverEpisodio({ tmdbId: '333', temporada: '1', episodio: '1' });
    assert.equal(escolhido, null);
    let chamadas = 0;
    definirDependenciasParaTeste({
        tentarAltaDefinicao: async () => { chamadas++; return null; }
    });
    await resolverEpisodio({ tmdbId: '333', temporada: '1', episodio: '1' });
    assert.equal(chamadas, 1, 'resultado negativo não fica guardado no cache');
});
