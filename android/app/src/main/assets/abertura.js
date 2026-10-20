(function(root){
'use strict';
function range(value,duration){
 const start=Number(value?.start),end=Number(value?.end);
 return Number.isFinite(start)&&Number.isFinite(end)&&Number.isFinite(duration)&&start>=0&&end-start>=1&&end-start<=600&&end<duration&&start<duration/2?{start,end}:null;
}
function timestamp(value){const parts=String(value).trim().split(':');if(parts.length>3||!parts.length||parts.some(p=>!/^\d{1,4}$/.test(p)))return NaN;if(parts.length>1&&parts.slice(1).some(p=>Number(p)>=60))return NaN;return parts.reduce((n,p)=>n*60+Number(p),0);}
function format(n){n=Math.max(0,Math.floor(Number(n)||0));return `${Math.floor(n/60)}:${String(n%60).padStart(2,'0')}`;}
function mediaKey(film,source,duration){
 if(!film?.episode||!film.id||!source?.url||!Number.isFinite(duration)||duration<=0)return null;
 let media;try{let u=new URL(source.url,'https://app.invalid');const nested=u.searchParams.get('u');if(nested&&/^https:\/\//.test(nested))u=new URL(nested);media=u.origin+u.pathname;}catch{return null;}
 // A chave não guarda endereço assinado, query, nome de usuário ou credenciais.
 let a=2166136261,b=5381;for(const c of media){a=Math.imul(a^c.charCodeAt(0),16777619);b=Math.imul(b,33)^c.charCodeAt(0);}
 return [film.id,film.episode.season,film.episode.number,film.episode.audio||'',source.fonteId||'',Math.round(duration),a>>>0,b>>>0].join(':');
}
function chapterRange(tracks,duration){
 const found=[];for(const track of Array.from(tracks||[])){if(track.kind!=='chapters')continue;
  for(const cue of Array.from(track.cues||[])){if(!/^(?:intro|opening|abertura|opening credits|créditos iniciais)$/i.test(String(cue.text||'').trim()))continue;const r=range({start:cue.startTime,end:cue.endTime},duration);if(r)found.push(r);}
 }
 return found.length===1?found[0]:null;
}
function createIntro({storage,render=()=>{},status=()=>{}}={}){
 let video=null,film=null,source=null,listeners=[],mark=null,key=null,saved={};
 function read(){try{const s=JSON.parse(storage?.getItem('conecta-intros-v1')||'{}');return s&&typeof s==='object'&&!Array.isArray(s)?s:{};}catch{return {};}}
 function refresh(){
  key=video?mediaKey(film,source,video.duration):null;
  mark=key?range(saved[key],video.duration)||chapterRange(video.textTracks,video.duration):null;
  render({enabled:Boolean(key),mark,show:Boolean(mark&&!video.ended&&video.currentTime>=mark.start&&video.currentTime<mark.end)});
 }
 function detach(){for(const [obj,event,fn]of listeners)obj?.removeEventListener?.(event,fn);listeners=[];video=film=source=mark=key=null;render({enabled:false,mark:null,show:false});}
 function on(obj,event,fn){obj?.addEventListener?.(event,fn);listeners.push([obj,event,fn]);}
 return {attach(v,f,s){detach();if(!v||!f?.episode||s?.live)return;video=v;film=f;source=s;saved=read();status('');
  for(const event of ['loadedmetadata','durationchange','timeupdate','seeking','ended'])on(v,event,refresh);
  const chapters=()=>{for(const track of Array.from(v.textTracks||[]))if(track.kind==='chapters'&&track.mode==='disabled')track.mode='hidden';refresh();};on(v.textTracks,'addtrack',chapters);on(v.textTracks,'change',refresh);chapters();
 },detach,refresh,save(start,end){refresh();const r=range({start:timestamp(start),end:timestamp(end)},video?.duration);if(!key||!r){status('Confira os tempos: o fim deve vir depois do início, dentro deste episódio (até 10 minutos de abertura).');return false;}
  const data={...saved};delete data[key];data[key]=r;const entries=Object.entries(data).slice(-200);try{storage.setItem('conecta-intros-v1',JSON.stringify(Object.fromEntries(entries)));}catch{status('Não foi possível salvar a marcação neste aparelho.');return false;}saved=data;status('Abertura salva apenas para este episódio e esta versão do vídeo.');refresh();return true;
 },remove(){if(!key)return;const data={...saved};delete data[key];try{storage.setItem('conecta-intros-v1',JSON.stringify(data));}catch{status('Não foi possível remover.');return;}saved=data;status('Marcação removida.');refresh();},skip(){refresh();if(!mark||!video||video.currentTime<mark.start||video.currentTime>=mark.end)return false;try{video.currentTime=mark.end;refresh();return true;}catch{return false;}},position(){return video?.currentTime||0;}};
}
if(typeof module!=='undefined'&&module.exports){module.exports={createIntro,range,timestamp,chapterRange,mediaKey};return;}
const el=id=>document.getElementById(id);let previous=null;let store;try{store=root.localStorage;}catch{}
const intro=createIntro({storage:store,status:text=>{el('intro-note').textContent=text;},render:state=>{
 if(el('skip-intro'))el('skip-intro').hidden=!state.show;if(el('intro-settings'))el('intro-settings').hidden=!state.enabled;
 const signature=JSON.stringify(state.mark);if(signature!==previous){previous=signature;if(el('intro-start'))el('intro-start').value=state.mark?format(state.mark.start):'';if(el('intro-end'))el('intro-end').value=state.mark?format(state.mark.end):'';}
}});
root.StreamIntro={...intro,save(){return intro.save(el('intro-start').value,el('intro-end').value);},here(which){el(which==='start'?'intro-start':'intro-end').value=format(intro.position());}};
})(globalThis);
