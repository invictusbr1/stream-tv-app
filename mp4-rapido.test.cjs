'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{analisar}=require('./mp4-rapido.cjs');
function box(name,...parts){const size=8+parts.reduce((n,p)=>n+p.length,0),b=Buffer.alloc(size);b.writeUInt32BE(size);b.write(name,4,4,'ascii');let at=8;for(const p of parts){p.copy(b,at);at+=p.length;}return b;}
function track(kind,codec,w,h,lang,table){const tkhd=Buffer.alloc(84);tkhd[3]=1;tkhd.writeUInt32BE(w*65536,76);tkhd.writeUInt32BE(h*65536,80);const hdlr=Buffer.alloc(12);hdlr.write(kind,8);const mdhd=Buffer.alloc(24),packed=[...lang].reduce((n,c)=>n*32+c.charCodeAt(0)-96,0);mdhd.writeUInt16BE(packed,20);const entry=Buffer.alloc(kind==='vide'?78:28);if(kind==='vide'){entry.writeUInt16BE(w,24);entry.writeUInt16BE(h,26);}const count=Buffer.alloc(8);count[7]=1;return box('trak',box('tkhd',tkhd),box('mdia',box('mdhd',mdhd),box('hdlr',hdlr),box('minf',box('stbl',box('stsd',count,box(codec,entry)),table||Buffer.alloc(0)))));}
test('metadados 4K e português sem ler mdat ou tabelas de amostras de vários MiB',async()=>{
 const data=Buffer.concat([box('ftyp',Buffer.from('isom0000')),box('mdat',Buffer.alloc(2*1024*1024)),box('moov',track('vide','hvc1',3832,1600,'und',box('stsz',Buffer.alloc(9*1024*1024))),track('soun','mp4a',0,0,'por'))]);let used=0;
 const result=await analisar(async(p,n)=>{const bytes=data.subarray(p,p+n);used+=bytes.length;return {status:206,start:p,total:data.length,bytes,mime:'video/mp4'};});
 assert.equal(result.imagem.largura,3832);assert.equal(result.imagem.altura,1600);assert.equal(result.imagem.codec,'hevc');assert.equal(result.faixas[0].idioma,'por');assert.equal(result.faixas[0].padrao,true);assert(used<262144);assert(result.leitura.requests<8);
});
test('Full HD sem etiqueta de idioma continua indefinido, e HTML/faixas inválidas são recusados',async()=>{
 const data=box('moov',track('vide','avc1',1920,1080,'und'),track('soun','mp4a',0,0,'und'));
 const fetcher=async(p,n)=>({status:206,start:p,total:data.length,bytes:data.subarray(p,p+n),mime:'video/mp4'});
 const result=await analisar(fetcher);assert.equal(result.imagem.altura,1080);assert.equal(result.faixas[0].idioma,'und');
 for(const patch of [{mime:'text/html'},{status:404},{start:5},{total:-1}])await assert.rejects(analisar(async(p,n)=>({...await fetcher(p,n),...patch})));
 const bad=Buffer.from([0,0,0,7,109,111,111,118]);await assert.rejects(analisar(async(p,n)=>({status:206,start:p,total:bad.length,bytes:bad.subarray(p,p+n),mime:'video/mp4'})));
});

test('repete uma recusa de origem sem referer e distingue erro HTTP/HTML de falta de metadados',async()=>{
 const axios=require('axios'),{Readable}=require('node:stream'),original=axios.get,{ler}=require('./mp4-rapido.cjs');
 const data=box('moov',track('vide','avc1',1920,1080,'und'),track('soun','mp4a',0,0,'por'));let refusals=0;
 try{
  axios.get=async(url,o)=>{
   if(o.headers.Referer){refusals++;return {status:403,headers:{'content-type':'application/json'},data:Readable.from(['{}'])};}
   const [,a,b]=/^bytes=(\d+)-(\d+)$/.exec(o.headers.Range),start=Number(a),end=Math.min(Number(b),data.length-1);
   return {status:206,headers:{'content-type':'video/mp4','content-range':`bytes ${start}-${end}/${data.length}`},data:Readable.from([data.subarray(start,end+1)])};
  };
  const good=await ler('https://cdn.example/video.mp4','https://fonte.example/',{falhaExplicita:true});
  assert.equal(good.imagem.altura,1080);assert.equal(refusals,1);
  axios.get=async()=>({status:200,headers:{'content-type':'text/html'},data:Readable.from(['<html>'])});
  assert.deepEqual(await ler('https://cdn.example/video.mp4','',{falhaExplicita:true}),{indisponivel:true});
  assert.equal(await ler('https://cdn.example/video.mp4'),null);
 }finally{axios.get=original;}
});

test('redirecionamento HTTP com porta 80 vira HTTPS padrão, preservando a assinatura e a medição 4K',async()=>{
 const axios=require('axios'),{Readable}=require('node:stream'),original=axios.get,{ler}=require('./mp4-rapido.cjs');
 const data=box('moov',track('vide','hvc1',3840,2160,'und'),track('soun','mp4a',0,0,'por')),requests=[];
 try{
  axios.get=async(url,o)=>{
   requests.push(url);
   if(url==='https://gateway.example/stream')return {status:307,headers:{location:'http://cdn.example:80/movie.mp4?signature=a%2Bb&x=1'},data:Readable.from([])};
   assert.equal(url,'https://cdn.example/movie.mp4?signature=a%2Bb&x=1');
   const [,a,b]=/^bytes=(\d+)-(\d+)$/.exec(o.headers.Range),start=Number(a),end=Math.min(Number(b),data.length-1);
   return {status:206,headers:{'content-type':'video/mp4','content-range':`bytes ${start}-${end}/${data.length}`},data:Readable.from([data.subarray(start,end+1)])};
  };
  const result=await ler('https://gateway.example/stream','',{falhaExplicita:true});
  assert.equal(result.imagem.largura,3840);assert.equal(result.imagem.altura,2160);assert.equal(result.faixas[0].idioma,'por');
  assert(requests.length>1);assert(requests.every(u=>new URL(u).protocol==='https:'&&new URL(u).port===''));
 }finally{axios.get=original;}
});
