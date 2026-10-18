'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {criar,chave,segura}=require('./midias-memoria.cjs');
test('memória persiste URLs originais, isola títulos/episódios e remove fonte inválida sem ressuscitar seed',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'conecta-memoria-'));
 try{
  let now=Date.now();const file=path.join(dir,'history.json'),seedFile=path.join(dir,'seed.json');
  const old={key:'movie:969681',id:'fenix',url:'https://media.invalid/original/video.mp4',referer:'https://media.invalid/',type:'file',width:3832,height:1600,at:now};
  fs.writeFileSync(seedFile,JSON.stringify({version:1,items:[old]}));
  const options={file,seedFile,agora:()=>now},a=criar(options);
  assert.equal(a.load(old.key,['fenix'])[0].dados.url,old.url);
  const restart=criar(options);assert.equal(restart.load(old.key,['fenix']).length,1);
  assert.equal(restart.load('movie:1',['fenix']).length,0);assert.equal(restart.load(old.key,['disabled']).length,0);
  const data={url:old.url,referer:old.referer,type:'file'};
  restart.update('tv:1:1:1',[{id:'fenix',dados:data,sonda:{largura:1920,altura:800,padraoPortugues:true}}]);
  assert.equal(restart.load('tv:1:1:1',['fenix']).length,1);assert.equal(restart.load('tv:1:1:2',['fenix']).length,0);
  restart.update(old.key,[{id:'fenix',dados:data,sonda:null}]);assert.equal(restart.load(old.key,['fenix']).length,1);
  restart.update(old.key,[{id:'fenix',dados:data,invalida:true}]);assert.equal(criar(options).load(old.key,['fenix']).length,0);
  restart.update('tv:1:1:1',[{id:'fenix',dados:data,sonda:{largura:1920,altura:800,padraoPortugues:false,audios:[{padrao:true,lang:'eng'}]}}]);
  assert.equal(restart.load('tv:1:1:1',['fenix']).length,0);
  restart.update('movie:2',[{id:'fenix',dados:data,sonda:{largura:3840,altura:2160,padraoPortugues:true}}]);
  now+=8*86400000;assert.equal(restart.load('movie:2',['fenix']).length,0);
  fs.writeFileSync(file,'corrompido');assert.deepEqual(criar(options).load('movie:2',['fenix']),[]);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('memória rejeita páginas, URLs privadas, credenciais e prova incompleta',()=>{
 for(const u of ['http://media.invalid/a','https://127.0.0.1/a','https://10.0.0.1/a','https://user:password@media.invalid/a','https://media.invalid:8080/a','https://localhost/a'])assert.equal(segura(u),false);
 assert.equal(chave({tipo:'tv',tmdbId:1,temporada:2,episodio:3}),'tv:1:2:3');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'conecta-memoria-'));
 try{const m=criar({file:path.join(dir,'history.json'),seedFile:path.join(dir,'none')});
  for(const dados of [{url:'https://media.invalid/embed',type:'embed'},{url:'https://media.invalid/a.m3u8',type:'hls'},{url:'https://media.invalid/a.mp4',type:'file'}])m.update('movie:1',[{id:'fenix',dados,sonda:{largura:3840,altura:2160,padraoPortugues:false}}]);
  assert.deepEqual(m.load('movie:1',['fenix']),[]);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
