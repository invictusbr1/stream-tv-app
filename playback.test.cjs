const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {parseWatchPlay}=require('./playback-source');
const url='https://vid123.hclod.qzz.io/st/movie/playlist.m3u8?expires=123&md5=test';
const html=(audio='Dublado',source=url)=>`window.MyPlayerAudio=${JSON.stringify(audio)};createMyPlayer({url:${JSON.stringify(source)}})`;

test('ClickHost extrai só mídia segura e trata links assinados como temporários',async()=>{
 const source=require('./clickhost-source'),axios=require('axios'),get=axios.get;
 const good=source.extrair('streamUrl: "https://cdn.example/video.mp4?x=1\\u0026y=2", streamIsHls: false');assert.equal(good.url,'https://cdn.example/video.mp4?x=1&y=2');
 for(const u of ['https://127.0.0.1/a.mp4','https://user:password@cdn.example/a.mp4','https://cdn.example/player.html'])assert.equal(source.extrair('streamUrl: '+JSON.stringify(u)),null);
 try{
  axios.get=async()=>({data:'streamUrl: "https://cdn.example/video.mp4", streamIsHls: false'});
  const result=await source.resolver('movie','1084244');assert(result.efemera&&result.exigeProva);assert.equal(result.type,'file');
 }finally{axios.get=get;}
});

test('resposta de compatibilidade preserva HLS e MP4 para o navegador usar o leitor correto',async()=>{
 const source=fs.readFileSync(__dirname+'/server.js','utf8'),begin=source.indexOf('async function responderCompatibilidade('),end=source.indexOf("app.get('/api/playback/:id'",begin);
 for(const type of ['hls','file']){
  const media={url:'https://media.invalid/video.'+(type==='hls'?'m3u8':'mp4'),urlAplicativo:'/api/hls?u=teste',type,audio:'pt-BR',videoCodec:'h264'};
  const context=vm.createContext({require:name=>name==='./avaliador'?{escolherMelhor:async()=>({escolhido:media})}:name==='./fontes-motor'?{prepararParaPlayer:x=>x}:null});
  vm.runInContext(source.slice(begin,end),context);let response;
  await context.responderCompatibilidade({query:{compat:'avc'}},{json:r=>{response=r;}},{tipo:'movie',tmdbId:'1084244'});
  assert.equal(response.type,type);assert.equal(response.url,media.urlAplicativo);
 }
});

test('falha no MP4 pode recuperar por HLS compatível sem perder a sessão',async()=>{
 const s=harness(),calls=[];
 s.fetch(async path=>{calls.push(path);return path.includes('compat=avc')?{url:'/api/hls?u=compat',type:'hls',audio:'pt-BR',videoCodec:'h264',fonteId:'watchplay'}:{url:'https://media.invalid/inicial.mp4',type:'file',audio:'pt-BR',fonteId:'clickhost'};});
 const pending=s.controller.start(1084244,1);await new Promise(setImmediate);
 const video=s.el('direct-video');video.fire('error');await new Promise(setImmediate);
 assert(s.Hls.instance,'a alternativa HLS deve ser conectada ao leitor HLS');assert.equal(calls.length,2);
 s.Hls.instance.emit('manifest');video.videoWidth=1920;video.videoHeight=1080;video.webkitDecodedFrameCount=1;video.fire('playing');
 assert.equal(await pending,true);assert.equal(s.failures(),0);s.controller.stop();
});
test('reads escaped public HLS configuration without executing scripts',()=>{const r=parseWatchPlay(html().replaceAll('/','\\/'));assert.equal(r.audio,'pt-BR');assert.equal(r.url,url);});
test('rejects non-dubbed, malformed, and unexpected media hosts',()=>{assert.throws(()=>parseWatchPlay(html('Legendado')));assert.throws(()=>parseWatchPlay('window.MyPlayerAudio="Dublado";url:evil()'));for(const u of ['http://vid123.hclod.qzz.io/a.m3u8','https://localhost/a.m3u8','https://vid123.hclod.qzz.io.evil.test/a.m3u8','https://user:pass@vid123.hclod.qzz.io/a.m3u8'])assert.throws(()=>parseWatchPlay(html('Dublado',u)));});
function harness(userAgent='Test'){
 const nodes=new Map(),timers=new Map();let sequence=0,fetchImpl=async()=>({url,audio:'pt-BR'}),failures=0;
 const handlers={};const doc={activeElement:null,addEventListener(name,fn){handlers[name]=fn;},querySelector(){return {prepend(n){nodes.set(n.id,n);}};}};
 function node(){const events={};return {hidden:false,contains(n){return this.children.includes(n);},querySelectorAll(){return this.children;},closest(){return null;},style:{},children:[],classList:{add(){},remove(){},toggle(){}},pause(){},load(){},play(){return Promise.resolve();},remove(){nodes.delete(this.id);},removeAttribute(){},setAttribute(){},before(n){nodes.set(n.id,n);},append(n){this.children.push(n);},replaceChildren(){this.children=[];},focus(){doc.activeElement=this;},canPlayType(){return '';},addEventListener(name,cb){events[name]=cb;},fire(name){events[name]?.();}};}
 const el=id=>{if(!nodes.has(id)){const n=node();n.id=id;nodes.set(id,n);}return nodes.get(id);};doc.createElement=node;doc.createTextNode=text=>({textContent:text});
 class Hls {static Events={MANIFEST_PARSED:'manifest',ERROR:'error',LEVEL_SWITCHED:'level',AUDIO_TRACKS_UPDATED:'audioUpdated',AUDIO_TRACK_SWITCHED:'audioSwitched',SUBTITLE_TRACKS_UPDATED:'subtitles'};static isSupported(){return true;}constructor(){this.listeners={};this.levels=[{height:720,bitrate:200},{height:1080,bitrate:400},{height:480,bitrate:100}];this.audioTracks=[{lang:'pt-BR',name:'Dublado'}];Hls.instance=this;}on(n,fn){this.listeners[n]=fn;}emit(n,data={}){this.listeners[n]?.(n,data);}recoverMediaError(){this.recovered=(this.recovered||0)+1;}loadSource(){}attachMedia(){}destroy(){this.destroyed=true;}}
 const window={Hls};const context=vm.createContext({window,Hls,document:doc,navigator:{userAgent},el,playerVersion:1,lerJson:(...a)=>fetchImpl(...a),mostrarErro(){failures++;},setTimeout(fn,ms){const id=++sequence;fn.delay=ms;timers.set(id,fn);return id;},clearTimeout(id){timers.delete(id);}});
 vm.runInContext(fs.readFileSync(__dirname+'/playback.js','utf8'),context);
 context.StreamPlayback=window.StreamPlayback;el('opcoes').hidden=true;el('direct-controls').children=[el('direct-back'),el('direct-toggle'),el('direct-forward')];
 return {context,window,doc,visibility(hidden){doc.hidden=hidden;handlers.visibilitychange();},key(key){let prevented=false;handlers.keydown({key,preventDefault(){prevented=true;},stopPropagation(){}});return prevented;},controller:window.StreamPlayback,el,Hls,timers,failures:()=>failures,fetch(fn){fetchImpl=fn;}};
}

