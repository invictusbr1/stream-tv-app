'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const ex = require('./extrair-fornecedores');
const cacada = require('./cacada-titulo');
const fichas = require('./perfis');

const PAGINA = `<html><head>
<script src="/js/app.js"></script><script src="https://www.googletagmanager.com/gtag.js"></script>
</head><body>
<a href="stremio://addon.boa.example/manifest.json">Instalar</a>
<a href="https://outro.example/abc/manifest.json">outro addon</a>
<iframe src="https://player.boa.example/embed/movie/550" allowfullscreen></iframe>
<iframe data-src="//www.youtube.com/embed/xyz"></iframe>
<iframe src="https://ads.popads.net/embed/1"></iframe>
<video><source src="https://cdn.video.example/v/abc.m3u8?t=1"></video>
</body></html>`;

test('extrai addons, players e vídeos do HTML, ignorando YouTube, Google e anúncio', () => {
    const r = ex.extrairDoTexto(PAGINA, 'https://site.example/filme/550');
    assert.deepEqual(r.addons.sort(), ['https://addon.boa.example', 'https://outro.example/abc'].sort());
    assert.deepEqual(r.players, ['https://player.boa.example/embed/movie/550']);
    assert.deepEqual(r.videos, ['https://cdn.video.example/v/abc.m3u8?t=1']);
    assert.ok(r.scripts.includes('https://site.example/js/app.js'));
});

test('molde do player: troca o número do título por marcador (filme e episódio)', () => {
    assert.deepEqual(ex.moldeDePlayer('https://p.example/embed/movie/550'), { tipo: 'movie', chave: 'id', modelo: 'https://p.example/embed/movie/{id}' });
    assert.deepEqual(ex.moldeDePlayer('https://p.example/embed/tv/1399/1/2?x=1'), { tipo: 'tv', chave: 'id', modelo: 'https://p.example/embed/tv/{id}/{temporada}/{episodio}?x=1' });
    assert.deepEqual(ex.moldeDePlayer('https://p.example/e/tt0137523'), { tipo: 'movie', chave: 'imdb', modelo: 'https://p.example/e/{imdb}' });
    assert.equal(ex.moldeDePlayer('https://p.example/embed/abcdef'), null);
});

test('página só com JavaScript: usa o navegador escondido; link de addon direto não abre página', async () => {
    const espionadas = [];
    const r = await ex.extrairFornecedores('https://spa.example/', {
        buscarTexto: async () => '<html><body><div id="app"></div></body></html>',
        espionar: async url => { espionadas.push(url); return { videos: ['https://cdn.x.example/a.mp4'], pedidos: ['https://addon.y.example/stream/movie/tt1.json', 'https://player.z.example/embed/movie/27205'], api: [] }; },
    });
    assert.deepEqual(espionadas, ['https://spa.example/']);
    assert.deepEqual(r.addons, ['https://addon.y.example']);
    assert.deepEqual(r.players, ['https://player.z.example/embed/movie/27205']);
    assert.deepEqual(r.videos, ['https://cdn.x.example/a.mp4']);
    const direto = await ex.extrairFornecedores('https://addon.y.example/manifest.json', { buscarTexto: async () => { throw new Error('não devia abrir'); } });
    assert.deepEqual(direto.addons, ['https://addon.y.example']);
    assert.equal((await ex.extrairFornecedores('nada', {})).erro, 'endereço inválido');
});

