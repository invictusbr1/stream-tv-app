(function(root){
'use strict';
function createPersonal(storage){
 const read=k=>{try{const v=JSON.parse(storage.getItem(k)||'[]');return Array.isArray(v)?v:[];}catch{return [];}};
 const write=(k,v)=>{try{storage.setItem(k,JSON.stringify(v));}catch{}};
 const searches=()=>read('streamtv-searches').filter(x=>typeof x==='string').slice(0,100);
 const progress=()=>read('streamtv-progress').filter(x=>x&&/^\d{1,10}$/.test(String(x.id))&&typeof x.titulo==='string').slice(0,100);
 const group=f=>`${f.episode?'tv':'movie'}:${f.id}`;
 const history=()=>{const seen=new Set();return progress().map((f,i)=>({f,i})).sort((a,b)=>(Number(b.f.updated)||0)-(Number(a.f.updated)||0)||a.i-b.i).filter(({f})=>{const k=group(f);if(seen.has(k))return false;seen.add(k);return !f.completed;}).map(({f})=>({...f,capa:f.capa||progress().find(other=>group(other)===group(f)&&other.capa)?.capa||''}));};
 const favorites=()=>read('streamtv-favoritos').filter(x=>x&&/^\d{1,10}$/.test(String(x.id))&&typeof x.titulo==='string').slice(0,300);
 const watched=()=>read('streamtv-assistidos').filter(x=>x&&/^\d{1,10}$/.test(String(x.id))&&typeof x.chave==='string').slice(0,800);
 const key=f=>`${f.id}:${f.episode?f.episode.season+':'+f.episode.number:'movie'}`;
 return {searches,history,favorites,watched,key,
 isFavorite(id){const alvo=String(id);return favorites().some(f=>String(f.id)===alvo);},
 toggleFavorite(f){if(!f||!/^\d{1,10}$/.test(String(f.id)))return false;const atual=favorites();const alvo=String(f.id);if(atual.some(x=>String(x.id)===alvo)){write('streamtv-favoritos',atual.filter(x=>String(x.id)!==alvo));return false;}
 write('streamtv-favoritos',[{id:alvo,titulo:String(f.titulo||'').slice(0,200),capa:String(f.capa||''),fundo:String(f.fundo||''),tipo:String(f.tipo||''),ano:String(f.ano||''),nota:f.nota??null,sinopse:String(f.sinopse||'').slice(0,600),quando:Date.now()},...atual].slice(0,300));return true;},
 isWatched(f){if(!f||!f.episode)return false;const k=key(f);return watched().some(x=>x.chave===k);},
 markWatched(f,assistido=true){if(!f||!f.episode||!/^\d{1,10}$/.test(String(f.id)))return;const k=key(f);const atual=watched();
 write('streamtv-assistidos',assistido?[{id:String(f.id),titulo:String(f.titulo||'').slice(0,200),episode:f.episode,chave:k,quando:Date.now()},...atual.filter(x=>x.chave!==k)].slice(0,800):atual.filter(x=>x.chave!==k));},
 search(q){q=String(q).trim().slice(0,200);if(q)write('streamtv-searches',[q,...searches().filter(x=>x.toLocaleLowerCase()!==q.toLocaleLowerCase())].slice(0,100));},
 removeSearch(q){write('streamtv-searches',searches().filter(x=>x!==q));},clearSearch(){write('streamtv-searches',[]);},
 remove(f){write('streamtv-progress',progress().filter(x=>group(x)!==group(f)));},
 repairCover(f,capa){if(!/^https:\/\/image\.tmdb\.org\/t\/p\//.test(String(capa)))return;write('streamtv-progress',progress().map(x=>group(x)===group(f)?{...x,capa}:x));},
 position(f){const v=progress().find(x=>key(x)===key(f));return !v?.completed&&Number.isFinite(v?.position)?v.position:0;},
 queueEpisode(f){if(!f?.episode||!/^\d{1,10}$/.test(String(f.id)))return;const previous=progress(),old=previous.find(x=>key(x)===key(f));write('streamtv-progress',[{...old,...f,capa:f.capa||old?.capa||'',position:old&&!old.completed?old.position??0:0,duration:old?.duration||null,completed:false,pending:true,updated:Date.now()},...previous.filter(x=>key(x)!==key(f))].slice(0,100));},
 save(f,position,duration,manual=false){if(!f||!/^\d{1,10}$/.test(String(f.id)))return;if(position!==null&&(!Number.isFinite(position)||position<1||(!manual&&(!Number.isFinite(duration)||duration<=0))))return;
 const previous=progress(),old=previous.find(x=>key(x)===key(f));
 const completed=position!==null&&Number.isFinite(duration)&&duration>0&&position>=duration-30;
 if(completed){this.markWatched?.(f,true);if(!f.episode){this.remove(f);return;}if(old?.completed)return;}
 write('streamtv-progress',[{...old,...f,capa:f.capa||old?.capa||'',position:position===null?(old?.position??null):position,duration:duration||old?.duration||null,completed,pending:position===null?Boolean(old?.pending):false,manual:position===null?Boolean(old?.manual):manual,updated:Date.now()},...previous.filter(x=>key(x)!==key(f))].slice(0,100));}
 };
}
if(typeof module!=='undefined'&&module.exports){module.exports={createPersonal};return;}
root.createStreamPersonal=createPersonal;if(!document.getElementById('q'))return;
let storage;try{storage=localStorage;}catch{storage={getItem(){},setItem(){}};}
const data=createPersonal(storage),metadata=new Map();
const node=id=>document.getElementById(id);
function button(text,action){const b=document.createElement('button');b.className='quiet';b.textContent=text;b.onclick=action;return b;}
function renderSearch(){const list=node('search-history-items');if(!list)return;list.replaceChildren();for(const q of data.searches()){const row=document.createElement('div');row.className='history-item';row.append(button(q,()=>{node('q').value=q;root.StreamLibrary.search();}),button('Excluir',()=>{data.removeSearch(q);renderSearch();}));row.lastChild.setAttribute('aria-label','Excluir busca '+q);list.append(row);}if(!list.children.length)list.textContent='Nenhuma busca salva neste aparelho.';}
const coverRequests=new Map();
function recoverCover(f,placeholder){
 if(typeof androidCatalog==='undefined')return;
 const key=(f.episode?'tv:':'movie:')+f.id;
 if(!coverRequests.has(key))coverRequests.set(key,Promise.resolve(androidCatalog).then(c=>c.describe(f.id,Boolean(f.episode),globalThis.AbortSignal?.timeout?.(8000))).then(info=>info.capa||'').catch(()=>''));
 coverRequests.get(key).then(capa=>{if(!capa||!/^https:\/\/image\.tmdb\.org\/t\/p\//.test(capa))return;data.repairCover(f,capa);if(!placeholder.isConnected)return;const img=document.createElement('img');img.className='continue-cover';img.src=capa;img.alt='';img.loading='lazy';img.onerror=()=>img.replaceWith(placeholder);placeholder.replaceWith(img);});
}
function formatPosition(seconds){const n=Math.max(0,Math.floor(Number(seconds)||0)),h=Math.floor(n/3600),m=Math.floor(n/60)%60,s=String(n%60).padStart(2,'0');return h?h+':'+String(m).padStart(2,'0')+':'+s:m+':'+s;}
function renderContinue(){const section=node('continue-section'),list=node('continue-items');if(!list)return;list.replaceChildren();const entries=data.history();section.hidden=!entries.length;if(node('continuar-vazio'))node('continuar-vazio').hidden=Boolean(entries.length);for(const f of entries){const wrapper=document.createElement('div');wrapper.className='continue-item';const card=document.createElement('button');card.className='card';const fallback=document.createElement('span');fallback.className='continue-cover continue-placeholder';fallback.setAttribute('aria-hidden','true');fallback.textContent='▶';const cover=f.capa||metadata.get(String(f.id))?.capa||data.favorites().find(x=>String(x.id)===String(f.id))?.capa;if(cover){const img=document.createElement('img');img.className='continue-cover';img.src=cover;img.alt='';img.loading='lazy';img.onerror=()=>{img.replaceWith(fallback);recoverCover(f,fallback);};card.append(img);}else{card.append(fallback);recoverCover(f,fallback);}const title=document.createElement('div');title.className='card-titulo';title.textContent=f.episode?String(f.seriesTitle||f.titulo).replace(/\s*·\s*T\d+\s*E\d+\s*$/i,''):f.titulo;const info=document.createElement('div');info.className='card-meta';const point=f.position===null?'Posição indisponível':f.pending&&!f.position?'Próximo episódio':`${f.manual?'Ponto anotado':'Continuar em'} ${formatPosition(f.position)}`;info.textContent=[f.episode?`T${f.episode.season} · E${f.episode.number}`:'',point].filter(Boolean).join(' · ');card.append(title,info);if(f.duration>0&&f.position>0){const bar=document.createElement('progress');bar.className='continue-progress';bar.max=100;bar.value=Math.min(100,f.position/f.duration*100);bar.setAttribute('aria-label','Progresso assistido');card.append(bar);}card.onclick=()=>abrirPlayer(f.id,f.titulo,f.episode||null);wrapper.append(card,button('Remover',()=>{data.remove(f);renderContinue();}));list.append(wrapper);}}
const bookmark=document.createElement('section');bookmark.innerHTML='<div class="options-label">Salvar onde parou</div><label for="bookmark-time">Minuto e segundo (ex.: 32:10)</label><input id="bookmark-time" placeholder="32:10" inputmode="numeric" style="display:block;width:100%;padding:12px;margin:8px 0;background:#222a37;color:white;border:1px solid #526078;border-radius:8px"><button id="bookmark-save" class="quiet">Anotar ponto</button><p id="bookmark-info"></p>';node('fontes').before(bookmark);
node('bookmark-save').onclick=()=>{const match=node('bookmark-time').value.trim().match(/^(\d{1,3}):([0-5]\d)$/);if(!match||typeof filmeAtual==='undefined'||!filmeAtual){node('bookmark-info').textContent='Informe minutos e segundos, como 32:10.';return;}const time=Number(match[1])*60+Number(match[2]);if(time<1){node('bookmark-info').textContent='Informe um ponto após o início.';return;}data.save({...metadata.get(String(filmeAtual.id)),...filmeAtual},time,null,true);node('bookmark-info').textContent='Ponto anotado. Na fonte externa, avance manualmente até esse minuto.';renderContinue();};
function renderFavoritos(){const titulo=node('resultados-titulo');const area=node('resultados');if(!titulo||!area||area.classList.contains('oculto')||titulo.textContent!=='Favoritos')return;window.StreamLibrary?.favorites?.();}
root.StreamPersonal={...data,bookmarkInfo(){const v=node('direct-video');bookmark.hidden=Boolean(v);node('bookmark-info').textContent='O player externo não informa o progresso. Você pode anotar o minuto para consultar depois.';},remember(f){metadata.set(String(f.id),f);},record(f,p,d){data.save({...metadata.get(String(f.id)),...f},p,d);},render:renderContinue,renderSearch,renderFavoritos};
node('q').addEventListener('focus',()=>{node('search-history').hidden=false;renderSearch();});
node('history-close').onclick=()=>node('search-history').hidden=true;
node('history-clear').onclick=()=>{data.clearSearch();renderSearch();};
renderSearch();renderContinue();
})(globalThis);
