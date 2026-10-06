const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');
const root=__dirname+'/';
function setup(){
 const timers=new Map(),nodes=new Map();let seq=0,fetchImpl=()=>new Promise(()=>{});
 function node(id=''){const classes=new Set();return {id,hidden:true,children:[],style:{},value:'0',textContent:'',
 classList:{add:v=>classes.add(v),remove:v=>classes.delete(v),contains:v=>classes.has(v)},
 setAttribute(k,v){this[k]=v;},getAttribute(k){return this[k]??null;},removeAttribute(k){delete this[k];},
 append(...n){this.children.push(...n);},replaceChildren(){this.children=[];},focus(){doc.activeElement=this;},
 cloneNode(){return node(id);},replaceWith(n){nodes.set(id,n);},querySelectorAll(){return [];}};}
 const get=id=>{if(!nodes.has(id))nodes.set(id,node(id));return nodes.get(id);};
 const doc={getElementById:get,createElement:()=>node(),body:node(),activeElement:node(),addEventListener(){},querySelector:s=>get(s),querySelectorAll:()=>[]};
 const ctx=vm.createContext({document:doc,window:{},navigator:{userAgent:'Test'},URL,location:{origin:'http://localhost:3106'},AbortController,Set,console,fetch:(...a)=>fetchImpl(...a),setTimeout:(fn,ms)=>{const id=++seq;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id)});
 vm.runInContext(fs.readFileSync(root+'index.html','utf8').match(/<script>\r?\n([\s\S]*?)<\/script>/)[1],ctx);
 timers.clear();
 return {get,timers,run:s=>vm.runInContext(s,ctx),fetch(fn){fetchImpl=fn;},timeout(){const pair=[...timers].find(([id,t])=>t.ms===15000);assert(pair);timers.delete(pair[0]);pair[1].fn();}};
}
const sources=[{nome:'A',dub:true,funcionou:true,url:'https://a.example/movie',urlCompatibilidade:'/assistir/238/1'},{nome:'B',dub:true,funcionou:true,url:'https://b.example/movie',urlCompatibilidade:'/assistir/238/2'},{nome:'Legendado',dub:false,funcionou:true,url:'https://c.example/movie'}];
test('only dub candidates; detected failure advances once, then opens options without looping',async()=>{const s=setup();s.fetch(async()=>({ok:true,json:async()=>({players:sources})}));await s.run("abrirPlayer(238,'Filme')");assert.equal(s.run('players.length'),2);assert.equal(s.get('opcoes').hidden,true);assert.equal(s.get('frame').src,sources[0].url);const stale=s.get('frame').onload;s.timeout();assert.equal(s.get('frame').src,sources[1].url);stale();assert(s.get('loading').classList.contains('vis'));s.timeout();assert.equal(s.get('opcoes').hidden,false);assert(s.get('loading').classList.contains('erro'));assert.equal(s.get('frame').src,'about:blank');assert.equal(s.timers.size,0);});
test('loaded iframe is not interrupted by an assumed playback deadline',async()=>{const s=setup();s.fetch(async()=>({ok:true,json:async()=>({players:sources})}));await s.run("abrirPlayer(238,'Filme')");s.get('frame').onload();assert.equal(s.timers.size,0);assert.equal(s.get('frame').src,sources[0].url);assert(!s.get('loading').classList.contains('vis'));});
test('close cancels stale source response and stale load events',async()=>{const s=setup();let resolve;s.fetch(()=>new Promise(r=>resolve=r));const pending=s.run("abrirPlayer(238,'Filme')");s.run('fechar()');resolve({ok:true,json:async()=>({players:sources})});await pending;assert.equal(s.run('players.length'),0);assert.equal(s.get('frame').src,'about:blank');assert(!s.get('player').classList.contains('ativo'));assert.equal(s.timers.size,0);});
test('no dubbed candidate never loads a subtitled source or an ad window',async()=>{const s=setup();s.fetch(async()=>({ok:true,json:async()=>({players:[sources[2]]})}));await s.run("abrirPlayer(238,'Filme')");assert.equal(s.get('frame').src,'about:blank');assert.equal(s.get('opcoes').hidden,false);assert.equal(s.get('abrir-externo').getAttribute('href'),null);});
test('external mode stops old playback and validates local links',async()=>{const s=setup();s.fetch(async()=>({ok:true,json:async()=>({players:sources})}));await s.run("abrirPlayer(238,'Filme')");s.run('pausarParaExterno({preventDefault(){throw Error()}})');assert.equal(s.get('frame').src,'about:blank');assert.equal(s.timers.size,0);for(const bad of ['https://evil.example/assistir/238/1','/assistir/238/9','/assistir/238/1?redirect=foo','javascript:alert(1)',null])assert.equal(s.run(`urlExterna(${JSON.stringify(bad)})`),null);});

