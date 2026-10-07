'use strict';
window.StreamLibrary=(()=>{
// reabre a série de onde o usuário saiu (usado pelo botão voltar)
 let kind='all',page=1,pages=1,genre='',query='',sequence=0,seriesSequence=0,selected=null,seasonRequest=null,lastTop=0,topBusy=false,topDeferred=null;
 const get=(url,signal)=>lerJson(url,signal||timeoutSignal(18000));
 function results(){el('hero').hidden=true;el('catalogo').classList.add('oculto');el('resultados').classList.remove('oculto');el('library-filters').hidden=false;document.querySelectorAll('.page-controls').forEach(x=>{x.hidden=false;});}
 async function load(){const token=++sequence;results();el('grid').textContent='Carregando…';el('resultados-titulo').textContent=query?`Resultados para “${query}”`:kind==='tv'?'Séries':kind==='dorama'?'Doramas':kind==='short-drama'?'Mininovelas e dramas curtos':kind==='anime'?'Animes · séries':kind==='anime-film'?'Animes · filmes':'Filmes';try{const d=await get('/api/explore?'+new URLSearchParams({tipo:kind,page:String(page),genre,nome:query}));if(token!==sequence)return;pages=d.pages;renderizar(d.items);el('library-page').textContent=`Página ${page} de ${pages}`;el('library-page-bottom').textContent=el('library-page').textContent;el('library-prev').disabled=page<=1;el('library-next').disabled=page>=pages;el('library-prev-bottom').disabled=page<=1;el('library-next-bottom').disabled=page>=pages;el('resultados-titulo').scrollIntoView?.({block:'start'});}catch{if(token===sequence)el('grid').textContent='Não foi possível carregar. Tente novamente.';}}
 async function browse(type,selectedGenre=''){if(el('anime-types'))el('anime-types').hidden=!['anime','anime-film'].includes(type);if(el('library-note'))el('library-note').textContent=type==='short-drama'?'Dramas asiáticos com episódios de até 20 minutos, conforme o cadastro.':type==='dorama'?'Dramas asiáticos, sem animações, reality shows ou programas de entrevistas.':type.startsWith('anime')?'Animações japonesas, organizadas pelos gêneros disponíveis no catálogo.':'';kind=type;page=1;genre=selectedGenre;query='';el('q').value='';const token=++sequence;el('genre-filter').replaceChildren(new Option('Todas',''));try{const genres=await get('/api/genres?tipo='+kind);if(token!==sequence)return;for(const g of genres)el('genre-filter').append(new Option(g.name,g.id));}catch{}if(token===sequence){el('genre-filter').value=genre;load();}}
 function search(){window.StreamPersonal?.search(el('q').value);window.StreamPersonal?.renderSearch();if(el('search-history'))el('search-history').hidden=true;genre='';el('genre-filter').value='';query=el('q').value.trim();const genresByName={'ação':'28','acao':'28','terror':'27','comédia':'35','comedia':'35','aventura':'12','romance':'10749','ficção científica':'878','drama':'18','animação':'16','animacao':'16'};const genreId=genresByName[query.toLocaleLowerCase()];if(genreId&&['all','movie'].includes(kind))return browse('movie',genreId);page=1;load();}
 function home(){if(el('anime-types'))el('anime-types').hidden=true;if(el('library-note'))el('library-note').textContent='';kind='all';++sequence;el('library-filters').hidden=true;query='';}
 async function reabrir(id,temporada){
  const numero=Number(id)||0;if(!numero)return;
  await open({id:numero,titulo:'',tipo:'tv'});
  const select=el('season-select');
  if(!select)return;
  const existe=[...select.options].some(o=>o.value===String(temporada));
  if(existe){select.value=String(temporada);await loadSeason();}
}
async function open(f){if(f.tipo!=='tv')return abrirPlayer(f.id,f.titulo);selected=f;const token=++seriesSequence;el('series-title').textContent=f.titulo;el('series-summary').textContent=f.sinopse||'';el('series-art').hidden=!(f.fundo||f.capa);if(f.fundo||f.capa)el('series-art').src=f.fundo||f.capa;el('series-meta').textContent=[f.ano,f.nota&&'★ '+f.nota].filter(Boolean).join(' · ');el('episodes').replaceChildren();el('season-select').replaceChildren();el('episode-status').textContent='Carregando temporadas…';atualizarFavoritoDaSerie(f);el('series-dialog').showModal();try{const d=await get('/api/tv/'+f.id);if(token!==seriesSequence)return;for(const s of d.seasons)el('season-select').append(new Option(s.name,s.number));if(!d.seasons.length){el('episode-status').textContent='Sem episódios cadastrados.';return;}const first=d.seasons.find(s=>s.number>0);if(first)el('season-select').value=String(first.number);loadSeason();}catch{if(token===seriesSequence)el('episode-status').textContent='Não foi possível carregar as temporadas.';}}
// Botão de favorito da série aberta (fica guardado no aparelho e na conta).
function atualizarFavoritoDaSerie(f){const botao=el('series-fav');if(!botao)return;const marcado=Boolean(window.StreamPersonal?.isFavorite?.(f.id));botao.textContent=marcado?'★ Favorito':'☆ Favoritar';botao.setAttribute('aria-pressed',String(marcado));botao.title=marcado?'Remover dos favoritos':'Guardar em Favoritos';botao.onclick=()=>{const personal=window.StreamPersonal;if(!personal?.toggleFavorite)return;const agora=personal.toggleFavorite(f);botao.textContent=agora?'★ Favorito':'☆ Favoritar';botao.setAttribute('aria-pressed',String(agora));personal.renderFavoritos?.();};}
// Contador de episódios: mostra quantos já foram vistos e marca cada um.
 function episodiosVistos(f,season){const lista=window.StreamPersonal?.watched?.()||[];return new Set(lista.filter(x=>String(x.id)===String(f.id)&&x.episode&&Number(x.episode.season)===Number(season)).map(x=>Number(x.episode.number)));}
 function episodioAssistido(f,season,number){const vistos=episodiosVistos(f,season);return vistos.has(Number(number));}
 function contadorDeEpisodios(f,season,episodios){const vistos=episodiosVistos(f,season);const total=episodios.length;const quantos=episodios.filter(e=>vistos.has(Number(e.number))).length;const proximo=episodios.find(e=>!vistos.has(Number(e.number))&&!(e.date&&e.date>new Date().toISOString().slice(0,10)));
  const partes=[`Temporada ${season}`,`${total} episódio${total===1?'':'s'}`];if(quantos)partes.push(`${quantos} assistido${quantos===1?'':'s'}`);if(quantos&&quantos<total)partes.push(`${Math.round(quantos/total*100)}%`);
  const texto=`${partes.join(' · ')}${proximo?` — você parou no episódio ${proximo.number}`:quantos===total&&total?' — temporada concluída':''}`;
  const alvo=el('episode-progresso');if(alvo)alvo.textContent=texto;
  return {texto,proximo,vistos};}
 async function loadSeason(){seasonRequest?.abort();seasonRequest=new AbortController();const req=seasonRequest,token=seriesSequence,f=selected,season=Number(el('season-select').value);el('episodes').replaceChildren();el('episode-status').textContent='Carregando episódios…';const timer=setTimeout(()=>req.abort(),18000);try{const d=await get(`/api/season/${f.id}/${season}`,req.signal);if(token!==seriesSequence||req!==seasonRequest)return;const contador=contadorDeEpisodios(f,season,d.episodes||[]);el('episode-status').textContent='Escolha um episódio para abrir o player.';for(const e of d.episodes){const linha=document.createElement('div');linha.className='episode-row';const b=document.createElement('button');b.className='episode-play-btn';b.setAttribute('aria-label',`Reproduzir episódio ${e.number}: ${e.name}`);if(e.image){const img=document.createElement('img');img.className='episode-art';img.src=e.image;img.alt='';img.loading='lazy';b.append(img);}const info=document.createElement('span');info.className='episode-info';const name=document.createElement('strong');name.textContent=`${e.number}. ${e.name}`;if(contador.vistos.has(Number(e.number))){const visto=document.createElement('em');visto.className='episode-watched';visto.textContent='Assistido';name.append(' ',visto);}info.append(name);const p=document.createElement('small');p.textContent=e.overview||e.date||'';info.append(p);const play=document.createElement('span');play.className='episode-play';play.textContent=contador.proximo&&Number(contador.proximo.number)===Number(e.number)?'▶ Continuar':'▶';b.append(info,play);if(e.date&&e.date>new Date().toISOString().slice(0,10)){b.disabled=true;p.textContent='Ainda não lançado';}b.onclick=()=>{closeSeries();abrirPlayer(f.id,`${f.titulo} · T${season} E${e.number}`,{season,number:e.number});};
   const marcar=document.createElement('button');marcar.className='episode-check';const visto=contador.vistos.has(Number(e.number));marcar.setAttribute('aria-pressed',String(visto));marcar.setAttribute('aria-label',visto?`Desmarcar episódio ${e.number} como assistido`:`Marcar episódio ${e.number} como assistido`);marcar.title=visto?'Assistido (toque para desmarcar)':'Marcar como assistido';marcar.textContent=visto?'✓':'○';marcar.onclick=()=>{const personal=window.StreamPersonal;if(!personal?.markWatched)return;personal.markWatched({id:f.id,titulo:f.titulo,episode:{season,number:e.number}},!visto);loadSeason();};
   linha.append(b,marcar);el('episodes').append(linha);}if(!d.episodes.length)el('episode-status').textContent='Sem episódios nesta temporada.';}catch{if(token===seriesSequence&&req===seasonRequest)el('episode-status').textContent='Não foi possível carregar os episódios.';}finally{clearTimeout(timer);}}
 function closeSeries(){++seriesSequence;seasonRequest?.abort();el('series-dialog').close();}
 function paintTop(d){renderizar(d.items,'row-top',true);el('top-updated').textContent='Consultado às '+new Date(d.checkedAt).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})+' · Atualização a cada 30 minutos';}
 async function refreshTop(){if(topBusy)return;topBusy=true;try{const d=await get('/api/top-br');lastTop=Date.now();if(el('player').classList.contains('ativo'))topDeferred=d;else paintTop(d);}catch{el('top-updated').textContent='Atualização indisponível. Nova tentativa em 30 minutos.';}finally{topBusy=false;}}
 el('genre-filter').append(new Option('Todas',''));
 el('genre-filter').onchange=()=>{genre=el('genre-filter').value;query='';el('q').value='';page=1;load();};
 el('library-prev').onclick=()=>{if(page>1){--page;load();}};el('library-next').onclick=()=>{if(page<pages){++page;load();}};
 el('season-select').onchange=loadSeason;el('series-close').onclick=closeSeries;el('series-dialog').addEventListener('cancel',e=>{e.preventDefault();closeSeries();});
 setInterval(refreshTop,30*60*1000);document.addEventListener('visibilitychange',()=>{if(!document.hidden&&Date.now()-lastTop>=30*60*1000)refreshTop();});
 setInterval(()=>{if(topDeferred&&!el('player').classList.contains('ativo')){paintTop(topDeferred);topDeferred=null;}},2000);
 refreshTop();
