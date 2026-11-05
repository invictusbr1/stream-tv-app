'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('node:events');
const { comSelenium, espionarComSelenium, lerConfig } = require('./selenium-ponte');

const cfg = extra => ({ ...lerConfig('/nao/existe'), ...extra });
const filhoFalso = (saida, aoRodar = () => {}) => (exe, args) => {
    aoRodar(exe, args);
    const f = new EventEmitter(); f.stdout = new EventEmitter(); f.kill = () => {};
    setTimeout(() => { f.stdout.emit('data', saida); f.emit('close', 0); }, 5);
    return f;
};

test('configuração: arquivo ausente ou com valor errado cai no padrão', () => {
    const c = lerConfig('/nao/existe');
    assert.deepEqual([c.ligado, c.sempre, c.visivel, c.robo, c.segundos], [true, false, false, 'recusar', 15]);
    const r = lerConfig('x', () => JSON.stringify({ segundos_observando: 999, verificacao_de_robo: 'qualquer', quando_usar: 'SEMPRE' }));
    assert.deepEqual([r.segundos, r.robo, r.sempre], [45, 'recusar', true]);
});

test('o arquivo configuracao-caca.json da pasta é JSON válido', () => {
    const c = lerConfig();
    assert.equal(typeof c.ligado, 'boolean');
});

test('reserva: navegador de antes achou algo, SeleniumBase não é chamado', async () => {
    let chamou = false;
    const r = await comSelenium(async () => ({ ok: true, videos: ['https://x/a.m3u8'], molduras: [], api: [] }), { config: cfg(), espionarSelenium: async () => { chamou = true; } })('https://a.b');
    assert.equal(chamou, false); assert.equal(r.videos.length, 1);
});

test('reserva: navegador de antes falhou, usa o SeleniumBase', async () => {
    const r = await comSelenium(async () => ({ ok: false, semRobo: true, videos: [] }), { config: cfg(), espionarSelenium: async () => ({ ok: true, videos: ['https://y/b.mp4'], molduras: [], api: [] }) })('https://a.b');
    assert.equal(r.videos[0], 'https://y/b.mp4');
});

test('desligado: nunca chama o SeleniumBase', async () => {
    let chamou = false;
    await comSelenium(async () => null, { config: cfg({ ligado: false }), espionarSelenium: async () => { chamou = true; } })('https://a.b');
    assert.equal(chamou, false);
});

test('sempre: SeleniumBase primeiro', async () => {
    const ordem = [];
    await comSelenium(async () => { ordem.push('antes'); return null; }, { config: cfg({ sempre: true }), espionarSelenium: async () => { ordem.push('selenium'); return { ok: true, videos: ['v'], molduras: [], api: [] }; } })('https://a.b');
    assert.deepEqual(ordem, ['selenium']);
});

test('opções viram argumentos do Python e AVISO vai para o log', async () => {
    let args = [];
    const log = [];
    const r = await espionarComSelenium('https://a.b', {
        config: cfg({ visivel: true, robo: 'manual', bloquear: false }), registrar: m => log.push(m),
        rodar: filhoFalso('AVISO:resolva na janela\nPONTE:{"ok":true,"videos":["v"],"molduras":[],"api":[]}\n', (e, a) => { args = a; }),
    });
    assert.equal(r.videos[0], 'v');
    assert.ok(args.includes('--visivel') && args.includes('--sem-bloqueio'));
    assert.equal(args[args.indexOf('--robo') + 1], 'manual');
    assert.ok(log.some(l => /resolva na janela/.test(l)));
});

test('Python ausente: devolve o resultado original sem quebrar', async () => {
    const orig = { ok: false, semRobo: true, videos: [] };
    const rodar = () => { const f = new EventEmitter(); f.stdout = new EventEmitter(); setTimeout(() => f.emit('error', new Error('ENOENT')), 5); return f; };
    const r = await comSelenium(async () => orig, { config: cfg(), espionarSelenium: (u, o) => espionarComSelenium(u, { ...o, rodar }) })('https://a.b');
    assert.equal(r, orig);
});

test('configuração editada na mão: aceita sem as chaves { } e com vírgula sobrando', () => {
    const c = lerConfig('x', () => '"quando_usar": "sempre",\n"janela_visivel": true,\n');
    assert.deepEqual([c.sempre, c.visivel], [true, true]);
});