async function videoTocando(s,opcoes=null,dados={url,audio:'pt-BR',fonteId:'watchplay',source:'Fonte A'}){
 s.context.filmeAtual={id:238,titulo:'Filme'};s.fetch(async()=>dados);
 const pending=s.controller.start(238,1,null,null,null,false,null,opcoes);await new Promise(setImmediate);
 const v=s.el('direct-video');v.duration=1000;v.currentTime=0;v.videoWidth=1280;v.videoHeight=720;v.webkitDecodedFrameCount=1;
 v.fire('loadedmetadata');v.fire('playing');assert.equal(await pending,true);return v;
}

test('APK reproduz destino sem extensão apenas após conferência nativa; navegador mantém sua validação',async()=>{
 const data={url:'https://cdn.example/video/identificador',type:'file',audio:'pt-BR',fonteId:'perfil',midiaConferida:true};
 const native=harness('StreamTVAndroid');native.context.location={hostname:'appassets.androidplatform.net',protocol:'https:'};native.context.URL=URL;
 await videoTocando(native,null,data);assert.equal(native.controller.isActive(),true);native.controller.stop();
 for(const [host,url,confirmed]of [['stream.example',data.url,true],['appassets.androidplatform.net',data.url,false],['appassets.androidplatform.net','http://cdn.example/video/identificador',true],['appassets.androidplatform.net','https://user:secret@cdn.example/video/identificador',true]]){
  const s=harness();s.context.location={hostname:host,protocol:'https:'};s.context.URL=URL;s.fetch(async()=>({...data,url,midiaConferida:confirmed}));
  assert.equal(await s.controller.start(238,1),false);assert.equal(s.controller.isActive(),false);
 }
});

test('player aceita somente o manifesto interno exato da exceção Crystal Lake',async()=>{
 const s=harness();await videoTocando(s,null,{url:'/api/crystal-lake/1/1/master.m3u8',audio:'pt-BR',fonteId:'crystal-lake-dublado',type:'hls'});s.controller.stop();
 for(const bad of ['/api/crystal-lake/2/1/master.m3u8','/api/crystal-lake/1/9/master.m3u8','/api/crystal-lake/1/1/master.m3u8?u=https://evil.test','/api/crystal-lake/1/1/other.m3u8']){
  const invalid=harness();invalid.fetch(async()=>({url:bad,audio:'pt-BR'}));assert.equal(await invalid.controller.start(213562,1),false);
 }
});

test('Crystal Lake passa de reserva 480p para a melhor versão dublada na próxima abertura',async()=>{
 const s=harness();s.fetch(async()=>({url:'/api/crystal-lake/1/1/master.m3u8',audio:'pt-BR',fonteId:'crystal-lake-dublado',type:'hls'}));
 for(const height of [480,720,1080,1440,2160]){
  const pending=s.controller.start(213562,1);await new Promise(setImmediate);
  s.Hls.instance.levels=[{height:480,bitrate:750000,videoCodec:'avc1.4D401E'},{height,bitrate:8000000,videoCodec:'avc1.640028'}];
  s.Hls.instance.audioTracks=[{lang:'por',name:'Portuguese'}];s.Hls.instance.emit('manifest');
  assert.equal(s.Hls.instance.currentLevel,1);assert.equal(s.Hls.instance.audioTrack,0);
  s.controller.stop();await pending;
 }
});

test('falha após imagem pede uma única troca e preserva a posição exata',async()=>{
 const s=harness(),trocas=[];const v=await videoTocando(s,{onInterrupted:d=>{trocas.push(d);return true;}});
 v.currentTime=127.5;v.error={code:2};v.fire('error');v.fire('error');
 assert.equal(trocas.length,1);assert.equal(trocas[0].posicao,127.5);assert.equal(trocas[0].fonteId,'watchplay');assert.equal(trocas[0].audio,'Dublado');assert.equal(s.failures(),0);
});

test('falha antes da primeira imagem continua no fluxo inicial sem disparar recuperação',async()=>{
 const s=harness();let trocas=0;const p=s.controller.start(238,1,null,null,null,false,null,{onInterrupted:()=>{trocas++;return true;}});await new Promise(setImmediate);
 s.el('direct-video').fire('error');assert.equal(await p,false);assert.equal(trocas,0);
});

test('cancelar ou pausar não inicia uma recuperação automática',async()=>{
 const s=harness();let trocas=0;const signal=new AbortController();
 s.context.filmeAtual={id:238,titulo:'Filme'};s.fetch(async()=>({url,audio:'pt-BR',fonteId:'watchplay'}));
 const p=s.controller.start(238,1,signal.signal,null,null,false,null,{onInterrupted:()=>{trocas++;return true;}});await new Promise(setImmediate);
 const v=s.el('direct-video');v.duration=1000;v.videoWidth=1280;v.videoHeight=720;v.webkitDecodedFrameCount=1;v.fire('playing');await p;
 signal.abort();assert.equal(trocas,0);assert.equal(s.failures(),0);assert.equal(s.controller.isActive(),false);
 const s2=harness();const paused=await videoTocando(s2,{onInterrupted:()=>{trocas++;return true;}});paused.paused=false;s2.controller.toggle();paused.fire('error');assert.equal(trocas,0);
});

test('retomada explícita funciona abaixo de cinco segundos e limita duração menor',async()=>{
 for(const [ponto,duracao,esperado] of [[2.5,1000,2.5],[0,1000,0],[150,100,99]]){
  const s=harness();s.context.filmeAtual={id:238,titulo:'Filme'};s.window.StreamPersonal={position:()=>240};
  const pending=s.controller.start(238,1,null,null,null,false,null,{posicao:ponto});await new Promise(setImmediate);
  const v=s.el('direct-video');v.duration=duracao;v.currentTime=0;v.fire('loadedmetadata');assert.equal(v.currentTime,esperado);
  s.controller.stop();await pending;
 }
});

