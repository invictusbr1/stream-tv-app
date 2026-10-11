const test = require('node:test');
const assert = require('node:assert/strict');
const { cacarMininovelas } = require('./cacador-mininovelas');
test('caçador de mininovelas deixa fornecedor sem conector pendente e não promove catálogo sem vídeo', async () => {
    const resultado = await cacarMininovelas({ buscar:async () => { throw Error('fora do ar'); }, tocar:async () => { throw Error('Não deve chamar'); } });
    assert.equal(resultado.candidatas.length,7);
    assert.equal(resultado.candidatas.filter(c => c.situacao === 'pendente').length,5);
    assert.deepEqual(resultado.ranking,[]);
    assert.ok(resultado.candidatas.every(c => c.situacao !== 'promover'));
});
