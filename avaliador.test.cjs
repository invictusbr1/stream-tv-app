const test = require('node:test');
const assert = require('node:assert/strict');
const { analisarPlaylist, notaDaFonte } = require('./avaliador');
// Testes do avaliador não consultam nem alteram a memória real de fornecedores.
require('./midias-memoria.cjs').load=()=>[];
require('./midias-memoria.cjs').update=()=>{};

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
 let state='pt',oldCalls=0,failures=0;
 try{
  motor.filaDeFontes=()=>[{id:'fenix',nome:'Dublado',resolver:async()=>dados('atual')}];motor.lerIdiomasVerificados=()=>({});motor.registrarSucesso=()=>{};motor.anotarEscolha=()=>{};motor.registrarFalha=()=>{failures++;};
  proxy.validarMidia=async url=>!(url.includes('antiga')&&state==='dead');
  v.faixasDeAudio=async url=>{const old=url.includes('antiga');if(old)oldCalls++;return {imagem:{largura:old?3832:1920,altura:old?1600:800,codec:old?'hevc':'h264'},faixas:[{idioma:old&&state==='en'?'eng':'por',padrao:true,codec:'aac'}]};};
  const memoria={load:()=>[{id:'fenix',dados:dados('antiga')}],update:()=>{}};
  const target={tipo:'movie',tmdbId:'969681'};
  let result=await a.escolherMelhor('dublado',target,{memoria,semCache:true});assert.match(result.escolhido.url,/antiga/);assert.equal(result.escolhido.resolucao,'2156p');
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

