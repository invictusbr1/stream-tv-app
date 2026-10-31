'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { relatorio, mediana } = require('./relatorio');
test('relatório da semana: de primeira, com troca, falhas, fontes e quem teve problema', () => {
    const agora = Date.parse('2026-10-31T12:00:00Z');
    const s = (dia, nome, titulo, tentativas) => ({ criadoEm: `2026-10-${dia}T10:00:00Z`, nome, titulo, tentativas });
    const r = relatorio([
        s(30, 'Marlon', 'Mario', [{ fonteId: 'bestcine', resultado: 'abriu', tempoAberturaMs: 4000, travamentos: 1, tempoTravadoMs: 2000 }]),
        s(30, 'Laryssa', 'Quem Ama Cuida · T1 E137', [{ fonteId: 'froststream', resultado: 'falhou' }, { fonteId: 'mgeb', resultado: 'falhou' }]),
        s(29, 'Laryssa', 'Dexter · T1 E2', [{ fonteId: 'clickhost', resultado: 'falhou' }, { fonteId: 'mgeb', resultado: 'abriu', tempoAberturaMs: 9000 }]),
        s(10, 'Velho', 'Fora da semana', [{ fonteId: 'x', resultado: 'falhou' }]),
    ], { agora });
    assert.equal(r.total, 3);
    assert.equal(r.deprimeira, 1); assert.equal(r.comTroca, 1); assert.equal(r.falharam, 1);
    assert.equal(r.taxaQueAbriu, 67);
    assert.equal(r.aberturaMedianaMs, 6500);
    assert.equal(r.pessoas[0].nome, 'Laryssa'); assert.equal(r.pessoas[0].falhas, 1);
    assert.deepEqual(r.titulosQueFalharam, [{ titulo: 'Quem Ama Cuida · T1 E137', vezes: 1 }]);
    const mgeb = r.fontes.find(f => f.id === 'mgeb'); assert.equal(mgeb.abriu, 1); assert.equal(mgeb.falhou, 1); assert.equal(mgeb.taxa, 50);
    assert.equal(mediana([]), null);
});
