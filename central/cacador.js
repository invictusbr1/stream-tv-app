'use strict';
// Caçador de fornecedores da central — agora por categoria.
//
// Ele testa cada fonte de verdade (usando o mesmo motor do aplicativo) numa
// amostra de títulos e dá uma NOTA DE 0 A 10 seguindo as regras do projeto:
//
//   dublado (3,0) + sem anúncio (2,0) + qualidade HD/Full HD (2,0)
//   + sucesso nas amostras (2,0) + velocidade (1,0)
//
// Categorias: Filmes, Séries, Animes, Doramas e TV ao vivo.
// Na TV ao vivo a régua muda um pouco (não existe "dublado"): conta quantos
// canais respondem, se a lista é limpa, a qualidade e a velocidade.

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const motor = require('../fontes-motor');
const midia = require('../midia-proxy');
const { verificarIdioma } = require('./verificar-midia');
const { tocarNoNavegador } = require('./verificar-navegador');
const varredor = require('./varredor');

// A chave da IA (Whisper) vem do ambiente, da configuração da central ou do
// arquivo que o aplicativo já usa — tudo local, nada de serviço novo.
function chaveDaIA() {
    if (process.env.GROQ_API_KEY) return process.env.GROQ_API_KEY.trim();
    const tentativas = [
        path.join(__dirname, 'config.local.json'),
        path.join(require('os').homedir(), 'OneDrive', 'Área de Trabalho', 'api.txt'),
        path.join(require('os').homedir(), 'Desktop', 'api.txt'),
    ];
    for (const arquivo of tentativas) {
        try {
            const achado = fs.readFileSync(arquivo, 'utf8').match(/gsk_[A-Za-z0-9_-]{20,}/);
            if (achado) return achado[0];
        } catch { /* tenta o próximo */ }
    }
    return '';
}

