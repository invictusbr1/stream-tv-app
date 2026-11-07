'use strict';
const test = require('node:test');
const assert = require('node:assert');
const tb = require('./torbox-source');

const h = c => c.repeat(40);
const s = (hash, titulo, extra = {}) => ({ infoHash: hash, name: 'Torrentio\n1080p', title: titulo, ...extra });

test('escolhe o melhor 1080p e o melhor 720p dublados que estão no cache, sem H.265', () => {
    const streams = [
        s(h('a'), 'Filme 1080p DUAL\n💾 2.1 GB ⚙️ BluDV'),
        s(h('b'), 'Filme 1080p DUAL\n💾 3.0 GB ⚙️ BluDV'),
        s(h('c'), 'Filme 1080p x265 DUAL\n💾 5 GB'),
        s(h('d'), 'Filme 720p Dublado\n💾 900 MB ⚙️ Comando', { name: 'Torrentio\n720p' }),
        s(h('e'), 'Filme 1080p ENG\n💾 9 GB'),
        s(h('f'), 'Filme 1080p DUAL\n💾 9 GB'),
    ];
    const cache = new Set([h('a'), h('b'), h('c'), h('d'), h('e')]);
    const r = tb.escolherTorrents(streams, cache);
    assert.deepStrictEqual(r.map(x => [x.qualidade, x.stream.infoHash]), [['1080p', h('b')], ['720p', h('d')]]);
});

test('arquivo do episódio certo dentro do pacote; sem o episódio não chuta', () => {
    const arquivos = [
        { id: 0, name: 'Dexter/S02E02.mkv', short_name: 'Dexter.S02E02.mkv', size: 5 },
        { id: 1, name: 'Dexter/S02E03.mkv', short_name: 'Dexter.S02E03.mkv', size: 4 },
        { id: 2, name: 'Dexter/S02E13.mkv', short_name: 'Dexter.S02E13.mkv', size: 9 },
        { id: 3, name: 'Dexter/sample.mkv', short_name: 'sample.mkv', size: 1 },
    ];
    assert.strictEqual(tb.escolherArquivo(arquivos, { temporada: 2, episodio: 3 }).id, 1);
    assert.strictEqual(tb.escolherArquivo(arquivos, { temporada: 2, episodio: 1 }), null);
    assert.strictEqual(tb.escolherArquivo(arquivos, { nome: 'Dexter.S02E13.mkv', temporada: 2, episodio: 13 }).id, 2);
    assert.strictEqual(tb.escolherArquivo([{ id: 7, name: 'f.mkv', size: 3 }, { id: 8, name: 'f.nfo', size: 30 }]).id, 7);
});

test('rótulos: português, qualidade, H.265 e tamanho', () => {
    assert.ok(tb.ehPortugues('🇧🇷'));
    assert.ok(tb.ehPortugues('Filme.2024.DUAL.1080p'));
    assert.ok(!tb.ehPortugues('Movie.2024.1080p.WEB'));
    assert.strictEqual(tb.qualidade('x 2160p'), '4K');
    assert.strictEqual(tb.qualidade('x 720p'), '720p');
    assert.ok(tb.ehHevc('1080p 10bit'));
    assert.ok(!tb.ehHevc('1080p x264'));
    assert.strictEqual(tb.tamanhoGB('💾 512 MB'), 0.5);
});

test('sem chave a fonte fica quieta (não consulta nada)', async () => {
    const antes = process.env.TORBOX_API_KEY;
    process.env.TORBOX_API_KEY = 'curta';
    try {
        if (!tb.lerChave()) assert.deepStrictEqual(await tb.resolverTodos('movie', '1', 0, 0), []);
    } finally { if (antes === undefined) delete process.env.TORBOX_API_KEY; else process.env.TORBOX_API_KEY = antes; }
});

test('junta as listas (Torrentio + Absolute Cinema) sem repetir e aceita magnet no endereço', () => {
    const a = [{ infoHash: 'A'.repeat(40), title: 'x' }];
    const b = [{ url: 'magnet:?xt=urn:btih:' + 'a'.repeat(40), title: 'repetido' }, { url: 'magnet:?xt=urn:btih:' + 'c'.repeat(40) + '&dn=y', title: 'Filme 1080p DUAL' }, { url: 'https://x/y.mp4' }];
    const r = tb.juntar([a, b]);
    assert.deepStrictEqual(r.map(s => s.infoHash), ['a'.repeat(40), 'c'.repeat(40)]);
    const cache = new Set(['c'.repeat(40)]);
    assert.strictEqual(tb.escolherTorrents(r, cache)[0].stream.infoHash, 'c'.repeat(40));
    assert.strictEqual(tb.escolherTorrents([{ infoHash: 'd'.repeat(40), title: 'Filme 1080p HDCAM DUAL' }], new Set(['d'.repeat(40)])).length, 0);
});

