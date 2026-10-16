const test = require('node:test');
const assert = require('node:assert/strict');
const { analisarPlaylist, notaDaFonte } = require('./avaliador');

// Os testes usam endereços fictícios: a conferência de entrega de vídeo (feita
// pela internet) é simulada como "sempre entrega".
require('./midia-proxy').validarMidia = async () => true;

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

test('180p medido prevalece sobre a promessa de 2160p e perde para HD medido', () => {
    const medida = { dados: { audio: 'pt-BR', resolucao: '2160p' }, sonda: { altura: 180 }, idiomaVerificado: 'pt', ms: 900 };
    const baixa = notaDaFonte(medida);
    const hd = notaDaFonte({ ...medida, dados: { audio: 'pt-BR', resolucao: '720p' }, sonda: { altura: 720 } });
    assert.equal(baixa.detalhes.qualidade, '180p medido');
    assert(baixa.nota < hd.nota);
});

test('qualidade anunciada só serve como reserva e é identificada como informada', () => {
    const anunciada = notaDaFonte({ dados: { audio: 'pt-BR', resolucao: '1080p' }, sonda: null, idiomaVerificado: '', ms: 900 });
    assert.equal(anunciada.detalhes.qualidade, '1080p informado pela fonte');
    const semMedida = notaDaFonte({ dados: { audio: 'pt-BR' }, sonda: null, idiomaVerificado: '', ms: 900 });
    assert.equal(semMedida.detalhes.qualidade, 'não mediu a altura');
});

test('a reserva de conversão não apresenta o rótulo da fonte como resolução medida', () => {
    const avaliada = notaDaFonte({
        dados: { audio: 'pt-BR', resolucao: '1080p', converter: true },
        sonda: { conversao: true, altura: 1080 }, idiomaVerificado: '', ms: 900,
    });
    assert.equal(avaliada.detalhes.qualidade, '1080p informado pela fonte');
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

test('compara também a quarta fonte e escolhe Full HD com português em vez de HD', async () => {
    const motor = require('./fontes-motor');
    const axios = require('axios');
    const originais = Object.fromEntries(['filaDeFontes', 'lerIdiomasVerificados', 'registrarSucesso', 'anotarEscolha'].map(nome => [nome, motor[nome]]));
    const getOriginal = axios.get;
    const consultadas = [];
    let liberarFonteLenta;
    const primeiraSonda = new Promise(resolve => { liberarFonteLenta = resolve; });
    try {
        motor.filaDeFontes = () => [720, 720, 720, 1080].map((altura, indice) => ({
            id: 'regressao-qualidade-' + indice,
            resolver: async () => {
                consultadas.push(indice);
                // Uma consulta ainda está pendente quando a primeira fonte
                // chega. A medição dela deve começar sem esperar essa consulta.
                if (indice === 2) await primeiraSonda;
                return { url: `https://qualidade.invalid/${altura}.m3u8`, audio: 'pt-BR', resolucao: altura + 'p' };
            },
        }));
        motor.lerIdiomasVerificados = () => ({});
        motor.registrarSucesso = () => {};
        motor.anotarEscolha = () => {};
        axios.get = async url => {
            liberarFonteLenta();
            return { data: '#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,LANGUAGE="pt-BR"\n#EXT-X-STREAM-INF:BANDWIDTH=2800000,RESOLUTION=' + (url.includes('1080') ? '1920x1080' : '1280x720') + '\nvideo.m3u8' };
        };
        const resultado = await require('./avaliador').escolherMelhor('dublado', { tipo: 'movie', tmdbId: '969681' }, { semCache: true });
        assert.deepEqual(consultadas, [0, 1, 2, 3]);
        assert.equal(resultado.avaliacao.length, 4);
        assert.equal(resultado.escolhido.fonteId, 'regressao-qualidade-3');
        assert.equal(resultado.avaliacao[0].detalhes.qualidade, '1080p medido');
    } finally {
        Object.assign(motor, originais);
        axios.get = getOriginal;
    }
});

