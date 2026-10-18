'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),provas=require('./provas-idioma');
test('prova de português pertence ao arquivo, título, fornecedor e referenciador exatos e expira',()=>{
 const titulo='movie:1084244',dados={url:'https://cdn.example/filme.mp4?token=1',referer:'https://fonte.example/'};
 const registro={titulo,fonteId:'fenix',midiaHash:provas.identidade(titulo,'fenix',dados.url,dados.referer),idioma:'pt',em:new Date().toISOString(),evidencia:'segredo',url:dados.url};
 assert.equal(provas.idioma({a:registro},titulo,'fenix',dados),'pt');
 for(const [t,f,d]of [[titulo,'outra',dados],['movie:1','fenix',dados],[titulo,'fenix',{...dados,url:dados.url+'2'}],[titulo,'fenix',{...dados,referer:''}]])assert.equal(provas.idioma({a:registro},t,f,d),'');
 assert.equal(provas.publicas({a:{...registro,em:new Date(Date.now()-provas.VALIDADE-1).toISOString()}},titulo).length,0);
 assert.deepEqual(Object.keys(provas.publicas({a:registro},titulo)[0]).sort(),['expira','hash','idioma']);
 assert.equal(provas.publicas({a:{...registro,midiaHash:undefined}},titulo).length,0);
});
test('fila de confirmação não duplica título, limita carga e continua após falha',async()=>{
 const {criarFila}=require('./central/qualidade-idioma');let release;const block=new Promise(r=>release=r),feitos=[];let agora=100;
 const q=criarFila({limite:1,intervalo:500,agora:()=>agora,verificar:async t=>{feitos.push(t);if(t==='movie:1'){await block;throw Error('rede');}}});
 assert.equal(q.solicitar('movie:1'),true);assert.equal(q.solicitar('movie:1'),false);
 assert.equal(q.solicitar('movie:2'),true);assert.equal(q.solicitar('movie:3'),false);assert.equal(q.solicitar('x'),false);
 release();await new Promise(r=>setImmediate(r));assert.deepEqual(feitos,['movie:1','movie:2']);assert.equal(q.estado().ativo,false);
 assert.equal(q.solicitar('movie:1'),false);agora+=501;assert.equal(q.solicitar('movie:1'),true);
 await new Promise(r=>setImmediate(r));
});
