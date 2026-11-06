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

test('upgrade=1: celular em 720p sobe para Full HD dublado medido da TorBox (com conversão) e ignora 720p', async () => {
    const avaliador = require('./avaliador'), escolher = avaliador.escolherMelhor;
    const conversor = require('./conversor'), iniciar = conversor.iniciar;
    let converteu = 0;
    conversor.iniciar = async (_url, op) => { converteu++; return { id: op.id + '-t1' }; };
    try {
        const h = rotas()['/api/playback/:id'];
        // 1) Servidor tem Full HD widescreen (1920 × 1036) dublado na TorBox -> entrega conversão 1080p.
        avaliador.escolherMelhor = async (_p, _a, op) => {
            assert.equal(op.semConversao, false);
            return {
                escolhido: { url: 'https://cdn.torbox.example/otto.mkv', audio: 'pt-BR', fonte: 'TorBox · dublado 1080p (conversão)', fonteId: 'torbox', resolucao: '1080p', converter: true, segredo: true },
                avaliacao: [{ fonteId: 'torbox', nota: 4.3, detalhes: { idioma: 'faixa em português é a padrão do arquivo', dimensoes: '1920 × 1036' } }],
            };
        };
        const r1 = resposta();
        await h({ params: { id: '937278' }, query: { transporte: 'servidor', conversao: '1', upgrade: '1', codec: 'hevc' }, headers: {} }, r1);
        assert.equal(r1.codigo, 200);
        assert.equal(r1.corpo.fonteId, 'torbox');
        assert.equal(r1.corpo.conversao, 'filme-937278-t1');
        assert.equal(converteu, 1);

        // 2) TorBox 1080p com conversão (ainda sem dimensoes medidas no avaliador, só rótulo 1080p e dublado confiável) -> também sobe para Full HD.
        avaliador.escolherMelhor = async () => ({
            escolhido: { url: 'https://cdn.torbox.example/otto.mkv', audio: 'pt-BR', fonte: 'TorBox · dublado 1080p (conversão)', fonteId: 'torbox', resolucao: '1080p', converter: true, segredo: true },
            avaliacao: [{ fonteId: 'torbox', nota: 4.7, detalhes: { idioma: 'dublado declarado na página da fonte', qualidade: '1080p informado pela fonte' } }],
        });
        const r1b = resposta();
        await h({ params: { id: '937278' }, query: { transporte: 'servidor', conversao: '1', upgrade: '1', codec: 'hevc' }, headers: {} }, r1b);
        assert.equal(r1b.codigo, 200);
        assert.equal(r1b.corpo.fonteId, 'torbox');
        assert.equal(converteu, 2);

        // 3) Servidor só tem 720p -> responde indisponivel:true sem iniciar conversão (celular mantém o 720p local).
        avaliador.escolherMelhor = async () => ({
            escolhido: { url: 'https://cdn.torbox.example/hd.mkv', audio: 'pt-BR', fonteId: 'torbox', resolucao: '720p', converter: true },
            avaliacao: [{ fonteId: 'torbox', nota: 4, detalhes: { idioma: 'faixa em português é a padrão do arquivo', dimensoes: '1280 × 720' } }],
        });
        const r2 = resposta();
        await h({ params: { id: '937278' }, query: { transporte: 'servidor', conversao: '1', upgrade: '1', codec: 'hevc' }, headers: {} }, r2);
        assert.equal(r2.codigo, 200);
        assert.equal(r2.corpo.indisponivel, true);
        assert.equal(converteu, 2, 'não inicia conversão de 720p no pedido de upgrade');
    } finally { avaliador.escolherMelhor = escolher; conversor.iniciar = iniciar; }
});