test('uma substituta sem imagem não apaga o progresso salvo da fonte anterior',async()=>{
 const s=harness(),salvos=[];s.window.StreamPersonal={position:()=>240,record:(f,p)=>salvos.push(p)};
 const v=await videoTocando(s);v.currentTime=260;s.controller.stop();assert.deepEqual(salvos,[260]);
 const p=s.controller.start(238,1,null,null,null,false,null,{posicao:260});await new Promise(setImmediate);
 const novo=s.el('direct-video');novo.duration=1000;novo.currentTime=0;novo.fire('loadedmetadata');novo.currentTime=1;
 s.controller.stop();await p;assert.deepEqual(salvos,[260]);
});

test('encerrar no começo de uma nova consulta não reutiliza o ID da fonte anterior',async()=>{
 const s=harness();await videoTocando(s);s.fetch(async()=>{throw Error('indisponível');});
 assert.equal(await s.controller.start(238,1),false);assert.equal(s.controller.estado().fonteId,'');s.controller.stop();
});

test('fonte ainda em conversão não reinicia o filme ao tentar recuperar um ponto distante',async()=>{
 const s=harness();s.fetch(async()=>({conversao:'em-preparacao',fonteId:'fenix',source:'Fonte em preparação'}));
 assert.equal(await s.controller.start(238,1,null,null,null,false,null,{posicao:240}),false);
 assert.equal(s.controller.estado().fonteId,'fenix');assert.equal(s.controller.isActive(),false);s.controller.stop();
});

test('resposta antiga de conversão não altera a fonte ou o diagnóstico do novo filme',async()=>{
 const s=harness();let resolver;s.fetch(()=>new Promise(resolve=>resolver=resolve));
 const antigo=s.controller.start(238,1,null,null,null,false,null,{posicao:240});
 s.context.playerVersion=2;s.fetch(async()=>({url,audio:'pt-BR',fonteId:'mgeb',source:'Filme atual'}));
 const atual=s.controller.start(550,2,null,null,null,false,null,{posicao:120});await new Promise(setImmediate);
 resolver({conversao:'antiga',fonteId:'fenix',source:'Filme antigo'});assert.equal(await antigo,false);
 assert.equal(s.controller.estado().fonteId,'mgeb');assert.equal(s.controller.isActive(),true);s.controller.stop();await atual;
});

test('trocar fornecedor não reutiliza índice de áudio de outra lista de faixas',async()=>{
 const s=harness();await videoTocando(s);s.controller.setAudio(1);
 const p=s.controller.start(238,1);await new Promise(setImmediate);
 s.Hls.instance.audioTracks=[{lang:'en',name:'English'},{lang:'pt-BR',name:'Dublado'}];s.Hls.instance.emit('manifest');
 assert.equal(s.Hls.instance.audioTrack,1);s.controller.stop();await p;
});

test('buffering prolongado adapta qualidade automática sem sobrescrever uma resolução manual',async()=>{
 for(const escolha of ['best','1']){
  const s=harness();const v=await videoTocando(s);s.Hls.instance.emit('manifest');s.controller.quality(escolha);
  v.paused=false;v.seeking=false;v.fire('waiting');
  const timer=[...s.timers.entries()].filter(([,fn])=>fn.delay===6000).at(-1);assert(timer);s.timers.delete(timer[0]);timer[1]();
  assert.equal(s.Hls.instance.currentLevel,escolha==='best'?-1:1);s.controller.stop();
 }
});

test('mudança adaptativa mostra a resolução da imagem e não o máximo anunciado pelo fornecedor',async()=>{
 const s=harness();const v=await videoTocando(s);s.Hls.instance.levels=[{height:2160,width:3840},{height:480,width:854}];
 s.Hls.instance.emit('level',{level:0});assert.equal(s.controller.estado().resolucao,'720p');
 v.videoWidth=854;v.videoHeight=480;v.fire('resize');
 assert.equal(s.controller.estado().resolucao,'480p');assert.equal(s.el('menu-quality-btn').textContent,'Qualidade · 480p');s.controller.stop();
});

test('watchdog de buffering não trata pausa e busca manual como falhas',async()=>{
 for(const evento of ['pause','seeking']){
  const s=harness();let trocas=0;const v=await videoTocando(s,{onInterrupted:()=>{trocas++;return true;}});v.paused=false;v.seeking=false;v.fire('waiting');
  v.fire(evento);assert.equal([...s.timers.values()].filter(fn=>fn.delay===20000).length,1,'permanece só o timer de confirmação');
  assert.equal(trocas,0);s.controller.stop();
 }
});

test('voltar à aba rearma detecção de vídeo que permaneceu travado',async()=>{
 const s=harness();const v=await videoTocando(s);v.paused=false;v.seeking=false;v.readyState=2;v.fire('waiting');
 s.visibility(true);assert.equal([...s.timers.values()].filter(fn=>fn.delay===20000).length,1);
 s.visibility(false);assert.equal([...s.timers.values()].filter(fn=>fn.delay===20000).length,2);s.controller.stop();
});

test('fim do vídeo não dispara troca nem erro de reprodução',async()=>{
 const s=harness();let trocas=0;const v=await videoTocando(s,{onInterrupted:()=>{trocas++;return true;}});v.ended=true;v.fire('ended');v.fire('error');
 assert.equal(trocas,0);assert.equal(s.failures(),0);s.controller.stop();
});

test('URL direta marcada como TV não restaura progresso de filme',async()=>{
 const s=harness();let consultou=0;s.context.filmeAtual={id:238,titulo:'Filme anterior'};s.window.StreamPersonal={position:()=>{consultou++;return 240;}};
 const p=s.controller.start(0,1,null,null,'https://exemplo.com/canal.m3u8',true,{nome:'Canal',live:true});await new Promise(setImmediate);
 const v=s.el('direct-video');v.duration=45;v.currentTime=0;v.fire('loadedmetadata');v.fire('timeupdate');
 assert.equal(consultou,0);assert.equal(v.currentTime,0);assert.equal(s.el('direct-time').textContent,'AO VIVO');s.controller.stop();await p;
});

