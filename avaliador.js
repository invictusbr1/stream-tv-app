'use strict';
// Avaliador de qualidade em tempo real.
//
// Antes de tocar, o aplicativo pergunta às melhores fontes daquele título —
// EM PARALELO — o que cada uma entrega de verdade, e escolhe a melhor segundo
// as regras do projeto:
//
//     idioma comprovado → resolução medida → reprodução direta → taxa → tempo.
// As fontes internas entregam mídia direta, sem incorporar páginas externas.
// A nota complementar explica as evidências; velocidade só desempata qualidade.
//
// A decisão tem prazo curto: se a checagem passar do orçamento, toca o que já
// respondeu (nunca deixamos quem assiste esperando).

const axios = require('axios');
const motor = require('./fontes-motor');
const midia = require('./midia-proxy');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
// Todas as fontes aprovadas e aplicáveis participam. Uma posição fixa na
// fila não pode esconder a única alternativa de maior qualidade do título.
const MAX_FONTES = Infinity;
const TEMPO_RESOLVER = 8000;       // fontes consultadas em paralelo
const TEMPO_SONDAR = 4000;         // limite por sonda
const ORCAMENTO = 12000;           // oito segundos + revisão dirigida de até quatro
const VALIDADE = 60 * 1000;        // renova a disputa para descobrir melhorias

const cache = new Map();
const medidasDeArquivo = new Map();
const medicoesEmCurso = new Map();
let versaoMedicoes = 0;

const prazo = (promessa, ms, padrao = null) => new Promise(resolve => {
    const timer = setTimeout(() => resolve(padrao), ms);
    Promise.resolve(promessa).then(valor => { clearTimeout(timer); resolve(valor); }, () => { clearTimeout(timer); resolve(padrao); });
});

