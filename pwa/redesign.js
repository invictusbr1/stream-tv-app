/* Loaded only by the browser page adapter. */
(()=>{
 'use strict';
 if(/StreamTVAndroid|SMART-TV|Tizen|HbbTV|NetCast|webOS|GoogleTV|BRAVIA|AndroidTV|FireTV/i.test(navigator.userAgent)||document.documentElement.classList.contains('modo-tv'))return;
 document.documentElement.classList.add('web-redesign');
 const byId=id=>document.getElementById(id),dialog=byId('series-dialog'),player=byId('player'),library=window.StreamLibrary;
 if(!dialog||!player||!library)return;
 const originalOpen=library.open.bind(library),originalShow=dialog.show.bind(dialog);
 let selected=null,scrollBefore=0,focusBefore=null,navigating=false,wasPlaying=false,seasonBefore='';
 const summary=document.createElement('p');summary.className='detail-summary';dialog.querySelector('.series-heading').append(summary);
 // Full page details live below the player, rather than in the modal top layer.
 dialog.showModal=()=>{if(!dialog.open)originalShow();dialog.scrollTop=0;document.body.style.overflow='hidden';};
 function render(f){
  selected=f;summary.textContent=f.sinopse||'';
  const movie=f.tipo!=='tv';dialog.dataset.kind=movie?'movie':'tv';
  byId('aba-episodios-btn').hidden=movie;byId('aba-detalhes-btn').hidden=movie;
  if(!movie){originalOpen(f);return;}
  byId('series-title').textContent=f.titulo;byId('series-eyebrow').textContent='Filme';
  byId('series-meta').textContent=[f.ano,f.nota&&'★ '+f.nota,(f.generos||[]).join(' · ')].filter(Boolean).join(' · ');
  byId('series-summary').textContent=f.sinopse||'Sinopse indisponível para este título.';
  byId('series-audios').textContent='As opções disponíveis aparecem no player, conforme a fonte.';byId('series-legendas').textContent='Confira as faixas disponíveis no menu de legendas do player.';
  byId('series-art').hidden=!(f.fundo||f.capa);byId('series-art').src=f.fundo||f.capa||'';
  byId('series-selos').replaceChildren();byId('aba-episodios').hidden=true;byId('aba-detalhes').hidden=false;
  const fav=byId('series-fav');const update=()=>{const active=!!window.StreamPersonal?.isFavorite?.(f.id);fav.textContent=active?'★ Favorito':'☆ Favoritar';fav.setAttribute('aria-pressed',String(active));};
  update();fav.onclick=()=>{window.StreamPersonal?.toggleFavorite?.(f);update();window.StreamPersonal?.renderFavoritos?.();};
  byId('series-assistir').textContent='Assistir agora';byId('series-assistir').onclick=()=>{dialog.close();window.abrirPlayer(f.id,f.titulo);};
  dialog.showModal();byId('series-close').focus();
 }
 library.open=f=>{
  if(!selected){scrollBefore=window.scrollY;focusBefore=document.activeElement;}
  const type=f.tipo==='tv'?'tv':'movie',key=type+'/'+f.id;
  try{sessionStorage.setItem('conecta-detail:'+key,JSON.stringify(f));}catch{}
  history.pushState({...history.state,conectaDetail:f},'', '#titulo='+key);render(f);
 };
 function restoreCatalog(){selected=null;document.body.style.overflow='';window.scrollTo(0,scrollBefore);focusBefore?.focus?.({preventScroll:true});}
 dialog.addEventListener('close',()=>setTimeout(()=>{
  if(navigating||dialog.open||player.classList.contains('ativo'))return;
  if(selected&&history.state?.conectaDetail)history.back();else restoreCatalog();
 },0));
 function route(){
  navigating=true;
  if(player.classList.contains('ativo'))window.fechar?.();
  if(dialog.open)library.closeSeries();
  let f=history.state?.conectaDetail;
  if(!f){const match=location.hash.match(/^#titulo=(tv|movie)\/(\d+)$/);if(match)try{f=JSON.parse(sessionStorage.getItem('conecta-detail:'+match[1]+'/'+match[2]));}catch{}}
  if(f)render(f);else restoreCatalog();
  setTimeout(()=>{navigating=false;},0);
 }
 window.addEventListener('popstate',route);
 if(location.hash.startsWith('#titulo='))route();
 const paths={back:'<path d="m15 18-6-6 6-6"/>',play:'<path d="m9 5 11 7-11 7z"/>',pause:'<path d="M8 5v14M16 5v14"/>',volume:'<path d="M11 5 6 9H3v6h3l5 4zM15 8c3 2 3 6 0 8M18 5c5 4 5 10 0 14"/>',mute:'<path d="M11 5 6 9H3v6h3l5 4zM16 9l5 6m0-6-5 6"/>',full:'<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',settings:'<path d="M4 7h16M4 17h16M9 4v6m6 4v6"/>'};
 const svg=body=>'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+body+'</svg>';
 function icon(id,name){const b=byId(id);if(b)b.innerHTML=svg(paths[name]);}
 icon('fullscreen-toggle','full');icon('options-toggle','settings');
 const back=player.querySelector('.btn-voltar');if(back)back.innerHTML=svg(paths.back);
 for(const [id,flip] of [['direct-back',false],['direct-forward',true]]){
  byId(id).innerHTML='<span class="seek-icon">'+svg('<g'+(flip?' transform="translate(24 0) scale(-1 1)"':'')+'><path d="M4 9a9 9 0 1 1 0 7M4 3v6h6"/></g>')+'<small>10</small></span>';
 }
 const paintToggle=()=>{const b=byId('direct-toggle'),name=b.getAttribute('aria-label')==='Pausar'?'pause':'play';if(b.dataset.icon===name&&b.querySelector('svg'))return;b.dataset.icon=name;icon('direct-toggle',name);};
 new MutationObserver(paintToggle).observe(byId('direct-toggle'),{attributes:true,attributeFilter:['aria-label'],childList:true});paintToggle();
 const paintVolume=()=>{const b=byId('volume-toggle'),v=byId('direct-video'),name=v?.muted||Number(byId('volume-range').value)===0?'mute':'volume';if(b.dataset.icon===name&&b.querySelector('svg'))return;b.dataset.icon=name;icon('volume-toggle',name);};
 new MutationObserver(paintVolume).observe(byId('volume-toggle'),{childList:true});paintVolume();
 byId('volume-toggle').onclick=()=>{const controls=byId('direct-controls'),open=controls.classList.toggle('volume-open');byId('volume-toggle').setAttribute('aria-expanded',String(open));if(open)byId('volume-range').focus();};
 byId('volume-toggle').setAttribute('aria-label','Ajustar volume');byId('volume-toggle').setAttribute('aria-expanded','false');
 document.addEventListener('pointerdown',e=>{if(![byId('volume-toggle'),byId('volume-range')].some(x=>x.contains(e.target))){byId('direct-controls').classList.remove('volume-open');byId('volume-toggle').setAttribute('aria-expanded','false');}});
 const coarse=()=>matchMedia('(pointer:coarse)').matches;
 if(coarse()&&!/iPhone|iPad|iPod/.test(navigator.userAgent)){const auto=byId('auto-fullscreen');if(auto)auto.checked=true;}
 const oldFullscreen=window.telaCheia;
 window.telaCheia=async()=>{await oldFullscreen();if(document.fullscreenElement&&coarse())try{await screen.orientation?.lock?.('landscape');}catch{}};
 document.addEventListener('fullscreenchange',()=>{if(!document.fullscreenElement)try{screen.orientation?.unlock?.();}catch{}icon('fullscreen-toggle','full');});
 const hint=document.createElement('div');hint.className='rotate-hint';hint.textContent='Para assistir deitado, toque em tela cheia ou gire o celular.';hint.hidden=true;player.querySelector('.area-player').append(hint);
 function updatePlayer(){
  const playing=player.classList.contains('ativo');
  hint.hidden=!playing||!coarse()||!matchMedia('(orientation:portrait)').matches;
  if(playing&&!wasPlaying){seasonBefore=byId('season-select').value;setTimeout(()=>{hint.hidden=true;},6500);}
  if(!playing&&wasPlaying){try{screen.orientation?.unlock?.();}catch{}if(selected&&!navigating){const title=selected;Promise.resolve(render(title)).then(()=>{if(selected!==title||title.tipo!=='tv'||!seasonBefore)return;const s=byId('season-select');if([...s.options].some(o=>o.value===seasonBefore)){s.value=seasonBefore;s.dispatchEvent(new Event('change'));}});}}
  wasPlaying=playing;
 }
 new MutationObserver(updatePlayer).observe(player,{attributes:true,attributeFilter:['class']});window.addEventListener('resize',updatePlayer);
})();
