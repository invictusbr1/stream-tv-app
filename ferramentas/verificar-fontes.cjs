#!/usr/bin/env node
/**
 * Verificação de fontes do Conecta TV.
 *
 * Roda sem navegador (só requisições e ffprobe, quando disponível) para poder ser
 * executado automaticamente no GitHub Actions toda segunda-feira. O resultado é
 * gravado em relatorios/fontes-AAAA-MM-DD.json e o campo verificadoEm do
 * fontes.json é atualizado.
 *
 * Uso local:  node ferramentas/verificar-fontes.cjs
 * Uso com filme específico: node ferramentas/verificar-fontes.cjs 27205 tt1375666
 */
'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');
const { execFile } = require('child_process');

const FILME = process.argv[2] || '27205';
const IMDB = process.argv[3] || 'tt1375666';
const SERIE = ['1431', '1', '1'];   // CSI 1x1 — usado como teste de série
const RAIZ = path.join(__dirname, '..');
const PASTA_RELATORIOS = path.join(RAIZ, 'relatorios');

const ALVOS = [
  ['WatchPlay', 'filme', `https://v2.watchplay.shop/movie/${FILME}`],
  ['PipocaCine', 'filme', `https://pipocacine.lat/embed/${FILME}`],
  ['VidLink', 'filme', `https://vidlink.pro/movie/${FILME}`],
  ['VidLink (séries)', 'serie', `https://vidlink.pro/tv/${SERIE[0]}/${SERIE[1]}/${SERIE[2]}`],
  ['VidSrc (séries)', 'serie', `https://vidsrc.to/embed/tv/${SERIE[0]}/${SERIE[1]}/${SERIE[2]}`],
  ['StreamBetter', 'serie', `https://streambetter.shop/serie/${SERIE[0]}/${SERIE[1]}/${SERIE[2]}`],
  ['SuperFlix', 'serie', `https://superflixapi.monster/serie/${SERIE[0]}/${SERIE[1]}/${SERIE[2]}`],
  ['Dattebayo BR', 'serie', 'https://www.dattebayo-br.com/anime-dublado'],
  ['WatchCDN', 'filme', `https://embed.watchcdn.org/filme/${IMDB}`],
  ['CdnEmbed', 'filme', `https://cdn-embed.com/filme/${FILME}`],
  ['UltraEmbed', 'filme', `https://ultraembed.com/filme/${IMDB}`],
];

const SINAL_ANUNCIO = /popads|popcash|adsterra|propellerads|googlesyndication|doubleclick|adnxs|monetag|clickadu|intellipopup/i;
const SINAL_VAZIO = /not available|couldn't find|não disponível|nao disponivel|indisponível|conteúdo indisponível|not found|404/i;
const SINAL_VERIFICACAO = /confirme que|confirmando que|não sou robô|nao sou robo|turnstile|hcaptcha|recaptcha/i;

function buscar(url, redirect = 0) {
  return new Promise(resolve => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9',
      },
    }, r => {
      if ([301, 302, 307, 308].includes(r.statusCode) && r.headers.location && redirect < 4) {
        r.resume();
        return buscar(new URL(r.headers.location, url).href, redirect + 1).then(resolve);
      }
      let dados = '';
      r.setEncoding('utf8');
      r.on('data', c => { dados += c; if (dados.length > 600000) r.destroy(); });
      r.on('end', () => resolve({ status: r.statusCode, html: dados, anuncios: SINAL_ANUNCIO.test(dados) }));
    });
    req.on('error', e => resolve({ status: 0, html: '', erro: e.code }));
    req.setTimeout(15000, () => { req.destroy(); resolve({ status: 0, html: '', erro: 'timeout' }); });
  });
}

function ffprobe(url) {
  return new Promise(resolve => {
    execFile('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', url], { timeout: 20000, maxBuffer: 4 * 1024 * 1024 }, (erro, saida) => {
      if (erro || !saida) return resolve(null);
      try { resolve(JSON.parse(saida).streams || []); } catch { resolve(null); }
    });
  });
}