// Rótulos reais do Torrentio/Absolute Cinema (06/11/2026): "DUAL" latino e
// indiano entravam como dublado.
test('rótulos: DUAL de outro idioma não conta como português', () => {
    assert.ok(!tb.ehPortugues('Torrentio 1080p Trouble.with.the.curve.2012.1080P-Dual-Lat.mkv ⚙️ Cinecalidad Dual Audio / 🇲🇽'));
    assert.ok(!tb.ehPortugues('Absolute Cinema 1080P 🇬🇧 Intriga.2013.1080p-Dual-Lat.mkv'));
    assert.ok(!tb.ehPortugues('Prisoners (2013) 720p {Dual Audio} [Hindi ORG DD 2.0 English 2.0] Exclusive By DREDD ⚙️ 1337x Dual Audio / 🇬🇧 / 🇮🇳'));
    assert.ok(!tb.ehPortugues('Dexter S02E03 An Inconvenient Lie 1080p AMZN WEB-DL DD 5 1 H 264-playWEB ⚙️ EXT 🇬🇧 / 🇵🇹 / 🇪🇸 / 🇫🇷 / 🇳🇱 / 🇮🇩 / 🇹🇭'));
    assert.ok(tb.ehPortugues('Curvas da Vida 2012 ⚙️ Comando Dual Audio / 🇬🇧 / 🇵🇹 Curvas.da.Vida.2012.BluRay.1080p.Dual.PradO.mkv'));
    assert.ok(tb.ehPortugues('Filme Multi 🇵🇹 / 🇲🇽'));
    assert.ok(tb.dubladoExplicito('🇬🇧 / 🇵🇹'));
    assert.ok(!tb.dubladoExplicito('Trouble with the Curve (2012) [BDRip 1080p][DUAL]'));
});

test('escolha: quem diz português vem antes do "DUAL" genérico maior', () => {
    const h = c => c.repeat(40);
    const streams = [
        { infoHash: h('a'), title: 'Filme 1080p [DUAL]\n💾 10.9 GB' },
        { infoHash: h('b'), title: 'Filme 1080p Dublado\n💾 1.7 GB 🇵🇹' },
        { infoHash: h('c'), title: 'Filme 720p Dual Audio [Hindi + English]\n💾 1.2 GB 🇮🇳' },
        { infoHash: h('d'), title: 'Filme 720p Dublado\n💾 1.0 GB 🇵🇹' },
    ];
    const r = tb.escolherTorrents(streams, new Set(streams.map(s => s.infoHash)));
    assert.deepStrictEqual(r.map(e => [e.qualidade, e.stream.infoHash]), [['1080p', h('b')], ['720p', h('d')]]);
});

test('4K: aceita H.265/HDR, recusa Dolby Vision sem HDR de reserva; 1080p continua sem H.265', () => {
    const k = c => c.repeat(40);
    const streams = [
        { infoHash: k('1'), name: 'Torrentio\n4k', title: 'Filme 2160p x265 HDR DUAL 🇧🇷\n💾 20 GB' },
        { infoHash: k('2'), name: 'Torrentio\n4k', title: 'Filme 2160p DV x265 DUAL 🇧🇷\n💾 25 GB' },
        { infoHash: k('3'), name: 'Torrentio\n1080p', title: 'Filme 1080p x265 DUAL 🇧🇷\n💾 4 GB' },
        { infoHash: k('4'), name: 'Torrentio\n1080p', title: 'Filme 1080p DUAL 🇧🇷\n💾 3 GB' },
    ];
    const r = tb.escolherTorrents(streams, new Set([k('1'), k('2'), k('3'), k('4')]), 3);
    assert.deepStrictEqual(r.map(x => [x.qualidade, x.stream.infoHash]), [['4K', k('1')], ['1080p', k('4')]]);
});

test('Full HD x265: só entra para aparelho que toca H.265, e depois do x264', () => {
    const k = c => c.repeat(40);
    const streams = [
        { infoHash: k('5'), name: 'Torrentio\n1080p', title: 'Filme 1080p x265 DUBLADO\n💾 2 GB' },
        { infoHash: k('6'), name: 'Torrentio\n1080p', title: 'Filme 1080p x264 DUBLADO\n💾 3 GB' },
    ];
    const cache = new Set([k('5'), k('6')]);
    assert.deepStrictEqual(tb.escolherTorrents(streams, cache, 4).map(x => x.stream.infoHash), [k('6')]);
    assert.deepStrictEqual(tb.escolherTorrents(streams, cache, 4, { hevcOk: true }).map(x => x.stream.infoHash), [k('6'), k('5')]);
});

test('pacote com nome fora do padrão: usa o arquivo indicado pela lista quando o nome tem o episódio', () => {
    const arquivos = [
        { id: 0, name: 'Serie/Episodio 01.mkv', size: 5 },
        { id: 1, name: 'Serie/Episodio 02.mkv', size: 5 },
        { id: 2, name: 'Serie/Episodio 03.mkv', size: 5 },
    ];
    assert.strictEqual(tb.escolherArquivo(arquivos, { temporada: 1, episodio: 3, indice: 2 }).id, 2);
    assert.strictEqual(tb.escolherArquivo(arquivos, { temporada: 1, episodio: 3, indice: 1 }), null);
    assert.strictEqual(tb.escolherArquivo(arquivos, { temporada: 1, episodio: 3 }), null);
});

test('anime legendado: escolhe a legenda portuguesa em texto (Brasil antes de Portugal, completa antes de "sinais")', () => {
    const l = tb.legendaPortuguesa([
        { ordem: 0, idioma: 'eng', titulo: 'English', codec: 'ass' },
        { ordem: 1, idioma: 'por', titulo: 'Portuguese (Portugal)', codec: 'ass' },
        { ordem: 2, idioma: 'por', titulo: 'Português (Brasil) Signs', codec: 'ass' },
        { ordem: 3, idioma: 'por', titulo: 'Português (Brasil)', codec: 'ass' },
        { ordem: 4, idioma: 'por', titulo: 'PGS', codec: 'hdmv_pgs_subtitle' },
    ]);
    assert.strictEqual(l.ordem, 3);
    assert.strictEqual(tb.legendaPortuguesa([{ ordem: 0, idioma: 'eng', codec: 'subrip' }]), null);
    assert.strictEqual(tb.legendaPortuguesa([{ ordem: 0, idioma: 'por', codec: 'hdmv_pgs_subtitle' }]), null);
});
