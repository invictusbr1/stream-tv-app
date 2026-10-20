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
// Só conta com a página visível. Ao voltar do segundo plano, oferece cinco
// segundos completos, sem abrir um episódio inesperadamente.
function createCountdown({show,hide,open,valid,visible=()=>true,schedule=setTimeout,clear=clearTimeout}){
 let active=false,timer=null,remaining=5;
 function stop(){active=false;clear(timer);timer=null;hide();}
 function tick(){timer=null;if(!active)return;if(!valid()){stop();return;}if(!visible())return;
  if(--remaining===0){stop();open();return;}show(remaining);timer=schedule(tick,1000);
 }
 function resume(){clear(timer);timer=null;if(!active)return;if(!valid()){stop();return;}remaining=5;show(remaining);if(visible())timer=schedule(tick,1000);}
 return {start(){if(active)return;active=true;resume();},stop,visibility:resume};
}
if(typeof module!=='undefined'&&module.exports){module.exports={createEpisodeNavigator,seriesTitle,createCountdown};return;}
const navigator=createEpisodeNavigator({request:(url,signal)=>lerJson(url,signal)});
let target=null,upNext=null,controller=null,finished=false,busy=false,sequence=0,dismissed=false;
const button=()=>document.getElementById('next-episode');
const current=()=>target&&typeof filmeAtual!=='undefined'&&filmeAtual===target&&document.getElementById('player')?.classList.contains('ativo');
const countdown=createCountdown({
 valid:()=>Boolean(current()&&finished&&upNext&&!busy&&!dismissed),visible:()=>!document.hidden&&!document.getElementById('direct-video')?.webkitDisplayingFullscreen&&document.fullscreenElement?.tagName!=='VIDEO',
 show:seconds=>{const panel=document.getElementById('episode-countdown');if(!panel)return;panel.hidden=false;const label=document.getElementById('episode-countdown-label');if(label)label.textContent=`Próximo episódio em ${seconds} ${seconds===1?'segundo':'segundos'}`;const detail=document.getElementById('episode-countdown-detail');if(detail&&upNext)detail.textContent=`T${upNext.season} · E${upNext.number}${upNext.name?' · '+upNext.name:''}`;},
 hide:()=>{const panel=document.getElementById('episode-countdown');if(panel)panel.hidden=true;},open:()=>{void go();}
});
document.addEventListener?.('visibilitychange',()=>countdown.visibility());
document.addEventListener?.('fullscreenchange',()=>countdown.visibility());
function cancelAuto(){dismissed=true;countdown.stop();}
function cancel(){countdown.stop();++sequence;controller?.abort();controller=null;target=null;upNext=null;finished=false;busy=false;dismissed=false;const b=button();if(b){b.hidden=true;b.disabled=false;}}
function nextTarget(){const title=seriesTitle(target);return {...target,seriesTitle:title,titulo:`${title} · T${upNext.season} E${upNext.number}`,episode:{...target.episode,season:upNext.season,number:upNext.number}};}
function queueNext(){if(current()&&finished&&upNext){root.StreamPersonal?.queueEpisode?.(nextTarget());if(!dismissed)countdown.start();}}
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
 if(!current()||!upNext||busy)return;countdown.stop();dismissed=true;busy=true;const next=nextTarget(),b=button(),token=sequence;if(b)b.disabled=true;
 try{root.StreamPlayback?.saveProgress?.();await abrirPlayer(next.id,next.titulo,next.episode);}catch{ /* O botão manual continua disponível se a navegação falhar. */ }finally{if(token===sequence){if(b)b.disabled=false;busy=false;}}
}
root.StreamEpisodes={prepare,cancel,go,cancelAuto,visibility:()=>countdown.visibility(),replaying(){if(finished)cancelAuto();},finished(f){if(!finished&&current()&&f&&String(f.id)===String(target.id)&&Number(f.episode?.season)===Number(target.episode.season)&&Number(f.episode?.number)===Number(target.episode.number)){finished=true;queueNext();}}};
})(globalThis);
