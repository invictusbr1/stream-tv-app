'use strict';
const fs=require('fs'),path=require('path');
// Reuse the approved web design, enabling it only on the Android phone channel.
function phonePage(html){
 const root=path.resolve(__dirname,'..');
 let script=fs.readFileSync(path.join(root,'pwa/redesign.js'),'utf8');
 const guard='/StreamTVAndroid|SMART-TV|';
 if(!script.includes(guard))throw Error('The web UI platform guard changed; review the phone adapter.');
 script=script.replace(guard,'/StreamTVAndroidTV|SMART-TV|');
 script=script.replace('if(!movie){originalOpen(f);return;}','if(!movie){return originalOpen(f);}')
 const css=fs.readFileSync(path.join(root,'pwa/redesign.css'),'utf8')+'\n'+fs.readFileSync(path.join(__dirname,'phone.css'),'utf8');
 const phoneScript=fs.readFileSync(path.join(__dirname,'phone.js'),'utf8');
 return html.replace('</head>','<style id="android-phone-design">'+css+'</style></head>')
  .replace('</body>','<script id="android-phone-details">'+script+'</script><script>'+phoneScript+'</script></body>');
}
module.exports={phonePage};
