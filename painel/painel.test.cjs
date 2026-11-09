'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const p = require('./painel.cjs');

test('links colados: só http(s)/stremio, sem repetir, até 30', () => {
    assert.deepEqual(p.limparLinks('https://a.example/x\n\nhttps://a.example/x,  stremio://b.example/manifest.json\njavascript:alert(1)\nftp://c'), ['https://a.example/x', 'stremio://b.example/manifest.json']);
    assert.equal(p.limparLinks(Array.from({ length: 50 }, (_, i) => 'https://s' + i + '.example').join('\n')).length, 30);
});

test('links sem https:// são completados', () => {
    assert.deepEqual(p.limparLinks('bscine.alwaysdata.net\nmagnetflix.flixbr.online\npleiadesstream.duckdns.org/x\nnada'), ['https://bscine.alwaysdata.net', 'https://magnetflix.flixbr.online', 'https://pleiadesstream.duckdns.org/x']);
});

test('IP da TV: só IPv4 válido entra no comando', () => {
    assert.equal(p.ipValido(' 192.168.1.7 '), '192.168.1.7');
    assert.equal(p.ipValido("1.2.3.4'; calc"), '');
    assert.equal(p.ipValido('300.1.1.1'), '');
});

test('comandos: links viram arquivo para --paginas; Windows usa cmd/powershell sem injeção', () => {
    const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'painel-'));
    const c = p.montarComando('cacador-links', { links: 'https://site.example/filme/1' }, { raiz: 'C:\\stream tv', windows: true, pastaDados: pasta });
    assert.match(c.args[3], /Cacador-PC\.cmd" "--paginas" "/);
    assert.equal(fs.readFileSync(path.join(pasta, 'links-do-painel.txt'), 'utf8'), 'https://site.example/filme/1\n');
    assert.equal(p.montarComando('cacador-links', { links: 'nada' }).erro, 'cole pelo menos um link (https://…)');
    const d = p.montarComando('samsung-diagnostico', { ip: '192.168.1.7' }, { raiz: 'C:\\Área de Trabalho\\stream tv', windows: true });
    const script = Buffer.from(d.args[d.args.length - 1], 'base64').toString('utf16le');
    assert.match(script, /Área de Trabalho\\stream tv\\samsung\\Diagnostico-Rede-Samsung\.ps1' -IpDaTv '192\.168\.1\.7'$/);
    assert.equal(p.montarComando('samsung-diagnostico', { ip: 'x' }).erro, 'digite o IP da TV (ex.: 192.168.1.7)');
    assert.equal(p.montarComando('rm -rf').erro, 'ação desconhecida');
});

function pedir(porta, { caminho = '/api/estado', metodo = 'GET', host, chave, corpo } = {}) {
    return new Promise((ok, falha) => {
        const req = http.request({ host: '127.0.0.1', port: porta, path: caminho, method: metodo, headers: { Host: host || `127.0.0.1:${porta}`, ...(chave ? { 'x-painel': chave } : {}), 'Content-Type': 'application/json' } }, res => {
            let s = ''; res.on('data', d => { s += d; }); res.on('end', () => ok({ codigo: res.statusCode, texto: s }));
        });
        req.on('error', falha); if (corpo) req.write(JSON.stringify(corpo)); req.end();
    });
}

test('servidor local: exige chave e Host exato; roda ação e devolve o registro', async () => {
    const servidor = p.criarServidor({ token: 'abc' });
    await new Promise(r => servidor.listen(0, '127.0.0.1', r));
    const porta = servidor.address().port;
    try {
        assert.equal((await pedir(porta, { caminho: '/' })).codigo, 403);
        assert.equal((await pedir(porta, { caminho: '/?t=abc' })).codigo, 200);
        assert.equal((await pedir(porta, { caminho: '/?t=abc', host: 'evil.example:' + porta })).codigo, 403);
        assert.equal((await pedir(porta, {})).codigo, 403);
        const est = await pedir(porta, { chave: 'abc' });
        assert.equal(est.codigo, 200);
        const r = await pedir(porta, { caminho: '/api/acao', metodo: 'POST', chave: 'abc', corpo: { acao: 'oracle-status' } });
        assert.equal(r.codigo, 200);
        const { id } = JSON.parse(r.texto);
        let t;
        for (let i = 0; i < 100; i++) { t = JSON.parse((await pedir(porta, { caminho: '/api/tarefa?id=' + id, chave: 'abc' })).texto); if (t.fim) break; await new Promise(x => setTimeout(x, 100)); }
        assert.ok(t.fim, 'terminou');
        assert.ok(t.linhas.length > 0);
    } finally { servidor.close(); }
});

test('mesma área não roda duas vezes; RESULTADO vira tabela', () => {
    const falso = () => { const ee = new (require('node:events'))(); ee.pid = 1; ee.kill = () => ee.emit('close', null); return ee; };
    const a = p.iniciar('cacador-ligar', {}, falso);
    assert.ok(a.id);
    assert.match(p.iniciar('cacador-rodada', {}, falso).erro, /Caçador contínuo.*Parar/);
    const t = p.tarefas.find(x => x.id === a.id);
    p.anotar(t, 'linha\nRESULTADO:{"resultados":[{"status":"aprovada"}]}');
    assert.equal(t.resultado.resultados[0].status, 'aprovada');
    assert.ok(!t.linhas.some(l => l.startsWith('RESULTADO:')));
    p.parar(a.id);
    assert.ok(t.fim);
});

test('investigar: alvo vai como argumento; caracteres perigosos para o cmd são recusados', () => {
    const c = p.montarComando('cacador-investigar', { alvo: 'overflix.bar' }, { raiz: 'C:\\stream tv', windows: true });
    assert.match(c.args[3], /Cacador-PC\.cmd" "--investigar" "overflix\.bar"/);
    const iptv = p.montarComando('cacador-iptv', {}, { raiz: 'C:\\stream tv', windows: true });
    assert.match(iptv.args[3], /Cacador-PC\.cmd" "--iptv""$/);
    assert.match(p.montarComando('cacador-investigar', { alvo: 'x" & calc' }, { windows: true }).erro, /só o nome/);
    assert.match(p.montarComando('cacador-investigar', { alvo: '%PATH%' }, { windows: true }).erro, /só o nome/);
    assert.match(p.montarComando('cacador-investigar', {}, { raiz: 'C:\\stream tv', windows: true }).args[3], /"--investigar""$/);
});

test('aprovadas recentes: últimas da semana, mais nova primeiro', () => {
    const arq = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'apr-')), 'a.jsonl');
    const agora = Date.parse('2026-11-02T12:00:00Z');
    fs.writeFileSync(arq, [{ em: '2026-10-01T00:00:00Z', nome: 'Velha' }, { em: '2026-11-01T00:00:00Z', nome: 'A' }, { em: '2026-11-02T00:00:00Z', nome: 'B' }].map(x => JSON.stringify(x)).join('\n') + '\nlixo\n');
    assert.deepEqual(p.aprovadasRecentes(arq, agora).map(a => a.nome), ['B', 'A']);
    assert.deepEqual(p.aprovadasRecentes(arq + 'x', agora), []);
});
