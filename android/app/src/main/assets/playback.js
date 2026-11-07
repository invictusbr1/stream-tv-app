'use strict';
// First-party video element: actual playback events, HLS quality and fullscreen.
// Página do filme aberta: começa a preparar a fonte depois de um instante
// (quem só passa pela página não gera consulta). O catálogo pode trocar o
// StreamLibrary.open (interface nova da web e do celular), então o gancho entra
// depois que tudo carregou.
window.addEventListener?.('load',()=>{
    const biblioteca=window.StreamLibrary;if(!biblioteca||typeof biblioteca.open!=='function')return;
    const abrirOriginal=biblioteca.open;
    biblioteca.open=function(f){
        const resultado=abrirOriginal.apply(this,arguments);
        if(f&&f.tipo!=='tv'&&/^\d{1,10}$/.test(String(f.id)))setTimeout(()=>{
            if(document.getElementById('player')?.classList.contains('ativo'))return;
            window.StreamPlayback?.preparar?.('/api/playback/'+f.id,60000);
        },700);
        return resultado;
    };
});
// Aplicativo do PC: o vídeo toca no player do Windows (mpv), que aceita 4K
// HEVC, MKV e som Dolby. Só liga quando a página foi aberta pelo próprio
// aplicativo (endereço deste computador + chave da abertura).
window.StreamPC = (() => {
    let chave='';
    try{
        const local=['127.0.0.1','localhost'].includes(location.hostname);
        const q=new URLSearchParams(location.search).get('pc');
        if(local&&q&&/^[a-f0-9]{32,64}$/.test(q)){sessionStorage.setItem('conecta-pc',q);const limpa=new URLSearchParams(location.search);limpa.delete('pc');history.replaceState(null,'',location.pathname+(limpa.toString()?'?'+limpa:'')+location.hash);}
        if(local)chave=sessionStorage.getItem('conecta-pc')||'';
    }catch{}
    // Até o player do PC terminar de instalar, os vídeos tocam no navegador
    // como no site (nada fica esperando a instalação).
    let pronto=false;
    const ativo=()=>Boolean(chave)&&pronto;
    async function api(caminho,corpo){
        const r=await fetch('/api/pc/'+caminho,corpo===undefined?{headers:{'x-conecta-pc':chave}}:{method:'POST',headers:{'x-conecta-pc':chave,'Content-Type':'application/json'},body:JSON.stringify(corpo)});
        const dados=await r.json().catch(()=>({}));
        if(!r.ok){const e=new Error(dados.erro||('falhou ('+r.status+')'));e.dados=dados;throw e;}
        return dados;
    }
    // Mantém o aplicativo aberto enquanto a janela existir (sem gastar: o
    // servidor só responde quando algo muda ou a cada 20 s).
    function faixa(texto,{erro=false,botao=null,some=0}={}){
        let f=document.getElementById('pc-instalacao');
        if(!texto){f?.remove();return;}
        if(!f){f=document.createElement('div');f.id='pc-instalacao';f.setAttribute('role','status');f.style.cssText='position:fixed;right:16px;top:16px;z-index:2147483000;display:flex;gap:12px;align-items:center;max-width:min(92vw,620px);padding:12px 16px;border-radius:12px;background:#151a24;color:#fff;border:1px solid #2c3446;box-shadow:0 8px 30px #0008;font:14px/1.4 system-ui,sans-serif;pointer-events:auto';document.body.append(f);}
        f.style.borderColor=erro?'#7a3434':'#2c3446';f.replaceChildren();
        const t=document.createElement('span');t.textContent=texto;f.append(t);
        if(botao){const b=document.createElement('button');b.textContent=botao.texto;b.style.cssText='padding:6px 12px;border-radius:8px;border:0;background:#fff;color:#000;cursor:pointer;font:inherit';b.onclick=botao.acao;f.append(b);}
        const x=document.createElement('button');x.textContent='×';x.setAttribute('aria-label','Fechar aviso');x.style.cssText='background:none;border:0;color:#aaa;font-size:20px;cursor:pointer;padding:0 4px';x.onclick=()=>f.remove();f.append(x);
        clearTimeout(faixa.t);if(some)faixa.t=setTimeout(()=>f.remove(),some);
    }
    async function acompanharInstalacao(){
        let pedido=false,mostrou=false;
        for(;;){
            let e=null;try{e=await api('estado');}catch{}
            const i=e?.instalacao;
            if(i?.pronto){pronto=true;if(mostrou)faixa('Player 4K do PC pronto. Os próximos vídeos já abrem nele.',{some:6000});return;}
            if(i&&!i.instalando&&i.erro&&pedido){faixa('Não consegui instalar o player 4K: '+i.erro+'. Os vídeos seguem tocando aqui.',{erro:true,botao:{texto:'Tentar de novo',acao:()=>{faixa('');acompanharInstalacao();}}});return;}
            if(i&&!i.instalando&&!pedido){pedido=true;try{await api('instalar',{});}catch{}}
            if(i?.instalando){mostrou=true;faixa('Instalando o player 4K do PC (só na primeira vez)'+(Number.isFinite(i.porcento)&&i.porcento!==null?' · '+i.porcento+'%':' · '+(i.passo||'preparando'))+'. Enquanto isso, os vídeos tocam aqui mesmo.');}
            await new Promise(r=>setTimeout(r,i?.instalando?1500:3000));
        }
    }
    if(chave){(async()=>{for(;;){try{await api('esperar?ms=20000');}catch{await new Promise(r=>setTimeout(r,5000));}}})();
        const comecar=()=>acompanharInstalacao();
        if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',comecar,{once:true});else comecar();}
    return {ativo,api};
})();
window.StreamPlayback = (() => {
    const notaQualidade=document.querySelector('.quality');if(notaQualidade)notaQualidade.textContent='O áudio e a qualidade são definidos pela fonte; o aplicativo escolhe a melhor opção disponível.';
    const preference=document.createElement('label');preference.style.cssText='display:flex;gap:10px;align-items:center;margin:20px 0;font-size:13px';
    const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.id='auto-fullscreen';
    let stored=null;try{stored=localStorage.getItem('streamtv-fullscreen');}catch{}
    checkbox.checked=stored===null?/StreamTVAndroidTV/.test(navigator.userAgent):stored==='true';
    checkbox.onchange=()=>{try{localStorage.setItem('streamtv-fullscreen',String(checkbox.checked));}catch{}};
    preference.append(checkbox,document.createTextNode('Abrir filmes em tela cheia'));el('fontes').before(preference);
    el('quality-select').onchange=e=>quality(e.target.value);
    el('subtitle-select').onchange=e=>setSubtitle(Number(e.target.value),true);
    let buscaEsgotada=false;let aoVivo=false;let relogioConfirmacao=null,relatoFeito=false,relatoConfirmado=false;let aplicandoLegenda=false;let subtitleManual=false;let subtitleChoice=-1,progressFilm=null,lastSaved=0,resumeApplied=false,audioChoice=-1,speed=1,volume=1,mudo=false,arrastando=false,rotuloAudio='Dublado',fonteUsada='',fonteIdUsada='',alturaAtual=0,alturaAnunciada=0;
    try{const guardado=localStorage.getItem('streamtv-volume');if(guardado!==null)volume=Math.min(1,Math.max(0,Number(guardado)));mudo=localStorage.getItem('streamtv-mudo')==='true';}catch{}
    try{speed=Number(localStorage.getItem('streamtv-speed'))||1;}catch{}
    if(![0.75,1,1.25,1.5,2].includes(speed))speed=1;
    function setSpeed(value){speed=[0.75,1,1.25,1.5,2].includes(Number(value))?Number(value):1;if(video)video.playbackRate=speed;const select=el('speed-select');if(select)select.value=String(speed);try{localStorage.setItem('streamtv-speed',String(speed));}catch{}atualizarBotoesAjuste();}
    function setAudio(value){const escolha=Number(value);audioChoice=Number.isInteger(escolha)&&escolha>=0?escolha:-1;if(hls&&audioChoice>=0){hls.audioTrack=audioChoice;const track=hls.audioTracks?.[audioChoice];if(track){rotuloAudio=portuguese(track)?'Dublado':'som original';analiseAtual?.fonte({audio:rotuloAudio});sincronizarLegendas();qualityInfo();audioMenu();}}}
    el('speed-select').onchange=e=>setSpeed(e.target.value);
    el('audio-select').onchange=e=>setAudio(e.target.value);
    function audioMenu(){
        const tracks=hls?.audioTracks||[],panel=el('audio-panel');if(!panel)return;
        if(tracks.length<2){const unica=el('audio-select');if(unica){unica.disabled=true;unica.replaceChildren();const opcao=document.createElement('option');opcao.textContent='Faixa única desta fonte';unica.append(opcao);}panel.hidden=false;return;}
        const select=el('audio-select');select.disabled=false;select.replaceChildren();
        tracks.forEach((track,index)=>{const option=document.createElement('option');option.value=String(index);option.textContent=track.name||track.label||track.lang||`Faixa ${index+1}`;select.append(option);});
        const pt=tracks.findIndex(portuguese);
        const atual=audioChoice>=0?audioChoice:Number.isInteger(hls?.audioTrack)&&hls.audioTrack>=0?hls.audioTrack:(pt>=0?pt:0);
        select.value=String(atual);
        panel.hidden=false;
        el('audio-info').textContent=portuguese(tracks[atual]||{})?'A faixa dublada em português está selecionada.':'Áudio original selecionado.';
    }
    function saveProgress(){if((!video&&!pcAtivo)||!imagemConfirmada)return;const agora=pcAtivo?pcPosicao:posicaoNoFilme(),total=pcAtivo?pcDuracao:totalDoFilme();if(progressFilm)window.StreamAuth?.publicarAssistindo?.(progressFilm,agora);if(progressFilm&&resumeApplied)window.StreamPersonal?.record(progressFilm,agora,total);}
    function resume(){if(!video||!progressFilm||resumeApplied||!Number.isFinite(video.duration)||video.duration<=0)return;const position=retomadaAlvo??window.StreamPersonal?.position(progressFilm)??0;try{if(position>=(retomadaAlvo===null?1:0)&&position<video.duration)video.currentTime=position;else if(position>=video.duration&&retomadaAlvo!==null)video.currentTime=Math.max(0,video.duration-1);resumeApplied=true;}catch{}}
    document.addEventListener('visibilitychange',()=>{if(document.hidden){saveProgress();limparEspera();analiseAtual?.pausar(posicaoAtual());}else if(verificarAtual?.()&&imagemConfirmada&&intencaoTocar&&!video.paused&&!video.ended){analiseAtual?.tocando(posicaoAtual());if(video.readyState<3)esperando(verificarAtual);}});
    window.addEventListener?.('pagehide',saveProgress);
    function listaDeLegendas(){
        const doHls=hls?.subtitleTracks||[];
        const rotulos=new Set(doHls.map(t=>t.name||t.label||t.language||''));
        const todasNativas=Array.from(video?.textTracks||[]).filter(t=>!t.kind||t.kind==='subtitles'||t.kind==='captions');
        const nativas=todasNativas.filter(t=>!rotulos.has(t.label||t.language||''));
        return {tracks:[...doHls,...nativas],hlsCount:doHls.length,todasNativas};
    }
    // Quando o áudio é o original, a legenda em português entra ligada sozinha.
    function nomeDaTrilhaDeLegenda(t){return String(t?.name||t?.label||t?.lang||t?.language||'');}
    function indiceLegendaPortugues(){
        // Procura em todas as faixas na mesma ordem do menu: primeiro as que
        // vêm da fonte e depois as do próprio aplicativo (arquivo local ou
        // legenda baixada na hora).
        const {tracks}=listaDeLegendas();
        const brasileira=tracks.findIndex(t=>/portugu[eê]s\s*\(?brazil|brazil.*portugu|brazillian/i.test(nomeDaTrilhaDeLegenda(t)));
        if(brasileira>=0)return brasileira;
        return tracks.findIndex(t=>{const nome=nomeDaTrilhaDeLegenda(t);const idioma=String(t?.srclang||t?.language||'');return /portugu|brazil|brasil|^pt([-_]|$)/i.test(nome)||/^pt([-_]|$)/i.test(idioma);});
    }
    function escolherLegendaAutomatica(){
        if(subtitleManual||subtitleChoice>=0||rotuloAudio==='Dublado')return false;
        const indice=indiceLegendaPortugues();
        if(indice<0)return false;
        setSubtitle(indice);
        // Deixa claro para quem está assistindo por que a legenda entrou sozinha.
        try{window.mostrarStatus?.('Som original · legenda em português');}catch{}
        return true;
    }
    function sincronizarLegendas(){
        if(aplicandoLegenda)return;
        if(!subtitleManual&&rotuloAudio==='Dublado'){setSubtitle(-1);return;}
        if(!escolherLegendaAutomatica())setSubtitle(subtitleChoice);
    }
    function subtitleMenu(){
        const tracks=listaDeLegendas().tracks;const select=el('subtitle-select');select.replaceChildren();
        const off=document.createElement('option');off.value='-1';off.textContent='Desativadas';select.append(off);
        tracks.forEach((t,i)=>{const option=document.createElement('option');option.value=String(i);option.textContent=t.name||t.label||t.lang||t.language||`Legenda ${i+1}`;select.append(option);});
        if(subtitleChoice>=tracks.length)subtitleChoice=-1;select.value=String(subtitleChoice);select.disabled=!tracks.length;
        el('subtitle-info').textContent=tracks.length?'Escolha uma faixa ou mantenha desativadas.':'Sem legendas ainda. Coloque arquivos .srt na pasta Legendas do aplicativo, com o nome do filme.';
    }
    function setSubtitle(index,manual=false){
        if(aplicandoLegenda)return;
        aplicandoLegenda=true;
        try{
        if(manual)subtitleManual=true;
        const {tracks,hlsCount,todasNativas}=listaDeLegendas();
        const escolha=Number.isInteger(index)&&index>=0&&index<tracks.length?index:-1;
        subtitleChoice=escolha;
        if(hls){const noHls=escolha>=0&&escolha<hlsCount,track=noHls?escolha:-1;if(hls.config)hls.config.subtitlePreference={id:track};if(hls.subtitleDisplay!==noHls)hls.subtitleDisplay=noHls;if(hls.subtitleTrack!==track)hls.subtitleTrack=track;}
        const nativaEscolhida=escolha>=hlsCount?tracks[escolha]:null;
        todasNativas.forEach(trilha=>{
            // O motor HLS controla as cópias nativas de suas próprias faixas.
            if(escolha>=0&&escolha<hlsCount&&!tracks.slice(hlsCount).includes(trilha))return;
            if(trilha&&typeof trilha==='object'&&'mode' in trilha){const mode=trilha===nativaEscolhida?'showing':'disabled';if(trilha.mode!==mode)trilha.mode=mode;}
        });
        el('subtitle-select').value=String(escolha);
        atualizarBotoesAjuste();
        }finally{aplicandoLegenda=false;}
    }

    const android=/StreamTVAndroid/.test(navigator.userAgent);
    // Televisões (Samsung/Tizen, LG/webOS, Android TV e afins) tocam listas HLS
    // pelo próprio aparelho. Quando o motor do navegador não der imagem, o
    // aplicativo tenta esse caminho nativo antes de desistir da fonte.
    const televisao=/SMART-TV|Tizen|HbbTV|NetCast|webOS|GoogleTV|BRAVIA|AndroidTV|FireTV/i.test(navigator.userAgent||'');
    let initialFocus=false, frameCallback=null;
    let hls=null, video=null, generation=0, settle=null, startupTimer=null, controlsTimer=null, direct=false;
    let opcoesAtuais=null,analiseAtual=null,imagemConfirmada=false,ultimaPosicao=0,retomadaAlvo=null;
    // Filme em conversão (TorBox): a lista HLS cresce enquanto converte, então
    // video.duration vai subindo. A duração real vem do servidor (ffprobe do
    // arquivo original) e é a que aparece no relógio e na barra.
    let duracaoTotal=0;
    // Conversão que começa no meio do filme (ex.: continuar do minuto 33): o
    // vídeo convertido começa em `deslocamento` segundos do filme. O relógio, a
    // barra e o "continuar assistindo" usam sempre o tempo do FILME.
    let deslocamento=0,conversaoAtiva=false,ultimoInicio=null;
    function totalDoFilme(){const d=video&&Number.isFinite(video.duration)?deslocamento+video.duration:0;return duracaoTotal>d?duracaoTotal:d;}
    function posicaoNoFilme(){return deslocamento+(video?video.currentTime:0);}
    // Fora do trecho já convertido: pede ao servidor uma conversão nova a
    // partir do ponto (o ffmpeg pula direto para lá, sem converter o meio).
    function foraDoConvertido(absoluto){if(!conversaoAtiva||!video||!Number.isFinite(video.duration))return false;const rel=absoluto-deslocamento;return rel<0||(rel>video.duration-2&&totalDoFilme()>deslocamento+video.duration+5);}
    function reabrirNoPonto(absoluto){const u=ultimoInicio;if(!u)return;try{window.setLoading?.('Indo para '+clock(absoluto),'Preparando em alta qualidade…');}catch(e){}start(u.id,u.version,u.signal,u.caminho,undefined,u.originalPermitido,null,{...(opcoesAtuais||{}),posicao:Math.floor(absoluto)});}
    let pcAtivo=false,pcSessao='',pcPosicao=0,pcDuracao=0;
    let travamentoTimer=null,ajusteTimer=null,voltarMelhorTimer=null,restaurado=false,removerAbort=null,verificarAtual=null,intencaoTocar=false,pausadoPeloUsuario=false,qualidadeEscolhida='best',ajustouConexao=false;
    function limparEspera(){clearTimeout(travamentoTimer);clearTimeout(ajusteTimer);travamentoTimer=null;ajusteTimer=null;}
    function posicaoAtual(){if(pcAtivo)return imagemConfirmada?pcPosicao:Math.max(0,retomadaAlvo||0);const ponto=Number(video?.currentTime);return imagemConfirmada?(Number.isFinite(ponto)&&ponto>=0?(video?.error&&ponto===0&&!video.seeking?ultimaPosicao:ponto):ultimaPosicao):Math.max(0,retomadaAlvo||0);}
    function esperando(current){
        if(!current()||!imagemConfirmada||!intencaoTocar||video.paused||video.seeking||video.ended||document.hidden)return;
        analiseAtual?.esperar(posicaoAtual());
        if(travamentoTimer!==null)return;
        ajusteTimer=setTimeout(()=>{
            if(!current()||!intencaoTocar||video.paused||video.seeking||document.hidden)return;
            if(hls&&qualidadeEscolhida==='best'&&!ajustouConexao){
                ajustouConexao=true;quality('-1');try{window.mostrarStatus?.('Ajustando a qualidade à conexão…');}catch{}
                // Engasgou: cai para a automática agora, mas a qualidade não pode
                // ficar rebaixada para o resto da sessão. Depois de 45s tocando sem
                // parar, tenta a melhor versão de novo — uma única vez, para não oscilar.
                clearTimeout(voltarMelhorTimer);
                voltarMelhorTimer=setTimeout(()=>{
                    if(restaurado||!current()||!intencaoTocar||video.paused||video.seeking||video.ended||document.hidden)return;
                    restaurado=true;quality('best');try{window.mostrarStatus?.('Voltando à melhor qualidade…');}catch{}
                },45000);
            }
        },6000);
        // Filme em conversão: a pausa costuma ser o servidor preparando o
        // próximo trecho, não a fonte caída — espera mais antes de trocar.
        if(conversaoAtiva){try{window.mostrarStatus?.('Carregando… o servidor está preparando o próximo trecho');}catch{}}
        travamentoTimer=setTimeout(()=>{travamentoTimer=null;if(current()&&intencaoTocar&&!video.paused&&!video.seeking&&!video.ended&&!document.hidden)failure('o vídeo ficou sem avançar');},conversaoAtiva?60000:20000);
    }
    function stop(resultado='fechou'){if(pcAtivo){saveProgress();pcAtivo=false;pcSessao='';window.StreamPC?.api('parar',{}).catch(()=>{});el('pc-tocando')?.remove();}window.StreamCredits?.detach();window.StreamIntro?.detach();window.StreamEpisodes?.replaying?.();window.StreamFraming?.attach(null);saveProgress();analiseAtual?.encerrar(resultado,posicaoAtual());limparEspera();removerAbort?.();removerAbort=null;intencaoTocar=false;verificarAtual=null;opcoesAtuais=null;analiseAtual=null;imagemConfirmada=false;subtitleChoice=-1;subtitleManual=false;clearTimeout(relogioConfirmacao);if(video&&frameCallback!==null&&video.cancelVideoFrameCallback)video.cancelVideoFrameCallback(frameCallback);frameCallback=null;initialFocus=false;clearTimeout(controlsTimer);el('direct-controls').hidden=true;++generation;clearTimeout(startupTimer);if(settle){settle(false);settle=null;}if(hls){hls.destroy();hls=null;}if(video){video.pause();video.removeAttribute('src');video.load();video.remove();video=null;}direct=false;el('frame').hidden=false;el('direct-resume').hidden=true;el('direct-quality').hidden=true;el('quality-limit').textContent='';subtitleMenu();}
    // Quem diz o que o aparelho toca é o próprio motor de mídia: se o MediaSource
    // aceita o codec, a versão de maior resolução é legítima (inclusive 4K HEVC no
    // APK). Sem essa prova só vale AVC — alguns aparelhos anunciam HEVC e não
    // conseguem renderizar. Era isso que baixava um 4K para Full HD.
    function codecSuportado(codec){
        const nome=String(codec||'').toLowerCase();
        if(!nome)return true;
        const avc=/^avc[13]/.test(nome),outro=/^(hvc1|hev1|av01|vp09|mp4v)/.test(nome);
        if(!avc&&!outro)return true;
        let mse=false;
        try{mse=typeof MediaSource!=='undefined'&&typeof MediaSource.isTypeSupported==='function';}catch{mse=false;}
        if(mse){try{return MediaSource.isTypeSupported('video/mp4; codecs="'+codec+'"');}catch{return avc;}}
        return avc;
    }
    function bestLevel(){
        if(!hls?.levels.length)return -1;
        const todos=hls.levels.map((level,index)=>({level,index}));
        const suportados=todos.filter(c=>codecSuportado(c.level.videoCodec));
        const candidates=suportados.length?suportados:todos;
        return candidates.reduce((best,c)=>c.level.height>best.level.height||(c.level.height===best.level.height&&(c.level.bitrate||0)>(best.level.bitrate||0))?c:best).index;
    }
    function portuguese(track){return /^(pt|por)(-|_|$)/i.test(track.lang||track.language||'')||/dublad|portugu[eê]s|portuguese|pt[-_ ]?br/i.test(track.name||track.label||'');}
    function idiomaDeclaradoNaoPt(t){const l=String(t.lang||t.language||'').trim().toLowerCase();if(l&&!/^(und|unk|mul|zxx|mis|qaa)$/.test(l))return true;return /english|ingl[eê]s|espa[nñ]ol|spanish|fran[cç]ais|french|legendad|original/i.test(t.name||t.label||'');}
    function enforceAudio(permitirOriginal=false){
        if(!hls)return true;const tracks=hls.audioTracks||[];if(!tracks.length)return true;
        if(audioChoice>=0)return true;
        const pt=tracks.findIndex(portuguese);
        if(pt>=0){if(hls.audioTrack!==pt)hls.audioTrack=pt;rotuloAudio='Dublado';analiseAtual?.fonte({audio:rotuloAudio});sincronizarLegendas();return true;}
        // A named English track is just as explicit as an ISO language tag.
        // "und" (indeterminado), "mul", "zxx"... NÃO declaram idioma: a MGEB
        // publica a faixa dublada como LANGUAGE="und" NAME="Undefined" e o player
        // recusava o filme como se fosse inglês. Só recusa idioma DECLARADO.
        if(tracks.some(idiomaDeclaradoNaoPt)){if(!permitirOriginal){failure('a fonte anunciada como dublada não oferece faixa em português');return false;}rotuloAudio='som original';analiseAtual?.fonte({audio:rotuloAudio});}
        return true;
    }
    let taxaAtual=0;
    function taxaReal(){
        if(taxaAtual>0)return taxaAtual;
        try{const bytes=video&&video.webkitVideoDecodedByteCount;return (bytes&&video.currentTime>5)?(bytes*8)/video.currentTime:0;}catch(e){return 0;}
    }
    function qualityInfo(level){
        try{taxaAtual=Number(level&&level.bitrate)||0;}catch{}
        const width=video?.videoWidth||level?.width||0,height=video?.videoHeight||level?.height||0;
        if(height){alturaAtual=height;analiseAtual?.fonte({resolucao:height+'p'});}
        const taxa=Number(level?.bitrate)>0?` · ${(level.bitrate/1000000).toFixed(1).replace('.',',')} Mbps`:'';
        el('quality-info').textContent=(width&&height?`${width} × ${height} · ${rotuloAudio}`:height?`${height}p · ${rotuloAudio}`:`Original · ${rotuloAudio}`)+taxa;
        const best=hls?.levels[bestLevel()],maxWidth=best?.width||width,maxHeight=best?.height||height;
        el('quality-limit').textContent=maxWidth>=1920||maxHeight>=1080?'Full HD ou superior disponível nesta fonte.':maxWidth||maxHeight?'Esta fonte não oferece Full HD para este filme.':'Verificando a resolução oferecida pela fonte…';
        const alt=el('quality-alt');if(alt)alt.hidden=Boolean(maxWidth>=1920||maxHeight>=1080);atualizarBotoesAjuste();
    }
    function quality(value){qualidadeEscolhida=String(value);if(hls)hls.currentLevel=value==='best'?bestLevel():Number(value);const select=el('quality-select');if(select)select.value=qualidadeEscolhida;}
    function qualityMenu(){const select=el('quality-select');select.hidden=false;select.replaceChildren();const values=[['best','Melhor disponível'],['-1','Automática (conexão)']];if(hls)hls.levels.forEach((l,i)=>{if(l.height)values.push([String(i),`${l.height}p`]);});for(const [value,label] of values){const o=document.createElement('option');o.value=value;o.textContent=label;select.append(o);}select.value='best';el('direct-quality').hidden=false;}
    function play(){if(!video)return;intencaoTocar=true;pausadoPeloUsuario=false;const target=video,token=generation;target.play().catch(e=>{if(token!==generation||target!==video)return;if(e.name==='NotAllowedError'){intencaoTocar=false;clearTimeout(startupTimer);limparEspera();el('loading').classList.remove('vis');el('direct-resume').hidden=false;}else failure();});}
    function failure(motivo='a reprodução foi interrompida'){
        if(relatoFeito||video?.ended)return;
        const ponto=posicaoAtual(),opcoes=opcoesAtuais,jaTocou=imagemConfirmada,intencao=intencaoTocar;
        // jaTocou/retomando contam à recuperação que a fonte já tinha provado que
        // funciona (imagem na tela, ou retomada de um ponto salvo nela).
        const resumo={fonteId:fonteIdUsada,fonte:fonteUsada,audio:rotuloAudio,posicao:ponto,motivo,jaTocou,retomando:Number(ponto)>0,altura:Number(alturaAtual)||alturaAnunciada||0};
        relatoFeito=true;
        analiseAtual?.falha(motivo,ponto);
        const erro=video?.error?.code;
        relatar({tipo:'falha',ok:false,fonte:fonteUsada,fonteId:fonteIdUsada,audio:rotuloAudio,resolucao:alturaAtual?alturaAtual+'p':'',posicao:ponto,motivo:motivo+(erro?' · erro '+erro:'')});
        const pending=settle;settle=null;
        stop('falhou');
        if(pending){pending(false);return;}
        // Recupera sozinho qualquer queda depois que a reprodução começou —
        // inclusive travamento longo e queda logo ao retomar um ponto salvo.
        // Só não recupera se a pessoa pausou de propósito ou o app está em
        // segundo plano (aí o aviso espera ela voltar).
        // (Antes exigia imagem já confirmada E "intenção de tocar": um engasgo
        // podia zerar a intenção e o player caía em "tente novamente".)
        void intencao;
        if(!aoVivo&&!pausadoPeloUsuario&&!document.hidden&&opcoes?.onInterrupted){
            try{if(opcoes.onInterrupted(resumo)===true)return;}catch{}
        }
        mostrarErro('A reprodução foi interrompida.','Seu ponto foi preservado. Tente novamente ou escolha outra fonte em Opções.');
    }
        // Endereços aceitos: o encaminhamento do próprio aplicativo, as fontes
        // conhecidas e listas de reprodução (inclusive as de caminho protegido,
        // que são liberadas na hora pelo resolvedor).
        // nixplay.lat entrega o episódio dublado em MP4 (arquivo direto).
        const enderecoDeMidia=url=>/^\/api\/crystal-lake\/1\/[1-8]\/master\.m3u8$/.test(url)||/^(\/api\/(?:hls\?|rede-midia\?|midia-local\?|convertido\/|torbox\/[a-f0-9]{32}(?:\?|$))|https:\/\/[a-z0-9-]+\.hclod\.qzz\.io\/|https:\/\/pipocacine\.lat\/|https:\/\/vixsrc\.to\/|https:\/\/nixplay\.lat\/)/i.test(url)||/^https:\/\/[a-z0-9.-]+\/(?:pl\/|[^\s]*\.(?:m3u8|mp4))/i.test(url)||/^https:\/\/[a-z0-9.-]+\/api\/(?:hls\?|torbox\/[a-f0-9]{32}(?:\?|$))/i.test(url);
        // Arquivo que o próprio navegador já abriu (imagem e tamanho lidos) na
        // busca direta nas fontes aprovadas: endereço HTTPS sem credenciais.
        function arquivoConferidoNoNavegador(data){
            if(data?.transporte!=='navegador'||data?.midiaConferida!==true||data.type!=='file')return false;
            try{const u=new URL(data.url);return u.protocol==='https:'&&!u.username&&!u.password&&(!u.port||u.port==='443');}catch{return false;}
        }
        function arquivoConferidoNoAparelho(data){
            // Alguns CDNs removem a extensão no destino final. O Android já
            // conferiu a imagem e o conteúdo, antes de entregar esse endereço.
            if(data?.midiaConferida!==true||data.type!=='file'||typeof location==='undefined'||location.hostname!=='appassets.androidplatform.net'||location.protocol!=='https:')return false;
            try{const u=new URL(data.url);return u.protocol==='https:'&&!u.username&&!u.password&&(!u.port||u.port==='443');}catch{return false;}
        }
        // Preparo antecipado: a escolha da fonte (a mesma, com a mesma régua de
        // qualidade) começa quando a pessoa abre a página do filme ou quando o
        // episódio chega nos créditos. Ao tocar em Assistir, a resposta já está
        // pronta ou a caminho — o player não recomeça a busca do zero.
        const preparos=new Map();
        function preparar(caminho,validadeMs=60000){
            if(!/^\/api\/playback\/(?:\d{1,10}|serie\/\d{1,10}\/\d{1,3}\/\d{1,4})$/.test(String(caminho||'')))return false;
            const agora=Date.now();for(const [chave,item] of preparos)if(item.ate<agora)preparos.delete(chave);
            if(preparos.has(caminho))return true;
            if(preparos.size>=3)preparos.delete(preparos.keys().next().value);
            const promessa=fetch(caminho,{cache:'no-store'}).then(r=>r.ok?r.json():Promise.reject(new Error('HTTP '+r.status)));
            promessa.catch(()=>{if(preparos.get(caminho)?.promessa===promessa)preparos.delete(caminho);});
            preparos.set(caminho,{promessa,ate:agora+Math.max(5000,Math.min(120000,Number(validadeMs)||60000))});
            return true;
        }
        // Busca no navegador: corre junto com a consulta ao servidor (a mesma
        // promessa do preparo, se já existir). `montar` recebe a promessa do
        // servidor e devolve a resposta final — nunca espera mais que ela.
        function injetar(caminho,montar){
            try{
                const item=preparos.get(caminho);
                const servidor=item&&item.ate>=Date.now()?item.promessa:fetch(caminho,{cache:'no-store'}).then(r=>r.json());
                servidor.catch?.(()=>{});
                const promessa=Promise.resolve().then(()=>montar(servidor));promessa.catch(()=>{});
                preparos.set(caminho,{promessa,ate:Date.now()+120000});return true;
            }catch{return false;}
        }
        function usarPreparo(caminho,signal){
            const item=preparos.get(caminho);if(!item||item.ate<Date.now())return null;
            preparos.delete(caminho); // uma vez só: uma nova tentativa sempre consulta de novo
            return new Promise((ok,erro)=>{if(signal?.aborted)return erro(new Error('cancelado'));signal?.addEventListener?.('abort',()=>erro(new Error('cancelado')),{once:true});item.promessa.then(ok,erro);});
        }
        // Entrega o vídeo ao player do PC e acompanha: imagem na tela, posição
        // (para o "continuar assistindo") e o fim (fechou ou acabou).
        async function tocarNoPc(data,token,version,signal){
            const current=()=>token===generation&&version===playerVersion&&pcAtivo;
            progressFilm=typeof filmeAtual!=='undefined'&&filmeAtual?{...filmeAtual}:null;resumeApplied=true;lastSaved=0;
            rotuloAudio=data.audioInformado||(data.audio==='pt-BR'?'Dublado':'som original');
            const titulo=(progressFilm?.titulo||el('titulo-player')?.textContent||'Conecta TV')+(progressFilm?.episode?` · T${progressFilm.episode.season} E${progressFilm.episode.number}`:'');
            try{window.setLoading?.('Abrindo no player do PC','Imagem em até 4K, com o som do próprio arquivo.');}catch{}
            let resposta=null;
            try{resposta=await window.StreamPC.api('tocar',{url:String(data.url||''),titulo,posicao:retomadaAlvo||0});}
            catch(e){if(token===generation&&version===playerVersion)analiseAtual?.falha('o player do PC não abriu: '+e.message,retomadaAlvo||0);return false;}
            if(!resposta?.sessao){analiseAtual?.falha('o player do PC não abriu',retomadaAlvo||0);return false;}
            if(token!==generation||version!==playerVersion||(signal&&signal.aborted)){window.StreamPC.api('parar',{}).catch(()=>{});return false;}
            pcAtivo=true;pcSessao=resposta.sessao;pcPosicao=retomadaAlvo||0;pcDuracao=0;
            if(signal){const cancelar=()=>{if(current())stop('fechou');};signal.addEventListener('abort',cancelar,{once:true});removerAbort=()=>signal.removeEventListener('abort',cancelar);}
            return new Promise(resolve=>{
                settle=resolve;const inicio=Date.now();
                const aviso=()=>{let caixa=el('pc-tocando');if(!caixa){caixa=document.createElement('div');caixa.id='pc-tocando';caixa.style.cssText='position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;background:#000c;color:#fff;z-index:4;text-align:center;padding:24px;font-size:18px';el('player').append(caixa);}
                    caixa.replaceChildren();const t=document.createElement('strong');t.style.fontSize='22px';t.textContent='Tocando no player do PC';const d=document.createElement('span');d.style.opacity='.8';d.textContent=[rotuloAudio,alturaAtual?(alturaAtual>=2000?'4K':alturaAtual+'p'):'',fonteUsada].filter(Boolean).join(' · ');
                    const dica=document.createElement('span');dica.style.cssText='opacity:.65;font-size:14px';dica.textContent='No player: espaço pausa · setas avançam/voltam · F tela cheia · Esc fecha';
                    const b=document.createElement('button');b.textContent='Parar e voltar ao catálogo';b.style.cssText='padding:10px 18px;border-radius:10px;border:0;background:#fff;color:#000;font-size:15px;cursor:pointer';b.onclick=()=>window.fechar?.();
                    caixa.append(t,d,dica,b);};
                const fimDoVideo=e=>{
                    pcPosicao=Number(e.posicao)||pcPosicao;saveProgress();const ponto=pcPosicao;
                    if(e.motivo==='eof'||(pcDuracao>60&&ponto/pcDuracao>0.92)){
                        analiseAtual?.encerrar('concluiu',ponto);
                        try{const f=progressFilm;if(f?.id&&f.episode)window.StreamPersonal?.markWatched?.({id:f.id,titulo:f.titulo,episode:{season:Number(f.episode.season)||1,number:Number(f.episode.number)||1}},true);}catch{}
                    }else analiseAtual?.encerrar('fechou',ponto);
                    pcAtivo=false;el('pc-tocando')?.remove();
                    if(e.motivo==='eof'&&progressFilm?.episode&&window.StreamEpisodes?.finished){window.StreamEpisodes.finished(progressFilm);showControls?.();}
                    else window.fechar?.();
                };
                const ciclo=async()=>{
                    while(current()){
                        let e=null;try{e=await window.StreamPC.api('esperar?ms=5000&sessao='+pcSessao);}catch{await new Promise(r=>setTimeout(r,1500));}
                        if(!current())return;
                        if(!e)continue;
                        if(e.sessao!==pcSessao){pcAtivo=false;const d=settle;settle=null;if(d){analiseAtual?.falha('o player do PC foi trocado',retomadaAlvo||0);d(false);}return;}
                        if(Number.isFinite(e.posicao))pcPosicao=e.posicao;if(e.duracao)pcDuracao=e.duracao;if(e.altura)alturaAtual=e.altura;
                        if(!imagemConfirmada&&e.imagem){imagemConfirmada=true;ultimaPosicao=pcPosicao;analiseAtual?.fonte({resolucao:alturaAtual?alturaAtual+'p':''});analiseAtual?.imagem(ultimaPosicao);analiseAtual?.tocando(ultimaPosicao);clearTimeout(startupTimer);el('loading')?.classList.remove('vis');aviso();const d=settle;settle=null;d&&d(true);
                            setTimeout(()=>{if(current()&&!relatoConfirmado){relatoConfirmado=true;relatar({tipo:'confirmacao',ok:true,fonte:fonteUsada,fonteId:fonteIdUsada,audio:rotuloAudio,resolucao:alturaAtual?alturaAtual+'p':'',taxa:'',player:'pc'});}},20000);}
                        if(imagemConfirmada){if(e.posicao>ultimaPosicao+0.1){ultimaPosicao=e.posicao;analiseAtual?.tocando(ultimaPosicao);}if(Date.now()-lastSaved>5000){saveProgress();lastSaved=Date.now();}}
                        if(e.terminou){
                            if(!imagemConfirmada){const d=settle;settle=null;pcAtivo=false;analiseAtual?.falha(e.erro?'o player do PC não abriu o vídeo ('+String(e.erro).slice(0,60)+')':'o player do PC foi fechado antes da imagem',retomadaAlvo||0);d&&d(false);return;}
                            fimDoVideo(e);return;
                        }
                        if(!imagemConfirmada&&Date.now()-inicio>45000){const d=settle;settle=null;window.StreamPC.api('parar',{}).catch(()=>{});pcAtivo=false;analiseAtual?.falha('o player do PC não mostrou imagem',retomadaAlvo||0);d&&d(false);return;}
                    }
                };
                ciclo();
            });
        }
        async function start(id,version,signal,caminho,urlDireta,originalPermitido,fonteDireta=null,opcoes=null){
        const recebidas=opcoes||window.StreamPlaybackOptions?.({id,version})||{};
        stop('trocou');const token=generation;
        opcoesAtuais=recebidas;analiseAtual=recebidas.sessao||null;
        analiseAtual?.iniciar({});
        duracaoTotal=0;deslocamento=0;conversaoAtiva=false;ultimoInicio={id,version,signal,caminho,originalPermitido};const ponto=recebidas.posicao;retomadaAlvo=ponto!==null&&ponto!==undefined&&Number.isFinite(Number(ponto))?Math.max(0,Number(ponto)):null;
        buscaEsgotada=false;ultimaPosicao=retomadaAlvo||0;imagemConfirmada=false;relatoFeito=false;fonteIdUsada='';fonteUsada='';alturaAtual=0;alturaAnunciada=0;audioChoice=-1;qualidadeEscolhida='best';ajustouConexao=false;
        const caminhoPedido=caminho||`/api/playback/${id}`;const preparado=urlDireta?null:usarPreparo(caminhoPedido,signal);
        let data;if(urlDireta){data={url:urlDireta,live:Boolean(fonteDireta?.live),audio:'fonte',source:fonteDireta?.nome||'Full HD',fonteId:fonteDireta?.id||'',audioInformado:fonteDireta?.audioInformado||'',type:fonteDireta?.tipo||(/\.mp4(\?|$)/i.test(urlDireta)?'file':'hls')};}else{try{data=preparado?await preparado.catch(()=>lerJson(caminhoPedido,signal)):await lerJson(caminhoPedido,signal);}catch{if(token===generation&&!(signal&&signal.aborted))analiseAtual?.falha('não foi possível consultar a fonte',retomadaAlvo||0);return false;}}// Fonte que precisa de conversão (arquivo MKV com som que o navegador não
        // toca): acompanha o andamento e começa assim que houver trecho pronto —
        // o resto continua convertendo em segundo plano.
        if(token!==generation||(signal&&signal.aborted)||version!==playerVersion)return false;
        if(data?.indisponivel===true&&data?.buscaCompleta===true){buscaEsgotada=true;analiseAtual?.falha('nenhuma fonte respondeu à verificação completa',retomadaAlvo||0);return false;}
        const consulta = caminho || ('/api/playback/'+id);
        // O Android também pede a versão compatível: o aparelho pode ter o
        // decodificador HEVC e o WebView não renderizar. Sem isto, um 4K HEVC
        // que o WebView não toca virava tela de erro em vez de cair para H.264.
        // A TV também entra: o WebView de algumas TVs anuncia HEVC e não
        // renderiza o 4K; o 4K continua sendo a primeira escolha, mas depois de
        // 12 s sem imagem (ou erro) o mesmo pedido é refeito com compat=avc.
        const podeCompat = !urlDireta && /^\/api\/playback\/(?:\d+|serie\/\d+\/\d+\/\d+)(?:\?|$)/.test(consulta);
        let compatTentada = false;
        const consultarCompat = async () => {
            compatTentada = true;
            // Filme em conversão (TorBox 4K): a versão compatível (Full HD) começa
            // no mesmo ponto do filme.
            const ponto=conversaoAtiva?Math.floor(deslocamento+(video&&Number.isFinite(video.currentTime)?video.currentTime:0)):0;
            try { return await lerJson(consulta+(consulta.includes('?')?'&':'?')+'compat=avc'+(ponto>=60?'&inicio='+ponto:''),signal); } catch { return null; }
        };
        if (podeCompat && !window.StreamPC?.ativo?.() && /^(hevc|h265)$/.test(data?.videoCodec||'') && !document.createElement('video').canPlayType('video/mp4; codecs="hvc1.2.4.L153.B0"')) {
            data = await consultarCompat();
            if(token!==generation||(signal&&signal.aborted)||version!==playerVersion)return false;
            if(!data)return false;
        }
        if(data&&data.conversao&&version===playerVersion&&!(signal&&signal.aborted)){
            // Ponto salvo: o pedido pode trazer (retomadaAlvo) ou não — abrir o
            // filme pelo catálogo usa o "continuar assistindo" guardado. Sem
            // isso, o filme em conversão começava do 0 e o resume() não achava
            // o minuto salvo (a lista ainda era curta) — 06/11/2026, O Pior Vizinho.
            let pontoSalvo=retomadaAlvo>0?retomadaAlvo:0;
            if(retomadaAlvo===null){try{pontoSalvo=Math.max(0,Number(typeof filmeAtual!=='undefined'&&filmeAtual?window.StreamPersonal?.position?.(filmeAtual):0)||0);}catch(e){pontoSalvo=0;}}
            // Em vez de esperar converter do 0 até o ponto salvo (2+ min), pede
            // ao servidor a conversão começando nele (~10–20 s).
            if(pontoSalvo>=60&&!(Number(data.inicio)>0)){
                const noPonto=await lerJson(consulta+(consulta.includes('?')?'&':'?')+(compatTentada?'compat=avc&':'')+'inicio='+Math.floor(pontoSalvo),signal).catch(()=>null);
                if(token!==generation||(signal&&signal.aborted)||version!==playerVersion)return false;
                if(noPonto&&noPonto.conversao&&noPonto.audio==='pt-BR')data=noPonto;
            }
            deslocamento=Math.max(0,Number(data.inicio)||0);conversaoAtiva=true;
            if(Number(data.duracao)>0)duracaoTotal=Number(data.duracao);
            const alvoNoFilme=pontoSalvo;pontoSalvo=Math.max(0,pontoSalvo-deslocamento);
            if(pontoSalvo<=0&&deslocamento>0)retomadaAlvo=0;
            if(pontoSalvo>0){
                // A conversão anda bem mais rápido que o filme (a imagem só é
                // copiada): em vez de desistir da fonte, espera ela chegar no
                // ponto salvo, mostrando o avanço. Só desiste depois de 4 min.
                let atual=null;
                for(let tentativa=0;tentativa<120;tentativa++){
                    atual=await lerJson('/api/conversao/'+encodeURIComponent(data.conversao),signal).catch(()=>null);
                    if(token!==generation||(signal&&signal.aborted)||version!==playerVersion)return false;
                    if(atual&&Number(atual.duracao)>0)duracaoTotal=Number(atual.duracao);
                    if(!atual||atual.erro||atual.convertido||Number(atual.segundos)>=pontoSalvo+10)break;
                    const pct=Math.max(0,Math.min(99,Math.round(Number(atual.segundos||0)/(pontoSalvo+10)*100)));
                    try{window.setLoading?.('Voltando de onde você parou','Preparando em alta qualidade… '+pct+'%');}catch(e){}
                    await new Promise(r=>setTimeout(r,2000));
                }
                if(!(atual&&!atual.erro&&(atual.convertido||Number(atual.segundos)>=pontoSalvo+10))){
                    fonteIdUsada=String(data.fonteId||'');fonteUsada=String(data.source||'');
                    analiseAtual?.fonte({fonteId:fonteIdUsada,fonte:fonteUsada});
                    analiseAtual?.falha('esta fonte ainda está em preparação e não permite retomar o ponto salvo',alvoNoFilme);deslocamento=0;conversaoAtiva=false;
                    return false;
                }
                // Daqui em diante é uma retomada: o player começa no ponto salvo.
                retomadaAlvo=pontoSalvo;
            }else{
                for(let tentativa=0;tentativa<1800;tentativa++){
                    if(version!==playerVersion||(signal&&signal.aborted))return false;
                    const estado=await lerJson('/api/conversao/'+encodeURIComponent(data.conversao),signal).catch(()=>null);
                    if(estado&&estado.erro)return false;
                    if(estado&&Number(estado.duracao)>0)duracaoTotal=Number(estado.duracao);
                    const pct=Math.max(0,Math.min(99,Number(estado&&estado.progresso)||0));
                    const vel=Number(estado&&estado.velocidade)||0;
                    try{window.setLoading?.('Preparando em alta qualidade','Convertendo o áudio para português… '+pct+'%'+(vel?' · '+vel.toFixed(1)+'x':''));}catch(e){}
                    if(estado&&estado.pronto)break;
                    // Consulta a cada 1 s: o filme começa assim que o trecho fica pronto.
                    await new Promise(r=>setTimeout(r,1000));
                }
            }
            data={...data,url:'/api/convertido/'+encodeURIComponent(data.conversao)+'/index.m3u8',type:'hls'};
        }
        if(token!==generation||(signal&&signal.aborted)||version!==playerVersion)return false;
        fonteIdUsada=String(data?.fonteId||'');fonteUsada=String(data?.source||'');alturaAnunciada=parseInt(data?.altura||data?.resolucao,10)||0;
        analiseAtual?.fonte({fonteId:fonteIdUsada,fonte:fonteUsada,audio:data?.audio==='pt-BR'?'Dublado':'som original'});
        const enderecoAceito=enderecoDeMidia(String(data?.url||''))||(!urlDireta&&arquivoConferidoNoAparelho(data))||(!urlDireta&&arquivoConferidoNoNavegador(data));
        if(!enderecoAceito||(!urlDireta&&data.audio!=='pt-BR'&&!originalPermitido)){analiseAtual?.falha('a fonte não entregou vídeo no formato ou idioma esperado',retomadaAlvo||0);return false;}
        if(window.StreamPC?.ativo?.()&&!data.live&&data.type!=='embed')return tocarNoPc(data,token,version,signal);
        aoVivo=Boolean(data.live);el('direct-controls').classList.toggle('live-controls',aoVivo);for(const id of ['direct-progress','direct-back','direct-forward','menu-speed-btn'])el(id).hidden=aoVivo;el('direct-time').textContent=aoVivo?'AO VIVO':'0:00 / --:--';rotuloAudio=data.live?'Áudio da transmissão':data.audioInformado||(data.audio==='pt-BR'?'Dublado':'som original');fonteUsada=data.source||'';fonteIdUsada=data.fonteId||'';alturaAtual=0;relatoFeito=false;relatoConfirmado=false;progressFilm=data.live?null:typeof filmeAtual!=='undefined'?{...filmeAtual}:null;resumeApplied=false;lastSaved=0;video=document.createElement('video');video.id='direct-video';video.controls=false;video.autoplay=true;video.playsInline=true;video.preload='auto';video.tabIndex=0;video.setAttribute('aria-label',data.live?'TV ao vivo':rotuloAudio==='Dublado'?'Filme dublado':'Filme em alta definição');video.setAttribute('webkit-playsinline','');video.setAttribute('x-webkit-airplay','allow');video.style.cssText='width:100%;height:100%;object-fit:contain;background:#000';video.playbackRate=aoVivo?1:speed;try{video.volume=volume;video.muted=mudo;}catch{}atualizarVolume();el('frame').hidden=true;document.querySelector('.area-player').prepend(video);window.StreamFraming?.attach(video);window.StreamIntro?.attach(video,progressFilm,data);window.StreamCredits?.attach(video,progressFilm,data);const speedSelect=el('speed-select');if(speedSelect)speedSelect.value=String(speed);audioMenu();direct=true;showControls();
        return new Promise(resolve=>{settle=resolve;const current=()=>token===generation&&version===playerVersion;verificarAtual=current;const ready=()=>{if(!current()||!video.videoWidth||!video.videoHeight)return;
                resume();
                if(retomadaAlvo>0&&Number.isFinite(video.duration)&&video.currentTime+1<Math.min(retomadaAlvo,Math.max(0,video.duration-1)))return;
                if(!imagemConfirmada){imagemConfirmada=true;ultimaPosicao=Number(video.currentTime)||retomadaAlvo||0;qualityInfo();analiseAtual?.fonte({resolucao:alturaAtual?alturaAtual+'p':''});analiseAtual?.imagem(ultimaPosicao);}
                clearTimeout(startupTimer);el('loading').classList.remove('vis');const done=settle;settle=null;if(done)done(true);};
            let recovered=false, nativeFallback=false, compatEmCurso=false;
            const awaitPicture=()=>{
                if(!current())return;
                const decoded=video.getVideoPlaybackQuality?.().totalVideoFrames??video.webkitDecodedFrameCount;
                if(decoded>0&&video.videoWidth&&video.videoHeight){ready();return;}
                if(video.requestVideoFrameCallback){if(frameCallback===null)frameCallback=video.requestVideoFrameCallback(()=>{frameCallback=null;if(current())ready();});}
                else {const frames=video.getVideoPlaybackQuality?.().totalVideoFrames??video.webkitDecodedFrameCount;if(frames>0||(frames===undefined&&video.readyState>=2))ready();}
            };
            const pictureTimeout=async()=>{
                if(!current()||compatEmCurso)return;
                if((data.type==='file'||data.conversao)&&podeCompat&&!compatTentada){
                    compatEmCurso=true;clearTimeout(startupTimer);video.pause();
                    const absoluto=conversaoAtiva?deslocamento+(Number.isFinite(video.currentTime)?video.currentTime:0):null;
                    let nova=await consultarCompat();
                    if(!current()){compatEmCurso=false;return;}
                    // 4K da TorBox sem imagem: a versão compatível é o Full HD dela,
                    // também convertido — espera ficar pronto antes de trocar.
                    if(nova&&nova.conversao){
                        try{window.setLoading?.('Trocando para Full HD','Este aparelho não mostrou o 4K; preparando a versão compatível…');}catch(e){}
                        let pronto=false;
                        for(let i=0;i<90&&current();i++){
                            const est=await lerJson('/api/conversao/'+encodeURIComponent(nova.conversao),signal).catch(()=>null);
                            if(est&&est.erro)break;
                            if(est&&est.pronto){pronto=true;break;}
                            await new Promise(r=>setTimeout(r,2000));
                        }
                        if(!current()){compatEmCurso=false;return;}
                        if(!pronto){compatEmCurso=false;failure('a fonte não apresentou imagem');return;}
                        deslocamento=Math.max(0,Number(nova.inicio)||0);conversaoAtiva=true;
                        if(Number(nova.duracao)>0)duracaoTotal=Number(nova.duracao);
                        if(absoluto!==null)retomadaAlvo=Math.max(0,absoluto-deslocamento);
                        nova={...nova,url:'/api/convertido/'+encodeURIComponent(nova.conversao)+'/index.m3u8',type:'hls'};
                    }
                    compatEmCurso=false;
                    if(['file','hls'].includes(nova?.type)&&nova.audio==='pt-BR'&&enderecoDeMidia(String(nova.url||''))&&nova.url!==data.url){
                        data=nova;fonteIdUsada=String(nova.fonteId||'');fonteUsada=String(nova.source||'');
                        analiseAtual?.fonte({fonteId:fonteIdUsada,fonte:fonteUsada,audio:'Dublado'});
                        resumeApplied=false;if(hls){hls.destroy();hls=null;}video.removeAttribute('src');video.load();
                        startupTimer=setTimeout(()=>{if(current())failure('a fonte não apresentou imagem');},12000);carregarFonte();return;
                    }
                    failure('a fonte não apresentou imagem');return;
                }
                if((android||televisao)&&hls&&!nativeFallback&&video.canPlayType('application/vnd.apple.mpegurl')){
                    nativeFallback=true;resumeApplied=false;hls.destroy();hls=null;video.pause();video.src=data.url;
                    el('direct-quality').hidden=false;el('quality-select').hidden=true;
                    startupTimer=setTimeout(()=>{if(current())failure();},12000);play();
                }else failure();
            };
            startupTimer=setTimeout(pictureTimeout,12000);
            if(signal){const cancelar=()=>{if(current())stop('fechou');};signal.addEventListener('abort',cancelar,{once:true});removerAbort=()=>signal.removeEventListener('abort',cancelar);}
            // marcarVistoSozinho: ao terminar (ou aos 92% do episódio) o próprio
// aplicativo marca como visto — o usuário não precisa tocar no círculo.
function marcarVistoSozinho(){try{const f=(typeof filmeAtual!=='undefined'&&filmeAtual)||progressFilm;if(!f||!f.id||!f.episode)return;window.StreamPersonal?.markWatched?.({id:f.id,titulo:f.titulo,episode:{season:Number(f.episode.season)||1,number:Number(f.episode.number)||1}},true);}catch{} }
video.addEventListener('webkitendfullscreen',()=>{if(current())window.StreamEpisodes?.visibility?.();});
video.addEventListener('ended',()=>{if(current()){intencaoTocar=false;limparEspera();saveProgress();analiseAtual?.encerrar('concluiu',posicaoAtual());marcarVistoSozinho();window.StreamEpisodes?.finished?.(progressFilm);showControls();}});
video.addEventListener('playing',()=>{if(!current())return;window.StreamEpisodes?.playing?.();intencaoTocar=true;limparEspera();analiseAtual?.tocando(posicaoAtual());el('direct-resume').hidden=true;awaitPicture();clearTimeout(relogioConfirmacao);relogioConfirmacao=setTimeout(()=>{if(!current()||!video||relatoConfirmado)return;if(video.currentTime<15)return;relatoConfirmado=true;relatar({tipo:'confirmacao',ok:true,fonte:fonteUsada,fonteId:fonteIdUsada,audio:rotuloAudio,resolucao:alturaAtual?alturaAtual+'p':'',taxa:taxaReal()?Math.round(taxaReal()/1000)+' kbps':''});},20000);el('direct-toggle').textContent='⏸';el('direct-toggle').setAttribute('aria-label','Pausar');showControls(!initialFocus);initialFocus=true;});
            video.addEventListener('canplay',()=>{if(!current())return;play();},{once:true});
            video.addEventListener('loadedmetadata',()=>{if(current()){qualityInfo();subtitleMenu();sincronizarLegendas();buscaLivre();atualizarVolume();resume();window.StreamLegendas?.anexar?.(video,progressFilm).then?.(()=>{if(!current())return;subtitleMenu();sincronizarLegendas();}).catch?.(()=>{});}});
            video.addEventListener('pause',()=>{if(current()){if(!video.error)intencaoTocar=false;limparEspera();analiseAtual?.pausar(posicaoAtual());saveProgress();el('direct-toggle').textContent='▶';el('direct-toggle').setAttribute('aria-label','Reproduzir');showControls();}});
            video.addEventListener('timeupdate',()=>{if(current()){if(imagemConfirmada&&video.currentTime>ultimaPosicao+0.1){ultimaPosicao=video.currentTime;limparEspera();analiseAtual?.tocando(ultimaPosicao);}if(totalDoFilme()>60&&posicaoNoFilme()/totalDoFilme()>0.92)marcarVistoSozinho();resume();if(resumeApplied&&Date.now()-lastSaved>2000){saveProgress();lastSaved=Date.now();}if(settle)awaitPicture();el('direct-time').textContent=aoVivo?'AO VIVO':clock(posicaoNoFilme())+' / '+clock(totalDoFilme());const barra=el('direct-progress');if(barra&&!arrastando)barra.value=totalDoFilme()>0?Math.round(posicaoNoFilme()/totalDoFilme()*1000):0;}});
            video.addEventListener('waiting',()=>esperando(current));
            video.addEventListener('resize',()=>{if(current())qualityInfo();});
            video.addEventListener('stalled',()=>esperando(current));
            video.addEventListener('seeking',()=>{if(current()){window.StreamEpisodes?.replaying?.();limparEspera();analiseAtual?.buscar(Number(video.currentTime)||0);}});
            video.addEventListener('seeked',()=>{if(current()){ultimaPosicao=Number(video.currentTime)||0;analiseAtual?.tocando(ultimaPosicao);awaitPicture();}});
            let legendaPendente=false;
            const conferirLegendas=()=>{if(legendaPendente)return;legendaPendente=true;Promise.resolve().then(()=>{legendaPendente=false;if(!current())return;subtitleMenu();sincronizarLegendas();});};
            video.textTracks?.addEventListener?.('addtrack',conferirLegendas);
            video.textTracks?.addEventListener?.('change',conferirLegendas);
            video.addEventListener('error',()=>{if(!current()||compatEmCurso)return;if(data.type==='file'&&podeCompat&&!compatTentada)pictureTimeout();else failure();});
            // Arquivo direto (MP4 progressivo): toca no próprio player, sem
            // hls.js. É o caso da fonte dublada alternativa.
            function carregarFonte(){
            if(data.type==='file'){
                video.src=data.url;el('direct-quality').hidden=false;el('quality-select').hidden=true;qualityInfo();subtitleMenu();play();
            }else if(window.Hls?.isSupported()){
                hls=new Hls({startPosition:retomadaAlvo===null?(data.conversao?0:-1):retomadaAlvo,enableWorker:true,maxBufferLength:45,maxMaxBufferLength:90,backBufferLength:30,manifestLoadingMaxRetry:4,levelLoadingMaxRetry:4,fragLoadingMaxRetry:8,fragLoadingRetryDelay:1200,abrEwmaDefaultEstimate:1200000,subtitlePreference:{id:-1}});
                hls.on(Hls.Events.MANIFEST_PARSED,()=>{if(!current())return;if(!enforceAudio(originalPermitido&&data.audio!=='pt-BR'))return;qualityMenu();quality('best');audioMenu();subtitleMenu();sincronizarLegendas();play();});
                hls.on(Hls.Events.LEVEL_SWITCHED,(_,d)=>{if(current()){const l=hls.levels[d.level];qualityInfo(l);}});
                hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED,()=>{if(!current())return;subtitleMenu();sincronizarLegendas();});
                hls.on(Hls.Events.SUBTITLE_TRACK_SWITCH,conferirLegendas);
                hls.on(Hls.Events.AUDIO_TRACKS_UPDATED,()=>{if(current()){if(!enforceAudio(originalPermitido&&data.audio!=='pt-BR'))return;audioMenu();}});
                hls.on(Hls.Events.AUDIO_TRACK_SWITCHED,()=>{if(current()){if(!enforceAudio(originalPermitido&&data.audio!=='pt-BR'))return;audioMenu();qualityInfo();}});
                hls.on(Hls.Events.ERROR,(_,d)=>{if(!current()||!d.fatal)return;if(d.type==='mediaError'&&!recovered){recovered=true;analiseAtual?.esperar(posicaoAtual());hls.recoverMediaError();clearTimeout(startupTimer);startupTimer=setTimeout(()=>{if(current())failure();},15000);}else failure();});hls.loadSource(data.url);hls.attachMedia(video);
            }else if(video.canPlayType('application/vnd.apple.mpegurl')){video.src=data.url;el('direct-quality').hidden=false;el('quality-select').hidden=true;play();}else failure();
            }
            carregarFonte();
        });
    }
    function marcarAtivo(botao,ativo){if(!botao)return;if(ativo)botao.setAttribute('data-ativo','');else botao.removeAttribute('data-ativo');}
    function atualizarBotoesAjuste(){const botaoQualidade=el('menu-quality-btn');if(botaoQualidade){const altura=video?.videoHeight||alturaAtual||0;botaoQualidade.textContent=altura?'Qualidade · '+altura+'p':'Qualidade';}const botaoVelocidade=el('menu-speed-btn');if(botaoVelocidade)botaoVelocidade.textContent='Velocidade · '+String(speed).replace('.',',')+'×';marcarAtivo(el('menu-subs-btn'),subtitleChoice>=0);marcarAtivo(el('menu-audio-btn'),audioChoice>=0);}
    // Conta para a central o que realmente aconteceu com a reprodução.
    function relatar(dados){
        try {
            const alvo = typeof filmeAtual !== 'undefined' ? filmeAtual : null;
            if (!alvo || !alvo.id) return;
            window.StreamAcesso?.reportar?.({
                id: String(alvo.id),
                titulo: alvo.titulo,
                temporada: alvo.episode ? String(alvo.episode.season) : '',
                numero: alvo.episode ? String(alvo.episode.number) : '',
                ...analiseAtual?.estado(),
                ...dados
            });
        } catch { /* a central é opcional */ }
    }
    function clock(seconds){if(!Number.isFinite(seconds))return '--:--';const n=Math.max(0,Math.floor(seconds)),h=Math.floor(n/3600),m=Math.floor(n/60)%60,s=String(n%60).padStart(2,'0');return h?h+':'+String(m).padStart(2,'0')+':'+s:m+':'+s;}
    function showControls(focus=false){if(!direct)return;window.StreamChrome?.wake();clearTimeout(controlsTimer);el('direct-controls').hidden=false;if(focus)el('direct-toggle').focus();}
    function toggle(){if(video){if(video.paused)play();else{intencaoTocar=false;pausadoPeloUsuario=true;video.pause();}}showControls();}
    function atualizarVolume(){const botao=el('volume-toggle');if(botao)botao.textContent=mudo||volume<=0?'🔇':volume<0.5?'🔉':'🔊';const faixa=el('volume-range');if(faixa&&!faixa.matches?.(':active'))faixa.value=String(Math.round((mudo?0:volume)*100));}
    function setVolume(valor){volume=Math.min(1,Math.max(0,Number(valor)||0));mudo=volume<=0;if(video){try{video.volume=volume;video.muted=mudo;}catch{}}try{localStorage.setItem('streamtv-volume',String(volume));localStorage.setItem('streamtv-mudo',String(mudo));}catch{}atualizarVolume();}
    function toggleMute(){mudo=!mudo;if(video){try{video.muted=mudo;}catch{}}try{localStorage.setItem('streamtv-mudo',String(mudo));}catch{}atualizarVolume();showControls();}
    function irPara(valor,soltou=true){if(aoVivo||!video||!Number.isFinite(video.duration)||video.duration<=0)return;const total=totalDoFilme();const absoluto=Math.max(0,Math.min(total,Number(valor)/1000*total));if(foraDoConvertido(absoluto)){el('direct-time').textContent=clock(absoluto)+' / '+clock(total);if(soltou)reabrirNoPonto(absoluto);return;}const destino=Math.min(video.duration,Math.max(0,absoluto-deslocamento));try{ultimaPosicao=destino;analiseAtual?.buscar(destino);video.currentTime=destino;el('direct-time').textContent=clock(deslocamento+destino)+' / '+clock(total);}catch{}}
    function buscaLivre(){const barra=el('direct-progress');if(!barra)return;barra.addEventListener('pointerdown',()=>{arrastando=true;showControls(true);});barra.addEventListener('touchstart',()=>{arrastando=true;showControls(true);},{passive:true});const soltar=()=>{if(!arrastando)return;arrastando=false;irPara(barra.value);saveProgress();showControls();};barra.addEventListener('change',soltar);barra.addEventListener('pointerup',soltar);barra.addEventListener('touchend',soltar);barra.addEventListener('input',()=>{irPara(barra.value,false);showControls();});}
    function seek(seconds){if(!aoVivo&&video&&Number.isFinite(video.duration)&&foraDoConvertido(posicaoNoFilme()+seconds)&&posicaoNoFilme()+seconds<totalDoFilme()){reabrirNoPonto(Math.max(0,posicaoNoFilme()+seconds));showControls();return;}if(!aoVivo&&video&&Number.isFinite(video.duration)){const destino=Math.max(0,Math.min(video.duration,video.currentTime+seconds));ultimaPosicao=destino;analiseAtual?.buscar(destino);video.currentTime=destino;}showControls();}
    // Mover o dedo ou o mouse traz os controles de volta enquanto o vídeo roda.
    // StreamChrome centraliza toque, mouse e o relógio de todos os controles.
    return {preparar,injetar,start,stop,play,quality,toggle,seek,showControls,setSubtitle:index=>setSubtitle(index,true),saveProgress,setSpeed,setAudio,audioMenu,setVolume,toggleMute,irPara,isActive:()=>direct,estado:()=>({buscaEsgotada,audio:rotuloAudio,legenda:subtitleChoice,fonte:fonteUsada,fonteId:fonteIdUsada,resolucao:alturaAtual?alturaAtual+'p':'',taxa:taxaAtual,posicao:posicaoAtual()})};
})();
function mostrarIconeTelaCheia(ativo){const b=el('fullscreen-toggle');if(!b)return;b.textContent=ativo?'⤡':'⛶';b.setAttribute('aria-label',ativo?'Sair da tela cheia':'Tela cheia');}
window.StreamSetFullscreen=function(enabled){el('player').classList.toggle('expanded',enabled);mostrarIconeTelaCheia(enabled);};
window.StreamExitFullscreen=function(){if(/StreamTVAndroid/.test(navigator.userAgent)&&el('player').classList.contains('expanded')){window.StreamSetFullscreen(false);location.href='/player-fullscreen?enabled=0';}};
async function telaCheia(){const ios=/iPhone|iPad|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);const nativeVideo=el('direct-video');if(ios&&nativeVideo?.webkitEnterFullscreen){try{nativeVideo.webkitEnterFullscreen();return;}catch{}}if(/StreamTVAndroid/.test(navigator.userAgent)){const enabled=!el('player').classList.contains('expanded');window.StreamSetFullscreen(enabled);location.href='/player-fullscreen?enabled='+(enabled?'1':'0');return;}try{if(document.fullscreenElement)await document.exitFullscreen();else await el('player').requestFullscreen();}catch{el('player').classList.toggle('expanded');mostrarIconeTelaCheia(el('player').classList.contains('expanded'));}}
document.addEventListener('fullscreenchange',()=>{mostrarIconeTelaCheia(Boolean(document.fullscreenElement));});
// Direction keys navigate controls; only an explicit seek button changes time.
document.addEventListener('keydown',event=>{
    const v=el('direct-video');if(!v||!el('opcoes').hidden)return;
    const active=document.activeElement, controls=el('direct-controls');
    const inside=active===v||controls.contains(active);
    const arrows=['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'];
    if(arrows.includes(event.key)&&inside){
        event.preventDefault();event.stopPropagation();
        if(active===v||controls.hidden){StreamPlayback.showControls(true);return;}
        StreamPlayback.showControls();
        if(event.key==='ArrowUp'){el('options-toggle').focus();return;}
        if(event.key==='ArrowDown')return;
        const buttons=[...controls.querySelectorAll('button')], i=buttons.indexOf(active);
        buttons[Math.max(0,Math.min(buttons.length-1,i+(event.key==='ArrowRight'?1:-1)))].focus();return;
    }
    if(event.key==='ArrowDown'&&active?.closest('.barra')){event.preventDefault();event.stopPropagation();StreamPlayback.showControls(true);return;}
    if(event.key==='MediaPlayPause'||(active===v&&['Enter',' '].includes(event.key))){event.preventDefault();event.stopPropagation();StreamPlayback.toggle();StreamPlayback.showControls(true);}
    if(inside&&event.key==='f'){event.preventDefault();event.stopPropagation();telaCheia();}
},true);
