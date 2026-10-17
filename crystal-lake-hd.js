'use strict';
// Somente a mídia do MGEB conferida em Crystal Lake, sem carregar seu player.
const BAD = /#EXT-X-(?:DATERANGE|CUE-|DISCONTINUITY|SESSION-DATA)|SCTE|INTERSTITIAL/i;
function segura(raw) {
    try { const u=new URL(raw); return u.protocol==='https:' && !u.username && !u.password && !u.port && !u.hash && /^(?:[a-z0-9-]+\.)*(?:97bf1\.com|s1q2105\.com)$/.test(u.hostname); } catch { return false; }
}
function master(text,base) {
    if(typeof text!=='string'||text.length>131072||!text.startsWith('#EXTM3U')||BAD.test(text))return null;
    const absolute=raw=>{const u=new URL(raw,base);u.pathname=u.pathname.replace(/\/{2,}/g,'/');return u.href;};
    try{text=text.split(/\r?\n/).map(l=>l.startsWith('#')?l.replace(/URI="([^"]+)"/g,(_,u)=>`URI="${absolute(u)}"`):l.trim()?absolute(l):l).join('\n');}catch{return null;}
    const lines=text.split(/\r?\n/),groups=new Set(),out=[];
    for(const l of lines)if(l.startsWith('#EXT-X-MEDIA:TYPE=AUDIO')&&/LANGUAGE="(?:por|pt(?:-BR)?|portuguese)"/i.test(l)){const g=/GROUP-ID="([^"]+)"/.exec(l);if(g)groups.add(g[1]);}
    let video=false,audio=false;
    for(let i=0;i<lines.length;i++){
        let l=lines[i];
        if(l.startsWith('#EXT-X-MEDIA:TYPE=AUDIO')){if(!/LANGUAGE="(?:por|pt(?:-BR)?|portuguese)"/i.test(l))continue;audio=true;l=l.replace(/DEFAULT=(YES|NO)/,'DEFAULT=YES');}
        if(l.startsWith('#EXT-X-I-FRAME-STREAM-INF:'))continue;
        if(l.startsWith('#EXT-X-STREAM-INF:')){
            const g=/AUDIO="([^"]+)"/.exec(l),size=/RESOLUTION=(\d+)x(\d+)/.exec(l),target=lines[++i];
            if(!g||!groups.has(g[1]))continue;
            if(!size||Number(size[2])<720||!segura(target))return null;
            video=true;out.push(l,target);continue;
        }
        if(!l.startsWith('#')&&l.trim())return null;
        for(const m of l.matchAll(/URI="([^"]+)"/g))if(!segura(m[1]))return null;
        out.push(l);
    }
    return video&&audio?out.join('\n'):null;
}
function limpa(text,base) {
    if(typeof text!=='string'||text.length>262144||!text.startsWith('#EXTM3U')||!text.includes('#EXT-X-ENDLIST')||BAD.test(text)||/#EXT-X-KEY:.*METHOD=(?!NONE)/i.test(text))return false;
    const targets=text.split(/\r?\n/).filter(l=>l.trim()&&!l.startsWith('#'));
    try{return targets.length>0&&targets.every(l=>segura(new URL(l,base).href))&&[...text.matchAll(/URI="([^"]+)"/g)].every(m=>segura(new URL(m[1],base).href));}catch{return false;}
}
async function resolver(episode,get,signal) {
    const d=await require('./mgeb-source').resolver('tv','213562',1,episode,{semCache:true});
    if(!d||d.type!=='hls'||!segura(d.url))return null;
    const playlist=master(await get(d.url,'https://mgeb.top/',signal),d.url);if(!playlist)return null;
    const targets=[...new Set([...playlist.matchAll(/URI="([^"]+)"/g)].map(m=>m[1]).concat(playlist.split('\n').filter(l=>l&&!l.startsWith('#'))))];
    if(targets.length>16||!(await Promise.all(targets.map(async u=>limpa(await get(u,'https://mgeb.top/',signal),u)))).every(Boolean))return null;
    return {url:d.url,playlist,referer:'https://mgeb.top/',until:Date.now()+300000,...require('./crystal-lake-source').qualidadeDaPlaylist(playlist)};
}
module.exports={segura,master,limpa,resolver};
