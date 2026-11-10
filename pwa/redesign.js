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
 // Ficha do título (07/11/2026): a sinopse já está no topo — embaixo, no
 // lugar da repetida, vêm informações, elenco, trailer, crítica e os
 // comentários da família.
 const fichaBox=document.createElement('div');fichaBox.id='ficha-extra';byId('aba-detalhes')?.append(fichaBox);
 let fichaAtual='';const viaGet=/StreamTVAndroid/.test(navigator.userAgent);const quem=()=>{try{const d=localStorage.getItem('streamtv-dispositivo')||'';return viaGet&&/^[a-z0-9]{6,32}$/.test(d)?'disp='+d:'';}catch(e){return '';}};const comQ=(u,q)=>u+(q?(u.includes('?')?'&':'?')+q:'');
 const novo=(tag,cls,txt)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(txt!==undefined)n.textContent=txt;return n;};
 const estrelas=n=>'★★★★★'.slice(0,n)+'☆☆☆☆☆'.slice(0,5-n);
 const IDIOMAS={en:'Inglês',ja:'Japonês',ko:'Coreano',pt:'Português',es:'Espanhol',fr:'Francês',it:'Italiano',de:'Alemão',zh:'Chinês',hi:'Hindi'};
 function dataBr(s){const m=String(s||'').match(/^(\d{4})-(\d{2})-(\d{2})/);return m?`${m[3]}/${m[2]}/${m[1]}`:'';}
 function horas(min){if(!min)return '';const h=Math.floor(min/60),m=min%60;return h?`${h}h${m?String(m).padStart(2,'0'):''}`:`${m} min`;}
 async function pintarFicha(f){
  const chave=(f.tipo==='tv'?'tv':'movie')+'/'+f.id;fichaAtual=chave;fichaBox.replaceChildren(novo('p','ficha-carregando','Carregando mais informações…'));
  let d=null,comentarios=[];
  try{const [r1,r2]=await Promise.all([fetch('/api/ficha/'+chave,{cache:'no-store'}),fetch(comQ('/api/comentarios/'+chave,quem()),{cache:'no-store'})]);d=r1.ok?await r1.json():null;comentarios=r2.ok?await r2.json():[];}catch(e){}
  if(fichaAtual!==chave)return;
  fichaBox.replaceChildren();
  if(d){
   if(d.frase)fichaBox.append(novo('p','ficha-frase','“'+d.frase+'”'));
   const info=novo('dl','ficha-info');
   const item=(rot,val)=>{if(!val)return;const par=novo('div');par.append(novo('dt','',rot),novo('dd','',val));info.append(par);};
   item(f.tipo==='tv'?'Episódios':'Duração',f.tipo==='tv'?[d.temporadas&&`${d.temporadas} temporada${d.temporadas>1?'s':''}`,d.episodios&&`${d.episodios} episódios`,d.duracao&&`~${d.duracao} min cada`].filter(Boolean).join(' · '):horas(d.duracao));
   item('Estreia',dataBr(d.estreia));item('Situação',d.situacao);
   item('Classificação',d.classificacao?(/^L$/i.test(d.classificacao)?'Livre':d.classificacao+' anos'):'');
   item(f.tipo==='tv'?'Criação':'Direção',(d.direcao||[]).join(', '));
   item('Idioma original',IDIOMAS[d.idiomaOriginal]||d.idiomaOriginal);
   item('Título original',d.tituloOriginal&&d.tituloOriginal!==f.titulo?d.tituloOriginal:'');
   item('Nota do público',d.nota?`★ ${d.nota} (${Number(d.votos).toLocaleString('pt-BR')} votos)`:'');
   item('Produção',(d.produtoras||[]).join(', '));item('Faz parte de',d.colecao);
   if(info.children.length){fichaBox.append(novo('h3','','Informações'),info);}
   if(d.trailer){const b=novo('button','quiet ficha-trailer','▶ Ver trailer');b.type='button';b.onclick=()=>window.open('https://www.youtube.com/watch?v='+encodeURIComponent(d.trailer),'_blank','noopener');fichaBox.append(b);}
   if((d.elenco||[]).length){
    const lista=novo('div','ficha-elenco');
    for(const p of d.elenco){const c=novo('div','ficha-ator');let img;if(p.foto){img=novo('img');img.alt='';img.loading='lazy';img.src=p.foto;}else img=novo('div','ficha-sem-foto',(p.nome||'?').trim().charAt(0).toUpperCase());c.append(img,novo('strong','',p.nome),novo('span','',p.personagem));lista.append(c);}
    fichaBox.append(novo('h3','','Elenco'),lista);
   }
   if((d.criticas||[]).length){
    fichaBox.append(novo('h3','','O que a crítica diz'));
    for(const c of d.criticas){const b=novo('blockquote','ficha-critica');b.append(novo('p','',c.texto+(c.texto.length>=420?'…':'')),novo('footer','',[c.autor,c.nota&&`nota ${c.nota}/10`,c.ingles&&'em inglês'].filter(Boolean).join(' · ')));fichaBox.append(b);}
   }
  }
  // Comentários da família.
  const sec=novo('section','ficha-comentarios');sec.append(novo('h3','','💬 Comentários da família'));
  const lista=novo('div','ficha-lista');
  const atualizarResumoFamilia=itens=>{
   let resumo=byId('ficha-familia-resumo');
   if(!resumo){
    resumo=novo('div','ficha-familia-resumo');resumo.id='ficha-familia-resumo';
    const heading=dialog.querySelector('.series-heading');
    if(heading){const meta=byId('series-meta');if(meta)meta.after(resumo);else heading.append(resumo);}
   }
   const comNota=(itens||[]).filter(c=>typeof c.nota==='number'&&c.nota>=1&&c.nota<=5);
   if(comNota.length>0){
    const soma=comNota.reduce((a,b)=>a+b.nota,0);
    const media=(soma/comNota.length).toFixed(1);
    const autores=[...new Set((itens||[]).map(c=>c.nome).filter(Boolean))];
    resumo.className='ficha-familia-resumo';
    resumo.replaceChildren(
     novo('span','familia-estrelas',estrelas(Math.round(Number(media)))),
     novo('strong','familia-nota','★ '+media),
     novo('span','familia-votos','pela família ('+comNota.length+' voto'+(comNota.length>1?'s':'')+')'),
     novo('span','familia-autores','· '+autores.join(', '))
    );
    resumo.onclick=()=>sec.scrollIntoView({behavior:'smooth',block:'start'});
   }else{
    resumo.className='ficha-familia-resumo sem-voto';
    resumo.replaceChildren(novo('span','','⭐ Seja o primeiro da família a avaliar este filme! Dê sua nota abaixo'));
    resumo.onclick=()=>sec.scrollIntoView({behavior:'smooth',block:'start'});
   }
  };
  const desenhar=itens=>{lista.replaceChildren();atualizarResumoFamilia(itens);if(!itens.length)lista.append(novo('p','ficha-vazio','Ninguém comentou ainda. Seja o primeiro a dizer o que achou!'));
   for(const c of itens){const b=novo('div','ficha-coment'+(c.meu?' meu':''));const topo=novo('div','ficha-coment-topo');topo.append(novo('strong','',c.nome+(c.meu?' (você)':'')),c.nota?novo('span','ficha-estrelas',estrelas(c.nota)):novo('span'),novo('small','',new Date(c.em).toLocaleDateString('pt-BR')));b.append(topo);if(c.texto)b.append(novo('p','',c.texto));if(c.meu){const x=novo('button','quiet ficha-apagar','Apagar meu comentário');x.type='button';x.onclick=async()=>{try{const r=viaGet?await fetch(comQ('/api/comentarios/'+chave+'/apagar',quem()),{cache:'no-store'}):await fetch('/api/comentarios/'+chave,{method:'DELETE'});if(r.ok){const novos=await r.json();desenhar(novos);nota=0;pintarNotas();texto.value='';enviar.textContent='Comentar';aviso.textContent='Comentário apagado.';try{window.atualizarIndicacoesFamilia?.(true);}catch(e){}}}catch(e){}};b.append(x);}lista.append(b);}};
  const meu=(Array.isArray(comentarios)?comentarios:[]).find(c=>c.meu);
  const form=novo('form','ficha-form');let nota=meu?.nota||0;
  const notas=novo('div','ficha-notas');notas.setAttribute('aria-label','Sua nota');
  const pintarNotas=()=>[...notas.children].forEach((b,i)=>{b.textContent=i<nota?'★':'☆';b.setAttribute('aria-pressed',String(i<nota));});
  for(let i=1;i<=5;i++){const b=novo('button','ficha-nota');b.type='button';b.setAttribute('aria-label',i+' estrela'+(i>1?'s':''));b.onclick=()=>{nota=i;pintarNotas();};notas.append(b);}
  pintarNotas();
  const texto=novo('textarea');texto.maxLength=280;texto.rows=2;texto.placeholder='O que você achou? (sem spoiler!)';texto.value=meu?.texto||'';
  const enviar=novo('button','primary',meu?'Atualizar meu comentário':'Comentar');enviar.type='submit';
  const aviso=novo('small','ficha-aviso','');
  form.append(notas,texto,enviar,aviso);
  form.onsubmit=async e=>{e.preventDefault();e.stopPropagation();if(!nota&&!texto.value.trim()){aviso.textContent='Dê uma nota ou escreva algo.';return;}
   enviar.disabled=true;try{const r=viaGet?await fetch(comQ('/api/comentarios/'+chave+'/enviar?nota='+nota+'&texto='+encodeURIComponent(texto.value),quem()),{cache:'no-store'}):await fetch('/api/comentarios/'+chave,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({nota,texto:texto.value})});if(r.ok){const novos=await r.json();desenhar(novos);enviar.textContent='Atualizar meu comentário';aviso.textContent='Comentário salvo — a família toda vê.';try{window.atualizarIndicacoesFamilia?.(true);}catch(e){}}else aviso.textContent='Não foi possível salvar agora.';}catch(err){aviso.textContent='Não foi possível salvar agora.';}finally{enviar.disabled=false;}};
  desenhar(Array.isArray(comentarios)?comentarios:[]);
  sec.append(lista,form);fichaBox.append(sec);
 }
 // Full page details live below the player, rather than in the modal top layer.
 dialog.showModal=()=>{if(!dialog.open)originalShow();dialog.scrollTop=0;document.body.style.overflow='hidden';};
 function render(f){
  selected=f;summary.textContent=f.sinopse||'';
  const movie=f.tipo!=='tv';dialog.dataset.kind=movie?'movie':'tv';
  byId('aba-episodios-btn').hidden=movie;byId('aba-detalhes-btn').hidden=movie;
  pintarFicha(f).catch(()=>{});
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
