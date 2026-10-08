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
const motor = require('../fontes-motor');

// ---------------------------------------------------------------- categorias
const CATEGORIAS = [
    {
        id: 'filme', nome: 'Filmes', tipo: 'movie',
        amostras: [
            { id: '27205', titulo: 'A Origem' },
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
            { nome: 'YouCine', url: 'https://youcinehd.lat/', motivoEsperado: 'catálogo com anúncio' }
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
    const dubladas = sucesso.filter(m => m.dublado).length;
    const taxaDublado = sucesso.length ? dubladas / sucesso.length : 0;
    const melhorAltura = Math.max(0, ...sucesso.map(m => m.altura || 0));
    const latencia = sucesso.length ? Math.round(sucesso.reduce((soma, m) => soma + m.ms, 0) / sucesso.length) : 0;

    const pSucesso = taxa * 2;
    const pDublado = taxaDublado * 3;
    const pSemAnuncio = 2;
    const pQualidade = melhorAltura >= 1080 ? 2 : melhorAltura >= 720 ? 1.4 : melhorAltura > 0 ? 0.6 : 0;
    const pVelocidade = latencia && latencia <= 3000 ? 1 : latencia <= 8000 ? 0.6 : 0.3;
    const nota = Math.max(0, Math.min(10, pSucesso + pDublado + pSemAnuncio + pQualidade + pVelocidade));
    return {
        nota: Math.round(nota * 10) / 10,
        detalhes: {
            testes: validas.length, sucessos: sucesso.length,
            taxaSucesso: Math.round(taxa * 100), dublados: dubladas,
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
async function conferirCandidata(candidata) {
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
        const anuncio = /popads|popcash|adsterra|propellerads|googlesyndication|adsbygoogle|monetag|clickadu/i.test(corpo);
        const vazio = corpo.length < 800;
        const episodios = (corpo.match(/href="[^"]*(?:episodio|episode)[^"]*"/gi) || []).length;
        const canais = (corpo.match(/#EXTINF/g) || []).length;
        let situacao = 'em análise';
        let motivo = 'não avaliada a fundo';
        if (verificacao) { situacao = 'descartada'; motivo = 'pede verificação no navegador (e traz anúncio)'; }
        else if (anuncio) { situacao = 'descartada'; motivo = 'página com anúncio; o app não teria como abrir limpo'; }
        else if (vazio) { situacao = 'descartada'; motivo = 'página vazia ou bloqueada'; }
        else if (canais) { situacao = 'boa'; motivo = 'lista de canais ao vivo (' + canais + ' canais), sem anúncio'; }
        else if (episodios) { situacao = 'em análise'; motivo = episodios + ' links de episódio, mas o vídeo não sai direto para o app'; }
        else if (/dublad|portugu/i.test(corpo)) { situacao = 'em análise'; motivo = 'cita dublado, mas o vídeo não é entregue direto ao app'; }
        else { situacao = 'descartada'; motivo = candidata.motivoEsperado; }
        return { nome: candidata.nome, url: candidata.url, status: resposta.status, situacao, motivo, esperado: candidata.motivoEsperado };
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
    const arquivo = path.join(pastaDados, 'fontes.json');
    let rodando = false;
    let categoriaAtual = '';

    async function cacarCategoria(categoria) {
        const candidatas = [];
        for (const c of categoria.candidatas || []) candidatas.push(await conferirCandidata(c));

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
            const { nota, detalhes } = notaDoFornecedor(medidas);
            // Toda fonte do motor já está dentro do aplicativo.
            ranking.push({ id: fonte.id, nome: fonte.nome, papel: fonte.papel, nota, detalhes, medidas, noApp: true });
        }
        for (const item of ranking) item.avaliacao = avaliarPromocao(item);
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
            padrao: PADRAO_APP, amostras: [...esperados],
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

    return { cacar, ultimo, rodando: () => rodando, categoriaAtual: () => categoriaAtual, CATEGORIAS };
}

module.exports = { criarCacador, notaDoFornecedor, avaliarPromocao, CATEGORIAS, PADRAO_APP, medirListaDeCanais };
