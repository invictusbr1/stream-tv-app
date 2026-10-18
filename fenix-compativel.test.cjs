const test=require('node:test'),assert=require('node:assert/strict');
const {criar,candidatos,escolher}=require('./fenix-compativel');
const stream=(n,title='Dublado')=>({url:`https://fenixflix.fenixhub.online/${n}/video.mp4`,title,name:n});
const medida=(codec='h264',w=1920,h=1080,idioma='por',pixels='yuv420p')=>({imagem:{codec,largura:w,altura:h,pixels},faixas:[{idioma,padrao:true,codec:'aac'}]});
test('anúncio HTTP do host aprovado é elevado a HTTPS sem aceitar outros hosts ou portas',()=>{
 const x=stream('ok');assert.equal(candidatos([{...x,url:x.url.replace('https:','http:')}])[0].url,x.url);
 assert.equal(candidatos([{...x,url:'http://fenixflix.fenixhub.online:8080/video.mp4'},{...x,url:'http://outro.example/video.mp4'}]).length,0);
});
test('só usa arquivos do fornecedor aprovado, dublados e sem páginas externas',()=>{
 const good=stream('ok');assert.deepEqual(candidatos([good,stream('en','Legendado'),{...good,url:'https://localhost/video.mp4'},{...good,url:'https://outro.example/video.mp4'},{...good,url:'https://fenixflix.fenixhub.online/embed.html'},{...good,url:'https://user:secret@fenixflix.fenixhub.online/video.mp4'}]),[good]);
});
test('4K HEVC e áudio original não vencem Full HD H264 com AAC português',()=>{
 const a={stream:stream('4k'),medida:medida('hevc',3840,2160,'por','yuv420p10le')};
 const b={stream:stream('1080'),medida:medida()};
 const c={stream:stream('ingles'),medida:medida('h264',3840,2160,'eng')};
 assert.equal(escolher([a,b,c]),b);
 assert.equal(escolher([{...b,medida:medida('h264',1920,1080,'und')}]),null);
});
test('não limita a Full HD se houver 4K compatível, e recusa H264 de dez bits',()=>{
 const a={stream:stream('4k'),medida:medida('h264',3840,2160)};
 assert.equal(escolher([{stream:stream('1080'),medida:medida()},a]),a);
 assert.equal(escolher([{...a,medida:medida('h264',3840,2160,'por','yuv420p10le')}]),null);
});
test('cache de compatibilidade é separado por episódio e renova após cinco minutos',async()=>{
 let now=0,calls=0;const resolver=criar({agora:()=>now,imdbDe:async()=> 'tt29355505',buscar:async()=>{calls++;return {streams:[stream('ok')]};},medir:async()=>medida()});
 const alvo={tipo:'tv',tmdbId:1405,temporada:1,episodio:1};
 assert.equal((await resolver(alvo)).resolucao,'1080p');await resolver(alvo);assert.equal(calls,1);
 await resolver({...alvo,episodio:2});assert.equal(calls,2);now=300001;await resolver(alvo);assert.equal(calls,3);
});
test('fonte indisponível ou formato sem comprovação não retorna um falso compatível',async()=>{
 const resolver=criar({imdbDe:async()=> 'tt29355505',buscar:async()=>({streams:[stream('ok')]}),medir:async()=>null});
 assert.equal(await resolver({tipo:'movie',tmdbId:1084244}),null);
 assert.equal(await resolver({tipo:'movie',tmdbId:'../1'}),null);
});
test('recupera AVC português verificado fora da lista mesmo com falha do índice, sem aceitar HEVC ou áudio original',async()=>{
 for(const fails of [false,true]){
  const old=stream('old');let probes=0;
  const resolver=criar({imdbDe:async()=> 'tt22084616',buscar:async()=>{if(fails)throw Error('índice indisponível');return {streams:[]};},lembradas:()=>[{dados:{url:old.url}}],medir:async()=>{probes++;return medida('h264',1920,800);}});
  assert.equal((await resolver({tipo:'movie',tmdbId:969681})).url,old.url);assert.equal(probes,1);
 }
 const resolver=criar({imdbDe:async()=> 'tt22084616',buscar:async()=>({streams:[]}),lembradas:()=>[{dados:{url:stream('old').url}}],medir:async()=>medida('hevc',3832,1600,'por','yuv420p10le')});
 assert.equal(await resolver({tipo:'movie',tmdbId:969681}),null);
});
