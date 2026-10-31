const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
const exe=n=>process.env.JAVA_HOME?path.join(process.env.JAVA_HOME,'bin',n+(process.platform==='win32'?'.exe':'')):n;
const available=spawnSync(exe('javac'),['-version'],{encoding:'utf8',windowsHide:true}).status===0;
test('modo autônomo: o aparelho encaminha o arquivo com Referer, em pedaços, sem passar pela Oracle',{skip:!available},()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'conecta-relay-'));
 try{const files=['app/src/main/java/br/streamtv/app/MediaHttp.java','app/src/main/java/br/streamtv/app/QualitySelector.java','app/src/main/java/br/streamtv/app/VerifiedMediaStore.java','app/src/main/java/br/streamtv/app/LocalMediaRelay.java','test/br/streamtv/app/LocalMediaRelayTest.java'].map(x=>path.join(__dirname,x));const c=spawnSync(exe('javac'),['--release','8','-encoding','UTF-8','-d',dir,...files],{encoding:'utf8',windowsHide:true});assert.equal(c.status,0,c.stderr);const r=spawnSync(exe('java'),['-cp',dir,'br.streamtv.app.LocalMediaRelayTest'],{encoding:'utf8',windowsHide:true});assert.equal(r.status,0,r.stderr);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('MainActivity: arquivo com Referer vai pelo servidor (o <video> não toca o encaminhador local) e série no aparelho primeiro',()=>{
 const src=fs.readFileSync(path.join(__dirname,'app/src/main/java/br/streamtv/app/MainActivity.java'),'utf8');
 assert.match(src,/LocalMediaRelay\.local\(alvoEscolhido,chosen\.referer\)/);
 assert.match(src,/LocalMediaRelay\.PATH\.equals\(path\)\) return midiaLocal/);
 assert.match(src,/serverPlayback\(tipo,id,temporada,episodio,excluded,!avcOnly,escolha\)/);
 assert.match(src,/codificar\(chosen\.url\)/);
 assert.doesNotMatch(src,/WebResourceResponse viaServer=serverPlayback\("tv",partes\[4\]/);
});
