'use strict';
// Mesma leitura por faixas usada pelo APK: pula mdat e tabelas de quadros.
const codecs={avc1:'h264',avc3:'h264',hvc1:'hevc',hev1:'hevc',av01:'av1',vp09:'vp9',mp4v:'mpeg4',mp4a:'aac','ac-3':'ac3','ec-3':'eac3',Opus:'opus','.mp3':'mp3'};
async function analisar(fetcher,{timeout=6000}={}){
 const deadline=Date.now()+timeout;let total=-1,used=0,requests=0,windowStart=-1,window=null,boxes=0;const tracks=[];
 async function fetch(position,length){
  if(Date.now()>=deadline||++requests>40||used+length>2*1024*1024)throw Error('Limite da leitura');
  const b=await fetcher(position,length,deadline);
  if(!b||!Buffer.isBuffer(b.bytes)||b.bytes.length>length||!Number.isSafeInteger(b.total)||b.total<=0||b.start!==position||b.status!==206&&!(b.status===200&&position===0)||/text\/html|application\/json|text\/xml/i.test(b.mime||''))throw Error('Faixa inválida');
  if(total>=0&&b.total!==total)throw Error('Arquivo mudou');total=b.total;used+=b.bytes.length;return b.bytes;
 }
 async function bytes(position,count){
  if(position<0||count<0||position+count>total||count>65536)throw Error('Cabeçalho inválido');
  const parts=[];let done=0;
  while(done<count){
   if(!window||position+done<windowStart||position+done>=windowStart+window.length){windowStart=position+done;window=await fetch(windowStart,Math.min(65536,total-windowStart));}
   const start=position+done-windowStart,n=Math.min(count-done,window.length-start);if(n<=0)throw Error('Cabeçalho incompleto');parts.push(window.subarray(start,start+n));done+=n;
  }return Buffer.concat(parts,count);
 }
 async function walk(from,end,track,depth){
  if(depth>6)throw Error('Estrutura excessiva');
  for(let p=from;p+8<=end;){
   if(++boxes>256)throw Error('Muitas caixas');const h=await bytes(p,8),kind=h.toString('ascii',4,8);let size=h.readUInt32BE(0),header=8;
   if(size===1){size=Number((await bytes(p+8,8)).readBigUInt64BE());header=16;}
   if(size===0)size=end-p;
   if(!Number.isSafeInteger(size)||size<header||size>end-p)throw Error('Tamanho inválido');
   const data=p+header,limit=p+size;
   if(kind==='trak'){const t={kind:'',codec:'',language:'',width:0,height:0,enabled:false};tracks.push(t);await walk(data,limit,t,depth+1);}
   else if(['moov','mdia','minf','stbl'].includes(kind)){await walk(data,limit,track,depth+1);if(kind==='moov'&&depth===0)return;}
   else if(track){
    if(kind==='tkhd'&&size>=header+84){track.enabled=Boolean((await bytes(data,4))[3]&1);const d=await bytes(limit-8,8);track.width=d.readUInt32BE(0)>>>16;track.height=d.readUInt32BE(4)>>>16;}
    else if(kind==='hdlr'&&size>=header+12)track.kind=(await bytes(data+8,4)).toString('ascii');
    else if(kind==='mdhd'&&size>=header+24){const version=(await bytes(data,1))[0],at=data+(version===1?32:20);if(at+2<=limit){const lang=(await bytes(at,2)).readUInt16BE(),abc=[lang>>10&31,lang>>5&31,lang&31];if(abc.every(n=>n>=1&&n<=26))track.language=String.fromCharCode(...abc.map(n=>n+96));}}
    else if(kind==='stsd'&&size>=header+16){const e=await bytes(data+8,8),entrySize=e.readUInt32BE(0);if(entrySize<8||entrySize>limit-data-8)throw Error('Descrição inválida');track.codec=codecs[e.toString('ascii',4,8)]||'';
     if(track.kind==='vide'&&entrySize>=36){const d=await bytes(data+40,4);track.width=d.readUInt16BE(0);track.height=d.readUInt16BE(2);}return;
    }
   }p=limit;
  }
 }
 await fetch(0,1);await walk(0,total,null,0);
 const video=tracks.find(t=>t.kind==='vide'&&t.codec&&t.width>0&&t.height>0),audio=tracks.filter(t=>t.kind==='soun'&&t.codec);
 if(!video||!audio.length)throw Error('Sem imagem e áudio');
 return {container:'mov,mp4',imagem:{largura:video.width,altura:video.height,codec:video.codec,pixels:''},faixas:audio.map((t,i)=>({ordem:i,idioma:t.language||'und',padrao:i===0&&t.enabled,codec:t.codec})),leitura:{bytes:used,requests}};
}
async function ler(url,referer='',{timeout=6000}={}){
 try{
  const axios=require('axios'),safe=require('./perfis-motor').ehEnderecoSeguro;let target=url;
  return await analisar(async(position,length,deadline)=>{
   const seen=new Set();
   for(let i=0;i<6;i++){
    target=String(target).replace(/^http:/i,'https:');if(!safe(target)||seen.has(target))throw Error('Destino inválido');seen.add(target);
    const remaining=deadline-Date.now();if(remaining<=0)throw Error('Fim do prazo');
    const r=await axios.get(target,{headers:{Range:`bytes=${position}-${position+length-1}`,...(referer?{Referer:referer}:{}),'User-Agent':'Mozilla/5.0'},responseType:'stream',maxRedirects:0,validateStatus:()=>true,timeout:remaining,signal:AbortSignal.timeout(remaining)});
    if([301,302,303,307,308].includes(r.status)){r.data.destroy();target=new URL(r.headers.location,target).href;continue;}
    try{
     const range=/^bytes (\d+)-(\d+)\/(\d+)$/.exec(r.headers['content-range']||'');if(!range||r.status!==206)throw Error('Servidor não oferece faixas');
     const parts=[];let size=0;for await(const part of r.data){size+=part.length;if(size>length)throw Error('Faixa excessiva');parts.push(part);}
     return {status:r.status,start:Number(range[1]),total:Number(range[3]),bytes:Buffer.concat(parts,size),mime:r.headers['content-type']||''};
    }finally{r.data.destroy();}
   }throw Error('Redirecionamentos excessivos');
  },{timeout});
 }catch{return null;}
}
module.exports={ler,analisar};