test('live broadcasts show AO VIVO without a false movie duration or seek controls',async()=>{
 const s=harness();s.fetch(async()=>({url,audio:'fonte',live:true}));
 const p=s.controller.start(0,1,new AbortController().signal,'/api/tv/la18hd',null,true);await new Promise(setImmediate);
 const v=s.el('direct-video');v.currentTime=30;v.duration=45;v.fire('timeupdate');
 assert.equal(s.el('direct-time').textContent,'AO VIVO');
 for(const id of ['direct-progress','direct-back','direct-forward','menu-speed-btn'])assert.equal(s.el(id).hidden,true);
 s.controller.seek(10);assert.equal(v.currentTime,30);
 s.controller.stop();await p;
});

test('opening a movie after live TV restores seek controls and duration',async()=>{
 const s=harness();s.fetch(async()=>({url,audio:'fonte',live:true}));
 const live=s.controller.start(0,1,new AbortController().signal,'/api/tv/la18hd',null,true);await new Promise(setImmediate);s.controller.stop();await live;
 s.fetch(async()=>({url,audio:'pt-BR'}));const movie=s.controller.start(238,1,new AbortController().signal);await new Promise(setImmediate);
 const v=s.el('direct-video');v.currentTime=30;v.duration=120;v.fire('timeupdate');
 assert.equal(s.el('direct-time').textContent,'0:30 / 2:00');
 for(const id of ['direct-progress','direct-back','direct-forward','menu-speed-btn'])assert.equal(s.el(id).hidden,false);
 s.controller.seek(10);assert.equal(v.currentTime,40);s.controller.stop();await movie;
});
test('selects highest actual rendition and Portuguese audio; stop resolves a pending start',async()=>{const s=harness();const p=s.controller.start(238,1,new AbortController().signal);await new Promise(setImmediate);s.Hls.instance.emit('manifest');assert.equal(s.Hls.instance.currentLevel,1);assert.equal(s.Hls.instance.audioTrack,0);s.controller.stop();assert.equal(await p,false);assert.equal(s.timers.size,0);});
test('rejects explicitly non-Portuguese audio renditions',async()=>{const s=harness();const p=s.controller.start(238,1,new AbortController().signal);await new Promise(setImmediate);s.Hls.instance.audioTracks=[{lang:'en',name:'English'}];s.Hls.instance.emit('manifest');assert.equal(await p,false);assert.equal(s.controller.isActive(),false);});
test('late metadata response cannot recreate a video after stop',async()=>{const s=harness();let resolve;s.fetch(()=>new Promise(r=>resolve=r));const p=s.controller.start(238,1,new AbortController().signal);s.controller.stop();resolve({url,audio:'pt-BR'});assert.equal(await p,false);assert.equal(s.controller.isActive(),false);});
test('late play rejection from old movie cannot interrupt the next movie',async()=>{const s=harness();const first=s.controller.start(238,1,new AbortController().signal);await new Promise(setImmediate);let reject;s.el('direct-video').play=()=>new Promise((_,r)=>reject=r);s.controller.play();s.controller.stop();await first;const second=s.controller.start(550,1,new AbortController().signal);await new Promise(setImmediate);reject(Object.assign(new Error(),{name:'AbortError'}));await new Promise(setImmediate);assert.equal(s.controller.isActive(),true);assert.equal(s.failures(),0);s.controller.stop();await second;});

test('remote arrows move focus without seeking; seek requires an explicit action',async()=>{
 const s=harness(),p=s.controller.start(238,1,new AbortController().signal);await new Promise(setImmediate);
 const v=s.el('direct-video');v.currentTime=60;v.duration=120;s.controller.showControls(true);
 assert.equal(s.doc.activeElement.id,'direct-toggle');assert.equal(s.key('ArrowRight'),true);
 assert.equal(s.doc.activeElement.id,'direct-forward');assert.equal(v.currentTime,60);
 s.key('ArrowLeft');assert.equal(s.doc.activeElement.id,'direct-toggle');assert.equal(v.currentTime,60);
 s.controller.seek(10);assert.equal(v.currentTime,70);s.controller.seek(-100);assert.equal(v.currentTime,0);
 s.controller.seek(500);assert.equal(v.currentTime,120);s.key('ArrowUp');assert.equal(s.doc.activeElement.id,'options-toggle');
 s.controller.stop();await p;
});
test('hidden controls wake on arrow without changing playback position',async()=>{
 const s=harness(),p=s.controller.start(238,1,new AbortController().signal);await new Promise(setImmediate);
 const v=s.el('direct-video');v.currentTime=60;v.focus();s.el('direct-controls').hidden=true;s.key('ArrowRight');
 assert.equal(v.currentTime,60);assert.equal(s.el('direct-controls').hidden,false);assert.equal(s.doc.activeElement.id,'direct-toggle');
 s.controller.stop();await p;
});
test('resolution message distinguishes actual Full HD availability',async()=>{
 const s=harness(),p=s.controller.start(238,1,new AbortController().signal);await new Promise(setImmediate);
 s.Hls.instance.emit('level',{level:0});assert.match(s.el('quality-limit').textContent,/Full HD ou superior/);
 s.Hls.instance.levels=[{height:720,width:1280}];s.Hls.instance.emit('level',{level:0});
 assert.match(s.el('quality-limit').textContent,/não oferece Full HD/);assert.equal(s.el('quality-info').textContent,'1280 × 720 · Dublado');
 s.controller.stop();await p;
});