// ---------------------------------------------------------------- categorias
const CATEGORIAS = [
    {
        id: 'filme', nome: 'Filmes', tipo: 'movie',
        amostras: [
            { id: '27205', titulo: 'A Origem' },
            // O título que revelou a fonte que dizia "dublado" e entregava o
            // idioma original — fica na amostra fixa para nunca mais passar.
            { id: '921', titulo: 'A Luta pela Esperança' },
            { id: '1523145', titulo: 'Coração Partido' },
            { id: '693134', titulo: 'Duna: Parte 2' },
            { id: '1022789', titulo: 'Divertida Mente 2' },
            { id: '872585', titulo: 'Oppenheimer' },
            { id: '533535', titulo: 'Deadpool & Wolverine' }
        ],
        candidatas: [
            { nome: 'WatchPlay', url: 'https://v2.watchplay.shop/movie/27205', motivoEsperado: 'fonte dublada principal' },
            { nome: 'PipocaCine', url: 'https://pipocacine.lat/embed/27205', motivoEsperado: 'arquivo dublado de filme' },
            { nome: 'Vixsrc', url: 'https://vixsrc.to/movie/27205', motivoEsperado: 'alta definição com legenda' },
            { nome: 'VidSrc', url: 'https://vidsrc.to/embed/movie/27205', motivoEsperado: 'Full HD de lançamento' },
            { nome: 'VidLink', url: 'https://vidlink.pro/movie/27205', motivoEsperado: 'só áudio original' },
            { nome: 'SuperFlix', url: 'https://superflixapi.monster/filme/27205', motivoEsperado: 'verificação e anúncio' },
            { nome: 'StreamBetter', url: 'https://streambetter.shop/filme/27205', motivoEsperado: 'verificação e anúncio' },
            { nome: 'NetMirror', url: 'https://net27.cc/', motivoEsperado: 'sem faixa dublada em português' },
            { nome: '4KHDHub', url: 'https://4khdhub.one/', motivoEsperado: 'sem dublado em português' },
            { nome: 'PobreFlix', url: 'https://pobreflixhd.sbs/', motivoEsperado: 'player só abre com navegador' },
            { nome: 'RedeCanais', url: 'https://redecanais20.lat/', motivoEsperado: 'player só abre com navegador' },
            { nome: 'YouCine', url: 'https://youcinehd.lat/', motivoEsperado: 'catálogo com anúncio' },
            { nome: 'Cinerave (banco Firebase)', url: 'https://cinexrave-default-rtdb.firebaseio.com/.json', motivoEsperado: 'banco fechado: quando abrir, vira fonte' },
            { nome: 'MGEB (via BRFlix)', url: 'https://mgeb.top/embed/27205', motivoEsperado: 'já implementado como 2ª opção dublada' }
        ]
    },
    {
        id: 'serie', nome: 'Séries', tipo: 'tv',
        amostras: [
            { id: '1399', temporada: '1', episodio: '1', titulo: 'Game of Thrones 1x1' },
            { id: '100088', temporada: '1', episodio: '1', titulo: 'The Last of Us 1x1' },
            { id: '76479', temporada: '1', episodio: '1', titulo: 'The Boys 1x1' },
            { id: '119051', temporada: '1', episodio: '1', titulo: 'Wandinha 1x1' },
            { id: '66732', temporada: '1', episodio: '1', titulo: 'Stranger Things 1x1' },
            { id: '1396', temporada: '1', episodio: '1', titulo: 'Breaking Bad 1x1' }
        ],
        candidatas: [
            { nome: 'WatchPlay', url: 'https://v2.watchplay.shop/tvshow/1399/1/1', motivoEsperado: 'fonte dublada principal' },
            { nome: 'PipocaCine', url: 'https://pipocacine.lat/media/tv?id=1399&s=1&e=1', motivoEsperado: 'episódio dublado em arquivo' },
            { nome: 'Vixsrc', url: 'https://vixsrc.to/tv/1399/1/1', motivoEsperado: 'alta definição com legenda' },
            { nome: 'VidSrc', url: 'https://vidsrc.to/embed/tv/1399/1/1', motivoEsperado: 'Full HD de lançamento' },
            { nome: 'StreamBetter', url: 'https://streambetter.shop/serie/1399/1/1', motivoEsperado: 'verificação e anúncio' },
            { nome: 'SuperFlix', url: 'https://superflixapi.monster/serie/1399/1/1', motivoEsperado: 'verificação e anúncio' },
            { nome: 'RedeCanais', url: 'https://redecanais20.lat/', motivoEsperado: 'player só abre com navegador' },
            { nome: 'Doramogo', url: 'https://www.doramogo.net/', motivoEsperado: 'catálogo de dorama, não de série' }
        ]
    },
    {
        id: 'anime', nome: 'Animes', tipo: 'tv',
        amostras: [
            { id: '95479', temporada: '1', episodio: '1', titulo: 'Jujutsu Kaisen 1x1' },
            { id: '85937', temporada: '1', episodio: '1', titulo: 'Demon Slayer 1x1' },
            { id: '1429', temporada: '1', episodio: '1', titulo: 'Attack on Titan 1x1' },
            { id: '37854', temporada: '1', episodio: '1', titulo: 'One Piece 1x1' },
            { id: '31910', temporada: '1', episodio: '1', titulo: 'Naruto Shippuden 1x1' },
            { id: '62715', temporada: '1', episodio: '1', titulo: 'Dragon Ball Super 1x1' }
        ],
        candidatas: [
            { nome: 'WatchPlay', url: 'https://v2.watchplay.shop/tvshow/95479/1/1', motivoEsperado: 'fonte dublada principal' },
            { nome: 'PipocaCine', url: 'https://pipocacine.lat/media/tv?id=95479&s=1&e=1', motivoEsperado: 'anime dublado em arquivo' },
            { nome: 'AnimesOnlineCC', url: 'https://animesonlinecc.to/', motivoEsperado: 'anúncios na página' },
            { nome: 'AnimesDigital', url: 'https://animesdigital.org/', motivoEsperado: 'anúncios na página' },
            { nome: 'Dattebayo BR', url: 'https://www.dattebayo-br.com/anime-dublado', motivoEsperado: 'catálogo de busca; episódio só no site' },
            { nome: 'AnimeFire', url: 'https://animefire.io/', motivoEsperado: 'player só abre com navegador' },
            { nome: 'AnimesRoll', url: 'https://animesroll.com/', motivoEsperado: 'domínio sem conteúdo' }
        ]
    },
    {
        id: 'dorama', nome: 'Doramas e novelas', tipo: 'tv',
        amostras: [
            { id: '93405', temporada: '1', episodio: '1', titulo: 'Round 6 1x1' },
            { id: '86031', temporada: '1', episodio: '1', titulo: 'Crash Landing on You 1x1' },
            { id: '96162', temporada: '1', episodio: '1', titulo: 'Itaewon Class 1x1' },
            { id: '106648', temporada: '1', episodio: '1', titulo: 'Vincenzo 1x1' },
            { id: '110316', temporada: '1', episodio: '1', titulo: 'Alice in Borderland 1x1' },
            { id: '71446', temporada: '1', episodio: '1', titulo: 'La Casa de Papel 1x1' }
        ],
        candidatas: [
            { nome: 'WatchPlay', url: 'https://v2.watchplay.shop/tvshow/93405/1/1', motivoEsperado: 'fonte dublada principal' },
            { nome: 'PipocaCine', url: 'https://pipocacine.lat/media/tv?id=93405&s=1&e=1', motivoEsperado: 'episódio dublado em arquivo' },
            { nome: 'Doramogo', url: 'https://www.doramogo.net/', motivoEsperado: 'catálogo de busca; episódio só no site' },
            { nome: 'YouCine', url: 'https://youcinehd.lat/', motivoEsperado: 'catálogo com anúncio' },
            { nome: 'PobreFlix', url: 'https://pobreflixhd.sbs/', motivoEsperado: 'player só abre com navegador' },
            { nome: 'RedeCanais', url: 'https://redecanais20.lat/', motivoEsperado: 'player só abre com navegador' }
        ]
    },
    {
        id: 'tv-online', nome: 'TV ao vivo', tipo: 'live',
        // Aqui não são títulos: são listas de canais ao vivo.
        listas: [
            { nome: 'IPTV-org · canais do Brasil', url: 'https://iptv-org.github.io/iptv/countries/br.m3u', semAnuncio: true },
            { nome: 'IPTV-org · canais em português', url: 'https://iptv-org.github.io/iptv/languages/por.m3u', semAnuncio: true },
            { nome: 'IPTV-org · América Latina', url: 'https://iptv-org.github.io/iptv/regions/latam.m3u', semAnuncio: true },
            { nome: 'IPTV-org · filmes', url: 'https://iptv-org.github.io/iptv/categories/movies.m3u', semAnuncio: true },
            { nome: 'IPTV-org · séries', url: 'https://iptv-org.github.io/iptv/categories/series.m3u', semAnuncio: true },
            { nome: 'IPTV-org · infantil', url: 'https://iptv-org.github.io/iptv/categories/kids.m3u', semAnuncio: true },
            { nome: 'IPTV-org · animação', url: 'https://iptv-org.github.io/iptv/categories/animation.m3u', semAnuncio: true },
            { nome: 'IPTV-org · música', url: 'https://iptv-org.github.io/iptv/categories/music.m3u', semAnuncio: true },
            { nome: 'IPTV-org · documentários', url: 'https://iptv-org.github.io/iptv/categories/documentary.m3u', semAnuncio: true },
            { nome: 'IPTV-org · ciência', url: 'https://iptv-org.github.io/iptv/categories/science.m3u', semAnuncio: true },
            { nome: 'IPTV-org · cultura', url: 'https://iptv-org.github.io/iptv/categories/culture.m3u', semAnuncio: true },
            { nome: 'IPTV-org · comédia', url: 'https://iptv-org.github.io/iptv/categories/comedy.m3u', semAnuncio: true },
            { nome: 'IPTV-org · família', url: 'https://iptv-org.github.io/iptv/categories/family.m3u', semAnuncio: true },
            { nome: 'IPTV-org · viagens', url: 'https://iptv-org.github.io/iptv/categories/travel.m3u', semAnuncio: true },
            { nome: 'IPTV-org · culinária', url: 'https://iptv-org.github.io/iptv/categories/cooking.m3u', semAnuncio: true },
            { nome: 'IPTV-org · previsão do tempo', url: 'https://iptv-org.github.io/iptv/categories/weather.m3u', semAnuncio: true },
            { nome: 'IPTV-org · esportes', url: 'https://iptv-org.github.io/iptv/categories/sports.m3u', semAnuncio: true },
            { nome: 'IPTV-org · notícias', url: 'https://iptv-org.github.io/iptv/categories/news.m3u', semAnuncio: true },
            { nome: 'IPTV-org · mundo (todas as listas)', url: 'https://iptv-org.github.io/iptv/index.m3u', semAnuncio: true }
        ],
        candidatas: [
            { nome: 'IPTV-org (listas de canais)', url: 'https://iptv-org.github.io/iptv/index.m3u', motivoEsperado: 'listas públicas de canais, sem anúncio' },
            { nome: 'Pluto TV Brasil', url: 'https://pluto.tv/br/', motivoEsperado: 'precisa de aplicativo para assistir' },
            { nome: 'Samsung TV Plus', url: 'https://www.samsung.com/br/tvplus/', motivoEsperado: 'precisa de aparelho Samsung' },
            { nome: 'Canais de IPTV pagos', url: 'https://duckduckgo.com/?q=iptv+brasil+lista', motivoEsperado: 'cobrança e risco de anúncio/vírus' }
        ]
    }
];

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const TEMPO = 20000;

