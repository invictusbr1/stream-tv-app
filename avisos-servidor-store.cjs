'use strict';
// Apenas o publicador escreve. A API expõe somente avisos fixos, sem dados de usuários.
const fs=require('node:fs'),path=require('node:path');
const textos={
 preparando:['Atualização em preparação','Estamos preparando uma atualização. Pode haver uma breve interrupção mais adiante.'],
 reiniciando:['Atualização do servidor','O servidor será reiniciado em cerca de 45 segundos. Se o vídeo parar, aguarde a atualização terminar.'],
 concluida:['Atualização concluída','O servidor está disponível novamente. Se necessário, abra o vídeo para continuar.'],
 restaurada:['Servidor disponível','A versão anterior foi restaurada. Você já pode continuar assistindo.'],
 cancelada:['Atualização adiada','A atualização foi adiada. O servidor continua disponível.'],
 falha:['Servidor em recuperação','A atualização encontrou um problema. Estamos verificando a recuperação do serviço.']
};
const arquivo=()=>path.join(process.env.DADOS_DIR||__dirname,'avisos-servidor.json');
function ler(file=arquivo(),now=Date.now()){
 let rows=[];try{const raw=fs.readFileSync(file,'utf8');if(raw.length>65536)return [];rows=JSON.parse(raw);}catch{return [];}
 if(!Array.isArray(rows))return [];
 return rows.filter(r=>r&&/^[a-f0-9]{64}$/.test(r.id)&&textos[r.fase]&&Number.isFinite(r.em)&&Number.isFinite(r.ate)&&r.ate>now&&r.em<=now+60000).slice(-20).map(r=>({id:r.id,fase:r.fase,em:r.em,ate:r.ate,titulo:textos[r.fase][0],mensagem:textos[r.fase][1]}));
}
function escrever(id,fase,file=arquivo(),now=Date.now()){
 if(!/^[a-f0-9]{64}$/.test(id)||!textos[fase])throw Error('Aviso inválido');
 const previous=ler(file,now),same=previous.find(r=>r.id===id);
 if(same?.fase===fase)return same;
 const ativo=fase==='preparando'||fase==='reiniciando';
 const item={id,fase,em:now,ate:now+(ativo?45*60000:7*86400000)};
 const rows=previous.filter(r=>r.id!==id).map(({id,fase,em,ate})=>({id,fase,em,ate}));rows.push(item);
 fs.mkdirSync(path.dirname(file),{recursive:true});const temp=file+'.'+process.pid+'.tmp';fs.writeFileSync(temp,JSON.stringify(rows.slice(-20)),{mode:0o644});fs.renameSync(temp,file);return item;
}
module.exports={ler,escrever};
// Compatível também com o contêiner anterior: node - < este arquivo.
if(require.main===module||(process.argv[1]==='-'&&!module.parent)){
 try{escrever(process.argv[2],process.argv[3]);}catch{process.stderr.write('Não foi possível registrar o aviso.\n');process.exitCode=1;}
}
