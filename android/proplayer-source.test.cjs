'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const exe=n=>process.env.JAVA_HOME?path.join(process.env.JAVA_HOME,'bin',n+(process.platform==='win32'?'.exe':'')):n;
test('Android: conector MP4 valida identidade, numeração, qualidade e ausência de publicidade',{skip:spawnSync(exe('javac'),['-version'],{encoding:'utf8',windowsHide:true}).status!==0},()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'conecta-proplayer-'));
 try{const paths=['app/src/main/java/br/streamtv/app/AnimeSource.java','app/src/main/java/br/streamtv/app/ProplayerSource.java','test/br/streamtv/app/ProplayerSourceTest.java'].map(f=>path.join(__dirname,f));const c=spawnSync(exe('javac'),['-encoding','UTF-8','--release','8','-d',dir,...paths],{encoding:'utf8',windowsHide:true});assert.equal(c.status,0,c.stderr);const r=spawnSync(exe('java'),['-cp',dir,'br.streamtv.app.ProplayerSourceTest'],{encoding:'utf8',windowsHide:true});assert.equal(r.status,0,r.stderr);}
 finally{assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));assert.match(path.basename(dir),/^conecta-proplayer-/);fs.rmSync(dir,{recursive:true,force:true});}
});
