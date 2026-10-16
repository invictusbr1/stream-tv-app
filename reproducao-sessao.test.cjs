const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { criar } = require('./reproducao-sessao');

function ambiente() {
    let instante = 100;
    const eventos = [];
    const sessao = criar({ agora: () => instante, onEvent: e => eventos.push(e), sessao: 'teste_123' });
    return { sessao, eventos, tempo: n => { instante += n; }, definir: n => { instante = n; } };
}

test('primeira imagem inclui a busca da fonte; play sozinho não comprova abertura', () => {
    const a = ambiente();
    a.sessao.iniciar({});
    a.tempo(1300);
    a.sessao.fonte({ fonteId: 'mgeb', fonte: 'MGEB', audio: 'pt-BR', resolucao: '1280x720' });
    a.sessao.tocando(0);
    a.tempo(800);
    assert.equal(a.eventos.length, 0);
    assert.equal(a.sessao.estado().tempoAberturaMs, null);
    assert.equal(a.sessao.imagem(0.2), true);
    assert.equal(a.sessao.imagem(0.4), false);
    assert.equal(a.eventos.length, 1);
    assert.equal(a.eventos[0].tempoAberturaMs, 2100);
    assert.equal(a.eventos[0].resultado, 'abriu');
    assert.equal(a.eventos[0].tipo, 'reproducao');
    assert.equal(a.eventos[0].fonteId, 'mgeb');
});

test('mede buffering depois de imagem sem multiplicar eventos waiting repetidos', () => {
    const a = ambiente();
    a.sessao.iniciar({ fonteId: 'mgeb' });
    assert.equal(a.sessao.esperar(0), false);
    a.tempo(300);
    a.sessao.imagem(0.1);
    a.tempo(400);
    assert.equal(a.sessao.esperar(5), true);
    a.tempo(200);
    assert.equal(a.sessao.esperar(5), false);
    a.tempo(900);
    a.sessao.tocando(5.1);
    a.tempo(1000);
    a.sessao.esperar(7);
    a.tempo(450);
    a.sessao.encerrar('fechou', 7);
    assert.equal(a.eventos[1].travamentos, 2);
    assert.equal(a.eventos[1].tempoTravadoMs, 1550);
    assert.equal(a.eventos[1].posicao, 7);
});

test('pausa e busca cancelam espera e não contam o tempo parado ou de seek', () => {
    const a = ambiente();
    a.sessao.iniciar({});
    a.sessao.imagem(1);
    a.sessao.esperar(1);
    a.tempo(500);
    a.sessao.pausar(1);
    a.tempo(30000);
    assert.equal(a.sessao.esperar(1), false);
    a.sessao.tocando(1);
    a.sessao.esperar(4);
    a.tempo(800);
    a.sessao.buscar(600);
    a.tempo(10000);
    assert.equal(a.sessao.esperar(600), false);
    a.sessao.tocando(600);
    a.sessao.esperar(604);
    a.tempo(1000);
    a.sessao.tocando(604);
    assert.equal(a.sessao.estado().travamentos, 1);
    assert.equal(a.sessao.estado().tempoTravadoMs, 1000);
});

test('troca mantém sessão e separa posição, fonte, cronômetro e travamentos por tentativa', () => {
    const a = ambiente();
    a.sessao.iniciar({ fonteId: 'mgeb', fonte: 'MGEB' });
    a.tempo(1500);
    a.sessao.imagem(120);
    a.sessao.esperar(123);
    a.tempo(2500);
    a.sessao.iniciar({ fonteId: 'watchplay', fonte: 'WatchPlay' });
    a.tempo(450);
    a.sessao.imagem(123);
    assert.deepEqual(a.eventos.map(e => [e.sessao, e.tentativa, e.fonteId, e.resultado]), [
        ['teste_123', 1, 'mgeb', 'abriu'],
        ['teste_123', 1, 'mgeb', 'trocou'],
        ['teste_123', 2, 'watchplay', 'abriu']
    ]);
    assert.equal(a.eventos[1].tempoTravadoMs, 2500);
    assert.equal(a.eventos[2].tempoAberturaMs, 450);
    assert.equal(a.eventos[2].travamentos, 0);
    assert.equal(a.eventos[0].posicao, 120, 'evento anterior é um snapshot independente');
});

