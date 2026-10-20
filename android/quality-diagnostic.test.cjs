'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {clean,format}=require('./app/src/main/assets/quality-diagnostic.js');
test('diagnóstico não inclui endereços nem mensagens livres e mantém resolução real',()=>{
 const d=clean({id:'1022789',hevc:true,escolhida:'fallback',fontes:[{id:'clickhost',motivo:'conexao_tls',largura:0,altura:0,ms:1000},{id:'fallback',motivo:'validada',largura:1920,altura:808,idioma:2},{id:'unsafe',motivo:'https://secret.invalid/token'},{id:'https://private.invalid',motivo:'validada'}]});
 assert.equal(d.fontes.length,3);assert.equal(d.fontes[2].motivo,'verificacao_falhou');assert.match(format(d),/1920×808/);assert.match(format(d),/HEVC habilitado/);assert.doesNotMatch(JSON.stringify(d),/secret|private|https/);
 assert.equal(clean({id:'invalid',fontes:[]}),null);
});
test('diagnóstico limita dados externos e reconhece HTTP sem aceitar mensagens arbitrárias',()=>{
 const d=clean({id:'1',hevc:false,fontes:Array.from({length:50},()=>({id:'clickhost',motivo:'http_403',largura:999999,ms:999999}))});
 assert.equal(d.fontes.length,12);assert.equal(d.fontes[0].largura,32768);assert.equal(d.fontes[0].ms,120000);assert.match(format(d),/http_403/);
});
test('recebe o diagnóstico uma vez, descarta episódio antigo e tolera central indisponível',async()=>{
 const vm=require('node:vm'),fs=require('node:fs');
 const element=()=>({children:[],style:{},append(...nodes){this.children.push(...nodes);},querySelector(tag){return this.children.find(x=>x.tag===tag);}});
 const host=element(),listeners={},events=[];
 const context={filmeAtual:{id:1,titulo:'Teste',episode:{season:1,number:2}},document:{querySelector:()=>host,createElement:tag=>Object.assign(element(),{tag}),addEventListener:(type,fn)=>listeners[type]=fn},StreamAcesso:{reportar:e=>{events.push(e);return Promise.reject(Error('offline'));}}};context.window=context;
 vm.runInNewContext(fs.readFileSync(require.resolve('./app/src/main/assets/quality-diagnostic.js'),'utf8'),context);
 const d={id:'1',temporada:'1',episodio:'2',hevc:true,escolhida:'clickhost',fontes:[{id:'clickhost',motivo:'validada',largura:3840,altura:1608,idioma:2}]};
 context.StreamQualityDiagnostic.receive(d);context.StreamQualityDiagnostic.receive(d);
 assert.equal(host.children.length,1);assert.equal(events.length,1);assert.match(host.children[0].querySelector('pre').textContent,/3840×1608/);
 context.filmeAtual.episode.number=3;listeners.click();assert.equal(host.children[0].hidden,true);
 context.StreamQualityDiagnostic.receive(d);assert.equal(events.length,1);
 context.StreamQualityDiagnostic.receive({...d,episodio:'3'});assert.equal(events.length,2);assert.equal(host.children[0].hidden,false);
 await new Promise(resolve=>setImmediate(resolve));
});
