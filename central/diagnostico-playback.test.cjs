const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { criarDiagnostico, normalizarEvento, textoSeguro } = require('./diagnostico-playback');
const { criarPlacar } = require('./placar');

const AGORA = Date.parse('2026-10-12T18:00:00.000Z');
function ambiente(t, opcoes = {}) {
    const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'diagnostico-playback-'));
    t.after(() => fs.rmSync(pasta, { recursive: true, force: true }));
    return { pasta, registro: criarDiagnostico({ pastaDados: pasta, agora: () => AGORA, ...opcoes }) };
}
function evento(campos = {}) {
    return { em: new Date(AGORA).toISOString(), tipo: 'play', sessao: 'sessao-1', tentativa: 1, dispositivo: 'celular-1', nome: 'Pessoa', aparelho: 'Android', id: '123', titulo: 'Filme de teste', fonteId: 'mgeb', fonte: 'MegaEmbed', ...campos };
}

test('conecta falha e recuperação sem misturar as medições de duas fontes', t => {
    const { registro } = ambiente(t);
    registro.registrar(evento());
    registro.registrar(evento({ tipo: 'falha', resultado: 'falhou', motivo: 'rede indisponível', posicao: 137, travamentos: 2, tempoTravadoMs: 9100 }));
    registro.registrar(evento({ tipo: 'reproducao', resultado: 'trocou', posicao: 137, travamentos: 2, tempoTravadoMs: 9100 }));
    registro.registrar(evento({ tentativa: 2, fonteId: 'watchplay', fonte: 'WatchPlay', recuperacoes: 1 }));
    registro.registrar(evento({ tentativa: 2, fonteId: 'watchplay', fonte: 'WatchPlay', tipo: 'confirmacao', tempoAberturaMs: 1430, resolucao: '720p', posicao: 158, recuperacoes: 1 }));
    const [sessao] = registro.resumo().sessoes;
    assert.equal(sessao.tentativas.length, 2);
    assert.equal(sessao.tentativas[0].resultado, 'trocou');
    assert.equal(sessao.tentativas[0].posicao, 137);
    assert.equal(sessao.tentativas[0].tempoAberturaMs, null);
    assert.equal(sessao.tentativas[1].tempoAberturaMs, 1430);
    assert.equal(sessao.tentativas[1].travamentos, 0);
    assert.equal(sessao.resultado, 'abriu');
    assert.equal(sessao.recuperacoes, 1);
    assert.equal(sessao.travamentos, 2);
    assert.equal(sessao.tempoTravadoMs, 9100);
});

test('mantém o fechamento diante de confirmação atrasada e contadores menores', t => {
    const { registro } = ambiente(t);
    registro.registrar(evento({ tipo: 'reproducao', resultado: 'fechou', tempoAberturaMs: 1000, travamentos: 3, tempoTravadoMs: 6000, posicao: 245 }));
    registro.registrar(evento({ tipo: 'confirmacao', tempoAberturaMs: 800, travamentos: 1, tempoTravadoMs: 1000 }));
    const tentativa = registro.resumo().sessoes[0].tentativas[0];
    assert.equal(tentativa.resultado, 'fechou');
    assert.equal(tentativa.tempoAberturaMs, 1000);
    assert.equal(tentativa.travamentos, 3);
    assert.equal(tentativa.tempoTravadoMs, 6000);
    assert.equal(tentativa.posicao, 245);
});

test('normaliza números finitos e rejeita sessão/tentativa que não identificam uma tentativa real', () => {
    assert.equal(normalizarEvento({ sessao: 'https://exemplo.test/?token=x', tentativa: 1 }), null);
    assert.equal(normalizarEvento({ sessao: 'x'.repeat(65), tentativa: 1 }), null);
    for (const tentativa of [0, -1, 21, 1.5, Infinity]) assert.equal(normalizarEvento({ sessao: 's-1', tentativa }), null);
    const medidas = normalizarEvento({ sessao: 's-1', tentativa: 1, resultado: 'invalido', tempoAberturaMs: Infinity, travamentos: -1, posicao: null, tempoTravadoMs: 1e20, recuperacoes: 1000 });
    assert.equal(medidas.resultado, '');
    assert.equal(medidas.tempoAberturaMs, null);
    assert.equal(medidas.travamentos, null);
    assert.equal(medidas.posicao, null);
    assert.equal(medidas.tempoTravadoMs, 86400000);
    assert.equal(medidas.recuperacoes, 20);
});

