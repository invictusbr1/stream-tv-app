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
