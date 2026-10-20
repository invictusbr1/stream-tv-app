const test = require('node:test');
const assert = require('node:assert/strict');
const { analisarPlaylist, notaDaFonte } = require('./avaliador');
// Testes do avaliador não consultam nem alteram a memória real de fornecedores.
require('./midias-memoria.cjs').load=()=>[];
require('./midias-memoria.cjs').update=()=>{};
require('./mp4-rapido.cjs').ler=async()=>null;

test('fonte com link curto é resolvida novamente e não usa histórico antigo',async()=>{
 const a=require('./avaliador'),m=require('./fontes-motor'),v=require('./central/verificar-midia');
 const original=Object.fromEntries(['filaDeFontes','lerIdiomasVerificados','registrarSucesso','anotarEscolha','registrarFalha'].map(k=>[k,m[k]])),probe=v.faixasDeAudio;let calls=0;
 try{
  m.filaDeFontes=()=>[{id:'clickhost',efemera:true,resolver:async()=>({url:'https://media.invalid/curto.mp4?token='+ ++calls,type:'file',audio:'pt-BR',efemera:true,exigeProva:true})}];
  m.lerIdiomasVerificados=()=>({});m.registrarSucesso=()=>{};m.anotarEscolha=()=>{};m.registrarFalha=()=>{};
  v.faixasDeAudio=async()=>({imagem:{largura:3840,altura:2160,codec:'hevc'},faixas:[{idioma:'por',padrao:true,codec:'aac'}]});
  const memoria={load:(key,ids)=>{assert(!ids.includes('clickhost'));return [];},update:()=>{}};
  const target={tipo:'movie',tmdbId:'9999090'};
  const first=await a.escolherMelhor('dublado',target,{memoria}),second=await a.escolherMelhor('dublado',target,{memoria});
  assert.equal(calls,2);assert.notEqual(first.escolhido.url,second.escolhido.url);assert.equal(second.escolhido.resolucao,'2160p');
 }finally{Object.assign(m,original);v.faixasDeAudio=probe;a.limparCache();}
});

test('compatibilidade AVC vale também no cache e não recai no HEVC incompatível',async()=>{
 const a=require('./avaliador'),m=require('./fontes-motor'),v=require('./central/verificar-midia');
 const original=Object.fromEntries(['filaDeFontes','lerIdiomasVerificados','registrarSucesso','anotarEscolha','registrarFalha'].map(k=>[k,m[k]])),probe=v.faixasDeAudio;
 try{
  let onlyHevc=false;
  m.filaDeFontes=()=>[{id:'teste',resolverTodos:async()=>[...(onlyHevc?[]:[{url:'https://media.invalid/avc.mp4',type:'file',audio:'pt-BR'}]),{url:'https://media.invalid/hevc.mp4',type:'file',audio:'pt-BR'}]}];
  m.lerIdiomasVerificados=()=>({});m.registrarSucesso=()=>{};m.anotarEscolha=()=>{};m.registrarFalha=()=>{};
  v.faixasDeAudio=async url=>({imagem:{largura:url.includes('/hevc')?3840:1920,altura:url.includes('/hevc')?2160:1080,codec:url.includes('/hevc')?'hevc':'h264'},faixas:[{idioma:'por',padrao:true,codec:'aac'}]});
  const target={tipo:'movie',tmdbId:'9999088'};
  for(let i=0;i<2;i++)assert.match((await a.escolherMelhor('dublado',target,{codec:'avc'})).escolhido.url,/avc/);
  assert.match((await a.escolherMelhor('dublado',target,{codec:'hevc'})).escolhido.url,/hevc/);
  a.limparCache();onlyHevc=true;assert.equal(await a.escolherMelhor('dublado',target,{codec:'avc'}),null);
 }finally{Object.assign(m,original);v.faixasDeAudio=probe;a.limparCache();}
});

test('checagem conhecida passa à frente das alternativas ainda na fila, mantendo duas leituras físicas',async()=>{
 const a=require('./avaliador'),v=require('./central/verificar-midia'),original=v.faixasDeAudio;
 const pending=[],calls=[];let active=0,max=0;
 try{
  v.faixasDeAudio=url=>{calls.push(url);max=Math.max(max,++active);return new Promise(resolve=>pending.push(()=>{active--;resolve({imagem:{largura:3840,altura:1600},faixas:[{idioma:'por',padrao:true}]});}));};
  const read=(name,prioritaria=false)=>a.sondarArquivo('https://media.invalid/'+name+'.mp4','',{timeout:3000,prioritaria});
  const jobs=[read('ocupada1'),read('ocupada2'),read('alternativa'),read('conhecida',true)];
  pending.shift()();await new Promise(setImmediate);assert.match(calls[2],/conhecida/);assert.equal(max,2);
  while(pending.length){pending.shift()();await new Promise(setImmediate);}await Promise.all(jobs);
 }finally{while(pending.length)pending.shift()();v.faixasDeAudio=original;a.limparCache();}
});

