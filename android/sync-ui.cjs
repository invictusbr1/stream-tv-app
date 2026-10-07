const fs=require('fs'),path=require('path'),os=require('os');
const root=path.resolve(__dirname,'..'),assets=path.join(__dirname,'app/src/main/assets');
let localConfig={};try{localConfig=JSON.parse(fs.readFileSync(path.join(root,'config.local.json'),'utf8'));}catch{}
// A versão Android conversa com a IA direto do aparelho: a chave vai dentro do APK de uso pessoal.
const CHAVE_JARVIS=(()=>{
    if(process.env.GROQ_API_KEY)return process.env.GROQ_API_KEY.trim();
    if(localConfig.groqKey)return String(localConfig.groqKey).trim();
    for(const file of [path.join(os.homedir(),'OneDrive','Área de Trabalho','api.txt'),path.join(os.homedir(),'Desktop','api.txt')]){
        try{const chave=fs.readFileSync(file,'utf8').match(/gsk_[A-Za-z0-9_-]{20,}/);if(chave)return chave[0];}catch{}
    }
    return '';
})();
let html=fs.readFileSync(path.join(root,'index.html'),'utf8').replace(/\r\n/g,'\n');
function replace(before,after){if(!html.includes(before))throw Error('UI adapter no longer matches: '+before);html=html.replace(before,after);}
replace("async function lerJson(url,signal){const r=await fetch(url,{signal});if(!r.ok)throw Error('Indisponível');return r.json();}","async function lerJson(url,signal){if(url.startsWith('/api/playback/')){const r=await fetch(url,{signal});if(!r.ok)throw Error('Indisponível');return r.json();}return (await androidCatalog).request(url,signal);}");
replace('<script>\n','<script src="/catalog.js"></script><script src="/android.js"></script>\n<script>\n');
replace('target="_blank" rel="noopener"','');
replace("url.origin!==location.origin||!/^\\/assistir\\/\\d{1,10}\\/[0-7]$/.test(url.pathname)||url.search||url.hash||url.username||url.password", "url.origin!==location.origin||url.pathname!=='/assistir.html'||!/^\\d{1,10}$/.test(url.searchParams.get('id')||'')||!/^[0-7]$/.test(url.searchParams.get('source')||'')||[...url.searchParams.keys()].length!==2||url.hash||url.username||url.password");
// O aviso de atualização do Android já aparece no selo do topo, no aviso da
// tela e na gaveta ("Atualizar aplicativo"); o link extra "Atualizações" que
// ficava no cabeçalho do catálogo saiu de vez.
fs.writeFileSync(path.join(assets,'index.html'),html);
fs.copyFileSync(path.join(root,'playback.js'),path.join(assets,'playback.js'));
fs.copyFileSync(path.join(root,'node_modules/hls.js/dist/hls.min.js'),path.join(assets,'hls.min.js'));
fs.copyFileSync(path.join(root,'node_modules/hls.js/LICENSE'),path.join(assets,'hls-LICENSE.txt'));
const key=fs.readFileSync(path.join(root,'server.js'),'utf8').match(/const TMDB_KEY = '([^']+)'/);
if(!key)throw Error('TMDB key missing');
fs.writeFileSync(path.join(assets,'config.json'),JSON.stringify({
  tmdbKey:key[1],
  supabaseUrl:process.env.SUPABASE_URL||localConfig.supabaseUrl||'',
  supabaseAnonKey:process.env.SUPABASE_ANON_KEY||localConfig.supabaseAnonKey||'',
  groqKey:CHAVE_JARVIS,
  // O selo de atualização na tela compara estes números com o aviso publicado no GitHub.
  app:'android',
  versionCode:Number((fs.readFileSync(path.join(__dirname,'app/build.gradle'),'utf8').match(/versionCode\s+(\d+)/)||[])[1]||0),
  versionName:(fs.readFileSync(path.join(__dirname,'app/build.gradle'),'utf8').match(/versionName\s+'([^']+)'/)||[])[1]||''
}));
console.log('Android UI synchronized.');

fs.copyFileSync(path.join(root,'library.js'),path.join(assets,'library.js'));

fs.copyFileSync(path.join(root,'personal.js'),path.join(assets,'personal.js'));
fs.copyFileSync(path.join(root,'auth.js'),path.join(assets,'auth.js'));
fs.copyFileSync(path.join(root,'jarvis.js'),path.join(assets,'jarvis.js'));
fs.copyFileSync(path.join(root,'acesso.js'),path.join(assets,'acesso.js'));
fs.copyFileSync(path.join(root,'fontes.json'),path.join(assets,'fontes.json'));
fs.copyFileSync(path.join(root,'legendas.js'),path.join(assets,'legendas.js'));
