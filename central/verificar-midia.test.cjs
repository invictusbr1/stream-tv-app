const test = require('node:test');
const assert = require('node:assert/strict');
const { parecePortugues, audioTocaNoNavegador, extrairDoZip, chaveDoTitulo } = require('./verificar-midia');

test('gravação com cache antigo preserva prova de idioma gravada depois por outra verificação',()=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),v=require('./verificar-midia');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'conecta-idioma-merge-')),central={pastaDados:dir},file=path.join(dir,'idiomas.json');
 try{
  fs.writeFileSync(file,JSON.stringify({a:{idioma:'indefinido',em:'2026-10-17T10:00:00Z'}}));v.limparCache();
  const stale=v.lerCache(central);stale.b={idioma:'pt',em:'2026-10-18T12:00:00Z'};
  fs.writeFileSync(file,JSON.stringify({a:{idioma:'pt',em:'2026-10-18T11:00:00Z'},c:{idioma:'pt',origem:'transcricao',em:'2026-10-18T11:00:00Z'}}));
  v.gravarCache(central);const saved=JSON.parse(fs.readFileSync(file,'utf8'));
  assert.equal(saved.a.idioma,'pt');assert.equal(saved.b.idioma,'pt');assert.equal(saved.c.origem,'transcricao');assert.equal(stale.a.idioma,'pt');
 }finally{v.limparCache();fs.rmSync(dir,{recursive:true,force:true});}
});

test('idioma ausente recebe confirmação por fala; idioma estrangeiro explícito não vira português',async()=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
 for(const language of ['und','','eng']){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'conecta-idioma-'));let transcriptions=0;
  try{
   if(language==='und')fs.writeFileSync(path.join(dir,'idiomas.json'),JSON.stringify({'fixture|movie:9999002':{idioma:'outro',origem:'faixas',evidencia:'a faixa padrão do arquivo é "und"',em:new Date().toISOString()}}));
   const module={exports:{}},nativeFs={...fs,existsSync:p=>/ff(?:mpeg|probe)\.exe$/.test(String(p))||fs.existsSync(p)};
   const fakeChild={execFile(program,args,opts,callback){if(String(program).includes('ffprobe'))callback(null,JSON.stringify({format:{format_name:'mov,mp4'},streams:[{codec_type:'video',codec_name:'h264',width:1920,height:1080},{codec_type:'audio',codec_name:'aac',tags:{language},disposition:{default:1}}]}),'');else{fs.writeFileSync(args[args.length-1],Buffer.from('trecho de teste'));callback(null,'','');}}};
   const sandbox={module,exports:module.exports,__dirname:__dirname,Buffer,URL,process:{...process,env:{...process.env,FFMPEG_PATH:path.join(dir,'ffmpeg.exe'),FFPROBE_PATH:path.join(dir,'ffprobe.exe')}},require:id=>id==='fs'?nativeFs:id==='child_process'?fakeChild:id==='axios'?{get:async()=>{throw Error('Rede não permitida no teste');},post:async()=>{transcriptions++;return {data:{language:'portuguese',text:'Você não pode fazer isso agora, está tudo bem aqui.'}};}}:require(id)};
   vm.runInNewContext(fs.readFileSync(path.join(__dirname,'verificar-midia.js'),'utf8'),sandbox);
   const result=await module.exports.verificarIdioma({url:'https://media.invalid/video.mp4',amostra:{id:'9999002'},fonteId:'fixture',chaveIa:'fixture',central:{pastaDados:dir}});
   assert.equal(result.idioma,language==='eng'?'outro':'pt');assert.equal(transcriptions,language==='eng'?0:1);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
 }
});

test('reconhece português numa transcrição (e inglês como outro idioma)', () => {
    assert.equal(parecePortugues('Você não pode fazer isso agora, está tudo bem?'), true);
    assert.equal(parecePortugues('You could come and watch, you get hit every time'), false);
    assert.equal(parecePortugues(''), false);
});

// Medido em 08/10/2026: o arquivo do FenixFlix (MKV com som EAC3) toca o vídeo
// e sai mudo no navegador — a verificação precisa avisar isso antes de indicar
// a fonte.
test('avisa quando o áudio do arquivo não toca no navegador', () => {
    assert.equal(audioTocaNoNavegador('matroska,webm', 'eac3'), false);
    assert.equal(audioTocaNoNavegador('matroska,webm', 'opus'), true);
    assert.equal(audioTocaNoNavegador('mov,mp4,m4a,3gp,3g2,mj2', 'aac'), true);
    assert.equal(audioTocaNoNavegador('mov,mp4,m4a,3gp,3g2,mj2', 'eac3'), true);
});

test('a chave do título é a mesma usada pelo motor do aplicativo', () => {
    assert.equal(chaveDoTitulo('movie', { id: '921' }), 'movie:921');
    assert.equal(chaveDoTitulo('tv', { id: '1399', temporada: '1', episodio: '14' }), 'tv:1399:1:14');
    assert.equal(chaveDoTitulo('tv', { id: '1399' }), 'tv:1399:1:1');
});

// Monta um .zip simples (sem compressão) para conferir a extração do pacote
// de ferramentas (ffmpeg/ffprobe).
function zipSimples(nome, conteudo) {
    const nomeBytes = Buffer.from(nome, 'utf8');
    const dados = Buffer.from(conteudo, 'utf8');
    const cabecalho = Buffer.alloc(30);
    cabecalho.writeUInt32LE(0x04034b50, 0);
    cabecalho.writeUInt16LE(20, 4);
    cabecalho.writeUInt32LE(dados.length, 18);
    cabecalho.writeUInt32LE(dados.length, 22);
    cabecalho.writeUInt16LE(nomeBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(dados.length, 20);
    central.writeUInt32LE(dados.length, 24);
    central.writeUInt16LE(nomeBytes.length, 28);
    const fim = Buffer.alloc(22);
    fim.writeUInt32LE(0x06054b50, 0);
    fim.writeUInt16LE(1, 8);
    fim.writeUInt16LE(1, 10);
    fim.writeUInt32LE(46 + nomeBytes.length, 12);
    fim.writeUInt32LE(30 + nomeBytes.length + dados.length, 16);
    return Buffer.concat([cabecalho, nomeBytes, dados, central, nomeBytes, fim]);
}

test('extrai o ffmpeg de dentro do pacote oficial', () => {
    const pacote = zipSimples('ffmpeg-7.0-essentials_build/bin/ffmpeg.exe', 'conteúdo do programa');
    const achados = extrairDoZip(pacote, ['/ffmpeg.exe', '/ffprobe.exe']);
    assert.equal(String(achados['/ffmpeg.exe']), 'conteúdo do programa');
    assert.equal(achados['/ffprobe.exe'], undefined);
    assert.equal(extrairDoZip(Buffer.from('não é zip'), ['/ffmpeg.exe']), null);
});