// Fontes que JÁ estão dentro do aplicativo (e as que já foram descartadas pela
// avaliação). Serve para o caçador sinalizar e ninguém acabar cadastrando de
// novo o que já existe.
const JA_NO_APP = [
    { nome: 'WatchPlay', dominios: ['watchplay.shop', 'hclod.qzz.io'], papel: 'dublado · filmes e séries' },
    { nome: 'PipocaCine', dominios: ['pipocacine.lat', 'nixplay.lat'], papel: 'dublado · filme e episódios' },
    { nome: 'FenixFlix (Hollymovies)', dominios: ['fenixhub.online', 'embedplayer2.xyz', 'firevideoplayer.com'], papel: 'dublado · filmes (lista HLS 720p)' },
    { nome: 'Vixsrc', dominios: ['vixsrc.to', 'mistyreef77.boats'], papel: 'alta definição com legenda' },
    { nome: 'VidSrc', dominios: ['vidsrc.sh', 'vidsrc.xyz', 'vidsrc.net', 'vidsrc.to', 'vidsrc.me'], papel: 'Full HD de lançamento' }
];

function fonteJaImplementada(nome, url) {
    const alvo = String(url || '').toLowerCase();
    const procurado = String(nome || '').toLowerCase();
    return JA_NO_APP.find(item => item.dominios.some(d => alvo.includes(d)) || procurado.includes(item.nome.toLowerCase())) || null;
}

function comPrazo(promessa, ms) {
    return Promise.race([promessa, new Promise(resolve => setTimeout(() => resolve({ __tempo: true }), ms))]);
}
function ehDublado(valor) {
    return /pt-br|ptbr|portugu|dubl/i.test(String(valor || ''));
}
function alturaDe(valor) {
    const achado = String(valor || '').match(/(\d{3,4})p?/);
    return achado ? Number(achado[1]) : 0;
}
function categoriaDe(id) {
    return CATEGORIAS.find(c => c.id === id) || CATEGORIAS[0];
}

// ---------------------------------------------------------------- padrão do app
// É o mínimo que uma fonte precisa para entrar (ou continuar) no Conecta TV.
// Tudo que ficar abaixo disso é descartado ou fica como segunda opção.
const PADRAO_APP = {
    alturaMinima: 720,      // HD para cima
    taxaSucesso: 50,        // metade dos títulos de teste precisa abrir
    taxaDublado: 50,        // metade dos que abriram precisa estar dublado
    notaMinima: 7,          // nota de aprovação
    notaSegundaOpcao: 4     // abaixo disso, descarta
};

// Decide o destino de cada fonte: manter, promover, segunda opção ou descartar.
function avaliarPromocao(item, padrao = PADRAO_APP) {
    const d = item.detalhes || {};
    const testes = Number(d.testes) || 0;
    const sucessos = Number(d.sucessos) || 0;
    const dublados = Number(d.dublados) || 0;
    const altura = alturaDe(d.melhorQualidade);
    const taxaDublado = sucessos ? Math.round((dublados / sucessos) * 100) : 0;
    const nota = Number(item.nota) || 0;
    const aoVivo = item.papel === 'tv ao vivo';

    if (item.situacao === 'descartada') return { decisao: 'descartar', motivo: item.motivo || 'não passou na avaliação', noApp: Boolean(item.noApp) };
    if (item.situacao === 'já implementada') return { decisao: 'manter', motivo: 'já está no aplicativo', noApp: true };

    // Fonte que já está no app nunca é "descartada" por uma rodada ruim: ela
    // vira segunda opção, porque continua útil quando a principal falha.
    if (!testes) return { decisao: item.noApp ? 'segunda opcao' : 'descartar', motivo: 'não deu para medir nesta rodada — fica como segunda opção', noApp: Boolean(item.noApp) };
    if ((d.taxaSucesso || 0) < padrao.taxaSucesso / 2) {
        return {
            decisao: item.noApp ? 'segunda opcao' : 'descartar',
            motivo: `abriu só ${d.taxaSucesso || 0}% dos títulos nesta rodada` + (item.noApp ? ' — mantida como segunda opção' : ''),
            noApp: Boolean(item.noApp)
        };
    }

    // Na TV ao vivo não existe dublado: a régua é canais + qualidade + resposta.
    const dubladoOk = aoVivo || taxaDublado >= padrao.taxaDublado;
    const qualidadeOk = altura >= padrao.alturaMinima;
    const sucessoOk = (d.taxaSucesso || 0) >= padrao.taxaSucesso;

    if (nota >= padrao.notaMinima && dubladoOk && qualidadeOk && sucessoOk) {
        return item.noApp
            ? { decisao: 'manter', motivo: `padrão do app atendido (nota ${nota}, ${d.melhorQualidade}, dublado ${taxaDublado}%)`, noApp: true }
            : { decisao: 'promover', motivo: `melhor que o padrão atual em avaliação (nota ${nota}, ${d.melhorQualidade}${aoVivo ? '' : ', dublado ' + taxaDublado + '%'})`, noApp: false };
    }
    if (!dubladoOk) return { decisao: item.noApp ? 'segunda opcao' : 'descartar', motivo: aoVivo ? 'sem canais suficientes' : `só ${taxaDublado}% em português — fica abaixo do padrão dublado`, noApp: Boolean(item.noApp) };
    if (!qualidadeOk) return { decisao: item.noApp ? 'segunda opcao' : 'descartar', motivo: `qualidade abaixo do padrão (${d.melhorQualidade || 'sem resolução medida'} contra ${padrao.alturaMinima}p do app)`, noApp: Boolean(item.noApp) };
    if (nota >= padrao.notaSegundaOpcao) return { decisao: item.noApp ? 'segunda opcao' : 'descartar', motivo: `nota ${nota} abaixo de ${padrao.notaMinima} — serve como segunda opção`, noApp: Boolean(item.noApp) };
    return { decisao: 'descartar', motivo: `nota ${nota}: abaixo do padrão do aplicativo`, noApp: Boolean(item.noApp) };
}

