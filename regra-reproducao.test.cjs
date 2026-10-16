const {test}=require('node:test');
const assert=require('node:assert/strict');
const motor=require('./fontes-motor'),perfis=require('./perfis-locais');
require('./midia-proxy').validarMidia=async()=>true;
test('episódio tenta dublado antes de permitir HD original sem anúncio',async()=>{
 const fontes=[...motor.FONTES],listarPerfis=perfis.perfis,tentativas=[];
 try{
  // Fichas locais reais não devem fazer a regra simulada depender da internet.
  perfis.perfis=()=>[];
  motor.reiniciarParaTeste();
  motor.FONTES.splice(0,motor.FONTES.length,
   {id:'dub',papel:'dublado',peso:10000,resolver:async()=>{tentativas.push('dub');return null;}},
   {id:'hd',papel:'hd',peso:10000,resolver:async()=>{tentativas.push('hd');return {url:'https://example.test/master.m3u8',audio:'original',resolucao:'1080p'};}});
  const r=await require('./series-source').resolverEpisodio({tmdbId:213562,temporada:1,episodio:1});
  assert.equal(r.audio,'original');assert.deepEqual(tentativas,['dub','hd']);
 }finally{perfis.perfis=listarPerfis;motor.FONTES.splice(0,motor.FONTES.length,...fontes);motor.reiniciarParaTeste();}
});