test('vários links de página: extrai, confere addon e player, e recusa player com JavaScript ou anúncio', async () => {
    const paginas = {
        'https://site1.example/': '<a href="https://addon.ok.example/manifest.json">x</a><iframe src="https://player.ok.example/embed/movie/550"></iframe>',
        'https://site2.example/': '<iframe src="https://player.js.example/embed/movie/550"></iframe><iframe src="https://player.ad.example/embed/movie/550"></iframe>',
    };
    const buscar = async url => {
        if (paginas[url]) return paginas[url];
        if (/addon\.ok\.example\/stream\/movie/.test(url)) return JSON.stringify({ streams: [{ name: '1080p', title: '🇧🇷 Dublado', url: 'https://cdn.ok.example/' + url.split('/').pop().replace('.json', '') + '.mp4' }] });
        if (/player\.ok\.example\/embed\/movie\/(\d+)/.test(url)) return `<script>var player={file:"https://cdn.ok.example/p/${url.split('/').pop()}.mp4"}</script>`;
        if (/player\.js\.example/.test(url)) return '<div id="player"></div><script src="/p.js"></script>';
        if (/player\.ad\.example/.test(url)) return '<script src="https://a.popads.net/x.js"></script><script>file:"https://cdn.ad.example/v.mp4"</script>';
        throw new Error('sem resposta ' + url);
    };
    const buscarJson = async url => {
        if (/external_ids/.test(url)) return { imdb_id: 'tt0000550' };
        if (/discover\/tv/.test(url)) return { results: [] };
        if (/addon\.ok\.example\/manifest/.test(url)) return { name: 'Addon OK', resources: ['stream'], types: ['movie'] };
        return null;
    };
    const sondar = async url => /cdn\.ok\.example/.test(url) ? { viva: true, altura: 1080, dublado: true, evidencia: 'faixa pt' } : { viva: false };
    const registradas = [];
    const { paginas: lidas, resultados } = await cacada.verificarPaginas(['https://site1.example/', 'https://site2.example/'], {
        buscar, buscarJson, sondar, validar: fichas.validar, fichasAtuais: () => [],
        registrarFicha: (p, f, a) => { const x = { ...f, ...a.ajustes }; registradas.push(x); return x; },
    });
    assert.equal(lidas.length, 2);
    assert.equal(lidas[0].addons, 1); assert.equal(lidas[0].players, 1);
    const porNome = Object.fromEntries(resultados.map(r => [r.nome, r]));
    assert.equal(porNome['Addon OK'].status, 'aprovada');
    assert.equal(porNome['player.ok.example'].status, 'aprovada');
    assert.equal(registradas.find(f => f.nome === 'player.ok.example').urlMovie, 'https://player.ok.example/embed/movie/{id}');
    assert.match(porNome['player.js.example'].detalhe, /JavaScript/);
    assert.match(porNome['player.ad.example'].detalhe, /anúncio/);
});

test('player sem número do título que é addon: vira addon e é conferido', async () => {
    const buscarJson = async url => url === 'https://lista.addon.example/manifest.json' ? { id: 'x', name: 'Addon Lista', resources: ['catalog', { name: 'stream' }], types: ['movie'] } : null;
    assert.equal(await cacada.addonPorTras('https://lista.addon.example/configure', { buscarJson }), 'https://lista.addon.example');
    assert.equal(await cacada.addonPorTras('https://nada.example/play/abc', { buscarJson }), '');
});

test('página vazia que é addon na raiz: confere pelo /manifest.json', async () => {
    const buscarJson = async url => url === 'https://raiz.addon.example/manifest.json' ? { id: 'r', name: 'Raiz', resources: ['stream'], types: ['movie'] } : null;
    const conferidos = [];
    const r = await cacada.verificarPaginas(['https://raiz.addon.example'], { buscar: async () => '<html><body></body></html>', buscarJson, validar: async () => ({ aprovada: false, motivo: 'x', provas: [] }), fichasAtuais: () => [], registrar: m => conferidos.push(m) });
    assert.equal(r.paginas[0].addons, 1);
    assert.ok(r.resultados.some(x => x.link === 'https://raiz.addon.example'));
});

test('site de filmes: acha a página do filme (capa ou busca) e testa o player de dentro', async () => {
    const paginas = {
        'https://netcine.provedor.net/': '<a href="/categoria/acao">Ação</a><a href="https://outro.net/filme/x">fora</a>',
        'https://netcine.provedor.net/?s=a+origem': '<a href="/filme/a-origem-2010/">A Origem</a>',
        'https://netcine.provedor.net/filme/a-origem-2010/': '<iframe src="https://player.limpo.net/embed/movie/27205"></iframe>',
    };
    const buscar = async url => { if (paginas[url] !== undefined) return paginas[url]; if (/player\.limpo\.net\/embed\/movie\/(\d+)/.test(url)) return '<script src="https://a.popads.net/x.js"></script>'; throw new Error('404 ' + url); };
    assert.deepEqual(cacada.linksDeFilme(paginas['https://netcine.provedor.net/?s=a+origem'], 'https://netcine.provedor.net/'), ['https://netcine.provedor.net/filme/a-origem-2010/']);
    const r = await cacada.explorarSite('https://netcine.provedor.net/', { buscar, buscarJson: async () => null, validar: async () => ({ aprovada: false, provas: [] }), fichasAtuais: () => [] });
    assert.equal(r.paginas[0].link, 'https://netcine.provedor.net/filme/a-origem-2010/');
    assert.equal(r.resultados[0].nome, 'player.limpo.net');
    assert.match(r.resultados[0].detalhe, /anúncio/);
});