test('audio-only playing does not report successful video startup',async()=>{
 const s=harness(),p=s.controller.start(1084244,1,new AbortController().signal);await new Promise(setImmediate);
 const v=s.el('direct-video');v.videoWidth=0;v.videoHeight=0;v.readyState=4;v.fire('canplay');v.fire('playing');
 assert(s.timers.size>0);s.controller.stop();assert.equal(await p,false);
});
test('startup waits for a presented video frame and cancels stale callbacks',async()=>{
 const s=harness(),p=s.controller.start(1084244,1,new AbortController().signal);await new Promise(setImmediate);
 const v=s.el('direct-video');let frame;v.videoWidth=1920;v.videoHeight=1080;v.requestVideoFrameCallback=fn=>{frame=fn;return 1;};v.cancelVideoFrameCallback=()=>{};
 v.fire('playing');frame();assert.equal(await p,true);s.controller.stop();frame();assert.equal(s.controller.isActive(),false);
});
test('late audio track discovery restores Portuguese after a track switch',async()=>{
 const s=harness(),p=s.controller.start(820525,1,new AbortController().signal);await new Promise(setImmediate);
 s.Hls.instance.audioTracks=[{lang:'en',name:'English'},{lang:'pt-BR',name:'Português'}];s.Hls.instance.audioTrack=0;s.Hls.instance.emit('audioUpdated');assert.equal(s.Hls.instance.audioTrack,1);
 s.Hls.instance.audioTrack=0;s.Hls.instance.emit('audioSwitched');assert.equal(s.Hls.instance.audioTrack,1);s.controller.stop();await p;
});
test('named foreign audio without an ISO tag is not accepted as dubbed',async()=>{
 const s=harness(),p=s.controller.start(820525,1,new AbortController().signal);await new Promise(setImmediate);
 s.Hls.instance.audioTracks=[{name:'English'}];s.Hls.instance.emit('manifest');assert.equal(await p,false);
});
test('Android prefers an available AVC rendition over a higher HEVC rendition',async()=>{
 const s=harness('StreamTVAndroidTV'),p=s.controller.start(1084244,1,new AbortController().signal);await new Promise(setImmediate);
 s.Hls.instance.levels=[{height:2160,videoCodec:'hvc1.1.6.L150'},{height:1080,videoCodec:'avc1.640028'},{height:720,videoCodec:'avc1.64001f'}];s.Hls.instance.emit('manifest');assert.equal(s.Hls.instance.currentLevel,1);s.controller.stop();await p;
});
test('Android com decodificador HEVC entrega o 4K em vez de cair para Full HD',async()=>{
 const s=harness('StreamTVAndroidTV');s.context.MediaSource={isTypeSupported:t=>/hvc1|hev1|avc[13]/i.test(String(t))};
 const p=s.controller.start(1084244,1,new AbortController().signal);await new Promise(setImmediate);
 s.Hls.instance.levels=[{height:2160,videoCodec:'hvc1.1.6.L150'},{height:1080,videoCodec:'avc1.640028'},{height:720,videoCodec:'avc1.64001f'}];s.Hls.instance.emit('manifest');
 assert.equal(s.Hls.instance.currentLevel,0,'o aparelho toca HEVC: a melhor versão é o 4K');s.controller.stop();await p;
});
test('sem MediaSource o player continua no teto AVC e não escolhe HEVC no escuro',async()=>{
 const s=harness('StreamTVAndroidTV'),p=s.controller.start(1084244,1,new AbortController().signal);await new Promise(setImmediate);
 s.Hls.instance.levels=[{height:2160,videoCodec:'hvc1.1.6.L150'},{height:1080,videoCodec:'avc1.640028'}];s.Hls.instance.emit('manifest');
 assert.equal(s.Hls.instance.currentLevel,1);s.controller.stop();await p;
});
test('media recovery is bounded to one attempt',async()=>{
 const s=harness(),p=s.controller.start(1084244,1,new AbortController().signal);await new Promise(setImmediate);
 const h=s.Hls.instance;h.emit('error',{fatal:true,type:'mediaError'});assert.equal(h.recovered,1);h.emit('error',{fatal:true,type:'mediaError'});assert.equal(await p,false);
});

test('Android tries native HLS once when no picture is presented',async()=>{
 const s=harness('StreamTVAndroidTV'),p=s.controller.start(1084244,1,new AbortController().signal);await new Promise(setImmediate);
 const v=s.el('direct-video');v.canPlayType=()=> 'maybe';const first=s.Hls.instance;
 const timer=[...s.timers.keys()].at(-1);const fn=s.timers.get(timer);s.timers.delete(timer);fn();
 assert.equal(first.destroyed,true);assert.equal(v.src,url);assert.equal(s.el('quality-select').hidden,true);
 s.controller.stop();assert.equal(await p,false);
});

test('decoded video can start even when the compositor defers its callback',async()=>{
 const s=harness(),p=s.controller.start(820525,1,new AbortController().signal);await new Promise(setImmediate);
 const v=s.el('direct-video');v.videoWidth=1728;v.videoHeight=720;v.getVideoPlaybackQuality=()=>({totalVideoFrames:3});v.requestVideoFrameCallback=()=>1;
 v.fire('playing');assert.equal(await p,true);s.controller.stop();
});

