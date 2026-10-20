'use strict';
// Fonte dublada do ClickHost (embed-api.clickhost.xyz), encontrada dentro do
// Kairou em 18/10/2026. O que faz ele servir para o Conecta TV:
//
//   - a página do título entrega o endereço do arquivo no próprio HTML
//     (window.ApiEmbedConfig.streamUrl), sem precisar de navegador;
//   - o vídeo é arquivo/lista direto: nenhuma página de anúncio é aberta no
//     caminho da reprodução — o player do aplicativo lê a mídia;
//   - quando entrega, é Full HD/4K com faixa em português como padrão
//     (medido no Toy Story 5: 3840x2160 HEVC, áudio "por" na faixa padrão);
//   - o mesmo catálogo cobre filme e série (/embed/serie/{id}/{t}/{e}).
//
// Limites conhecidos — por isso ele entra como opção, nunca como principal:
//
//   - o endereço é de VIDA CURTA (expira em poucos minutos). Por isso é
//     resolvido a cada abertura e nunca fica guardado em memória;
//   - só parte dos títulos tem o arquivo direto. Nos demais a página oferece
//     apenas servidores com token (/embed/stream/{id}?token=...), que
//     respondem 502 à leitura por faixa — esses NÃO são devolvidos: não
//     poderiam ser medidos e ainda derrubariam a saúde desta fonte;
//   - HEVC em 4K depende do aparelho tocar o codec; quem não tocar cai nas
//     outras fontes dubladas normalmente.

const axios = require('axios');

const BASE = 'https://embed-api.clickhost.xyz';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const TEMPO = 2500; // Duas consultas curtas deixam tempo para medir a mídia no orçamento de 10s.

function caminho(tipo, tmdbId, temporada, episodio) {
    const serie = tipo === 'tv' || tipo === 'series';
    return serie
        ? `/embed/serie/${tmdbId}/${temporada}/${episodio}?ad_played=1`
        : `/embed/filme/${tmdbId}?ad_played=1`;
}

// A configuração do player vem como objeto JavaScript (não é JSON estrito),
// então lemos apenas os campos que interessam.
function extrair(html) {
    const texto = String(html || '');
    let url='';try{url=JSON.parse((texto.match(/\bstreamUrl:\s*("(?:\\.|[^"\\])*")/)||[])[1]||'""');}catch{return null;}
    if (!/^https:\/\//i.test(url)||!require('./perfis-motor').ehEnderecoSeguro(url)) return null;
    const path=new URL(url).pathname,hls=/streamIsHls:\s*true/.test(texto);
    if(!path.toLowerCase().endsWith(hls?'.m3u8':'.mp4')&&/\.[a-z0-9]{1,5}$/i.test(path))return null;
    return {
        url,
        titulo: (texto.match(/contentName:\s*"([^"]+)"/) || [])[1] || '',
        hls,
    };
}

async function resolver(tipo, tmdbId, temporada, episodio) {
    const id = String(tmdbId || '').trim();
    const serie = tipo === 'tv' || tipo === 'series';
    if (!/^[1-9]\d{0,9}$/.test(id)) return null;
    if (serie && (!/^[1-9]\d{0,2}$/.test(String(temporada)) || !/^[1-9]\d{0,3}$/.test(String(episodio)))) return null;

    // O fornecedor alterna entre servidores: em ~1 de cada 10 leituras a página
    // volta sem o arquivo direto. Uma segunda tentativa resolve quase todos
    // esses casos sem custo perceptível (a página responde em ~300 ms).
    let achado = null;
    for (let tentativa = 0; tentativa < 2 && !achado; tentativa++) {
        let html = '';
        try {
            const resposta = await axios.get(BASE + caminho(tipo, id, temporada, episodio), {
                headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,*/*', Referer: BASE + '/' },
                timeout: TEMPO,
                responseType: 'text',
                maxContentLength: 2 * 1024 * 1024,
                validateStatus: status => status === 200,
            });
            html = String(resposta.data || '');
        } catch { continue; }
        achado = extrair(html);
    }

    if (!achado) return null;

    return {
        url: achado.url,
        audio: 'pt-BR',
        fonte: 'ClickHost · dublado',
        referer: BASE + '/',
        // Sem indicação de qualidade: quem mede é o avaliador, na hora.
        resolucao: '',
        type: achado.hls ? 'hls' : 'file',
        // Arquivo direto vai ao player sem passar pelo encaminhamento local.
        final: !achado.hls,
        efemera: true,
        exigeProva: true,
        titulo: achado.titulo,
    };
}

function resolverEpisodio(tmdbId, temporada, episodio) {
    return resolver('tv', tmdbId, temporada, episodio);
}

module.exports = { resolver, resolverEpisodio, extrair, BASE };