// ---------------------------------------------------------------- fontes do aplicativo
async function testarFonte(fonte, amostra, tipo) {
    const alvo = tipo === 'tv'
        ? { tipo: 'tv', tmdbId: amostra.id, temporada: amostra.temporada, episodio: amostra.episodio }
        : { tipo: 'movie', tmdbId: amostra.id };
    if (fonte.seAplica && !fonte.seAplica(alvo)) return { ok: false, ms: 0, amostra: amostra.titulo, pulada: true };
    const inicio = Date.now();
    let dados = null;
    try { dados = await comPrazo(fonte.resolver(alvo), TEMPO); } catch { dados = null; }
    const ms = Date.now() - inicio;
    if (!dados || dados.__tempo || !dados.url) return { ok: false, ms, amostra: amostra.titulo };
    return {
        ok: true, ms, amostra: amostra.titulo,
        // Guardamos o endereço e o referenciador para poder medir o idioma e
        // a reprodução logo em seguida (a verificação acontece sobre o que a
        // fonte realmente entrega).
        url: dados.url,
        referer: (() => { try { return midia.refererPadrao(new URL(dados.url).hostname); } catch { return ''; } })(),
        amostraChave: { id: amostra.id, temporada: amostra.temporada, episodio: amostra.episodio },
        audio: dados.audio || '',
        dublado: ehDublado(dados.audio) || ehDublado(dados.fonte),
        resolucao: dados.resolucao || '',
        altura: alturaDe(dados.resolucao),
        tipo: dados.type || 'hls'
    };
}

function notaDoFornecedor(medidas) {
    const validas = medidas.filter(m => !m.pulada);
    if (!validas.length) return { nota: 0, detalhes: { testes: 0, sucessos: 0, taxaSucesso: 0, dublados: 0, melhorQualidade: '—', latenciaMedia: 0 } };
    const sucesso = validas.filter(m => m.ok);
    const taxa = sucesso.length / validas.length;
    // Dublado com prova: quando o verificador ouviu o áudio, a resposta dele
    // manda. Sem prova, vale o rótulo da fonte.
    const comProva = sucesso.filter(m => m.idioma === 'pt' || m.idioma === 'outro');
    const dubladas = sucesso.filter(m => m.idioma === 'pt' || (m.idioma !== 'outro' && m.dublado)).length;
    const contrariadas = sucesso.filter(m => m.idioma === 'outro' && m.dublado).length;
    const taxaDublado = sucesso.length ? dubladas / sucesso.length : 0;
    const melhorAltura = Math.max(0, ...sucesso.map(m => m.altura || 0));
    const latencia = sucesso.length ? Math.round(sucesso.reduce((soma, m) => soma + m.ms, 0) / sucesso.length) : 0;

    const pSucesso = taxa * 2;
    // Dizer "dublado" e entregar outro idioma é o pior caso: zera o ponto de
    // dublagem (a regra número 1 do projeto).
    const pDublado = contrariadas > 0 && !sucesso.some(m => m.idioma === 'pt') ? 0 : taxaDublado * 3;
    // "Sem anúncio" agora é MEDIDO (varredura da página por redes de anúncio).
    // Antes era um ponto fixo de 2 — qualquer fonte ganhava o ponto mesmo com
    // anúncio na página.
    const comAnuncio = medidas.some(m => (Array.isArray(m.anuncios) && m.anuncios.length) || m.anuncios === true);
    const pSemAnuncio = comAnuncio ? 0 : 2;
    const pQualidade = melhorAltura >= 1080 ? 2 : melhorAltura >= 720 ? 1.4 : melhorAltura > 0 ? 0.6 : 0;
    const pVelocidade = latencia && latencia <= 3000 ? 1 : latencia <= 8000 ? 0.6 : 0.3;
    // Medição que revelou áudio mudo no navegador desconta da nota: o usuário
    // receberia vídeo sem som.
    const comAvisoDeAudio = sucesso.filter(m => m.avisoAudio).length;
    const desconto = comAvisoDeAudio ? Math.min(1.5, comAvisoDeAudio * 0.75) : 0;
    const nota = Math.max(0, Math.min(10, pSucesso + pDublado + pSemAnuncio + pQualidade + pVelocidade - desconto));
    return {
        nota: Math.round(nota * 10) / 10,
        detalhes: {
            testes: validas.length, sucessos: sucesso.length,
            taxaSucesso: Math.round(taxa * 100), dublados: dubladas,
            comProva: comProva.length,
            confirmadosEmPortugues: sucesso.filter(m => m.idioma === 'pt').length,
            contrariados: contrariadas,
            avisosDeAudio: comAvisoDeAudio,
            evidencias: sucesso.filter(m => m.idiomaEvidencia).map(m => ({ amostra: m.amostra, idioma: m.idioma, evidencia: m.idiomaEvidencia })).slice(0, 3),
            semAnuncio: comAnuncio ? 'anúncio encontrado' : 'sem anúncio',
            melhorQualidade: melhorAltura ? melhorAltura + 'p' : '—',
            latenciaMedia: latencia,
            pontos: {
                sucesso: Math.round(pSucesso * 10) / 10, dublado: Math.round(pDublado * 10) / 10,
                semAnuncio: pSemAnuncio, qualidade: Math.round(pQualidade * 10) / 10,
                velocidade: Math.round(pVelocidade * 10) / 10
            }
        }
    };
}