test('consulta lenta e medição tardia não escondem Full HD dublado atrás do 360p',async()=>{
 const a=require('./avaliador'),m=require('./fontes-motor'),v=require('./central/verificar-midia'),proxy=require('./midia-proxy');
 const original=Object.fromEntries(['filaDeFontes','lerIdiomasVerificados','registrarSucesso','anotarEscolha','registrarFalha'].map(k=>[k,m[k]])),probe=v.faixasDeAudio,validate=proxy.validarMidia;
 const wait=ms=>new Promise(r=>setTimeout(r,ms)),data=name=>({url:'https://media.invalid/'+name+'.mp4',type:'file',audio:'pt-BR'});
 try{
  m.filaDeFontes=()=>[{id:'rapida',resolver:async()=>data('360')},{id:'lenta',resolverTodos:async()=>{await wait(3700);return [data('1080'),data('foreign4k')];}}];
  m.lerIdiomasVerificados=()=>({[m.chaveDoTitulo({tipo:'movie',tmdbId:'9999035'})]:{lenta:'pt'}});m.registrarSucesso=()=>{};m.anotarEscolha=()=>{};m.registrarFalha=()=>{};proxy.validarMidia=async()=>true;
  v.faixasDeAudio=async url=>{const high=url.includes('1080'),foreign=url.includes('foreign');if(high)await wait(3100);return {imagem:{largura:foreign?3840:high?1920:640,altura:foreign?2160:high?800:360},faixas:[{idioma:foreign?'eng':'por',padrao:true}]};};
  const start=Date.now(),result=await a.escolherMelhor('dublado',{tipo:'movie',tmdbId:'9999035'},{semCache:true});
  assert.match(result.escolhido.url,/1080/);assert.equal(result.escolhido.resolucao,'1080p');assert(Date.now()-start<10000);
 }finally{Object.assign(m,original);v.faixasDeAudio=probe;proxy.validarMidia=validate;a.limparCache();}
});

test('limita leituras físicas simultâneas e compartilha URL repetida sem baixar os arquivos completos',async()=>{
 const a=require('./avaliador'),v=require('./central/verificar-midia'),original=v.faixasDeAudio;
 const resolvers=[];let active=0,max=0,calls=0;
 try{
  v.faixasDeAudio=()=>{calls++;active++;max=Math.max(max,active);return new Promise(resolve=>resolvers.push(()=>{active--;resolve({imagem:{largura:3840,altura:2160},faixas:[{idioma:'por',padrao:true}]});}));};
  const jobs=[1,2,3,1].map(n=>a.sondarArquivo('https://media.invalid/pool-'+n+'.mp4','',{timeout:3000}));
  assert.equal(calls,2);resolvers.shift()();await new Promise(setImmediate);assert.equal(calls,3);
  while(resolvers.length)resolvers.shift()();const results=await Promise.all(jobs);
  assert.equal(max,2);assert.equal(calls,3);assert(results.every(r=>r.largura===3840&&r.padraoPortugues));
 }finally{while(resolvers.length)resolvers.shift()();v.faixasDeAudio=original;a.limparCache();}
});

test('segunda leitura recupera 4K da mesma fonte depois de HD e não congela fonte temporariamente ausente',async()=>{
 const a=require('./avaliador'),motor=require('./fontes-motor'),v=require('./central/verificar-midia'),proxy=require('./midia-proxy');
 const original=Object.fromEntries(['filaDeFontes','lerIdiomasVerificados','registrarSucesso','anotarEscolha','registrarFalha'].map(k=>[k,motor[k]])),probe=v.faixasDeAudio,validate=proxy.validarMidia,date=Date.now;
 let phase='retry',reads=0,listingCalls=0,clock=0;
 const low={url:'https://media.invalid/hd.mp4',type:'file',audio:'pt-BR',resolucao:'720p'},high={url:'https://media.invalid/highest',type:'file',audio:'pt-BR',resolucao:'2160p',exigeProva:true};
 try{
  Date.now=()=>date()+clock;
  motor.filaDeFontes=()=>[{id:'addon',resolverTodos:async()=>{listingCalls++;return phase==='missing'?[low]:[low,high];}},{id:'temporaria',resolver:async()=>phase==='missing'?null:low}];
  motor.lerIdiomasVerificados=()=>({});motor.registrarSucesso=()=>{};motor.anotarEscolha=()=>{};motor.registrarFalha=()=>{};
  proxy.validarMidia=async()=>true;
  v.faixasDeAudio=async (url,ref,options={})=>{const h=url.includes('highest');if(h&&phase==='retry'&&++reads===1)return null;if(h&&phase==='slow'&&options.timeout<4500)return null;return {imagem:{largura:h?3840:1280,altura:h?2160:720},faixas:[{idioma:'por',padrao:true,codec:'aac'}]};};
  const target={tipo:'movie',tmdbId:'9999001'};
  let result=await a.escolherMelhor('dublado',target);assert.equal(result.escolhido.url,high.url);assert.equal(reads,2);
  a.limparCache();phase='slow';result=await a.escolherMelhor('dublado',target);assert.equal(result.escolhido.url,high.url,'a sonda deve poder concluir em 4,5s dentro do orçamento total');
  a.limparCache();phase='missing';result=await a.escolherMelhor('dublado',target);assert.equal(result.escolhido.url,low.url);const before=listingCalls;
  phase='available';clock+=1600;result=await a.escolherMelhor('dublado',target);assert.equal(result.escolhido.url,high.url);assert(listingCalls>before);
  a.limparCache();v.faixasDeAudio=async url=>url.includes('highest')?null:{imagem:{largura:1280,altura:720},faixas:[{idioma:'por',padrao:true,codec:'aac'}]};
  result=await a.escolherMelhor('dublado',target);assert.equal(result.escolhido.url,low.url,'endereço sem extensão exige prova; promessa 4K não basta');
 }finally{Date.now=date;Object.assign(motor,original);v.faixasDeAudio=probe;proxy.validarMidia=validate;a.limparCache();}
});

