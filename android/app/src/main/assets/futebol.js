(function(root){
 'use strict';
 // Todos os principais campeonatos que acontecem simultaneamente no Brasil,
 // América do Sul, Europa e Seleções.
 const leagues={
  'bra.1':'Brasileirão Série A',
  'bra.2':'Brasileirão Série B',
  'bra.copa_do_brazil':'Copa do Brasil',
  'conmebol.libertadores':'CONMEBOL Libertadores',
  'conmebol.sudamericana':'CONMEBOL Sul-Americana',
  'uefa.champions':'UEFA Champions League',
  'uefa.europa':'UEFA Europa League',
  'eng.1':'Premier League',
  'esp.1':'LaLiga',
  'ita.1':'Serie A Italiana',
  'ger.1':'Bundesliga',
  'fra.1':'Ligue 1',
  'por.1':'Liga Portugal',
  'arg.1':'Campeonato Argentino',
  'usa.1':'MLS',
  'fifa.world':'Copa do Mundo',
  'fifa.worldq.conmebol':'Eliminatórias da Copa',
  'fifa.friendly':'Amistosos de Seleções'
 };
 const gruposCampeonatos=[
  {id:'brasil',nome:'Brasil e América do Sul',ligas:['bra.1','bra.2','bra.copa_do_brazil','conmebol.libertadores','conmebol.sudamericana','arg.1']},
  {id:'europa',nome:'Europa',ligas:['uefa.champions','uefa.europa','eng.1','esp.1','ita.1','ger.1','fra.1','por.1']},
  {id:'mundo',nome:'Seleções e Mundo',ligas:['fifa.world','fifa.worldq.conmebol','fifa.friendly','usa.1']}
 ];
 function validDate(date){if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return false;const d=new Date(date+'T12:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===date;}
 function logo(value){try{const u=new URL(value);return u.protocol==='https:'&&/(^|\.)espncdn\.com$/.test(u.hostname)?u.href:'';}catch{return '';}}
 function liveGames(games){return games.filter(g=>g.state==='in');}
 function scheduledGames(games){return games.filter(g=>g.state==='pre');}
 function finishedGames(games){return games.filter(g=>g.state==='post');}
 function groupByLeague(games){
  const map=new Map();
  for(const g of (Array.isArray(games)?games:[])){
   if(!g||!g.league)continue;
   if(!map.has(g.league))map.set(g.league,{league:g.league,name:g.name||leagues[g.league]||g.league,games:[]});
   map.get(g.league).games.push(g);
  }
  const order=Object.keys(leagues);
  return [...map.values()].sort((a,b)=>{
   const aLive=a.games.some(x=>x.state==='in')?0:1;
   const bLive=b.games.some(x=>x.state==='in')?0:1;
   if(aLive!==bLive)return aLive-bLive;
   return order.indexOf(a.league)-order.indexOf(b.league);
  });
 }
 function normalize(data,league){
  if(!Array.isArray(data?.events))throw Error('Programação indisponível');
  return data.events.map(event=>{const c=event.competitions?.[0];if(!c)return null;const home=c.competitors?.find(t=>t.homeAway==='home'),away=c.competitors?.find(t=>t.homeAway==='away');if(!home?.team||!away?.team||!Number.isFinite(Date.parse(event.date)))return null;const type=(c.status||event.status)?.type||{};const channels=(c.geoBroadcasts||[]).filter(b=>String(b.region||'').toLowerCase()==='br').map(b=>b.media?.shortName).filter(Boolean);return {id:String(event.id),league,name:leagues[league],date:event.date,home:home.team.shortDisplayName||home.team.displayName,away:away.team.shortDisplayName||away.team.displayName,homeLogo:logo(home.team.logo),awayLogo:logo(away.team.logo),state:type.state||'pre',status:type.detail||'',channels:[...new Set(channels)]};}).filter(Boolean).sort((a,b)=>Date.parse(a.date)-Date.parse(b.date));
 }
 function channelName(value){return String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\b(hd|sd|fhd|uhd|brasil|brazil)\b/g,'').replace(/[^a-z0-9]/g,'');}
 function sportChannels(list){return (Array.isArray(list)?list:[]).filter(c=>c&&typeof c.nome==='string'&&typeof c.url==='string'&&/^https:\/\//.test(c.url)&&(/sports|esportes/.test(c.grupo||'')||/espn|premiere|sportv|caze|xsports|bandsports|fifa|goat|nosso futebol|combate/i.test(c.nome)));}
 function matchingChannels(game,list){const names=(game.channels||[]).map(channelName).filter(Boolean);return sportChannels(list).filter(c=>names.includes(channelName(c.nome)));}
 const api={leagues,gruposCampeonatos,validDate,normalize,liveGames,scheduledGames,finishedGames,groupByLeague,channelName,sportChannels,matchingChannels};if(typeof module!=='undefined'&&module.exports)module.exports=api;
 if(!root.document)return;
 const el=id=>root.document.getElementById(id);let sequence=0,timer=null,games=[],failed=[],updated='',channels=[],channelsLoaded=false,channelRequest=null,selectedLeague='todas',selectedMode='auto';
 function today(){return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}
 function formatTime(iso){try{return new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',hour:'2-digit',minute:'2-digit'}).format(new Date(iso));}catch{return '';}}
 function text(tag,value,cls){const n=document.createElement(tag);n.textContent=value;if(cls)n.className=cls;return n;}
 function badge(name,url){const wrap=document.createElement('div');wrap.className='futebol-time';if(url){const img=document.createElement('img');img.src=url;img.alt='';img.loading='lazy';img.onerror=()=>img.remove();wrap.append(img);}wrap.append(text('span',name));return wrap;}
 function renderFilters(){
  const bar=el('futebol-campeonatos');if(!bar)return;
  bar.replaceChildren();
  const byLeague=groupByLeague(games);
  const liveCount=liveGames(games).length;
  const preCount=scheduledGames(games).length;
  const postCount=finishedGames(games).length;
  const modes=[
   ['auto',liveCount?`● Ao vivo agora (${liveCount})`:`Jogos de hoje (${games.length})`],
   ['todos',`Todos do dia (${games.length})`],
   ...(liveCount&&preCount?[['pre',`Próximos (${preCount})`]]:[]),
   ...(postCount?[['post',`Encerrados (${postCount})`]]:[])
  ];
  const modeWrap=document.createElement('div');modeWrap.className='futebol-filtros-linha';
  for(const [id,label] of modes){
   const b=text('button',label,'tv-cat');b.type='button';
   if(selectedMode===id)b.setAttribute('data-ativo','');
   b.onclick=()=>{selectedMode=id;render();};
   modeWrap.append(b);
  }
  bar.append(modeWrap);
  const leagueWrap=document.createElement('div');leagueWrap.className='futebol-filtros-linha';
  const allBtn=text('button',`🏆 Todos os campeonatos (${byLeague.length})`,'tv-cat');allBtn.type='button';
  if(selectedLeague==='todas')allBtn.setAttribute('data-ativo','');
  allBtn.onclick=()=>{selectedLeague='todas';render();};
  leagueWrap.append(allBtn);
  for(const group of byLeague){
   const hasLive=group.games.some(x=>x.state==='in');
   const label=(hasLive?'● ':'')+group.name+' ('+group.games.length+')';
   const b=text('button',label,'tv-cat');b.type='button';
   if(selectedLeague===group.league)b.setAttribute('data-ativo','');
   b.onclick=()=>{selectedLeague=group.league;render();};
   leagueWrap.append(b);
  }
  bar.append(leagueWrap);
 }
 function makeCard(g){
  const card=document.createElement('article');card.className='futebol-card';
  const art=document.createElement('div');art.className='futebol-confronto';
  art.append(badge(g.home,g.homeLogo),text('span','×','futebol-versus'),badge(g.away,g.awayLogo));
  const content=document.createElement('div');content.className='futebol-card-body';
  const hora=formatTime(g.date);
  const selo=g.state==='in'
   ? '● AO VIVO · '+g.name+(g.status?' · '+g.status:'')
   : g.state==='pre'
   ? '⏰ HOJE'+(hora?' ÀS '+hora:'')+' · '+g.name
   : 'ENCERRADO · '+g.name;
  content.append(text('p',selo,g.state==='in'?'futebol-live':'futebol-liga'),text('h3',g.home+' × '+g.away));
  if(g.channels&&g.channels.length){
   content.append(text('p','📺 Na TV/Streaming (BR): '+g.channels.join(', '),'futebol-fonte-label'));
  }
  const matches=matchingChannels(g,channels);
  content.append(text('p',matches.length?'Canal informado na programação. Disponibilidade depende da transmissão.':'Partida informada pela ESPN. Transmissão neste app não confirmada.','futebol-fonte-label'));
  for(const c of matches){const b=text('button','▶ '+c.nome,'tv-cat');b.onclick=()=>root.tocarCanal(c);content.append(b);}
  const choose=text('button','Ver canais de futebol','tv-cat');choose.onclick=()=>sources(g);content.append(choose);
  card.append(art,content);
  return card;
 }
 function render(){
  renderFilters();
  const live=liveGames(games);
  let base=games;
  if(selectedMode==='auto')base=live.length?live:games.filter(g=>g.state==='pre')||games;
  else if(selectedMode==='pre')base=scheduledGames(games);
  else if(selectedMode==='post')base=finishedGames(games);
  if(selectedMode==='auto'&&!base.length)base=games;
  if(selectedLeague!=='todas')base=base.filter(g=>g.league===selectedLeague);
  const grid=el('futebol-jogos');grid.replaceChildren();
  const hasLeagueBar=Boolean(el('futebol-campeonatos'));
  if(!hasLeagueBar){
   base.forEach(g=>grid.append(makeCard(g)));
  }else{
   const groups=groupByLeague(base);
   for(const group of groups){
    const sec=document.createElement('div');sec.className='futebol-campeonato-bloco';
    const head=document.createElement('div');head.className='futebol-campeonato-topo';
    const liveInGroup=group.games.filter(x=>x.state==='in').length;
    head.append(text('h4','🏆 '+group.name),text('span',liveInGroup?liveInGroup+' ao vivo · '+group.games.length+' jogo(s) hoje':group.games.length+' jogo(s) hoje','futebol-fonte-label'));
    const subGrid=document.createElement('div');subGrid.className='futebol-grid';
    group.games.forEach(g=>subGrid.append(makeCard(g)));
    sec.append(head,subGrid);
    grid.append(sec);
   }
  }
  if(!base.length){
   grid.append(text('p',failed.length&&!games.length?'Não foi possível consultar todos os jogos ao vivo. Tente atualizar.':'Nenhum jogo ao vivo informado agora nestes campeonatos. Você pode abrir o canal em destaque.','msg'));
  }
  const activeNames=[...new Set(games.map(g=>g.name).filter(Boolean))];
  el('futebol-status').textContent=failed.length&&!games.length
   ? 'Algumas consultas estão indisponíveis.'
   : activeNames.length
   ? 'Campeonatos hoje: '+activeNames.join(' · ')+(updated?' (atualizado às '+updated+')':'')
   : 'Brasileirão · Copa do Brasil · Libertadores · Champions · Premier League · LaLiga e mais';
 }
 async function loadChannels(){if(channelsLoaded)return;if(channelRequest)return channelRequest;channelRequest=(async()=>{try{const [br,esp]=await Promise.all([root.lerJson('/api/tv/canais?lista=brasil',root.timeoutSignal(25000)).catch(()=>({canais:[]})),root.lerJson('/api/tv/canais?lista=esportes',root.timeoutSignal(25000)).catch(()=>({canais:[]}))]);const lista=[...(Array.isArray(br?.canais)?br.canais:[]),...(Array.isArray(esp?.canais)?esp.canais:[]).filter(c=>/brasil|portug|sportv|premiere|espn|caze|bandsports|xsports|goat|fifa/i.test(c.nome))];if(!lista.length&&!Array.isArray(br?.canais))throw Error('Lista indisponível');const vistos=new Set();channels=sportChannels(lista).filter(c=>{if(vistos.has(c.url))return false;vistos.add(c.url);return true;});channelsLoaded=true;render();}finally{channelRequest=null;}})();return channelRequest;}
 async function sources(game){el('futebol-fontes-titulo').textContent=game?game.home+' × '+game.away+' · Canais de futebol':'Canais de futebol';el('futebol-fontes-nota').textContent='Escolha um canal. Cada um segue sua própria programação; abrir um canal não confirma que ele transmite esta partida.';const panel=el('futebol-fontes-panel');panel.hidden=false;panel.scrollIntoView({block:'center',behavior:'smooth'});let list=el('futebol-canais-lista');if(!list){list=document.createElement('div');list.id='futebol-canais-lista';list.className='futebol-fontes';panel.append(list);}list.replaceChildren(text('p','Consultando canais disponíveis…','futebol-fonte-label'));try{await loadChannels();list.replaceChildren();for(const c of channels){const b=text('button','▶ '+c.nome,'tv-cat');b.onclick=()=>root.tocarCanal(c);list.append(b);}if(!channels.length)list.append(text('p','A lista brasileira não informou outros canais de esportes agora. Use as opções abaixo ou tente novamente.','futebol-fonte-label'));}catch{list.replaceChildren(text('p','Não foi possível consultar os outros canais agora. Você pode tentar novamente ou usar as opções abaixo.','futebol-fonte-label'));}panel.querySelector('button')?.focus();}
 async function load(customDate){const date=customDate&&validDate(customDate)?customDate:today();if(!validDate(date)){el('futebol-status').textContent='Escolha uma data válida.';return;}const version=++sequence;el('futebol-status').textContent='Consultando jogos de '+Object.keys(leagues).length+' campeonatos…';el('futebol-jogos').replaceChildren();const results=await Promise.allSettled(Object.keys(leagues).map(async league=>normalize(await root.lerJson('/api/futebol/agenda?liga='+league+'&data='+date,root.timeoutSignal(25000)),league)));if(version!==sequence)return;games=[];failed=[];results.forEach((r,i)=>{if(r.status==='fulfilled')games.push(...r.value);else failed.push(Object.keys(leagues)[i]);});games.sort((a,b)=>Date.parse(a.date)-Date.parse(b.date));updated=new Intl.DateTimeFormat('pt-BR',{hour:'2-digit',minute:'2-digit',second:'2-digit'}).format(new Date());render();}
 function open(){el('futebol').hidden=false;for(const id of ['tv','hero','continuar-view'])if(el(id))el(id).hidden=true;el('catalogo')?.classList.add('oculto');el('resultados')?.classList.add('oculto');root.mostrarCabecalhoDoCatalogo?.(false);el('futebol').scrollIntoView({block:'start'});load();loadChannels().catch(()=>{});if(typeof root.abrirFutemaxLista==='function')root.abrirFutemaxLista().catch?.(()=>{});clearInterval(timer);timer=setInterval(()=>{if(!el('futebol').hidden&&!document.hidden&&!el('player')?.classList.contains('ativo'))load();},60000);}
 root.StreamFutebol={open,load,render,today,sources,loadChannels,setLeague:l=>{selectedLeague=l||'todas';render();},setMode:m=>{selectedMode=m||'auto';render();}};
})(typeof window==='undefined'?globalThis:window);