// ---------------------------------------------------------------- candidatas de fora
// Mede um endereço de vídeo direto: reproduz no navegador de verdade, ouve o
// áudio para confirmar o idioma e avisa quando o som sai mudo no navegador.
async function conferirMidiaDireta(candidata) {
    const tipo = /\.m3u8(\?|$)/i.test(candidata.url) ? 'hls' : 'file';
    const titulo = candidata.tituloTeste || 'título de teste';
    try {
        const reproducao = await tocarNoNavegador(candidata.url, { tipo, segundos: 20 }).catch(() => null);
        const prova = await verificarIdioma({
            url: candidata.url, tipo: 'movie',
            fonteId: 'candidata-' + String(candidata.nome).replace(/\W+/g, '-').slice(0, 24),
            amostra: { id: 'tt-' + String(candidata.nome).replace(/\W+/g, '').slice(0, 12), titulo },
            chaveIa: chaveDaIA(), registrar: () => {},
        }).catch(() => null);
        const detalhes = {
            tocou: Boolean(reproducao && reproducao.tocou),
            semRobo: Boolean(reproducao && reproducao.semRobo),
            qualidade: reproducao && reproducao.altura ? reproducao.altura + 'p' : '—',
            ms: reproducao ? reproducao.ms : 0,
            popups: reproducao && reproducao.popups ? reproducao.popups.length : 0,
            anuncios: reproducao && reproducao.anuncios ? reproducao.anuncios : [],
            idioma: prova ? prova.idioma : 'indefinido',
            idiomaEvidencia: prova ? prova.evidencia : '',
            avisoAudio: prova && prova.avisoAudio ? prova.avisoAudio : '',
            amostra: titulo,
        };
        const anunciado = (detalhes.anuncios || []).length > 0 || detalhes.popups > 0;
        let situacao = 'em análise';
        let motivo = 'medida parcial';
        if (!detalhes.tocou && detalhes.semRobo) {
            situacao = detalhes.idioma === 'pt' ? 'promover' : 'em análise';
            motivo = `sem robô de navegador neste modo; áudio: ${detalhes.idioma}${detalhes.avisoAudio ? ' — ' + detalhes.avisoAudio : ''} · ${titulo}`;
        }
        else if (!detalhes.tocou) { situacao = 'descartada'; motivo = 'o vídeo não abriu no navegador' + (reproducao && reproducao.erro ? ' (' + reproducao.erro + ')' : ''); }
        else if (detalhes.avisoAudio) { situacao = 'descartada'; motivo = detalhes.avisoAudio; }
        else if (anunciado) { situacao = 'descartada'; motivo = `abriu, mas chamou rede de anúncio (${detalhes.anuncios.join(', ') || 'pop-up'})`; }
        else if (detalhes.idioma === 'pt') { situacao = 'promover'; motivo = `tocou em ${detalhes.qualidade} com áudio em português confirmado · ${titulo}`; }
        else if (detalhes.idioma === 'outro') { situacao = 'em análise'; motivo = `tocou em ${detalhes.qualidade}, mas o áudio NÃO é português · ${titulo}`; }
        else { situacao = 'em análise'; motivo = `tocou em ${detalhes.qualidade}; idioma não confirmado · ${titulo}`; }
        return { nome: candidata.nome, url: candidata.url, status: 200, situacao, motivo, origem: candidata.origem, esperado: candidata.motivoEsperado, detalhes, nota: situacao === 'promover' ? 8 : situacao === 'em análise' ? 5 : 0 };
    } catch (erro) {
        return { nome: candidata.nome, url: candidata.url, status: 0, situacao: 'descartada', motivo: 'sem resposta (' + String(erro.message).slice(0, 50) + ')', origem: candidata.origem };
    }
}

// Confere um endereço que devolve o vídeo em JSON (addons do Stremio):
// reproduz no navegador de verdade e ouve o áudio para confirmar o idioma.
async function conferirFonteDeStream(candidata) {
    try {
        const resposta = await comPrazo(axios.get(candidata.url, { headers: { 'User-Agent': UA }, timeout: 15000, validateStatus: s => s < 500 }), 16000);
        const streams = resposta && resposta.data && Array.isArray(resposta.data.streams) ? resposta.data.streams : [];
        const primeiro = streams.find(s => s && s.url);
        if (!primeiro) return { nome: candidata.nome, url: candidata.url, status: 200, situacao: 'descartada', motivo: 'não devolveu nenhum vídeo para o título de teste', origem: candidata.origem };
        const tipo = /\.m3u8(\?|$)/i.test(primeiro.url) ? 'hls' : 'file';
        const reproducao = await tocarNoNavegador(primeiro.url, { referer: candidata.url, tipo, segundos: 20 }).catch(() => null);
        const titulo = candidata.tituloTeste || 'título de teste';
        const prova = await verificarIdioma({
            url: primeiro.url, tipo: 'movie', fonteId: 'candidata-' + String(candidata.nome).replace(/\W+/g, '-').slice(0, 24),
            amostra: { id: 'tt-' + String(candidata.nome).replace(/\W+/g, '').slice(0, 12), titulo },
            chaveIa: chaveDaIA(), registrar: () => {},
        }).catch(() => null);
        const detalhes = {
            tocou: Boolean(reproducao && reproducao.tocou),
            semRobo: Boolean(reproducao && reproducao.semRobo),
            qualidade: reproducao && reproducao.altura ? reproducao.altura + 'p' : '—',
            ms: reproducao ? reproducao.ms : 0,
            popups: reproducao && reproducao.popups ? reproducao.popups.length : 0,
            anuncios: reproducao && reproducao.anuncios ? reproducao.anuncios : [],
            idioma: prova ? prova.idioma : 'indefinido',
            idiomaEvidencia: prova ? prova.evidencia : '',
            amostra: titulo,
        };
        const anunciado = (detalhes.anuncios || []).length > 0 || detalhes.popups > 0;
        detalhes.avisoAudio = prova && prova.avisoAudio ? prova.avisoAudio : '';
        let situacao = 'em análise';
        let motivo = 'medida parcial';
        if (!detalhes.tocou && detalhes.semRobo) {
            situacao = detalhes.idioma === 'pt' ? 'promover' : 'em análise';
            motivo = `sem robô de navegador neste modo; áudio: ${detalhes.idioma}${detalhes.avisoAudio ? ' — ' + detalhes.avisoAudio : ''} · ${titulo}`;
        }
        else if (!detalhes.tocou) { situacao = 'descartada'; motivo = 'o vídeo não abriu no navegador' + (reproducao && reproducao.erro ? ' (' + reproducao.erro + ')' : ''); }
        else if (detalhes.avisoAudio) { situacao = 'descartada'; motivo = detalhes.avisoAudio; }
        else if (anunciado) { situacao = 'descartada'; motivo = `abriu, mas chamou rede de anúncio (${detalhes.anuncios.join(', ') || 'pop-up'})`; }
        else if (detalhes.idioma === 'pt') { situacao = 'promover'; motivo = `tocou em ${detalhes.qualidade} com áudio em português confirmado (${detalhes.idiomaEvidencia.slice(0, 60)})`; }
        else if (detalhes.idioma === 'outro') { situacao = 'em análise'; motivo = `tocou em ${detalhes.qualidade}, mas o áudio NÃO é português (${detalhes.idiomaEvidencia.slice(0, 60)})`; }
        else { situacao = 'em análise'; motivo = `tocou em ${detalhes.qualidade}; não consegui confirmar o idioma`; }
        return { nome: candidata.nome, url: candidata.url, status: 200, situacao, motivo, origem: candidata.origem, esperado: candidata.motivoEsperado, detalhes, nota: situacao === 'promover' ? 8 : situacao === 'em análise' ? 5 : 0 };
    } catch (erro) {
        return { nome: candidata.nome, url: candidata.url, status: 0, situacao: 'descartada', motivo: 'sem resposta (' + String(erro.message).slice(0, 50) + ')', origem: candidata.origem };
    }
}