// ---------------------------------------------------------------- sondagens
// Lê a lista mestre do HLS: melhor formato, idiomas de áudio e legendas.
function analisarPlaylist(texto) {
    const linhas = String(texto || '').split('\n').map(l => l.trim());
    let altura = 0, largura = 0, banda = 0, mestre = false;
    const audios = [], legendas = [];
    for (const linha of linhas) {
        if (linha.startsWith('#EXT-X-STREAM-INF')) {
            mestre = true;
            const a = Number((linha.match(/RESOLUTION=\d+x(\d+)/i) || [])[1] || 0);
            const l = Number((linha.match(/RESOLUTION=(\d+)x\d+/i) || [])[1] || 0);
            const b = Number((linha.match(/BANDWIDTH=(\d+)/i) || [])[1] || 0);
            if (alturaEquivalente(l, a) > alturaEquivalente(largura, altura)) { altura = a; largura = l; }
            if (b > banda) banda = b;
        } else if (linha.startsWith('#EXT-X-MEDIA:TYPE=AUDIO')) {
            audios.push({
                lang: ((linha.match(/LANGUAGE="([^"]+)"/i) || [])[1] || '').toLowerCase(),
                name: (linha.match(/NAME="([^"]+)"/i) || [])[1] || '',
            });
        } else if (linha.startsWith('#EXT-X-MEDIA:TYPE=SUBTITLES')) {
            const lang = ((linha.match(/LANGUAGE="([^"]+)"/i) || [])[1] || '').toLowerCase();
            if (lang && !legendas.includes(lang)) legendas.push(lang);
        }
    }
    return { mestre, altura, largura, banda, audios, legendas };
}

async function sondarLista(url, referer) {
    const cabecalhos = { 'User-Agent': UA, Accept: '*/*' };
    const referencia = referer || midia.refererPadrao(new URL(url).hostname);
    if (referencia) cabecalhos.Referer = referencia;
    const resposta = await axios.get(url, { headers: cabecalhos, timeout: TEMPO_SONDAR, responseType: 'text', maxContentLength: 1024 * 1024 });
    const texto = String(resposta.data || '');
    const analise = analisarPlaylist(texto);
    // Listas de qualidade única não declaram RESOLUTION. Mede um segmento
    // claro da própria origem, inclusive quando o fornecedor usa sufixo .js.
    // Não segue aqui endereços de outro domínio, chaves ou listas criptografadas.
    if (!analise.altura && /^#EXTM3U/m.test(texto) && !/#EXT-X-KEY:.*METHOD=(?!NONE)/i.test(texto)) {
        const segmento = texto.split(/\r?\n/).map(l => l.trim()).find(l => l && !l.startsWith('#'));
        if (segmento) {
            const base = new URL(url), destino = new URL(segmento, base);
            if (base.protocol === 'https:' && destino.origin === base.origin && !destino.username && !destino.password && !/\.m3u8(?:$|\?)/i.test(destino.href)) {
                const medida = await sondarArquivo(destino.href, referencia);
                if (medida) return { ...analise, ...medida, audios: [...analise.audios, ...medida.audios], legendas: analise.legendas };
            }
        }
    }
    return analise;
}

const leiturasPendentes=new Map(),filaDeLeituras=[];let leiturasAtivas=0,leiturasRapidasAtivas=0;
function liberarLeituras(){
    filaDeLeituras.sort((a,b)=>Number(b.prioritaria)-Number(a.prioritaria)||b.gaveta-a.gaveta);
    for(;;){
        const index=filaDeLeituras.findIndex(j=>j.rapida?leiturasRapidasAtivas<4:leiturasAtivas<2);
        if(index<0)return;
        const job=filaDeLeituras.splice(index,1)[0],restante=job.fim-Date.now(),rapida=job.rapida;
        if(restante<500){job.resolve(null);continue;}
        if(rapida)leiturasRapidasAtivas++;else leiturasAtivas++;
        let leitura;try{leitura=rapida?require('./mp4-rapido.cjs').ler(job.url,job.referer,{timeout:restante,falhaExplicita:true}):require('./central/verificar-midia').faixasDeAudio(job.url,job.referer,{timeout:Math.max(1000,restante)});}catch{leitura=null;}
        const terminar=value=>{
            // Uma leitura leve inconclusiva volta à fila pesada, liberando a
            // vaga de metadados. Processos de análise continuam limitados a dois.
            if(rapida&&!value&&job.fim-Date.now()>500){job.rapida=false;filaDeLeituras.push(job);}else job.resolve(value);
        };
        Promise.resolve(leitura).then(terminar,()=>terminar(null)).finally(()=>{if(rapida)leiturasRapidasAtivas--;else leiturasAtivas--;liberarLeituras();});
    }
}
function lerArquivoComLimite(url,referer,opcoes){
    const key=JSON.stringify([url,referer||'']);if(leiturasPendentes.has(key))return leiturasPendentes.get(key);
    if(filaDeLeituras.length>=64)return Promise.resolve(null);
    const job={url,referer:referer||'',rapida:opcoes.rapida===true,prioritaria:opcoes.prioritaria===true,gaveta:Math.max(0,Math.min(6,Number(opcoes.gaveta)||0)),fim:Date.now()+(opcoes.timeout||6000)};
    const promise=new Promise(resolve=>{job.resolve=resolve;filaDeLeituras.push(job);liberarLeituras();});
    leiturasPendentes.set(key,promise);promise.finally(()=>{if(leiturasPendentes.get(key)===promise)leiturasPendentes.delete(key);});return promise;
}
async function sondarArquivo(url, referer, opcoes = {}) {
    const faixas = await lerArquivoComLimite(url,referer,opcoes);
    if (!faixas) return null;
    if (faixas.indisponivel) return {indisponivel:true,...(faixas.temporaria?{temporaria:true}:{})};
    const portuguesa = faixas.faixas.find(f => /^pt|por/.test(f.idioma));
    return {
        mestre: false,
        altura: faixas.imagem ? faixas.imagem.altura : 0,
        largura: faixas.imagem ? faixas.imagem.largura : 0,
        videoCodec: faixas.imagem?.codec || '',
        banda: 0,
        audios: faixas.faixas.map(f => ({ lang: f.idioma, name: f.codec, padrao: f.padrao })),
        legendas: [],
        portuguesa: Boolean(portuguesa),
        padraoPortugues: Boolean(portuguesa && portuguesa.padrao),
    };
}

// Sonda o que a fonte realmente entrega (lista ou arquivo).
async function sondar(dados,opcoes={}) {
    if (!dados || !dados.url) return null;
    const ehLista = dados.type === 'hls' || /\.m3u8(\?|$)/i.test(dados.url);
    const chave = JSON.stringify([dados.url, dados.referer || '']);
    // Reaproveita só medições concluídas, por endereço e referência exatos,
    // com prazo menor para listas, enquanto o teste
    // de entrega continua sendo feito a cada avaliação. Uma falha não é prova
    // de que o arquivo perdeu a qualidade ou a faixa em português.
    const medida = medidasDeArquivo.get(chave);
    if (medida && medida.expira > Date.now()) return medida.sonda;
    if (medicoesEmCurso.has(chave)) return medicoesEmCurso.get(chave);
    const versao = versaoMedicoes;
    const operacao = (async () => { try {
        const sonda = ehLista ? await sondarLista(dados.url, dados.referer) : await sondarArquivo(dados.url, dados.referer,opcoes);
        if (versao === versaoMedicoes && sonda?.altura > 0) {
            if (medidasDeArquivo.size >= 128) medidasDeArquivo.delete(medidasDeArquivo.keys().next().value);
            medidasDeArquivo.set(chave, { sonda, expira: Date.now() + (gavetaDaAltura(alturaEquivalente(sonda.largura,sonda.altura))<5?1500:VALIDADE) });
        }
        return sonda;
    } catch { return null; } })();
    medicoesEmCurso.set(chave, operacao);
    try { return await operacao; } finally { if (medicoesEmCurso.get(chave) === operacao) medicoesEmCurso.delete(chave); }
}

// Compara também a largura: 1920×800 é uma imagem de cinema em Full HD,
// enquanto 3840×1600 tem mais definição que 1920×1080.
function alturaEquivalente(largura, altura) {
    if (!(altura > 0)) return 0;
    return largura > 0 ? Math.max(Math.min(largura, altura), Math.max(largura, altura) * 9 / 16) : altura;
}

function alturaDoRotulo(valor) {
    const texto = String(valor || '');
    const pixels = texto.match(/(?:^|\D)(\d{3,4})\s*p\b/i) || texto.match(/\d{3,4}\s*[x×]\s*(\d{3,4})/i);
    if (pixels) return Number(pixels[1]);
    if (/\b(?:4k|uhd)\b/i.test(texto)) return 2160;
    if (/full\s*hd|\bfhd\b/i.test(texto)) return 1080;
    return /\bhd\b/i.test(texto) ? 720 : 0;
}

// Pequenos recortes, como 3832×1600, permanecem na família 4K. O ranking
// continua comparando as dimensões exatas dentro de cada gaveta.
function gavetaDaAltura(altura){return altura>=4320*.98?6:altura>=2160*.98?5:altura>=1440*.98?4:altura>=1080*.98?3:altura>=720*.98?2:altura>0?1:0;}
const NOMES_GAVETAS=['Sem confirmação','Qualidade básica','HD','Full HD','2K','4K','Acima de 4K'];

function prioridadeDaFonte({ dados, sonda, idiomaVerificado, ms }) {
    const pt = sonda?.portuguesa || sonda?.padraoPortugues || sonda?.audios?.some(a => /^(?:pt|por)(?:[-_]|$)/i.test(a.lang || ''));
    const outro = idiomaVerificado === 'outro' || (idiomaVerificado !== 'pt' && !pt && sonda?.audios?.some(a => a.lang && a.lang !== 'und' && !/^(?:pt|por)(?:[-_]|$)/i.test(a.lang)));
    const idioma = outro ? -1 : idiomaVerificado === 'pt' || pt ? 2 : dados.audio === 'pt-BR' ? 1 : 0;
    const medida = sonda && !sonda.conversao && sonda.altura > 0;
    const informada = alturaDoRotulo(dados.resolucao);
    const altura=medida?alturaEquivalente(sonda.largura,sonda.altura):informada;
    return [idioma, medida ? 1 : 0, idioma===2&&medida?gavetaDaAltura(altura):0, altura, dados.converter ? 0 : 1, sonda?.banda || 0, -(ms || 0)];
}

function compararPrioridade(a, b) {
    for (let i = 0; i < a.length; i++) { if (a[i] !== b[i]) return b[i] - a[i]; }
    return 0;
}

function avaliarConferidas(conferidas, idiomas, titulo) {
    const provas = require('./provas-idioma');
    const registros = motor.lerProvasDeIdioma();
    return conferidas.map((registro, i) => {
        const guardada = medidasDeArquivo.get(JSON.stringify([registro.item.dados.url, registro.item.dados.referer || '']));
        const sonda = !registro.item.lembrada && guardada && guardada.expira > Date.now() ? guardada.sonda : registro.sonda;
        // A central guarda idioma por fornecedor/título, enquanto a mesma
        // ficha agora pode entregar vários arquivos. Essa prova não transforma
        // outra opção explicitamente inglesa em uma opção dublada.
        const pt=sonda?.padraoPortugues||sonda?.portuguesa||sonda?.audios?.some(a=>/^(pt|por)(-|$)/i.test(a.lang||''));
        const estrangeira=!pt&&sonda?.audios?.some(a=>a.lang&&a.lang!=='und'&&!/^(pt|por)(-|$)/i.test(a.lang));
        const confirmacao = provas.idioma(registros, titulo, registro.item.fonte.id, registro.item.dados);
        const medida = { dados: registro.item.dados, sonda, idiomaVerificado: estrangeira?'outro':confirmacao || idiomas[registro.item.fonte.id] || '', ms: registro.item.ms };
        const { nota, detalhes } = notaDaFonte(medida);
        return { fonteId: registro.item.fonte.id, fonte: registro.item.dados.fonte || registro.item.fonte.nome,
            nota: Math.round((nota + Math.max(0, 0.15 - i * 0.05)) * 100) / 100,
            detalhes: { ...detalhes, gaveta:NOMES_GAVETAS[prioridadeDaFonte(medida)[2]], ordemNoMotor: i + 1 }, dados: { ...registro.item.dados,
                ...(sonda?.videoCodec ? {videoCodec:sonda.videoCodec} : {}),
                ...(sonda?.altura && sonda?.largura ? {resolucao:Math.round(alturaEquivalente(sonda.largura,sonda.altura))+'p'} : {})
            }, ms: registro.item.ms, prioridade: prioridadeDaFonte(medida) };
    }).sort((a, b) => compararPrioridade(a.prioridade, b.prioridade));
}

function resultadoDasAvaliacoes(avaliacoes, tempoMs) {
    const melhor = avaliacoes[0];
    return { escolhido: { ...melhor.dados, fonteId: melhor.fonteId }, avaliacao: avaliacoes.map(({ dados, prioridade, ...resto }) => resto), tempoMs };
}

// ---------------------------------------------------------------- nota
// A régua: dublado (confirmado vale mais) + qualidade medida + velocidade.
function notaDaFonte(medida) {
    const { dados, sonda, idiomaVerificado, ms } = medida;
    const detalhes = {};
    let nota = 0;

    // 1) Idiomas — a regra número um. Vale a MELHOR prova disponível:
    //    ouvir da central > faixa padrão do arquivo > faixa existir > aviso da fonte.
    if (idiomaVerificado === 'outro') {
        // A central OUVIU outro idioma: prova definitiva de que NÃO é dublado.
        // A punição precisa ser grande o bastante para perder de qualquer fonte
        // ainda não medida — que pode muito bem ser dublada. Com -6, o Matrix
        // (WatchPlay em inglês) ainda ganhava de uma fonte não medida e tocava
        // em inglês. Só entra se não houver mais nada.
        nota -= 50;
        detalhes.idioma = 'a central ouviu outro idioma — só entra se não houver mais nada';
        detalhes.audioEmOutroIdioma = true;
    }
    else if (idiomaVerificado === 'pt') { nota += 3; detalhes.idioma = 'português confirmado pela central'; }
    else if (sonda && sonda.padraoPortugues) { nota += 2.5; detalhes.idioma = 'faixa em português é a padrão do arquivo'; }
    else if (sonda && sonda.portuguesa) { nota += 2.2; detalhes.idioma = 'o arquivo tem faixa em português'; }
    else if (sonda && sonda.audios && sonda.audios.some(a => /^pt|por/.test(a.lang || ''))) { nota += 2.2; detalhes.idioma = 'lista com faixa em português'; }
    // A fonte DECLARAR "pt-BR" não é prova: o avaliador de um fornecedor conhecido
    // informa dublado e entrega áudio original. A declaração só vale quando a
    // medição/lista confirma que existe faixa em português no arquivo. Sem essa
    // checagem, a fonte que mente ganhava +2 de vantagem sobre a que diz
    // honestamente "som original" — e vencia a disputa sem ter dublado.
    else if (dados.audio === 'pt-BR') {
        const listaTemPortugues = Boolean(sonda && (
            sonda.padraoPortugues || sonda.portuguesa ||
            (sonda.audios && sonda.audios.some(a => /^pt|por/.test(a.lang || '')))
        ));
        const provaDePortugues = idiomaVerificado === 'pt' || listaTemPortugues;
        // A lista nem sempre declara o idioma (o WatchPlay entrega HLS de uma faixa
        // só). Nesse caso vale o que o PRÓPRIO FORNECEDOR declara na página — é a
        // mesma prova que o aplicativo Android usa. Vale menos que uma faixa em
        // português confirmada no arquivo, e menos que a central ter ouvido.
        const fornecedorDeclaraDublado = /dublado|dual/i.test(String(dados.source || '') + ' ' + String(dados.fonte || ''));
        if (provaDePortugues) { nota += 2; detalhes.idioma = 'a fonte informa dublado'; }
        else if (fornecedorDeclaraDublado) {
            nota += 1.5;
            detalhes.idioma = 'a lista não declara o idioma; o fornecedor informa dublado';
            detalhes.dubladoNaoConfirmado = true;
        }
        else {
            detalhes.idioma = 'a fonte DIZ dublado, mas o arquivo não confirma faixa em português';
            detalhes.dubladoNaoConfirmado = true;
        }
    }
    else if (dados.audio === 'original') { detalhes.idioma = 'som original (com legenda)'; }
    else { detalhes.idioma = 'idioma não informado'; }

    // 2) Qualidade — medida quando possível; senão, a informada pela fonte.
    // A reserva de conversão usa só o rótulo da fonte, ainda sem sondar o
    // vídeo. Ela não pode transformar a promessa em uma medição.
    const alturaMedida = sonda && !sonda.conversao && sonda.altura ? sonda.altura : 0;
    const alturaInformada = alturaDoRotulo(dados.resolucao);
    const altura = alturaMedida || alturaInformada;
    const evidenciaQualidade = alturaMedida ? 'medido' : 'informado pela fonte';
    if (altura >= 1080) nota += 2;
    else if (altura >= 720) nota += 1.5;
    else if (altura >= 480) nota += 0.6;
    else nota += 0.4;
    detalhes.qualidade = altura > 0 ? `${altura}p ${evidenciaQualidade}` : 'não mediu a altura';
    if (alturaMedida && sonda.largura > 0) detalhes.dimensoes = `${sonda.largura} × ${alturaMedida}`;

    // 3) Taxa de bits (quando a lista informa).
    const banda = (sonda && sonda.banda) || 0;
    if (banda >= 4000000) { nota += 0.5; detalhes.taxa = (banda / 1e6).toFixed(1) + ' Mbps'; }
    else if (banda >= 2000000) { nota += 0.3; detalhes.taxa = (banda / 1e6).toFixed(1) + ' Mbps'; }
    else if (banda >= 1000000) { nota += 0.15; detalhes.taxa = (banda / 1e6).toFixed(1) + ' Mbps'; }

    // 4) Velocidade de resposta.
    if (ms <= 1500) { nota += 1; detalhes.velocidade = 'rápida'; }
    else if (ms <= 3000) { nota += 0.7; detalhes.velocidade = 'boa'; }
    else if (ms <= 6000) { nota += 0.4; detalhes.velocidade = 'normal'; }
    else { nota += 0.2; detalhes.velocidade = 'lenta'; }

    // 5) Conversão é útil, mas custa: só vence se a qualidade compensar.
    if (dados.converter) { nota -= 0.4; detalhes.conversao = 'precisa converter o áudio (o vídeo é copiado)'; }

    return { nota: Math.round(nota * 100) / 100, detalhes };
}

// ---------------------------------------------------------------- escolha
function filtrarPorCodec(registros,codec){
    // HEVC é uma capacidade adicional, não uma obrigação: AVC continua válido.
    if(codec!=='avc')return registros;
    return registros.filter(r=>{
        const medido=String(r.sonda?.videoCodec||'').toLowerCase();
        return r.item.dados.type==='hls'&&!medido||/^(h264|avc1|avc3)$/.test(medido);
    });
}
async function escolherMelhor(papel,alvo,opcoes={}){
    const inicio=Date.now(),estado={fila:[],respostas:new Map(),terminadas:new Set(),avaliacoes:[]};
    const inicial=Math.max(100,Math.min(8000,opcoes.orcamentoInicial||8000));
    const revisao=Math.max(0,Math.min(4000,opcoes.orcamentoRevisao??4000));
    const primeira=await escolherRodada(papel,alvo,{...opcoes,_estado:estado,_orcamento:inicial});
    if(primeira?.cache||estado.avaliacoes[0]?.prioridade[2]>=5)return primeira;
    const repetir=estado.fila.filter(f=>{
        if(!estado.terminadas.has(f.id))return true;
        return estado.itens?.some(r=>r.item.fonte.id===f.id&&!r.sonda?.indisponivel&&(!r.sonda?.largura||!r.sonda?.altura||r.sonda?.temporaria));
    });
    if(!repetir.length||!revisao)return primeira;
    const reserva={fila:[],respostas:new Map(),terminadas:new Set(),avaliacoes:[]};
    const fila=repetir.map(f=>{
        const prontas=estado.respostas.get(f.id);
        const pendentes=(prontas||[]).filter(d=>!estado.itens?.some(r=>r.item.fonte.id===f.id&&r.item.dados.url===d.url&&r.sonda?.largura>0&&r.sonda?.altura>0&&!r.sonda.temporaria));
        pendentes.sort((a,b)=>Number(estado.itens?.some(r=>r.item.dados.url===a.url))-Number(estado.itens?.some(r=>r.item.dados.url===b.url)));
        return pendentes.length?{...f,resolverTodos:async()=>pendentes.map(d=>({...d}))}:f;
    });
    await escolherRodada(papel,alvo,{...opcoes,semCache:true,_fila:fila,_semMemoria:true,_estado:reserva,_orcamento:Math.max(1,Math.min(revisao,inicio+inicial+revisao-Date.now()))});
    const mapa=new Map();
    for(const a of [...estado.avaliacoes,...reserva.avaliacoes]){
        const key=a.fonteId+'\n'+a.dados.url,anterior=mapa.get(key);
        if(!anterior||compararPrioridade(a.prioridade,anterior.prioridade)<=0)mapa.set(key,a);
    }
    const avaliacoes=[...mapa.values()].sort((a,b)=>compararPrioridade(a.prioridade,b.prioridade));
    const chave=`${papel}:${motor.chaveDoTitulo(alvo)}:${opcoes.codec||''}:${(opcoes.exceto||[]).join(',')}`;
    cache.delete(chave); // busca parcial não se torna escolha definitiva
    if(!avaliacoes.length)return null;
    const resultado=resultadoDasAvaliacoes(avaliacoes,Date.now()-inicio);
    resultado.verificacao={rodadas:2,inconclusivas:repetir.filter(f=>!reserva.terminadas.has(f.id)).map(f=>f.id)};
    const registros=new Map();
    for(const r of [...(estado.itens||[]),...(reserva.itens||[])]){
        const key=r.item.fonte.id+'\n'+r.item.dados.url,anterior=registros.get(key);
        if(!anterior?.sonda?.altura||r.sonda?.altura)registros.set(key,r);
    }
    // Reaproveita a prova que chegar tarde, sem congelar a reserva baixa.
    const conferidas=[...registros.values()].filter(r=>{
        if(r.valida===false)return false;
        if(!r.item.lembrada&&!r.item.dados.exigeProva)return true;
        const pt=r.sonda?.padraoPortugues||r.sonda?.portuguesa||r.sonda?.audios?.some(a=>/^(pt|por)(-|$)/i.test(a.lang||''))||require('./provas-idioma').idioma(motor.lerProvasDeIdioma(),motor.chaveDoTitulo(alvo),r.item.fonte.id,r.item.dados)==='pt';
        return pt&&r.sonda?.largura>0&&r.sonda?.altura>0;
    });
    if(conferidas.length&&!conferidas.some(r=>r.item.dados.efemera))cache.set(chave,{resultado,conferidas,expira:Date.now()+1500});
    motor.anotarEscolha(papel,alvo,resultado.escolhido);
    return resultado;
}
async function escolherRodada(papel, alvo, opcoes = {}) {
    if (papel === 'dublado') require('./central-reporter').solicitarIdioma(motor.chaveDoTitulo(alvo));
    const inicio = Date.now();
    // O codec entra na chave: aparelho que só toca AVC e aparelho que toca HEVC
    // não podem compartilhar a mesma decisão guardada.
    const chave = `${papel}:${motor.chaveDoTitulo(alvo)}:${opcoes.codec || ''}:${(opcoes.exceto || []).join(',')}`;
    const guardado = cache.get(chave);
    if (guardado && guardado.expira > Date.now() && !opcoes.semCache && !guardado.conferidas.some(r=>r.item.lembrada||r.item.dados.efemera)) {
        // A sonda pode terminar depois do prazo da primeira abertura. Aproveita
        // essa prova na abertura seguinte, sem prender o título à reserva HD.
        const compativeis=filtrarPorCodec(guardado.conferidas,opcoes.codec);
        if(!compativeis.length)return null;
        const atualizadas = avaliarConferidas(compativeis, motor.lerIdiomasVerificados()[motor.chaveDoTitulo(alvo)] || {}, motor.chaveDoTitulo(alvo));
        const anterior = guardado.resultado.escolhido.fonteId;
        guardado.resultado = resultadoDasAvaliacoes(atualizadas, guardado.resultado.tempoMs);
        if (anterior !== guardado.resultado.escolhido.fonteId) motor.anotarEscolha(papel, alvo, guardado.resultado.escolhido);
        return { ...guardado.resultado, cache: true };
    }

    const fila = (opcoes._fila||motor.filaDeFontes(papel, alvo, { exceto: opcoes.exceto || [] })).slice(0, opcoes.maxFontes || MAX_FONTES);
    if(opcoes._estado)opcoes._estado.fila=fila;
    if (!fila.length) return null;

    // Resolve todas em paralelo — a primeira que responder já garante a reserva.
    const memoria=opcoes.memoria||require('./midias-memoria.cjs'),tituloKey=require('./midias-memoria.cjs').chave(alvo);
    const conhecidas=papel==='dublado'&&!opcoes._semMemoria?memoria.load(tituloKey,fila.filter(f=>!f.efemera).map(f=>f.id)):[];
    const prazoFinal=inicio+(opcoes._orcamento||8000);
    let fontesInconclusivas=false;
    async function conferir(dados,lembrada=false){
        const limiteInicial=Math.max(1,Math.min(lembrada?ORCAMENTO:dados.type==='file'?6000:TEMPO_SONDAR,prazoFinal-Date.now()));
        const gaveta=gavetaDaAltura(alturaDoRotulo(dados.resolucao));
        let prova=await prazo(lembrada?sondarArquivo(dados.url,dados.referer,{timeout:limiteInicial,rapida:true,prioritaria:true,gaveta}):sondar(dados,{timeout:limiteInicial,rapida:dados.type==='file',gaveta}),limiteInicial);
        const restante=prazoFinal-Date.now();
        if((prova?.temporaria||!prova?.indisponivel&&(!prova?.largura||!prova?.altura))&&restante>500&&dados.type==='file'){
            const limite=Math.min(2500,restante);
            prova=await prazo(sondarArquivo(dados.url,dados.referer,{timeout:limite,rapida:true,gaveta}),limite);
        }
        return prova;
    }
    function validar(dados,sonda,lembrada=false){
        if(dados.type==='file')return sonda.then(s=>{
            if(s?.indisponivel)return false;
            // A sonda já leu cabeçalhos reais da mídia. Outra requisição ao
            // gateway não pode invalidar essa prova apenas por um timeout.
            if(s?.largura>0&&s?.altura>0)return true;
            const sobra=Math.max(1,prazoFinal-Date.now());
            return prazo(midia.validarMidia(dados.url,dados.referer,sobra),sobra,false);
        });
        return prazo(midia.validarMidia(dados.url,dados.referer,TEMPO_SONDAR),TEMPO_SONDAR+500,!lembrada);
    }
    const resolvidas=[];
    async function medir(item){
        resolvidas.push(item);
        const restante=Math.max(1,prazoFinal-Date.now());
        [item.prova,item.valida]=await Promise.all([
            prazo(item.sonda,restante),prazo(item.validacao,restante,true)
        ]);
    }
    const lembrarJobs=conhecidas.map(r=>{
        const fonte=fila.find(f=>f.id===r.id),dados=r.dados;
        const sonda=conferir(dados,true);
        return medir({fonte,dados,ms:0,lembrada:true,sonda,validacao:validar(dados,sonda,true)});
    });
    const estadoRodada=opcoes._estado;
    const busca=Promise.all([...lembrarJobs,...fila.map(async fonte=>{
        const comeco=Date.now();
        const consultar=()=>Promise.resolve().then(()=>typeof fonte.resolverTodos==='function'?fonte.resolverTodos(alvo):fonte.resolver(alvo));
        let resposta=await prazo(consultar(),Math.max(1,Math.min(TEMPO_RESOLVER,prazoFinal-Date.now())));
        const vazia=x=>!x||(Array.isArray(x)?!x.some(d=>d?.url):!x.url);
        const restante=prazoFinal-Date.now();
        if(vazia(resposta)&&restante>1500)resposta=await prazo(consultar(),Math.min(2500,Math.floor(restante/2)));
        const opcoes=(Array.isArray(resposta)?resposta:resposta?[resposta]:[]).slice().sort((a,b)=>alturaDoRotulo(b?.resolucao)-alturaDoRotulo(a?.resolucao));
        if(estadoRodada)estadoRodada.respostas.set(fonte.id,opcoes.filter(d=>d?.url));
        if(!opcoes.length)fontesInconclusivas=true;
        const ms=Date.now()-comeco;
        let terminou=true;
        for(const dados of opcoes.filter(dados=>dados?.url)){
            if(Date.now()>=prazoFinal){terminou=false;break;}
            const sonda=conferir(dados);
            await medir({fonte,dados,ms,sonda,validacao:validar(dados,sonda)});
        }
        if(estadoRodada&&terminou)estadoRodada.terminadas.add(fonte.id);
    })]);
    // Não descarta uma consulta aos 3,5s: ela pode ser justamente o HD/4K.
    // Tudo que terminar cedo libera a abertura imediatamente. Só o trabalho
    // pendente é elegível à segunda rodada, dentro do teto total de doze segundos.
    await prazo(busca,Math.max(1,prazoFinal-Date.now()));
    if(!resolvidas.length)return null;
    const idiomas=motor.lerIdiomasVerificados()[motor.chaveDoTitulo(alvo)]||{};
    const registros=resolvidas.map(item=>({item,sonda:item.prova||null,valida:item.valida!==false}));
    if(opcoes._estado)opcoes._estado.itens=registros;
    if(papel==='dublado')memoria.update(tituloKey,registros.map(r=>({id:r.item.fonte.id,dados:r.item.dados,sonda:r.sonda,invalida:!r.valida})));
    const conferidas=registros
        .filter(registro => {
            const audioConfirmado=registro.sonda?.padraoPortugues||registro.sonda?.portuguesa||registro.sonda?.audios?.some(a=>/^(pt|por)(-|$)/i.test(a.lang||''))||require('./provas-idioma').idioma(motor.lerProvasDeIdioma(),tituloKey,registro.item.fonte.id,registro.item.dados)==='pt';
            if((registro.item.lembrada||registro.item.dados.exigeProva)&&(!audioConfirmado||!registro.sonda?.largura||!registro.sonda?.altura))return false;
            if (registro.valida) return true;
            if(!registro.item.lembrada)try { motor.registrarFalha(registro.item.fonte.id, 'o endereço não entrega vídeo', `dublado:${motor.chaveDoTitulo(alvo)}`); } catch { /* segue */ }
            return false;
        });
    if (!conferidas.length) return null;

    // Codec pedido pelo aparelho. O WebView do APK não toca HEVC em arquivo
    // direto e não pede a versão compatível sozinho, então um 4K HEVC ali vira
    // tela de erro. Quando o pedido é AVC, a fonte medida em HEVC sai da
    // disputa — melhor 1080p H.264 tocando do que 4K que não abre.
    const compativeis=filtrarPorCodec(conferidas,opcoes.codec);
    if(!compativeis.length)return null;
    const avaliacoes = avaliarConferidas(compativeis, idiomas, motor.chaveDoTitulo(alvo));
    if(opcoes._estado)opcoes._estado.avaliacoes=avaliacoes;
    const resultado = resultadoDasAvaliacoes(avaliacoes, Date.now() - inicio);
    motor.registrarSucesso(resultado.escolhido.fonteId);
    motor.anotarEscolha(papel, alvo, resultado.escolhido);
    if (cache.size >= 256 && !cache.has(chave)) cache.delete(cache.keys().next().value);
    const incompleta=gavetaDaAltura(alturaDoRotulo(resultado.escolhido.resolucao))<5||fontesInconclusivas||registros.some(r=>!r.sonda?.largura||!r.sonda?.altura);
    if(!registros.some(r=>r.item.dados.efemera))cache.set(chave, { resultado, conferidas, expira: Date.now() + (incompleta?1500:VALIDADE) });
    return resultado;
}

function limparCache() { ++versaoMedicoes; cache.clear(); medidasDeArquivo.clear(); medicoesEmCurso.clear(); }

module.exports = { escolherMelhor, sondar, sondarLista, sondarArquivo, analisarPlaylist, notaDaFonte, prioridadeDaFonte, compararPrioridade, gavetaDaAltura, limparCache, MAX_FONTES, ORCAMENTO };
