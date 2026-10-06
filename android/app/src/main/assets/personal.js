(function(root){
'use strict';
function createPersonal(storage){
 const read=k=>{try{const v=JSON.parse(storage.getItem(k)||'[]');return Array.isArray(v)?v:[];}catch{return [];}};
 const write=(k,v)=>{try{storage.setItem(k,JSON.stringify(v));}catch{}};
 const searches=()=>read('streamtv-searches').filter(x=>typeof x==='string').slice(0,100);
 const history=()=>read('streamtv-progress').filter(x=>x&&/^\d{1,10}$/.test(String(x.id))&&typeof x.titulo==='string').slice(0,100);
 const key=f=>`${f.id}:${f.episode?f.episode.season+':'+f.episode.number:'movie'}`;
 return {searches,history,key,
 search(q){q=String(q).trim().slice(0,200);if(q)write('streamtv-searches',[q,...searches().filter(x=>x.toLocaleLowerCase()!==q.toLocaleLowerCase())].slice(0,100));},
 removeSearch(q){write('streamtv-searches',searches().filter(x=>x!==q));},clearSearch(){write('streamtv-searches',[]);},
 remove(f){write('streamtv-progress',history().filter(x=>key(x)!==key(f)));},
 position(f){const v=history().find(x=>key(x)===key(f));return Number.isFinite(v?.position)?v.position:0;},
 save(f,position,duration,manual=false){if(!f||!/^\d{1,10}$/.test(String(f.id)))return;if(position!==null&&(!Number.isFinite(position)||position<1||(!manual&&(!Number.isFinite(duration)||duration<=0))))return;
 const previous=history(),old=previous.find(x=>key(x)===key(f));
 if(position!==null&&Number.isFinite(duration)&&duration>0&&position>=duration-30){this.remove(f);return;}
 write('streamtv-progress',[{...old,...f,position:position===null?(old?.position??null):position,duration:duration||old?.duration||null,manual:position===null?Boolean(old?.manual):manual,updated:Date.now()},...previous.filter(x=>key(x)!==key(f))].slice(0,100));}
 };
}
if(typeof module!=='undefined'&&module.exports){module.exports={createPersonal};return;}
root.createStreamPersonal=createPersonal;if(!document.getElementById('q'))return;
let storage;try{storage=localStorage;}catch{storage={getItem(){},setItem(){}};}
const data=createPersonal(storage),metadata=new Map();
const node=id=>document.getElementById(id);
function button(text,action){const b=document.createElement('button');b.className='quiet';b.textContent=text;b.onclick=action;return b;}
function renderSearch(){const list=node('search-history-items');if(!list)return;list.replaceChildren();for(const q of data.searches()){const row=document.createElement('div');row.className='history-item';row.append(button(q,()=>{node('q').value=q;root.StreamLibrary.search();}),button('Excluir',()=>{data.removeSearch(q);renderSearch();}));row.lastChild.setAttribute('aria-label','Excluir busca '+q);list.append(row);}if(!list.children.length)list.textContent='Nenhuma busca salva neste aparelho.';}
function renderContinue(){const section=node('continue-section'),list=node('continue-items');if(!list)return;list.replaceChildren();const entries=data.history();section.hidden=!entries.length;for(const f of entries){const wrapper=document.createElement('div');const card=document.createElement('button');card.className='card';if(f.capa){const img=document.createElement('img');img.src=f.capa;img.alt='';card.append(img);}const title=document.createElement('div');title.className='card-titulo';title.textContent=f.titulo;const info=document.createElement('div');info.className='card-meta';info.textContent=f.position===null?'Reabrir fonte · posição indisponível':`${f.manual?'Ponto anotado':'Continuar em'} ${Math.floor(f.position/60)}:${String(Math.floor(f.position%60)).padStart(2,'0')}`;card.append(title,info);card.onclick=()=>abrirPlayer(f.id,f.titulo,f.episode||null);wrapper.append(card,button('Remover',()=>{data.remove(f);renderContinue();}));list.append(wrapper);}}
const bookmark=document.createElement('section');bookmark.innerHTML='<div class="options-label">Salvar onde parou</div><label for="bookmark-time">Minuto e segundo (ex.: 32:10)</label><input id="bookmark-time" placeholder="32:10" inputmode="numeric" style="display:block;width:100%;padding:12px;margin:8px 0;background:#222a37;color:white;border:1px solid #526078;border-radius:8px"><button id="bookmark-save" class="quiet">Anotar ponto</button><p id="bookmark-info"></p>';node('fontes').before(bookmark);
node('bookmark-save').onclick=()=>{const match=node('bookmark-time').value.trim().match(/^(\d{1,3}):([0-5]\d)$/);if(!match||typeof filmeAtual==='undefined'||!filmeAtual){node('bookmark-info').textContent='Informe minutos e segundos, como 32:10.';return;}const time=Number(match[1])*60+Number(match[2]);if(time<1){node('bookmark-info').textContent='Informe um ponto após o início.';return;}data.save({...metadata.get(String(filmeAtual.id)),...filmeAtual},time,null,true);node('bookmark-info').textContent='Ponto anotado. Na fonte externa, avance manualmente até esse minuto.';renderContinue();};
root.StreamPersonal={...data,bookmarkInfo(){const v=node('direct-video');bookmark.hidden=Boolean(v);node('bookmark-info').textContent='O player externo não informa o progresso. Você pode anotar o minuto para consultar depois.';},remember(f){metadata.set(String(f.id),f);},record(f,p,d){data.save({...metadata.get(String(f.id)),...f},p,d);},render:renderContinue,renderSearch};
node('q').addEventListener('focus',()=>{node('search-history').hidden=false;renderSearch();});
node('history-close').onclick=()=>node('search-history').hidden=true;
node('history-clear').onclick=()=>{data.clearSearch();renderSearch();};
renderSearch();renderContinue();
})(globalThis);