test('não guarda URLs assinadas, credenciais ou campos extras no diagnóstico', t => {
    const { registro, pasta } = ambiente(t);
    registro.registrar(evento({ tipo: 'falha', motivo: 'Erro em https://video.test/filme?token=segredo-dummy Authorization=teste-dummy', fonteId: 'https://video.test/', url: 'https://video.test/', token: 'teste-dummy' }));
    const json = fs.readFileSync(path.join(pasta, 'reproducao.json'), 'utf8');
    assert.doesNotMatch(json, /https:|segredo-dummy|teste-dummy/);
    assert.equal(registro.resumo().sessoes[0].tentativas[0].fonteId, undefined);
    assert.match(textoSeguro('Bearer teste-dummy senha=teste-dummy'), /omitid/);
});

test('aparelhos distintos não compartilham tentativas mesmo com o mesmo identificador de sessão', t => {
    const { registro } = ambiente(t);
    registro.registrar(evento({ dispositivo: 'celular-1', tipo: 'confirmacao', resolucao: '720p' }));
    registro.registrar(evento({ dispositivo: 'tv-1', tipo: 'falha' }));
    assert.equal(registro.resumo().total, 2);
    assert.equal(registro.resumo().sessoes.find(s => s.dispositivo === 'celular-1').resultado, 'abriu');
    assert.equal(registro.resumo().sessoes.find(s => s.dispositivo === 'tv-1').resultado, 'falhou');
});

test('limita histórico, quantidade e idade das sessões persistidas', t => {
    const { registro } = ambiente(t, { limites: { sessoes: 2, historico: 3, dias: 1 } });
    assert.equal(registro.registrar(evento({ em: new Date(AGORA - 2 * 86400000).toISOString() })), null);
    for (let i = 0; i < 7; i++) registro.registrar(evento({ em: new Date(AGORA + i).toISOString() }));
    assert.equal(registro.resumo().sessoes[0].tentativas[0].historico.length, 3);
    registro.registrar(evento({ sessao: 's-2', em: new Date(AGORA + 10).toISOString() }));
    registro.registrar(evento({ sessao: 's-3', em: new Date(AGORA + 20).toISOString() }));
    assert.deepEqual(registro.resumo().sessoes.map(s => s.sessao), ['s-3', 's-2']);
});

test('recupera o backup após escrita corrompida e preserva as medições e histórico', t => {
    const { registro, pasta } = ambiente(t);
    registro.registrar(evento());
    registro.registrar(evento({ tipo: 'confirmacao', tempoAberturaMs: 1530, posicao: 100, resolucao: '720p' }));
    registro.registrar(evento({ tipo: 'reproducao', resultado: 'fechou', posicao: 200 }));
    fs.writeFileSync(path.join(pasta, 'reproducao.json'), '{arquivo interrompido');
    const recuperado = criarDiagnostico({ pastaDados: pasta, agora: () => AGORA });
    const tentativa = recuperado.resumo().sessoes[0].tentativas[0];
    assert.equal(tentativa.resultado, 'abriu');
    assert.equal(tentativa.tempoAberturaMs, 1530);
    assert.equal(tentativa.posicao, 100);
    assert.equal(tentativa.historico.length, 2);
    recuperado.registrar(evento({ tipo: 'reproducao', resultado: 'concluiu', posicao: 200 }));
    assert.equal(JSON.parse(fs.readFileSync(path.join(pasta, 'reproducao.json'), 'utf8')).sessoes[0].tentativas[0].resultado, 'concluiu');
});

test('uma falha de disco fica visível sem perder o relato em memória', t => {
    const { registro, pasta } = ambiente(t);
    fs.mkdirSync(path.join(pasta, 'reproducao.json'));
    registro.registrar(evento({ tipo: 'reproducao', resultado: 'fechou' }));
    assert.equal(registro.resumo().total, 1);
    assert.match(registro.resumo().persistenciaErro, /gravar/);
});

