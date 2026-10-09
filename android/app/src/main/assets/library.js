'use strict';
window.StreamLibrary=(()=>{
// reabre a série de onde o usuário saiu (usado pelo botão voltar)
 let kind='all',page=1,pages=1,genre='',query='',sequence=0,seriesSequence=0,selected=null,seasonRequest=null,lastTop=0,topBusy=false,topDeferred=null;
 const get=(url,signal)=>lerJson(url,signal||timeoutSignal(18000));
 function results(){if(el('continuar-view'))el('continuar-view').hidden=true;if(window.mostrarCabecalhoDoCatalogo)window.mostrarCabecalhoDoCatalogo(false);el('hero').hidden=true;el('catalogo').classList.add('oculto');el('resultados').classList.remove('oculto');el('library-filters').hidden=false;document.querySelectorAll('.page-controls').forEach(x=>{x.hidden=false;});}
 async function load(){const token=++sequence;results();el('grid').textContent='Carregando…';el('resultados-titulo').textContent=query?`Resultados para “${query}”`:kind==='video'?'Filmes e séries':kind==='tv'?'Séries':kind==='dorama'?'Doramas':kind==='short-drama'?'Mininovelas e dramas curtos':kind==='anime'?'Animes · séries':kind==='anime-film'?'Animes · filmes':'Filmes';try{const d=await get('/api/explore?'+new URLSearchParams({tipo:kind,page:String(page),genre,nome:query}));if(token!==sequence)return;pages=d.pages;renderizar(d.items);el('library-page').textContent=`Página ${page} de ${pages}`;el('library-page-bottom').textContent=el('library-page').textContent;el('library-prev').disabled=page<=1;el('library-next').disabled=page>=pages;el('library-prev-bottom').disabled=page<=1;el('library-next-bottom').disabled=page>=pages;el('resultados-titulo').scrollIntoView?.({block:'start'});}catch{if(token===sequence)el('grid').textContent='Não foi possível carregar. Tente novamente.';}}
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
async function open(f){if(f.tipo!=='tv')return abrirPlayer(f.id,f.titulo);selected=f;const token=++seriesSequence;el('series-title').textContent=f.titulo;abaSerie('episodios');selosDaSerie(f);const botaoAssistir=el('series-assistir');if(botaoAssistir)botaoAssistir.onclick=()=>{const b=el('episodes')?.querySelector('.episode-play-btn');if(b)b.click();};el('series-summary').textContent=f.sinopse||'';el('series-art').hidden=!(f.fundo||f.capa);if(f.fundo||f.capa)el('series-art').src=f.fundo||f.capa;el('series-meta').textContent=[f.ano,f.nota&&'★ '+f.nota].filter(Boolean).join(' · ');el('episodes').replaceChildren();el('season-select').replaceChildren();el('episode-status').textContent='Carregando temporadas…';atualizarFavoritoDaSerie(f);el('series-dialog').showModal();try{const d=await get('/api/tv/'+f.id);if(token!==seriesSequence)return;for(const s of d.seasons)el('season-select').append(new Option(s.name,s.number));if(!d.seasons.length){el('episode-status').textContent='Sem episódios cadastrados.';return;}const first=d.seasons.find(s=>s.number>0);if(first)el('season-select').value=String(first.number);loadSeason();}catch{if(token===seriesSequence)el('episode-status').textContent='Não foi possível carregar as temporadas.';}}
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
 async function loadSeason(){seasonRequest?.abort();seasonRequest=new AbortController();const req=seasonRequest,token=seriesSequence,f=selected,season=Number(el('season-select').value);el('episodes').replaceChildren();el('episode-status').textContent='Carregando episódios…';const timer=setTimeout(()=>req.abort(),18000);try{const d=await get(`/api/season/${f.id}/${season}`,req.signal);if(token!==seriesSequence||req!==seasonRequest)return;const contador=contadorDeEpisodios(f,season,d.episodes||[]);el('episode-status').textContent='Escolha um episódio para abrir o player.';for(const e of d.episodes){const linha=document.createElement('div');linha.className='episode-row';const b=document.createElement('button');b.className='episode-play-btn';b.setAttribute('aria-label',`Reproduzir episódio ${e.number}: ${e.name}`);if(e.image){const img=document.createElement('img');img.className='episode-art';img.src=e.image;img.alt='';img.loading='lazy';b.append(img);}const info=document.createElement('span');info.className='episode-info';const name=document.createElement('strong');name.textContent=`${e.number}. ${e.name}`;if(contador.vistos.has(Number(e.number))){const visto=document.createElement('em');visto.className='episode-watched';visto.textContent='Assistido';name.append(' ',visto);}info.append(name);if(e.date){const quando=new Date(e.date+'T00:00:00');const data=document.createElement('span');data.className='episode-data';data.textContent=quando.toLocaleDateString('pt-BR',{day:'numeric',month:'long',year:'numeric'});info.append(data);}const selos=document.createElement('span');selos.className='episode-selos';for(const texto of ['Dublado','HD','CC']){const s=document.createElement('span');s.className='episode-selo';s.textContent=texto;selos.append(s);}info.append(selos);const p=document.createElement('span');p.className='episode-sinopse';p.textContent=e.overview||'';const baixar=document.createElement('button');baixar.className='episode-baixar';baixar.type='button';baixar.title='Baixar episódio';baixar.setAttribute('aria-label','Baixar episódio '+e.number);baixar.textContent='⤓';baixar.onclick=ev=>{ev.stopPropagation();if(window.StreamBaixar)window.StreamBaixar(f,e,season);else alert('Para baixar, abra o episódio e use o menu do navegador.');};info.append(p);const play=document.createElement('span');play.className='episode-play';play.textContent=contador.proximo&&Number(contador.proximo.number)===Number(e.number)?'▶ Continuar':'▶';b.append(info,play);if(e.date&&e.date>new Date().toISOString().slice(0,10)){b.disabled=true;p.textContent='Ainda não lançado';}b.onclick=()=>{closeSeries();abrirPlayer(f.id,`${f.titulo} · T${season} E${e.number}`,{season,number:e.number});};
   const marcar=document.createElement('button');marcar.className='episode-check';const visto=contador.vistos.has(Number(e.number));marcar.setAttribute('aria-pressed',String(visto));marcar.setAttribute('aria-label',visto?`Desmarcar episódio ${e.number} como assistido`:`Marcar episódio ${e.number} como assistido`);marcar.title=visto?'Assistido (toque para desmarcar)':'Marcar como assistido';marcar.textContent=visto?'✓':'○';marcar.onclick=()=>{const personal=window.StreamPersonal;if(!personal?.markWatched)return;personal.markWatched({id:f.id,titulo:f.titulo,episode:{season,number:e.number}},!visto);loadSeason();};
   {linha.append(b,marcar);}if(p&&!linha.contains(p))linha.append(p);el('episodes').append(linha);}if(!d.episodes.length)el('episode-status').textContent='Sem episódios nesta temporada.';}catch{if(token===seriesSequence&&req===seasonRequest)el('episode-status').textContent='Não foi possível carregar os episódios.';}finally{clearTimeout(timer);}}
 // Abas Episódios / Detalhes da tela da série.
 function abaSerie(qual){const epis=el('aba-episodios'),det=el('aba-detalhes'),be=el('aba-episodios-btn'),bd=el('aba-detalhes-btn');if(!epis||!det)return;const verEpis=qual!=='detalhes';epis.hidden=!verEpis;det.hidden=verEpis;be?.classList.toggle('ativo',verEpis);bd?.classList.toggle('ativo',!verEpis);be?.setAttribute('aria-selected',String(verEpis));bd?.setAttribute('aria-selected',String(!verEpis));}
 // Selos da série (o que o aplicativo garante: dublado, HD e sem anúncio).
 function selosDaSerie(f){const alvo=el('series-selos');if(!alvo)return;alvo.replaceChildren();const lista=[f.nota>=8?'TOP 10':null,'Dublado','HD','Sem anúncio'].filter(Boolean);for(const t of lista){const s=document.createElement('span');s.className='serie-selo'+(t==='TOP 10'?' dourado':'');s.textContent=t;alvo.append(s);}}
 function closeSeries(){++seriesSequence;seasonRequest?.abort();el('series-dialog').close();}
 // Top 10 do dia (filmes e séries), com o nome dos streamings que têm o
 // título no Brasil. Fica guardado no aparelho e só é consultado uma vez por dia.
 function chaveDoDia(){return 'streamtv-alta-'+new Date().toISOString().slice(0,10);}
 function altaGuardada(){try{const v=JSON.parse(localStorage.getItem(chaveDoDia())||'null');return v&&v.filmes&&v.series?v:null;}catch{return null;}}
 function guardarAlta(dados){try{localStorage.setItem(chaveDoDia(),JSON.stringify(dados));const antigas=Object.keys(localStorage).filter(k=>k.startsWith('streamtv-alta-')&&k!==chaveDoDia());antigas.forEach(k=>localStorage.removeItem(k));}catch{}}
 function paintTop(d,tipo='movie'){
   const idFila=tipo==='tv'?'row-alta-series':'row-alta-filmes';
   const idNota=tipo==='tv'?'alta-series-nota':'alta-filmes-nota';
   if(!el(idFila))return;
   renderizar(d.items,idFila,true);
   const hora=new Date(d.checkedAt).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
   const atualizadoEm=d.checkedAt?String(d.checkedAt).slice(8,10)+'/'+String(d.checkedAt).slice(5,7):'';
   el(idNota).textContent=`Em alta hoje (${atualizadoEm}) · atualizado às ${hora} · toque para abrir. Atualiza sozinho todo dia.`;
 }
 // Se o ranking do dia falhar, as fileiras são montadas com o catálogo comum —
 // é melhor mostrar indicados do que mostrar vazio.
 async function rankingDeReserva(){
   try{
     const [filmes,series]=await Promise.allSettled([get('/api/top-br'),get('/api/explore?tipo=tv&page=1')]);
     const agora=new Date().toISOString();
     return {
       filmes: filmes.status==='fulfilled'?{items:(filmes.value.items||[]).slice(0,10),checkedAt:agora}:null,
       series: series.status==='fulfilled'?{items:(series.value.items||[]).slice(0,10),checkedAt:agora}:null
     };
   }catch{return {filmes:null,series:null};}
 }
 function paintAlta(dados){
   if(dados.filmes)paintTop(dados.filmes,'movie');
   else if(el('alta-filmes-nota'))el('alta-filmes-nota').textContent='Não foi possível buscar o ranking de filmes agora.';
   if(dados.series)paintTop(dados.series,'tv');
   else if(el('alta-series-nota'))el('alta-series-nota').textContent='Não foi possível buscar o ranking de séries agora.';
   montarDestaques((dados.filmes&&dados.filmes.items)||[],(dados.series&&dados.series.items)||[]);
 }
 // ---------------------------------------------------------------
 // Destaque grande da tela inicial, no estilo dos streamings: a arte do
 // título, o ano, o gênero, "Assistir agora", o "+" e as bolinhas que
 // trocam de título sozinhas.
 // ---------------------------------------------------------------
 let destaques=[],destaqueAtual=0,destaqueTimer=null;
 let tentativasAlta=0;
 function destaqueAtivo(){return destaques.length>0;}
 function atualizarBotaoDestaque(f){const b=el('hero-add');if(!b)return;const marcado=Boolean(window.StreamPersonal?.isFavorite?.(f.id));b.setAttribute('aria-pressed',String(marcado));b.textContent=marcado?'✓':'+';b.title=marcado?'Remover dos favoritos':'Guardar em Favoritos';}
 function mostrarDestaque(indice){
   if(!destaques.length)return;
   destaqueAtual=(indice+destaques.length)%destaques.length;
   const f=destaques[destaqueAtual];
   const imagem=el('hero-image');if(imagem){imagem.hidden=false;imagem.src=f.fundo||f.capa||'';}
   const arte=el('hero-logo');if(arte){if(f.logo){arte.hidden=false;arte.src=f.logo;arte.alt=f.titulo;}else{arte.hidden=true;arte.removeAttribute('src');}}
   const titulo=el('hero-title');titulo.hidden=Boolean(f.logo);titulo.textContent=f.titulo;
   el('hero-eyebrow').textContent=f.tipo==='tv'?'Série em alta hoje':'Filme em alta hoje';
   el('hero-meta').textContent=[f.ano,(f.generos||[]).join(' · '),f.nota&&f.nota!=='N/A'?`★ ${f.nota}`:''].filter(Boolean).join(' · ');
   el('hero-description').textContent=f.sinopse||'';
   const jogar=el('hero-play');jogar.hidden=false;jogar.onclick=()=>abrirPlayer(f.id,f.titulo);
   const add=el('hero-add');if(add){add.hidden=false;atualizarBotaoDestaque(f);add.onclick=()=>{const personal=window.StreamPersonal;if(!personal?.toggleFavorite)return;personal.toggleFavorite(f);atualizarBotaoDestaque(f);personal.renderFavoritos?.();};}
   const pontos=el('hero-dots');
   if(pontos)[...pontos.children].forEach((b,i)=>b.setAttribute('aria-current',String(i===destaqueAtual)));
   window.StreamPersonal?.remember(f);
 }
 function agendarDestaque(){clearTimeout(destaqueTimer);destaqueTimer=setTimeout(()=>{if(el('player').classList.contains('ativo')||document.hidden||el('hero').hidden)return agendarDestaque();mostrarDestaque(destaqueAtual+1);agendarDestaque();},7000);}
 function montarDestaques(filmes,series){
   const misturados=[];const limite=Math.max((filmes||[]).length,(series||[]).length);
   for(let i=0;i<limite&&misturados.length<6;i++){
     if((filmes||[])[i])misturados.push(filmes[i]);
     if((series||[])[i]&&misturados.length<6)misturados.push(series[i]);
   }
   destaques=misturados.filter(x=>x&&(x.fundo||x.capa));
   const pontos=el('hero-dots');
   if(!destaques.length){if(pontos)pontos.hidden=true;return;}
   if(pontos){
     pontos.replaceChildren();pontos.hidden=destaques.length<2;
     destaques.forEach((_,i)=>{const b=document.createElement('button');b.type='button';b.setAttribute('aria-label',`Destaque ${i+1} de ${destaques.length}`);b.onclick=()=>{mostrarDestaque(i);agendarDestaque();};pontos.append(b);});
   }
   mostrarDestaque(0);agendarDestaque();
 }
 function ligarArrasteDestaque(){
   const palco=el('hero');if(!palco||palco.__arrasteLigado)return;palco.__arrasteLigado=true;let inicioX=null;
   palco.addEventListener('pointerdown',e=>{if(e.target.closest('button'))return;inicioX=e.clientX;},{passive:true});
   palco.addEventListener('pointerup',e=>{if(inicioX===null)return;const d=e.clientX-inicioX;inicioX=null;if(Math.abs(d)<45)return;mostrarDestaque(destaqueAtual+(d<0?1:-1));agendarDestaque();},{passive:true});
 }
 async function refreshTop(){
   if(topBusy)return;topBusy=true;
   try{
     const guardado=altaGuardada();
     if(guardado&&!topDeferred){paintAlta(guardado);lastTop=Date.now();topBusy=false;return;}
     // Se uma das duas listas falhar, a outra continua aparecendo.
     const resposta=await Promise.allSettled([get('/api/alta?tipo=movie'),get('/api/alta?tipo=tv')]);
     const filmes=resposta[0].status==='fulfilled'?resposta[0].value:null;
     const series=resposta[1].status==='fulfilled'?resposta[1].value:null;
     if(!filmes&&!series)throw Error('sem ranking');
     const dados={filmes,series,pego:new Date().toISOString()};
     tentativasAlta=0;
     guardarAlta(dados);lastTop=Date.now();
     if(el('player').classList.contains('ativo'))topDeferred=dados;else paintAlta(dados);
   }catch{
     const guardado=altaGuardada();
     if(guardado)paintAlta(guardado);
     else{
       // Última reserva: monta as fileiras com o catálogo normal, para o
       // usuário nunca ficar sem os indicados.
       const reserva=await rankingDeReserva();
       if(reserva.filmes||reserva.series){guardarAlta(reserva);paintAlta(reserva);tentativasAlta=0;topBusy=false;return;}
       if(el('alta-filmes-nota'))el('alta-filmes-nota').textContent='Não foi possível buscar o ranking agora. Tentando de novo…';
       if(el('alta-series-nota'))el('alta-series-nota').textContent='Tentando novamente em instantes…';
       // Nova tentativa automática (até três), com espera crescente.
       tentativasAlta+=1;
       if(tentativasAlta<=3)setTimeout(()=>{if(!document.hidden)refreshTop();},15000*tentativasAlta);
     }
   }finally{topBusy=false;}
 }
 el('genre-filter').append(new Option('Todas',''));
 el('genre-filter').onchange=()=>{genre=el('genre-filter').value;query='';el('q').value='';page=1;load();};
 el('library-prev').onclick=()=>{if(page>1){--page;load();}};el('library-next').onclick=()=>{if(page<pages){++page;load();}};
 el('season-select').onchange=loadSeason;el('aba-episodios-btn')?.addEventListener('click',()=>abaSerie('episodios'));el('aba-detalhes-btn')?.addEventListener('click',()=>abaSerie('detalhes'));el('series-close').onclick=closeSeries;el('series-dialog').addEventListener('cancel',e=>{e.preventDefault();closeSeries();});
 // Uma vez por dia já basta: o ranking muda diariamente.
 setInterval(refreshTop,6*60*60*1000);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden&&Date.now()-lastTop>=6*60*60*1000)refreshTop();});
 setInterval(()=>{if(topDeferred&&!el('player').classList.contains('ativo')){paintAlta(topDeferred);topDeferred=null;}},2000);
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
 ligarArrasteDestaque();
 return {reabrir,open,browse,search,home,closeSeries,favorites,destaqueAtivo,mostrarDestaque};
})();
// One inactivity clock controls both the title bar and bottom controls, including TV key events.
window.StreamChrome=(()=>{
 let timer;
 function wake(){clearTimeout(timer);const player=el('player');player.classList.remove('chrome-hidden');if(!player.classList.contains('ativo'))return;
  timer=setTimeout(()=>{if(!el('opcoes').hidden||el('loading').classList.contains('vis'))return;const v=el('direct-video');if(v&&v.paused)return;const focused=document.activeElement;if(focused?.closest('.barra')||focused?.closest('.player-top')||focused?.closest('#direct-controls')||focused?.closest('.player-tools')){(v||el('frame')).focus();}player.classList.add('chrome-hidden');},5000);
 }
 for(const name of ['pointermove','pointerdown','keydown'])document.addEventListener(name,wake,true);
 document.addEventListener('focusin',()=>{if(document.activeElement?.closest('.barra')||document.activeElement?.closest('.player-top')||document.activeElement?.closest('#direct-controls')||document.activeElement?.closest('.player-tools')||!el('opcoes').hidden)wake();});
 let wasActive=false;new MutationObserver(()=>{const active=el('player').classList.contains('ativo');if(active!==wasActive){wasActive=active;document.body.classList.toggle('player-aberto',active);wake();}}).observe(el('player'),{attributes:true,attributeFilter:['class']});
 new MutationObserver(wake).observe(el('loading'),{attributes:true,attributeFilter:['class']});
 new MutationObserver(wake).observe(el('opcoes'),{attributes:true,attributeFilter:['hidden']});
 return {wake};
})();
