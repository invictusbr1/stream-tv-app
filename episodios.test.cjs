const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const {createEpisodeNavigator,seriesTitle}=require('./episodios');
const target={id:1399,titulo:'Série · T1 E2',episode:{season:1,number:2,anime:true,audio:'legendado'}};
const setup=data=>{const calls=[];return {calls,navigator:createEpisodeNavigator({today:()=> '2026-10-16',request:async(path,signal)=>{calls.push(path);if(signal?.aborted)throw Error('abort');if(!(path in data))throw Error('indisponível');return data[path];}})};};
test('próximo episódio segue a numeração do catálogo, sem consultas por adivinhação',async()=>{
 const s=setup({'/api/season/1399/1':{episodes:[{number:5},{number:2},{number:3,name:'Próximo',date:'2026-10-15'}]}});
 assert.deepEqual(await s.navigator.next(target),{season:1,number:3,name:'Próximo'});assert.deepEqual(s.calls,['/api/season/1399/1']);assert.equal(seriesTitle(target),'Série');
});
test('último episódio passa para a próxima temporada regular e pula temporadas vazias',async()=>{
 const s=setup({'/api/season/1399/1':{episodes:[{number:2}]},'/api/tv/1399':{seasons:[{number:0},{number:3},{number:1},{number:2}]},'/api/season/1399/2':{episodes:[]},'/api/season/1399/3':{episodes:[{number:1,date:'2026-01-01'}]}});
 assert.deepEqual(await s.navigator.next(target),{season:3,number:1,name:''});assert(!s.calls.includes('/api/season/1399/0'));
});
test('final da série e filmes não inventam um próximo episódio',async()=>{
 const s=setup({'/api/season/1399/1':{episodes:[{number:2}]},'/api/tv/1399':{seasons:[{number:1}]}});
 assert.equal(await s.navigator.next(target),null);assert.equal(await s.navigator.next({id:1399}),null);
});
test('episódio ainda não lançado não é aberto nem pulado para outra temporada',async()=>{
 const s=setup({'/api/season/1399/1':{episodes:[{number:2},{number:3,date:'2026-11-01'}]}});
 assert.equal(await s.navigator.next(target),null);assert.equal(s.calls.length,1);
 const s2=setup({'/api/season/1399/1':{episodes:[{number:2}]},'/api/tv/1399':{seasons:[{number:2}]},'/api/season/1399/2':{episodes:[{number:1,date:'2026-12-01'}]}});
 assert.equal(await s2.navigator.next(target),null);
});
test('catálogo é reaproveitado, cancelamento é respeitado e falha não altera a mídia',async()=>{
 const s=setup({'/api/season/1399/1':{episodes:[{number:2},{number:3}]}});await s.navigator.next(target);await s.navigator.next(target);assert.equal(s.calls.length,1);
 const controller=new AbortController();controller.abort();await assert.rejects(s.navigator.next(target,controller.signal));
 await assert.rejects(setup({}).navigator.next(target));
});
function browser(){
 const b={hidden:true,disabled:false},classes=new Set(['ativo']),opened=[],queued=[],calls=[];let resolveSlow;
 const window={StreamPlayback:{saveProgress(){calls.push('save');}},StreamPersonal:{queueEpisode:f=>queued.push(f)}};
 const context=vm.createContext({globalThis:window,document:{getElementById:id=>id==='next-episode'?b:id==='player'?{classList:{contains:c=>classes.has(c)}}:null},AbortController,setTimeout,clearTimeout,filmeAtual:target,lerJson:async path=>path.includes('/999/')?new Promise(r=>resolveSlow=r):{episodes:[{number:2},{number:3}]},abrirPlayer:async(...args)=>{opened.push(args);}});
 vm.runInContext(fs.readFileSync(__dirname+'/episodios.js','utf8'),context);return {window,context,b,opened,queued,calls,resolve:()=>resolveSlow?.({episodes:[{number:2},{number:3}]})};
}
test('botão preserva anime, idioma e progresso ao abrir o próximo sem fechar o player',async()=>{
 const s=browser();await s.window.StreamEpisodes.prepare(target);assert.equal(s.b.hidden,false);await s.window.StreamEpisodes.go();assert.deepEqual(s.calls,['save']);
 assert.equal(s.opened[0][1],'Série · T1 E3');assert.deepEqual(JSON.parse(JSON.stringify(s.opened[0][2])),{season:1,number:3,anime:true,audio:'legendado'});
 s.window.StreamEpisodes.finished(target);assert.equal(s.queued[0].episode.number,3);
});
test('trocar de título cancela o botão e ignora respostas atrasadas',async()=>{
 const s=browser(),slow={...target,id:999};s.context.filmeAtual=slow;const pending=s.window.StreamEpisodes.prepare(slow);
 s.context.filmeAtual={id:603,titulo:'Filme'};await s.window.StreamEpisodes.prepare(s.context.filmeAtual);s.resolve();await pending;
 assert.equal(s.b.hidden,true);await s.window.StreamEpisodes.go();assert.equal(s.opened.length,0);assert.equal(s.queued.length,0);
});