test('fonte 4K fora do índice só vence após nova prova de português e imagem; falha ou idioma diferente usa atual',async()=>{
 const a=require('./avaliador'),motor=require('./fontes-motor'),v=require('./central/verificar-midia'),proxy=require('./midia-proxy');
 const original=Object.fromEntries(['filaDeFontes','lerIdiomasVerificados','registrarSucesso','anotarEscolha','registrarFalha'].map(k=>[k,motor[k]])),probe=v.faixasDeAudio,validate=proxy.validarMidia;
 const dados=url=>({url:'https://media.invalid/'+url+'.mp4',referer:'https://media.invalid/',type:'file',audio:'pt-BR',fonte:'Dublado'});
 let state='pt',oldCalls=0,failures=0,validations=0;
 try{
  motor.filaDeFontes=()=>[{id:'fenix',nome:'Dublado',resolver:async()=>dados('atual')}];motor.lerIdiomasVerificados=()=>({});motor.registrarSucesso=()=>{};motor.anotarEscolha=()=>{};motor.registrarFalha=()=>{failures++;};
  proxy.validarMidia=async url=>{validations++;return !(url.includes('antiga')&&(state==='pt'||state==='dead'));};
  v.faixasDeAudio=async url=>{const old=url.includes('antiga');if(old)oldCalls++;if(old&&state==='dead')return null;return {imagem:{largura:old?3832:1920,altura:old?1600:800,codec:old?'hevc':'h264'},faixas:[{idioma:old&&state==='en'?'eng':'por',padrao:true,codec:'aac'}]};};
  const memoria={load:()=>[{id:'fenix',dados:dados('antiga')}],update:()=>{}};
  const target={tipo:'movie',tmdbId:'969681'};
  let result=await a.escolherMelhor('dublado',target,{memoria,semCache:true});assert.match(result.escolhido.url,/antiga/);assert.equal(result.escolhido.resolucao,'2156p');assert.equal(validations,0,'metadados válidos não precisam de uma segunda requisição ao gateway');
  // A escolha lembrada precisa ser sondada novamente, inclusive com cache da avaliação.
  state='en';result=await a.escolherMelhor('dublado',target,{memoria});assert.match(result.escolhido.url,/atual/);assert.equal(oldCalls,2);
  state='dead';result=await a.escolherMelhor('dublado',target,{memoria,semCache:true});assert.match(result.escolhido.url,/atual/);assert.equal(failures,0);
 }finally{Object.assign(motor,original);v.faixasDeAudio=probe;proxy.validarMidia=validate;a.limparCache();}
});

// Os testes usam endereços fictícios: a conferência de entrega de vídeo (feita
// pela internet) é simulada como "sempre entrega".
require('./midia-proxy').validarMidia = async () => true;

// Lista mestre parecida com as dos provedores (qualidades + áudio + legenda).
const LISTA = [
    '#EXTM3U',
    '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a1",NAME="Português",LANGUAGE="pt-BR",DEFAULT=YES',
    '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a1",NAME="English",LANGUAGE="en",DEFAULT=NO',
    '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="s1",NAME="Português",LANGUAGE="pt-BR"',
    '#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360,AUDIO="a1"',
    '360p.m3u8',
    '#EXT-X-STREAM-INF:BANDWIDTH=2800000,RESOLUTION=1280x720,AUDIO="a1"',
    '720p.m3u8',
    '#EXT-X-STREAM-INF:BANDWIDTH=5200000,RESOLUTION=1920x1080,AUDIO="a1"',
    '1080p.m3u8',
].join('\n');

test('lê a lista do provedor: melhor formato, idiomas e legendas', () => {
    const analise = analisarPlaylist(LISTA);
    assert.equal(analise.mestre, true);
    assert.equal(analise.altura, 1080);
    assert.equal(analise.banda, 5200000);
    assert.deepEqual(analise.audios.map(a => a.lang), ['pt-br', 'en']);
    assert.deepEqual(analise.legendas, ['pt-br']);
});

test('lista sem qualidades (arquivo único) não inventa altura', () => {
    const analise = analisarPlaylist('#EXTM3U\n#EXTINF:6,\nseg1.ts\n');
    assert.equal(analise.mestre, false);
    assert.equal(analise.altura, 0);
});

test('lista de qualidade única mede segmento claro na mesma origem e preserva idioma da lista', async () => {
    const avaliador = require('./avaliador'), verificador = require('./central/verificar-midia'), axios = require('axios');
    const getOriginal = axios.get, probeOriginal = verificador.faixasDeAudio;
    const consultadas = [];
    try {
        avaliador.limparCache();
        axios.get = async () => ({ data: '#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,LANGUAGE="pt-BR"\n#EXTINF:6,\nsegmento.js\n' });
        verificador.faixasDeAudio = async (url, ref) => {
            consultadas.push([url, ref]);
            return { imagem: { largura: 1920, altura: 1080 }, faixas: [{ idioma: 'und', codec: 'aac' }] };
        };
        const sonda = await avaliador.sondarLista('https://qualidade.invalid/lista/index.m3u8','https://qualidade.invalid/');
        assert.equal(sonda.altura, 1080);
        assert.equal(sonda.largura, 1920);
        assert(sonda.audios.some(a => a.lang === 'pt-br'));
        assert.deepEqual(consultadas, [['https://qualidade.invalid/lista/segmento.js','https://qualidade.invalid/']]);
        for (const texto of ['#EXTM3U\nhttps://outro.invalid/segmento.ts', '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key"\nsegmento.ts', '#EXTM3U\nhttps://user:password@qualidade.invalid/segmento.ts']) {
            axios.get = async () => ({ data: texto });
            assert.equal((await avaliador.sondarLista('https://qualidade.invalid/lista.m3u8')).altura, 0);
        }
        assert.equal(consultadas.length, 1);
    } finally { axios.get = getOriginal;verificador.faixasDeAudio = probeOriginal;avaliador.limparCache(); }
});

test('180p medido prevalece sobre a promessa de 2160p e perde para HD medido', () => {
    const medida = { dados: { audio: 'pt-BR', resolucao: '2160p' }, sonda: { altura: 180 }, idiomaVerificado: 'pt', ms: 900 };
    const baixa = notaDaFonte(medida);
    const hd = notaDaFonte({ ...medida, dados: { audio: 'pt-BR', resolucao: '720p' }, sonda: { altura: 720 } });
    assert.equal(baixa.detalhes.qualidade, '180p medido');
    assert(baixa.nota < hd.nota);
});

