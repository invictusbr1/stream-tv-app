const {test}=require('node:test'),assert=require('node:assert/strict');
const {criar,enderecoBlogger}=require('./anime-player');
const embed='https://www.blogger.com/video.g?token=publico_de_teste_1234567890';
function setup(){
 let frame=node(),sequence=0;const timers=new Map(),store=new Map(),events=[];
 function node(){return{src:'about:blank',hidden:true,setAttribute(k,v){this[k]=v},cloneNode(){return node()},replaceWith(n){frame=n}}}
 const host={document:{getElementById:()=>frame},localStorage:{getItem:k=>store.get(k),setItem:(k,v)=>store.set(k,v)},setTimeout:(fn,ms)=>{timers.set(++sequence,{fn,ms});return sequence},clearTimeout:id=>timers.delete(id)};
 const player=criar(host),controller=new AbortController();
 const good={ok:true,tipo:'embed',anime:true,fonteId:'meus-animes',audio:'original',legendaPortugues:true,legendaEmbutida:true,url:embed,episode:{season:1,number:1}};
 const options={id:37854,episode:{anime:true,season:1,number:1},audio:'legendado',signal:controller.signal,valido:()=>true,request:async()=>good,onLoad:()=>events.push('load'),onError:()=>events.push('error'),sessao:{iniciar:()=>events.push('tentativa'),imagem:()=>events.push('imagem'),encerrar:()=>events.push('fim'),falha:()=>events.push('falha')}};
 return{player,options,good,controller,timers,events,host,frame:()=>frame};
}
test('abre somente o embed Blogger do episódio solicitado, mantendo sandbox sem popups',async()=>{
 const s=setup();assert.equal(await s.player.abrir(s.options),true);assert.equal(s.frame().src,embed);assert.match(s.frame().sandbox,/allow-scripts/);assert.doesNotMatch(s.frame().sandbox,/allow-popups|allow-top-navigation/);s.frame().onload();assert.deepEqual(s.events,['tentativa','load']);assert.equal(s.player.estado().resolucao,'');assert.equal(s.timers.size,0);
});
test('filmes, séries comuns e dublado não consultam fornecedor de anime legendado',async()=>{
 for(const change of [{episode:null},{episode:{season:1,number:1}},{audio:'dublado'}]){const s=setup();let queries=0;s.options.request=async()=>{queries++;return s.good};assert.equal(await s.player.abrir({...s.options,...change}),false);assert.equal(queries,0);}
});
test('recusa origem/caminho/credencial/dados de episódio ou idioma inesperados',async()=>{
 for(const change of [{url:'https://evil.example/video.g?token=publico_de_teste_1234567890'},{episode:{season:1,number:2}},{fonteId:'qualquer'},{audio:'pt-BR'},{legendaPortugues:false},{legendaEmbutida:false},{tipo:'file'},{anime:false}]){const s=setup();s.options.request=async()=>({...s.good,...change});assert.equal(await s.player.abrir(s.options),false);assert.equal(s.frame().src,'about:blank');}
 for(const bad of ['javascript:alert(1)','http://www.blogger.com/video.g?token=publico_de_teste_1234567890','https://www.blogger.com:9443/video.g?token=publico_de_teste_1234567890','https://user:senha@www.blogger.com/video.g?token=publico_de_teste_1234567890',embed+'&redirect=evil',embed+'#x',embed.replace('/video.g','/outro')])assert.equal(enderecoBlogger(bad),null);
});
test('fechar durante a resolução impede resposta atrasada de abrir vídeo',async()=>{
 const s=setup();let resolve;s.options.request=()=>new Promise(r=>resolve=r);const pending=s.player.abrir(s.options);s.player.parar();resolve(s.good);assert.equal(await pending,false);assert.equal(s.frame().src,'about:blank');assert.equal(s.player.isActive(),false);
});
test('abortar limpa o iframe, timer e eventos antigos sem declarar reprodução',async()=>{
 const s=setup();await s.player.abrir(s.options);const load=s.frame().onload;s.controller.abort();load();assert.equal(s.frame().src,'about:blank');assert.equal(s.player.isActive(),false);assert.equal(s.timers.size,0);assert(!s.events.includes('load'));assert(!s.events.includes('imagem'));
});
test('carregamento expira uma vez e a preferência de anime persiste sem afetar fontes gerais',async()=>{
 const s=setup();assert.equal(s.player.preferencia(),'legendado');assert.equal(s.player.escolher('dublado'),true);assert.equal(s.player.preferencia(),'dublado');assert.equal(s.player.escolher('qualquer'),false);await s.player.abrir(s.options);[...s.timers.values()][0].fn();assert.deepEqual(s.events,['tentativa','falha','error']);assert.equal(s.timers.size,0);
});

test('MP4 validado usa somente o player nativo sem abrir iframe ou scripts externos',async()=>{
 const s=setup(),calls=[];const url='https://meusanimes.blog.alibabacdn.net/video/a/video.mp4?X-Amz-Signature='+'a'.repeat(64);
 s.options.version=7;s.options.playbackOptions={posicao:12};s.options.request=async()=>({...s.good,tipo:'file',url,tmdbId:37854,fonteId:'proplayer-legendado',semAnuncio:true});
 s.host.StreamPlayback={start:async(...args)=>{calls.push(args);return true;}};
 assert.equal(await s.player.abrir(s.options),true);assert.equal(s.frame().src,'about:blank');assert.equal(calls.length,1);assert.equal(calls[0][4],url);assert.equal(calls[0][1],7);assert.deepEqual(calls[0][7],{posicao:12});assert.equal(s.player.isActive(),false);
});

test('mídia direta recusa publicidade, outro título, outro episódio e URL de página',async()=>{
 const url='https://meusanimes.blog.alibabacdn.net/video/a/video.mp4?X-Amz-Signature='+'a'.repeat(64);
 for(const extra of[{semAnuncio:false},{tmdbId:99},{episode:{season:1,number:2}},{url:'https://assistiranimesonline.net/'},{legendaEmbutida:false}]){
  const s=setup();s.options.version=1;s.options.request=async()=>({...s.good,tipo:'file',url,tmdbId:37854,fonteId:'proplayer-legendado',semAnuncio:true,...extra});s.host.StreamPlayback={start:async()=>{throw Error('não pode tocar');}};
  assert.equal(await s.player.abrir(s.options),false);assert.equal(s.frame().src,'about:blank');
 }
});