test('extração: players escondidos em data-*, <option>, JSON e base64', () => {
    const b64 = Buffer.from('https://oculto.player.net/embed/movie/550').toString('base64');
    const html = `<li data-url="https://um.player.net/embed/movie/550">Servidor 1</li>
      <select><option value="//dois.player.net/e/tt0137523">Dublado</option></select>
      <script>var cfg={"embedUrl":"https:\\/\\/tres.player.net\\/filme\\/550"};</script>
      <a data-link="${b64}">Opção 3</a>`;
    const r = ex.extrairDoTexto(html, 'https://site.provedor.net/filme/x');
    assert.deepEqual(r.players.sort(), ['https://dois.player.net/e/tt0137523', 'https://oculto.player.net/embed/movie/550', 'https://tres.player.net/filme/550', 'https://um.player.net/embed/movie/550'].sort());
});

test('verificar links (como o brflix): capa → filme → botões de servidor; fonte que o app já usa é reconhecida', async () => {
    const paginas = {
        'https://brflix.provedor.net/': '<iframe src="https://mgeb.top/player"></iframe><iframe src="https://embed-api.clickhost.xyz/x"></iframe><a href="/filme/a-origem/">A Origem</a>',
        'https://brflix.provedor.net/filme/a-origem/': '<div id="player"></div>',
    };
    const espionadas = [];
    const buscar = async url => {
        if (paginas[url] !== undefined) return paginas[url];
        if (/novo\.player\.net\/embed\/movie\/(\d+)/.test(url)) return `<script>var player={file:"https://cdn.novo.net/v/${url.split('/').pop()}.mp4"}</script>`;
        throw new Error('404 ' + url);
    };
    const r = await cacada.verificarPaginas(['https://brflix.provedor.net/'], {
        buscar, buscarJson: async () => null, fichasAtuais: () => [],
        espionar: async url => { espionadas.push(url); return { molduras: ['https://novo.player.net/embed/movie/27205', 'https://mgeb.top/e/abc'], pedidos: [], videos: [], api: [] }; },
        sondar: async () => ({ viva: true, altura: 1080, dublado: true }),
        validar: async () => ({ aprovada: true, ajustes: { qualidade: '1080p', nota: 8 }, provas: [] }),
        registrarFicha: (p, f, a) => ({ ...f, ...a.ajustes }),
    });
    assert.deepEqual(espionadas, ['https://brflix.provedor.net/filme/a-origem/']);
    const porNome = Object.fromEntries(r.resultados.map(x => [x.nome, x]));
    assert.equal(porNome['mgeb.top'].status, 'já usada pelo app');
    assert.equal(porNome['embed-api.clickhost.xyz'].status, 'já usada pelo app');
    assert.equal(porNome['novo.player.net'].status, 'aprovada');
    assert.equal(r.paginas.length, 2);
});

test('brflix real: os fornecedores estão no código do site (app.js) — conhecidos marcados, novos testados', async () => {
    const appJs = 'const a=`https://fenixflix.fenixhub.online/stream/movie/${imdb}.json`;const b=`https://superflixapi.provedor.net/serie/${id}/${s}/${e}`;' +
        'const c=`https://warezcdn.provedor.net/filme/${imdbId}`;const d=`https://mgeb.top/embed/${imdb}`;const e2=`https://embed-api.clickhost.xyz/embed/filme/${id}`;const img=`https://image.tmdb.org/t/p/w500/${id}`;';
    const paginas = { 'https://brflix.provedor.net/': '<iframe src="https://brflix.provedor.net/"></iframe><script src="/app.js?v=26"></script><a href="#/detalhes/movie/550">x</a>', 'https://brflix.provedor.net/app.js?v=26': appJs };
    const buscar = async url => {
        if (paginas[url] !== undefined) return paginas[url];
        if (url.startsWith('https://warezcdn.provedor.net/filme/')) return '<title>Verificação</title><script src="https://challenges.cloudflare.com/turnstile/v0/api.js"></script>';
        if (url.startsWith('https://superflixapi.provedor.net/serie/')) return `<script>var player={file:"https://cdn.sf.net/v/${url.split('/').slice(-3).join('-')}.mp4"}</script>`;
        throw new Error('404 ' + url);
    };
    const testados = [];
    const r = await cacada.verificarPaginas(['https://brflix.provedor.net/'], {
        buscar, buscarJson: async () => null, fichasAtuais: () => [],
        sondar: async () => ({ viva: true, altura: 1080, dublado: true }),
        validar: async f => { testados.push(f.urlTv || f.urlMovie); return { aprovada: true, ajustes: { qualidade: '1080p', nota: 8 }, provas: [] }; },
        registrarFicha: (p, f, a) => ({ ...f, ...a.ajustes }),
    });
    const porNome = Object.fromEntries(r.resultados.map(x => [x.nome, x]));
    assert.equal(porNome['mgeb.top'].status, 'já usada pelo app');
    assert.equal(porNome['embed-api.clickhost.xyz'].status, 'já usada pelo app');
    assert.equal(porNome['fenixflix.fenixhub.online'].status, 'já usada pelo app');
    assert.match(porNome['warezcdn.provedor.net'].detalhe, /verificação de robô/);
    assert.equal(porNome['superflixapi.provedor.net'].status, 'aprovada');
    assert.deepEqual(testados, ['https://superflixapi.provedor.net/serie/{id}/{temporada}/{episodio}']);
    assert.ok(!r.resultados.some(x => x.nome === 'brflix.provedor.net'), 'o próprio site não é fornecedor');
    assert.match(r.paginas[0].como, /código do site/);
});