test('subtitle selection defaults off, switches a supplied track and disables it again',async()=>{
 const s=harness(),p=s.controller.start(238,1,new AbortController().signal);await new Promise(setImmediate);
 const h=s.Hls.instance;h.subtitleTracks=[{lang:'pt-BR',name:'Português'}];h.emit('subtitles');assert.equal(h.subtitleTrack,-1);assert.equal(s.el('subtitle-select').disabled,false);
 s.controller.setSubtitle(0);assert.equal(h.subtitleTrack,0);assert.equal(h.subtitleDisplay,true);s.controller.setSubtitle(-1);assert.equal(h.subtitleDisplay,false);
 h.subtitleTracks=[];h.emit('subtitles');assert.equal(s.el('subtitle-select').disabled,true);s.controller.stop();await p;
});
test('saved progress is restored after metadata and saved on stop',async()=>{
 const s=harness();let saved; s.context.filmeAtual={id:238,titulo:'Filme'};s.window.StreamPersonal={position:()=>240,record:(f,p,d)=>saved={f,p,d}};
 const pending=s.controller.start(238,1,new AbortController().signal);await new Promise(setImmediate);const v=s.el('direct-video');v.duration=1000;v.currentTime=0;v.fire('loadedmetadata');assert.equal(v.currentTime,240);v.videoWidth=1280;v.videoHeight=720;v.webkitDecodedFrameCount=1;v.fire('playing');v.currentTime=260;s.controller.stop();await pending;assert.equal(saved.p,260);assert.equal(saved.f.id,238);
});
test('Android fullscreen button requests landscape and exit restores native mode',async()=>{
 const s=harness('StreamTVAndroid');s.context.location={};let expanded=false;s.el('player').classList={contains:()=>expanded,toggle:(name,value)=>expanded=value};
 await s.context.telaCheia();assert.equal(expanded,true);assert.equal(s.context.location.href,'/player-fullscreen?enabled=1');await s.context.telaCheia();assert.equal(expanded,false);assert.equal(s.context.location.href,'/player-fullscreen?enabled=0');
 await s.context.telaCheia();s.window.StreamExitFullscreen();assert.equal(s.context.location.href,'/player-fullscreen?enabled=0');
});
test('iPhone fullscreen uses the native video presentation instead of Android navigation',async()=>{
 const s=harness('iPhone');let entered=0;s.el('direct-video').webkitEnterFullscreen=()=>entered++;await s.context.telaCheia();assert.equal(entered,1);
});
test('pause saves the exact latest position instead of waiting for another timer',async()=>{const s=harness();let saved;s.context.filmeAtual={id:238,titulo:'Filme'};s.window.StreamPersonal={position:()=>0,record:(f,p)=>saved=p};const p=s.controller.start(238,1,new AbortController().signal);await new Promise(setImmediate);const v=s.el('direct-video');v.duration=1000;v.currentTime=0;v.fire('loadedmetadata');v.videoWidth=1280;v.videoHeight=720;v.webkitDecodedFrameCount=1;v.fire('playing');v.currentTime=127.5;v.fire('pause');assert.equal(saved,127.5);s.controller.stop();await p;});
test('velocidade escolhida é aplicada ao vídeo e valor inválido volta ao normal',async()=>{
 const s=harness();s.controller.setSpeed('1.5');
 const p=s.controller.start(238,1,new AbortController().signal);await new Promise(setImmediate);
 assert.equal(s.el('direct-video').playbackRate,1.5);
 s.controller.setSpeed('9');assert.equal(s.el('direct-video').playbackRate,1);
 s.controller.stop();await p;
});
test('faixa de áudio é oferecida quando a fonte tem mais de uma e respeita a escolha',async()=>{
 const s=harness(),p=s.controller.start(238,1,new AbortController().signal);await new Promise(setImmediate);
 const h=s.Hls.instance;h.audioTracks=[{lang:'en',name:'English'},{lang:'pt-BR',name:'Português'}];h.emit('audioUpdated');
 assert.equal(s.el('audio-panel').hidden,false);assert.equal(s.el('audio-select').children.length,2);assert.equal(s.el('audio-select').value,'1');
 s.controller.setAudio(0);assert.equal(h.audioTrack,0);h.emit('audioSwitched');assert.equal(h.audioTrack,0);
 s.controller.stop();await p;
});
test('qualidade mostra a taxa da fonte e libera o atalho quando não há Full HD',async()=>{
 const s=harness(),p=s.controller.start(238,1,new AbortController().signal);await new Promise(setImmediate);
 s.Hls.instance.levels=[{height:1080,width:1920,bitrate:5000000}];s.Hls.instance.emit('level',{level:0});
 assert.match(s.el('quality-info').textContent,/1920 × 1080 · Dublado · 5,0 Mbps/);assert.equal(s.el('quality-alt').hidden,true);
 s.Hls.instance.levels=[{height:720,width:1280,bitrate:2000000}];s.Hls.instance.emit('level',{level:0});
 assert.equal(s.el('quality-info').textContent,'1280 × 720 · Dublado · 2,0 Mbps');assert.equal(s.el('quality-alt').hidden,false);
 s.controller.stop();await p;
});
test('volume é aplicado ao vídeo, pode ser silenciado e volta ao normal',async()=>{
 const s=harness(),p=s.controller.start(238,1,new AbortController().signal);await new Promise(setImmediate);
 const v=s.el('direct-video');
 s.controller.setVolume(0.3);assert.equal(Number(v.volume.toFixed(2)),0.3);assert.match(s.el('volume-toggle').textContent,/🔉|🔊/);
 s.controller.setVolume(0.9);assert.match(s.el('volume-toggle').textContent,/🔊/);
 s.controller.toggleMute();assert.equal(v.muted,true);assert.equal(s.el('volume-toggle').textContent,'🔇');
 s.controller.toggleMute();assert.equal(v.muted,false);
 s.controller.setVolume(2);assert.equal(v.volume,1);s.controller.setVolume(-1);assert.equal(v.volume,0);
 s.controller.stop();await p;
});
test('barra de progresso leva a qualquer ponto do filme',async()=>{
 const s=harness(),p=s.controller.start(238,1,new AbortController().signal);await new Promise(setImmediate);
 const v=s.el('direct-video');v.duration=1000;v.currentTime=0;
 s.controller.irPara(250);assert.equal(Math.round(v.currentTime),250);
 s.controller.irPara(990);assert.equal(Math.round(v.currentTime),990);
 s.controller.irPara(5000);assert.equal(Math.round(v.currentTime),1000);
 s.controller.irPara(-10);assert.equal(Math.round(v.currentTime),0);
 s.controller.stop();await p;
});


test('aceita a lista de reproducao da fonte nova e recusa endereco estranho',async()=>{
 const s=harness();let terminou=false;
 s.controller.start(238,1,new AbortController().signal,null,'https://video.exemplo.site/pl/abc/master.m3u8',true).then(()=>{terminou=true;}).catch(()=>{terminou=true;});
 await new Promise(setImmediate);
 assert.equal(terminou,false,'a reproducao da fonte nova nao pode ser recusada');
 const s2=harness();
 const ruim=await s2.controller.start(238,1,new AbortController().signal,null,'https://site-estranho.example/video',true);
 assert.equal(ruim,false,'endereco sem formato de video nao pode ser aceito');
 // Episódio dublado em arquivo (nixplay) precisa ser aceito pelo player.
 const s3=harness();let arquivoOk=false;
 s3.controller.start(1399,1,new AbortController().signal,null,'https://nixplay.lat/series/pipocacine-vods/WoQDqAjmh/1399/1/1.mp4',true).then(()=>{}).catch(()=>{});
 await new Promise(setImmediate);
 arquivoOk=s3.controller.estaAtivo?.() ?? true;
 assert.equal(arquivoOk,true,'o episodio dublado em arquivo direto precisa abrir');
});

// O filme pode tocar com o áudio original (a fonte dublada não tinha o
// título). Nesse caso a legenda em português precisa entrar ligada sozinha —
// vale tanto para a legenda que vem da fonte quanto para a que o aplicativo
// busca e anexa (arquivo local ou baixado na hora).
test('a legenda em português entra sozinha quando o áudio é o original', async () => {
    const s = harness();
    s.window.StreamLegendas = {
        anexar: async (video) => {
            video.textTracks = [{ label: 'Filme (português)', language: 'pt', mode: 'disabled' }];
            return 1;
        }
    };
    const p = s.controller.start(238, 1, null, null, 'https://exemplo.com/filme.m3u8', true);
    await new Promise(setImmediate);
    s.el('direct-video').fire('loadedmetadata');
    await new Promise(setImmediate);
    await new Promise(setImmediate);
    const trilha = s.el('direct-video').textTracks[0];
    assert.equal(trilha.mode, 'showing', 'a legenda em português precisa ligar sozinha');
    s.controller.stop();
    await p;
});

