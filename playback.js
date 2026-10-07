'use strict';
// First-party video element: actual playback events, HLS quality and fullscreen.
window.StreamPlayback = (() => {
    const notaQualidade=document.querySelector('.quality');if(notaQualidade)notaQualidade.textContent='O áudio e a qualidade são definidos pela fonte; o aplicativo escolhe a melhor opção disponível.';
    const preference=document.createElement('label');preference.style.cssText='display:flex;gap:10px;align-items:center;margin:20px 0;font-size:13px';
    const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.id='auto-fullscreen';
    let stored=null;try{stored=localStorage.getItem('streamtv-fullscreen');}catch{}
    checkbox.checked=stored===null?/StreamTVAndroidTV/.test(navigator.userAgent):stored==='true';
    checkbox.onchange=()=>{try{localStorage.setItem('streamtv-fullscreen',String(checkbox.checked));}catch{}};
    preference.append(checkbox,document.createTextNode('Abrir filmes em tela cheia'));el('fontes').before(preference);
    el('quality-select').onchange=e=>quality(e.target.value);
    el('subtitle-select').onchange=e=>setSubtitle(Number(e.target.value));
    let subtitleChoice=-1,progressFilm=null,lastSaved=0,resumeApplied=false,audioChoice=-1,speed=1,volume=1,mudo=false,arrastando=false,rotuloAudio='Dublado';
    try{const guardado=localStorage.getItem('streamtv-volume');if(guardado!==null)volume=Math.min(1,Math.max(0,Number(guardado)));mudo=localStorage.getItem('streamtv-mudo')==='true';}catch{}
    try{speed=Number(localStorage.getItem('streamtv-speed'))||1;}catch{}
    if(![0.75,1,1.25,1.5,2].includes(speed))speed=1;
    function setSpeed(value){speed=[0.75,1,1.25,1.5,2].includes(Number(value))?Number(value):1;if(video)video.playbackRate=speed;const select=el('speed-select');if(select)select.value=String(speed);try{localStorage.setItem('streamtv-speed',String(speed));}catch{}atualizarBotoesAjuste();}
    function setAudio(value){const escolha=Number(value);audioChoice=Number.isInteger(escolha)&&escolha>=0?escolha:-1;if(hls&&audioChoice>=0)hls.audioTrack=audioChoice;}
    el('speed-select').onchange=e=>setSpeed(e.target.value);
    el('audio-select').onchange=e=>setAudio(e.target.value);
    function audioMenu(){
        const tracks=hls?.audioTracks||[],panel=el('audio-panel');if(!panel)return;
        if(tracks.length<2){const unica=el('audio-select');if(unica){unica.disabled=true;unica.replaceChildren();const opcao=document.createElement('option');opcao.textContent='Faixa única desta fonte';unica.append(opcao);}panel.hidden=false;return;}
        const select=el('audio-select');select.replaceChildren();
        tracks.forEach((track,index)=>{const option=document.createElement('option');option.value=String(index);option.textContent=track.name||track.label||track.lang||`Faixa ${index+1}`;select.append(option);});
        const pt=tracks.findIndex(portuguese);
        select.value=String(audioChoice>=0?audioChoice:(pt>=0?pt:0));
        panel.hidden=false;
        el('audio-info').textContent=pt>=0?'A faixa dublada em português está selecionada.':'Esta fonte não informou uma faixa dublada; confira o áudio antes de assistir.';
    }
    function saveProgress(){if(!video)return;if(progressFilm)window.StreamAuth?.publicarAssistindo?.(progressFilm,video.currentTime);if(progressFilm&&resumeApplied)window.StreamPersonal?.record(progressFilm,video.currentTime,video.duration);}
    function resume(){if(!video||!progressFilm||resumeApplied||!Number.isFinite(video.duration)||video.duration<=0)return;const position=window.StreamPersonal?.position(progressFilm)||0;try{if(position>=5&&position<video.duration-30)video.currentTime=position;resumeApplied=true;}catch{}}
    document.addEventListener('visibilitychange',()=>{if(document.hidden)saveProgress();});
    window.addEventListener?.('pagehide',saveProgress);
    function listaDeLegendas(){
        const doHls=hls?.subtitleTracks||[];
        const rotulos=new Set(doHls.map(t=>t.name||t.label||t.language||''));
        const nativas=Array.from(video?.textTracks||[]).filter(t=>!rotulos.has(t.label||t.language||''));
        return {tracks:[...doHls,...nativas],hlsCount:doHls.length};
    }
    // Quando o áudio é o original, a legenda em português entra ligada sozinha.
    function nomeDaTrilhaDeLegenda(t){return String(t?.name||t?.label||t?.lang||t?.language||'');}
    function indiceLegendaPortugues(){
        const trilhas=hls?.subtitleTracks||[];
        const brasileira=trilhas.findIndex(t=>/portugu[eê]s\s*\(?brazil|brazil.*portugu/i.test(nomeDaTrilhaDeLegenda(t)));
        if(brasileira>=0)return brasileira;
        return trilhas.findIndex(t=>/portugu|brazil|brasil|^pt([-_]|$)/i.test(nomeDaTrilhaDeLegenda(t)));
    }
    function escolherLegendaAutomatica(){
        if(subtitleChoice>=0||rotuloAudio==='Dublado')return false;
        const indice=indiceLegendaPortugues();
        if(indice<0)return false;
        setSubtitle(indice);
        return true;
    }
    function subtitleMenu(){
        const tracks=listaDeLegendas().tracks;const select=el('subtitle-select');select.replaceChildren();
        const off=document.createElement('option');off.value='-1';off.textContent='Desativadas';select.append(off);
        tracks.forEach((t,i)=>{const option=document.createElement('option');option.value=String(i);option.textContent=t.name||t.label||t.lang||t.language||`Legenda ${i+1}`;select.append(option);});
        if(subtitleChoice>=tracks.length)subtitleChoice=-1;select.value=String(subtitleChoice);select.disabled=!tracks.length;
        el('subtitle-info').textContent=tracks.length?'Escolha uma faixa ou mantenha desativadas.':'Sem legendas ainda. Coloque arquivos .srt na pasta Legendas do aplicativo, com o nome do filme.';
    }
    function setSubtitle(index){
        atualizarBotoesAjuste();
        const {tracks,hlsCount}=listaDeLegendas();
        const escolha=Number.isInteger(index)&&index>=0&&index<tracks.length?index:-1;
        subtitleChoice=escolha;
        if(hls){const noHls=escolha>=0&&escolha<hlsCount;hls.subtitleDisplay=noHls;hls.subtitleTrack=noHls?escolha:-1;}
        tracks.slice(hlsCount).forEach((trilha,posicao)=>{if(trilha&&typeof trilha==='object'&&'mode' in trilha)trilha.mode=(escolha===hlsCount+posicao)?'showing':'disabled';});
    }

    const android=/StreamTVAndroid/.test(navigator.userAgent);
    let initialFocus=false, frameCallback=null;
    let hls=null, video=null, generation=0, settle=null, startupTimer=null, controlsTimer=null, direct=false;
    function stop(){saveProgress();subtitleChoice=-1;if(video&&frameCallback!==null&&video.cancelVideoFrameCallback)video.cancelVideoFrameCallback(frameCallback);frameCallback=null;initialFocus=false;clearTimeout(controlsTimer);el('direct-controls').hidden=true;++generation;clearTimeout(startupTimer);if(settle){settle(false);settle=null;}if(hls){hls.destroy();hls=null;}if(video){video.pause();video.removeAttribute('src');video.load();video.remove();video=null;}direct=false;el('frame').hidden=false;el('direct-resume').hidden=true;el('direct-quality').hidden=true;el('quality-limit').textContent='';subtitleMenu();}
    function bestLevel(){
        if(!hls?.levels.length)return -1;
        let candidates=hls.levels.map((level,index)=>({level,index}));
        // Prefer AVC on Android boxes when offered; some devices advertise HEVC but cannot render it reliably.
        if(android&&candidates.some(c=>/^avc[13]/i.test(c.level.videoCodec||'')))candidates=candidates.filter(c=>/^avc[13]/i.test(c.level.videoCodec||''));
        return candidates.reduce((best,c)=>c.level.height>best.level.height||(c.level.height===best.level.height&&(c.level.bitrate||0)>(best.level.bitrate||0))?c:best).index;
    }
    function portuguese(track){return /^(pt|por)(-|_|$)/i.test(track.lang||track.language||'')||/dublad|portugu[eê]s|portuguese|pt[-_ ]?br/i.test(track.name||track.label||'');}
    function enforceAudio(){
        if(!hls)return true;const tracks=hls.audioTracks||[];if(!tracks.length)return true;
        if(audioChoice>=0)return true;
        const pt=tracks.findIndex(portuguese);
        if(pt>=0){if(hls.audioTrack!==pt)hls.audioTrack=pt;return true;}
        // A named English track is just as explicit as an ISO language tag.
        if(tracks.some(t=>t.lang||/english|ingl[eê]s|espa[nñ]ol|spanish|fran[cç]ais|french|legendad|original/i.test(t.name||''))){failure();return false;}
        return true;
    }
    function qualityInfo(level){
        const width=level?.width||video?.videoWidth||0,height=level?.height||video?.videoHeight||0;
        const taxa=Number(level?.bitrate)>0?` · ${(level.bitrate/1000000).toFixed(1).replace('.',',')} Mbps`:'';
        el('quality-info').textContent=(width&&height?`${width} × ${height} · ${rotuloAudio}`:height?`${height}p · ${rotuloAudio}`:`Original · ${rotuloAudio}`)+taxa;
        const best=hls?.levels[bestLevel()],maxWidth=best?.width||width,maxHeight=best?.height||height;
        el('quality-limit').textContent=maxWidth>=1920||maxHeight>=1080?'Full HD ou superior disponível nesta fonte.':maxWidth||maxHeight?'Esta fonte não oferece Full HD para este filme.':'Verificando a resolução oferecida pela fonte…';
        const alt=el('quality-alt');if(alt)alt.hidden=Boolean(maxWidth>=1920||maxHeight>=1080);atualizarBotoesAjuste();
    }
    function quality(value){if(hls)hls.currentLevel=value==='best'?bestLevel():Number(value);}
    function qualityMenu(){const select=el('quality-select');select.hidden=false;select.replaceChildren();const values=[['best','Melhor disponível'],['-1','Automática (conexão)']];if(hls)hls.levels.forEach((l,i)=>{if(l.height)values.push([String(i),`${l.height}p`]);});for(const [value,label] of values){const o=document.createElement('option');o.value=value;o.textContent=label;select.append(o);}select.value='best';el('direct-quality').hidden=false;}
    function play(){if(!video)return;const target=video,token=generation;target.play().catch(e=>{if(token!==generation||target!==video)return;if(e.name==='NotAllowedError'){el('loading').classList.remove('vis');el('direct-resume').hidden=false;}else failure();});}
    function failure(){const pending=settle;settle=null;if(pending){stop();pending(false);}else if(direct){stop();mostrarErro('A reprodução foi interrompida.','Tente novamente ou escolha outra fonte em Opções.');}}
        // Endereços aceitos: o encaminhamento do próprio aplicativo, as fontes
        // conhecidas e listas de reprodução (inclusive as de caminho protegido,
        // que são liberadas na hora pelo resolvedor).
        // nixplay.lat entrega o episódio dublado em MP4 (arquivo direto).
        const enderecoDeMidia=url=>/^(\/api\/hls\?|https:\/\/[a-z0-9-]+\.hclod\.qzz\.io\/|https:\/\/pipocacine\.lat\/|https:\/\/vixsrc\.to\/|https:\/\/nixplay\.lat\/)/i.test(url)||/^https:\/\/[a-z0-9.-]+\/(?:pl\/|[^\s]*\.m3u8)/i.test(url);
        async function start(id,version,signal,caminho,urlDireta,originalPermitido){stop();const token=generation;let data;if(urlDireta){data={url:urlDireta,audio:'fonte',source:'Full HD',type:'hls'};}else{try{data=await lerJson(caminho||`/api/playback/${id}`,signal);}catch{return false;}}if(token!==generation||(signal&&signal.aborted)||version!==playerVersion)return false;const enderecoAceito=enderecoDeMidia(data.url);if(urlDireta){if(!enderecoAceito)return false;}else if(!enderecoAceito||(data.audio!=='pt-BR'&&!originalPermitido))return false;
        rotuloAudio=data.audio==='pt-BR'?'Dublado':'som original';progressFilm=typeof filmeAtual!=='undefined'?{...filmeAtual}:null;resumeApplied=false;lastSaved=0;video=document.createElement('video');video.id='direct-video';video.controls=false;video.autoplay=true;video.playsInline=true;video.preload='auto';video.tabIndex=0;video.setAttribute('aria-label',rotuloAudio==='Dublado'?'Filme dublado':'Filme em alta definição');video.setAttribute('webkit-playsinline','');video.setAttribute('x-webkit-airplay','allow');video.style.cssText='width:100%;height:100%;object-fit:contain;background:#000';video.playbackRate=speed;try{video.volume=volume;video.muted=mudo;}catch{}atualizarVolume();el('frame').hidden=true;document.querySelector('.area-player').prepend(video);const speedSelect=el('speed-select');if(speedSelect)speedSelect.value=String(speed);audioMenu();direct=true;showControls();
        return new Promise(resolve=>{settle=resolve;const current=()=>token===generation&&version===playerVersion;const ready=()=>{if(!current()||!video.videoWidth||!video.videoHeight)return;clearTimeout(startupTimer);el('loading').classList.remove('vis');const done=settle;settle=null;if(done)done(true);};
            let recovered=false, nativeFallback=false;
            const awaitPicture=()=>{
                if(!current())return;
                const decoded=video.getVideoPlaybackQuality?.().totalVideoFrames??video.webkitDecodedFrameCount;
                if(decoded>0&&video.videoWidth&&video.videoHeight){ready();return;}
                if(video.requestVideoFrameCallback){if(frameCallback===null)frameCallback=video.requestVideoFrameCallback(()=>{frameCallback=null;if(current())ready();});}
                else {const frames=video.getVideoPlaybackQuality?.().totalVideoFrames??video.webkitDecodedFrameCount;if(frames>0||(frames===undefined&&video.readyState>=2))ready();}
            };
            const pictureTimeout=()=>{
                if(!current())return;
                if(android&&hls&&!nativeFallback&&video.canPlayType('application/vnd.apple.mpegurl')){
                    nativeFallback=true;resumeApplied=false;hls.destroy();hls=null;video.pause();video.src=data.url;
                    el('direct-quality').hidden=false;el('quality-select').hidden=true;
                    startupTimer=setTimeout(()=>{if(current())failure();},12000);play();
                }else failure();
            };
            startupTimer=setTimeout(pictureTimeout,12000);
            if(signal)signal.addEventListener('abort',()=>{if(current())failure();},{once:true});
            video.addEventListener('playing',()=>{if(!current())return;el('direct-resume').hidden=true;awaitPicture();el('direct-toggle').textContent='⏸';el('direct-toggle').setAttribute('aria-label','Pausar');showControls(!initialFocus);initialFocus=true;});
            video.addEventListener('canplay',()=>{if(!current())return;play();},{once:true});
            video.addEventListener('loadedmetadata',()=>{if(current()){qualityInfo();subtitleMenu();buscaLivre();atualizarVolume();resume();window.StreamLegendas?.anexar?.(video,progressFilm).then?.(()=>{if(current())subtitleMenu();}).catch?.(()=>{});}});
            video.addEventListener('pause',()=>{if(current()){saveProgress();el('direct-toggle').textContent='▶';el('direct-toggle').setAttribute('aria-label','Reproduzir');showControls();}});
            video.addEventListener('timeupdate',()=>{if(current()){resume();if(resumeApplied&&Date.now()-lastSaved>2000){saveProgress();lastSaved=Date.now();}if(settle)awaitPicture();el('direct-time').textContent=clock(video.currentTime)+' / '+clock(video.duration);const barra=el('direct-progress');if(barra&&!arrastando)barra.value=Number.isFinite(video.duration)&&video.duration>0?Math.round(video.currentTime/video.duration*1000):0;}});
            video.addEventListener('click',()=>showControls(true));
            video.textTracks?.addEventListener?.('addtrack',()=>{if(current()){subtitleMenu();setSubtitle(subtitleChoice);}});
            video.addEventListener('error',()=>{if(current())failure();});
            // Arquivo direto (MP4 progressivo): toca no próprio player, sem
            // hls.js. É o caso da fonte dublada alternativa.
            if(data.type==='file'){
                video.src=data.url;el('direct-quality').hidden=false;el('quality-select').hidden=true;qualityInfo();subtitleMenu();play();
            }else if(window.Hls?.isSupported()){
                hls=new Hls({enableWorker:true,maxBufferLength:45,maxMaxBufferLength:90,backBufferLength:30,manifestLoadingMaxRetry:2,levelLoadingMaxRetry:2,fragLoadingMaxRetry:3,fragLoadingRetryDelay:700,abrEwmaDefaultEstimate:1200000});
                hls.on(Hls.Events.MANIFEST_PARSED,()=>{if(!current())return;if(!originalPermitido&&!enforceAudio())return;qualityMenu();quality('best');audioMenu();subtitleMenu();setSubtitle(subtitleChoice);play();});
                hls.on(Hls.Events.LEVEL_SWITCHED,(_,d)=>{if(current()){const l=hls.levels[d.level];qualityInfo(l);}});
                hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED,()=>{if(!current())return;subtitleMenu();if(!escolherLegendaAutomatica())setSubtitle(subtitleChoice);});
                hls.on(Hls.Events.AUDIO_TRACKS_UPDATED,()=>{if(current()){if(!originalPermitido)enforceAudio();audioMenu();}});
                hls.on(Hls.Events.AUDIO_TRACK_SWITCHED,()=>{if(current()&&!originalPermitido)enforceAudio();});
                hls.on(Hls.Events.ERROR,(_,d)=>{if(!current()||!d.fatal)return;if(d.type==='mediaError'&&!recovered){recovered=true;hls.recoverMediaError();clearTimeout(startupTimer);startupTimer=setTimeout(()=>{if(current())failure();},15000);}else failure();});hls.loadSource(data.url);hls.attachMedia(video);
            }else if(video.canPlayType('application/vnd.apple.mpegurl')){video.src=data.url;el('direct-quality').hidden=false;el('quality-select').hidden=true;play();}else failure();
        });
    }
    function marcarAtivo(botao,ativo){if(!botao)return;if(ativo)botao.setAttribute('data-ativo','');else botao.removeAttribute('data-ativo');}
    function atualizarBotoesAjuste(){const botaoQualidade=el('menu-quality-btn');if(botaoQualidade){const altura=hls?.levels?.[bestLevel()]?.height||video?.videoHeight||0;botaoQualidade.textContent=altura?altura+'p':'HD';}const botaoVelocidade=el('menu-speed-btn');if(botaoVelocidade)botaoVelocidade.textContent=String(speed).replace('.',',')+'×';marcarAtivo(el('menu-subs-btn'),subtitleChoice>=0);marcarAtivo(el('menu-audio-btn'),audioChoice>=0);}
    function clock(seconds){if(!Number.isFinite(seconds))return '--:--';const n=Math.floor(seconds);return Math.floor(n/60)+':'+String(n%60).padStart(2,'0');}
    function showControls(focus=false){if(!direct)return;window.StreamChrome?.wake();clearTimeout(controlsTimer);el('direct-controls').hidden=false;if(focus)el('direct-toggle').focus();controlsTimer=setTimeout(()=>{if(video&&!video.paused&&el('opcoes').hidden){if(el('direct-controls').contains(document.activeElement))video.focus();el('direct-controls').hidden=true;}},6000);}
    function toggle(){if(video)video.paused?play():video.pause();showControls();}
    function atualizarVolume(){const botao=el('volume-toggle');if(botao)botao.textContent=mudo||volume<=0?'🔇':volume<0.5?'🔉':'🔊';const faixa=el('volume-range');if(faixa&&!faixa.matches?.(':active'))faixa.value=String(Math.round((mudo?0:volume)*100));}
    function setVolume(valor){volume=Math.min(1,Math.max(0,Number(valor)||0));mudo=volume<=0;if(video){try{video.volume=volume;video.muted=mudo;}catch{}}try{localStorage.setItem('streamtv-volume',String(volume));localStorage.setItem('streamtv-mudo',String(mudo));}catch{}atualizarVolume();}
    function toggleMute(){mudo=!mudo;if(video){try{video.muted=mudo;}catch{}}try{localStorage.setItem('streamtv-mudo',String(mudo));}catch{}atualizarVolume();showControls();}
    function irPara(valor){if(!video||!Number.isFinite(video.duration)||video.duration<=0)return;const destino=Math.min(video.duration,Math.max(0,Number(valor)/1000*video.duration));try{video.currentTime=destino;el('direct-time').textContent=clock(destino)+' / '+clock(video.duration);}catch{}}
    function buscaLivre(){const barra=el('direct-progress');if(!barra)return;barra.addEventListener('pointerdown',()=>{arrastando=true;showControls(true);});barra.addEventListener('touchstart',()=>{arrastando=true;showControls(true);},{passive:true});const soltar=()=>{if(!arrastando)return;arrastando=false;irPara(barra.value);saveProgress();showControls();};barra.addEventListener('change',soltar);barra.addEventListener('pointerup',soltar);barra.addEventListener('touchend',soltar);barra.addEventListener('input',()=>{irPara(barra.value);showControls();});}
    function seek(seconds){if(video&&Number.isFinite(video.duration))video.currentTime=Math.max(0,Math.min(video.duration,video.currentTime+seconds));showControls();}
    // Mover o dedo ou o mouse traz os controles de volta enquanto o vídeo roda.
    document.addEventListener('pointermove',()=>{if(direct&&video)showControls();},{passive:true});
    return {start,stop,play,quality,toggle,seek,showControls,setSubtitle,saveProgress,setSpeed,setAudio,audioMenu,setVolume,toggleMute,irPara,isActive:()=>direct,estado:()=>({audio:rotuloAudio,legenda:subtitleChoice})};
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
