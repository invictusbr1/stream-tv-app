'use strict';
// Resolve somente o caminho de entrega do ClickHost. HTTP intermediário só
// serve para ler Location; a mídia devolvida ao APK exige HTTPS válido.
const axios=require('axios'),dns=require('node:dns').promises,http=require('node:http'),https=require('node:https');
const source=require('./clickhost-source'),{hostInterno}=require('./seguranca');
const redirects=new Set([301,302,303,307,308]);
function allowed(raw){
 const u=new URL(raw),h=u.hostname.toLowerCase();
 if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.port||u.href.length>4096||!(/^(froststream\.cloutteam\.com|srcine\.site|dbonline\.tech-cdn\.top|zjo\.lat)$/.test(h)||/^[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev$/.test(h)))throw Error('Destino não autorizado');
 return u;
}
async function request(url,deadline){
 let timer;const addresses=await Promise.race([dns.lookup(url.hostname,{all:true}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Prazo DNS')),Math.max(1,deadline-Date.now()));})]).finally(()=>clearTimeout(timer));
 const ipv4=addresses.filter(a=>a.family===4);
 if(!ipv4.length||ipv4.some(a=>hostInterno(a.address)))throw Error('Destino não público');
 const address=ipv4[0];
 // A conexão usa o endereço público já verificado, sem uma segunda resolução DNS.
 const lookup=(_host,options,cb)=>options?.all?cb(null,[address]):cb(null,address.address,address.family);
 const agent=url.protocol==='https:'?new https.Agent({lookup}):new http.Agent({lookup});
 try{
  const response=await axios.get(url.href,{proxy:false,httpAgent:agent,httpsAgent:agent,maxRedirects:0,responseType:'stream',timeout:Math.max(1,deadline-Date.now()),headers:{'User-Agent':'Mozilla/5.0',Referer:source.BASE+'/',Range:'bytes=0-0','Accept-Encoding':'identity'},validateStatus:()=>true});
  response.data.destroy();return {status:response.status,location:response.headers.location,type:response.headers['content-type'],range:response.headers['content-range']};
 }finally{agent.destroy();}
}
async function resolve(input,{resolveSource=source.resolver,read=request,now=Date.now}={}){
 const type=String(input?.tipo||''),id=String(input?.id||''),season=String(input?.temporada||''),episode=String(input?.episodio||'');
 if(!['movie','tv'].includes(type)||!/^[1-9]\d{0,9}$/.test(id)||type==='tv'&&(!/^[1-9]\d{0,2}$/.test(season)||!/^[1-9]\d{0,3}$/.test(episode)))return null;
 const deadline=now()+Math.max(500,Math.min(4000,Number(input.prazoMs)||4000));
 let data;
 if(input.origem){
  const origin=allowed(input.origem);
  if(origin.protocol!=='https:'||origin.hostname!=='froststream.cloutteam.com'||origin.search||origin.hash||!new RegExp('^/'+(type==='movie'?'movie':'series')+'/v1\\.[A-Za-z0-9_-]{20,3500}$').test(origin.pathname))return null;
  data={url:origin.href,type:'file'};
 }else data=await resolveSource(type,id,season,episode,{prazo:deadline});
 if(!data||data.type!=='file')return null;
 let url=allowed(data.url);const seen=new Set();
 for(let step=0;step<8&&now()<deadline;step++){
  if(seen.has(url.href))return null;seen.add(url.href);
  const result=await read(url,deadline);
  if(redirects.has(result.status)&&result.location){url=allowed(new URL(result.location,url).href);continue;}
  if(url.protocol==='http:'){url.protocol='https:';continue;}
  if((result.status!==200&&result.status!==206)||!/^video\/mp4(?:;|$)/i.test(result.type||'')||result.status===206&&!/^bytes 0-0\/\d+$/.test(result.range||''))return null;
  return {url:url.href,type:'file'};
 }
 return null;
}
module.exports={resolve,allowed};
