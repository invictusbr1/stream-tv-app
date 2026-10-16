const test = require('node:test');
const assert = require('node:assert/strict');
const locais = require('./perfis-locais');
const motor = require('./perfis-motor');

test('a suspensão publicada desativa a cópia antiga sem apagar outras fontes locais', () => {
    const base = { atualizadoEm: '', perfis: [{ id: 'suspensa', ativo: true, urlMovie: 'https://site.test/f/{id}' }, { id: 'reserva', ativo: true }], listasTv: [], placar: [] };
    const remoto = { atualizadoEm: '2026-10-12T00:00:00Z', perfis: [{ id: 'suspensa', ativo: false }], listasTv: [], placar: [] };
    const resultado = locais.juntar(base, remoto);
    assert.equal(resultado.perfis.find(p => p.id === 'suspensa').ativo, false);
    assert.deepEqual(motor.perfisValidos(resultado.perfis).map(p => p.id), ['reserva']);
    assert.equal(base.perfis[0].ativo, true, 'a cópia original não é mutada');
});

test('sem snapshot remoto as fontes guardadas continuam disponíveis', () => {
    const base = { atualizadoEm: '', perfis: [{ id: 'reserva', ativo: true }], listasTv: [], placar: [] };
    assert.equal(locais.juntar(base, null), base);
    assert.deepEqual(motor.perfisValidos(locais.juntar(base, null).perfis).map(p => p.id), ['reserva']);
});
