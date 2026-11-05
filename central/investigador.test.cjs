'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const inv = require('./investigador');

test('marcas e variações do nome', () => {
    const caso = { nome: 'FenixFlix (FenixHub)', enderecos: ['https://fenixflix.fenixhub.online/stream/movie/x.json'] };
    const marcas = inv.marcasDoCaso(caso);
    assert.ok(marcas.includes('fenixflix') && marcas.includes('fenixhub'));
    assert.ok(!marcas.includes('online'));
    const v = inv.variacoes(marcas, caso.enderecos);
    assert.ok(v.includes('fenixflix.lat') && v.includes('fenixflix2.com') && v.includes('fenixflix.fenixhub.site'));
    assert.ok(!v.includes('fenixflix.fenixhub.online'));
    assert.deepEqual(inv.dominiosNoTexto('Mudamos! Acesse fenixflix.site ou www.fenixflix2.com, não google.com', ['fenixflix']).sort(), ['fenixflix.site', 'fenixflix2.com']);
});

function cenario({ redirecionar = false } = {}) {
    const paginas = {
        'https://fenixflix.fenixhub.site/': { status: 200, texto: '<title>FenixFlix - addon</title>' },
        'https://fenixflix.lat/': { status: 200, texto: '<title>fenixflix.lat is for sale</title> buy this domain' },
        'https://fenixflix.fenixhub.online/': redirecionar ? { status: 301, location: 'https://fenixflix.fenixhub.site/' } : null,
    };
    const obter = async (url, { seguir } = {}) => {
        if (url.startsWith('https://web.archive.org/')) return { status: 404, texto: '' };
        const p = paginas[url]; if (!p) throw new Error('ENOTFOUND');
        return { ...p, urlFinal: url };
    };
    const buscarJson = async url => {
        if (url.startsWith('https://crt.sh/')) return /fenixflix/.test(decodeURIComponent(url)) ? [{ name_value: 'fenixflix.fenixhub.site\n*.fenixflix.fenixhub.site', not_before: new Date(Date.now() - 5 * 864e5).toISOString() }, { name_value: 'fenixflix.lat', not_before: '2020-01-01' }] : [];
        if (url.startsWith('https://web.archive.org/cdx')) return [['timestamp', 'original', 'statuscode']];
        if (url === 'https://fenixflix.fenixhub.site/manifest.json') return { id: 'org.fenixflix', name: 'FenixFlix' };
        return null;
    };
    const resolver = async d => (['fenixflix.lat', 'fenixflix.fenixhub.site'].includes(d) ? ['1.2.3.4'] : []);
    return { obter, buscarJson, resolver };
}

test('investigação: certificado + variação + mesmo id de addon → validação; domínio à venda é descartado', async () => {
    const validados = [];
    const d = await inv.investigar({ nome: 'FenixFlix (FenixHub)', enderecos: ['https://fenixflix.fenixhub.online'], manifestId: 'org.fenixflix' }, {
        ...cenario(), verificarLinks: async links => { validados.push(...links); return [{ link: links[0], status: 'aprovada', qualidade: '1080p' }]; },
    });
    assert.deepEqual(validados, ['https://fenixflix.fenixhub.site']);
    assert.match(d.conclusao, /ACHOU: FenixFlix \(FenixHub\) está em fenixflix\.fenixhub\.site/);
    const venda = d.candidatos.find(c => c.dominio === 'fenixflix.lat');
    assert.ok(venda.nota < 0 && /estacionado/.test(venda.evidencia));
    assert.ok(d.pistas.some(p => p.tipo === 'certificados'));
});

test('investigação: redirecionamento do endereço antigo é pista forte; sem validação aprovada fica "provável"', async () => {
    const d = await inv.investigar({ nome: 'FenixFlix', enderecos: ['https://fenixflix.fenixhub.online'] }, {
        ...cenario({ redirecionar: true }), verificarLinks: async links => [{ link: links[0], status: 'recusada', detalhe: 'sem dublado' }],
    });
    const forte = d.candidatos[0];
    assert.equal(forte.dominio, 'fenixflix.fenixhub.site');
    assert.match(forte.motivo, /redirecionamento/);
    assert.match(d.conclusao, /endereço novo provável: fenixflix\.fenixhub\.site/);
});

test('casos automáticos: fichas desativadas, fontes que caíram e sites antigos', () => {
    const memoria = { itens: () => [{ nome: 'Frost', base: 'https://frost.antigo.net', quedas: 2, manifestId: 'x' }, { nome: 'Ok', base: 'https://ok.net', quedas: 0 }] };
    const casos = inv.casosAutomaticos({ fichas: [{ nome: 'BestCine', ativo: false, urlMovie: 'https://bestcine.dpdns.org/stream/movie/{imdb}.json' }, { nome: 'Vivo', ativo: true, urlMovie: 'https://v.net/stream/movie/x.json' }], memoria, descartadas: ['OverFlix'] });
    assert.deepEqual(casos.map(c => c.nome), ['BestCine', 'Frost', 'OverFlix']);
    assert.deepEqual(casos[0].enderecos, ['https://bestcine.dpdns.org']);
    assert.equal(casos[1].manifestId, 'x');
});