test('falha antes de imagem preserva abertura inconclusiva; fim é idempotente', () => {
    const a = ambiente();
    a.sessao.iniciar({ fonteId: 'fonte_a' });
    a.tempo(20000);
    assert.equal(a.sessao.falha('sem_imagem', 30), true);
    assert.equal(a.eventos[0].tempoAberturaMs, null);
    assert.equal(a.eventos[0].travamentos, 0);
    assert.equal(a.eventos[0].motivo, 'sem_imagem');
    assert.equal(a.sessao.encerrar('fechou', 40), false);
    assert.equal(a.sessao.falha('segunda_falha', 50), false);
    assert.equal(a.sessao.imagem(55), false);
    assert.equal(a.eventos.length, 1);
    assert.equal(a.sessao.estado().posicao, 30);
});

test('não vaza URLs, parâmetros ou objetos em metadados e limita números e tentativas', () => {
    const a = ambiente();
    a.sessao.iniciar({ fonteId: 'https://video.example/?token=secreto', fonte: 'MGEB?token=secreto',
        audio: { senha: 'secreto' }, resolucao: '720p'.repeat(100), url: 'https://video.example/' });
    a.tempo(1e12);
    a.sessao.imagem(1e20);
    a.sessao.esperar(Infinity);
    a.tempo(1e12);
    a.sessao.falha('erro https://video.example/?token=secreto', NaN);
    const final = a.eventos[1];
    assert.equal(final.fonteId, '');
    assert.equal(final.fonte, '');
    assert.equal(final.audio, '');
    assert.equal(final.resolucao.length, 40);
    assert.equal(final.motivo, '');
    assert.equal(final.tempoAberturaMs, 604800000);
    assert.equal(final.tempoTravadoMs, 604800000);
    assert.equal(final.posicao, 31536000);
    assert(!JSON.stringify(final).includes('secreto'));
    for (let n = 2; n <= 20; n++) {
        assert.equal(a.sessao.iniciar({ fonteId: 'mgeb' }).tentativa, n);
        a.sessao.falha('falhou', 0);
    }
    assert.equal(a.sessao.iniciar({}), null);
    assert.equal(a.sessao.estado().tentativa, 20);
    assert.equal(a.eventos.length, 21);
});

test('clock regressivo e callback quebrado não geram duração negativa nem interrompem player', () => {
    let instante = 500;
    const sessao = criar({ agora: () => instante, onEvent() { throw Error('rede indisponível'); } });
    sessao.iniciar({});
    instante = 100;
    assert.equal(sessao.imagem(0), true);
    assert.equal(sessao.estado().tempoAberturaMs, 0);
    sessao.esperar(10);
    instante = NaN;
    sessao.tocando(10);
    assert.equal(sessao.estado().tempoTravadoMs, 0);
    assert.equal(sessao.encerrar('fechou'), true);
});

test('UMD funciona em WebView com crypto e com fallback local sem dependências', () => {
    const codigo = fs.readFileSync(__dirname + '/reproducao-sessao.js', 'utf8');
    const navegador = vm.createContext({ crypto: { getRandomValues(bytes) { bytes.fill(7); return bytes; } } });
    vm.runInContext(codigo, navegador);
    assert.equal(vm.runInContext('StreamPlaybackSession.criar().estado().sessao', navegador), 'rp_' + '07'.repeat(16));
    const antigo = vm.createContext({});
    vm.runInContext(codigo, antigo);
    const ids = vm.runInContext('[StreamPlaybackSession.criar().estado().sessao, StreamPlaybackSession.criar().estado().sessao]', antigo);
    assert.match(ids[0], /^rp_local_[a-z0-9_]+$/);
    assert.notEqual(ids[0], ids[1]);
    assert.equal(vm.runInContext('StreamPlaybackSession.criar({sessao:"https://segredo.example/?token=x"}).estado().sessao.includes("segredo")', antigo), false);
});
