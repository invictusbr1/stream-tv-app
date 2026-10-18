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
