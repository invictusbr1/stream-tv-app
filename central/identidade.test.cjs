const test = require('node:test');
const assert = require('node:assert/strict');
const identidade = require('./identidade');
const { notaDoFornecedor } = require('./cacador');
const { CATEGORIAS, avaliarPromocao, PADRAO_APP } = require('./cacador');

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

test('o caçador cobre as cinco categorias, com amostras e candidatas', () => {
    const ids = CATEGORIAS.map(c => c.id);
    assert.deepEqual(ids, ['filme', 'serie', 'anime', 'dorama', 'tv-online']);
    for (const categoria of CATEGORIAS) {
        assert.ok((categoria.candidatas || []).length >= 3, categoria.id + ' precisa de candidatas');
        if (categoria.id === 'tv-online') assert.ok(categoria.listas.length >= 5, 'a TV ao vivo precisa de várias listas');
        else assert.ok(categoria.amostras.length >= 6, categoria.id + ' precisa de pelo menos 6 títulos de teste');
    }
    // Fonte que não se aplica à categoria (ex.: PipocaCine em série) não conta
    // como falha nem entra na média.
    const comPuladas = notaDoFornecedor([
        { ok: true, ms: 800, dublado: true, altura: 720 },
        { ok: false, ms: 0, pulada: true }
    ]);
    assert.equal(comPuladas.detalhes.testes, 1);
    assert.equal(comPuladas.nota > 8, true);
});

test('a régua de promoção mantém, promove, rebaixa ou descarta cada fonte', () => {
    // Padrão do app: dublado, sem anúncio, 720p+, metade dos testes abrindo, nota 7+.
    const aprovada = avaliarPromocao({
        nome: 'Fonte boa', nota: 9.1, papel: 'dublado',
        detalhes: { testes: 6, sucessos: 6, dublados: 6, melhorQualidade: '1080p', taxaSucesso: 100 }, noApp: false
    });
    assert.equal(aprovada.decisao, 'promover');

    const jaNoApp = avaliarPromocao({
        nome: 'Fonte atual', nota: 9.1, papel: 'dublado', noApp: true,
        detalhes: { testes: 6, sucessos: 5, dublados: 5, melhorQualidade: '720p', taxaSucesso: 83 }
    });
    assert.equal(jaNoApp.decisao, 'manter');

    const semDublado = avaliarPromocao({
        nome: 'Só original', nota: 8, papel: 'hd',
        detalhes: { testes: 6, sucessos: 6, dublados: 0, melhorQualidade: '1080p', taxaSucesso: 100 }, noApp: false
    });
    assert.equal(semDublado.decisao, 'descartar');
    assert.match(semDublado.motivo, /português/);

    const qualidadeBaixa = avaliarPromocao({
        nome: 'Qualidade baixa', nota: 7.5, papel: 'dublado',
        detalhes: { testes: 6, sucessos: 6, dublados: 6, melhorQualidade: '480p', taxaSucesso: 100 }, noApp: false
    });
    assert.equal(qualidadeBaixa.decisao, 'descartar');
    assert.match(qualidadeBaixa.motivo, /abaixo do padrão/);

    const segunda = avaliarPromocao({
        nome: 'Fonte fraca mas do app', nota: 2.6, papel: 'dublado', noApp: true,
        detalhes: { testes: 6, sucessos: 2, dublados: 2, melhorQualidade: '—', taxaSucesso: 33 }
    });
    assert.equal(segunda.decisao, 'segunda opcao', 'fonte que já está no app vira segunda opção, não descarte');

    const novaFraca = avaliarPromocao({
        nome: 'Candidata fraca', nota: 2.6, papel: 'dublado', noApp: false,
        detalhes: { testes: 6, sucessos: 0, dublados: 0, melhorQualidade: '—', taxaSucesso: 0 }
    });
    assert.equal(novaFraca.decisao, 'descartar', 'candidata nova que não abre é descartada');

    const anuncio = avaliarPromocao({ nome: 'Com anúncio', nota: 0, situacao: 'descartada', motivo: 'página com anúncio' });
    assert.equal(anuncio.decisao, 'descartar');
    assert.equal(PADRAO_APP.alturaMinima, 720);
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
