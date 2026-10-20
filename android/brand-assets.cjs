'use strict';
// Geometria única da marca aprovada: gera SVG, ícones PWA e vetores Android.
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const ribbons=[
 {color:'#C50021',gradient:['#F00026','#A90020'],from:[120,110],to:[400,500],d:'M510 135 C485 196 426 207 375 184 C325 161 281 144 236 157 C180 174 145 217 145 278 C145 340 187 382 251 390 C313 399 358 369 408 370 C451 371 489 387 505 407 C449 474 360 522 269 519 C158 516 75 446 67 334 C59 223 116 122 207 83 C311 39 403 67 510 135 Z'},
 {color:'#820016',gradient:['#41000C','#B5001C'],from:[300,364],to:[470,430],d:'M251 390 C313 399 358 369 408 370 C451 371 489 387 505 407 C470 438 423 443 383 436 C333 427 289 412 251 390 Z'},
 {color:'#D50023',gradient:['#8F001B','#F00028'],from:[198,180],to:[325,505],d:'M70 278 C96 222 142 178 199 158 C249 139 303 152 375 184 C306 163 238 192 208 236 C171 293 191 345 251 390 C289 412 333 427 383 436 C423 443 470 438 505 407 C449 474 360 522 269 519 C158 516 75 446 67 334 C65 299 68 259 70 278 Z'},
 {color:'#F00923',gradient:['#FF112B','#E9001C'],from:[230,75],to:[430,190],d:'M510 135 C486 196 426 207 375 184 C303 152 249 139 199 158 C142 178 96 222 70 278 C80 189 130 119 207 83 C311 39 403 67 510 135 Z'}
];
const defs=ribbons.map((r,i)=>`<linearGradient id="r${i}" gradientUnits="userSpaceOnUse" x1="${r.from[0]}" y1="${r.from[1]}" x2="${r.to[0]}" y2="${r.to[1]}"><stop stop-color="${r.gradient[0]}"/><stop offset="1" stop-color="${r.gradient[1]}"/></linearGradient>`).join('');
const shapes=ribbons.map((r,i)=>`<path fill="url(#r${i})" d="${r.d}"/>`).join('');
const svg=(icon=false)=>`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600">${icon?'<path fill="#08090C" d="M0 0H600V600H0Z"/>':''}<defs>${defs}</defs><g${icon?' transform="translate(48 48) scale(.84)"':''}>${shapes}</g></svg>`;
function vector(gradient=false,background=false,adaptive=false){return `<vector xmlns:android="http://schemas.android.com/apk/res/android" xmlns:aapt="http://schemas.android.com/aapt" android:width="108dp" android:height="108dp" android:viewportWidth="600" android:viewportHeight="600">${background?'<path android:fillColor="#08090C" android:pathData="M0,0H600V600H0Z"/>':''}<group${adaptive?' android:pivotX="300" android:pivotY="300" android:scaleX="0.84" android:scaleY="0.84"':''}>${ribbons.map(r=>`<path android:pathData="${r.d}"${gradient?'':` android:fillColor="${r.color}"`}>${gradient?`<aapt:attr name="android:fillColor"><gradient android:startX="${r.from[0]}" android:startY="${r.from[1]}" android:endX="${r.to[0]}" android:endY="${r.to[1]}" android:startColor="${r.gradient[0]}" android:endColor="${r.gradient[1]}" android:type="linear"/></aapt:attr>`:''}</path>`).join('')}</group></vector>`;}
async function build(){
 fs.writeFileSync(path.join(root,'conecta-mark.svg'),svg());
 const res=path.join(__dirname,'app/src/main/res');
 for(const [folder,grad]of [['drawable',false],['drawable-v24',true]]){
  fs.mkdirSync(path.join(res,folder),{recursive:true});
  fs.writeFileSync(path.join(res,folder,'app_icon.xml'),vector(grad,true));
  fs.writeFileSync(path.join(res,folder,'app_foreground.xml'),vector(grad,false,true));
 }
 fs.mkdirSync(path.join(res,'drawable-v26'),{recursive:true});
 fs.writeFileSync(path.join(res,'drawable-v26/app_icon.xml'),'<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android"><background android:drawable="@color/brand_background"/><foreground android:drawable="@drawable/app_foreground"/></adaptive-icon>');
 fs.writeFileSync(path.join(res,'values/brand.xml'),'<resources><color name="brand_background">#08090C</color></resources>');
 // Banner de TV reaproveita o mesmo símbolo; a própria TV já mostra o nome.
 fs.writeFileSync(path.join(res,'drawable/tv_banner.xml'),`<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="160dp" android:height="90dp" android:viewportWidth="640" android:viewportHeight="360"><path android:fillColor="#08090C" android:pathData="M0,0H640V360H0Z"/><group android:scaleX="0.52" android:scaleY="0.52" android:translateX="164" android:translateY="24">${ribbons.map(r=>`<path android:fillColor="${r.color}" android:pathData="${r.d}"/>`).join('')}</group></vector>`);
 const sharp=require('sharp');
 for(const size of [180,192,512])await sharp(Buffer.from(svg(true))).resize(size,size).png().toFile(path.join(root,`pwa/icon-${size}.png`));
 console.log('Marca, vetores Android e ícones PWA gerados.');
}
module.exports={svg,vector};
if(require.main===module)build().catch(e=>{console.error(e.message);process.exitCode=1;});