test('BsCine escolhida pelo aparelho não é encaminhada pela Oracle (cai na disputa do servidor)', async () => {
    const original = motor.fontesAtivas;
    const avaliador = require('./avaliador'), escolher = avaliador.escolherMelhor;
    let disputou = false;
    avaliador.escolherMelhor = async () => { disputou = true; return null; };
    const escolherMotor = motor.escolher; motor.escolher = async () => null;
    motor.fontesAtivas = () => [{ id: 'bscine-servidor', papel: 'dublado', resolverTodos: async () => [{ url: 'https://rfc-infinite.example/v/1.mp4', type: 'file' }] }];
    try {
        const h = rotas()['/api/playback/:id'];
        const res = resposta();
        await h({ params: { id: '937278' }, query: { transporte: 'servidor', escolhida: 'bscine-servidor', u: midia.base64url('https://rfc-infinite.example/v/1.mp4') }, headers: {} }, res);
        assert.equal(disputou, true);
    } finally { motor.fontesAtivas = original; avaliador.escolherMelhor = escolher; motor.escolher = escolherMotor; }
});

test('motor 1 (TorBox) abre direto quando tem Full HD; com 720p ou nada, motor=torbox responde indisponível e a fila normal segue', async () => {
    const tb = require('./torbox-source'), ativa = tb.ativa, resolverTodos = tb.resolverTodos;
    const avaliador = require('./avaliador'), escolher = avaliador.escolherMelhor;
    const conversor = require('./conversor'), iniciar = conversor.iniciar;
    let disputou = 0, opcoes = [];
    tb.ativa = () => true;
    tb.resolverTodos = async () => opcoes;
    avaliador.escolherMelhor = async () => { disputou++; return null; };
    conversor.iniciar = async (_url, op) => ({ id: op.id + '-m1', duracao: 7568 });
    try {
        const h = rotas()['/api/playback/:id'];
        opcoes = [{ url: 'https://cdn.torbox.example/otto.mkv', audio: 'pt-BR', fonte: 'TorBox · dublado 1080p (conversão)', resolucao: '1080p', converter: true, segredo: true }];
        const r1 = resposta();
        await h({ params: { id: '937278' }, query: { transporte: 'servidor', conversao: '1', motor: 'torbox' }, headers: {} }, r1);
        assert.equal(r1.corpo.fonteId, 'torbox');
        assert.equal(r1.corpo.conversao, 'filme-937278-m1');
        assert.equal(disputou, 0, 'motor 1 não espera o avaliador');
        assert.ok(!JSON.stringify(r1.corpo).includes('cdn.torbox.example'), 'link com a chave não vai ao aparelho');

        opcoes = [{ url: 'https://cdn.torbox.example/otto720.mkv', audio: 'pt-BR', resolucao: '720p', converter: true, segredo: true }];
        const r2 = resposta();
        await h({ params: { id: '937278' }, query: { transporte: 'servidor', conversao: '1', motor: 'torbox' }, headers: {} }, r2);
        assert.deepEqual(r2.corpo, { indisponivel: true });
        assert.equal(disputou, 0);

        // Tela larga (rótulo 1036p) é Full HD: motor 1 aceita (régua de 800p).
        opcoes = [{ url: 'https://cdn.torbox.example/otto-largo.mkv', audio: 'pt-BR', resolucao: '1036p', converter: true, segredo: true }];
        const r2b = resposta();
        await h({ params: { id: '937278' }, query: { transporte: 'servidor', conversao: '1', motor: 'torbox' }, headers: {} }, r2b);
        assert.equal(r2b.corpo.fonteId, 'torbox');
        opcoes = [{ url: 'https://cdn.torbox.example/otto720.mkv', audio: 'pt-BR', resolucao: '720p', converter: true, segredo: true }];
        // Sem ?motor: 720p da TorBox não serve para o motor 1 → motor 2 (avaliador).
        const r3 = resposta();
        await h({ params: { id: '937278' }, query: {}, headers: {} }, r3);
        assert.equal(disputou, 1);

        // APK antigo (sem conversao=1): MKV não serve, cai no motor 2.
        opcoes = [{ url: 'https://cdn.torbox.example/otto.mkv', audio: 'pt-BR', resolucao: '1080p', converter: true, segredo: true }];
        const r4 = resposta();
        await h({ params: { id: '937278' }, query: { transporte: 'servidor', motor: 'torbox' }, headers: {} }, r4);
        assert.deepEqual(r4.corpo, { indisponivel: true });
    } finally { tb.ativa = ativa; tb.resolverTodos = resolverTodos; avaliador.escolherMelhor = escolher; conversor.iniciar = iniciar; }
});
