const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createCatalog } = require('./app/src/main/assets/catalog.js');
const good = value => ({ ok: true, json: async () => value });

// No aparelho não existe servidor: a página do modo com anúncios precisa responder
// as rotas /api pelo catálogo local, senão série nenhuma abre.
test('a página do modo com anúncios usa o catálogo local no aparelho', () => {
    const pagina = fs.readFileSync(__dirname + '/app/src/main/assets/assistir.html', 'utf8');
    assert.ok(pagina.includes('<script src="/android.js"></script>'), 'precisa carregar android.js');
    assert.ok(pagina.includes("typeof androidCatalog !== 'undefined'"), 'precisa preferir o catálogo local');
    assert.ok(pagina.includes('consulta.request('), 'precisa usar o catálogo escolhido para episódios');
});

test('episódio usa a VidLink e a VidSrc como fontes e mantém os índices estáveis', async () => {
    const catalogo = createCatalog(async () => good({ imdb_id: 'tt0247082' }), 'test');
    const dados = await catalogo.request('/api/episode/1431/1/1');
    assert.equal(dados.players[0].url, 'https://vidlink.pro/tv/1431/1/1');
    assert.equal(dados.players[0].index, 0);
    assert.equal(dados.players[1].url, 'https://vidsrc.to/embed/tv/1431/1/1');
    assert.ok(dados.players.every(p => p.dub === false && p.optional === true));
});
test('catalog uses HTTPS TMDB directly and preserves independent ranking rules', async () => {
    const seen = [];
    const catalog = createCatalog(async url => {
        const u = new URL(url); seen.push(u);
        assert.equal(u.origin, 'https://api.themoviedb.org');
        assert.equal(u.searchParams.get('api_key'), 'test-key');
        return good(u.pathname.includes('discover') ? { results: [{ id: 238, title: 'Teste', vote_average: 9, release_date: '1972-01-01' }] } : { id: Number(u.pathname.split('/').pop()), title: 'Premiado', vote_average: 8 });
    }, 'test-key');
    const ranks = await catalog.request('/api/rankings');
    assert.equal(ranks.relevantes[0].titulo, 'Teste');
    assert.equal(ranks.melhores[0].nota, '9.0');
    assert.equal(ranks.oscar.length, 13);
    assert(seen.some(u => u.searchParams.get('vote_count.gte') === '500'));
    assert(seen.some(u => u.searchParams.has('primary_release_date.lte')));
    const calls = seen.length;
    await catalog.request('/api/rankings'); assert.equal(seen.length, calls);
});
test('source indexes are stable across preferred ordering and missing IMDb', async () => {
    const catalog = createCatalog(async () => { throw Error('offline'); }, 'test');
    const { players } = await catalog.request('/api/player/238');
    assert.equal(players[0].index, 1);
    assert.equal(players[0].url, 'https://cdn-embed.com/filme/238');
    assert.equal(players[0].urlCompatibilidade, null);assert.equal(players[0].funcionou,false);assert.equal(players[0].dub,false);
    assert.equal(players.find(p => p.index === 0).funcionou, false);
    assert.equal(players.find(p => p.index === 0).urlCompatibilidade, null);
    await assert.rejects(catalog.sources('../238'));
});
test('search encoding, cancellation and invalid routes', async () => {
    let called = 0;
    const catalog = createCatalog(async (input, opts) => {
        called++; const url = new URL(input);
        assert.equal(url.searchParams.get('query'), 'A & B');
        assert.equal(url.searchParams.get('include_adult'), 'false');
        return good({ results: [] });
    }, 'test');
    assert.deepEqual(await catalog.request('/api/buscar?nome=A%20%26%20B'), []);
    const abort = new AbortController(); abort.abort();
    await assert.rejects(catalog.request('/api/buscar?nome=A%20%26%20B', abort.signal), { name: 'AbortError' });
    assert.equal(called, 1);
    await assert.rejects(catalog.request('/api/player/invalid'));
});
test('provider failures do not masquerade as an empty successful catalog', async () => {
    const catalog = createCatalog(async () => ({ ok: false }), 'test');
    await assert.rejects(catalog.request('/api/rankings'));
});

test('PipocaCine uses TMDB with a stable optional source index and no false audio claim',async()=>{
 const c=createCatalog(async()=>good({imdb_id:'tt0068646'}),'test');const sources=await c.sources(238);const p=sources.find(p=>p.nome==='PipocaCine');
 assert.equal(p.index,7);assert.equal(p.url,'https://pipocacine.lat/embed/238');assert.equal(p.dub,false);assert.equal(p.optional,true);assert.equal(p.urlCompatibilidade,'/assistir.html?id=238&source=7');
});