async function conferirCandidata(candidata) {
    // Endereço de vídeo direto (link de addon, CDN, .m3u8/.mp4/.mkv):
    // reproduz no navegador e ouve o áudio.
    if (/\.(m3u8|mp4|mkv|webm)(\?|$)/i.test(candidata.url) || /\/stream\/\d+/i.test(candidata.url)) {
        return conferirMidiaDireta(candidata);
    }
    // Endereço que já entrega o vídeo em JSON (addons do Stremio): dá para
    // medir reprodução e idioma de verdade — é a verificação mais completa.
    if (/\.json(\?|$)/i.test(candidata.url) || /\/stream\//i.test(candidata.url)) {
        return conferirFonteDeStream(candidata);
    }
    const jaExiste = fonteJaImplementada(candidata.nome, candidata.url);
    if (jaExiste) {
        return {
            nome: candidata.nome, url: candidata.url, status: 0, situacao: 'já implementada',
            motivo: `já está dentro do aplicativo (${jaExiste.papel}) — não precisa cadastrar de novo`,
            esperado: candidata.motivoEsperado, noApp: true
        };
    }
    try {
        const resposta = await fetch(candidata.url, {
            headers: { 'User-Agent': UA, 'Accept-Language': 'pt-BR,pt;q=0.9' },
            redirect: 'follow', signal: AbortSignal.timeout(12000)
        });
        const corpo = await resposta.text().catch(() => '');
        const verificacao = /turnstile|hcaptcha|recaptcha|não sou robô|nao sou robo|just a moment|checking your browser/i.test(corpo);
        // Detecção de anúncio com a lista completa de redes (varredor).
        const redesDeAnuncio = require('./varredor').sinaisDeAnuncio(corpo);
        const anuncio = redesDeAnuncio.length > 0;
        const vazio = corpo.length < 800;
        const episodios = (corpo.match(/href="[^"]*(?:episodio|episode)[^"]*"/gi) || []).length;
        const canais = (corpo.match(/#EXTINF/g) || []).length;
        let situacao = 'em análise';
        let motivo = 'não avaliada a fundo';
        if (/firebaseio\.com/i.test(candidata.url)) {
            const negado = /permission denied|Permission denied/i.test(corpo);
            return { nome: candidata.nome, url: candidata.url, status: resposta.status, situacao: negado ? 'descartada' : 'promover', motivo: negado ? 'banco fechado (regras protegidas) — será reconferido na próxima rodada' : 'BANCO ABERTO: catálogo acessível pelo servidor, testar como fonte', esperado: candidata.motivoEsperado };
        }
        if (verificacao) { situacao = 'descartada'; motivo = 'pede verificação no navegador (e traz anúncio)'; }
        else if (anuncio) { situacao = 'descartada'; motivo = 'página com anúncio (' + redesDeAnuncio.slice(0, 3).join(', ') + ') — não atende a regra do app'; }
        else if (vazio) { situacao = 'descartada'; motivo = 'página vazia ou bloqueada'; }
        else if (canais) { situacao = 'boa'; motivo = 'lista de canais ao vivo (' + canais + ' canais), sem anúncio'; }
        else if (episodios) { situacao = 'em análise'; motivo = episodios + ' links de episódio, mas o vídeo não sai direto para o app'; }
        else if (/dublad|portugu/i.test(corpo)) { situacao = 'em análise'; motivo = 'cita dublado, mas o vídeo não é entregue direto ao app'; }
        else { situacao = 'descartada'; motivo = candidata.motivoEsperado; }
        return { nome: candidata.nome, url: candidata.url, status: resposta.status, situacao, motivo, esperado: candidata.motivoEsperado, anuncios: redesDeAnuncio };
    } catch (erro) {
        return {
            nome: candidata.nome, url: candidata.url, status: 0, situacao: 'descartada',
            motivo: 'sem resposta (' + (erro.name === 'TimeoutError' ? 'demorou demais' : String(erro.message).slice(0, 40)) + ')',
            esperado: candidata.motivoEsperado
        };
    }
}

// ---------------------------------------------------------------- TV ao vivo
async function medirListaDeCanais(lista) {
    const inicio = Date.now();
    try {
        const resposta = await fetch(lista.url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) });
        if (!resposta.ok) throw new Error('http ' + resposta.status);
        const texto = await resposta.text();
        const linhas = texto.split('\n').map(l => l.trim());
        const canais = [];
        for (let i = 0; i < linhas.length; i++) {
            if (!/^#EXTINF/i.test(linhas[i])) continue;
            const nome = (linhas[i].match(/,(.*)$/) || [])[1] || 'canal';
            const endereco = linhas[i + 1];
            if (endereco && !endereco.startsWith('#')) canais.push({ nome: nome.trim().slice(0, 60), url: endereco });
        }
        const msLista = Date.now() - inicio;

        // Testa alguns canais de verdade (respondem? qual qualidade?).
        const amostra = [];
        const passo = Math.max(1, Math.floor(canais.length / 8));
        for (let i = 0; i < canais.length && amostra.length < 8; i += passo) amostra.push(canais[i]);
        let responderam = 0, melhorAltura = 0, tempoTotal = 0;
        const exemplos = [];
        for (const canal of amostra) {
            const t0 = Date.now();
            try {
                const r = await fetch(canal.url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(12000) });
                const corpo = await r.text().catch(() => '');
                tempoTotal += Date.now() - t0;
                if (r.ok && corpo.length > 40) {
                    responderam++;
                    const alturas = [...corpo.matchAll(/RESOLUTION=\d+x(\d+)/gi)].map(m => Number(m[1]));
                    const altura = alturas.length ? Math.max(...alturas) : 0;
                    melhorAltura = Math.max(melhorAltura, altura);
                    if (exemplos.length < 4) exemplos.push({ nome: canal.nome, altura, ok: true });
                } else if (exemplos.length < 4) exemplos.push({ nome: canal.nome, altura: 0, ok: false });
            } catch {
                tempoTotal += Date.now() - t0;
                if (exemplos.length < 4) exemplos.push({ nome: canal.nome, altura: 0, ok: false });
            }
        }
        const taxa = amostra.length ? responderam / amostra.length : 0;
        const latencia = amostra.length ? Math.round(tempoTotal / amostra.length) : 0;
        const pCanais = canais.length >= 200 ? 3 : canais.length >= 60 ? 2.2 : canais.length >= 20 ? 1.5 : canais.length ? 0.8 : 0;
        const pSemAnuncio = lista.semAnuncio ? 2 : 0;
        const pQualidade = melhorAltura >= 1080 ? 2 : melhorAltura >= 720 ? 1.4 : melhorAltura > 0 ? 0.6 : 0;
        const pResposta = taxa * 2;
        const pVelocidade = latencia && latencia <= 2500 ? 1 : latencia <= 6000 ? 0.6 : 0.3;
        const nota = Math.max(0, Math.min(10, pCanais + pSemAnuncio + pQualidade + pResposta + pVelocidade));

        return {
            id: lista.url, nome: lista.nome, papel: 'tv ao vivo', nota: Math.round(nota * 10) / 10,
            detalhes: {
                testes: amostra.length, sucessos: responderam, taxaSucesso: Math.round(taxa * 100),
                dublados: canais.length, melhorQualidade: melhorAltura ? melhorAltura + 'p' : '—',
                latenciaMedia: latencia, canais: canais.length, exemplos,
                pontos: {
                    canais: Math.round(pCanais * 10) / 10, semAnuncio: pSemAnuncio,
                    qualidade: Math.round(pQualidade * 10) / 10, sucesso: Math.round(pResposta * 10) / 10,
                    velocidade: Math.round(pVelocidade * 10) / 10
                }
            }
        };
    } catch (erro) {
        return {
            id: lista.url, nome: lista.nome, papel: 'tv ao vivo', nota: 0,
            detalhes: { testes: 0, sucessos: 0, taxaSucesso: 0, dublados: 0, melhorQualidade: '—', latenciaMedia: 0, canais: 0, erro: String(erro.message).slice(0, 60), exemplos: [] }
        };
    }
}

