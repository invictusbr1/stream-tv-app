const test = require('node:test');
const assert = require('node:assert/strict');
const { analisarPlaylist, notaDaFonte } = require('./avaliador');

// Lista mestre parecida com as dos provedores (qualidades + áudio + legenda).
const LISTA = [
    '#EXTM3U',
    '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a1",NAME="Português",LANGUAGE="pt-BR",DEFAULT=YES',
    '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a1",NAME="English",LANGUAGE="en",DEFAULT=NO',
    '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="s1",NAME="Português",LANGUAGE="pt-BR"',
    '#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360,AUDIO="a1"',
    '360p.m3u8',
    '#EXT-X-STREAM-INF:BANDWIDTH=2800000,RESOLUTION=1280x720,AUDIO="a1"',
    '720p.m3u8',
    '#EXT-X-STREAM-INF:BANDWIDTH=5200000,RESOLUTION=1920x1080,AUDIO="a1"',
    '1080p.m3u8',
].join('\n');

test('lê a lista do provedor: melhor formato, idiomas e legendas', () => {
    const analise = analisarPlaylist(LISTA);
    assert.equal(analise.mestre, true);
    assert.equal(analise.altura, 1080);
    assert.equal(analise.banda, 5200000);
    assert.deepEqual(analise.audios.map(a => a.lang), ['pt-br', 'en']);
    assert.deepEqual(analise.legendas, ['pt-br']);
});

test('lista sem qualidades (arquivo único) não inventa altura', () => {
    const analise = analisarPlaylist('#EXTM3U\n#EXTINF:6,\nseg1.ts\n');
    assert.equal(analise.mestre, false);
    assert.equal(analise.altura, 0);
});

// A régua das regras: dublado confirmado manda; outro idioma elimina.
test('português confirmado com 1080p vence fonte que só avisa que é dublada', () => {
    const confirmada = notaDaFonte({
        dados: { url: 'https://x/a.m3u8', audio: 'pt-BR', resolucao: '1080p' },
        sonda: { altura: 1080, banda: 5200000, audios: [{ lang: 'pt-br' }], legendas: [] },
        idiomaVerificado: 'pt', ms: 1200,
    });
    const apenasAvisa = notaDaFonte({
        dados: { url: 'https://x/b.m3u8', audio: 'pt-BR', resolucao: '720p' },
        sonda: { altura: 720, banda: 2800000, audios: [{ lang: 'pt-br' }], legendas: [] },
        idiomaVerificado: '', ms: 1200,
    });
    assert(confirmada.nota > apenasAvisa.nota);
    assert.match(confirmada.detalhes.idioma, /confirmado/);
});

test('fonte que a central ouviu em outro idioma perde da que só tem legenda', () => {
    const ingles = notaDaFonte({
        dados: { url: 'https://x/a.m3u8', audio: 'pt-BR', resolucao: '1080p' },
        sonda: { altura: 1080, banda: 5200000, audios: [], legendas: [] },
        idiomaVerificado: 'outro', ms: 900,
    });
    const original = notaDaFonte({
        dados: { url: 'https://x/b.m3u8', audio: 'original', resolucao: '720p' },
        sonda: { altura: 720, banda: 2000000, audios: [], legendas: ['pt-br'] },
        idiomaVerificado: '', ms: 900,
    });
    assert(ingles.nota < original.nota);
});

test('fonte que precisa de conversão é descontada (mas continua na disputa)', () => {
    const comConversao = notaDaFonte({
        dados: { url: 'https://x/filme.mkv', audio: 'pt-BR', resolucao: '1080p', converter: true },
        sonda: null, idiomaVerificado: 'pt', ms: 1000,
    });
    const direta = notaDaFonte({
        dados: { url: 'https://x/a.m3u8', audio: 'pt-BR', resolucao: '1080p' },
        sonda: { altura: 1080, banda: 2000000, audios: [], legendas: [] },
        idiomaVerificado: 'pt', ms: 1000,
    });
    assert(comConversao.nota < direta.nota);
    assert.match(comConversao.detalhes.conversao, /converter/);
});
