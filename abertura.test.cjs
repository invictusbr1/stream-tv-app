const {test}=require('node:test'),assert=require('node:assert/strict');
const {createIntro,range,timestamp,chapterRange,mediaKey}=require('./abertura');
const film={id:1399,episode:{season:1,number:2}},source={url:'https://cdn.example/episode.mp4?token=first',fonteId:'sample'};
function setup(){let raw='{}',view,note;const events=new Map();const video={duration:1800,currentTime:0,ended:false,textTracks:[],addEventListener:(e,f)=>events.set(e,f),removeEventListener:e=>events.delete(e)};const storage={getItem:()=>raw,setItem:(_,v)=>{raw=v;}};const intro=createIntro({storage,render:s=>{view=s;},status:s=>{note=s;}});intro.attach(video,film,source);return {intro,video,events,view:()=>view,note:()=>note,raw:()=>raw};}
test('abertura não adivinha primeiros segundos nem aparece para filme ou duração desconhecida',()=>{
 const s=setup();assert.equal(s.view().show,false);assert.equal(s.intro.skip(),false);s.intro.attach(s.video,{id:1399},source);assert.equal(s.view().enabled,false);
 assert.equal(range({start:1,end:90},NaN),null);assert.equal(range({start:90,end:1},1800),null);assert.equal(range({start:0,end:1800},1800),null);
});
test('marcação aparece só dentro da abertura e pula exatamente para seu fim',()=>{
 const s=setup();assert.equal(s.intro.save('0:30','1:45'),true);assert.equal(s.view().show,false);
 s.video.currentTime=30;s.events.get('timeupdate')();assert.equal(s.view().show,true);assert.equal(s.intro.skip(),true);assert.equal(s.video.currentTime,105);assert.equal(s.view().show,false);
 s.video.currentTime=200;assert.equal(s.intro.skip(),false);assert.equal(s.video.currentTime,200);
 s.video.currentTime=50;s.intro.refresh();assert.equal(s.view().show,true);s.intro.detach();assert.equal(s.events.size,0);assert.equal(s.view().show,false);
});
test('marcação não atravessa episódio, fonte, edição ou duração e não armazena token',()=>{
 const s=setup();s.intro.save('0:00','1:30');assert(!s.raw().includes('first'));assert(!s.raw().includes('https'));
 assert.equal(mediaKey(film,source,1800),mediaKey(film,{...source,url:source.url.replace('first','new')},1800));
 for(const [f,p,d]of [[{...film,episode:{season:1,number:3}},source,1800],[film,{...source,fonteId:'other'},1800],[film,{...source,url:'https://cdn.example/different.mp4'},1800],[film,source,1805]]){
  s.video.duration=d;s.intro.attach(s.video,f,p);assert.equal(s.view().mark,null);
 }
 s.video.duration=1800;s.intro.attach(s.video,film,source);assert.equal(s.view().mark.end,90);s.intro.remove();assert.equal(s.view().mark,null);
});
test('capítulo explicitamente identificado é aceito; título genérico e capítulos ambíguos não',()=>{
 const tracks=[{kind:'chapters',cues:[{text:'Abertura',startTime:10,endTime:80}]}];assert.deepEqual(chapterRange(tracks,1800),{start:10,end:80});
 assert.equal(chapterRange([{kind:'subtitles',cues:tracks[0].cues}],1800),null);assert.equal(chapterRange([{kind:'chapters',cues:[{text:'Chapter 1',startTime:0,endTime:100}]}],1800),null);
 assert.equal(chapterRange([...tracks,...tracks],1800),null);const s=setup();s.video.textTracks=tracks;s.intro.refresh();s.video.currentTime=20;s.intro.refresh();assert.equal(s.view().show,true);
});
test('tempos inválidos e falha de armazenamento não são apresentados como salvos',()=>{
 assert.equal(timestamp('1:10'),70);assert.equal(timestamp('1:60'),NaN);assert.equal(timestamp('texto'),NaN);
 const s=setup();assert.equal(s.intro.save('2:00','1:00'),false);assert.equal(s.view().mark,null);
 const broken=createIntro({storage:{getItem(){throw Error();},setItem(){throw Error();}}});broken.attach(s.video,film,source);assert.equal(broken.save('0:01','1:00'),false);
});
