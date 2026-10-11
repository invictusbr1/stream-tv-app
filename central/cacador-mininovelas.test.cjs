const test = require('node:test');
const assert = require('node:assert/strict');
const { cacarMininovelas } = require('./cacador-mininovelas');
test('caçador de mininovelas deixa fornecedor sem conector pendente e não promove catálogo sem vídeo', async () => {
    const resultado = await cacarMininovelas({ buscar:async () => { throw Error('fora do ar'); }, tocar:async () => { throw Error('Não deve chamar'); } });
    assert.equal(resultado.candidatas.length,8);
    assert.equal(resultado.candidatas.filter(c => c.situacao === 'pendente').length,5);
    assert.deepEqual(resultado.ranking,[]);
    assert.ok(resultado.candidatas.every(c => c.situacao !== 'promover'));
});


test('cacador Doraminhas confere a liberacao novamente antes de testar a midia',async()=>{
 const id='6a82c99340ac06f38d00f8b2',midia='https://v-mps.crazymaplestudios.com/public.m3u8';
 for(const bloqueado of [false,true]){
  let tocadas=0;
  const r=await cacarMininovelas({buscar:async u=>{
   if(u==='https://doraminhatv.com.br/')return `<a href="/serie/novela-rs${id}"><img alt="Novela" src="https://v-img.crazymaplestudios.com/capa.jpg"></a>`;
   if(u.includes('p=reelshort%2Fdetail'))return JSON.stringify({id,episodes:[{number:1,locked:false}]});
   if(u.includes('p=reelshort%2Fepisode'))return JSON.stringify({number:1,locked:bloqueado,videoUrl:midia});
   throw Error('fora do ar');
  },tocar:async u=>{assert.equal(u,midia);tocadas++;return {tocou:true,altura:1920};}});
  assert.equal(tocadas,bloqueado?0:1);const d=r.candidatas.find(c=>c.nome==='Doraminhas TV');assert.equal(d.provas[0].tocou,!bloqueado);
 }
});
