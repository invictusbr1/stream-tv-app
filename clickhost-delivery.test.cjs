'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{resolve}=require('./clickhost-delivery.cjs');
const origin='https://froststream.cloutteam.com/movie/v1.'+'a'.repeat(30),target='https://hidden-canyon-7575.ekasa91vehle.workers.dev/video.mp4';
const input={tipo:'movie',id:'1022789',origem:origin};
test('converte só o destino final para HTTPS e exige vídeo real sem executar páginas',async()=>{
 const seen=[];
 const d=await resolve(input,{read:async url=>{seen.push(url.href);if(url.href===origin)return {status:302,location:'http://dbonline.tech-cdn.top/file'};if(url.hostname==='dbonline.tech-cdn.top')return {status:302,location:target.replace('https:','http:')};return {status:206,type:'video/mp4',range:'bytes 0-0/9999'};}});
 assert.equal(d.url,target);assert.equal(seen.length,4);assert.equal(seen.at(-1),target);assert.equal(d.resolucao,undefined);
});
test('o cliente não escolhe destinos arbitrários, credenciais, portas ou rede interna',async()=>{
 for(const origem of ['http://froststream.cloutteam.com/movie/v1.'+'a'.repeat(30),'https://localhost/file','https://froststream.cloutteam.com/private','https://froststream.cloutteam.com/movie/v1.'+'a'.repeat(30)+'?url=http://localhost']){
  let calls=0;assert.equal(await resolve({...input,origem},{read:async()=>{calls++;}}).catch(()=>null),null);assert.equal(calls,0);
 }
 for(const location of ['https://127.0.0.1/a','https://evil.test/a','https://srcine.site:444/a','https://user:pass@srcine.site/a'])await assert.rejects(()=>resolve(input,{read:async()=>({status:302,location})}));
});
test('recusa HTML, erro, faixa errada, ciclos e certificado inválido',async()=>{
 for(const result of [{status:200,type:'text/html'},{status:404,type:'video/mp4'},{status:206,type:'video/mp4',range:'bytes 1-1/99'}])assert.equal(await resolve(input,{read:async()=>result}),null);
 assert.equal(await resolve(input,{read:async()=>({status:302,location:origin})}),null);
 await assert.rejects(()=>resolve(input,{read:async()=>{throw Object.assign(Error('TLS'),{code:'CERT_HAS_EXPIRED'});}}));
});
test('valida título e prazo e não guarda o link efêmero',async()=>{
 let reads=0;assert.equal(await resolve({...input,tipo:'unknown'},{read:async()=>reads++}),null);assert.equal(reads,0);
 let time=0;assert.equal(await resolve({...input,prazoMs:500},{now:()=>time,read:async()=>{time=600;return {status:302,location:target};}}),null);
});
