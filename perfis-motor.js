'use strict';
// Motor de fichas de fonte — o coração do caçador.
//
// Antes, cada fornecedor novo precisava de um arquivo de código escrito à mão
// para o aplicativo conseguir tocar. Agora o fornecedor é uma FICHA (dados):
//
//   {
//     "id": "exemplo",
//     "nome": "Exemplo · dublado",
//     "nota": 8.4, "dublado": true, "qualidade": "1080p",
//     "tipos": ["movie", "tv"],
//     "urlMovie": "https://site/filme/{id}",
//     "urlTv": "https://site/serie/{id}/{temporada}/{episodio}",
//     "referer": "https://site/",
//     "passos": [ { "tipo": "regex", "padrao": "file:\"([^\"]+)\"", "grupo": 1 } ]
//   }
//
// Cada passo lê um texto (a página, ou o resultado do passo anterior) e tira
// dele o endereço do vídeo. O caçador descobre esses passos medindo a fonte de
// verdade; esta biblioteca só executa a ficha, tanto no computador quanto no
// aplicativo do celular (é o mesmo JavaScript nos dois).

const REGRA_PADRAO = { tipo: 'regex', grupo: 1 };

// Serve no computador (Buffer) e no navegador (atob) — o mesmo arquivo roda nos
// dois lugares.
function decodificarBase64(texto) {
    try {
        if (typeof Buffer !== 'undefined') return Buffer.from(String(texto), 'base64').toString('utf8');
        if (typeof atob === 'function') return decodeURIComponent(escape(atob(String(texto))));
    } catch { /* texto inválido */ }
    return '';
}

function ehEnderecoSeguro(valor) {
    try {
        const url = new URL(String(valor));
        if (url.protocol !== 'https:') return false;
        if (url.username || url.password) return false;
        const host = url.hostname.toLowerCase();
        if (host === 'localhost' || host.endsWith('.local')) return false;
        if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host)) return false;
        if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false;
        if (host === '[::1]' || host === '::1') return false;
        return true;
    } catch { return false; }
}

// O referenciador segue como cabeçalho HTTP. Aceita só um endereço público
// HTTPS sem espaços/controles, credenciais ou endereço da rede interna.
function refererSeguro(valor) {
    if (typeof valor !== 'string' || /[\u0000-\u0020\u007f]/.test(valor)) return '';
    return ehEnderecoSeguro(valor) ? valor : '';
}

function preencher(modelo, alvo) {
    return String(modelo || '')
        .replace(/\{id\}/g, encodeURIComponent(String(alvo.tmdbId || '')))
        .replace(/\{temporada\}/g, encodeURIComponent(String(alvo.temporada || '1')))
        .replace(/\{episodio\}/g, encodeURIComponent(String(alvo.episodio || '1')))
        .replace(/\{imdb\}/g, encodeURIComponent(String(alvo.imdb || '')));
}

function valorNoCaminho(texto, caminho) {
    try {
        const dados = JSON.parse(texto);
        return String(caminho || '').split('.').reduce((atual, parte) => {
            if (atual == null) return null;
            const lista = /^([^[\]]*)\[(\d+)\]$/.exec(parte);
            if (lista) {
                const nome = lista[1];
                const raiz = nome ? atual[nome] : atual;
                return raiz == null ? null : raiz[Number(lista[2])];
            }
            return atual[parte];
        }, dados) || '';
    } catch { return ''; }
}