// ---------------------------------------------------------------- execução
function criarCacador(opcoes = {}) {
    const pastaDados = opcoes.pastaDados;
    const registrar = typeof opcoes.registrar === 'function' ? opcoes.registrar : () => {};
    const arquivo = path.join(pastaDados, 'fontes.json');
    const arquivoHistorico = path.join(pastaDados, 'fontes-historico.json');
    let rodando = false;
    let categoriaAtual = '';
    // O varredor é caro (rede + GitHub): roda no máximo a cada 6 horas.
    let varredura = { em: 0, itens: [] };
    async function candidatosVarridos() {
        if (Date.now() - varredura.em < 6 * 60 * 60 * 1000 && varredura.itens.length) return varredura.itens;
        try {
            const token = (() => { try { return fs.readFileSync(path.join(require('os').homedir(), '.streamtv', 'github-token.txt'), 'utf8').trim(); } catch { return ''; } })();
            const itens = await varredor.varrerTudo({ token, registrar });
            varredura = { em: Date.now(), itens };
            registrar(`varredor: ${itens.length} candidato(s) encontrados`);
            return itens;
        } catch (erro) {
            registrar('varredor falhou: ' + String(erro.message).slice(0, 60));
            return varredura.itens;
        }
    }

    // ---------------------------------------------------------- evolução
    // Cada medição é guardada: assim o caçador tem memória, mostra a tendência
    // de cada fonte e rebaixa sozinho quem piora (sem o usuário pedir).
    let historico = {};
    try { historico = JSON.parse(fs.readFileSync(arquivoHistorico, 'utf8')) || {}; } catch { historico = {}; }
    const MAX_MEDICOES = 30;

    function gravarHistorico() {
        try { fs.mkdirSync(pastaDados, { recursive: true }); fs.writeFileSync(arquivoHistorico, JSON.stringify(historico, null, 1)); } catch { /* sem disco */ }
    }
    function anotarMedicao(categoriaId, item) {
        const chave = `${categoriaId}|${item.id || item.nome}`;
        const registro = historico[chave] || { nome: item.nome, categoria: categoriaId, medicoes: [], descoberto: new Date().toISOString(), origem: item.origem || (item.noApp ? 'já no aplicativo' : 'varredura do caçador') };
        registro.medicoes = [...registro.medicoes, { em: new Date().toISOString(), nota: item.nota, situacao: item.detalhes?.taxaSucesso || 0 }].slice(-MAX_MEDICOES);
        registro.ultimaNota = item.nota;
        historico[chave] = registro;
        return registro;
    }
    function evolucaoDe(chave) {
        const registro = historico[chave];
        if (!registro || registro.medicoes.length < 2) return { medicoes: registro ? registro.medicoes.length : 0, tendencia: 'nova', quedasSeguidas: 0, descoberto: registro?.descoberto || '', origem: registro?.origem || '' };
        const notas = registro.medicoes.map(m => Number(m.nota) || 0);
        const atual = notas[notas.length - 1];
        const anteriores = notas.slice(0, -1);
        const mediaAnterior = anteriores.reduce((s, n) => s + n, 0) / anteriores.length;
        let quedas = 0;
        for (let i = notas.length - 1; i > 0; i--) { if (notas[i] < notas[i - 1] - 0.3) quedas++; else break; }
        const variacao = atual - mediaAnterior;
        return {
            medicoes: registro.medicoes.length,
            tendencia: variacao > 0.3 ? 'subindo' : variacao < -0.3 ? 'caindo' : 'estável',
            variacao: Math.round(variacao * 10) / 10,
            quedasSeguidas: quedas,
            descoberto: registro.descoberto,
            origem: registro.origem,
            historico: registro.medicoes.slice(-6).map(m => m.nota)
        };
    }
    function aplicarEvolucao(categoriaId, item) {
        const registro = anotarMedicao(categoriaId, item);
        item.evolucao = evolucaoDe(`${categoriaId}|${item.id || item.nome}`);
        // Ciclo de vida: fonte que já está no app e caiu 2 medições seguidas
        // desce para segunda opção sozinha (nunca é apagada).
        if (item.noApp && item.evolucao.quedasSeguidas >= 2) {
            item.avaliacao = { ...(item.avaliacao || {}), decisao: 'segunda opcao', motivo: `nota caiu ${item.evolucao.quedasSeguidas} medições seguidas — rebaixada automaticamente` };
        }
        return registro;
    }
    function salvarHistorico() { gravarHistorico(); }
    function historicoCompleto() {
        return Object.values(historico)
            .map(r => ({ nome: r.nome, categoria: r.categoria, origem: r.origem, descoberto: r.descoberto, medicoes: r.medicoes.length, ultimaNota: r.ultimaNota, ultimas: r.medicoes.slice(-8).map(m => m.nota) }))
            .sort((a, b) => String(b.descoberto).localeCompare(String(a.descoberto)));
    }

    async function cacarCategoria(categoria) {
        const candidatas = [];
        for (const c of categoria.candidatas || []) candidatas.push(await conferirCandidata(c));
        // Candidatos achados pelo varredor (addons do Stremio, GitHub e o
        // código dos sites) — entram na mesma avaliação das outras fontes.
        try {
            const achados = await candidatosVarridos();
            for (const nova of achados.slice(0, 10)) {
                if (candidatas.some(c => c.url === nova.url)) continue;
                candidatas.push(await conferirCandidata(nova));
            }
        } catch { /* sem varredura nesta rodada */ }

        // TV ao vivo tem régua e teste próprios.
        if (categoria.id === 'tv-online') {
            const ranking = [];
            // As listas do iptv-org ainda NÃO estão dentro do aplicativo: entram
            // como candidatas fortes, com a nota medida.
            for (const lista of categoria.listas || []) {
                const medida = await medirListaDeCanais(lista);
                ranking.push({ ...medida, noApp: false });
            }
            for (const item of ranking) item.avaliacao = avaliarPromocao(item);
            for (const item of ranking) aplicarEvolucao(categoria.id, item);
            salvarHistorico();
            ranking.sort((a, b) => b.nota - a.nota);
            // Fontes do aplicativo saem da lista principal (elas já estão no
            // sistema) e ficam só no resumo de "mantidas".
            const doApp = ranking.filter(i => i.noApp);
            const novos = ranking.filter(i => !i.noApp);
            return {
                id: categoria.id, nome: categoria.nome, atualizadoEm: new Date().toISOString(),
                padrao: PADRAO_APP, ranking: novos, jaNoApp: doApp.map(i => ({ nome: i.nome, nota: i.nota, decisao: (i.avaliacao || {}).decisao, motivo: (i.avaliacao || {}).motivo })),
                candidatas
            };
        }

        const ranking = [];
        for (const fonte of motor.FONTES) {
            const medidas = [];
            for (const amostra of categoria.amostras) {
                const medida = await testarFonte(fonte, amostra, categoria.tipo).catch(() => null);
                if (medida) medidas.push(medida);
            }
            // Prova de idioma: ouve até dois títulos que abriram e confere se a
            // voz está mesmo em português (a fonte pode mentir no rótulo).
            const chaveDeIa = chaveDaIA();
            if (chaveDeIa) {
                for (const medida of medidas.filter(m => m.ok && m.url && m.amostraChave).slice(0, 2)) {
                    const ouvido = await verificarIdioma({
                        url: medida.url, referer: medida.referer, tipo: categoria.tipo,
                        amostra: medida.amostraChave, fonteId: fonte.id, chaveIa: chaveDeIa,
                        central: { pastaDados }, registrar,
                    }).catch(() => null);
                    if (ouvido) {
                        medida.idioma = ouvido.idioma;
                        medida.idiomaEvidencia = ouvido.evidencia;
                        medida.avisoAudio = ouvido.avisoAudio || '';
                        registrar(`${fonte.nome}: ${medida.amostra} → ${ouvido.idioma === 'pt' ? 'português confirmado' : ouvido.idioma === 'outro' ? 'NÃO está em português' : 'sem medição'}`);
                    }
                }
            }
            const { nota, detalhes } = notaDoFornecedor(medidas);
            // Toda fonte do motor já está dentro do aplicativo.
            ranking.push({ id: fonte.id, nome: fonte.nome, papel: fonte.papel, nota, detalhes, medidas, noApp: true });
        }
        for (const item of ranking) item.avaliacao = avaliarPromocao(item);
        for (const item of ranking) aplicarEvolucao(categoria.id, item);
        salvarHistorico();
        ranking.sort((a, b) => b.nota - a.nota);
        // Confere que nenhuma medida veio de título de outra categoria.
        const esperados = new Set(categoria.amostras.map(a => a.titulo));
        for (const item of ranking) {
            for (const medida of item.medidas || []) {
                if (!esperados.has(medida.amostra)) medida.foraDaCategoria = true;
            }
        }
        const doApp = ranking.filter(i => i.noApp);
        const novos = ranking.filter(i => !i.noApp);
        return {
            id: categoria.id, nome: categoria.nome, atualizadoEm: new Date().toISOString(),
            padrao: PADRAO_APP, amostras: [...esperados], historico: historicoCompleto(),
            ranking: novos, jaNoApp: doApp.map(i => ({ nome: i.nome, nota: i.nota, decisao: (i.avaliacao || {}).decisao, motivo: (i.avaliacao || {}).motivo })),
            candidatas
        };
    }

    async function cacar(qual = 'filme') {
        if (rodando) return { rodando: true };
        rodando = true;
        categoriaAtual = qual;
        try {
            const anteriores = ultimo() || { porCategoria: {} };
            const porCategoria = { ...(anteriores.porCategoria || {}) };
            const alvos = qual === 'todas' ? CATEGORIAS : [categoriaDe(qual)];
            for (const categoria of alvos) porCategoria[categoria.id] = await cacarCategoria(categoria);
            const saida = {
                atualizadoEm: new Date().toISOString(),
                regra: 'dublado (3) + sem anúncio (2) + qualidade HD/Full HD (2) + sucesso (2) + velocidade (1) — na TV ao vivo: canais (3) + sem anúncio (2) + qualidade (2) + resposta (2) + velocidade (1)',
                porCategoria
            };
            fs.mkdirSync(pastaDados, { recursive: true });
            fs.writeFileSync(arquivo, JSON.stringify(saida, null, 1));
            return saida;
        } finally { rodando = false; categoriaAtual = ''; }
    }

    function ultimo() {
        try { return JSON.parse(fs.readFileSync(arquivo, 'utf8')); } catch { return null; }
    }

    return { cacar, ultimo, rodando: () => rodando, categoriaAtual: () => categoriaAtual, CATEGORIAS, historico: historicoCompleto };
}

module.exports = { criarCacador, notaDoFornecedor, avaliarPromocao, CATEGORIAS, PADRAO_APP, medirListaDeCanais, chaveDaIA };
