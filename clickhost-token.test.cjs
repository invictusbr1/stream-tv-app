'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const source=require('./clickhost-source'),axios=require('axios');

const pagina=(extra='')=>`<script>window.ApiEmbedConfig = {
        streamUrl: null,
        streamIsHls: false,
        servers: [{"down": false, "id": 11541175, "is_hls": false, "label": "FlashTV (8200)", "speed": 55.2}, {"down": true, "id": 5, "label": "Morto", "speed": 1}, {"down": false, "id": 10714634, "is_hls": true, "label": "SpeedNET", "speed": null}, {"down": false, "id": 11440974, "label": "MegaVODS", "speed": 17.5}, {"down": false, "id": 77, "label": "Quarto", "speed": 900}],
        contentName: "Toy Story 5 (2026)",
      };${extra}</script>`;

test('extrairServidores: tira os fora do ar, ordena pelo mais rápido e sem velocidade vai por último', () => {
  assert.deepEqual(source.extrairServidores(pagina()).map(s=>s.id),[11440974,11541175,77,10714634]);
  assert.deepEqual(source.extrairServidores('nada aqui'),[]);
  assert.deepEqual(source.extrairServidores('servers: [quebrado,\n'),[]);
});

test('token só vale se for do próprio embed-api e do mesmo servidor', () => {
  assert.equal(source.enderecoDoToken(7,'/embed/stream/7?token=abcdefghijklmnopq'),'https://embed-api.clickhost.xyz/embed/stream/7?token=abcdefghijklmnopq');
  for(const ruim of ['https://evil.com/embed/stream/7?token=abcdefghijklmnopq','/embed/stream/8?token=abcdefghijklmnopq','/embed/stream/7?token=abc','/embed/stream/7?token=abcdefghijklmnopq&u=http://x','//evil.com/embed/stream/7?token=abcdefghijklmnopq'])
    assert.equal(source.enderecoDoToken(7,ruim),'',ruim);
});

test('resolverTodos usa os 3 servidores mais rápidos via /init e descarta respostas inválidas', async () => {
  const get=axios.get,post=axios.post,pedidos=[];
  try{
    axios.get=async()=>({data:pagina()});
    axios.post=async(url,_b,o)=>{pedidos.push(url);
      assert.match(o.headers.Referer,/^https:\/\/embed-api\.clickhost\.xyz\/embed\/filme\/1084244/);
      if(url.endsWith('/11440974/init'))return {data:{ok:true,url:'/embed/stream/11440974?token=AAAAAAAAAAAAAAAAAAAA',is_hls:false}};
      if(url.endsWith('/11541175/init'))return {data:{ok:true,url:'https://evil.com/x.mp4',is_hls:false}};
      if(url.endsWith('/77/init'))return {data:{ok:false}};
      throw Error('não deveria pedir este: '+url);};
    const lista=await source.resolverTodos('movie','1084244');
    assert.equal(pedidos.length,3,'só os 3 mais rápidos');
    assert.equal(lista.length,1);
    const [o]=lista;
    assert.equal(o.url,'https://embed-api.clickhost.xyz/embed/stream/11440974?token=AAAAAAAAAAAAAAAAAAAA');
    assert.equal(o.type,'file');assert.equal(o.final,false);assert.ok(o.exigeProva&&o.efemera);
    assert.equal(o.fonte,'ClickHost · MegaVODS');assert.equal(o.titulo,'Toy Story 5 (2026)');
    assert.equal((await source.resolver('movie','1084244')).url,o.url);
  }finally{axios.get=get;axios.post=post;}
});

test('o endereço antigo (streamUrl) continua valendo e vem primeiro', async () => {
  const get=axios.get,post=axios.post;
  try{
    axios.get=async()=>({data:'streamUrl: "https://cdn.example/video.mp4", streamIsHls: false\n'});
    axios.post=async()=>{throw Error('sem servidores, não deveria chamar /init');};
    const lista=await source.resolverTodos('movie','1084244');
    assert.equal(lista.length,1);assert.equal(lista[0].url,'https://cdn.example/video.mp4');assert.equal(lista[0].final,true);
  }finally{axios.get=get;axios.post=post;}
});

test('série monta o caminho do episódio e recusa número inválido', async () => {
  const get=axios.get;let pedido='';
  try{
    axios.get=async(u)=>{pedido=u;return {data:'sem nada\n'};};
    await source.resolverTodos('tv','1399','1','2');
    assert.equal(pedido,'https://embed-api.clickhost.xyz/embed/serie/1399/1/2?ad_played=1');
    assert.deepEqual(await source.resolverTodos('tv','1399','0','2'),[]);
    assert.deepEqual(await source.resolverTodos('movie','abc'),[]);
  }finally{axios.get=get;}
});
