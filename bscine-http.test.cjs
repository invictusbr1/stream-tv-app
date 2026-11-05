'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const midia=require('./midia-proxy');
const perfis=require('./perfis-motor');
const motor=require('./fontes-motor');

test('httpPermitido só libera o host fixo da BsCine', () => {
  assert.equal(midia.httpPermitido('rfc-infinite.top'), true);
  assert.equal(midia.httpPermitido('cdn.rfc-infinite.top'), true);
  assert.equal(midia.httpPermitido('rfc-infinite.top.evil.com'), false);
  assert.equal(midia.httpPermitido('evil.com'), false);
  assert.equal(midia.hostPermitido('rfc-infinite.top'), true);
});

test('ehEnderecoSeguro aceita HTTP só do host liberado; o resto continua só HTTPS', () => {
  assert.equal(perfis.ehEnderecoSeguro('http://rfc-infinite.top/v.mp4'), true);
  assert.equal(perfis.ehEnderecoSeguro('http://evil.com/v.mp4'), false);
  assert.equal(perfis.ehEnderecoSeguro('https://evil.com/v.mp4'), true);
  assert.equal(perfis.ehEnderecoSeguro('http://127.0.0.1/v.mp4'), false);
  assert.equal(perfis.ehEnderecoSeguro('http://rfc-infinite.top.evil.com/v.mp4'), false);
});

test('resolverTodos mantém HTTP para a BsCine e sobe HTTP->HTTPS para os demais', async () => {
  const perfil={id:'bscine',nome:'BsCine',dublado:true,qualidade:'1080p',urlMovie:'https://bscine.alwaysdata.net/stream/movie/{imdb}.json',referer:'https://bscine.alwaysdata.net/',passos:[{tipo:'json',caminho:'streams[0].url'}]};
  const alvo={tipo:'movie',imdb:'tt1375666',id:'27205'};
  const bscine=await perfis.resolverTodos(perfil,alvo,{buscar:async()=>JSON.stringify({streams:[{name:'BsCine\n1080p · Dublado',title:'X\nDublado\nBsCine',url:'http://rfc-infinite.top/movie/9/v/3.mp4'}]})});
  assert.equal(bscine.length,1);
  assert.equal(bscine[0].url,'http://rfc-infinite.top/movie/9/v/3.mp4');
  const outro={...perfil,id:'outra',urlMovie:'https://outra.exemplo/stream/movie/{imdb}.json',referer:'https://outra.exemplo/'};
  const up=await perfis.resolverTodos(outro,alvo,{buscar:async()=>JSON.stringify({streams:[{name:'Dublado',title:'Dublado',url:'http://cdn-outra.exemplo/v.mp4'}]})});
  assert.equal(up[0].url,'https://cdn-outra.exemplo/v.mp4');
});

test('prepararParaPlayer encaminha a BsCine pelo /api/hls, sem referer e sem expor HTTP', () => {
  const r=motor.prepararParaPlayer({url:'http://rfc-infinite.top/movie/9/v/3.mp4',type:'file',final:true,referer:'https://bscine.alwaysdata.net/',audio:'pt-BR',fonteId:'bscine'});
  assert.equal(r.final,false);
  assert.ok(r.urlAplicativo.startsWith('/api/hls?u='),'deve ir pelo proxy');
  assert.ok(!/[?&]r=/.test(r.urlAplicativo),'nao deve mandar referer para a BsCine');
  const u=new URLSearchParams(r.urlAplicativo.slice(r.urlAplicativo.indexOf('?')+1)).get('u');
  assert.equal(midia.textoDeBase64url(u),'http://rfc-infinite.top/movie/9/v/3.mp4');
});

test('fonte desligada na política sai da fila (FrostStream, VêTela, BestCine)', () => {
  const politica=require('./politica-fontes');
  const fila=politica.ordenar([{id:'froststream',papel:'dublado'},{id:'thsolucoes',papel:'dublado'},{id:'bestcine',papel:'dublado'},{id:'watchplay',papel:'dublado'}],'dublado',null).map(x=>x.fonte.id);
  assert.deepEqual(fila,['watchplay']);
});

test('leitura rápida do MP4 da BsCine segue o redirect http para servidor público e recusa rede interna', async () => {
  const axios=require('axios'),{Readable}=require('node:stream'),original=axios.get,{ler}=require('./mp4-rapido.cjs');
  const vistos=[];
  try{
    axios.get=async(url)=>{vistos.push(url);
      if(url.startsWith('http://rfc-infinite.top/'))return {status:302,headers:{location:'http://23.158.40.171/vauth/1.mp4'},data:Readable.from([])};
      return {status:404,headers:{'content-type':'text/html'},data:Readable.from(['x'])};};
    await ler('http://rfc-infinite.top/movie/1/v/2.mp4','',{timeout:3000,falhaExplicita:true});
    assert.ok(vistos[0].startsWith('http://rfc-infinite.top/'),'não pode subir para https');
    assert.ok(vistos.includes('http://23.158.40.171/vauth/1.mp4'),'segue o redirect público');
    vistos.length=0;
    axios.get=async(url)=>{vistos.push(url);
      if(url.startsWith('http://rfc-infinite.top/'))return {status:302,headers:{location:'http://192.168.0.10/x.mp4'},data:Readable.from([])};
      return {status:404,headers:{},data:Readable.from([])};};
    await ler('http://rfc-infinite.top/movie/1/v/2.mp4','',{timeout:3000,falhaExplicita:true});
    assert.ok(!vistos.some(u=>u.includes('192.168.')),'nunca segue para rede interna');
    vistos.length=0;
    axios.get=async(url)=>{vistos.push(url);return {status:404,headers:{},data:Readable.from([])};};
    await ler('http://outro.exemplo/v.mp4','',{timeout:3000,falhaExplicita:true});
    assert.ok(vistos.every(u=>u.startsWith('https://')),'os demais continuam só https');
  }finally{axios.get=original;}
});