test('series, doramas, categories and mixed search preserve media type',async()=>{
 const seen=[];const c=createCatalog(async u=>{const url=new URL(u);seen.push(url);return good({page:1,total_pages:3,results:[{id:1399,name:'Série',media_type:'tv',origin_country:['KR']}]});},'test');
 const d=await c.request('/api/explore?tipo=dorama&genre=18&page=2');assert.equal(d.items[0].tipo,'tv');assert.equal(seen[0].pathname,'/3/discover/tv');assert.equal(seen[0].searchParams.get('with_origin_country'),'KR|JP|CN|TW|TH');
 await c.request('/api/explore?tipo=all&nome=Teste');assert.equal(seen[1].pathname,'/3/search/multi');
 await assert.rejects(c.request('/api/explore?genre=18%26bad=1'));await assert.rejects(c.request('/api/explore?page=0'));
});
test('Brazil top list filters availability, caps ten, and never claims national audience',async()=>{
 const c=createCatalog(async u=>{const url=new URL(u);assert.equal(url.searchParams.get('watch_region'),'BR');assert.equal(url.searchParams.get('with_watch_monetization_types'),'flatrate|free|ads');return good({results:Array.from({length:20},(_,i)=>({id:i,title:'Film'}))});},'test');
 const d=await c.request('/api/top-br');assert.equal(d.items.length,10);assert(d.checkedAt);
});
test('season and episode routes retain exact numbers and fixed provider origins',async()=>{
 const urls=[];const c=createCatalog(async u=>{urls.push(new URL(u).pathname);return good({episodes:[{episode_number:4,name:'Quatro'}]});},'test');
 const d=await c.request('/api/season/1399/2');assert.equal(urls[0],'/3/tv/1399/season/2');assert.equal(d.episodes[0].number,4);
 const e=await c.request('/api/episode/1399/2/4');assert.equal(e.players[0].url,'https://vidlink.pro/tv/1399/2/4');assert.equal(e.players[1].url,'https://vidsrc.to/embed/tv/1399/2/4');assert(e.players.every(p=>p.dub===false));assert.equal(e.players[1].manual,true);
 await assert.rejects(c.request('/api/episode/1399/2/0'));await assert.rejects(c.request('/api/season/../2'));
});
test('new alternatives preserve episode coordinates and never claim confirmed dubbing',async()=>{
 const c=createCatalog(async()=>good({imdb_id:'tt0068646'}),'test');
 const ep=(await c.request('/api/episode/108978/2/4')).players;
 assert.equal(ep.find(p=>p.index===2).url,'https://superflixapi.monster/serie/108978/2/4');
 assert.equal(ep.find(p=>p.index===3).directory,'doramogo');assert.equal(ep.find(p=>p.index===4).directory,'pobreflix');
 for(const p of ep.filter(p=>p.index>=2)){assert.equal(p.dub,false);assert.equal(p.manual,true);assert(p.urlCompatibilidade.includes('season=2&episode=4'));}
 const movie=await c.sources(238);assert.equal(movie.find(p=>p.index===8).url,'https://superflixapi.monster/filme/tt0068646');assert.equal(movie.find(p=>p.index===10).directory,'pobreflix');
});
test('external searches use exact title encoding and fixed origins, not guessed episode slugs',async()=>{
 const seen=[];const c=createCatalog(async u=>{seen.push(new URL(u).pathname);return good({name:'A & B / Amor',title:'Filme'});},'test');
 const url=new URL(await c.directoryUrl({directory:'doramogo'},94796,true));assert.equal(url.origin,'https://www.doramogo.net');assert.equal(url.searchParams.get('q'),'A & B / Amor');assert.equal(seen[0],'/3/tv/94796');
 assert.equal(new URL(await c.directoryUrl({directory:'pobreflix'},238,false)).searchParams.get('s'),'Filme');
 await assert.rejects(c.directoryUrl({directory:'evil'},238,false));
});
test('discovery pages reach TMDB and initial selections rotate without changing top-ten logic',async()=>{
 const seen=[];const c=createCatalog(async input=>{const u=new URL(input);seen.push(u);return good({results:[],page:3,total_pages:500});},'test');
 const d=await c.request('/api/explore?tipo=movie&genre=28&page=3');assert.equal(d.page,3);assert.equal(d.pages,500);assert.equal(seen[0].searchParams.get('page'),'3');assert.equal(seen[0].searchParams.get('with_genres'),'28');
 await c.request('/api/rankings?page=4');assert(seen.filter(u=>u.pathname.includes('discover')).slice(1).every(u=>u.searchParams.get('page')==='4'));
 await assert.rejects(c.request('/api/rankings?page=11'));
});
test('anime and short dramas use independent constraints and never mix cartoons into doramas',async()=>{
 const seen=[];const c=createCatalog(async input=>{const u=new URL(input);seen.push(u);return good({results:[],page:1,total_pages:1});},'test');
 await c.request('/api/explore?tipo=anime&genre=35');assert.equal(seen[0].pathname,'/3/discover/tv');assert.equal(seen[0].searchParams.get('with_origin_country'),'JP');assert.equal(seen[0].searchParams.get('with_genres'),'35,16');
 await c.request('/api/explore?tipo=anime-film');assert.equal(seen[1].pathname,'/3/discover/movie');
 await c.request('/api/explore?tipo=dorama');assert.equal(seen[2].searchParams.get('with_runtime.gte'),'21');assert(seen[2].searchParams.get('without_genres').split(',').includes('16'));
 await c.request('/api/explore?tipo=short-drama');assert.equal(seen[3].searchParams.get('with_runtime.lte'),'20');
});
test('anime search keeps Japanese animation and rejects live action and western cartoons',async()=>{
 const c=createCatalog(async()=>good({results:[{id:1,name:'Anime',genre_ids:[16],origin_country:['JP']},{id:2,name:'Drama',genre_ids:[18],origin_country:['JP']},{id:3,name:'Cartoon',genre_ids:[16],origin_country:['US']}]}),'test');const d=await c.request('/api/explore?tipo=anime&nome=Teste');assert.deepEqual(d.items.map(x=>x.id),[1]);
});
