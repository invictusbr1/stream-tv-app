const {test}=require('node:test'),assert=require('node:assert/strict'),agenda=require('./futebol');
test('agenda valida datas reais e não aceita liga desconhecida no catálogo',()=>{assert.equal(agenda.validDate('2026-02-30'),false);assert.equal(agenda.validDate('2026-10-10'),true);assert.equal(agenda.validDate('../2026'),false);assert.equal(agenda.leagues['localhost'],undefined);});
test('agenda associa mandante, visitante, escudos e transmissão brasileira sem inventar canal',()=>{const events=[{id:'1',date:'2026-10-10T21:00Z',competitions:[{status:{type:{state:'in',detail:"75'"}},competitors:[{homeAway:'away',team:{displayName:'Remo'},score:'1'},{homeAway:'home',team:{displayName:'Vasco'},score:'2'}],geoBroadcasts:[{region:'us',media:{shortName:'US TV'}}]}]}];const [g]=agenda.normalize({events},'bra.1');assert.equal(g.home,'Vasco');assert.equal(g.away,'Remo');assert.equal('homeScore' in g,false);assert.equal('awayScore' in g,false);assert.equal(g.state,'in');assert.deepEqual(g.channels,[]);assert.throws(()=>agenda.normalize({},'bra.1'));assert.deepEqual(agenda.normalize({events:[{date:'invalid'}]},'bra.1'),[]);});

test('futebol mostra somente jogos em andamento, sem incluir encerrados ou futuros',()=>{const games=[{id:'ao-vivo',state:'in'},{id:'encerrado',state:'post'},{id:'futuro',state:'pre'}];assert.deepEqual(agenda.liveGames(games).map(g=>g.id),['ao-vivo']);});


test('agenda não oferece o canal fixo como transmissão de uma partida sem vínculo confirmado',async()=>{
 const vm=require('node:vm'),fs=require('node:fs');
 function node(tag='div'){return {tag,children:[],textContent:'',append(...items){this.children.push(...items)},replaceChildren(...items){this.children=items},scrollIntoView(){},querySelector(){return null}};}
 const ids=Object.fromEntries(['futebol-jogos','futebol-status','futebol-fontes-titulo','futebol-fontes-nota','futebol-fontes-panel'].map(id=>[id,node()]));
 const document={getElementById:id=>ids[id],createElement:node};
 const window={document,timeoutSignal(){},lerJson:async()=>({events:[{id:'1',date:'2026-10-10T21:00Z',competitions:[{status:{type:{state:'in'}},competitors:[{homeAway:'home',team:{displayName:'São Paulo'}},{homeAway:'away',team:{displayName:'Vitória'}}]}]}]})};
 vm.runInNewContext(fs.readFileSync(require.resolve('./futebol'),'utf8'),{window,document,Intl,Date,URL,AbortController,setInterval,clearInterval});
 await window.StreamFutebol.load();
 const flatten=n=>[n,...n.children.flatMap(flatten)];
 assert.equal(flatten(ids['futebol-jogos']).some(n=>n.tag==='button'),false);
 assert.ok(flatten(ids['futebol-jogos']).some(n=>n.textContent.includes('Transmissão neste app não confirmada')));
 window.StreamFutebol.sources({home:'São Paulo',away:'Vitória'});
 assert.equal(ids['futebol-fontes-titulo'].textContent,'Canais de futebol');
 assert.match(ids['futebol-fontes-nota'].textContent,/não estão vinculados/);
});
