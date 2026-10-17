'use strict';
// Compatibility fallback for an approved provider, without opening its player page.
const fenix = require('./fenix-source');
const BASE = 'https://fenixflix.fenixhub.online';
function candidatos(streams) {
    return (Array.isArray(streams) ? streams : []).filter(s => {
        if (!s || !/dublado|dual|pt-br/i.test(String(s.title || '')) || /legendado/i.test(String(s.title || ''))) return false;
        try { const u = new URL(s.url); return u.origin === BASE && !u.username && !u.password && /\/video\.mp4$/.test(u.pathname); } catch { return false; }
    }).slice(0, 8);
}
function escolher(medidas) {
    return medidas.filter(x => {
        const v = x?.medida?.imagem;
        return v?.codec === 'h264' && /^(yuv420p|yuvj420p)$/.test(v.pixels) && v.altura > 0 && v.largura > 0
            && x.medida.faixas.some(a => /^(pt|por)(-|$)/i.test(a.idioma) && a.padrao && a.codec === 'aac');
    }).sort((a,b) => (b.medida.imagem.largura*b.medida.imagem.altura)-(a.medida.imagem.largura*a.medida.imagem.altura))[0] || null;
}
function criar({ buscar, medir, imdbDe = fenix.imdbDe, agora = Date.now } = {}) {
    const cache = new Map(), pending = new Map();
    return async function resolver(alvo) {
        const tipo = alvo.tipo === 'tv' ? 'tv' : 'movie';
        if (!/^\d{1,10}$/.test(String(alvo.tmdbId))) return null;
        if (tipo === 'tv' && ![alvo.temporada,alvo.episodio].every(x=>/^[1-9]\d{0,3}$/.test(String(x)))) return null;
        const key = `${tipo}:${alvo.tmdbId}:${alvo.temporada||''}:${alvo.episodio||''}`;
        const saved=cache.get(key); if(saved?.expira>agora()) return saved.valor;
        if(pending.has(key))return pending.get(key);
        const job=(async()=>{
            const imdb=await imdbDe(alvo.tmdbId,tipo); if(!/^tt\d+$/.test(imdb||''))return null;
            const path=tipo==='tv'?`series/${imdb}:${alvo.temporada}:${alvo.episodio}`:`movie/${imdb}`;
            const dados=await buscar(`${BASE}/stream/${path}.json`);
            const medidas=await Promise.all(candidatos(dados?.streams).map(async stream=>{
                try{return {stream,medida:await medir(stream.url,BASE+'/')};}catch{return null;}
            }));
            const best=escolher(medidas.filter(Boolean)); if(!best)return null;
            const v=best.medida.imagem;
            const valor={url:best.stream.url,referer:BASE+'/',fonte:'FenixFlix (FenixHub)',fonteId:'fenixflix-fenixhub',audio:'pt-BR',type:'file',videoCodec:'h264',resolucao:Math.round(Math.max(v.altura,v.largura*9/16))+'p'};
            if(cache.size>=128)cache.delete(cache.keys().next().value);
            cache.set(key,{valor,expira:agora()+5*60000});return valor;
        })().catch(()=>null).finally(()=>pending.delete(key));
        pending.set(key,job);return job;
    };
}
const resolver=criar({
    buscar:async url=>{const r=await require('axios').get(url,{timeout:12000,maxContentLength:500000,headers:{Accept:'application/json'}});return r.data;},
    medir:(url,referer)=>require('./central/verificar-midia').faixasDeAudio(url,referer,{timeout:10000}),
});
module.exports={criar,candidatos,escolher,resolver};