test('convergência (vidfast.io/.me/.xyz → vidfast.vc) vira forte; golpe, agência e adulto são descartados', async () => {
    const paginas = {
        'https://vidfast.io/': { final: 'https://vidfast.vc/', texto: '<title>VidFast</title> watch movies' },
        'https://vidfast.me/': { final: 'https://vidfast.vc/', texto: '<title>VidFast</title> watch movies' },
        'https://vidfast.xyz/': { final: 'https://vidfast.vc/', texto: '<title>VidFast</title> watch movies' },
        'https://vidfast.vc/': { final: 'https://vidfast.vc/', texto: '<title>VidFast - Watch Movies</title> player' },
        'https://vidfast.site/': { final: 'https://cloudfiare-verification.com/x', texto: '<title>Just a moment</title>' },
        'https://vidfast.online/': { final: 'https://vidfast.online/', texto: '<title>VidFast — agência de marketing</title> clientes, vendas' },
        'https://vidfast.live/': { final: 'https://vidfast.live/', texto: '<title>VidFast: Live Video Chat with Girls Online</title>' },
    };
    const obter = async url => { const p = paginas[url]; if (!p) throw new Error('ENOTFOUND'); return { status: 200, texto: p.texto, urlFinal: p.final }; };
    const vivos = ['vidfast.io', 'vidfast.me', 'vidfast.xyz', 'vidfast.site', 'vidfast.online', 'vidfast.live'];
    const validados = [];
    const d = await inv.investigar({ nome: 'VidFast', enderecos: ['https://vidfast.pro'] }, {
        obter, buscarJson: async () => null, resolver: async h => (vivos.includes(h) ? ['1.1.1.1'] : []),
        verificarPaginas: async links => { validados.push(...links); return { resultados: [{ link: links[0], status: 'recusada', detalhe: 'sem dublado' }] }; },
    });
    const nota = dom => (d.candidatos.find(c => c.dominio === dom) || {}).nota;
    assert.ok(nota('vidfast.vc') >= 6, 'vc ' + nota('vidfast.vc'));
    assert.ok(nota('vidfast.io') <= 1);
    assert.ok(nota('vidfast.site') < 0 && /golpe/.test(d.candidatos.find(c => c.dominio === 'vidfast.site').evidencia));
    assert.ok(nota('vidfast.online') < 6 && /não é site de vídeo/.test(d.candidatos.find(c => c.dominio === 'vidfast.online').evidencia));
    assert.ok(nota('vidfast.live') < 0);
    assert.deepEqual(validados, ['https://vidfast.vc/']);
    assert.match(d.conclusao, /provável: vidfast\.vc/);
});

test('site brasileiro: um redirecionamento já leva ao endereço novo; clone francês e projeto de estudante caem', async () => {
    const paginas = {
        'https://netcine.icu/': { final: 'https://netcinetv.org/', texto: '<html lang="pt-BR"><title>NetCine - Filmes e Séries Online Grátis</title>' },
        'https://netcinetv.org/': { final: 'https://netcinetv.org/', texto: '<html lang="pt-BR"><title>NetCine - Assistir Filmes</title>' },
        'https://netcine.lat/': { final: 'https://netcine.lat/', texto: '<html lang="fr"><title>NetCine - Films HD Gratuits En VF</title> streaming' },
        'https://netcine-clone.vercel.app/': { final: 'https://netcine-clone.vercel.app/', texto: '<html lang="pt"><title>NetCine</title> filmes' },
    };
    const obter = async url => { const p = paginas[url]; if (!p) throw new Error('ENOTFOUND'); return { status: 200, texto: p.texto, urlFinal: p.final }; };
    const buscarJson = async url => /api\.github\.com/.test(url) ? { items: [{ full_name: 'aluno/netcine-clone', name: 'netcine-clone', homepage: 'https://netcine-clone.vercel.app' }] } : null;
    const validados = [];
    const d = await inv.investigar({ nome: 'NetCine', enderecos: [] }, {
        obter, buscarJson, token: 't', resolver: async h => (['netcine.icu', 'netcine.lat'].includes(h) ? ['1.1.1.1'] : []),
        verificarPaginas: async links => { validados.push(...links); return { resultados: [] }; },
    });
    const nota = dom => (d.candidatos.find(c => c.dominio === dom) || {}).nota;
    assert.ok(nota('netcinetv.org') >= 6, 'netcinetv ' + nota('netcinetv.org'));
    assert.ok(nota('netcine.lat') < 3, 'fr ' + nota('netcine.lat'));
    assert.ok(nota('netcine-clone.vercel.app') < 3, 'vercel ' + nota('netcine-clone.vercel.app'));
    assert.deepEqual(validados, ['https://netcinetv.org/']);
});