test('qualidade anunciada só serve como reserva e é identificada como informada', () => {
    const anunciada = notaDaFonte({ dados: { audio: 'pt-BR', resolucao: '1080p' }, sonda: null, idiomaVerificado: '', ms: 900 });
    assert.equal(anunciada.detalhes.qualidade, '1080p informado pela fonte');
    const semMedida = notaDaFonte({ dados: { audio: 'pt-BR' }, sonda: null, idiomaVerificado: '', ms: 900 });
    assert.equal(semMedida.detalhes.qualidade, 'não mediu a altura');
});

test('rótulos de qualidade não misturam resolução com canais de áudio ou outros números', () => {
    for (const [resolucao,altura] of [['1080p · áudio 5.1',1080],['1920 × 1080',1080],['Full HD',1080],['4K HDR10',2160],['HD',720]]) {
        assert.equal(notaDaFonte({dados:{resolucao},sonda:null,ms:1}).detalhes.qualidade, altura+'p informado pela fonte');
    }
});

test('a reserva de conversão não apresenta o rótulo da fonte como resolução medida', () => {
    const avaliada = notaDaFonte({
        dados: { audio: 'pt-BR', resolucao: '1080p', converter: true },
        sonda: { conversao: true, altura: 1080 }, idiomaVerificado: '', ms: 900,
    });
    assert.equal(avaliada.detalhes.qualidade, '1080p informado pela fonte');
});

// A régua das regras: dublado confirmado manda; outro idioma elimina.
test('português confirmado com 1080p vence fonte que só avisa que é dublada', () => {
    const confirmada = notaDaFonte({
        dados: { url: 'https://x/a.m3u8', audio: 'pt-BR', resolucao: '1080p' },
        sonda: { altura: 1080, banda: 5200000, audios: [{ lang: 'pt-br' }], legendas: [] },
        idiomaVerificado: 'pt', ms: 1200,
    });
    const apenasAvisa = notaDaFonte({
        dados: { url: 'https://x/b.m3u8', audio: 'pt-BR', resolucao: '720p' },
        sonda: { altura: 720, banda: 2800000, audios: [{ lang: 'pt-br' }], legendas: [] },
        idiomaVerificado: '', ms: 1200,
    });
    assert(confirmada.nota > apenasAvisa.nota);
    assert.match(confirmada.detalhes.idioma, /confirmado/);
});

test('fonte que a central ouviu em outro idioma perde da que só tem legenda', () => {
    const ingles = notaDaFonte({
        dados: { url: 'https://x/a.m3u8', audio: 'pt-BR', resolucao: '1080p' },
        sonda: { altura: 1080, banda: 5200000, audios: [], legendas: [] },
        idiomaVerificado: 'outro', ms: 900,
    });
    const original = notaDaFonte({
        dados: { url: 'https://x/b.m3u8', audio: 'original', resolucao: '720p' },
        sonda: { altura: 720, banda: 2000000, audios: [], legendas: ['pt-br'] },
        idiomaVerificado: '', ms: 900,
    });
    assert(ingles.nota < original.nota);
});

test('fonte que precisa de conversão é descontada (mas continua na disputa)', () => {
    const comConversao = notaDaFonte({
        dados: { url: 'https://x/filme.mkv', audio: 'pt-BR', resolucao: '1080p', converter: true },
        sonda: null, idiomaVerificado: 'pt', ms: 1000,
    });
    const direta = notaDaFonte({
        dados: { url: 'https://x/a.m3u8', audio: 'pt-BR', resolucao: '1080p' },
        sonda: { altura: 1080, banda: 2000000, audios: [], legendas: [] },
        idiomaVerificado: 'pt', ms: 1000,
    });
    assert(comConversao.nota < direta.nota);
    assert.match(comConversao.detalhes.conversao, /converter/);
});

test('consulta também a sexta fonte e escolhe Full HD com português em vez de HD', async () => {
    const motor = require('./fontes-motor');
    const axios = require('axios');
    const originais = Object.fromEntries(['filaDeFontes', 'lerIdiomasVerificados', 'registrarSucesso', 'anotarEscolha'].map(nome => [nome, motor[nome]]));
    const getOriginal = axios.get;
    const consultadas = [];
    let liberarFonteLenta;
    const primeiraSonda = new Promise(resolve => { liberarFonteLenta = resolve; });
    try {
        motor.filaDeFontes = () => [720, 720, 720, 720, 720, 1080].map((altura, indice) => ({
            id: 'regressao-qualidade-' + indice,
            resolver: async () => {
                consultadas.push(indice);
                // Uma consulta ainda está pendente quando a primeira fonte
                // chega. A medição dela deve começar sem esperar essa consulta.
                if (indice === 2) await primeiraSonda;
                return { url: `https://qualidade.invalid/${altura}.m3u8`, audio: 'pt-BR', resolucao: altura + 'p' };
            },
        }));
        motor.lerIdiomasVerificados = () => ({});
        motor.registrarSucesso = () => {};
        motor.anotarEscolha = () => {};
        axios.get = async url => {
            liberarFonteLenta();
            return { data: '#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,LANGUAGE="pt-BR"\n#EXT-X-STREAM-INF:BANDWIDTH=2800000,RESOLUTION=' + (url.includes('1080') ? '1920x1080' : '1280x720') + '\nvideo.m3u8' };
        };
        const resultado = await require('./avaliador').escolherMelhor('dublado', { tipo: 'movie', tmdbId: '969681' }, { semCache: true });
        assert.deepEqual(consultadas, [0, 1, 2, 3, 4, 5]);
        assert.equal(resultado.avaliacao.length, 6);
        assert.equal(resultado.escolhido.fonteId, 'regressao-qualidade-5');
        assert.equal(resultado.avaliacao[0].detalhes.qualidade, '1080p medido');
    } finally {
        Object.assign(motor, originais);
        axios.get = getOriginal;
    }
});

