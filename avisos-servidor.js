(function(){
 'use strict';
 const KEY='conecta-avisos',READ='conecta-avisos-lidos',TOAST='conecta-avisos-exibidos';
 const phases=new Set(['preparando','reiniciando','concluida','restaurada','cancelada','falha']);
 const load=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key))||fallback;}catch{return fallback;}};
 const save=(key,value)=>{try{localStorage.setItem(key,JSON.stringify(value));}catch{}};
 const signature=a=>a.id+':'+a.fase;
 function valid(rows){return Array.isArray(rows)?rows.filter(a=>a&&/^[a-f0-9]{64}$/.test(a.id)&&phases.has(a.fase)&&Number.isFinite(a.em)&&Number.isFinite(a.ate)&&a.ate>Date.now()&&a.em<=Date.now()+60000&&typeof a.titulo==='string'&&typeof a.mensagem==='string'&&a.titulo.length<=100&&a.mensagem.length<=300).slice(-20):[];}
 const array=key=>{const value=load(key,[]);return Array.isArray(value)?value:[];};
 let items=valid(load(KEY,[])),read=new Set(array(READ)),shown=new Set(array(TOAST));
 let busy=false,first=true,timer=null,toastTimer=null,returnFocus=null;
 const style=document.createElement('style');style.textContent=`
 .aviso-sino{position:relative;flex-shrink:0;display:grid!important;place-items:center;width:42px;height:42px;padding:10px!important;border-radius:12px;background:#151a22;color:#e7edf7;border:1px solid #ffffff12;cursor:pointer}
 .header .nav-chips{min-width:0;overflow-x:auto;scrollbar-width:none}.header>.aviso-sino{margin-left:auto}.aviso-sino svg{width:21px;height:21px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}.aviso-sino[data-novo="true"]:after{content:'';position:absolute;right:7px;top:6px;width:7px;height:7px;background:#f44359;border-radius:50%}
 .avisos-painel{box-sizing:border-box;width:min(420px,calc(100vw - 28px));max-height:75dvh;overflow:auto;color:#eef2f7;background:#10141d;border:1px solid #ffffff26;border-radius:16px;padding:20px;box-shadow:0 16px 70px #0009}.avisos-painel::backdrop{background:#0008}.avisos-painel h2{margin:0;font-size:20px}.avisos-topo{display:flex;align-items:center;justify-content:space-between;gap:16px}.avisos-fechar{padding:7px 11px;background:#222936;color:white;border:0;border-radius:9px;cursor:pointer}.avisos-painel ul{padding:0;list-style:none;margin:16px 0 0}.avisos-painel li{padding:14px 0;border-top:1px solid #ffffff14}.avisos-painel p{font-size:14px;line-height:1.5;color:#bcc6d6;margin:7px 0}.avisos-painel time{font-size:12px;color:#8894a8}
 .aviso-breve{box-sizing:border-box;position:fixed;z-index:2147483000;right:16px;bottom:calc(80px + env(safe-area-inset-bottom));width:min(330px,calc(100% - 32px));background:#161c28f2;color:#f5f7fb;border:1px solid #ffffff26;border-radius:12px;padding:12px 38px 12px 14px;box-shadow:0 6px 30px #0006;font:13px/1.45 system-ui,sans-serif}.aviso-breve strong{display:block;font-size:14px}.aviso-breve button{position:absolute;top:5px;right:6px;padding:5px 9px;background:none;border:0;color:#c4cede;cursor:pointer}.aviso-breve[hidden]{display:none!important}
 #player .aviso-breve{position:absolute;bottom:100px}html.modo-tv .aviso-breve{font-size:16px;width:400px}html.modo-tv .aviso-breve strong{font-size:17px}
 `;document.head.append(style);
 const bellSvg='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg>';
 const bells=[];
 const dialog=document.createElement('dialog');dialog.className='avisos-painel';dialog.setAttribute('aria-labelledby','avisos-titulo');
 const top=document.createElement('div');top.className='avisos-topo';const title=document.createElement('h2');title.id='avisos-titulo';title.textContent='Notificações';
 const close=document.createElement('button');close.className='avisos-fechar';close.textContent='×';close.setAttribute('aria-label','Fechar notificações');top.append(title,close);
 const list=document.createElement('ul');dialog.append(top,list);document.body.append(dialog);
 const toast=document.createElement('aside');toast.className='aviso-breve';toast.hidden=true;toast.setAttribute('role','status');toast.setAttribute('aria-live','polite');
 const toastTitle=document.createElement('strong'),toastText=document.createElement('span'),dismiss=document.createElement('button');dismiss.textContent='×';dismiss.setAttribute('aria-label','Dispensar aviso');toast.append(toastTitle,toastText,dismiss);document.body.append(toast);
 function paint(){
  items=valid(items);const unread=items.some(a=>!read.has(signature(a)));
  bells.forEach(b=>{b.dataset.novo=String(unread);b.setAttribute('aria-label',unread?'Notificações: novos avisos':'Notificações');});
  list.replaceChildren();
  if(!items.length){const p=document.createElement('p');p.textContent='Nenhum aviso no momento.';list.append(p);}
  for(const a of [...items].reverse()){
   const li=document.createElement('li'),h=document.createElement('strong'),p=document.createElement('p'),t=document.createElement('time');
   h.textContent=a.titulo;p.textContent=a.mensagem;t.dateTime=new Date(a.em).toISOString();t.textContent=new Date(a.em).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});li.append(h,p,t);list.append(li);
  }
 }
 function host(){return document.fullscreenElement||((document.getElementById('player')?.classList.contains('ativo'))?document.getElementById('player'):document.body);}
 function show(a){
  host().append(toast);toastTitle.textContent=a.titulo;toastText.textContent=a.mensagem;toast.hidden=false;
  clearTimeout(toastTimer);toastTimer=setTimeout(()=>{toast.hidden=true;},8000);
  shown.add(signature(a));save(TOAST,[...shown].slice(-100));
 }
 function open(){returnFocus=document.activeElement;host().append(dialog);if(!dialog.open)dialog.showModal();for(const a of items)read.add(signature(a));save(READ,[...read].slice(-100));paint();}
 function addBell(parent){if(!parent)return;const b=document.createElement('button');b.className='aviso-sino';b.type='button';b.innerHTML=bellSvg;b.setAttribute('title','Notificações');b.addEventListener('click',open);if(parent.id==='topbar')parent.insertBefore(b,parent.querySelector('.acoes'));else parent.prepend(b);bells.push(b);}
 addBell(document.getElementById('topbar'));
 close.onclick=()=>dialog.close();dialog.addEventListener('close',()=>returnFocus?.focus?.());dismiss.onclick=()=>{toast.hidden=true;};
 document.addEventListener('fullscreenchange',()=>{if(!toast.hidden)host().append(toast);});
 async function poll(){
  if(busy||document.visibilityState==='hidden')return;busy=true;
  try{
   const r=await fetch('/api/notificacoes',{cache:'no-store',signal:AbortSignal.timeout(8000)});if(!r.ok)return;const data=await r.json();const next=valid(data.avisos),previous=new Set(items.map(a=>a.id));
   items=next;save(KEY,items);
   if(dialog.open){for(const a of items){read.add(signature(a));shown.add(signature(a));}save(READ,[...read].slice(-100));save(TOAST,[...shown].slice(-100));}
   paint();
   const fresh=[...items].reverse().find(a=>!shown.has(signature(a))&&(a.fase==='preparando'||a.fase==='reiniciando'||a.fase==='falha'||(!first&&previous.has(a.id)))&&Date.now()-a.em<45*60000);
   if(fresh)show(fresh);first=false;
  }catch{ /* Uma indisponibilidade não interrompe nem recarrega o vídeo. */ }
  finally{busy=false;}
 }
 paint();poll();timer=setInterval(poll,20000);
 document.addEventListener('visibilitychange',()=>{if(document.visibilityState!=='hidden'){paint();poll();}});window.addEventListener('online',poll);
 window.addEventListener('pagehide',()=>{clearInterval(timer);clearTimeout(toastTimer);});
 window.addEventListener('pageshow',event=>{if(event.persisted){clearInterval(timer);timer=setInterval(poll,20000);poll();}});
 window.StreamAvisos={abrir:open,atualizar:poll};
})();
