'use strict';
const test = require('node:test');
const assert = require('node:assert');
const cofre = require('./cofre-links.cjs');

const LINK = 'https://store-018.weur.tb-cdn.st/dld/abc?token=00000000-1111-2222-3333-444444444444';

test('cofre guarda o link e devolve só um código; código inválido não abre nada', () => {
    const id = cofre.guardar(LINK);
    assert.match(id, /^[a-f0-9]{32}$/);
    assert.strictEqual(cofre.pegar(id), LINK);
    assert.strictEqual(cofre.guardar(LINK), id);
    assert.strictEqual(cofre.pegar('../../etc'), '');
    assert.strictEqual(cofre.pegar('f'.repeat(32)), '');
});

test('fonte com segredo: o aparelho recebe /api/torbox/<código>, nunca o link com a chave', () => {
    const motor = require('./fontes-motor');
    const pronto = motor.prepararParaPlayer({ url: LINK, segredo: true, final: true, fonte: 'TorBox' });
    assert.strictEqual(pronto.final, false);
    assert.match(pronto.urlAplicativo, /^\/api\/torbox\/[a-f0-9]{32}$/);
    const rede = require('./rede-playback.cjs');
    for (const transporte of ['', 'servidor']) {
        const url = rede.enderecoPlayback({ query: { transporte } }, { url: LINK, segredo: true, final: true });
        assert.match(url, /^\/api\/torbox\/[a-f0-9]{32}$/);
        assert.ok(!url.includes('token'));
    }
});

test('mensagem de erro do conversor sai sem o token', () => {
    const t = cofre.semSegredo(`${LINK}: Server returned 403 Forbidden`);
    assert.ok(!t.includes('4444'));
    assert.match(t, /token=\*\*\*/);
});

test('APK (transporte=servidor) não recebe fonte que precisa de conversão', () => {
    const { _filtrarPorCodec } = require('./avaliador');
    if (typeof _filtrarPorCodec !== 'function') return;
    const r = [{ item: { dados: { converter: true, type: 'convertido' } }, sonda: { videoCodec: 'h264' } }, { item: { dados: { type: 'file' } }, sonda: { videoCodec: 'h264' } }];
    assert.strictEqual(_filtrarPorCodec(r, 'avc', true).length, 1);
    assert.strictEqual(_filtrarPorCodec(r, 'avc', false).length, 2);
});

test('conversor não considera completo filme interrompido com EXT-X-ENDLIST e preserva a duração total', async () => {
    const fs = require('node:fs'), path = require('node:path');
    const conversor = require('./conversor');
    const chave = 'filme-289-interrompido14m';
    const pasta = path.join(conversor.PASTA, chave);
    fs.mkdirSync(pasta, { recursive: true });
    try {
        fs.writeFileSync(path.join(pasta, 'meta.json'), JSON.stringify({ chave, lastro: 'filme-289', duracao: 10740, segundos: 840, parouSemUso: true }));
        fs.writeFileSync(path.join(pasta, 'index.m3u8'), '#EXTM3U\n#EXTINF:840.0,\nseg00000.ts\n#EXT-X-ENDLIST\n');
        const st = conversor.estado(chave);
        assert.strictEqual(st.convertido, false, 'conversão de 14 min de filme de 3h não pode ser considerada completa');
        assert.strictEqual(st.duracao, 10740, 'a duração total real de 3h deve ser preservada em vez de sobrescrever com 14 min');
        assert.strictEqual(st.segundos, 840);
        assert.strictEqual(st.parado, true);
    } finally {
        try { fs.rmSync(pasta, { recursive: true, force: true }); } catch {}
    }
});

test('conversor reaproveita conversão completa do disco após reinício do processo', async () => {
    const fs = require('node:fs'), path = require('node:path');
    const conversor = require('./conversor');
    const chave = 'filme-teste-reinicio-abc123';
    const pasta = path.join(conversor.PASTA, chave);
    fs.mkdirSync(pasta, { recursive: true });
    try {
        fs.writeFileSync(path.join(pasta, 'index.m3u8'), '#EXTM3U\n#EXTINF:10.0,\nseg00000.ts\n#EXTINF:12.4,\nseg00001.ts\n#EXT-X-ENDLIST\n');
        const st = conversor.estado(chave);
        assert.strictEqual(st.pronto, true);
        assert.strictEqual(st.convertido, true);
        assert.strictEqual(st.segundos, 22);
        const reaproveitado = await conversor.iniciar('https://exemplo.invalid/video.mkv', { id: 'filme-teste-reinicio' });
        assert.strictEqual(reaproveitado.id, chave);
        assert.strictEqual(reaproveitado.convertido, true);
    } finally {
        try { fs.rmSync(pasta, { recursive: true, force: true }); } catch {}
    }
});

test('modo de teste: fonte "principal" dublada vence mesmo com resolução menor; em outro idioma não', () => {
    const politica = require('./politica-fontes');
    if (!politica.principalEmTeste('torbox')) return;
    const vetores = (tb, outra) => [{ fonteId: 'torbox', prioridade: tb }, { fonteId: 'fenix', prioridade: outra }];
    const ordenar = lista => lista.sort((a, b) => {
        const p = x => (politica.principalEmTeste(x.fonteId) && x.prioridade[0] >= 1 ? 1 : 0);
        return (p(b) - p(a)) || politica.compararPrioridade(a.prioridade, b.prioridade);
    });
    assert.strictEqual(ordenar(vetores([2, 1, 3, 1080, 0, 0, 0], [2, 1, 5, 2160, 1, 0, 0]))[0].fonteId, 'torbox');
    assert.strictEqual(ordenar(vetores([-1, 1, 0, 1080, 0, 0, 0], [2, 1, 2, 720, 1, 0, 0]))[0].fonteId, 'fenix');
});
