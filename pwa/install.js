'use strict';
(()=>{
 const note=document.createElement('div');note.id='offline-note';note.textContent='Sem conexão. Seus dados salvos continuam neste aparelho; catálogo e vídeos precisam de internet.';document.querySelector('.header').after(note);
 const online=()=>note.hidden=navigator.onLine;online();window.addEventListener('online',online);window.addEventListener('offline',online);
 const ios=/iPhone|iPad|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
 const standalone=window.matchMedia('(display-mode: standalone)').matches||navigator.standalone;
 if(ios&&!standalone){
   const help=document.createElement('dialog');help.id='ios-help';help.setAttribute('aria-labelledby','ios-help-title');help.innerHTML='<h2 id="ios-help-title">Stream TV no iPhone</h2><p>No Safari, toque em Compartilhar, depois em <strong>Adicionar à Tela de Início</strong>. Se aparecer a opção, mantenha <strong>Abrir como App</strong> ativada e toque em Adicionar.</p><p>O histórico fica neste aparelho. A reprodução e a tela cheia dependem do player e do iOS.</p><button class="quiet">Entendi</button>';help.querySelector('button').onclick=()=>help.close();document.body.append(help);
   const button=document.createElement('button');button.className='nav';button.id='ios-instalar';button.textContent='Instalar no iPhone';button.onclick=()=>help.showModal();
   (document.querySelector('.nav-chips')||document.querySelector('.header')).append(button);
 }
 if('serviceWorker' in navigator&&window.isSecureContext)navigator.serviceWorker.register('/sw.js').catch(()=>{});
})();
