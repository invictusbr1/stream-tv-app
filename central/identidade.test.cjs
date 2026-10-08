const test = require('node:test');
const assert = require('node:assert/strict');
const identidade = require('./identidade');
const { notaDoFornecedor } = require('./cacador');

test('a central reconhece o aplicativo Android e o iPhone', () => {
    assert.equal(identidade.tipoDeAparelho({ app: 'android', aparelho: 'Celular Android' }), 'Aplicativo Android');
    assert.equal(identidade.tipoDeAparelho({ app: 'android', aparelho: 'TV ou TV box' }), 'Aplicativo Android (TV)');
    assert.equal(identidade.tipoDeAparelho({ navegador: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' }), 'iPhone / iPad');
    assert.equal(identidade.tipoDeAparelho({ navegador: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }), 'Computador');
    assert.equal(identidade.tipoDeAparelho({ app: 'desktop' }), 'Computador');
});

test('o IP diz de onde o aparelho está falando', () => {
    assert.equal(identidade.classificarIp('192.168.1.6').rede, 'casa');
    assert.equal(identidade.classificarIp('10.0.0.7').rede, 'casa');
    assert.equal(identidade.classificarIp('100.65.126.110').rede, 'tailscale');
    assert.equal(identidade.classificarIp('177.20.10.5').rede, 'internet');
    assert.equal(identidade.classificarIp('127.0.0.1').rede, 'propria');
    assert.match(identidade.classificarIp('100.65.126.110').rotulo, /Tailscale/);
});

test('a nota do fornecedor segue as regras: dublado, sem anúncio e HD', () => {
    const dubladoHd = notaDoFornecedor([
        { ok: true, ms: 900, dublado: true, altura: 720 },
        { ok: true, ms: 1200, dublado: true, altura: 720 }
    ]);
    const original1080 = notaDoFornecedor([
        { ok: true, ms: 2500, dublado: false, altura: 1080 },
        { ok: true, ms: 3000, dublado: false, altura: 1080 }
    ]);
    const instavel = notaDoFornecedor([
        { ok: true, ms: 9000, dublado: false, altura: 720 },
        { ok: false, ms: 9000 }
    ]);
    assert.ok(dubladoHd.nota > original1080.nota, 'dublado ganha de Full HD sem dublagem');
    assert.ok(original1080.nota > instavel.nota, 'fonte instável fica atrás');
    assert.ok(dubladoHd.nota >= 8, 'fonte dublada, rápida e HD tira nota alta');
    assert.equal(notaDoFornecedor([]).nota, 0);
    assert.equal(dubladoHd.detalhes.taxaSucesso, 100);
});

test('o agente só investiga título válido e guarda o caso', async () => {
    const fs = require('node:fs');
    const os = require('node:os');
    const path = require('node:path');
    const { criarAgente } = require('./agente');
    const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'agente-teste-'));
    const agente = criarAgente({ pastaDados: pasta, appUrl: 'http://127.0.0.1:1', codigoApp: '' });

    assert.equal(agente.registrarFalha({ titulo: 'sem id', motivo: 'x' }), null, 'sem id não entra na fila');
    const caso = agente.registrarFalha({ id: '1399', temporada: '1', numero: '2', episodio: 'T1E2', titulo: 'Série teste', motivo: 'player não abriu' });
    assert.equal(caso.alvo.tipo, 'tv');
    assert.equal(caso.alvo.temporada, '1');
    assert.equal(caso.estado, 'pendente');
    const resumo = agente.resumo();
    assert.equal(resumo.total, 1);
    assert.equal(resumo.pendentes, 1);
    fs.rmSync(pasta, { recursive: true, force: true });
});
