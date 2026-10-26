const test = require('node:test');
const assert = require('node:assert/strict');
const politica = require('./politica-fontes');

test('toda fonte fixa do motor tem prioridade e papel no arquivo de regras', () => {
    const { FONTES } = require('./fontes-motor');
    for (const fonte of FONTES) {
        const regra = politica.REGRAS.fontes[fonte.id];
        assert.ok(regra, `falta "${fonte.id}" em politica-fontes.json`);
        assert.ok(Number.isFinite(regra.prioridade), `prioridade inválida para ${fonte.id}`);
        assert.equal(regra.papel, fonte.papel, `papel diferente para ${fonte.id}`);
        assert.equal(fonte.peso, undefined, `${fonte.id} não deve ter peso escrito no motor`);
    }
});

test('regra 1: fonte com anúncio nunca entra na fila', () => {
    const fontes = [
        { id: 'limpa', papel: 'dublado', peso: 50 },
        { id: 'com-anuncio', papel: 'dublado', peso: 999, anuncio: true },
        { id: 'ficha-suja', papel: 'dublado', peso: 999, semAnuncio: false },
    ];
    assert.deepEqual(politica.ordenar(fontes, 'dublado').map(i => i.fonte.id), ['limpa']);
});

test('regra 2: dublado comprovado em 720p vence legendado em 1080p', () => {
    const dublado720 = politica.prioridadeDaMedicao({ dados: { audio: 'pt-BR' }, sonda: { largura: 1280, altura: 720, audios: [{ lang: 'pt' }] }, ms: 3000 });
    const legendado1080 = politica.prioridadeDaMedicao({ dados: { audio: 'original' }, sonda: { largura: 1920, altura: 1080, audios: [{ lang: 'en' }] }, ms: 500 });
    assert.ok(politica.compararPrioridade(dublado720, legendado1080) < 0);
});

test('regra 3: entre dubladas, a qualidade medida decide antes da velocidade', () => {
    const rapida720 = politica.prioridadeDaMedicao({ dados: {}, sonda: { largura: 1280, altura: 720, portuguesa: true }, ms: 200 });
    const lenta1080 = politica.prioridadeDaMedicao({ dados: {}, sonda: { largura: 1920, altura: 1080, portuguesa: true }, ms: 5000 });
    assert.ok(politica.compararPrioridade(lenta1080, rapida720) < 0);
});

test('prioridade do arquivo de regras manda; castigo joga a fonte para o fim', () => {
    const fontes = [{ id: 'watchplay', papel: 'dublado', peso: 1 }, { id: 'pipoca', papel: 'dublado' }, { id: 'nova', papel: 'dublado', peso: 10 }];
    const agora = Date.now();
    let ordem = politica.ordenar(fontes, 'dublado', null, { agora }).map(i => i.fonte.id);
    assert.deepEqual(ordem, ['pipoca', 'watchplay', 'nova']);
    ordem = politica.ordenar(fontes, 'dublado', null, { agora, saudeDe: id => id === 'pipoca' ? { castigoAte: agora + 60000 } : {} }).map(i => i.fonte.id);
    assert.deepEqual(ordem, ['watchplay', 'nova', 'pipoca']);
});

test('ficha do caçador: prioridade sai da nota pela fórmula da política', () => {
    assert.equal(politica.prioridadeDaFicha(8), 84);
    assert.equal(politica.prioridade({ id: 'ficha-x', perfil: true, notaDaFicha: 10 }), 90);
});

test('diagnóstico explica a fila com motivos', () => {
    const motor = require('./fontes-motor');
    const fila = motor.explicar({ tipo: 'movie', tmdbId: '550' });
    assert.ok(Array.isArray(fila.regra) && fila.regra.length >= 3);
    assert.ok(fila.dublado.length > 0 && fila.dublado[0].motivos.length > 0);
    assert.ok(fila.dublado.every(item => item.posicao > 0));
});
