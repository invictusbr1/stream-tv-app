'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PassThrough } = require('node:stream');
const conversor = require('./conversor');
const registrar = require('./rotas/tela-dlna');

function montar() {
    const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'dlna-'));
    const conv = path.join(pasta, 'anime-1-T1E1-x'); fs.mkdirSync(conv);
    fs.writeFileSync(path.join(conv, 'index.m3u8'), '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nindex0.m3u8\n');
    fs.writeFileSync(path.join(conv, 'index0.m3u8'), '#EXTM3U\n#EXTINF:4.0,\nseg0_00000.ts\n#EXTINF:4.0,\nseg0_00001.ts\n#EXTINF:4.0,\nseg0_00002.ts\n#EXT-X-ENDLIST\n');
    ['A', 'B', 'C'].forEach((x, i) => fs.writeFileSync(path.join(conv, `seg0_0000${i}.ts`), x));
    fs.writeFileSync(path.join(conv, 'index0_vtt.m3u8'), '#EXTM3U\n#EXTINF:10,\nindex00.vtt\n');
    fs.writeFileSync(path.join(conv, 'index00.vtt'), 'WEBVTT\n\n00:00.000 --> 00:00.010\n​\n\n00:02.000 --> 00:03.000\nAntes\n\n00:06.500 --> 00:09.000\n<i>Depois</i>\n');
    const original = conversor.caminhoDoPedaço;
    conversor.caminhoDoPedaço = (c, n) => { const a = path.join(pasta, c, n); return fs.existsSync(a) ? a : ''; };
    const rotas = {};
    const app = { get: (p, h) => { rotas['GET ' + p] = h; }, all: (p, h) => { rotas['ALL ' + p] = h; } };
    registrar(app, { DADOS_DIR: pasta });
    return { rotas, desfazer: () => { conversor.caminhoDoPedaço = original; } };
}
function resJson() { const r = { code: 200, setHeader() {}, status(c) { this.code = c; return this; }, json(d) { this.d = d; } }; return r; }
function resStream() {
    const r = new PassThrough(); const pedacos = []; r.on('data', c => pedacos.push(c));
    Object.assign(r, { code: 0, cab: null, writeHead(c, h) { this.code = c; this.cab = h; }, status(c) { this.code = c; return this; } });
    r.texto = () => Buffer.concat(pedacos).toString();
    return r;
}
const req = (extra) => ({ headers: { host: '147.15.28.222' }, query: {}, params: {}, method: 'GET', on() {}, ...extra });

test('DLNA: link assinado, vídeo em TS contínuo a partir do ponto e legenda SRT no mesmo tempo', async () => {
    const { rotas, desfazer } = montar();
    try {
        const r = resJson();
        rotas['GET /api/tela/link'](req({ query: { conversao: 'anime-1-T1E1-x', posicao: '5' } }), r);
        assert.equal(r.d.ok, true);
        assert.match(r.d.video, /^http:\/\/147\.15\.28\.222\/tv\/[\w-]+\.[\w-]{32}\/video\.ts$/);
        assert.match(r.d.legenda, /legenda\.srt$/);
        const tok = r.d.video.split('/')[4];
        const v = resStream();
        await rotas['ALL /tv/:tok/video.ts'](req({ params: { tok } }), v);
        assert.equal(v.code, 200); assert.equal(v.cab['Content-Type'], 'video/mp2t');
        await new Promise(ok => setImmediate(ok));
        assert.equal(v.texto(), 'BC', 'começa no pedaço do ponto (4 s) e vai até o fim');
        const l = resStream(); l.end = function (x) { if (x) this.write(x); PassThrough.prototype.end.call(this); };
        rotas['ALL /tv/:tok/legenda.srt'](req({ params: { tok } }), l);
        await new Promise(ok => setImmediate(ok));
        assert.equal(l.texto(), '1\n00:00:02,500 --> 00:00:05,000\nDepois\n');
        const ruim = resStream();
        await rotas['ALL /tv/:tok/video.ts'](req({ params: { tok: tok.slice(0, -2) + 'xx' } }), ruim);
        assert.equal(ruim.code, 403);
        const head = resStream();
        await rotas['ALL /tv/:tok/video.ts'](req({ params: { tok }, method: 'HEAD' }), head);
        assert.equal(head.code, 200); assert.match(head.cab['CaptionInfo.sec'], /legenda\.srt$/);
    } finally { desfazer(); }
});

test('DLNA: rota /tv/ passa sem login só com o formato do link assinado', () => {
    const src = fs.readFileSync(path.join(__dirname, 'seguranca.js'), 'utf8');
    assert.match(src, /\\\/tv\\\/\[A-Za-z0-9_-\]\{1,400\}\\\.\[A-Za-z0-9_-\]\{32\}/);
    const caddy = fs.readFileSync(path.join(__dirname, 'deploy/servidor/Caddyfile'), 'utf8');
    assert.match(caddy, /http:\/\/\{\$PUBLIC_IP\}[\s\S]*handle \/tv\/\*[\s\S]*redir https:/);
});
