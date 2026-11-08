 // Ficha do título (07/11/2026): a sinopse já está no topo — embaixo, no
 // lugar da repetida, vêm informações, elenco, trailer, crítica e os
 // comentários da família.
 const fichaBox=document.createElement('div');fichaBox.id='ficha-extra';byId('aba-detalhes')?.append(fichaBox);
 let fichaAtual='';
 const novo=(tag,cls,txt)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(txt!==undefined)n.textContent=txt;return n;};
 const estrelas=n=>'★★★★★'.slice(0,n)+'☆☆☆☆☆'.slice(0,5-n);
 const IDIOMAS={en:'Inglês',ja:'Japonês',ko:'Coreano',pt:'Português',es:'Espanhol',fr:'Francês',it:'Italiano',de:'Alemão',zh:'Chinês',hi:'Hindi'};
 function dataBr(s){const m=String(s||'').match(/^(\d{4})-(\d{2})-(\d{2})/);return m?`${m[3]}/${m[2]}/${m[1]}`:'';}
 function horas(min){if(!min)return '';const h=Math.floor(min/60),m=min%60;return h?`${h}h${m?String(m).padStart(2,'0'):''}`:`${m} min`;}
 async function pintarFicha(f){
  const chave=(f.tipo==='tv'?'tv':'movie')+'/'+f.id;fichaAtual=chave;fichaBox.replaceChildren(novo('p','ficha-carregando','Carregando mais informações…'));
  let d=null,comentarios=[];
  try{const [r1,r2]=await Promise.all([fetch('/api/ficha/'+chave,{cache:'no-store'}),fetch('/api/comentarios/'+chave,{cache:'no-store'})]);d=r1.ok?await r1.json():null;comentarios=r2.ok?await r2.json():[];}catch(e){}
  if(fichaAtual!==chave)return;
  fichaBox.replaceChildren();
  if(d){
   if(d.frase)fichaBox.append(novo('p','ficha-frase','“'+d.frase+'”'));
   const info=novo('dl','ficha-info');
   const item=(rot,val)=>{if(!val)return;info.append(novo('dt','',rot),novo('dd','',val));};
   item(f.tipo==='tv'?'Episódios':'Duração',f.tipo==='tv'?[d.temporadas&&`${d.temporadas} temporada${d.temporadas>1?'s':''}`,d.episodios&&`${d.episodios} episódios`,d.duracao&&`~${d.duracao} min cada`].filter(Boolean).join(' · '):horas(d.duracao));
   item('Estreia',dataBr(d.estreia));item('Situação',d.situacao);
   item('Classificação',d.classificacao?(/^L$/i.test(d.classificacao)?'Livre':d.classificacao+' anos'):'');
   item(f.tipo==='tv'?'Criação':'Direção',(d.direcao||[]).join(', '));
   item('Idioma original',IDIOMAS[d.idiomaOriginal]||d.idiomaOriginal);
   item('Título original',d.tituloOriginal&&d.tituloOriginal!==f.titulo?d.tituloOriginal:'');
   item('Nota do público',d.nota?`★ ${d.nota} (${Number(d.votos).toLocaleString('pt-BR')} votos)`:'');
   item('Produção',(d.produtoras||[]).join(', '));item('Faz parte de',d.colecao);
   if(info.children.length){fichaBox.append(novo('h3','','Informações'),info);}
   if(d.trailer){const b=novo('button','quiet ficha-trailer','▶ Ver trailer');b.type='button';b.onclick=()=>window.open('https://www.youtube.com/watch?v='+encodeURIComponent(d.trailer),'_blank','noopener');fichaBox.append(b);}
   if((d.elenco||[]).length){
    const lista=novo('div','ficha-elenco');
    for(const p of d.elenco){const c=novo('div','ficha-ator');const img=novo('img');img.alt='';img.loading='lazy';if(p.foto)img.src=p.foto;else img.hidden=true;c.append(img,novo('strong','',p.nome),novo('span','',p.personagem));lista.append(c);}
    fichaBox.append(novo('h3','','Elenco'),lista);
   }
   if((d.criticas||[]).length){
    fichaBox.append(novo('h3','','O que a crítica diz'));
    for(const c of d.criticas){const b=novo('blockquote','ficha-critica');b.append(novo('p','',c.texto+(c.texto.length>=420?'…':'')),novo('footer','',[c.autor,c.nota&&`nota ${c.nota}/10`,c.ingles&&'em inglês'].filter(Boolean).join(' · ')));fichaBox.append(b);}
   }
  }
  // Comentários da família.
  const sec=novo('section','ficha-comentarios');sec.append(novo('h3','','💬 Comentários da família'));
  const lista=novo('div','ficha-lista');
  const desenhar=itens=>{lista.replaceChildren();if(!itens.length)lista.append(novo('p','ficha-vazio','Ninguém comentou ainda. Seja o primeiro a dizer o que achou!'));
   for(const c of itens){const b=novo('div','ficha-coment'+(c.meu?' meu':''));const topo=novo('div','ficha-coment-topo');topo.append(novo('strong','',c.nome+(c.meu?' (você)':'')),c.nota?novo('span','ficha-estrelas',estrelas(c.nota)):novo('span'),novo('small','',new Date(c.em).toLocaleDateString('pt-BR')));b.append(topo);if(c.texto)b.append(novo('p','',c.texto));lista.append(b);}};
  desenhar(Array.isArray(comentarios)?comentarios:[]);
  const meu=(Array.isArray(comentarios)?comentarios:[]).find(c=>c.meu);
  const form=novo('form','ficha-form');let nota=meu?.nota||0;
  const notas=novo('div','ficha-notas');notas.setAttribute('aria-label','Sua nota');
  const pintarNotas=()=>[...notas.children].forEach((b,i)=>{b.textContent=i<nota?'★':'☆';b.setAttribute('aria-pressed',String(i<nota));});
  for(let i=1;i<=5;i++){const b=novo('button','ficha-nota');b.type='button';b.setAttribute('aria-label',i+' estrela'+(i>1?'s':''));b.onclick=()=>{nota=i;pintarNotas();};notas.append(b);}
  pintarNotas();
  const texto=novo('textarea');texto.maxLength=280;texto.rows=2;texto.placeholder='O que você achou? (sem spoiler!)';texto.value=meu?.texto||'';
  const enviar=novo('button','primary',meu?'Atualizar meu comentário':'Comentar');enviar.type='submit';
  const aviso=novo('small','ficha-aviso','');
  form.append(notas,texto,enviar,aviso);
  form.onsubmit=async e=>{e.preventDefault();e.stopPropagation();if(!nota&&!texto.value.trim()){aviso.textContent='Dê uma nota ou escreva algo.';return;}
   enviar.disabled=true;try{const r=await fetch('/api/comentarios/'+chave,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({nota,texto:texto.value})});if(r.ok){desenhar(await r.json());enviar.textContent='Atualizar meu comentário';aviso.textContent='Comentário salvo — a família toda vê.';}else aviso.textContent='Não foi possível salvar agora.';}catch(err){aviso.textContent='Não foi possível salvar agora.';}finally{enviar.disabled=false;}};
  sec.append(lista,form);fichaBox.append(sec);
 }