// Aba Favoritos: só o que o usuário guardou, sem depender de servidor.
 function favorites(){
  if(el('anime-types'))el('anime-types').hidden=true;
  if(el('library-note'))el('library-note').textContent='';
  kind='favoritos';page=1;pages=1;query='';genre='';el('q').value='';
  el('genre-filter').replaceChildren(new Option('Todos',''));
  results();el('library-filters').hidden=true;el('resultados-titulo').textContent='Favoritos';
  el('library-page').textContent='';el('library-page-bottom').textContent='';
  ['library-prev','library-next','library-prev-bottom','library-next-bottom'].forEach(id=>{if(el(id))el(id).disabled=true;});
  document.querySelectorAll('.page-controls').forEach(x=>{x.hidden=true;});
  const lista=(window.StreamPersonal?.favorites?.()||[]).map(f=>({...f,tipo:f.tipo||'movie'}));
  if(!lista.length){el('grid').replaceChildren();const aviso=document.createElement('p');aviso.className='msg';aviso.textContent='Você ainda não guardou nada aqui. Toque na ☆ de um filme ou de uma série para ele aparecer nesta aba.';el('grid').append(aviso);return;}
  renderizar(lista);
 }
 return {reabrir,open,browse,search,home,closeSeries,favorites};
})();
// One inactivity clock controls both the title bar and bottom controls, including TV key events.
window.StreamChrome=(()=>{
 let timer;
 function wake(){clearTimeout(timer);const player=el('player');player.classList.remove('chrome-hidden');if(!player.classList.contains('ativo'))return;
  timer=setTimeout(()=>{if(!el('opcoes').hidden||el('loading').classList.contains('vis'))return;const v=el('direct-video');if(v&&v.paused)return;const focused=document.activeElement;if(focused?.closest('.barra')||focused?.closest('.player-top')||focused?.closest('#direct-controls')||focused?.closest('.player-tools')){(v||el('frame')).focus();}player.classList.add('chrome-hidden');},5000);
 }
 for(const name of ['pointermove','pointerdown','keydown'])document.addEventListener(name,wake,true);
 document.addEventListener('focusin',()=>{if(document.activeElement?.closest('.barra')||document.activeElement?.closest('.player-top')||document.activeElement?.closest('#direct-controls')||document.activeElement?.closest('.player-tools')||!el('opcoes').hidden)wake();});
 let wasActive=false;new MutationObserver(()=>{const active=el('player').classList.contains('ativo');if(active!==wasActive){wasActive=active;wake();}}).observe(el('player'),{attributes:true,attributeFilter:['class']});
 new MutationObserver(wake).observe(el('loading'),{attributes:true,attributeFilter:['class']});
 new MutationObserver(wake).observe(el('opcoes'),{attributes:true,attributeFilter:['hidden']});
 return {wake};
})();
