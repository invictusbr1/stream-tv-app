const test = require('node:test'), assert = require('node:assert/strict');
const {detect, geometry, createConfidence} = require('./enquadramento');
function image({w=160,h=120,l=0,r=0,t=0,b=0,dark=false,caption=false}={}) {
    const data = new Uint8ClampedArray(w*h*4);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
        const i=(y*w+x)*4,inside=x>=l&&x<w-r&&y>=t&&y<h-b;
        data[i]=data[i+1]=data[i+2]=inside&&!dark?140:0;data[i+3]=255;
    }
    if(caption)for(let y=h-6;y<h-3;y++)for(let x=40;x<120;x++)data[(y*w+x)*4]=240;
    return {data,w,h};
}
test('imagem inteira não recebe corte; bordas simétricas preservam margem',()=>{
    const whole=image(),boxed=image({t:16,b:16});
    assert.deepEqual(detect(whole.data,whole.w,whole.h),{l:0,t:0,r:0,b:0});
    const box=detect(boxed.data,boxed.w,boxed.h);
    assert(box.t>0&&box.t<16/120);assert(box.b>0&&box.b<16/120);
});
test('cena escura, conteúdo muito pequeno e bordas assimétricas são recusados',()=>{
    for(const opts of [{dark:true},{l:50,r:50,t:40,b:40},{t:20,b:0}]){
        const f=image(opts);assert.equal(detect(f.data,f.w,f.h),null);
    }
});
test('texto na faixa preta impede tratar essa área como borda segura',()=>{
    const f=image({t:16,b:16,caption:true});
    assert.equal(detect(f.data,f.w,f.h),null);
});
test('zoom requer sete momentos distintos, por pelo menos doze segundos',()=>{
    const c=createConfidence(),b={l:0,r:0,t:.1,b:.1};
    for(let i=0;i<6;i++)assert.equal(c.add(b,i*2),null);
    assert.deepEqual(c.add(b,12),b);
    c.reset();for(let i=0;i<10;i++)assert.equal(c.add(b,0),null);
});
test('mudança de formato e cena escura invalidam a confiança anterior',()=>{
    const c=createConfidence(),b={l:0,r:0,t:.1,b:.1};
    for(let i=0;i<6;i++)c.add(b,i*2);
    assert.equal(c.add({l:0,r:0,t:0,b:0},12),null);
    assert.equal(c.add(null,14),null);
    assert.equal(c.add(b,16),null);
});
test('a união das amostras mantém todo o conteúdo observado',()=>{
    const c=createConfidence();let result;
    for(let i=0;i<7;i++)result=c.add({l:0,r:0,t:.1+i*.001,b:.1},i*2);
    assert.equal(result.t,.1);
});
test('automático cabe na tela e preserva a proporção em pé e deitado',()=>{
    for(const [w,h] of [[390,844],[844,390],[1920,1080]]){
        const b={l:0,r:0,t:.125,b:.125};
        const g=geometry(w,h,480,360,b),base=Math.min(w/480,h/360);
        assert(g.scale>=1&&g.scale<=1.5);
        assert(480*base*g.scale<=w+.001);
        assert(270*base*g.scale<=h+.001);
        assert.equal(g.x,0);assert.equal(g.y,0);
    }
});

function controller() {
 const vm=require('node:vm'),fs=require('node:fs');const timers=[];
 const button={hidden:true,attrs:{},setAttribute(k,v){this.attrs[k]=v;},innerHTML:''};
 const document={hidden:false,getElementById:id=>id==='framing-toggle'?button:null,createElement(){throw Error('SecurityError');}};
 const window={document,navigator:{userAgent:'StreamTVAndroid Android'},addEventListener(){}};
 vm.runInNewContext(fs.readFileSync(require.resolve('./enquadramento'),'utf8'),{window,document,console,setInterval:fn=>(timers.push(fn),1),clearInterval(){}});
 const video={style:{},textTracks:[],videoWidth:480,videoHeight:360,readyState:4,currentTime:20,paused:false,seeking:false,parentElement:{classList:{add(){}}},addEventListener(){},removeEventListener(){}};
 return {api:window.StreamFraming,video,button,timers};
}
test('um único ícone alterna ampliar e diminuir, sem painel ou seletor',()=>{
 const {api,video,button}=controller();api.attach(video);
 assert.equal(button.hidden,false);assert.equal(button.attrs['aria-label'],'Ampliar imagem');assert(button.innerHTML.startsWith('<svg'));
 api.toggle();assert.equal(video.style.objectFit,'cover');assert.equal(button.attrs['aria-label'],'Diminuir imagem');
 api.toggle();assert.equal(video.style.objectFit,'contain');assert.equal(video.style.transform,'');assert.equal(button.attrs['aria-label'],'Ampliar imagem');
 api.attach(null);assert.equal(button.hidden,true);
});
test('fonte que impede análise preserva o original e continua permitindo o botão manual',()=>{
 const {api,video,button,timers}=controller();api.attach(video);timers[0]();
 assert.equal(video.style.objectFit,'contain');assert.equal(video.style.transform,'');assert.equal(button.hidden,false);
 api.toggle();assert.equal(video.style.objectFit,'cover');
});