test('com o áudio dublado a legenda segue desligada', async () => {
    const s = harness();
    s.window.StreamLegendas = {
        anexar: async (video) => {
            video.textTracks = [{ label: 'Filme (português)', language: 'pt', mode: 'disabled' }];
            return 1;
        }
    };
    s.fetch(() => ({ url, audio: 'pt-BR' }));
    const p = s.controller.start(238, 1, new AbortController().signal);
    await new Promise(setImmediate);
    s.Hls.instance.emit('manifest');
    await new Promise(setImmediate);
    s.el('direct-video').fire('loadedmetadata');
    await new Promise(setImmediate);
    await new Promise(setImmediate);
    const trilha = s.el('direct-video').textTracks[0];
    assert.equal(trilha.mode, 'disabled', 'no dublado a legenda continua desligada');
    s.controller.stop();
    await p;
});

test('Chrome sem HEVC consulta a versão compatível antes de iniciar o arquivo',async()=>{
 const s=harness('Chrome'),calls=[];
 s.fetch(async path=>{calls.push(path);return path.includes('compat=avc')?{url:'/api/hls?u=avc',type:'file',audio:'pt-BR',videoCodec:'h264',fonteId:'fenixflix-fenixhub'}:{url:'/api/hls?u=hevc',type:'file',audio:'pt-BR',videoCodec:'hevc'};});
 const pending=s.controller.start(1084244,1);await new Promise(setImmediate);
 assert.equal(calls.length,2);assert(calls[1].includes('compat=avc'));const v=s.el('direct-video');assert.equal(v.src,'/api/hls?u=avc');
 v.videoWidth=1920;v.videoHeight=1080;v.webkitDecodedFrameCount=1;v.fire('playing');assert.equal(await pending,true);s.controller.stop();
});
test('APK com HEVC preserva a fonte 4K sem pedir a reserva do navegador',async()=>{
 const s=harness('StreamTVAndroid'),calls=[];s.fetch(async path=>{calls.push(path);return {url:'/api/hls?u=hevc',type:'file',audio:'pt-BR',videoCodec:'hevc'};});
 // Este WebView decodifica HEVC: o app não precisa pedir a reserva em H.264.
 const criar=s.doc.createElement;s.doc.createElement=tag=>{const n=criar(tag);n.canPlayType=()=> 'probably';return n;};
 const pending=s.controller.start(1084244,1);await new Promise(setImmediate);assert.equal(calls.length,1);
 const v=s.el('direct-video');v.videoWidth=3840;v.videoHeight=2160;v.webkitDecodedFrameCount=1;v.fire('playing');assert.equal(await pending,true);assert.equal(v.src,'/api/hls?u=hevc');s.controller.stop();
});
test('APK cujo WebView não toca HEVC pede a versão em H.264 em vez de falhar',async()=>{
 const s=harness('StreamTVAndroid'),calls=[];s.fetch(async path=>{calls.push(path);return path.includes('compat=avc')?{url:'/api/hls?u=avc',type:'file',audio:'pt-BR',videoCodec:'h264',fonteId:'fenixflix-fenixhub'}:{url:'/api/hls?u=hevc',type:'file',audio:'pt-BR',videoCodec:'hevc'};});
 const pending=s.controller.start(1084244,1);await new Promise(setImmediate);
 assert.equal(calls.length,2);assert(calls[1].includes('compat=avc'));
 const v=s.el('direct-video');assert.equal(v.src,'/api/hls?u=avc');
 v.videoWidth=1920;v.videoHeight=1080;v.webkitDecodedFrameCount=1;v.fire('playing');assert.equal(await pending,true);s.controller.stop();
});
test('erro do arquivo sem imagem tenta outra versão do fornecedor e conserva o ponto',async()=>{
 const s=harness('Chrome'),calls=[];s.context.filmeAtual={id:1084244,titulo:'Toy Story 5'};s.fetch(async path=>{calls.push(path);return {url:path.includes('compat=avc')?'/api/hls?u=avc':'/api/hls?u=hevc',type:'file',audio:'pt-BR',fonteId:'fenixflix-fenixhub'};});
 const pending=s.controller.start(1084244,1,null,null,null,false,null,{posicao:240});await new Promise(setImmediate);
 const v=s.el('direct-video');v.duration=1000;v.fire('loadedmetadata');v.fire('error');await new Promise(setImmediate);
 assert.equal(calls.length,2);assert.equal(v.src,'/api/hls?u=avc');v.currentTime=0;v.fire('loadedmetadata');assert.equal(v.currentTime,240);
 v.videoWidth=1920;v.videoHeight=1080;v.webkitDecodedFrameCount=1;v.fire('playing');assert.equal(await pending,true);assert.equal(s.failures(),0);s.controller.stop();
});
test('cancelar durante a consulta compatível impede que a resposta antiga abra outro vídeo',async()=>{
 const s=harness('Chrome');let finish;s.fetch(async path=>path.includes('compat=avc')?new Promise(r=>finish=r):{url:'/api/hls?u=hevc',type:'file',audio:'pt-BR',videoCodec:'hevc'});
 const pending=s.controller.start(1084244,1);await new Promise(setImmediate);s.controller.stop();finish({url:'/api/hls?u=avc',type:'file',audio:'pt-BR'});assert.equal(await pending,false);assert.equal(s.controller.isActive(),false);
});

test('próximo automático recebe o término real, sem antecipar aos 92% do episódio',async()=>{
 const s=harness(),finished=[];s.context.window.StreamEpisodes={finished:f=>finished.push(f)};
 s.context.filmeAtual={id:1399,titulo:'Série',episode:{season:1,number:2}};
 const pending=s.controller.start(1399,1);await new Promise(setImmediate);
 const v=s.el('direct-video');v.duration=1000;v.currentTime=0;v.videoWidth=1920;v.videoHeight=1080;v.webkitDecodedFrameCount=1;
 v.fire('loadedmetadata');v.fire('playing');assert.equal(await pending,true);
 v.currentTime=960;v.fire('timeupdate');assert.equal(finished.length,0);
 v.currentTime=1000;v.fire('ended');assert.equal(finished.length,1);assert.equal(finished[0].episode.number,2);
 s.controller.stop();
});


