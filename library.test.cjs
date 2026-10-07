const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function setup(){
 const nodes=new Map(),timers=new Map(),intervals=[],requests=[];let seq=0;
 const el=id=>{if(id==='direct-video')return null;if(!nodes.has(id)){const c=new Set();nodes.set(id,{hidden:true,textContent:'',value:'',append(){},addEventListener(){},classList:{add:x=>c.add(x),remove:x=>c.delete(x),contains:x=>c.has(x)},focus(){},replaceChildren(){}});}return nodes.get(id);};
 const window={},document={hidden:false,activeElement:null,addEventListener(){}};
 const ctx=vm.createContext({window,document,el,Option:class{},MutationObserver:class{constructor(fn){this.fn=fn;}observe(){}},AbortController,URLSearchParams,Date,timeoutSignal:()=>undefined,lerJson:async url=>{requests.push(url);return {items:[],checkedAt:new Date().toISOString()};},renderizar(){},setTimeout:fn=>{timers.set(++seq,fn);return seq;},clearTimeout:id=>timers.delete(id),setInterval:(fn,ms)=>intervals.push({fn,ms})});
 vm.runInContext(fs.readFileSync(__dirname+'/library.js','utf8'),ctx);return {window,el,timers,intervals,requests};
}
test('title and controls hide after inactivity and wake together',()=>{const s=setup();s.el('player').classList.add('ativo');s.window.StreamChrome.wake();const fn=[...s.timers.values()].at(-1);fn();assert(s.el('player').classList.contains('chrome-hidden'));s.window.StreamChrome.wake();assert(!s.el('player').classList.contains('chrome-hidden'));});
test('options stay visible while being used',()=>{const s=setup();s.el('player').classList.add('ativo');s.el('opcoes').hidden=false;s.window.StreamChrome.wake();[...s.timers.values()].at(-1)();assert(!s.el('player').classList.contains('chrome-hidden'));});
test('o Top 10 do dia (filmes e séries) é buscado uma vez e atualizado em intervalos longos',async()=>{
 const s=setup();await new Promise(setImmediate);
 assert.equal(s.requests.filter(x=>x==='/api/alta?tipo=movie').length,1,'pede o ranking de filmes');
 assert.equal(s.requests.filter(x=>x==='/api/alta?tipo=tv').length,1,'pede o ranking de séries');
 const refresh=s.intervals.find(x=>x.ms===6*60*60*1000);
 assert(refresh,'atualiza sozinho a cada 6 horas (o ranking muda por dia)');
 await refresh.fn();
 assert.equal(s.requests.filter(x=>x==='/api/alta?tipo=movie').length,2);
 assert.equal(s.requests.filter(x=>x==='/api/alta?tipo=tv').length,2);
});

test('a gaveta de categorias é fixa na tela (nunca abre fora dela) e o celular usa barra de baixo',()=>{
 const html=fs.readFileSync(__dirname+'/index.html','utf8');
 const gaveta=html.match(/\.gaveta\{[^}]*\}/);
 assert.ok(gaveta,'precisa existir a regra da gaveta');
 assert.match(gaveta[0],/position:fixed/,'a gaveta fica presa à tela');
 assert.match(gaveta[0],/inset:0/);
 const painel=html.match(/\.gaveta-painel\{[^}]*\}/);
 assert.ok(painel,'precisa existir a regra do painel da gaveta');
 assert.match(painel[0],/position:absolute/);
 assert.match(painel[0],/left:0/);
 assert.match(painel[0],/width:min\(330px,88vw\)/,'nunca passa da largura da tela');
 assert.match(html,/@media\(max-width:900px\)\{[\s\S]*?\.nav-chips\{display:none!important\}/,'no celular a barra de cima some');
 assert.match(html,/\.bottom-nav\{display:flex;position:fixed/,'no celular aparece a barra de navegação de baixo');
 assert.match(html,/id="gaveta-categorias"/);
 assert.match(html,/id="bottom-nav"/);
});

test('os cartões seguem um padrão único de alinhamento (capa, título e rodapé)',()=>{
 const html=fs.readFileSync(__dirname+'/index.html','utf8');
 const card=html.match(/\.card\{display:flex[^}]*\}/);
 assert.ok(card,'o cartão precisa ser coluna flexível, para a capa ficar sempre no topo');
 assert.match(card[0],/flex-direction:column/);
 const titulo=html.match(/\.card-titulo\{display:-webkit-box[^}]*\}/);
 assert.ok(titulo,'o título precisa ter limite de linhas');
 assert.match(titulo[0],/-webkit-line-clamp:2/);
 assert.match(titulo[0],/min-height:2\.7em/,'duas linhas reservadas deixam todos iguais');
 assert.match(html,/\.poster-row,\.grid\{align-items:start\}/,'as fileiras começam alinhadas pelo topo');
 assert.match(html,/\.card-stream\{min-height:16px\}/,'a linha do streaming reserva espaço mesmo vazia');
 const meta=html.match(/\.card-meta,\.card-stream\{[^}]*\}/);
 assert.ok(meta,'rodapé de uma linha só');
 assert.match(meta[0],/text-overflow:ellipsis/);
});

test('o cabeçalho do catálogo (com o botão Atualizar) não aparece no celular',()=>{
 const html=fs.readFileSync(__dirname+'/index.html','utf8');
 assert.match(html,/#label\{display:none\}|\.section-head\{display:none!important\}/,'no celular esse cabeçalho sai da tela');
});

test('com o player aberto a barra de baixo sai da frente e a fonte com verificação tem máscara',()=>{
 const html=fs.readFileSync(__dirname+'/index.html','utf8');
 assert.match(html,/body\.player-aberto \.bottom-nav\{display:none!important\}/,'a barra de baixo não pode cobrir o player');
 assert.match(html,/#player\.fonte-externa \.area-player:after\{[^}]*height:126px[^}]*pointer-events:none/,'a máscara cobre o rodapé do provedor sem bloquear toques');
 assert.match(html,/pararFrame\(\);el\('player'\)\?\.classList\.add\('fonte-externa'\)/,'a máscara é ligada só quando a fonte externa abre');
 const biblioteca=fs.readFileSync(__dirname+'/library.js','utf8');
 assert.match(biblioteca,/classList\.toggle\('player-aberto',active\)/,'o corpo precisa receber a marca de player aberto');
});