test('idioma e resolução prevalecem sobre velocidade, taxa e posição da fonte', () => {
    const { prioridadeDaFonte: p, compararPrioridade: comparar } = require('./avaliador');
    const base = { dados: { audio: 'pt-BR', resolucao: '1080p' }, sonda: { altura: 1080, largura: 1920, portuguesa: true, banda: 2000000 }, ms: 5000 };
    const hdRapida = { ...base, sonda: { altura: 720, largura: 1280, portuguesa: true, banda: 9000000 }, ms: 10, idiomaVerificado: 'pt' };
    assert(comparar(p(base), p(hdRapida)) < 0);
    assert(comparar(p({ ...base, sonda: { ...base.sonda, largura: 3840, altura: 1600 } }), p(base)) < 0);
    assert(comparar(p({ ...base, sonda: { ...base.sonda, largura: 1920, altura: 800 } }), p(hdRapida)) < 0);
    assert(comparar(p(base), p({ ...base, sonda: { altura: 2160, largura: 3840, audios: [{ lang: 'en' }] }, ms: 1 })) < 0);
    assert(comparar(p(base), p({ ...base, sonda: null, dados: { audio: 'pt-BR', resolucao: '2160p' } })) < 0);
});

test('mede o arquivo que precisa converter áudio sem transformar o rótulo em prova', async () => {
    const avaliador = require('./avaliador'), verificador = require('./central/verificar-midia');
    const original = verificador.faixasDeAudio;
    try {
        avaliador.limparCache();
        verificador.faixasDeAudio = async () => ({ imagem: { largura: 1280, altura: 720 }, faixas: [{ idioma: 'por', padrao: true, codec: 'eac3' }] });
        const dados = { url: 'https://qualidade.invalid/conversao.mkv', converter: true, resolucao: '2160p', audio: 'pt-BR' };
        const sonda = await avaliador.sondar(dados);
        assert.equal(sonda.altura, 720);
        assert.equal(sonda.padraoPortugues, true);
        assert.equal(avaliador.notaDaFonte({ dados, sonda, ms: 1 }).detalhes.qualidade, '720p medido');
    } finally { verificador.faixasDeAudio = original; avaliador.limparCache(); }
});

test('medição tardia melhora a próxima abertura sem repetir consulta nem vazar para outra exclusão', async () => {
    const avaliador = require('./avaliador'), motor = require('./fontes-motor'), verificador = require('./central/verificar-midia'), axios = require('axios');
    const originais = Object.fromEntries(['filaDeFontes', 'lerIdiomasVerificados', 'registrarSucesso', 'anotarEscolha'].map(nome => [nome, motor[nome]]));
    const getOriginal = axios.get, probeOriginal = verificador.faixasDeAudio;
    let concluir, consultas = 0;
    const pendente = new Promise(resolve => { concluir = resolve; });
    const arquivo = { url: 'https://qualidade.invalid/tardia.mp4', audio: 'pt-BR', resolucao: '1080p' };
    const alvo = { tipo: 'tv', tmdbId: '99000001', temporada: '2', episodio: '3' };
    try {
        avaliador.limparCache();
        const fontes = [
            { id: 'reserva-hd', resolver: async () => { consultas++; return { url: 'https://qualidade.invalid/hd.m3u8', audio: 'pt-BR' }; } },
            { id: 'arquivo-fhd', resolver: async () => { consultas++; return arquivo; } },
        ];
        motor.filaDeFontes = (_papel, _alvo, opcoes) => fontes.filter(f => !opcoes.exceto.includes(f.id));
        motor.lerIdiomasVerificados = () => ({});motor.registrarSucesso = () => {};motor.anotarEscolha = () => {};
        axios.get = async () => ({ data: '#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,LANGUAGE="pt-BR"\n#EXT-X-STREAM-INF:RESOLUTION=1280x720\n720.m3u8' });
        verificador.faixasDeAudio = () => pendente;
        const primeira = await avaliador.escolherMelhor('dublado', alvo);
        assert.equal(primeira.escolhido.fonteId, 'reserva-hd');
        concluir({ imagem: { largura: 1920, altura: 1080 }, faixas: [{ idioma: 'por', padrao: true, codec: 'aac' }] });
        await avaliador.sondar(arquivo);
        const segunda = await avaliador.escolherMelhor('dublado', alvo);
        assert.equal(segunda.escolhido.fonteId, 'arquivo-fhd');
        assert.equal(segunda.avaliacao[0].detalhes.qualidade, '1080p medido');
        assert.equal(consultas, 2);
        const excluida = await avaliador.escolherMelhor('dublado', alvo, { exceto: ['arquivo-fhd'] });
        assert.equal(excluida.escolhido.fonteId, 'reserva-hd');
        assert.equal(consultas, 3);
    } finally { concluir(null);Object.assign(motor, originais);axios.get = getOriginal;verificador.faixasDeAudio = probeOriginal;avaliador.limparCache(); }
});

