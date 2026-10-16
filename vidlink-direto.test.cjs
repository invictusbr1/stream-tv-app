const {test}=require('node:test'),assert=require('node:assert/strict');
const fonte=require('./vidlink-direto'),midia=require('./midia-proxy'),axios=require('axios');
const arquivo=(q,extra={})=>({type:'mp4',url:`https://hcdn3.hakunaymatata.com/filme-${q}.mp4?token=teste`,codecName:'h264',headers:{'User-Agent':'Public-Media-Client/1.0',Accept:'*/*'},...extra});
test('escolhe a maior qualidade de arquivo, sem aceitar páginas, rede interna ou codec incompatível',()=>{
 const stream={type:'file',qualities:{720:arquivo(720),1080:arquivo(1080),2160:arquivo(2160,{codecName:'hevc'})}};
 assert.equal(fonte.escolherArquivo(stream).altura,1080);
 for(const url of ['https://127.0.0.1/a.mp4','http://hcdn3.hakunaymatata.com/a.mp4','https://evil.example/a.mp4','https://hcdn3.hakunaymatata.com/player.html','https://user:pass@hcdn3.hakunaymatata.com/a.mp4'])assert.equal(fonte.escolherArquivo({type:'file',qualities:{1080:arquivo(1080,{url})}}),null);
 assert.equal(fonte.escolherArquivo({type:'file',qualities:{480:arquivo(480)}}),null);
});
test('resolvedor mantém série/episódio e retorna somente mídia original, sem página externa',async()=>{
 const original=axios.get,pedidos=[];
 axios.get=async(url,opts)=>{pedidos.push({url,opts});return {data:url.includes('enc-dec.app')?{result:'codigo-publico'}:{stream:{type:'file',TTL:3600,qualities:{1080:arquivo(1080)}}}};};
 try{
  const resultado=await fonte.resolver({tipo:'tv',tmdbId:'213562',temporada:'1',episodio:'1'});
  assert.match(pedidos[1].url,/\/tv\/codigo-publico\/1\/1$/);assert.equal(resultado.type,'file');assert.equal(resultado.audio,'original');assert.equal(resultado.resolucao,'1080p');assert.equal(resultado.final,undefined);
  assert.equal(midia.cabecalhosDaMidia(resultado.url)['User-Agent'],'Public-Media-Client/1.0');
  assert.match(require('./fontes-motor').prepararParaPlayer(resultado).urlAplicativo,/^\/api\/hls\?/);
 }finally{axios.get=original;}
});
test('falha da nova alternativa não altera nem chama as fontes antigas',async()=>{
 const original=axios.get;axios.get=async()=>{throw Error('indisponível');};
 try{assert.equal(await fonte.resolver({tipo:'movie',tmdbId:'238'}),null);assert.equal(await fonte.resolver({tipo:'tv',tmdbId:'213562',temporada:'x',episodio:'1'}),null);}finally{axios.get=original;}
});
test('cabeçalhos da mídia ficam limitados ao endereço exato e não aceitam segredos ou injeção',()=>{
 const url='https://hcdn3.hakunaymatata.com/a.mp4?token=teste';
 midia.registrarCabecalhos(url,{'User-Agent':'Public-Client',Accept:'*/*',Cookie:'segredo',Authorization:'segredo',Origin:'https://evil.test'});
 assert.deepEqual(midia.cabecalhosDaMidia(url),{'User-Agent':'Public-Client',Accept:'*/*'});assert.deepEqual(midia.cabecalhosDaMidia(url+'2'),{});
 midia.registrarCabecalhos(url+'3',{'User-Agent':'x\r\nCookie: segredo'});assert.deepEqual(midia.cabecalhosDaMidia(url+'3'),{});
});
