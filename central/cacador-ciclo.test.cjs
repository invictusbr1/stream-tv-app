const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { criarCacador, CATEGORIAS } = require('./cacador');
const armazenamento = require('./armazenamento');
function pasta(t) { const p = fs.mkdtempSync(path.join(os.tmpdir(), 'cacador-ciclo-')); t.after(() => fs.rmSync(p, { recursive:true, force:true })); return p; }

test('erro numa categoria preserva resultado anterior e não impede as outras categorias', async t => {
    const dir = pasta(t); armazenamento.gravarJson(path.join(dir,'fontes.json'), { porCategoria:{ filme:{ id:'filme', ranking:[{nome:'Fonte anterior'}] } } });
    const cacador = criarCacador({ pastaDados:dir, publicarFichas:false, medirCategoria:async categoria => {
        if (categoria.id === 'filme') throw Error('falha de teste');
        return { id:categoria.id, ranking:[], candidatas:[] };
    } });
    const resultado = await cacador.cacar('todas');
    assert.equal(resultado.ultimaRodada.estado, 'parcial');
    assert.equal(resultado.ultimaRodada.categoriasMedidas, CATEGORIAS.length-1);
    assert.equal(resultado.porCategoria.filme.ranking[0].nome, 'Fonte anterior');
    assert.equal(cacador.rodando(), false); assert.equal(cacador.categoriaAtual(), '');
    assert.equal(cacador.ultimo().ultimaRodada.estado, 'parcial');
});

test('pausa cancela operação atual, evita sobreposição e permite retomar outra rodada', async t => {
    const dir = pasta(t); let entrou;
    const iniciado = new Promise(r => entrou=r);
    const cacador = criarCacador({ pastaDados:dir, publicarFichas:false, medirCategoria:async (categoria, {signal}) => {
        entrou(); await new Promise(resolve => signal.addEventListener('abort', resolve, {once:true}));
        return { id:categoria.id, ranking:[] };
    } });
    const rodada = cacador.cacar('filme'); await iniciado;
    assert.deepEqual(await cacador.cacar('serie'), { rodando:true });
    assert.equal(cacador.pausar(), true);
    assert.equal((await rodada).ultimaRodada.estado, 'pausada');
    assert.equal(cacador.pausar(), false); assert.equal(cacador.rodando(), false);
    await assert.rejects(cacador.cacar('inexistente'), /inválida/);
    assert.equal(cacador.rodando(), false);
});

test('orçamento encerra rodada sem substituir medições válidas por resultado incompleto', async t => {
    const dir = pasta(t);
    const cacador = criarCacador({ pastaDados:dir, publicarFichas:false, medirCategoria:async (categoria, {signal}) => {
        await new Promise(resolve => signal.addEventListener('abort', resolve, {once:true}));
        return { id:categoria.id, ranking:[{nome:'Resultado tardio'}] };
    } });
    const resultado = await cacador.cacar('filme', { prazoMs:5 });
    assert.equal(resultado.ultimaRodada.estado, 'pausada'); assert.equal(resultado.ultimaRodada.categoriasMedidas, 0);
    assert.equal(resultado.porCategoria.filme, undefined); assert.equal(cacador.rodando(), false);
});

test('histórico danificado recupera cópia anterior e não perde a gravação válida', t => {
    const dir = pasta(t), destino = path.join(dir,'fontes.json');
    armazenamento.gravarJson(destino, {porCategoria:{filme:{nome:'primeiro'}}});
    armazenamento.gravarJson(destino, {porCategoria:{filme:{nome:'segundo'}}});
    fs.writeFileSync(destino, '{arquivo interrompido');
    const cacador = criarCacador({pastaDados:dir,publicarFichas:false});
    assert.equal(cacador.ultimo().porCategoria.filme.nome, 'primeiro');
    assert.equal(fs.existsSync(destino+'.tmp'), false);
});

test('agendamento retoma categorias menos recentes e não reinicia sempre por filmes', () => {
    const { proximaCategoria } = require('./agendamento-cacador');
    const categorias = ['filme','serie','anime'];
    assert.equal(proximaCategoria(categorias), 'filme');
    assert.equal(proximaCategoria(categorias, {tentativasCategoria:{filme:'2026-10-12T12:00:00Z'}}), 'serie');
    assert.equal(proximaCategoria(categorias, {tentativasCategoria:{filme:'2026-10-12T12:00:00Z',serie:'2026-10-12T11:00:00Z',anime:'2026-10-12T13:00:00Z'}}), 'serie');
});
