'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const c=require('./crystal-lake-source');
const hash='a'.repeat(32),asset='b'.repeat(32),now=1792176000000;
const settings=ep=>({fields:{imdb:`213562-1-${ep}`},advertising:[],popactive:false,poplimit:'0',popurl:'',p2p:false});
function packed(config){const words=Array(62).fill('');words[61]='FirePlayer';const body=`Z("${hash}",${JSON.stringify(config)},false,source)`;return `return p}('${body.replace(/\\/g,'\\\\').replace(/'/g,"\\'")}',62,62,'${words.join('|')}'.split('|')`;}
const master='#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",LANGUAGE="eng",DEFAULT=NO,URI="https://vaiquecol.com/hls/english"\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",LANGUAGE="por",DEFAULT=NO,URI="https://vaiquecol.com/hls/portuguese"\n#EXT-X-STREAM-INF:RESOLUTION=842x480,AUDIO="audio"\nhttps://vaiquecol.com/hls/video\n';
const data=()=>({hls:true,videoSource:`https://vaiquecol.com/cdn/hls/${asset}/master.txt`,securedLink:`https://vaiquecol.com/cdn/hls/${asset}/master.m3u8?md5=${'a'.repeat(22)}&expires=${now/1000+7200}`});
const media='#EXTM3U\n#EXTINF:10,\nhttps://nensec.xyz/cdn/segment.html\n#EXT-X-ENDLIST\n';
test('exceção só aceita Crystal Lake T1E1–8; outros títulos e filmes não acessam a rede',async()=>{
 const source=c.criar({get:()=>{throw Error('não deveria acessar');},post:()=>{throw Error('não deveria acessar');}});
 for(const target of [{tipo:'movie',tmdbId:'213562',temporada:'1',episodio:'1'},{tipo:'tv',tmdbId:'1399',temporada:'1',episodio:'1'},{tipo:'tv',tmdbId:'213562',temporada:'2',episodio:'1'},{tipo:'tv',tmdbId:'213562',temporada:'1',episodio:'9'}])assert.equal(await source.resolver(target),null);
 assert.equal(await source.resolver({tipo:'tv',tmdbId:'213562',temporada:'1',episodio:'1'},{exceto:[c.ID]}),null);
});
test('configuração exige identidade exata e recusa qualquer publicidade ou P2P',()=>{
 assert.deepEqual(c.configuracao(packed(settings(1)),1),{hash});
 assert.equal(c.configuracao(packed(settings(2)),1),null);
 for(const patch of [{advertising:[{tag:'advert'}]},{popactive:true},{poplimit:'1'},{popurl:'https://ad.test/'},{p2p:true},{advertising:null}])assert.equal(c.configuracao(packed({...settings(1),...patch}),1),null);
 assert.equal(c.configuracao('FirePlayer('+hash+')',1),null);
});
test('links temporários rejeitam expiração, troca de origem, identidade de arquivo e parâmetros extras',()=>{
 assert.ok(c.linkSeguro(data(),now));
 for(const patch of [{hls:false},{videoSource:'https://vaiquecol.com/master.txt'},{securedLink:data().securedLink.replace('vaiquecol.com','evil.test')},{securedLink:data().securedLink+'&x=1'},{securedLink:data().securedLink.replace(String(now/1000+7200),String(now/1000+30))}])assert.equal(c.linkSeguro({...data(),...patch},now),null);
});
test('manifesto força apenas português e recusa inserções publicitárias e destinos externos',()=>{
 const filtered=c.playlistPortuguesa(master);assert.doesNotMatch(filtered,/LANGUAGE="eng"/);assert.match(filtered,/LANGUAGE="por",DEFAULT=YES/);
 for(const bad of [master.replace('LANGUAGE="por"','LANGUAGE="spa"'),master+'#EXT-X-DISCONTINUITY\n',master.replace('/hls/video','/other/video'),master.replace('https://vaiquecol.com/hls/video','https://127.0.0.1/hls/video')])assert.throws(()=>c.playlistPortuguesa(bad));
});
test('qualidade sobe de 480p até 4K; versão maior só em inglês não entra',async()=>{
 let current=master,calls=0;
 const source=c.criar({now:()=>now,get:async url=>url.includes('/embed2/')?packed(settings(1)):url.includes('/cdn/hls/')?current:media,post:async()=>{calls++;return JSON.stringify(data());}});
 const target={tipo:'tv',tmdbId:'213562',temporada:'1',episodio:'1'};
 assert.equal((await source.resolver(target)).resolucao,'480p');
 current=master+'#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="original",LANGUAGE="eng",DEFAULT=NO,URI="https://vaiquecol.com/hls/original"\n#EXT-X-STREAM-INF:RESOLUTION=3840x2160,AUDIO="original"\nhttps://vaiquecol.com/hls/english4k\n';
 assert.equal((await source.resolver(target)).resolucao,'480p');
 assert.doesNotMatch(await source.playlist('1'),/english4k|LANGUAGE="eng"/);
 for(const [width,height,label] of [[1280,720,'720p'],[1920,1080,'1080p'],[2560,1440,'1440p'],[3840,2160,'2160p']]){
  current+=`#EXT-X-STREAM-INF:RESOLUTION=${width}x${height},AUDIO="audio"\nhttps://vaiquecol.com/hls/pt${height}\n`;
  const result=await source.resolver(target);
  assert.equal(result.resolucao,label);assert.equal(result.largura,width);
 }
 assert.equal(calls,6,'cada nova abertura consulta a fonte, mesmo antes de cinco minutos');
 assert.match(await source.playlist('1'),/RESOLUTION=3840x2160/);
 current+='#EXT-X-CUE-OUT:30\n';assert.equal(await source.resolver(target),null,'4K com publicidade também é recusado');
});
test('qualidade do formato de cinema considera largura e não anuncia resolução inventada',()=>{
 assert.deepEqual(c.qualidadeDaPlaylist(master.replace('842x480','3840x1600')),{largura:3840,altura:1600,resolucao:'2160p'});
 assert.equal(c.qualidadeDaPlaylist('#EXTM3U\n').resolucao,'');
});
test('renova em cinco minutos, compartilha pedidos simultâneos e entrega apenas manifesto interno',async()=>{
 let clock=now,calls=0;
 const source=c.criar({now:()=>clock,get:async url=>url.includes('/embed2/')?packed(settings(1)):url.includes('/cdn/hls/')?master:media,post:async()=>{calls++;return JSON.stringify(data());}});
 const target={tipo:'tv',tmdbId:'213562',temporada:'1',episodio:'1'};
 const results=await Promise.all([source.resolver(target),source.resolver(target)]);
 assert.equal(calls,1);assert.equal(results[0].url,'/api/crystal-lake/1/1/master.m3u8');assert.equal(results[0].audio,'pt-BR');
 assert.doesNotMatch(await source.playlist('1'),/LANGUAGE="eng"/);assert.equal(calls,1);
 clock+=300001;assert.ok(await source.resolver(target));assert.equal(calls,2);
});
test('recusa publicidade também nas listas dos segmentos, mesmo com manifesto mestre limpo',async()=>{
 assert.equal(c.listaMediaLimpa(media),true);
 for(const value of [media+'#EXT-X-CUE-OUT:30\n',media.replace('nensec.xyz','evil.test'),media.replace('#EXT-X-ENDLIST','')]){
  assert.equal(c.listaMediaLimpa(value),false);
  const source=c.criar({now:()=>now,get:async url=>url.includes('/embed2/')?packed(settings(1)):url.includes('/cdn/hls/')?master:value,post:async()=>JSON.stringify(data())});
  assert.equal(await source.resolver({tipo:'tv',tmdbId:'213562',temporada:'1',episodio:'1'}),null);
 }
});
test('mudança para anúncios ou resposta inválida não é oferecida como vídeo',async()=>{
 for(const html of [packed({...settings(1),popactive:true}),'<html>erro</html>']){
  const source=c.criar({get:async()=>html,post:()=>{throw Error('não deveria acessar');}});
  assert.equal(await source.resolver({tipo:'tv',tmdbId:'213562',temporada:'1',episodio:'1'}),null);
 }
});
