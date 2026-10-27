// Conferência de lista HLS até o primeiro pedaço do vídeo (27/10/2026) e
// rótulo honesto do áudio quando a central ouviu outro idioma.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const midia = require('./midia-proxy');

function servidor(rotas) {
    return new Promise(resolve => {
        const s = http.createServer((req, res) => {
            const r = rotas[req.url.split('?')[0]];
            if (!r) { res.statusCode = 404; return res.end(); }
            if (r.atraso) return setTimeout(() => { res.statusCode = r.status || 200; res.end(r.corpo || ''); }, r.atraso);
            res.statusCode = r.status || 200; res.setHeader('Content-Type', r.tipo || 'application/vnd.apple.mpegurl'); res.end(r.corpo || '');
        });
        s.listen(0, '127.0.0.1', () => resolve(s));
    });
}
const mestre = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=2000000,RESOLUTION=1280x720\nv/720.m3u8\n';
const variante = destino => `#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXTINF:4.0,\n${destino}\n#EXT-X-ENDLIST\n`;

test('lista cujo primeiro pedaço responde é aceita (mesmo disfarçado de .html)', async () => {
    const s = await servidor({ '/m.m3u8': { corpo: mestre }, '/v/720.m3u8': { corpo: variante('seg_000.html') }, '/v/seg_000.html': { corpo: 'x'.repeat(2048), tipo: 'text/html' } });
    const base = `http://127.0.0.1:${s.address().port}`;
    try { assert.equal(await midia.validarListaHls(base + '/m.m3u8', '', 3000), true); } finally { s.close(); }
});

test('lista cujo pedaço dá erro em todas as referências é recusada', async () => {
    const s = await servidor({ '/m.m3u8': { corpo: mestre }, '/v/720.m3u8': { corpo: variante('seg_000.ts') }, '/v/seg_000.ts': { status: 502 } });
    const base = `http://127.0.0.1:${s.address().port}`;
    try { assert.equal(await midia.validarListaHls(base + '/m.m3u8?a=1', '', 3000), false); } finally { s.close(); }
});

test('pedaço em servidor que recusa a conexão é recusado', async () => {
    const fechado = await servidor({}); const porta = fechado.address().port; fechado.close();
    const s = await servidor({ '/m.m3u8': { corpo: variante(`http://127.0.0.1:${porta}/seg.ts`) } });
    try { assert.equal(await midia.validarListaHls(`http://127.0.0.1:${s.address().port}/m.m3u8?b=1`, '', 3000), false); } finally { s.close(); }
});

test('lentidão não derruba a fonte (só erro comprovado derruba)', async () => {
    const s = await servidor({ '/m.m3u8': { corpo: variante('lento.ts') }, '/lento.ts': { atraso: 2500, corpo: 'x' } });
    try { assert.equal(await midia.validarListaHls(`http://127.0.0.1:${s.address().port}/m.m3u8?c=1`, '', 800), true); } finally { s.close(); }
});

test('fonte em outro idioma não chega ao aparelho como dublada', () => {
    const { resultadoDasAvaliacoes } = require('./avaliador');
    const r = resultadoDasAvaliacoes([{ fonteId: 'x', dados: { url: 'https://a/b.m3u8', audio: 'pt-BR' }, detalhes: { audioEmOutroIdioma: true }, prioridade: [] }], 10);
    assert.equal(r.escolhido.audio, 'original');
    const ok = resultadoDasAvaliacoes([{ fonteId: 'y', dados: { url: 'https://a/c.m3u8', audio: 'pt-BR' }, detalhes: {}, prioridade: [] }], 10);
    assert.equal(ok.escolhido.audio, 'pt-BR');
});
