const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const assets=path.join(__dirname,'app/src/main/assets');
const java=fs.readFileSync(path.join(__dirname,'app/src/main/java/br/streamtv/app/MainActivity.java'),'utf8');
const literal=java.match(/if \(!name\.matches\("([^"]+)"\)\)/)[1];
const allowed=new RegExp('^'+JSON.parse('"'+literal+'"')+'$');
test('todos os scripts locais da tela Android podem ser carregados pelo WebView',()=>{
 const html=fs.readFileSync(path.join(assets,'index.html'),'utf8');
 const scripts=[...html.matchAll(/<script\s+src="\/([^"?]+)(?:\?[^"]*)?"/g)].map(m=>m[1]);
 assert(scripts.includes('mininovelas.js'));assert(scripts.includes('mininovelas-source.js'));
 for(const file of scripts){assert(allowed.test(file),'WebView bloqueou '+file);assert(fs.existsSync(path.join(assets,file)),'Arquivo ausente: '+file);}
});
test('a permissao das mininovelas preserva o bloqueio de arquivos privados e caminhos arbitrarios',()=>{
 for(const file of ['config.local.json','../config.json','mininovelas.js/extra','outro.js','/mininovelas.js'])assert.equal(allowed.test(file),false,file);
});
