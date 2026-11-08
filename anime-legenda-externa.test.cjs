'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { ajustarSrt } = require('./conversor');
const tb = require('./torbox-source');

test('legenda de fora: desloca para o ponto de início e fixa um trecho em 00:00', () => {
    const srt = '1\r\n00:00:01,000 --> 00:00:04,000\r\nUm\r\n\r\n2\r\n00:01:10,500 --> 00:01:14,000\r\nDepois\r\nsegunda linha\r\n';
    const zero = ajustarSrt(srt, 0);
    assert.match(zero, /^1\n00:00:00,000 --> 00:00:00,010\n​/);
    assert.match(zero, /00:00:01,000 --> 00:00:04,000\nUm/);
    const meio = ajustarSrt(srt, 60);
    assert.ok(!/\nUm\n?/.test(meio));
    assert.match(meio, /00:00:10,500 --> 00:00:14,000\nDepois\nsegunda linha/);
    assert.equal(ajustarSrt('lixo', 0), '');
});

test('legenda online: PT-BR antes de PT, sem "forced", casando com o arquivo', async () => {
    const original = global.fetch;
    let pedido = '';
    global.fetch = async url => { pedido = url; return { status: 200, text: async () => JSON.stringify({ subtitles: [
        { lang: 'eng', url: 'https://subs5.strem.io/a', movieReleaseName: 'x' },
        { lang: 'pob', url: 'https://subs5.strem.io/forced', movieReleaseName: 'Show.S01E05.WEBRip.Netflix.pt-BR-forced' },
        { lang: 'por', url: 'https://subs5.strem.io/pt', movieReleaseName: 'Show.S01E05.WEBRip' },
        { lang: 'pob', url: 'https://subs5.strem.io/bd', movieReleaseName: 'Show S01E05 BD 1080p' },
        { lang: 'pob', url: 'https://subs5.strem.io/web', movieReleaseName: 'Show.S01E05.CR.WEB-DL.1080p-Owl' },
        { lang: 'pob', url: 'http://mal.example/x', movieReleaseName: 'Show.S01E05.CR.WEB-DL.1080p-Owl' },
    ] }) }; };
    try {
        const r = await tb.legendaOnlinePt('tt22248376', 1, 5, '[Erai-raws] Show - 05 [1080p CR WEB-DL AVC AAC][MultiSub].mkv');
        assert.equal(r.url, 'https://subs5.strem.io/web');
        assert.match(pedido, /opensubtitles-v3\.strem\.io\/subtitles\/series\/tt22248376:1:5\.json$/);
        assert.equal(await tb.legendaOnlinePt('nada', 1, 1, ''), null);
    } finally { global.fetch = original; }
});
