const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
const exe=n=>process.env.JAVA_HOME?path.join(process.env.JAVA_HOME,'bin',n+(process.platform==='win32'?'.exe':'')):n;
const available=spawnSync(exe('javac'),['-version'],{encoding:'utf8',windowsHide:true}).status===0;
test('recuperação de rede: proxy autenticado só do servidor, HLS e MP4 sem acumular arquivo',{skip:!available},()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'conecta-transport-'));
 try{const files=['app/src/main/java/br/streamtv/app/MediaHttp.java','app/src/main/java/br/streamtv/app/QualitySelector.java','app/src/main/java/br/streamtv/app/VerifiedMediaStore.java','app/src/main/java/br/streamtv/app/ServerPlaybackTransport.java','test/br/streamtv/app/ServerPlaybackTransportTest.java'].map(x=>path.join(__dirname,x));const c=spawnSync(exe('javac'),['--release','8','-encoding','UTF-8','-d',dir,...files],{encoding:'utf8',windowsHide:true});assert.equal(c.status,0,c.stderr);const r=spawnSync(exe('java'),['-cp',dir,'br.streamtv.app.ServerPlaybackTransportTest'],{encoding:'utf8',windowsHide:true});assert.equal(r.status,0,r.stderr);
 }finally{assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));assert.match(path.basename(dir),/^conecta-transport-/);fs.rmSync(dir,{recursive:true,force:true});}
});