test('Full HD sem etiqueta de idioma passa a vencer HD quando a fala do mesmo arquivo é confirmada, inclusive no cache',async()=>{
 const avaliador=require('./avaliador'),motor=require('./fontes-motor'),v=require('./central/verificar-midia'),axios=require('axios'),provas=require('./provas-idioma');
 const originais=Object.fromEntries(['filaDeFontes','lerIdiomasVerificados','lerProvasDeIdioma','registrarSucesso','anotarEscolha'].map(k=>[k,motor[k]]));
 const get=axios.get,probe=v.faixasDeAudio;let registros={},consultas=0;
 const alvo={tipo:'movie',tmdbId:'99000003'},titulo='movie:99000003',dados={url:'https://qualidade.invalid/sem-etiqueta.mp4',referer:'https://qualidade.invalid/',audio:'pt-BR',type:'file'};
 try{
  avaliador.limparCache();motor.lerIdiomasVerificados=()=>({});motor.lerProvasDeIdioma=()=>registros;motor.registrarSucesso=()=>{};motor.anotarEscolha=()=>{};
  motor.filaDeFontes=()=>[{id:'hd',resolver:async()=>{consultas++;return {url:'https://qualidade.invalid/hd.m3u8',type:'hls',audio:'pt-BR'};}},{id:'fullhd',resolver:async()=>{consultas++;return dados;}}];
  axios.get=async()=>({data:'#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,LANGUAGE="pt-BR"\n#EXT-X-STREAM-INF:RESOLUTION=1280x720\nhd.m3u8'});
  v.faixasDeAudio=async()=>({imagem:{largura:1920,altura:1080,codec:'h264'},faixas:[{idioma:'und',padrao:true,codec:'aac'}]});
  const opcoes={codec:'avc',memoria:{load:()=>[],update:()=>{}}};
  // HLS e arquivo podem informar o codec em formatos diferentes; sem filtro
  // aqui a regressão isola apenas a evidência de áudio e a decisão em cache.
  delete opcoes.codec;
  assert.equal((await avaliador.escolherMelhor('dublado',alvo,opcoes)).escolhido.fonteId,'hd');
  registros.a={titulo,midiaHash:provas.identidade(titulo,'fullhd',dados.url,dados.referer),idioma:'pt',em:new Date().toISOString()};
  const melhor=await avaliador.escolherMelhor('dublado',alvo,opcoes);
  assert.equal(melhor.escolhido.fonteId,'fullhd');assert.equal(melhor.escolhido.resolucao,'1080p');assert.equal(melhor.cache,true);assert.equal(consultas,2);
  registros.a={...registros.a,midiaHash:provas.identidade(titulo,'fullhd',dados.url+'outro',dados.referer)};
  assert.equal((await avaliador.escolherMelhor('dublado',alvo,opcoes)).escolhido.fonteId,'hd');
 }finally{Object.assign(motor,originais);axios.get=get;v.faixasDeAudio=probe;avaliador.limparCache();}
});

test('preserva medição confirmada do mesmo arquivo, sem reaproveitar outro endereço ou referenciador', async () => {
    const avaliador = require('./avaliador');
    const verificador = require('./central/verificar-midia');
    const original = verificador.faixasDeAudio;
    let consultas = 0;
    try {
        avaliador.limparCache();
        verificador.faixasDeAudio = async () => {
            consultas++;
            if (consultas !== 1) throw new Error('medição indisponível agora');
            return { imagem: { largura: 3832, altura: 1600 }, faixas: [{ idioma: 'por', padrao: true, codec: 'aac' }] };
        };
        const arquivo = { url: 'https://qualidade.invalid/filme.mp4', referer: 'https://qualidade.invalid/' };
        const primeira = await avaliador.sondar(arquivo);
        const repetida = await avaliador.sondar(arquivo);
        assert.equal(repetida.altura, 1600);
        assert.equal(repetida.padraoPortugues, true);
        assert.deepEqual(repetida, primeira);
        assert.equal(consultas, 1);
        assert.equal(await avaliador.sondar({ ...arquivo, url: arquivo.url + '?versao=nova' }), null);
        assert.equal(await avaliador.sondar({ ...arquivo, referer: 'https://outro.invalid/' }), null);
        assert.equal(consultas, 3);
        // Falhas de medição não são guardadas como resultado definitivo.
        assert.equal(await avaliador.sondar({ ...arquivo, url: arquivo.url + '?versao=nova' }), null);
        assert.equal(consultas, 4);
    } finally {
        verificador.faixasDeAudio = original;
        avaliador.limparCache();
    }
});

test('sondagens simultâneas do mesmo arquivo compartilham a leitura e limpar cache invalida a leitura antiga', async () => {
    const avaliador = require('./avaliador'), verificador = require('./central/verificar-midia');
    const original = verificador.faixasDeAudio;
    let concluir, consultas = 0;
    const pendente = new Promise(resolve => { concluir = resolve; });
    try {
        avaliador.limparCache();
        verificador.faixasDeAudio = () => { consultas++;return pendente; };
        const dados = { url:'https://qualidade.invalid/concorrente.mp4' };
        const uma = avaliador.sondar(dados), outra = avaliador.sondar(dados);
        assert.equal(consultas, 1);
        avaliador.limparCache();
        concluir({ imagem:{largura:1920,altura:1080},faixas:[{idioma:'por',padrao:true}] });
        const [a,b] = await Promise.all([uma,outra]);
        assert.equal(a.altura,1080);assert.deepEqual(a,b);
        await avaliador.sondar(dados);
        assert.equal(consultas,2);
    } finally { concluir(null);verificador.faixasDeAudio=original;avaliador.limparCache(); }
});


test('gavetas só aprovam qualidade medida e português, inclusive recortes de cinema',()=>{
 const a=require('./avaliador');
 assert.equal(a.gavetaDaAltura(3832*9/16),5);
 assert.deepEqual([4320,2160,1440,1080,720,480,0].map(a.gavetaDaAltura),[6,5,4,3,2,1,0]);
 const base={dados:{audio:'pt-BR',resolucao:'2160p'},sonda:null,ms:1};
 assert.equal(a.prioridadeDaFonte(base)[2],0);
 const hd={...base,sonda:{largura:1280,altura:720,padraoPortugues:true}};
 const fhd={...base,sonda:{largura:1920,altura:800,padraoPortugues:true}};
 assert.equal(a.prioridadeDaFonte(hd)[2],2);
 assert.equal(a.prioridadeDaFonte(fhd)[2],3);
 assert(a.compararPrioridade(a.prioridadeDaFonte(fhd),a.prioridadeDaFonte(hd))<0);
 assert.equal(a.prioridadeDaFonte({...base,sonda:{largura:7680,altura:4320,audios:[{lang:'en'}]}})[2],0);
});

