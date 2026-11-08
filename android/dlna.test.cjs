const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
const exe=n=>process.env.JAVA_HOME?path.join(process.env.JAVA_HOME,'bin',n+(process.platform==='win32'?'.exe':'')):n;
const available=spawnSync(exe('javac'),['-version'],{encoding:'utf8',windowsHide:true}).status===0;
test('DLNA: descreve a TV, manda o link com legenda e só fala com a rede local',{skip:!available},()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'conecta-dlna-'));
 try{const files=['app/src/main/java/br/streamtv/app/Dlna.java','test/br/streamtv/app/DlnaTest.java'].map(f=>path.join(__dirname,f));
  const c=spawnSync(exe('javac'),['-d',dir,...files],{encoding:'utf8',windowsHide:true});assert.equal(c.status,0,c.stderr);
  const r=spawnSync(exe('java'),['-cp',dir,'br.streamtv.app.DlnaTest'],{encoding:'utf8',windowsHide:true});assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/OK/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('MainActivity: DLNA só manda link /tv/ do nosso servidor e pede multicast',()=>{
 const src=fs.readFileSync(path.join(__dirname,'app/src/main/java/br/streamtv/app/MainActivity.java'),'utf8');
 assert.match(src,/path\.startsWith\("\/api\/dlna\/"\)\) return dlna\(uri\)/);
 assert.match(src,/String prefixo="http:\/\/"\+host\+"\/tv\/";/);
 const man=fs.readFileSync(path.join(__dirname,'app/src/main/AndroidManifest.xml'),'utf8');
 assert.match(man,/CHANGE_WIFI_MULTICAST_STATE/);
});
