'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const iptv = require('./cacada-iptv');
const perfis = require('./perfis');

const M3U_EXEMPLO = `#EXTM3U
#EXTINF:-1 tvg-logo="https://img.example/globo.png" group-title="General",TV Globo SP
https://stream.example/globo.m3u8
#EXTINF:-1 tvg-logo="https://img.example/sportv.png" group-title="Sports",SporTV HD
https://stream.example/sportv.m3u8
#EXTINF:-1 tvg-logo="https://img.example/telecine.png" group-title="Movies",Telecine Premium
https://stream.example/telecine.m3u8
#EXTINF:-1 group-title="News",CNN Brasil
https://stream.example/cnn.m3u8
`;

const HLS_VIVO_1080 = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-STREAM-INF:BANDWIDTH=4500000,RESOLUTION=1920x1080
chunklist.m3u8
`;

test('medirListaIptv: avalia lista M3U, testa canais HLS, separa por setor e aprova', async () => {
    const buscarTexto = async url => {
        if (url === 'https://lista.example/brasil.m3u') return M3U_EXEMPLO;
        if (url === 'https://stream.example/cnn.m3u8') throw new Error('timeout');
        if (url.startsWith('https://stream.example/')) return HLS_VIVO_1080;
        throw new Error('404');
    };
    const r = await iptv.medirListaIptv({
        id: 'lista-brasil',
        nome: 'Lista Brasil Teste',
        url: 'https://lista.example/brasil.m3u',
    }, { buscarTexto, limiteAmostra: 4 });

    assert.equal(r.aprovada, true);
    assert.equal(r.status, 'aprovada');
    assert.equal(r.canais, 4);
    assert.equal(r.responderam, 3);
    assert.equal(r.qualidade, '1080p');
    assert.equal(r.porSetor['tv-aberta'], 1);
    assert.equal(r.porSetor['esportes'], 1);
    assert.equal(r.porSetor['filmes'], 1);
    assert.equal(r.porSetor['noticias'], 1);
});

test('gerarM3uVerificados: monta #EXTM3U com group-title do setor e sem duplicar URLs', () => {
    const m3u = iptv.gerarM3uVerificados([
        { nome: 'TV Cultura', url: 'https://stream.example/cultura.m3u8', setor: 'tv-aberta', logo: 'https://img.example/c.png' },
        { nome: 'CazéTV', url: 'https://stream.example/caze.m3u8', setor: 'esportes' },
        { nome: 'CazéTV Duplicado', url: 'https://stream.example/caze.m3u8', setor: 'esportes' },
    ]);
    assert.match(m3u, /^#EXTM3U\n/);
    assert.match(m3u, /group-title="TV Aberta",TV Cultura/);
    assert.match(m3u, /group-title="Esportes",CazéTV/);
    assert.equal((m3u.match(/https:\/\/stream\.example\/caze\.m3u8/g) || []).length, 1);
});

test('cacarIptv: testa listas, grava aprovadas em perfis.json com setor e gera tv-cacador-verificados.m3u', async () => {
    const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'iptv-cacada-'));
    const buscarTexto = async url => {
        if (url === 'https://minha-lista.example/canais.m3u8') return M3U_EXEMPLO;
        if (url.startsWith('https://stream.example/')) return HLS_VIVO_1080;
        throw new Error('offline');
    };
    const res = await iptv.cacarIptv({
        buscarTexto,
        pastaDados: pasta,
        publicar: false,
    }, {
        links: ['https://minha-lista.example/canais.m3u8'],
        apenasLinks: true,
    });

    assert.equal(res.aprovadas, 1);
    assert.equal(res.canaisConfirmados, 4);
    assert.ok(fs.existsSync(path.join(pasta, iptv.ARQUIVO_M3U_VERIFICADOS)));
    const listasSalvas = perfis.listasTv(pasta);
    assert.ok(listasSalvas.some(l => l.url === 'https://minha-lista.example/canais.m3u8'));
    const verificado = listasSalvas.find(l => l.id === 'cacador-verificados');
    assert.ok(verificado);
    assert.equal(verificado.setor, 'fornecedores');
    assert.equal(verificado.canais, 4);
});

test('medirAddonTvStremio: avalia addon de TV com canais HLS e torrents prontos na TorBox', async () => {
    const h1 = 'a'.repeat(40);
    const buscarJson = async url => {
        if (url === 'https://addon-tv.example/manifest.json') {
            return {
                id: 'org.tv.br',
                name: 'TV Brasil Addon',
                types: ['tv', 'channel'],
                catalogs: [{ type: 'tv', id: 'canais-br', name: 'Canais Brasil' }],
            };
        }
        if (url === 'https://addon-tv.example/catalog/tv/canais-br.json') {
            return {
                metas: [
                    { id: 'tv:globo', type: 'tv', name: 'TV Globo HD', genres: ['General'] },
                    { id: 'tv:premiere', type: 'tv', name: 'Premiere Clubes', genres: ['Sports'] },
                ],
            };
        }
        if (url === 'https://addon-tv.example/stream/tv/tv%3Aglobo.json') {
            return { streams: [{ url: 'https://stream.example/globo.m3u8', title: '1080p' }] };
        }
        if (url === 'https://addon-tv.example/stream/tv/tv%3Apremiere.json') {
            return { streams: [{ infoHash: h1, title: 'Premiere Replay 1080p PT-BR' }] };
        }
        return null;
    };
    const buscarTexto = async url => {
        if (url === 'https://stream.example/globo.m3u8') return HLS_VIVO_1080;
        throw new Error('404');
    };
    const aprovadosTorbox = [];
    const torbox = {
        emCache: async hashes => new Set(hashes.filter(x => x === h1)),
        aprovar: reg => aprovadosTorbox.push(reg),
    };

    const r = await iptv.medirAddonTvStremio(
        { url: 'https://addon-tv.example', nome: 'TV Brasil Addon' },
        { buscarJson, buscarTexto, torbox }
    );

    assert.equal(r.aprovada, true);
    assert.equal(r.vivos.length, 1);
    assert.equal(r.prontosTorbox, 1);
    assert.equal(aprovadosTorbox.length, 1);
    assert.equal(aprovadosTorbox[0].base, 'https://addon-tv.example');
});