test('site com player próprio (como o pomfy): página com número do TMDB → player → vídeo vira ficha em cadeia', async () => {
    const filmes = { 27205: 'A Origem', 155: 'Batman: O Cavaleiro das Trevas', 278: 'Um Sonho de Liberdade', 872585: 'Oppenheimer', 969681: 'Homem-Aranha: Um Novo Dia' };
    const fazer = ({ protegido = false, interno = false } = {}) => async url => {
        let m = /pomfy\.provedor\.net\/assistir\/(\d+)$/.exec(url);
        if (m) { const t = interno ? 'Outro Filme Qualquer' : filmes[m[1]] || 'x'; return `<title>${t} (2010) — Pomfy</title><iframe src="https://pomfy-cdn.provedor.net/e/cod${m[1]}"></iframe>`; }
        m = /pomfy-cdn\.provedor\.net\/e\/cod(\d+)$/.exec(url);
        if (m) return protegido ? '<script src="/assets/pow-DEJGtdh2.js"></script><div id="app"></div>' : `<script>var cfg={"file":"https://v.pomfy.net/hls/${m[1]}/master.m3u8"}</script>`;
        throw new Error('404 ' + url);
    };
    const comum = { buscarJson: async () => null, fichasAtuais: () => [], sondar: async () => ({ viva: true, altura: 1080, dublado: true }), registrarFicha: (p, f, a) => ({ ...f, ...a.ajustes }) };
    const fichas = [];
    const r = await cacada.verificarPaginas(['https://pomfy.provedor.net/assistir/969681'], { ...comum, buscar: fazer(), validar: async f => { fichas.push(f); return { aprovada: true, ajustes: { qualidade: '1080p', nota: 8 }, provas: [] }; } });
    const res = r.resultados.find(x => /player próprio|pomfy/.test(x.nome));
    assert.equal(res.status, 'aprovada');
    assert.equal(fichas[0].urlMovie, 'https://pomfy.provedor.net/assistir/{id}');
    assert.equal(fichas[0].passos.length, 2);
    // a ficha funciona no motor do app: página → player → vídeo
    const motor = require('../perfis-motor');
    const v = await motor.resolver({ ...fichas[0], ativo: true }, { tipo: 'movie', tmdbId: '550' }, { buscar: fazer() });
    assert.equal(v && v.url, 'https://v.pomfy.net/hls/550/master.m3u8');
    const prot = await cacada.verificarPaginas(['https://pomfy.provedor.net/assistir/969681'], { ...comum, buscar: fazer({ protegido: true }), validar: async () => ({ aprovada: true, ajustes: {}, provas: [] }) });
    assert.match(prot.resultados.find(x => /pomfy/.test(x.nome)).detalhe, /protegido contra robô/);
    const interno = await cacada.verificarPaginas(['https://pomfy.provedor.net/assistir/969681'], { ...comum, buscar: fazer({ interno: true }), validar: async () => ({ aprovada: true, ajustes: {}, provas: [] }) });
    assert.match(interno.resultados.find(x => /pomfy/.test(x.nome)).detalhe, /não é o do TMDB/);
});

test('addon montado no código do site (kairou → magnetflix) é reconhecido como addon, não como player', () => {
    const js = 'const c=`https://magnetflix.flixbr.online/stream/${a?`series/${o}:${r}:${n}.json`:`movie/${o}.json`}`;';
    const r = ex.extrairDoTexto(js, 'https://kairou.provedor.net/assets/index.js');
    assert.deepEqual(r.addons, ['https://magnetflix.flixbr.online']);
    assert.ok(!r.players.some(p => /magnetflix/.test(p)));
});
