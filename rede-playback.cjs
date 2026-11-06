'use strict';
function enderecoPlayback(req,fonte){
 if(fonte&&fonte.segredo)return require('./fontes-motor').prepararParaPlayer(fonte).urlAplicativo;
 if(req.query?.transporte!=='servidor')return fonte.final?fonte.url:fonte.urlAplicativo;
 const raw=String(fonte.urlAplicativo||fonte.url||'');
 if(/^\/api\/(?:hls\?|convertido\/|crystal-lake\/|torbox\/[a-f0-9]{32}$)/.test(raw))return raw;
 const url=new URL(String(fonte.url||''));
 if(url.protocol!=='https:'||url.username||url.password||(url.port&&url.port!=='443')||require('./seguranca').hostInterno(url.hostname))throw Error('Mídia inválida');
 return require('./fontes-motor').prepararParaPlayer({...fonte,final:false}).urlAplicativo;
}
module.exports={enderecoPlayback};
