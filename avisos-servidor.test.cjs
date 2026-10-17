const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawnSync}=require('node:child_process');
const store=require('./avisos-servidor-store.cjs');
function fixture(fn){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'conecta-avisos-'));try{return fn(path.join(dir,'avisos-servidor.json'),dir);}finally{assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));assert.match(path.basename(dir),/^conecta-avisos-/);fs.rmSync(dir,{recursive:true,force:true});}}
test('aviso persiste entre processos, atualiza a etapa sem duplicar e expira',()=>fixture(file=>{
 const id='a'.repeat(64),now=Date.now();store.escrever(id,'preparando',file,now);
 assert.equal(store.ler(file,now).length,1);assert.equal(store.ler(file,now)[0].fase,'preparando');
 store.escrever(id,'reiniciando',file,now+1);store.escrever(id,'reiniciando',file,now+2);
 assert.equal(store.ler(file,now+2).length,1);assert.equal(store.ler(file,now+2)[0].em,now+1);
 assert.equal(store.ler(file,now+46*60000).length,0);
 store.escrever(id,'concluida',file,now+47*60000);assert.equal(store.ler(file,now+48*60000)[0].fase,'concluida');
}));
test('somente mensagens fixas e últimos vinte avisos são expostos',()=>fixture(file=>{
 const now=Date.now();for(let i=0;i<25;i++)store.escrever(i.toString(16).padStart(64,'0'),'concluida',file,now);
 assert.equal(store.ler(file,now).length,20);
 const data=JSON.parse(fs.readFileSync(file));data[0].titulo='<script>segredo</script>';data[0].mensagem='credencial';fs.writeFileSync(file,JSON.stringify(data));
 assert.equal(store.ler(file,now)[0].titulo,'Atualização concluída');assert(!JSON.stringify(store.ler(file,now)).includes('credencial'));
 assert.throws(()=>store.escrever('../path','preparando',file));assert.throws(()=>store.escrever('b'.repeat(64),'texto arbitrário',file));
}));
test('arquivo inválido não impede leitura da API e pode ser recuperado',()=>fixture(file=>{
 fs.writeFileSync(file,'{incompleto');assert.deepEqual(store.ler(file),[]);store.escrever('a'.repeat(64),'restaurada',file);assert.equal(store.ler(file)[0].fase,'restaurada');
}));
test('publicador pode gravar pelo stdin em contêiner que ainda não tem o módulo',()=>fixture((file,dir)=>{
 const r=spawnSync(process.execPath,['-','c'.repeat(64),'reiniciando'],{input:fs.readFileSync('avisos-servidor-store.cjs'),env:{...process.env,DADOS_DIR:dir},encoding:'utf8',windowsHide:true});assert.equal(r.status,0,r.stderr);assert.equal(store.ler(file)[0].fase,'reiniciando');
}));
test('publicação avisa antes da troca, espera e sinaliza saúde ou restauração',()=>{
 const script=fs.readFileSync('deploy/servidor/publicar-no-servidor.sh','utf8');const build=script.indexOf('stage_dc build central'),warn=script.indexOf('notice reiniciando'),delay=script.indexOf('sleep 45'),restart=script.indexOf('\ndc up -d --no-build\n');
 assert(build<warn&&warn<delay&&delay<restart);assert(script.includes('notice preparando'));assert(script.includes('notice restaurada'));assert(script.includes('notice cancelada'));assert(script.indexOf('notice concluida')<script.indexOf('record healthy'));assert(script.indexOf('notice concluida')>script.indexOf('curl --fail'));
});