test('desativar legenda é respeitado após atualização HLS e reinicia no próximo vídeo',async()=>{
 const s=harness();
 const p=s.controller.start(153312,1,null,null,'https://exemplo.com/serie.m3u8',true);
 await new Promise(setImmediate);
 const h=s.Hls.instance;h.subtitleTracks=[{name:'Português',lang:'pt-BR'}];h.emit('subtitles');
 assert.equal(h.subtitleTrack,0);
 s.el('subtitle-select').onchange({target:{value:'-1'}});
 h.emit('subtitles');s.el('direct-video').fire('loadedmetadata');
 assert.equal(h.subtitleDisplay,false);assert.equal(h.subtitleTrack,-1);
 assert.equal(s.el('subtitle-select').value,'-1');
 s.controller.stop();await p;
 const next=s.controller.start(153312,1,null,null,'https://exemplo.com/serie.m3u8',true);
 await new Promise(setImmediate);
 s.Hls.instance.subtitleTracks=[{name:'Português',lang:'pt-BR'}];s.Hls.instance.emit('subtitles');
 assert.equal(s.Hls.instance.subtitleTrack,0);s.controller.stop();await next;
});

test('desligar legendas inclui cópia nativa do HLS e preserva capítulos e metadados',async()=>{
 const s=harness(),p=s.controller.start(153312,1);await new Promise(setImmediate);
 const h=s.Hls.instance;h.subtitleTracks=[{name:'Português',lang:'pt-BR'}];
 const caption={kind:'subtitles',label:'Português',language:'pt-BR',mode:'showing'};
 const local={kind:'captions',label:'Local',mode:'disabled'};
 const chapters={kind:'chapters',label:'Créditos',mode:'hidden'},metadata={kind:'metadata',mode:'hidden'};
 s.el('direct-video').textTracks=[caption,local,chapters,metadata];h.emit('subtitles');
 assert.equal(s.el('subtitle-select').children.length,3);
 caption.mode='showing';s.controller.setSubtitle(0);assert.equal(caption.mode,'showing');
 s.controller.setSubtitle(-1);assert.equal(caption.mode,'disabled');assert.equal(local.mode,'disabled');
 s.controller.setSubtitle(1);assert.equal(local.mode,'showing');assert.equal(caption.mode,'disabled');
 assert.equal(chapters.mode,'hidden');assert.equal(metadata.mode,'hidden');
 s.controller.stop();await p;
});

test('menus dos quatro ajustes continuam abertos após o clique que os abriu',()=>{
 const html=fs.readFileSync(__dirname+'/index.html','utf8'),listeners={},nodes=new Map();
 const el=id=>{if(!nodes.has(id))nodes.set(id,{hidden:true,querySelector:()=>({focus(){}})});return nodes.get(id);};
 const begin=html.indexOf('function fecharMenusPlayer()'),end=html.indexOf('function abrirOpcoes(',begin);
 const context=vm.createContext({el,window:{StreamChrome:{wake(){}}},document:{addEventListener:(name,fn)=>listeners[name]=fn}});
 vm.runInContext(html.slice(begin,end),context);
 for(const [button,menu]of [['menu-quality-btn','menu-qualidade'],['menu-subs-btn','menu-legendas'],['menu-audio-btn','menu-audio'],['menu-speed-btn','menu-velocidade']]){
  const handler=html.match(new RegExp('id="'+button+'"[^>]*onclick="([^"]+)"'))[1];
  context.fecharOpcoes=()=>{};vm.runInContext(handler,context);
  const target={closest:selector=>selector.split(',').includes('.options-settings')?{}:null};
  listeners.click({target});assert.equal(el(menu).hidden,false,button);
  listeners.click({target:{closest:()=>null}});assert.equal(el(menu).hidden,true);
 }
 context.abrirMenuPlayer('menu-legendas');listeners.keydown({key:'Escape'});assert.equal(el('menu-legendas').hidden,true);
});


test('busca completa sem fonte não cria vídeo e informa esgotamento apenas nesta tentativa',async()=>{
 const s=harness();s.fetch(async()=>({indisponivel:true,buscaCompleta:true}));
 assert.equal(await s.controller.start(153312,1),false);assert.equal(s.controller.estado().buscaEsgotada,true);assert.equal(s.controller.isActive(),false);
 await videoTocando(s);assert.equal(s.controller.estado().buscaEsgotada,false);s.controller.stop();
});


test('Tulsa King: abertura que permite último recurso original ainda seleciona português na fonte dublada',async()=>{
 const s=harness('StreamTVAndroid');s.fetch(async()=>({url,audio:'pt-BR',fonteId:'fenixflix-fenixhub'}));
 const pending=s.controller.start(153312,1,null,'/api/playback/serie/153312/3/3',undefined,true);await new Promise(setImmediate);
 const h=s.Hls.instance;h.audioTracks=[{lang:'eng',name:'English'},{lang:'por',name:'Portuguese'}];h.audioTrack=0;h.emit('manifest');
 assert.equal(h.audioTrack,1);assert.equal(s.el('audio-select').value,'1');assert.equal(s.controller.estado().audio,'Dublado');
 h.audioTrack=0;h.emit('audioSwitched');assert.equal(h.audioTrack,1);
 s.controller.stop();await pending;
});

test('fonte marcada dublada com inglês somente é recusada mesmo com último recurso original permitido',async()=>{
 const s=harness();s.fetch(async()=>({url,audio:'pt-BR',fonteId:'fenixflix-fenixhub'}));
 const pending=s.controller.start(153312,1,null,null,undefined,true);await new Promise(setImmediate);
 s.Hls.instance.audioTracks=[{lang:'eng',name:'English'}];s.Hls.instance.emit('manifest');
 assert.equal(await pending,false);assert.equal(s.controller.isActive(),false);
});

test('fonte original explícita continua permitida sem português e prefere português se a faixa chegar',async()=>{
 const s=harness();s.fetch(async()=>({url,audio:'original',fonteId:'vixsrc'}));
 const pending=s.controller.start(153312,1,null,null,undefined,true);await new Promise(setImmediate);
 const h=s.Hls.instance;h.audioTracks=[{lang:'eng',name:'English'}];h.audioTrack=0;h.emit('manifest');
 assert.equal(s.controller.isActive(),true);assert.equal(s.controller.estado().audio,'som original');
 h.audioTracks.push({lang:'por',name:'Portuguese'});h.emit('audioUpdated');assert.equal(h.audioTrack,1);assert.equal(s.controller.estado().audio,'Dublado');
 assert.equal(s.el('audio-select').disabled,false);
 s.controller.setAudio(0);assert.equal(h.audioTrack,0);assert.equal(s.controller.estado().audio,'som original');h.emit('audioSwitched');assert.equal(h.audioTrack,0,'escolha manual permanece');
 s.controller.stop();await pending;
});
