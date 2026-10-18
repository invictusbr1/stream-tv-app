'use strict';
// Guarda somente arquivos diretos com dimensões e português comprovados.
// Os registros voltam como candidatas, nunca como uma escolha sem nova sonda.
const fs=require('node:fs'),path=require('node:path');
const TTL=7*86400000;
function segura(raw){try{const u=new URL(raw);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&!u.hash&&raw.length<=4096&&u.hostname!=='localhost'&&!u.hostname.endsWith('.local')&&!/^(127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[01])\.)/.test(u.hostname)&&!u.hostname.includes(':');}catch{return false;}}
const chave=alvo=>alvo.tipo==='tv'?`tv:${alvo.tmdbId}:${alvo.temporada}:${alvo.episodio}`:`movie:${alvo.tmdbId}`;
const validaChave=k=>/^(movie:\d{1,10}|tv:\d{1,10}:\d{1,3}:\d{1,4})$/.test(k);
function criar({file=path.join(process.env.DADOS_DIR||__dirname,'midias-verificadas.json'),seedFile=path.join(__dirname,'midias-verificadas-seed.json'),agora=Date.now}={}){
 function read(){try{const text=fs.readFileSync(file,'utf8');if(text.length>2000000)throw Error();const d=JSON.parse(text);if(d.version!==1||!Array.isArray(d.items))throw Error();return d;}catch{return {version:1,seed:0,items:[]};}}
 function write(d){try{fs.mkdirSync(path.dirname(file),{recursive:true});const temp=file+'.'+process.pid+'.tmp';fs.writeFileSync(temp,JSON.stringify(d),{mode:0o600});fs.renameSync(temp,file);}catch{ /* Memória opcional: não impede reprodução. */ }}
 function valid(r){return r&&validaChave(r.key)&&/^[a-z0-9_-]{1,64}$/.test(r.id)&&r.type==='file'&&segura(r.url)&&(!r.referer||segura(r.referer))&&r.width>0&&r.height>0&&Number.isFinite(r.at)&&r.at>agora()-TTL&&r.at<=agora()+60000;}
 function state(){const d=read();d.items=d.items.filter(valid);try{const seed=JSON.parse(fs.readFileSync(seedFile,'utf8'));if(Number(seed.version)>d.seed){for(const r of seed.items||[])if(valid(r)&&!d.items.some(x=>x.key===r.key&&x.url===r.url&&x.id===r.id))d.items.push(r);d.seed=Number(seed.version);write(d);}}catch{}return d;}
 function load(key,ids){if(!validaChave(key))return [];return state().items.filter(r=>r.key===key&&(!ids||ids.includes(r.id))).sort((a,b)=>b.width*b.height-a.width*a.height).slice(0,3).map(r=>({...r,dados:{url:r.url,referer:r.referer||'',type:'file',audio:'pt-BR',fonteId:r.id,fonte:r.name||r.id,resolucao:Math.round(Math.max(r.height,r.width*9/16))+'p'}}));}
 function update(key,records){if(!validaChave(key))return;const d=state();for(const r of records){const data=r.dados;if(!data||data.type!=='file'||!segura(data.url))continue;const id=r.id,s=r.sonda;const match=x=>x.key===key&&x.id===id&&x.url===data.url;
   if(r.invalida||s&&s.audios?.some(a=>a.padrao&&!/^(pt|por)(-|$)/i.test(a.lang||''))&&!s.padraoPortugues){d.items=d.items.filter(x=>!match(x));continue;}
   if(!s?.largura||!s?.altura||!s.padraoPortugues)continue;
   const item={key,id,url:data.url,referer:data.referer||'',type:'file',name:data.fonte||id,width:s.largura,height:s.altura,at:agora()};if(!valid(item))continue;
   d.items=d.items.filter(x=>!match(x));d.items.push(item);
  }
  const groups=new Map();for(const r of d.items){if(!groups.has(r.key))groups.set(r.key,[]);groups.get(r.key).push(r);}
  d.items=[...groups.values()].sort((a,b)=>Math.max(...b.map(r=>r.at))-Math.max(...a.map(r=>r.at))).slice(0,64).flatMap(list=>list.sort((a,b)=>b.width*b.height-a.width*a.height).slice(0,3));write(d);
 }
 return {load,update};
}
module.exports={criar,chave,segura,...criar()};
