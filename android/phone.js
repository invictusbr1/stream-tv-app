(()=>{
 'use strict';
 if(!document.documentElement.classList.contains('web-redesign')||document.documentElement.classList.contains('modo-tv')||/StreamTVAndroidTV/.test(navigator.userAgent))return;
 document.documentElement.classList.add('android-phone');
 const get=id=>document.getElementById(id),player=get('player');
 // Android's existing trusted fullscreen command controls the native orientation.
 const auto=get('auto-fullscreen');if(auto)auto.checked=true;
 const oldBack=window.streamBack;
 window.streamBack=()=>{
  if(!get('opcoes').hidden){window.fecharOpcoes();return true;}
  if(player.classList.contains('ativo')){window.fechar();return true;}
  if(get('series-dialog').open){window.StreamLibrary.closeSeries();return true;}
  return oldBack?oldBack():false;
 };
 const full=get('fullscreen-toggle');
 function paintFull(){
  const expanded=player.classList.contains('expanded'),kind=expanded?'exit':'enter';
  if(full.dataset.phoneIcon===kind&&full.querySelector('svg'))return;
  full.dataset.phoneIcon=kind;
  full.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+(expanded?'<path d="M3 8h5V3m8 0v5h5M8 21v-5H3m18 0h-5v5"/>':'<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>')+'</svg>';
  full.setAttribute('aria-label',expanded?'Sair da tela cheia':'Tela cheia');
 }
 new MutationObserver(paintFull).observe(full,{childList:true});
 new MutationObserver(paintFull).observe(player,{attributes:true,attributeFilter:['class']});paintFull();
 // Modal-like accessibility and catalog focus isolation, while keeping the player above details.
 const dialog=get('series-dialog');let isolated=[];
 function isolate(){
  document.documentElement.classList.toggle('phone-details-open',dialog.open);
  if(dialog.open){
   dialog.setAttribute('aria-modal','true');
   if(!isolated.length){isolated=[...document.body.children].filter(n=>n!==dialog&&n!==player&&!['SCRIPT','STYLE'].includes(n.tagName)&&!n.contains(player));for(const n of isolated){n.dataset.phonePriorInert=String(n.inert);n.inert=true;}}
  }else{
   dialog.removeAttribute('aria-modal');for(const n of isolated){n.inert=n.dataset.phonePriorInert==='true';delete n.dataset.phonePriorInert;}isolated=[];
  }
 }
 new MutationObserver(isolate).observe(dialog,{attributes:true,attributeFilter:['open']});isolate();
})();