test('transient direct failure retries once and does not open source selection',async()=>{
 const s=setup();s.fetch(async()=>({ok:true,json:async()=>({players:sources})}));
 s.run('var calls=0;window.StreamPlayback=StreamPlayback={stop(){},async start(){calls++;return calls===2;}}');
 await s.run("abrirPlayer(238,'Filme')");assert.equal(s.run('calls'),2);assert.equal(s.get('frame').src,'about:blank');assert.equal(s.get('opcoes').hidden,true);
});
test('optional source remains selectable but cannot autoplay without confirmed dubbing',async()=>{
 const s=setup();const pipoca={nome:'PipocaCine',dub:false,optional:true,funcionou:true,url:'https://pipocacine.lat/embed/238',urlCompatibilidade:'/assistir/238/7'};
 s.fetch(async()=>({ok:true,json:async()=>({players:[pipoca]})}));await s.run("abrirPlayer(238,'Filme')");
 assert.equal(s.get('frame').src,'about:blank');assert.equal(s.run('players.length'),1);
 s.run('carregarFonte(0,true)');assert.equal(s.get('frame').src,pipoca.url);
 assert.equal(s.run("urlExterna('/assistir/238/7')"),'http://localhost:3106/assistir/238/7');
});

test('episodes cannot accidentally start a movie with the same TMDB id',async()=>{
 const s=setup();const urls=[];s.fetch(async url=>{urls.push(url);return {ok:true,json:async()=>({players:[]})};});
 s.run('window.StreamPlayback={stop(){},start(){throw Error("movie resolver must not run")}}');await s.run("abrirPlayer(1399,'Episode',{season:2,number:4})");assert(urls.includes('/api/episode/1399/2/4'));
 assert.equal(s.run("urlExterna('/assistir.html?type=tv&id=1399&season=2&episode=4&source=1')"),'http://localhost:3106/assistir.html?type=tv&id=1399&season=2&episode=4&source=1');
 assert.equal(s.run("urlExterna('/assistir.html?type=tv&id=1399&season=2&episode=4&source=1&extra=x')"),null);
});
test('manual episode sources remain visible and open the validated compatibility page',async()=>{
 const s=setup();const p={nome:'Doramogo',directory:'doramogo',optional:true,manual:true,dub:false,funcionou:true,urlCompatibilidade:'/assistir.html?type=tv&id=94796&season=1&episode=2&source=3'};
 s.fetch(async()=>({ok:true,json:async()=>({players:[p]})}));await s.run("abrirPlayer(94796,'Dorama',{season:1,number:2})");assert.equal(s.get('opcoes').hidden,false);assert(!s.get('loading').classList.contains('vis'));assert.equal(s.get('frame').src,'about:blank');
 s.get('fontes').children[0].onclick();assert.equal(s.run('location.href'),'http://localhost:3106'+p.urlCompatibilidade);
 for(const bad of ['/assistir.html?id=238&source=11','/assistir.html?id=238&source=10&redirect=x','/assistir.html?type=tv&id=94796&season=1&episode=2&source=5'])assert.equal(s.run(`urlExterna(${JSON.stringify(bad)})`),null);
 assert.equal(s.run("urlExterna('/assistir.html?id=238&source=10')"),'http://localhost:3106/assistir.html?id=238&source=10');
});
test('episode opens eligible embedded source automatically but never navigates to manual ads or search',async()=>{
 const s=setup();const p={nome:'Episode embed',optional:true,dub:false,funcionou:true,url:'https://embed.example/serie/94796/1/2'};
 s.fetch(async()=>({ok:true,json:async()=>({players:[{...p,manual:true,url:'https://manual.example'},p]})}));await s.run("abrirPlayer(94796,'Episode',{season:1,number:2})");assert.equal(s.get('opcoes').hidden,true);assert.equal(s.get('frame').src,p.url);s.timeout();assert.equal(s.get('opcoes').hidden,false);assert.equal(s.get('frame').src,'about:blank');
});
