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
replace('<script>\n','<script src="/vidsrc-source.js"></script>\n<script>\n');
// O link de "fonte com anúncios" saiu da interface; se algum dia voltar a
// existir, o Android abre dentro da própria janela.
if(html.includes('target="_blank" rel="noopener"'))html=html.replace('target="_blank" rel="noopener"','');
replace("url.origin!==location.origin||!/^\\/assistir\\/\\d{1,10}\\/[0-7]$/.test(url.pathname)||url.search||url.hash||url.username||url.password", "url.origin!==location.origin||url.pathname!=='/assistir.html'||!/^\\d{1,10}$/.test(url.searchParams.get('id')||'')||!/^[0-7]$/.test(url.searchParams.get('source')||'')||[...url.searchParams.keys()].length!==2||url.hash||url.username||url.password");
// O aviso de atualização do Android já aparece no selo do topo, no aviso da
// tela e na gaveta ("Atualizar aplicativo"); o link extra "Atualizações" que
// ficava no cabeçalho do catálogo saiu de vez.
// seloDeVersao: acrescenta ?v=... nos scripts para o WebView largar o cache antigo.
const seloDeVersao='v'+Date.now();
html=html.replace(/(<script src="\/[a-z0-9.-]+\.js)(")/gi,(m,nome,fim)=>nome+'?'+seloDeVersao+fim);
const CSS_FINAL="\n/* episodio-final: capa à esquerda, texto ao lado e sinopse embaixo na largura toda */\n#series-dialog .episode-row{display:block!important;position:relative!important;padding:16px 0!important;border-bottom:1px solid #ffffff12}\n#series-dialog .episode-row .episode-play-btn{display:flex!important;gap:12px!important;align-items:flex-start!important;width:100%!important;background:transparent!important;border:0!important;padding:0!important;text-align:left!important}\n#series-dialog .episode-row .episode-art{width:96px!important;height:54px!important;min-width:96px!important;object-fit:cover;border-radius:8px}\n#series-dialog .episode-row .episode-info{display:block!important;flex:1 1 auto!important;min-width:0!important;padding-right:50px}\n#series-dialog .episode-row .episode-check{position:absolute!important;top:14px!important;right:0!important;width:40px!important;height:40px!important;font-size:17px!important}\n#series-dialog .episode-row .episode-sinopse{display:block!important;margin:10px 0 0 0!important;width:auto!important;max-width:none!important;transform:none!important;font-size:13.5px!important;line-height:1.55;color:#c3ccda;text-align:left}\nhtml.modo-tv #series-dialog .episode-row .episode-art{width:190px!important;height:107px!important;min-width:190px!important}\nhtml.modo-tv #series-dialog .episode-row .episode-sinopse{font-size:17px!important}\n";
if(!html.includes("episodio-final"))html=html.replace("</style>",CSS_FINAL+"</style>");
const CSS_MEDIDAS="\n/* medidas-serie: o painel cabe na tela e nada corta nas laterais */\n#series-dialog{width:min(920px,94vw)!important;max-width:94vw!important;margin:auto!important;overflow-x:hidden!important;box-sizing:border-box!important}\n#series-dialog *{box-sizing:border-box;max-width:100%}\n#series-dialog .series-body{padding-left:16px!important;padding-right:16px!important}\n#series-dialog .series-abas{padding-left:16px!important;padding-right:16px!important}\n#series-dialog .episode-row{padding-right:0!important}\n#series-dialog .episode-row .episode-info{padding-right:48px!important}\n#series-dialog .episode-row .episode-check{right:0!important;top:12px!important}\n#series-dialog .episode-row .episode-art{width:88px!important;height:50px!important;min-width:88px!important}\nhtml.modo-tv #series-dialog .episode-row .episode-art{width:170px!important;height:96px!important;min-width:170px!important}\n";
if(!html.includes("medidas-serie"))html=html.replace("</style>",CSS_MEDIDAS+"</style>");
fs.writeFileSync(path.join(assets,'index.html'),html);
fs.copyFileSync(path.join(root,'playback.js'),path.join(assets,'playback.js'));
// As legendas do aplicativo (arquivo local e busca na internet) seguem junto
// com o player — sem isso o celular ficava com uma versão antiga do arquivo.
fs.copyFileSync(path.join(root,'legendas.js'),path.join(assets,'legendas.js'));
fs.copyFileSync(path.join(root,'node_modules/hls.js/dist/hls.min.js'),path.join(assets,'hls.min.js'));
fs.copyFileSync(path.join(root,'node_modules/hls.js/LICENSE'),path.join(assets,'hls-LICENSE.txt'));
const key=fs.readFileSync(path.join(root,'server.js'),'utf8').match(/const TMDB_KEY = '([^']+)'/);
if(!key)throw Error('TMDB key missing');
fs.writeFileSync(path.join(assets,'config.json'),JSON.stringify({
  tmdbKey:key[1],
  supabaseUrl:process.env.SUPABASE_URL||localConfig.supabaseUrl||'',
  supabaseAnonKey:process.env.SUPABASE_ANON_KEY||localConfig.supabaseAnonKey||'',
  groqKey:CHAVE_JARVIS,
  // Endereço da central de status (opcional): o aplicativo do celular também
  // reporta quem entrou e o que está assistindo.
  central:String(process.env.CENTRAL_URL||localConfig.central||'').replace(/\/$/,''),
  // Segundo endereço da central (ex.: a rede privada Tailscale), usado quando o
  // primeiro não responde — assim o celular reporta tanto em casa quanto fora.
  centralAlt:String(process.env.CENTRAL_URL_ALT||localConfig.centralAlt||'').replace(/\/$/,''),
  // Arquivo de descoberta: diz qual é o endereço público do servidor agora.
  // É o que faz o celular aparecer na central mesmo fora de casa.
  descoberta:String(process.env.DESCOBERTA_URL||localConfig.descoberta||'https://invictusbr1.github.io/stream-tv-app/endereco.json'),
  // O selo de atualização na tela compara estes números com o aviso publicado no GitHub.
  app:'android',
  versionCode:Number((fs.readFileSync(path.join(__dirname,'app/build.gradle'),'utf8').match(/versionCode\s+(\d+)/)||[])[1]||0),
  versionName:(fs.readFileSync(path.join(__dirname,'app/build.gradle'),'utf8').match(/versionName\s+'([^']+)'/)||[])[1]||''
}));
console.log('Android UI synchronized.');

fs.copyFileSync(path.join(root,'library.js'),path.join(assets,'library.js'));
// Resolvedor de alta definição usado pelo aplicativo do celular (sem servidor).
fs.copyFileSync(path.join(root,'vidsrc-source.js'),path.join(assets,'vidsrc-source.js'));

fs.copyFileSync(path.join(root,'personal.js'),path.join(assets,'personal.js'));
fs.copyFileSync(path.join(root,'auth.js'),path.join(assets,'auth.js'));
fs.copyFileSync(path.join(root,'jarvis.js'),path.join(assets,'jarvis.js'));
fs.copyFileSync(path.join(root,'acesso.js'),path.join(assets,'acesso.js'));
fs.copyFileSync(path.join(root,'fontes.json'),path.join(assets,'fontes.json'));
fs.copyFileSync(path.join(root,'legendas.js'),path.join(assets,'legendas.js'));