test('API autenticada registra resumo sem duplicar sucesso/falha nem criar investigação', async t => {
    const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'diagnostico-playback-api-'));
    const reserva = net.createServer();
    await new Promise(resolve => reserva.listen(0, '127.0.0.1', resolve));
    const porta = reserva.address().port;
    await new Promise(resolve => reserva.close(resolve));
    const chave = 'painel-teste-diagnostico';
    const token = 'relato-teste-diagnostico';
    const filho = spawn(process.execPath, [path.join(__dirname, 'servidor.js')], {
        cwd: pasta,
        env: { ...process.env, NODE_ENV: 'test', PORT: String(porta), CENTRAL_KEY: chave, CENTRAL_TOKEN: token, CENTRAL_DADOS: pasta, APP_URL: 'http://127.0.0.1:9' }, stdio: 'ignore',
    });
    t.after(async () => {
        if (filho.exitCode === null && filho.signalCode === null) await new Promise(resolve => { filho.once('exit', resolve); filho.kill(); });
        fs.rmSync(pasta, { recursive: true, force: true });
    });
    const base = `http://127.0.0.1:${porta}`;
    const limite = Date.now() + 15000;
    while (true) {
        try { if ((await fetch(base + '/api/health')).ok) break; } catch { /* iniciando */ }
        if (Date.now() > limite) throw new Error('a central não iniciou');
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal((await fetch(base + '/api/reproducao')).status, 401);
    const enviar = campos => fetch(base + '/api/evento', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Central': token }, body: JSON.stringify(evento(campos)) });
    assert.equal((await enviar({ sessao: 'url/invalida', tipo: 'reproducao', resultado: 'fechou' })).status, 400);
    assert.equal((await enviar({ tipo: 'play' })).status, 200);
    assert.equal((await enviar({ tipo: 'reproducao', resultado: 'fechou', ok: false, tempoAberturaMs: 1700, posicao: 50, travamentos: 2, tempoTravadoMs: 2000 })).status, 200);
    assert.equal((await enviar({ tipo: 'reproducao', resultado: 'falhou', tentativa: 2, fonteId: 'watchplay', fonte: 'WatchPlay', motivo: 'https://video.test/?token=segredo-dummy' })).status, 200);
    // Aplicativos antigos continuam relatando sem fornecer os campos novos.
    assert.equal((await enviar({ sessao: undefined, tentativa: undefined, fonteId: 'pipoca', fonte: 'Pipoca', tipo: 'play' })).status, 200);
    const r = await fetch(base + '/api/reproducao', { headers: { 'X-Chave': chave } });
    assert.equal(r.status, 200);
    const resumo = await r.json();
    assert.equal(resumo.total, 1);
    assert.equal(resumo.sessoes[0].tentativas.length, 2);
    assert.equal(resumo.sessoes[0].tentativas[0].tempoAberturaMs, 1700);
    assert.equal(resumo.sessoes[0].tentativas[0].resultado, 'fechou');
    assert.equal(resumo.sessoes[0].tentativas[1].resultado, 'falhou');
    assert.equal(fs.existsSync(path.join(pasta, 'investigacoes.json')), false);
    const titulos = JSON.parse(fs.readFileSync(path.join(pasta, 'titulos.json'), 'utf8'));
    assert.equal(titulos['movie:123'].falhas, undefined);
    assert.equal(titulos['movie:123'].historico.length, 2);
    const placar = criarPlacar({ arquivoEventos: path.join(pasta, 'eventos.ndjson') });
    const linhas = placar.atualizar();
    assert.equal(linhas.find(f => f.id === 'mgeb').aberturas, 1);
    assert.equal(linhas.some(f => f.id === 'watchplay'), false);
    assert.equal(linhas.find(f => f.id === 'pipoca').aberturas, 1);
    const status = await (await fetch(base + '/api/status', { headers: { 'X-Chave': chave } })).json();
    assert.equal(status.reproducaoDiagnostico.total, 1);
    assert.equal(status.resumo.sessoesHoje, 2);
    assert.equal(status.resumo.falhasHoje, 0);
    assert.equal(status.fontes.find(f => f.fonte === 'MegaEmbed').total, 1);
    assert.equal(status.fontes.some(f => f.fonte === 'WatchPlay'), false);
    assert.doesNotMatch(fs.readFileSync(path.join(pasta, 'eventos.ndjson'), 'utf8'), /segredo-dummy|https:\/\/video/);
});