function avaliar(fonte, r) {
  if (!r || r.status === 0) return { situacao: 'sem resposta', detalhe: r?.erro || '' };
  if (r.status >= 400) return { situacao: 'indisponível', detalhe: `HTTP ${r.status}` };
  const html = r.html || '';
  if (html.length < 500) return { situacao: 'vazio', detalhe: `${html.length} bytes` };
  // Fontes que publicam a configuração do player no HTML (padrão do WatchPlay).
  const audio = (html.match(/window\.MyPlayerAudio\s*=\s*"([^"]*)"/) || [])[1] || null;
  const bruto = (html.match(/\burl\s*:\s*"([^"]+)"/) || [])[1] || null;
  if (audio && bruto) {
    let endereco = null;
    try { endereco = JSON.parse(`"${bruto}"`); } catch { endereco = bruto; }
    return { situacao: 'link direto', m3u8: endereco, audioInformado: audio, detalhe: `áudio informado: ${audio}` };
  }
  const m3u8 = (html.match(/https?:\/\/[^\s"'\\<>]+\.m3u8[^\s"'\\<>]*/g) || [])[0] || null;
  if (m3u8) return { situacao: 'link direto', m3u8, detalhe: 'página traz o endereço do vídeo' };
  // Só o texto visível conta: procurar esses avisos dentro de scripts dá falso positivo.
  const texto = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  if (SINAL_VERIFICACAO.test(texto)) return { situacao: 'verificação humana', detalhe: 'pede confirmação no navegador' };
  if (SINAL_VAZIO.test(texto)) return { situacao: 'sem conteúdo', detalhe: 'a fonte avisa que não tem este título' };
  if (r.anuncios) return { situacao: 'abre com anúncios', detalhe: 'página carregou mas depende de JavaScript' };
  return { situacao: 'abre (JavaScript)', detalhe: 'não é possível medir sem navegador' };
}

(async () => {
  const resultados = [];
  console.log('Verificação de fontes do Conecta TV\n');
  for (const [nome, tipo, url] of ALVOS) {
    const resposta = await buscar(url);
    const avaliacao = avaliar(nome, resposta);
    let midia = null;
    if (avaliacao.m3u8) {
      const streams = await ffprobe(avaliacao.m3u8);
      if (streams) {
        const video = streams.filter(s => s.codec_type === 'video').map(s => `${s.width}x${s.height}`).join('/');
        const audio = streams.filter(s => s.codec_type === 'audio').map(s => s.tags?.language || 'sem-idioma').join('/');
        midia = { video, audio };
      }
    }
    const linha = { nome, tipo, url, ...avaliacao, midia };
    resultados.push(linha);
    console.log(`${nome.padEnd(18)} ${avaliacao.situacao.padEnd(20)} ${midia ? `vídeo ${midia.video} áudio ${midia.audio}` : avaliacao.detalhe}`);
  }

  fs.mkdirSync(PASTA_RELATORIOS, { recursive: true });
  const hoje = new Date().toISOString().slice(0, 10);
  const arquivo = path.join(PASTA_RELATORIOS, `fontes-${hoje}.json`);
  fs.writeFileSync(arquivo, JSON.stringify({ atualizadoEm: hoje, resultados }, null, 2));

  const catalogo = JSON.parse(fs.readFileSync(path.join(RAIZ, 'fontes.json'), 'utf8'));
  catalogo.atualizadoEm = hoje;
  for (const lista of [catalogo.filmes, catalogo.series]) {
    for (const entrada of lista) {
      const achado = resultados.find(r => r.nome === entrada.nome || r.nome.startsWith(entrada.nome));
      if (achado) entrada.verificadoEm = hoje;
    }
  }
  fs.writeFileSync(path.join(RAIZ, 'fontes.json'), JSON.stringify(catalogo, null, 2) + '\n');
  console.log(`\nRelatório salvo em ${path.relative(RAIZ, arquivo)} e fontes.json atualizado.`);
})();