test('abre gavetas superiores primeiro na fila e ainda mede a reserva HD',async()=>{
 const a=require('./avaliador'),v=require('./central/verificar-midia'),original=v.faixasDeAudio;
 const pending=[],calls=[];
 try{
  a.limparCache();v.faixasDeAudio=url=>{calls.push(url);return new Promise(resolve=>pending.push(()=>resolve({imagem:{largura:1920,altura:1080},faixas:[{idioma:'por',padrao:true}]})));};
  const read=(name,gaveta)=>a.sondarArquivo('https://media.invalid/drawer-'+name+'.mp4','',{timeout:3000,gaveta});
  const jobs=[read('occupied1',0),read('occupied2',0),read('hd',2),read('4k',5),read('fhd',3)];
  pending.shift()();await new Promise(setImmediate);assert.match(calls[2],/drawer-4k/);
  pending.shift()();await new Promise(setImmediate);assert.match(calls[3],/drawer-fhd/);
  while(pending.length){pending.shift()();await new Promise(setImmediate);}await Promise.all(jobs);
  assert.equal(calls.length,5);assert.match(calls[4],/drawer-hd/);
 }finally{while(pending.length)pending.shift()();v.faixasDeAudio=original;a.limparCache();}
});

test('proteção geral recupera consulta vazia e medição 503 antes de aceitar HD, em filmes e episódios',async()=>{
 const a=require('./avaliador'),m=require('./fontes-motor'),fast=require('./mp4-rapido.cjs'),midia=require('./midia-proxy');
 const original=Object.fromEntries(['filaDeFontes','lerIdiomasVerificados','registrarSucesso','anotarEscolha','registrarFalha'].map(k=>[k,m[k]])),read=fast.ler,validate=midia.validarMidia;
 try{
  m.lerIdiomasVerificados=()=>({});m.registrarSucesso=()=>{};m.anotarEscolha=()=>{};m.registrarFalha=()=>{};midia.validarMidia=async()=>true;
  for(const target of [{tipo:'movie',tmdbId:'1022789'},{tipo:'movie',tmdbId:'1084244'},{tipo:'tv',tmdbId:'1399',temporada:'1',episodio:'2'}]){
   a.limparCache();let queries=0,reads=0;
   m.filaDeFontes=()=>[{id:'hd',resolver:async()=>({url:'https://media.invalid/hd.mp4',type:'file',audio:'pt-BR'})},{id:'uhd',resolverTodos:async()=>++queries===1?[]:[{url:'https://media.invalid/uhd.mp4',type:'file',audio:'pt-BR',exigeProva:true}]}];
   fast.ler=async url=>{const high=url.includes('/uhd.');if(high&&++reads===1)return {indisponivel:true,temporaria:true};return {imagem:{largura:high?3840:1280,altura:high?1608:720,codec:high?'hevc':'h264'},faixas:[{idioma:'por',padrao:true,codec:'aac'}]};};
   const r=await a.escolherMelhor('dublado',target,{semCache:true});assert.equal(r.escolhido.fonteId,'uhd');assert.equal(r.escolhido.resolucao,'2160p');assert.equal(queries,2);assert.equal(reads,2);
  }
 }finally{Object.assign(m,original);fast.ler=read;midia.validarMidia=validate;a.limparCache();}
});

test('uma escolha HD e sua medição não prendem o mesmo endereço quando ele passa a entregar 4K',async()=>{
 const a=require('./avaliador'),m=require('./fontes-motor'),fast=require('./mp4-rapido.cjs'),midia=require('./midia-proxy');
 const original=Object.fromEntries(['filaDeFontes','lerIdiomasVerificados','registrarSucesso','anotarEscolha','registrarFalha'].map(k=>[k,m[k]])),read=fast.ler,validate=midia.validarMidia,clock=Date.now;let high=false,queries=0,now=clock();
 try{
  Date.now=()=>now;m.filaDeFontes=()=>[{id:'same-url',resolver:async()=>{queries++;return {url:'https://media.invalid/changed.mp4',type:'file',audio:'pt-BR'};}}];m.lerIdiomasVerificados=()=>({});m.registrarSucesso=()=>{};m.anotarEscolha=()=>{};m.registrarFalha=()=>{};midia.validarMidia=async()=>true;
  fast.ler=async()=>({imagem:{largura:high?3840:1280,altura:high?2160:720},faixas:[{idioma:'por',padrao:true,codec:'aac'}]});
  a.limparCache();const target={tipo:'movie',tmdbId:'9999098'};assert.equal((await a.escolherMelhor('dublado',target)).escolhido.resolucao,'720p');high=true;now+=2000;
  assert.equal((await a.escolherMelhor('dublado',target)).escolhido.resolucao,'2160p');assert.equal(queries,2);
 }finally{Date.now=clock;Object.assign(m,original);fast.ler=read;midia.validarMidia=validate;a.limparCache();}
});

test('análises pesadas ocupadas não bloqueiam a leitura leve de um 4K já disponível',async()=>{
 const a=require('./avaliador'),v=require('./central/verificar-midia'),fast=require('./mp4-rapido.cjs'),read=v.faixasDeAudio,quick=fast.ler;const releases=[];
 try{
  v.faixasDeAudio=()=>new Promise(resolve=>releases.push(()=>resolve(null)));
  const slow=[a.sondarArquivo('https://media.invalid/busy1.mp4','',{timeout:3000}),a.sondarArquivo('https://media.invalid/busy2.mp4','',{timeout:3000})];await new Promise(setImmediate);assert.equal(releases.length,2);
  fast.ler=async()=>({imagem:{largura:3840,altura:1608,codec:'hevc'},faixas:[{idioma:'por',padrao:true,codec:'aac'}]});
  const high=await Promise.race([a.sondarArquivo('https://media.invalid/free4k.mp4','',{timeout:3000,rapida:true}),new Promise(resolve=>setTimeout(()=>resolve(null),100))]);
  assert.equal(high?.largura,3840);assert.equal(high?.padraoPortugues,true);
  while(releases.length)releases.shift()();await Promise.all(slow);
 }finally{while(releases.length)releases.shift()();v.faixasDeAudio=read;fast.ler=quick;a.limparCache();}
});