// Muitas páginas escrevem o endereço dentro de JavaScript/JSON, onde a barra
// sai escapada ("https:\/\/host\/filme.m3u8"). Aqui volta ao normal.
function desescaparBarra(valor) {
    return String(valor || '').replace(/\\\//g, '/');
}

// Aplica UM passo de leitura sobre um texto.
function aplicarPasso(passo, texto, base) {
    if (!passo) return '';
    const tipo = String(passo.tipo || 'regex');
    // Passo de endereço não depende de texto nenhum: a ficha já sabe o molde.
    if (tipo === 'endereco') return String(passo.url || '');
    if (!texto) return '';
    if (tipo === 'json') return valorNoCaminho(texto, passo.caminho);
    if (tipo === 'texto') {
        // A fonte entrega o endereço cru (às vezes dentro de aspas).
        const limpo = desescaparBarra(String(texto).trim().replace(/^["']|["']$/g, ''));
        return limpo.startsWith('http') ? limpo : '';
    }
    if (tipo === 'atributo') {
        // Um endereço guardado num atributo HTML: data-src="...", src="..."
        const nome = String(passo.atributo || 'src').replace(/[^a-z0-9-]/gi, '');
        const achado = new RegExp(nome + '=["\']([^"\']+)["\']', 'i').exec(texto);
        return achado ? desescaparBarra(achado[1]) : '';
    }
    // regra padrão: expressão regular com grupo de captura
    let padrao = String(passo.padrao || '');
    if (!padrao) return '';
    let achado = null;
    try { achado = new RegExp(padrao, passo.ignorarCaixa === false ? '' : 'i').exec(texto); } catch { return ''; }
    if (!achado) return '';
    const grupo = Number.isFinite(Number(passo.grupo)) ? Number(passo.grupo) : REGRA_PADRAO.grupo;
    const achadoTexto = desescaparBarra(achado[grupo] || '');
    if (!achadoTexto) return '';
    const limpo = passo.decodificar === 'base64'
        ? decodificarBase64(achadoTexto)
        : achadoTexto;
    if (passo.juntarComBase && base && !/^https?:/i.test(limpo)) return new URL(limpo, base).toString();
    if (passo.prefixo && !/^https?:/i.test(limpo)) return String(passo.prefixo) + limpo;
    return limpo;
}

function perfisValidos(perfis) {
    const lista = Array.isArray(perfis) ? perfis : (perfis && Array.isArray(perfis.perfis) ? perfis.perfis : []);
    return lista.filter(p => p && p.id && p.ativo !== false);
}

// A ficha serve para este título? (filme x série, e idioma exigido)
function serve(perfil, alvo, papel) {
    const tipos = Array.isArray(perfil.tipos) ? perfil.tipos : ['movie', 'tv'];
    const tipo = alvo.tipo === 'tv' ? 'tv' : 'movie';
    if (!tipos.includes(tipo)) return false;
    const modelo = tipo === 'tv' ? perfil.urlTv : perfil.urlMovie;
    if (!modelo) return false;
    if (papel && perfil.papel && perfil.papel !== papel) return false;
    if (papel === 'dublado' && perfil.dublado === false) return false;
    return true;
}

function ordenar(perfis, alvo, papel) {
    return perfisValidos(perfis)
        .filter(p => serve(p, alvo, papel))
        .sort((a, b) => (Number(b.nota) || 0) - (Number(a.nota) || 0));
}

// Executa a ficha: monta o endereço, lê a página e segue os passos até o vídeo.
// `buscar(endereco, referer)` devolve o texto da resposta (o computador usa
// axios; o aplicativo usa um buscador nativo que também manda o referenciador).
async function resolver(perfil, alvo, { buscar, referer = '' } = {}) {
    if (!perfil || typeof buscar !== 'function') return null;
    const tipo = alvo.tipo === 'tv' ? 'tv' : 'movie';
    const modelo = tipo === 'tv' ? perfil.urlTv : perfil.urlMovie;
    if (!modelo) return null;
    let endereco = preencher(modelo, alvo);
    if (!ehEnderecoSeguro(endereco)) return null;
    const referencia = refererSeguro(perfil.referer);
    const base = referencia || endereco;
    const passos = Array.isArray(perfil.passos) && perfil.passos.length ? perfil.passos : [REGRA_PADRAO];
    let texto = '';
    // Quando o primeiro passo é de ENDEREÇO, a ficha já sabe para onde ir: não
    // precisa baixar a página do título antes (economiza uma requisição).
    if (String(passos[0].tipo || 'regex') !== 'endereco') {
        try { texto = String(await buscar(endereco, refererSeguro(referer) || referencia) || ''); }
        catch { return null; }
        if (!texto) return null;
    }
    let video = '';
    for (let i = 0; i < passos.length; i++) {
        const original = passos[i];
        // Passo de endereço já traz o molde da chamada: aqui ele é preenchido
        // com o título (filme/episódio) antes de ser usado.
        const passo = original && original.tipo === 'endereco'
            ? { ...original, url: preencher(original.url, alvo) }
            : original;
        const achado = aplicarPasso(passo, texto, base);
        if (!achado) return null;
        const ultimo = i === passos.length - 1;
        if (ultimo) { video = achado; break; }
        // O resultado intermediário é outra página: busca e continua.
        let seguinte = achado;
        if (!/^https?:/i.test(seguinte)) { try { seguinte = new URL(seguinte, base).toString(); } catch { return null; } }
        if (/^http:\/\//i.test(seguinte)) seguinte = seguinte.replace(/^http:\/\//i, 'https://');
        if (!ehEnderecoSeguro(seguinte)) return null;
        try { texto = String(await buscar(seguinte, base) || ''); } catch { return null; }
        if (!texto) return null;
    }
    if (!/^https?:/i.test(video)) { try { video = new URL(video, base).toString(); } catch { return null; } }
    // Alguns fornecedores entregam o endereço em http:// e o aplicativo exige
    // https (o WebView bloqueia mistura de protocolo). O mesmo endereço resolve
    // em https na maioria dos casos; a validação confirma antes de ativar.
    if (/^http:\/\//i.test(video)) video = video.replace(/^http:\/\//i, 'https://');
    if (!ehEnderecoSeguro(video)) return null;
    return {
        url: video,
        referer: referencia || base,
        fonte: perfil.nome || perfil.id,
        fonteId: perfil.id,
        audio: perfil.dublado === true ? 'pt-BR' : perfil.dublado === false ? 'original' : 'desconhecido',
        resolucao: perfil.qualidade || '',
        type: /\.m3u8(\?|$)/i.test(video) ? 'hls' : 'file',
        perfil: true,
    };
}

// Addons podem listar HD antes de 4K. A posição não é evidência de qualidade.
async function resolverTodos(perfil,alvo,opcoes={}) {
    const passos=perfil?.passos;
    if(!Array.isArray(passos)||passos.length!==1||passos[0].tipo!=='json'||passos[0].caminho!=='streams[0].url'){
        const unica=await resolver(perfil,alvo,opcoes);return unica?[unica]:[];
    }
    const endpoint=preencher(alvo.tipo==='tv'?perfil.urlTv:perfil.urlMovie,alvo),ref=refererSeguro(perfil.referer)||endpoint;
    if(!ehEnderecoSeguro(endpoint)||typeof opcoes.buscar!=='function')return [];
    let streams;try{streams=JSON.parse(await opcoes.buscar(endpoint,ref)).streams;}catch{return [];}
    const seen=new Set(),lista=[];
    for(const stream of Array.isArray(streams)?streams:[]){
        const label=String(stream?.name||'')+' '+String(stream?.title||'');
        if(/\b(cam|hdcam|ts|telesync)\b/i.test(label)||!(/\b(dublado|dual(?:[ -]?[áa]udio)?)\b|🇧🇷/i.test(label))||(/\blegendado\b/i.test(label)&&!(/\bdual\b/i.test(label))))continue;
        const url=String(stream.url||'').replace(/^http:/i,'https:');if(!ehEnderecoSeguro(url)||seen.has(url))continue;
        const path=new URL(url).pathname,hls=/\.m3u8$/i.test(path),file=/\.mp4$/i.test(path),opaque=!/\.[a-z0-9]{1,5}$/i.test(path);
        if(!hls&&!file&&!opaque)continue;seen.add(url);
        const h=/\b(\d{3,4})p\b/i.exec(label),height=/\b(4k|uhd)\b/i.test(label)?2160:h?Number(h[1]):0;
        lista.push({url,referer:ref,fonte:(perfil.nome||perfil.id)+' · '+String(stream.name||'Dublado'),fonteId:perfil.id,audio:'pt-BR',type:hls?'hls':'file',resolucao:height?height+'p':'',perfil:true,exigeProva:opaque});
    }
    return lista.sort((a,b)=>parseInt(b.resolucao||0)-parseInt(a.resolucao||0)).slice(0,8);
}
module.exports = {
    resolver, resolverTodos, ordenar, serve, preencher, aplicarPasso, perfisValidos, ehEnderecoSeguro, refererSeguro, valorNoCaminho,
};
