const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
const exe=n=>process.env.JAVA_HOME?path.join(process.env.JAVA_HOME,'bin',n+(process.platform==='win32'?'.exe':'')):n;
test('APK: exceção Crystal Lake valida título, assinatura, manifesto e português',{skip:spawnSync(exe('javac'),['-version'],{encoding:'utf8',windowsHide:true}).status!==0},()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'conecta-crystal-'));
 try{const files=['app/src/main/java/br/streamtv/app/CrystalLakeSource.java','test/br/streamtv/app/CrystalLakeSourceTest.java'].map(f=>path.join(__dirname,f));let result=spawnSync(exe('javac'),['-encoding','UTF-8','--release','8','-d',dir,...files],{encoding:'utf8',windowsHide:true});assert.equal(result.status,0,result.stderr);result=spawnSync(exe('java'),['-cp',dir,'br.streamtv.app.CrystalLakeSourceTest'],{encoding:'utf8',windowsHide:true});assert.equal(result.status,0,result.stderr);}
 finally{assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));assert.match(path.basename(dir),/^conecta-crystal-/);fs.rmSync(dir,{recursive:true,force:true});}
});
