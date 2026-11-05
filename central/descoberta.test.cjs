'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const d = require('./descoberta');

const pasta = () => fs.mkdtempSync(path.join(os.tmpdir(), 'desc-'));
const DIA = 86400000;

test('memória: guarda, junta pistas, persiste e decide quem testar de novo', () => {
    const p = pasta();
    const m = d.criarMemoria(p);
    m.ver({ base: 'stremio://addon.br.provedor.net/manifest.json', nome: 'Filmes BR', origem: 'catálogo' });
    m.ver({ base: 'https://addon.br.provedor.net/stream/movie/tt1.json', pista: 'página X' });
    m.ver({ base: 'https://torrent.provedor.net', nome: 'Torrentio Debrid' });
    assert.equal(m.itens().length, 2);
    assert.deepEqual(m.item('https://addon.br.provedor.net').pistas, ['página X']);
    m.gravar();
    const de = d.criarMemoria(p);
    assert.equal(de.itens().length, 2);
    const agora = Date.now();
    assert.ok(d.pontuar(de.item('https://addon.br.provedor.net')) > d.pontuar(de.item('https://torrent.provedor.net')));
    de.anotar('https://addon.br.provedor.net', 'sem dublado', 'x');
    assert.equal(d.prontoParaTestar(de.item('https://addon.br.provedor.net'), { agora: agora + DIA }), false);
    assert.equal(d.prontoParaTestar(de.item('https://addon.br.provedor.net'), { agora: agora + 15 * DIA }), true);
    de.anotar('https://torrent.provedor.net', 'aprovada');
    assert.equal(d.prontoParaTestar(de.item('https://torrent.provedor.net'), { agora: agora + 99 * DIA }), false);
});

test('diretórios (texto e JSON) e GitHub (homepage + README) viram candidatos', async () => {
    const m = d.criarMemoria(pasta());
    const textos = {
        'https://lista.provedor.net/README.md': 'Instale: https://um.provedor.net/manifest.json e stremio://dois.provedor.net/abc/manifest.json',
        'https://lista.provedor.net/addons.json': JSON.stringify([{ transportUrl: 'https://tres.provedor.net/manifest.json', manifest: { name: 'Três' } }]),
        'https://raw.githubusercontent.com/fulano/addon-br/main/README.md': 'URL: https://quatro.provedor.net/manifest.json',
    };
    const buscarTexto = async u => { if (textos[u]) return textos[u]; throw new Error('404'); };
    await d.coletarDiretorios(m, { buscarTexto, diretorios: ['https://lista.provedor.net/README.md', 'https://lista.provedor.net/addons.json'] });
    let cab = null;
    const buscarJson = async (u, o) => { cab = o && o.headers; return /search\/repositories/.test(u) ? { items: [{ full_name: 'fulano/addon-br', name: 'addon-br', description: 'filmes dublados', homepage: 'https://cinco.provedor.net', default_branch: 'main' }] } : null; };
    assert.equal(await d.coletarGithub(m, { buscarJson, buscarTexto, token: '' }), 0);
    await d.coletarGithub(m, { buscarJson, buscarTexto, token: 'tok', buscas: ['x'] });
    assert.equal(cab.Authorization, 'Bearer tok');
    assert.deepEqual(m.itens().map(i => i.base).sort(), ['https://cinco.provedor.net', 'https://dois.provedor.net/abc', 'https://quatro.provedor.net', 'https://tres.provedor.net', 'https://um.provedor.net']);
    assert.equal(m.item('https://quatro.provedor.net').origem, 'github');
});

test('detetive: fonte que caiu e o mesmo addon (mesmo id) em outro endereço vira prioridade', async () => {
    const m = d.criarMemoria(pasta());
    const fichas = [{ nome: 'Fenix Flix', ativo: true, stremio: true, urlMovie: 'https://velho.provedor.net/stream/movie/{imdb}.json' }];
    let vivo = true;
    const buscarJson = async u => (u === 'https://velho.provedor.net/manifest.json' && vivo) ? { id: 'org.fenix', name: 'Fenix Flix' } : null;
    await d.detetive(m, { fichas, buscarJson });
    assert.equal(m.item('https://velho.provedor.net').manifestId, 'org.fenix');
    m.ver({ base: 'https://novo.provedor.net', nome: 'Outro' }); m.item('https://novo.provedor.net').manifestId = 'org.fenix';
    m.ver({ base: 'https://parecido.provedor.net', nome: 'FenixFlix BR' });
    vivo = false;
    m.item('https://velho.provedor.net').conferidoEm = 0;
    assert.equal((await d.detetive(m, { fichas, buscarJson })).length, 0); // uma queda só pode ser instabilidade
    m.item('https://velho.provedor.net').conferidoEm = 0;
    const pistas = await d.detetive(m, { fichas, buscarJson });
    assert.deepEqual(pistas.map(p => p.para), ['https://novo.provedor.net']);
    assert.equal(m.item('https://novo.provedor.net').prioridade, 20);
    assert.match(m.item('https://novo.provedor.net').pistas[0], /novo endereço de Fenix Flix/);
});

