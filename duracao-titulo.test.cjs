'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {outroTitulo}=require('./duracao-titulo');
const {analisar}=require('./mp4-rapido.cjs');
function box(name,...parts){const size=8+parts.reduce((n,p)=>n+p.length,0),b=Buffer.alloc(size);b.writeUInt32BE(size);b.write(name,4,4,'ascii');let at=8;for(const p of parts){p.copy(b,at);at+=p.length;}return b;}
function track(kind,codec,w,h,lang){const tkhd=Buffer.alloc(84);tkhd[3]=1;tkhd.writeUInt32BE(w*65536,76);tkhd.writeUInt32BE(h*65536,80);const hdlr=Buffer.alloc(12);hdlr.write(kind,8);const mdhd=Buffer.alloc(24),packed=[...lang].reduce((n,c)=>n*32+c.charCodeAt(0)-96,0);mdhd.writeUInt16BE(packed,20);const entry=Buffer.alloc(kind==='vide'?78:28);if(kind==='vide'){entry.writeUInt16BE(w,24);entry.writeUInt16BE(h,26);}const count=Buffer.alloc(8);count[7]=1;return box('trak',box('tkhd',tkhd),box('mdia',box('mdhd',mdhd),box('hdlr',hdlr),box('minf',box('stbl',box('stsd',count,box(codec,entry))))));}

test('Os Suspeitos: arquivo de 106 min não serve para o filme de 153 min (e vice-versa)',()=>{
 assert.equal(outroTitulo(153,106.08*60),true);
 assert.equal(outroTitulo(106,153.2*60),true);
 assert.equal(outroTitulo(153,153.2*60),false);
 assert.equal(outroTitulo(153,170*60),false); // versão estendida / créditos
 assert.equal(outroTitulo(0,106*60),false);   // sem duração oficial: não decide
 assert.equal(outroTitulo(153,0),false);      // sem medida: não decide
});

test('leitura rápida do MP4 devolve a duração (mvhd)',async()=>{
 const mvhd=Buffer.alloc(100);mvhd.writeUInt32BE(1000,12);mvhd.writeUInt32BE(6365*1000,16);
 const data=box('moov',box('mvhd',mvhd),track('vide','avc1',1920,1080,'und'),track('soun','mp4a',0,0,'por'));
 const r=await analisar(async(p,n)=>({status:206,start:p,total:data.length,bytes:data.subarray(p,p+n),mime:'video/mp4'}));
 assert.equal(r.duracao,6365);assert.equal(r.imagem.altura,1080);
});
