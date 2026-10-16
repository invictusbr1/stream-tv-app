(function(root){
 'use strict';
 function enderecoBlogger(value){
  try{const u=new URL(String(value||''));return u.protocol==='https:'&&u.hostname==='www.blogger.com'&&!u.port&&!u.username&&!u.password&&!u.hash&&u.pathname==='/video.g'&&[...u.searchParams.keys()].length===1&&/^[A-Za-z0-9_-]{20,2048}$/.test(u.searchParams.get('token')||'')?u.href:null;}catch{return null;}
 }
 function enderecoDireto(value){
  try{const u=new URL(String(value||''));return u.protocol==='https:'&&u.hostname==='meusanimes.blog.alibabacdn.net'&&!u.port&&!u.username&&!u.password&&!u.hash&&/^\/video\/[a-zA-Z0-9/_-]+\.[a-zA-Z0-9._-]*mp4$/.test(u.pathname)&&/^[a-f0-9]{64}$/.test(u.searchParams.get('X-Amz-Signature')||'')?u.href:null;}catch{return null;}
 }
 function criar(host){
  let geracao=0,frame=null,timer=null,removerAbort=null,estado=null,sessao=null;
  const get=id=>host.document.getElementById(id);
  function preferencia(){try{return host.localStorage.getItem('streamtv-anime-audio')==='dublado'?'dublado':'legendado';}catch{return 'legendado';}}
  function escolher(audio){if(!['legendado','dublado'].includes(audio))return false;try{host.localStorage.setItem('streamtv-anime-audio',audio);}catch{}return true;}
  function parar(resultado='fechou'){
   ++geracao;host.clearTimeout(timer);timer=null;removerAbort?.();removerAbort=null;
   sessao?.encerrar?.(resultado,0);sessao=null;
   if(frame){frame.onload=null;frame.onerror=null;if(get('frame')===frame)frame.src='about:blank';}
   frame=null;estado=null;
  }
  async function abrir(opcoes){
   if(opcoes.episode?.anime!==true||opcoes.audio!=='legendado')return false;
   parar('trocou');const minhaGeracao=geracao;
   const valido=()=>minhaGeracao===geracao&&!opcoes.signal?.aborted&&opcoes.valido();
   const query=new URLSearchParams({id:String(opcoes.id),temporada:String(opcoes.episode.season),episodio:String(opcoes.episode.number),audio:'legendado'});
   let dados;
   try{dados=await opcoes.request('/api/anime-player?'+query,opcoes.signal);}catch{return false;}
   if(!valido())return false;
   if(dados?.tipo==='file'){
    const url=enderecoDireto(dados.url);
    if(!dados.ok||dados.fonteId!=='proplayer-legendado'||Number(dados.tmdbId)!==Number(opcoes.id)||dados.anime!==true||dados.semAnuncio!==true||dados.audio!=='original'||dados.legendaPortugues!==true||dados.legendaEmbutida!==true||Number(dados.episode?.season)!==Number(opcoes.episode.season)||Number(dados.episode?.number)!==Number(opcoes.episode.number)||!url||!Number.isInteger(opcoes.version)||!host.StreamPlayback?.start)return false;
    const tocou=await host.StreamPlayback.start(opcoes.id,opcoes.version,opcoes.signal,undefined,url,true,{id:'proplayer-legendado',nome:'PROPLAYER · legendado',tipo:'file',audioInformado:'Legendado · português'},opcoes.playbackOptions);
    if(!valido()||!tocou)return false;
    opcoes.onLoad?.();return true;
   }
   const endereco=enderecoBlogger(dados?.url);
   if(!dados?.ok||dados.tipo!=='embed'||dados.anime!==true||dados.fonteId!=='meus-animes'||dados.audio!=='original'||dados.legendaPortugues!==true||dados.legendaEmbutida!==true||Number(dados.episode?.season)!==Number(opcoes.episode.season)||Number(dados.episode?.number)!==Number(opcoes.episode.number)||!endereco)return false;
   const anterior=get('frame');if(!anterior)return false;
   frame=anterior.cloneNode(false);const atual=frame;
   atual.hidden=false;atual.setAttribute('sandbox','allow-scripts allow-same-origin allow-presentation');
   atual.setAttribute('allow','autoplay; encrypted-media; picture-in-picture; fullscreen');
   atual.setAttribute('allowfullscreen','');atual.setAttribute('title','Anime legendado');atual.setAttribute('tabindex','0');
   const ativo=()=>valido()&&frame===atual&&get('frame')===atual;
   estado={audio:'Legendado',legendaEmbutida:true,fonte:'Meus Animes · legendado',fonteId:'meus-animes',resolucao:''};
   sessao=opcoes.sessao||null;sessao?.iniciar?.({fonte:estado.fonte,fonteId:estado.fonteId,audio:estado.audio});
   let falhou=false;
   const erro=()=>{if(!ativo()||falhou)return;falhou=true;host.clearTimeout(timer);timer=null;sessao?.falha?.('o player do anime não carregou',0);opcoes.onError?.();};
   atual.onload=()=>{if(!ativo()||falhou)return;host.clearTimeout(timer);timer=null;opcoes.onLoad?.(estado);};
   atual.onerror=erro;
   const abortar=()=>{if(minhaGeracao===geracao)parar('fechou');};
   if(opcoes.signal){opcoes.signal.addEventListener('abort',abortar,{once:true});removerAbort=()=>opcoes.signal.removeEventListener('abort',abortar);}
   timer=host.setTimeout(erro,18000);
   atual.src=endereco;anterior.replaceWith(atual);
   // O carregamento do iframe apenas mostra o player. Não comprova primeira
   // imagem, resolução ou posição, e não pode marcar o episódio como assistido.
   return true;
  }
  return{abrir,parar,preferencia,escolher,isActive:()=>Boolean(frame),estado:()=>estado?{...estado}:null};
 }
 if(typeof module!=='undefined'&&module.exports)module.exports={criar,enderecoBlogger,enderecoDireto};
 if(root?.document)root.StreamAnimePlayer=criar(root);
})(typeof window!=='undefined'?window:globalThis);
