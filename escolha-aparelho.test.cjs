// O servidor encaminha a escolha medida pelo aparelho (4K) sem refazer a
// disputa, mas só para endereço que a própria fonte devolve.
const test = require('node:test');
const assert = require('node:assert/strict');
const midia = require('./midia-proxy');
const motor = require('./fontes-motor');
const seguranca = require('./seguranca');

function rotas() {
    const handlers = {};
    const app = { get: (p, h) => { handlers[p] = h; }, post: () => {}, use: () => {} };
    require('./rotas/playback')(app, { LOCAL_CONFIG: {}, RAIZ: __dirname, TMDB_KEY: '', fs: require('fs'), path: require('path'), seguranca });
    return handlers;
}
const resposta = () => { const r = { codigo: 200, corpo: null }; r.status = c => { r.codigo = c; return r; }; r.json = j => { r.corpo = j; return r; }; r.sendStatus = c => { r.codigo = c; return r; }; r.setHeader = () => {}; return r; };

test('aparelho escolheu o 4K: o servidor encaminha o mesmo arquivo, sem refazer a escolha', async () => {
    const original = motor.fontesAtivas;
    const avaliador = require('./avaliador'), escolher = avaliador.escolherMelhor;
    let disputou = false;
    avaliador.escolherMelhor = async () => { disputou = true; return null; };
    motor.fontesAtivas = () => [{ id: 'fenixflix-fenixhub', nome: 'FenixFlix', papel: 'dublado', resolverTodos: async () => [
        { url: 'https://cdn.fenix.example/v/4k.mp4?t=servidor', referer: 'https://fenixflix.fenixhub.online/', type: 'file', resolucao: '2160p', audio: 'pt-BR' },
        { url: 'https://cdn.fenix.example/v/1080.m3u8', referer: 'https://fenixflix.fenixhub.online/', type: 'hls', resolucao: '1080p', audio: 'pt-BR' }] }];
    try {
        const h = rotas()['/api/playback/:id'];
        const res = resposta();
        await h({ params: { id: '969681' }, query: { transporte: 'servidor', codec: 'hevc', escolhida: 'fenixflix-fenixhub', u: midia.base64url('https://cdn.fenix.example/v/4k.mp4?t=aparelho'), altura: '1600' }, headers: {} }, res);
        assert.equal(res.codigo, 200);
        assert.equal(res.corpo.escolhaDoAparelho, true);
        assert.equal(res.corpo.resolucao, '1600p');
        assert.equal(res.corpo.type, 'file');
        assert.match(res.corpo.url, /^\/api\/hls\?u=/);
        assert.equal(midia.textoDeBase64url(new URLSearchParams(res.corpo.url.split('?')[1]).get('u')), 'https://cdn.fenix.example/v/4k.mp4?t=aparelho');
        assert.equal(disputou, false, 'não refaz a disputa');
    } finally { motor.fontesAtivas = original; avaliador.escolherMelhor = escolher; }
});

test('endereço que a fonte não devolve não é encaminhado (nada de proxy livre)', async () => {
    const original = motor.fontesAtivas;
    const avaliador = require('./avaliador'), escolher = avaliador.escolherMelhor;
    avaliador.escolherMelhor = async () => null;
    const escolherMotor = motor.escolher; motor.escolher = async () => null;
    motor.fontesAtivas = () => [{ id: 'fenixflix-fenixhub', papel: 'dublado', resolverTodos: async () => [{ url: 'https://cdn.fenix.example/v/4k.mp4', type: 'file' }] }];
    try {
        const h = rotas()['/api/playback/:id'];
        for (const u of ['https://outro.example/v/4k.mp4', 'https://cdn.fenix.example/outro.mp4', 'http://cdn.fenix.example/v/4k.mp4', 'https://127.0.0.1/v/4k.mp4']) {
            const res = resposta();
            await h({ params: { id: '969681' }, query: { escolhida: 'fenixflix-fenixhub', u: midia.base64url(u) }, headers: {} }, res);
            assert.notEqual(res.corpo?.escolhaDoAparelho, true, u);
        }
    } finally { motor.fontesAtivas = original; avaliador.escolherMelhor = escolher; motor.escolher = escolherMotor; }
});
