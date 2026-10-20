'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createCredits,creditStart,chapterCredits}=require('./creditos');
const film={id:1399,episode:{season:1,number:2}},source={url:'https://cdn.example/episode.mp4?token=secret',fonteId:'sample'};
function setup(){
 const saved={'conecta-creditos-v1':'{}'};let view,note,entered=0,left=0;const events=new Map();
 const video={duration:2400,currentTime:0,paused:false,seeking:false,ended:false,textTracks:[],addEventListener(e,f){if(!events.has(e))events.set(e,new Set());events.get(e).add(f);},removeEventListener(e,f){events.get(e)?.delete(f);if(!events.get(e)?.size)events.delete(e);}};
 const storage={getItem:k=>saved[k],setItem:(k,v)=>saved[k]=v};
 const credits=createCredits({storage,render:s=>view=s,status:s=>note=s,enter:()=>entered++,exit:()=>left++});credits.attach(video,film,source);
 return {credits,video,events,storage,fire:e=>{for(const f of events.get(e)||[])f();},view:()=>view,note:()=>note,raw:()=>saved['conecta-creditos-v1'],entered:()=>entered,left:()=>left};
}
test('antecipação aproximada exige escolha explícita e perde prioridade para marcação real',()=>{
 const s=setup();assert.equal(s.view().mark,null);assert.equal(s.credits.setApproximate(true),true);assert.equal(s.view().mark,2310);assert.equal(s.view().estimated,true);
 s.video.currentTime=2310;s.fire('timeupdate');assert.equal(s.entered(),1);
 s.video.textTracks=[{kind:'chapters',cues:[{text:'End credits',startTime:2350}]}];s.credits.refresh();assert.equal(s.view().mark,2350);assert.equal(s.view().estimated,false);assert.equal(s.left(),1);
 s.credits.save('38:00');assert.equal(s.view().mark,2280);assert.equal(s.view().manual,true);
 s.credits.attach(s.video,film,source);assert.equal(s.view().approximate,true);assert.equal(s.view().mark,2280);s.credits.setApproximate(false);assert.equal(s.view().mark,2280);
});
test('créditos acionam o próximo no ponto marcado, antes do fim real e uma única vez',()=>{
 const s=setup();s.video.textTracks=[{kind:'chapters',mode:'hidden',cues:[{text:'Créditos finais',startTime:2250,endTime:2400}]}];
 s.video.currentTime=2249;s.fire('timeupdate');assert.equal(s.entered(),0);
 s.video.currentTime=2250;s.fire('timeupdate');assert.equal(s.entered(),1);assert.equal(s.video.ended,false);
 s.video.currentTime=2300;s.fire('timeupdate');assert.equal(s.entered(),1);
 s.video.ended=true;s.fire('ended');assert.equal(s.left(),0); // O evento ended não interrompe a contagem ativa.
 s.credits.detach();assert.equal(s.left(),1);assert.equal(s.events.size,0);
});
test('sem marca não adivinha créditos, não confunde legendas/abertura e rejeita capítulos ambíguos',()=>{
 const s=setup();s.video.currentTime=2390;s.fire('timeupdate');assert.equal(s.entered(),0);
 for(const text of ['Opening credits','Chapter 12','Ending','ED'])assert.equal(chapterCredits([{kind:'chapters',cues:[{text,startTime:2280}]}],2400),null);
 const tracks=[{kind:'chapters',cues:[{text:'End credits',startTime:2280}]}];assert.equal(chapterCredits(tracks,2400),2280);
 assert.equal(chapterCredits([...tracks,...tracks],2400),null);assert.equal(chapterCredits([{...tracks[0],kind:'subtitles'}],2400),null);
});
test('marcação manual não atravessa fonte, episódio, edição ou duração nem guarda endereço/token',()=>{
 const s=setup();assert.equal(s.credits.save('38:00'),true);assert.equal(s.view().mark,2280);assert(!s.raw().includes('secret'));assert(!s.raw().includes('https'));
 for(const [f,p,d]of [[{...film,episode:{season:1,number:3}},source,2400],[film,{...source,fonteId:'other'},2400],[film,{...source,url:'https://cdn.example/other.mp4'},2400],[film,source,2410]]){
  s.video.duration=d;s.credits.attach(s.video,f,p);assert.equal(s.view().mark,null);
 }
 s.video.duration=2400;s.credits.attach(s.video,film,{...source,url:source.url.replace('secret','renewed')});assert.equal(s.view().mark,2280);
 s.credits.remove();assert.equal(s.view().mark,null);
});
test('pausa, busca para trás e troca de vídeo preservam controle do usuário',()=>{
 const s=setup();s.credits.save('38:00');s.video.currentTime=2290;s.video.paused=true;s.fire('timeupdate');assert.equal(s.entered(),0);
 s.video.paused=false;s.video.seeking=true;s.fire('timeupdate');assert.equal(s.entered(),0);
 s.video.seeking=false;s.fire('seeked');assert.equal(s.entered(),1);
 s.video.currentTime=2100;s.fire('timeupdate');assert.equal(s.left(),1);
 s.credits.attach(s.video,{id:film.id},source);assert.equal(s.view().enabled,false);
 s.credits.attach(s.video,film,{...source,live:true});assert.equal(s.view().enabled,false);
});
test('tempos fora do episódio e falha de armazenamento não são apresentados como salvos',()=>{
 for(const value of [null,'',NaN,-1,300,2399,Infinity])assert.equal(creditStart(value,2400),null);
 const s=setup();assert.equal(s.credits.save('1:00'),false);assert.equal(s.view().mark,null);
 s.storage.setItem=()=>{throw Error();};assert.equal(s.credits.save('38:00'),false);assert.match(s.note(),/Não foi possível/);assert.equal(s.view().mark,null);
});
