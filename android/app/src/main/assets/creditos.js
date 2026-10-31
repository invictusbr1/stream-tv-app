(function(root){
'use strict';
const {mediaKey,timestamp,format}=typeof module!=='undefined'&&module.exports?require('./abertura'):root.StreamIntro;
function creditStart(value,duration){const start=Number(value);return value!==null&&value!==''&&Number.isFinite(start)&&Number.isFinite(duration)&&duration>60&&start>=duration/2&&duration-start>=5&&duration-start<=900?start:null;}
function chapterCredits(tracks,duration){
 const found=[];for(const track of Array.from(tracks||[])){if(track.kind!=='chapters')continue;
  for(const cue of Array.from(track.cues||[])){if(!/^(?:credits|end credits|closing credits|ending credits|créditos(?: finais)?|creditos(?: finais)?|créditos de encerramento)$/i.test(String(cue.text||'').trim()))continue;const start=creditStart(cue.startTime,duration);if(start!==null)found.push(start);}
 }return found.length===1?found[0]:null;
}
function createCredits({storage,render=()=>{},status=()=>{},enter=()=>{},exit=()=>{},visibility=()=>{}}={}){
 let video=null,film=null,source=null,listeners=[],key=null,mark=null,saved={},entered=false,approximate=false;
 function read(){try{const data=JSON.parse(storage?.getItem('conecta-creditos-v1')||'{}');return data&&typeof data==='object'&&!Array.isArray(data)?data:{};}catch{return {};}}
 function refresh(){
  key=video?mediaKey(film,source,video.duration):null;
  const manual=key?creditStart(saved[key],video.duration):null;
  const chapter=key?chapterCredits(video.textTracks,video.duration):null;
  // Aprendido na própria série: quando a pessoa toca em "Próximo" durante os
  // créditos de um episódio, os outros episódios da mesma temporada usam o
  // mesmo tempo antes do fim.
  const restante=key?Number(serie()[serieKey()]):NaN;
  const learned=key&&Number.isFinite(restante)?creditStart(video.duration-restante,video.duration):null;
  const estimated=key&&approximate?creditStart(video.duration-90,video.duration):null;
  mark=key?(manual??chapter??learned??estimated):null;
  const region=mark!==null&&video.currentTime>=mark;
  if(entered&&!region){entered=false;exit(film);}
  if(!entered&&region&&!video.paused&&!video.seeking&&!video.ended){entered=true;enter(film);}
  render({enabled:Boolean(key),mark,manual:manual!==null,approximate,estimated:mark!==null&&manual===null&&chapter===null});
 }
 function serieKey(){return film?`${film.id}:${film.episode?.season}`:'';}
 function serie(){try{const d=JSON.parse(storage?.getItem('conecta-creditos-serie-v1')||'{}');return d&&typeof d==='object'&&!Array.isArray(d)?d:{};}catch{return {};}}
 function learn(){if(!video||!key||!film?.episode)return false;const duration=Number(video.duration),t=Number(video.currentTime);const restante=Math.round(duration-t);if(!Number.isFinite(restante)||t<duration/2||restante<20||restante>600)return false;const d=serie();delete d[serieKey()];d[serieKey()]=restante;try{storage.setItem('conecta-creditos-serie-v1',JSON.stringify(Object.fromEntries(Object.entries(d).slice(-200))));}catch{return false;}return true;}
 function on(obj,event,fn){obj?.addEventListener?.(event,fn);listeners.push([obj,event,fn]);}
 function detach(){if(entered)exit(film);for(const [obj,event,fn]of listeners)obj?.removeEventListener?.(event,fn);listeners=[];video=film=source=key=mark=null;entered=false;render({enabled:false,mark:null,manual:false,approximate,estimated:false});}
 function save(value){refresh();const start=creditStart(timestamp(value),video?.duration);if(!key||start===null){status('Marque o início dos créditos na segunda metade deste episódio, até 15 minutos antes do fim.');return false;}
  const data={...saved};delete data[key];data[key]=start;try{storage.setItem('conecta-creditos-v1',JSON.stringify(Object.fromEntries(Object.entries(data).slice(-200))));}catch{status('Não foi possível salvar neste aparelho.');return false;}
  saved=data;status('Créditos salvos para este episódio e esta versão do vídeo.');refresh();return true;
 }
 return {attach(v,f,s){detach();if(!v||!f?.episode||s?.live)return;video=v;film=f;source=s;saved=read();try{approximate=storage?.getItem('conecta-creditos-antecipacao')==='90';}catch{approximate=false;}status('');
  for(const event of ['loadedmetadata','durationchange','timeupdate','seeking','seeked','ended'])on(v,event,refresh);
  for(const event of ['pause','playing'])on(v,event,()=>{refresh();visibility();});
  const chapters=()=>{for(const track of Array.from(v.textTracks||[]))if(track.kind==='chapters'&&track.mode==='disabled')track.mode='hidden';refresh();};on(v.textTracks,'addtrack',chapters);on(v.textTracks,'change',refresh);chapters();
 },detach,refresh,save,learn,setApproximate(enabled){try{storage.setItem('conecta-creditos-antecipacao',enabled?'90':'0');}catch{status('Não foi possível salvar a preferência.');return false;}approximate=Boolean(enabled);status(enabled?'Sem marcação, a contagem começa 90 segundos antes do fim. Esse ponto é aproximado e pode incluir cenas.':'Sem marcação, a contagem aguarda o fim do vídeo.');refresh();return true;},remove(){if(!key)return;const data={...saved};delete data[key];try{storage.setItem('conecta-creditos-v1',JSON.stringify(data));}catch{status('Não foi possível remover.');return;}saved=data;status('Marcação removida.');refresh();},position:()=>video?.currentTime||0};
}
if(typeof module!=='undefined'&&module.exports){module.exports={createCredits,creditStart,chapterCredits};return;}
const el=id=>document.getElementById(id);let previous=null,store;try{store=root.localStorage;}catch{}
const credits=createCredits({storage:store,enter:f=>root.StreamEpisodes?.credits?.(f),exit:f=>root.StreamEpisodes?.leaveCredits?.(f),visibility:()=>root.StreamEpisodes?.visibility?.(),status:text=>{if(el('credits-note'))el('credits-note').textContent=text;},render:state=>{
 if(el('credits-settings'))el('credits-settings').hidden=!state.enabled;
 if(el('credits-fallback'))el('credits-fallback').value=state.approximate?'90':'0';
 if(el('credits-estimate'))el('credits-estimate').hidden=!state.estimated;
 const signature=JSON.stringify(state.mark);if(signature!==previous){previous=signature;if(el('credits-start'))el('credits-start').value=state.mark===null?'':format(state.mark);}
}});
root.StreamCredits={...credits,save(){return credits.save(el('credits-start').value);},here(){el('credits-start').value=format(credits.position());return credits.save(el('credits-start').value);}};
})(globalThis);
