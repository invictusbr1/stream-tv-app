'use strict';
const provas=require('../provas-idioma');

// Um trabalhador, fila limitada e pedidos agrupados por título. A reprodução
// nunca espera a transcrição, nem recebe uma página de player externo.
function criarFila({ verificar, agora=Date.now, limite=16, intervalo=15*60000 }) {
    const fila=[], agendados=new Set(), recentes=new Map();let ativo=false;
    async function executar() {
        if(ativo)return;ativo=true;
        try{while(fila.length){const titulo=fila.shift();try{await verificar(titulo);}catch{}finally{agendados.delete(titulo);recentes.set(titulo,agora()+intervalo);}}}
        finally{ativo=false;}
    }
    return { solicitar(titulo){
        if(!provas.tituloValido(titulo)||agendados.has(titulo)||(recentes.get(titulo)||0)>agora()||fila.length>=limite)return false;
        if(recentes.size>=256)recentes.delete(recentes.keys().next().value);
        agendados.add(titulo);fila.push(titulo);void executar();return true;
    }, estado:()=>({ativo,pendentes:fila.length}) };
}

function criarVerificador({central,chaveIa,registrar=()=>{}}) {
    return async titulo=>{
        const motor=require('../fontes-motor'),avaliador=require('../avaliador'),midia=require('./verificar-midia');
        const [tipo,id,temporada,episodio]=titulo.split(':');
        const alvo={tipo,tmdbId:id,...(tipo==='tv'?{temporada:Number(temporada),episodio:Number(episodio)}:{})};
        const candidatas=[];const limite=Date.now()+10000;
        let encerrado=false;
        const prazo=(p,ms)=>new Promise(resolve=>{const timer=setTimeout(()=>resolve(null),ms);Promise.resolve(p).then(v=>{clearTimeout(timer);resolve(v);},()=>{clearTimeout(timer);resolve(null);});});
        const consultas=Promise.all(motor.filaDeFontes('dublado',alvo).map(async fonte=>{
            const resposta=await prazo(Promise.resolve().then(()=>fonte.resolverTodos?fonte.resolverTodos(alvo):fonte.resolver(alvo)),7000);
            const lista=Array.isArray(resposta)?resposta:resposta?[resposta]:[];
            await Promise.all(lista.filter(d=>d?.type==='file'&&d.audio==='pt-BR').slice(0,8).map(async dados=>{
                if(encerrado||Date.now()>=limite)return;
                const sonda=await avaliador.sondar(dados,{timeout:Math.max(1,Math.min(5000,limite-Date.now())),rapida:true});
                if(!encerrado&&sonda?.largura>0&&sonda?.altura>0)candidatas.push({fonteId:fonte.id,dados,sonda});
            }));
        }));
        await prazo(consultas,10000);encerrado=true;
        const vistas=new Set();
        const desconhecidas=candidatas.filter(c=>{
            if(c.sonda.padraoPortugues||c.sonda.portuguesa||c.sonda.audios?.some(a=>a.lang&&a.lang!=='und'))return false;
            const hash=provas.identidade(titulo,c.fonteId,c.dados.url,c.dados.referer);
            if(vistas.has(hash)||provas.idioma(midia.lerCache(central),titulo,c.fonteId,c.dados))return false;
            vistas.add(hash);return true;
        }).sort((a,b)=>b.sonda.largura*b.sonda.altura-a.sonda.largura*a.sonda.altura).slice(0,2);
        for(const c of desconhecidas){
            const resultado=await midia.verificarIdioma({url:c.dados.url,referer:c.dados.referer,tipo,amostra:{id,temporada,episodio},fonteId:c.fonteId,chaveIa:chaveIa(),central,registrar});
            registrar(`Qualidade: ${titulo}, ${c.sonda.largura}×${c.sonda.altura}, áudio ${resultado?.idioma||'indefinido'}`);
        }
    };
}
module.exports={criarFila,criarVerificador};