test('exploração: triagem separa fora do ar / conta paga / sem dublado; o promissor passa pela validação e lista outros addons', async () => {
    const p = pasta();
    const m = d.criarMemoria(p);
    for (const b of ['https://morto.provedor.net', 'https://pago.provedor.net', 'https://ingles.provedor.net', 'https://bom.provedor.net']) m.ver({ base: b, origem: 'teste' });
    const manifests = {
        'https://pago.provedor.net': { id: 'p', name: 'Debrid Max', resources: ['stream'], types: ['movie'] },
        'https://ingles.provedor.net': { id: 'i', name: 'English', resources: ['stream'], types: ['movie', 'series'] },
        'https://bom.provedor.net': { id: 'b', name: 'Bom BR', resources: ['stream'], types: ['movie', 'series'], addonCatalogs: [{ type: 'all', id: 'lista' }] },
    };
    const buscarJson = async u => {
        const base = u.split('/manifest.json')[0];
        if (u.endsWith('/manifest.json')) return manifests[base] || null;
        if (u === 'https://bom.provedor.net/addon_catalog/all/lista.json') return { addons: [{ transportUrl: 'https://irmao.provedor.net/manifest.json', manifest: { name: 'Irmão' } }] };
        if (/external_ids|discover|tv\//.test(u)) return null;
        if (u.startsWith('https://ingles.provedor.net/stream/')) return { streams: [{ name: '1080p', title: 'English', url: 'https://cdn.i.provedor.net/a.mp4' }] };
        if (u.startsWith('https://bom.provedor.net/stream/')) return { streams: [{ name: 'Dublado 1080p', title: '🇧🇷 Dublado', url: 'https://cdn.b.provedor.net/a.mp4' }] };
        return null;
    };
    const registradas = [];
    const deps = { buscarJson, validar: async () => ({ aprovada: true, ajustes: { qualidade: '1080p', nota: 8 }, provas: [] }), registrarFicha: (pp, f, a) => { registradas.push(f.nome); return { ...f, ...a.ajustes }; }, fichasAtuais: () => [], pastaDados: p };
    const r = await d.explorar(m, deps, { quantos: 10 });
    const st = Object.fromEntries(r.map(x => [x.link, x.status]));
    assert.equal(st['https://morto.provedor.net'], 'fora do ar');
    assert.equal(st['https://pago.provedor.net'], 'conta paga');
    assert.equal(st['https://ingles.provedor.net'], 'sem dublado');
    assert.equal(st['https://bom.provedor.net'], 'aprovada');
    assert.deepEqual(registradas, ['Bom BR']);
    assert.ok(m.item('https://irmao.provedor.net'), 'o addon listado pelo Bom BR entrou na fila');
    const rel = d.relatorio(d.criarMemoria(p));
    assert.equal(rel.aprovadasNoPeriodo, 1);
    assert.equal(rel.conhecidos, 5);
    assert.equal(rel.naFila, 1);
});

test('endereços de exemplo de README não entram; triagem diferencia torrent, sem os títulos e addon que se declara dublado', async () => {
    const m = d.criarMemoria(pasta());
    for (const b of ['https://127.0.0.1:7000', 'https://seu_ip:7000', 'https://192.168.1.100:7000', 'https://addon.example.com', 'https://localhost/x']) assert.equal(m.ver({ base: b }), null, b);
    const manifests = {
        'https://torrent.provedor.net': { id: 't', name: 'Filmes BR', resources: ['stream'], types: ['movie'] },
        'https://vazio.provedor.net': { id: 'v', name: 'Coisa', resources: ['stream'], types: ['movie'] },
        'https://declarado.provedor.net': { id: 'd', name: 'Mico Dublado 🇧🇷', resources: ['stream'], types: ['movie'] },
    };
    const buscarJson = async u => {
        const base = u.split(/\/(manifest\.json|stream\/)/)[0];
        if (u.endsWith('/manifest.json')) return manifests[base] || null;
        if (base === 'https://torrent.provedor.net') return { streams: [{ infoHash: 'abc', name: 'Dublado 1080p' }] };
        if (base === 'https://declarado.provedor.net' && /tt22022452/.test(u)) return { streams: [{ name: 'Servidor 1', url: 'https://cdn.d.provedor.net/a.mp4' }] };
        return null;
    };
    const amostras = d.AMOSTRAS_DE_TRIAGEM;
    assert.equal((await d.triar({ base: 'https://torrent.provedor.net' }, { buscarJson, amostras })).status, 'só torrent');
    assert.equal((await d.triar({ base: 'https://vazio.provedor.net' }, { buscarJson, amostras })).status, 'sem os títulos');
    const dec = await d.triar({ base: 'https://declarado.provedor.net' }, { buscarJson, amostras });
    assert.equal(dec.status, 'promissora');
    assert.match(dec.motivo, /se declara dublado/);
});
