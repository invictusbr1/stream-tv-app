const {test}=require('node:test'),assert=require('node:assert/strict'),{enderecoPlayback}=require('./rede-playback.cjs');
test('recuperação de rede mantém qualidade e encaminha arquivo final somente quando solicitado',()=>{
 const f={url:'https://media.invalid/4k.mp4',audio:'pt-BR',final:true,resolucao:'2160p'};
 assert.equal(enderecoPlayback({query:{}},f),f.url);const p=enderecoPlayback({query:{transporte:'servidor'}},f);assert(p.startsWith('/api/hls?'));assert.equal(f.final,true);assert.equal(f.resolucao,'2160p');assert(!p.includes('codigo'));
 assert.equal(enderecoPlayback({query:{transporte:'servidor'}},{urlAplicativo:'/api/hls?u=existing'}),'/api/hls?u=existing');
 for(const url of ['http://cdn.invalid/a.mp4','https://localhost/a.mp4','https://127.0.0.1/a.mp4','https://user:password@cdn.invalid/a.mp4'])assert.throws(()=>enderecoPlayback({query:{transporte:'servidor'}},{url,final:true}));
});