test('lotes grandes de um fornecedor não monopolizam as leituras leves de outra fonte',async()=>{
 const a=require('./avaliador'),m=require('./fontes-motor'),fast=require('./mp4-rapido.cjs'),midia=require('./midia-proxy');
 const original=Object.fromEntries(['filaDeFontes','lerIdiomasVerificados','registrarSucesso','anotarEscolha','registrarFalha'].map(k=>[k,m[k]])),read=fast.ler,validate=midia.validarMidia;let active=0,max=0,highRead=false;
 try{
  m.filaDeFontes=()=>[{id:'batch',resolverTodos:async()=>Array.from({length:8},(_,i)=>({url:'https://media.invalid/batch-'+i+'.mp4',type:'file',audio:'pt-BR',resolucao:'1080p'}))},{id:'uhd',resolver:async()=>({url:'https://media.invalid/other4k.mp4',type:'file',audio:'pt-BR',resolucao:'2160p'})}];
  m.lerIdiomasVerificados=()=>({});m.registrarSucesso=()=>{};m.anotarEscolha=()=>{};m.registrarFalha=()=>{};midia.validarMidia=async()=>true;
  fast.ler=async url=>{const high=url.includes('other4k');if(high)highRead=true;else{active++;max=Math.max(max,active);await new Promise(resolve=>setTimeout(resolve,10));active--;}
   return {imagem:{largura:high?3840:1920,altura:high?1608:1080},faixas:[{idioma:'por',padrao:true,codec:'aac'}]};};
  a.limparCache();const r=await a.escolherMelhor('dublado',{tipo:'movie',tmdbId:'9999099'},{semCache:true});assert.equal(r.escolhido.fonteId,'uhd');assert(highRead);assert.equal(max,1);
 }finally{Object.assign(m,original);fast.ler=read;midia.validarMidia=validate;a.limparCache();}
});

test('revisão dirigida recupera HLS superior tardio sem consultar a reserva novamente',async()=>{
 const a=require('./avaliador'),m=require('./fontes-motor'),axios=require('axios'),midia=require('./midia-proxy');
 const saved=Object.fromEntries(['filaDeFontes','lerIdiomasVerificados','registrarSucesso','anotarEscolha'].map(k=>[k,m[k]])),get=axios.get,validar=midia.validarMidia;let low=0,high=0;
 try{
  a.limparCache();m.lerIdiomasVerificados=()=>({});m.registrarSucesso=()=>{};m.anotarEscolha=()=>{};midia.validarMidia=async()=>true;
  m.filaDeFontes=()=>[{id:'low',resolver:async()=>{low++;return {url:'https://media.invalid/low.m3u8',type:'hls',audio:'pt-BR'};}},{id:'high',resolver:async()=>{high++;return {url:'https://media.invalid/high.m3u8',type:'hls',audio:'pt-BR',exigeProva:true};}}];
  axios.get=async url=>{if(url.includes('high'))await new Promise(r=>setTimeout(r,220));return {data:'#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,LANGUAGE="pt-BR"\n#EXT-X-STREAM-INF:RESOLUTION='+(url.includes('high')?'3840x1600':'1280x720')+'\nfile.m3u8'};};
  const start=Date.now(),result=await a.escolherMelhor('dublado',{tipo:'movie',tmdbId:'9999106'},{semCache:true,orcamentoInicial:100,orcamentoRevisao:400});
  assert.equal(result.escolhido.fonteId,'high');assert.equal(result.avaliacao[0].detalhes.dimensoes,'3840 × 1600');assert.equal(result.verificacao.rodadas,2);assert.equal(low,1);assert.equal(high,1);assert(Date.now()-start<800);
 }finally{Object.assign(m,saved);axios.get=get;midia.validarMidia=validar;a.limparCache();}
});

test('revisão examina opções ainda não medidas do mesmo fornecedor antes de repetir a lenta',async()=>{
 const a=require('./avaliador'),m=require('./fontes-motor'),axios=require('axios'),midia=require('./midia-proxy');const saved=Object.fromEntries(['filaDeFontes','lerIdiomasVerificados','registrarSucesso','anotarEscolha'].map(k=>[k,m[k]])),get=axios.get,validar=midia.validarMidia;let queries=0,lowReads=0;
 try{a.limparCache();m.lerIdiomasVerificados=()=>({});m.registrarSucesso=()=>{};m.anotarEscolha=()=>{};midia.validarMidia=async()=>true;m.filaDeFontes=()=>[{id:'batch',resolverTodos:async()=>{queries++;return ['low','slow','high'].map(n=>({url:'https://media.invalid/'+n+'.m3u8',type:'hls',audio:'pt-BR',exigeProva:true}));}}];axios.get=async url=>{if(url.includes('/low.'))lowReads++;if(url.includes('slow'))await new Promise(r=>setTimeout(r,1000));return {data:'#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,LANGUAGE="pt-BR"\n#EXT-X-STREAM-INF:RESOLUTION='+(url.includes('high')?'3840x1600':'1280x720')+'\nfile.m3u8'};};const result=await a.escolherMelhor('dublado',{tipo:'movie',tmdbId:'9999107'},{semCache:true,orcamentoInicial:100,orcamentoRevisao:400});assert.equal(result.avaliacao[0].detalhes.dimensoes,'3840 × 1600');assert.equal(queries,1);assert.equal(lowReads,1);
 }finally{Object.assign(m,saved);axios.get=get;midia.validarMidia=validar;a.limparCache();}
});
