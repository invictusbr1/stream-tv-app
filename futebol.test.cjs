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
 assert.deepEqual(flatten(ids['futebol-jogos']).filter(n=>n.tag==='button').map(n=>n.textContent),['Ver canais de futebol','Ver canais de futebol','Ver canais de futebol']);
 assert.ok(flatten(ids['futebol-jogos']).some(n=>n.textContent.includes('Transmissão neste app não confirmada')));
 await window.StreamFutebol.sources({home:'São Paulo',away:'Vitória'});
 assert.equal(ids['futebol-fontes-titulo'].textContent,'São Paulo × Vitória · Canais de futebol');
 assert.match(ids['futebol-fontes-nota'].textContent,/não confirma/);
});

test('canais correspondem ao nome exato da programação sem misturar ESPN e ESPN 2',()=>{
 const list=[{nome:'ESPN HD',grupo:'sports',url:'https://example.test/1.m3u8'},{nome:'ESPN 2',grupo:'sports',url:'https://example.test/2.m3u8'},{nome:'Premiere 1',grupo:'sports',url:'https://example.test/3.m3u8'}];
 assert.deepEqual(agenda.matchingChannels({channels:['ESPN']},list).map(c=>c.nome),['ESPN HD']);
 assert.deepEqual(agenda.matchingChannels({channels:[]},list),[]);
 assert.deepEqual(agenda.matchingChannels({channels:['Premiere']},list),[]);
 assert.deepEqual(agenda.sportChannels([{nome:'ESPN',url:'javascript:alert(1)'},{nome:'Notícias',url:'https://example.test/a'}]),[]);
});
test('programação estrangeira e nomes sem região não atribuem um canal brasileiro ao jogo',()=>{
 const [g]=agenda.normalize({events:[{id:'1',date:'2026-10-11T21:00Z',competitions:[{competitors:[{homeAway:'home',team:{displayName:'A'}},{homeAway:'away',team:{displayName:'B'}}],broadcasts:[{names:['ESPN']}],geoBroadcasts:[{region:'us',media:{shortName:'ESPN'}},{region:'br',media:{shortName:'SporTV'}}]}]}]},'bra.1');
 assert.deepEqual(g.channels,['SporTV']);
});
