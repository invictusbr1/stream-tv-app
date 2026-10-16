(function(root){
'use strict';
const seriesTitle=f=>String(f?.seriesTitle||f?.titulo||'').replace(/\s*·\s*T\d+\s*E\d+\s*$/i,'').trim();
function createEpisodeNavigator({request,today=()=>new Date().toISOString().slice(0,10)}){
 const cache=new Map();
 async function get(url,signal){
  if(signal?.aborted)throw new Error('Consulta cancelada');
  const saved=cache.get(url);if(saved&&saved.expires>Date.now())return saved.data;
  const data=await request(url,signal);if(signal?.aborted)throw new Error('Consulta cancelada');
  if(cache.size>=40)cache.delete(cache.keys().next().value);cache.set(url,{data,expires:Date.now()+300000});return data;
 }
 const ordered=items=>(items||[]).filter(e=>Number.isInteger(Number(e.number))&&Number(e.number)>0).slice().sort((a,b)=>Number(a.number)-Number(b.number));
 const available=e=>!e.date||e.date<=today();
 async function next(f,signal){
  if(!/^\d{1,10}$/.test(String(f?.id))||!f.episode||!Number.isInteger(Number(f.episode.season))||Number(f.episode.season)<0||!Number.isInteger(Number(f.episode.number))||Number(f.episode.number)<1)return null;
  const season=Number(f.episode.season),number=Number(f.episode.number);
  const current=await get(`/api/season/${f.id}/${season}`,signal);
  const later=ordered(current.episodes).find(e=>Number(e.number)>number);
  if(later)return available(later)?{season,number:Number(later.number),name:later.name||''}:null;
  const show=await get(`/api/tv/${f.id}`,signal);
  for(const s of ordered(show.seasons).filter(s=>Number(s.number)>season).slice(0,10)){
   if(!available(s))return null;
   const data=await get(`/api/season/${f.id}/${s.number}`,signal),first=ordered(data.episodes)[0];
   if(first)return available(first)?{season:Number(s.number),number:Number(first.number),name:first.name||''}:null;
  }
  return null;
 }
 return {next};
}
if(typeof module!=='undefined'&&module.exports){module.exports={createEpisodeNavigator,seriesTitle};return;}
const navigator=createEpisodeNavigator({request:(url,signal)=>lerJson(url,signal)});
let target=null,upNext=null,controller=null,finished=false,busy=false,sequence=0;
const button=()=>document.getElementById('next-episode');
const current=()=>target&&typeof filmeAtual!=='undefined'&&filmeAtual===target&&document.getElementById('player')?.classList.contains('ativo');
function cancel(){++sequence;controller?.abort();controller=null;target=null;upNext=null;finished=false;busy=false;const b=button();if(b){b.hidden=true;b.disabled=false;}}
function nextTarget(){const title=seriesTitle(target);return {...target,seriesTitle:title,titulo:`${title} · T${upNext.season} E${upNext.number}`,episode:{...target.episode,season:upNext.season,number:upNext.number}};}
function queueNext(){if(current()&&finished&&upNext)root.StreamPersonal?.queueEpisode?.(nextTarget());}
async function prepare(f){
 cancel();if(!f?.episode)return;target=f;controller=new AbortController();const query=controller,token=sequence,signal=query.signal;
 const timeout=setTimeout(()=>query.abort(),15000);
 try{
  const next=await navigator.next(f,signal);if(token!==sequence||!current()||signal.aborted)return;
  upNext=next;const b=button();if(b){b.hidden=!next;b.title=next?`Próximo episódio · T${next.season} E${next.number}`:'';}
  queueNext();
 }catch{ /* O episódio atual continua tocando se o catálogo não responder. */ }
 finally{clearTimeout(timeout);}
}
async function go(){
 if(!current()||!upNext||busy)return;busy=true;const next=nextTarget(),b=button();if(b)b.disabled=true;
 try{root.StreamPlayback?.saveProgress?.();await abrirPlayer(next.id,next.titulo,next.episode);}finally{if(b)b.disabled=false;busy=false;}
}
root.StreamEpisodes={prepare,cancel,go,finished(f){if(current()&&(!f||String(f.id)===String(target.id)&&Number(f.episode?.season)===Number(target.episode.season)&&Number(f.episode?.number)===Number(target.episode.number))){finished=true;queueNext();}}};
})(globalThis);
