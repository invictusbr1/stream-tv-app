const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {parseWatchPlay}=require('./playback-source');
const url='https://vid123.hclod.qzz.io/st/movie/playlist.m3u8?expires=123&md5=test';
const html=(audio='Dublado',source=url)=>`window.MyPlayerAudio=${JSON.stringify(audio)};createMyPlayer({url:${JSON.stringify(source)}})`;
test('reads escaped public HLS configuration without executing scripts',()=>{const r=parseWatchPlay(html().replaceAll('/','\\/'));assert.equal(r.audio,'pt-BR');assert.equal(r.url,url);});
test('rejects non-dubbed, malformed, and unexpected media hosts',()=>{assert.throws(()=>parseWatchPlay(html('Legendado')));assert.throws(()=>parseWatchPlay('window.MyPlayerAudio="Dublado";url:evil()'));for(const u of ['http://vid123.hclod.qzz.io/a.m3u8','https://localhost/a.m3u8','https://vid123.hclod.qzz.io.evil.test/a.m3u8','https://user:pass@vid123.hclod.qzz.io/a.m3u8'])assert.throws(()=>parseWatchPlay(html('Dublado',u)));});
function harness(userAgent='Test'){
 const nodes=new Map(),timers=new Map();let sequence=0,fetchImpl=async()=>({url,audio:'pt-BR'}),failures=0;
 const handlers={};const doc={activeElement:null,addEventListener(name,fn){handlers[name]=fn;},querySelector(){return {prepend(n){nodes.set(n.id,n);}};}};
 function node(){const events={};return {hidden:false,contains(n){return this.children.includes(n);},querySelectorAll(){return this.children;},closest(){return null;},style:{},children:[],classList:{add(){},remove(){},toggle(){}},pause(){},load(){},play(){return Promise.resolve();},remove(){nodes.delete(this.id);},removeAttribute(){},setAttribute(){},before(n){nodes.set(n.id,n);},append(n){this.children.push(n);},replaceChildren(){this.children=[];},focus(){doc.activeElement=this;},canPlayType(){return '';},addEventListener(name,cb){events[name]=cb;},fire(name){events[name]?.();}};}
 const el=id=>{if(!nodes.has(id)){const n=node();n.id=id;nodes.set(id,n);}return nodes.get(id);};doc.createElement=node;doc.createTextNode=text=>({textContent:text});
 class Hls {static Events={MANIFEST_PARSED:'manifest',ERROR:'error',LEVEL_SWITCHED:'level',AUDIO_TRACKS_UPDATED:'audioUpdated',AUDIO_TRACK_SWITCHED:'audioSwitched',SUBTITLE_TRACKS_UPDATED:'subtitles'};static isSupported(){return true;}constructor(){this.listeners={};this.levels=[{height:720,bitrate:200},{height:1080,bitrate:400},{height:480,bitrate:100}];this.audioTracks=[{lang:'pt-BR',name:'Dublado'}];Hls.instance=this;}on(n,fn){this.listeners[n]=fn;}emit(n,data={}){this.listeners[n]?.(n,data);}recoverMediaError(){this.recovered=(this.recovered||0)+1;}loadSource(){}attachMedia(){}destroy(){this.destroyed=true;}}
 const window={Hls};const context=vm.createContext({window,Hls,document:doc,navigator:{userAgent},el,playerVersion:1,lerJson:(...a)=>fetchImpl(...a),mostrarErro(){failures++;},setTimeout(fn){const id=++sequence;timers.set(id,fn);return id;},clearTimeout(id){timers.delete(id);}});
 vm.runInContext(fs.readFileSync(__dirname+'/playback.js','utf8'),context);
 context.StreamPlayback=window.StreamPlayback;el('opcoes').hidden=true;el('direct-controls').children=[el('direct-back'),el('direct-toggle'),el('direct-forward')];
 return {context,window,doc,key(key){let prevented=false;handlers.keydown({key,preventDefault(){prevented=true;},stopPropagation(){}});return prevented;},controller:window.StreamPlayback,el,Hls,timers,failures:()=>failures,fetch(fn){fetchImpl=fn;}};
}
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
 const pending=s.controller.start(238,1,new AbortController().signal);await new Promise(setImmediate);const v=s.el('direct-video');v.duration=1000;v.currentTime=0;v.fire('loadedmetadata');assert.equal(v.currentTime,240);v.currentTime=260;s.controller.stop();await pending;assert.equal(saved.p,260);assert.equal(saved.f.id,238);
});
test('Android fullscreen button requests landscape and exit restores native mode',async()=>{
 const s=harness('StreamTVAndroid');s.context.location={};let expanded=false;s.el('player').classList={contains:()=>expanded,toggle:(name,value)=>expanded=value};
 await s.context.telaCheia();assert.equal(expanded,true);assert.equal(s.context.location.href,'/player-fullscreen?enabled=1');await s.context.telaCheia();assert.equal(expanded,false);assert.equal(s.context.location.href,'/player-fullscreen?enabled=0');
 await s.context.telaCheia();s.window.StreamExitFullscreen();assert.equal(s.context.location.href,'/player-fullscreen?enabled=0');
});
test('iPhone fullscreen uses the native video presentation instead of Android navigation',async()=>{
 const s=harness('iPhone');let entered=0;s.el('direct-video').webkitEnterFullscreen=()=>entered++;await s.context.telaCheia();assert.equal(entered,1);
});
test('pause saves the exact latest position instead of waiting for another timer',async()=>{const s=harness();let saved;s.context.filmeAtual={id:238,titulo:'Filme'};s.window.StreamPersonal={position:()=>0,record:(f,p)=>saved=p};const p=s.controller.start(238,1,new AbortController().signal);await new Promise(setImmediate);const v=s.el('direct-video');v.duration=1000;v.currentTime=0;v.fire('loadedmetadata');v.currentTime=127.5;v.fire('pause');assert.equal(saved,127.5);s.controller.stop();await p;});
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
