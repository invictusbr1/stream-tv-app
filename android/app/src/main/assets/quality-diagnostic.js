(function(root){
 'use strict';
 const reasons={na_fila:'Aguardando consulta',consulta:'Consultando',prazo_consulta:'Prazo de consulta atingido',prazo_midia:'Medição não concluída no prazo',sonda:'Verificando mídia',medida:'Mídia medida',validada:'Validada',sem_endereco:'Fornecedor não entregou endereço',conexao_tls:'Falha de conexão segura',tempo_esgotado:'Tempo de conexão esgotado',dns:'Endereço não localizado',cancelado:'Verificação interrompida',leitura_falhou:'Falha na leitura',verificacao_falhou:'Falha na verificação',http_temporario:'Indisponibilidade temporária',midia_indisponivel:'Mídia indisponível',sem_metadados:'Resolução não confirmada',idioma_outro:'Outro idioma',idioma_sem_prova:'Dublagem não confirmada',codec_desconhecido:'Formato não reconhecido',hevc_desabilitado:'Verificação em modo compatível',codec_video:'Formato de vídeo recusado pelo sistema',codec_audio:'Formato de áudio recusado pelo sistema'};
 function clean(data){
  if(!data||!/^\d{1,10}$/.test(String(data.id||''))||!Array.isArray(data.fontes))return null;
  const number=v=>Math.max(0,Math.min(32768,Number(v)||0));
  const fontes=data.fontes.slice(0,12).filter(r=>r&&/^[a-zA-Z0-9_-]{1,30}$/.test(r.id)).map(r=>({id:r.id,motivo:reasons[r.motivo]||/^http_[1-5]\d\d$/.test(r.motivo)?r.motivo:'verificacao_falhou',largura:number(r.largura),altura:number(r.altura),idioma:r.idioma===2?2:r.idioma===-1?-1:1,ms:Math.max(0,Math.min(120000,Number(r.ms)||0))}));
  return {id:String(data.id),temporada:/^\d{1,4}$/.test(String(data.temporada))?String(data.temporada):'',episodio:/^\d{1,4}$/.test(String(data.episodio))?String(data.episodio):'',hevc:data.hevc===true,escolhida:/^[a-zA-Z0-9_-]{1,30}$/.test(data.escolhida)?data.escolhida:'',fontes};
 }
 function format(d){return ['Verificação de qualidade',d.hevc?'Motor: HEVC habilitado':'Motor: modo compatível','Escolhida: '+d.escolhida,...d.fontes.map(r=>r.id+': '+(reasons[r.motivo]||r.motivo)+(r.largura&&r.altura?' · '+r.largura+'×'+r.altura:'')+' · '+(r.ms/1000).toFixed(1)+'s')].join('\n');}
 if(typeof module==='object'&&module.exports){module.exports={clean,format};return;}
 let panel,last='',lastData=null;
 function current(){try{return typeof filmeAtual!=='undefined'?filmeAtual:null;}catch{return null;}}
 function matches(d,f){return f&&String(f.id)===d.id&&String(f.episode?.season||'')===d.temporada&&String(f.episode?.number||'')===d.episodio;}
 root.StreamQualityDiagnostic={receive(input){try{
  const d=clean(input),f=current();if(!d||!matches(d,f))return;
  const text=format(d),key=[d.id,d.temporada,d.episodio,text].join('|');if(key===last)return;
  if(!panel){const host=document.querySelector('#opcoes .options');if(!host)return;panel=document.createElement('details');panel.id='quality-diagnostic';panel.style.cssText='font-size:12px;margin:12px 0;color:#aeb7c6';const summary=document.createElement('summary');summary.textContent='Verificação de qualidade';const body=document.createElement('pre');body.style.cssText='white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;line-height:1.5';const copy=document.createElement('button');copy.className='quiet';copy.type='button';copy.textContent='Copiar diagnóstico';copy.onclick=async()=>{try{await navigator.clipboard.writeText(body.textContent);copy.textContent='Copiado';}catch{const range=document.createRange();range.selectNodeContents(body);const selection=root.getSelection();selection.removeAllRanges();selection.addRange(range);copy.textContent='Texto selecionado';}};panel.append(summary,body,copy);host.append(panel);}
  last=key;lastData=d;panel.querySelector('pre').textContent=text;panel.querySelector('button').textContent='Copiar diagnóstico';panel.hidden=false;panel.open=false;
  Promise.resolve(root.StreamAcesso?.reportar?.({tipo:'qualidade',ok:true,id:d.id,titulo:f.titulo,temporada:d.temporada,numero:d.episodio,motivo:d.hevc?'motor_hevc':'motor_avc',avaliacao:d.fontes.slice(0,6).map(r=>({fonte:r.id,nota:0,idioma:r.idioma===2?'pt':r.idioma===-1?'outro':'não informado',qualidade:r.largura&&r.altura?r.largura+'x'+r.altura:r.motivo,taxa:r.ms+'ms'}))})).catch(()=>{});
 }catch{}}};
 document.addEventListener('click',()=>{if(panel&&lastData&&!matches(lastData,current())){panel.hidden=true;last='';lastData=null;}},true);
})(typeof window==='undefined'?globalThis:window);
