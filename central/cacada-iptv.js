'use strict';
// Caçada de IPTV (TV ao vivo) para o Conecta TV.
//
// Procura listas públicas .m3u / .m3u8 de TV ao vivo (Brasil, português,
// esportes, TV aberta, filmes e séries, notícias, infantil, documentários e
// música) mais listas descobertas no GitHub, testa de verdade os canais HTTPS
// (conferindo se respondem #EXTM3U válido e medindo a resolução), classifica
// cada canal pelo seu setor (`listas-tv.js`) e publica:
//   1. As listas aprovadas em `listasTv` de `perfis.json` (com `setor` e nota);
//   2. A lista unificada `tv-cacador-verificados.m3u` no repositório de
//      atualizações (`invictusbr1/stream-tv-atualizacoes`), já com `group-title`
//      preenchido para que o aplicativo direcione cada canal para a aba certa
//      (TV Aberta, Esportes, Filmes e Séries, Notícias, Infantil, etc.).

const fs = require('fs');
const path = require('path');
const listasTvModulo = require('../listas-tv');
const perfisModulo = require('./perfis');

const REPOSITORIO = perfisModulo.REPOSITORIO || 'invictusbr1/stream-tv-atualizacoes';
const ARQUIVO_M3U_VERIFICADOS = 'tv-cacador-verificados.m3u';
const URL_M3U_VERIFICADOS = `https://raw.githubusercontent.com/${REPOSITORIO}/main/${ARQUIVO_M3U_VERIFICADOS}`;

// Sementes públicas conhecidas de IPTV (gratuitas, HTTPS, sem anúncio).
const SEMENTES_IPTV = [
    { id: 'brasil', nome: 'Canais do Brasil (TV Aberta e variedades)', url: 'https://iptv-org.github.io/iptv/countries/br.m3u', setor: 'tv-aberta' },
    { id: 'portugues', nome: 'Canais em Português', url: 'https://iptv-org.github.io/iptv/languages/por.m3u', setor: 'tv-aberta' },
    { id: 'esportes', nome: 'Esportes ao vivo', url: 'https://iptv-org.github.io/iptv/categories/sports.m3u', setor: 'esportes' },
    { id: 'filmes', nome: 'Filmes (TV ao vivo)', url: 'https://iptv-org.github.io/iptv/categories/movies.m3u', setor: 'filmes' },
    { id: 'series', nome: 'Séries (TV ao vivo)', url: 'https://iptv-org.github.io/iptv/categories/series.m3u', setor: 'filmes' },
    { id: 'noticias', nome: 'Notícias 24h', url: 'https://iptv-org.github.io/iptv/categories/news.m3u', setor: 'noticias' },
    { id: 'infantil', nome: 'Infantil e Desenhos', url: 'https://iptv-org.github.io/iptv/categories/kids.m3u', setor: 'infantil' },
    { id: 'animacao', nome: 'Animação 24h', url: 'https://iptv-org.github.io/iptv/categories/animation.m3u', setor: 'infantil' },
    { id: 'documentarios', nome: 'Documentários e História', url: 'https://iptv-org.github.io/iptv/categories/documentary.m3u', setor: 'documentarios' },
    { id: 'cultura', nome: 'Cultura e Ciência', url: 'https://iptv-org.github.io/iptv/categories/culture.m3u', setor: 'documentarios' },
    { id: 'musica', nome: 'Música e Shows', url: 'https://iptv-org.github.io/iptv/categories/music.m3u', setor: 'musica' },
    { id: 'free-tv-brasil', nome: 'Free-TV Brasil (aberta)', url: 'https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists/playlist_brazil.m3u8', setor: 'tv-aberta' },
    { id: 'iptv-brazil', nome: 'Brasil Extra (IPTV)', url: 'https://github.com/iptv-com/iptv/raw/refs/heads/main/lists/brazil.m3u', setor: 'tv-aberta' },
];

const BUSCAS_GITHUB_IPTV = [
    'iptv brasil m3u',
    'canais tv aberta brasil m3u8',
    'lista iptv esportes brasil m3u',
    'pluto tv brasil m3u',
    'samsung tv plus brasil m3u',
    'stremio addon tv brasil live',
    'stremio iptv brasil',
];

const BUSCAS_ADDONS_TV = [
    'iptv',
    'live tv',
    'canais',
    'tv aberta',
    'brasil tv',
    'pluto',
];

const ROTULO_SETOR = {
    'tv-aberta': 'TV Aberta',
    'esportes': 'Esportes',
    'filmes': 'Filmes e Séries',
    'noticias': 'Notícias',
    'infantil': 'Infantil',
    'documentarios': 'Documentários',
    'musica': 'Música',
    'fornecedores': 'Fornecedores IPTV',
};

function idLimpo(texto) {
    return String(texto || 'iptv')
        .toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40) || 'iptv';
}

function ehCanalRelevanteParaBrasil(canal, listaId = '') {
    const n = listasTvModulo.textoBusca(canal && canal.nome || '');
    const u = String(canal && canal.url || '').toLowerCase();
    const l = listasTvModulo.textoBusca(listaId);
    if (/brasil|portugues|free-tv-brasil|ssungbra|lgbra/.test(l)) return true;
    if (/\b(br|bra|pt|por|portugues|brasil|globo|sbt|record|band|cultura|rede ?tv|gazeta|aparecida|futura|canal ?brasil|sportv|premiere|cazetv|xsports|bandsports|espn|goat|nosso ?futebol|cnn ?brasil|globonews|bandnews|jovem ?pan|record ?news|sbt ?news|times ?brasil|telecine|megapix|tnt|space|warner|universal|axn|sony|paramount|cinemax|gloob|cartoon|discovery|multishow|bis|curta|arte ?1|pluto|samsung)\b/.test(n)) return true;
    if (/\.br\/|brasil|brazil|[_.-]br[_.-]|[_/]por[_/]|pt-?br/i.test(u)) return true;
    return false;
}

// Escolhe quais canais da lista testar: prioriza canais brasileiros/português e
// distribui pelos setores da TV ao vivo.
function escolherAmostraDeCanais(canais, listaId = '', limite = 8) {
    if (!Array.isArray(canais) || !canais.length) return [];
    const relevantes = canais.filter(c => ehCanalRelevanteParaBrasil(c, listaId));
    const base = relevantes.length >= Math.min(3, limite) ? relevantes : canais;
    if (base.length <= limite) return [...base];
    const escolhidos = [];
    const passo = Math.max(1, Math.floor(base.length / limite));
    for (let i = 0; i < base.length && escolhidos.length < limite; i += passo) {
        escolhidos.push(base[i]);
    }
    return escolhidos;
}

// Testa se um endereço de canal ao vivo responde com manifesto HLS (#EXTM3U) válido.
async function testarCanalHls(canal, { buscarTexto, timeoutMs = 10000 } = {}) {
    const t0 = Date.now();
    try {
        const corpo = String(await buscarTexto(canal.url, timeoutMs) || '');
        const ms = Date.now() - t0;
        const ehM3u = /^\s*#EXTM3U/m.test(corpo) && /#EXT(?:INF|-X-STREAM-INF)/i.test(corpo);
        if (!ehM3u) return { ok: false, ms, altura: 0, canal };
        const alturas = [...corpo.matchAll(/RESOLUTION=\d+x(\d+)/gi)].map(m => Number(m[1]));
        const altura = alturas.length ? Math.max(...alturas) : (/\b1080p?\b/i.test(canal.nome) ? 1080 : /\b720p?\b/i.test(canal.nome) ? 720 : 0);
        return { ok: true, ms, altura, canal };
    } catch {
        return { ok: false, ms: Date.now() - t0, altura: 0, canal };
    }
}

// Mede uma lista .m3u / .m3u8 inteira (ou um canal avulso .m3u8).
async function medirListaIptv(candidata, { buscarTexto, limiteAmostra = 8, concorrencia = 4 } = {}) {
    const url = String(candidata && candidata.url || '').trim();
    const id = idLimpo(candidata && (candidata.id || candidata.nome) || url);
    const nome = String(candidata && candidata.nome || id).slice(0, 60);
    if (!/^https:\/\//i.test(url)) {
        return { id, nome, url, status: 'endereço inválido', nota: 0, aprovada: false, canais: 0, responderam: 0, vivos: [], porSetor: {}, detalhe: 'use um endereço https://' };
    }
    let texto = '';
    try {
        texto = String(await buscarTexto(url, 25000) || '');
    } catch (e) {
        return { id, nome, url, status: 'fora do ar', nota: 0, aprovada: false, canais: 0, responderam: 0, vivos: [], porSetor: {}, detalhe: 'não respondeu (' + String(e && e.message || e).slice(0, 50) + ')' };
    }
    if (!/#EXTM3U/i.test(texto)) {
        return { id, nome, url, status: 'sem canais', nota: 0, aprovada: false, canais: 0, responderam: 0, vivos: [], porSetor: {}, detalhe: 'o endereço não devolveu uma lista #EXTM3U' };
    }
    // Se for um manifesto HLS direto de um único canal (#EXT-X-STREAM-INF ou segmentos .ts)
    if (!/#EXTINF\s*:\s*-?1[^\r\n]*,/i.test(texto) || /#EXT-X-STREAM-INF|#EXT-X-TARGETDURATION/i.test(texto)) {
        const alturas = [...texto.matchAll(/RESOLUTION=\d+x(\d+)/gi)].map(m => Number(m[1]));
        const altura = alturas.length ? Math.max(...alturas) : 720;
        const canalUnico = {
            nome,
            logo: '',
            url,
            lista: id,
            doCacador: true,
            setor: candidata.setor || listasTvModulo.setorDoCanal({ nome, lista: id, doCacador: true }),
        };
        const qualidade = altura ? `${altura}p` : 'HD';
        return {
            id, nome, url,
            setor: canalUnico.setor,
            status: 'aprovada',
            nota: 8.5,
            aprovada: true,
            canais: 1,
            testados: 1,
            responderam: 1,
            taxaSucesso: 100,
            qualidade,
            vivos: [{ ...canalUnico, altura }],
            porSetor: { [canalUnico.setor]: 1 },
            detalhe: `canal direto ao vivo (${qualidade}) · setor ${ROTULO_SETOR[canalUnico.setor] || canalUnico.setor}`,
        };
    }

    const todosCanais = listasTvModulo.parseM3u(texto, id, {
        doCacador: true,
        setor: candidata.setor || '',
    });
    if (!todosCanais.length) {
        return { id, nome, url, status: 'sem canais https', nota: 0, aprovada: false, canais: 0, responderam: 0, vivos: [], porSetor: {}, detalhe: 'nenhum canal com endereço https:// válido na lista' };
    }

    const amostra = escolherAmostraDeCanais(todosCanais, id, limiteAmostra);
    const fila = [...amostra];
    const medidos = [];
    async function trabalhador() {
        while (fila.length) {
            const c = fila.shift();
            if (!c) break;
            medidos.push(await testarCanalHls(c, { buscarTexto }));
        }
    }
    await Promise.all(Array.from({ length: Math.max(1, Math.min(concorrencia, amostra.length)) }, trabalhador));

    const vivos = medidos.filter(m => m.ok).map(m => ({
        ...m.canal,
        altura: m.altura || 0,
        setor: listasTvModulo.setorDoCanal(m.canal),
        doCacador: true,
    }));
    const responderam = vivos.length;
    const taxa = amostra.length ? responderam / amostra.length : 0;
    const melhorAltura = Math.max(0, ...vivos.map(v => v.altura || 0));
    const latenciaMedia = medidos.length ? Math.round(medidos.reduce((s, m) => s + (m.ms || 0), 0) / medidos.length) : 0;

    // Pontuação de TV ao vivo: canais (até 3) + sem anúncio (2) + qualidade (até 2) + resposta (até 2) + velocidade (até 1)
    const pCanais = todosCanais.length >= 150 ? 3 : todosCanais.length >= 40 ? 2.3 : todosCanais.length >= 10 ? 1.6 : 1.0;
    const pSemAnuncio = 2;
    const pQualidade = melhorAltura >= 1080 ? 2 : melhorAltura >= 720 ? 1.5 : responderam > 0 ? 1.0 : 0;
    const pResposta = taxa * 2;
    const pVelocidade = latenciaMedia && latenciaMedia <= 2500 ? 1 : latenciaMedia <= 6000 ? 0.6 : 0.3;
    const nota = responderam === 0 ? 0 : Math.round(Math.max(0, Math.min(10, pCanais + pSemAnuncio + pQualidade + pResposta + pVelocidade)) * 10) / 10;

    // Contagem por setor de todos os canais da lista
    const porSetor = {};
    for (const c of todosCanais) {
        const s = listasTvModulo.setorDoCanal(c);
        porSetor[s] = (porSetor[s] || 0) + 1;
    }
    const setorPrincipal = candidata.setor || Object.entries(porSetor).sort((a, b) => b[1] - a[1]).map(e => e[0])[0] || 'tv-aberta';
    const qualidade = melhorAltura ? `${melhorAltura}p` : (responderam > 0 ? 'HLS' : '—');
    const aprovada = responderam >= 1 && (taxa >= 0.25 || responderam >= 2) && nota >= 5.5;
    const resumoSetores = Object.entries(porSetor)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([s, qtd]) => `${ROTULO_SETOR[s] || s}: ${qtd}`)
        .join(', ');
    const exemplosVivos = vivos.slice(0, 3).map(v => v.nome).join(', ');

    return {
        id,
        nome,
        url,
        setor: setorPrincipal,
        status: aprovada ? 'aprovada' : responderam > 0 ? 'poucos canais ativos' : 'canais fora do ar',
        nota,
        aprovada,
        canais: todosCanais.length,
        testados: amostra.length,
        responderam,
        taxaSucesso: Math.round(taxa * 100),
        qualidade,
        vivos,
        porSetor,
        detalhe: `${todosCanais.length} canais (${resumoSetores}) · ${responderam}/${amostra.length} abriram no teste${exemplosVivos ? ` (${exemplosVivos})` : ''} · nota ${nota}`,
    };
}

// Descobre novas listas .m3u / .m3u8 no GitHub (repositórios públicos de IPTV Brasil/Português).
async function descobrirListasGithub({ buscarJson, buscarTexto, token = '', buscas = BUSCAS_GITHUB_IPTV, registrar = () => {} } = {}) {
    const cab = { Accept: 'application/vnd.github+json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
    const achadas = new Map();
    for (const termo of buscas) {
        const r = await buscarJson(`https://api.github.com/search/repositories?q=${encodeURIComponent(termo)}&sort=updated&per_page=8`, { headers: cab }).catch(() => null);
        for (const repo of (r && Array.isArray(r.items) ? r.items : []).slice(0, 5)) {
            if (!repo || !repo.full_name || repo.archived) continue;
            const branch = repo.default_branch || 'main';
            const readme = await buscarTexto(`https://raw.githubusercontent.com/${repo.full_name}/${branch}/README.md`, 10000).catch(() => '');
            for (const m of String(readme || '').matchAll(/https:\/\/[^\s"'<>()`\]]+\.m3u8?(?:\?[^\s"'<>()`\]]*)?/gi)) {
                const link = m[0].replace(/[.,;:!?]+$/, '');
                if (/example|localhost|127\.0\.0\.1|seu[_-]?ip/i.test(link)) continue;
                if (!achadas.has(link)) {
                    achadas.set(link, {
                        id: idLimpo(`${repo.name}-${ path.basename(link).replace(/\.m3u8?.*$/i, '') }`),
                        nome: `${repo.name} (${path.basename(link).slice(0, 28)})`,
                        url: link,
                        origem: `github:${repo.full_name}`,
                    });
                }
            }
        }
    }
    if (achadas.size) registrar(`GitHub IPTV: ${achadas.size} lista(s) .m3u/.m3u8 encontrada(s)`);
    return [...achadas.values()].slice(0, 10);
}

// Extrai o hash (infoHash) de 40 caracteres de um item de stream ou magnet.
function hashDeTorrent(item) {
    if (!item || typeof item !== 'object') return '';
    if (/^[a-f0-9]{40}$/i.test(String(item.infoHash || ''))) return String(item.infoHash).toLowerCase();
    const m = String(item.url || item.magnet || '').match(/btih:([a-f0-9]{40})/i);
    return m ? m[1].toLowerCase() : '';
}

// Mede um addon Stremio de TV ao vivo / IPTV (tipos `tv` ou `channel`),
// testando streams HTTPS diretos e também streams por infoHash/magnet na TorBox!
async function medirAddonTvStremio(addon, { buscarJson, buscarTexto, torbox = null, limiteCanais = 10 } = {}) {
    const base = String(addon && (addon.base || addon.url) || '').trim().replace(/\/manifest\.json(\?.*)?$/i, '').replace(/\/+$/, '');
    const id = idLimpo(addon && (addon.id || addon.nome) || base);
    let nome = String(addon && addon.nome || id).slice(0, 60);
    if (!/^https:\/\//i.test(base) || typeof buscarJson !== 'function') {
        return { id, nome, url: base, status: 'endereço inválido', nota: 0, aprovada: false, canais: 0, responderam: 0, vivos: [], porSetor: {}, detalhe: 'endereço de addon inválido' };
    }
    const manifest = await buscarJson(`${base}/manifest.json`).catch(() => null);
    if (!manifest || typeof manifest !== 'object' || !manifest.id) {
        return { id, nome, url: base, status: 'fora do ar', nota: 0, aprovada: false, canais: 0, responderam: 0, vivos: [], porSetor: {}, detalhe: 'manifest.json não respondeu' };
    }
    if (manifest.name) nome = String(manifest.name).slice(0, 60);
    if (listasTvModulo.ehCanalAdulto(`${nome} ${manifest.description || ''} ${base}`)) {
        return { id, nome, url: base, status: 'bloqueado (adulto)', nota: 0, aprovada: false, canais: 0, responderam: 0, vivos: [], porSetor: {}, detalhe: 'addon bloqueado por filtro familiar' };
    }
    const catalogos = (Array.isArray(manifest.catalogs) ? manifest.catalogs : [])
        .filter(c => c && !listasTvModulo.ehCanalAdulto(`${c.id || ''} ${c.name || ''}`) && (c.type === 'tv' || c.type === 'channel' || /tv|iptv|live|canais|channel|sport/i.test(`${c.type || ''} ${c.id || ''} ${c.name || ''}`)));
    if (!catalogos.length) {
        return { id, nome, url: base, status: 'sem catálogo de TV', nota: 0, aprovada: false, canais: 0, responderam: 0, vivos: [], porSetor: {}, detalhe: 'addon não declara catálogo de canais ao vivo (tv/channel)' };
    }

    const metas = [];
    for (const cat of catalogos.slice(0, 3)) {
        const catJson = await buscarJson(`${base}/catalog/${encodeURIComponent(cat.type)}/${encodeURIComponent(cat.id)}.json`).catch(() => null);
        for (const m of (catJson && Array.isArray(catJson.metas) ? catJson.metas : [])) {
            if (!m || !m.id || !m.name) continue;
            if (listasTvModulo.ehCanalAdulto(`${m.name} ${m.poster || ''} ${m.logo || ''} ${(m.genres || []).join(' ')}`)) continue;
            metas.push({ ...m, catalogType: cat.type });
        }
        if (metas.length >= 60) break;
    }
    if (!metas.length) {
        return { id, nome, url: base, status: 'catálogo vazio', nota: 0, aprovada: false, canais: 0, responderam: 0, vivos: [], porSetor: {}, detalhe: 'catálogo de TV não devolveu canais' };
    }

    // Prioriza canais brasileiros/português ou esportes
    const relevantes = metas.filter(m => ehCanalRelevanteParaBrasil({ nome: m.name, url: '' }, nome));
    const escolhidos = (relevantes.length >= 3 ? relevantes : metas).slice(0, limiteCanais);

    const vivos = [];
    const porSetor = {};
    const hashesTorbox = [];
    let comTorrent = 0;

    for (const meta of escolhidos) {
        const tipoStream = meta.type || meta.catalogType || 'tv';
        const stJson = await buscarJson(`${base}/stream/${encodeURIComponent(tipoStream)}/${encodeURIComponent(meta.id)}.json`).catch(() => null);
        const streams = stJson && Array.isArray(stJson.streams) ? stJson.streams : [];
        let achouVivo = false;
        for (const s of streams.slice(0, 4)) {
            const h = hashDeTorrent(s);
            if (h) {
                comTorrent++;
                hashesTorbox.push({ hash: h, meta, stream: s });
            }
            if (s && typeof s.url === 'string' && /^https:\/\//i.test(s.url) && !achouVivo) {
                const canalCandidato = {
                    nome: String(meta.name || s.title || s.name || 'Canal').slice(0, 70),
                    logo: /^https:\/\//i.test(meta.poster || meta.logo || '') ? (meta.poster || meta.logo) : '',
                    grupo: Array.isArray(meta.genres) ? meta.genres.join(';') : String(meta.genre || ''),
                    url: s.url,
                    lista: id,
                    doCacador: true,
                };
                if (listasTvModulo.ehCanalAdulto(canalCandidato)) continue;
                canalCandidato.setor = listasTvModulo.setorDoCanal(canalCandidato);
                porSetor[canalCandidato.setor] = (porSetor[canalCandidato.setor] || 0) + 1;
                const medido = await testarCanalHls(canalCandidato, { buscarTexto, timeoutMs: 8000 });
                if (medido.ok) {
                    vivos.push({ ...canalCandidato, altura: medido.altura || 720 });
                    achouVivo = true;
                }
            }
        }
    }

    // Se o addon entregou streams por infoHash/magnet e temos a TorBox ativa,
    // consulta quais estão prontos no cache da TorBox!
    let prontosTorbox = 0;
    if (hashesTorbox.length && torbox && typeof torbox.emCache === 'function') {
        const unicos = [...new Set(hashesTorbox.map(x => x.hash))];
        const emCacheSet = await torbox.emCache(unicos).catch(() => new Set());
        prontosTorbox = emCacheSet ? emCacheSet.size : 0;
        if (prontosTorbox >= 1 && typeof torbox.aprovar === 'function') {
            torbox.aprovar({
                base,
                nome,
                motivo: `IPTV/TV via TorBox (${prontosTorbox} transmissão(ões) pronta(s) no cache)`,
                novos: prontosTorbox,
            });
        }
    }

    const responderam = vivos.length + prontosTorbox;
    const melhorAltura = Math.max(0, ...vivos.map(v => v.altura || 0));
    const qualidade = melhorAltura ? `${melhorAltura}p` : (prontosTorbox ? 'TorBox' : responderam ? 'HLS' : '—');
    const setorPrincipal = Object.entries(porSetor).sort((a, b) => b[1] - a[1]).map(e => e[0])[0] || 'fornecedores';
    const nota = responderam ? Math.min(10, Math.round((5.5 + Math.min(3, responderam * 0.6) + (melhorAltura >= 1080 ? 1.5 : 0.8)) * 10) / 10) : 0;
    const aprovada = responderam >= 1;

    return {
        id,
        nome,
        url: base,
        setor: setorPrincipal,
        status: aprovada ? 'aprovada' : comTorrent ? 'torrent sem cache TorBox' : 'canais fora do ar',
        nota,
        aprovada,
        canais: metas.length,
        testados: escolhidos.length,
        responderam,
        taxaSucesso: escolhidos.length ? Math.round((responderam / escolhidos.length) * 100) : 0,
        qualidade,
        vivos,
        prontosTorbox,
        porSetor,
        detalhe: `${metas.length} canais no addon · ${vivos.length} HLS ao vivo${prontosTorbox ? ` + ${prontosTorbox} pronto(s) na TorBox` : ''}`,
    };
}

// Descobre addons Stremio que fornecem canais de TV ao vivo (`tv` / `channel`)
// nos catálogos públicos e na lista da comunidade.
async function descobrirAddonsTvStremio({ buscarJson, token = '', registrar = () => {} } = {}) {
    if (typeof buscarJson !== 'function') return [];
    const achados = new Map();
    const adicionar = (baseBruta, nome, descricao = '') => {
        const b = String(baseBruta || '').trim().replace(/\/manifest\.json(\?.*)?$/i, '').replace(/\/+$/, '');
        if (!/^https:\/\//i.test(b) || /example|localhost|127\.0\.0\.1/i.test(b)) return;
        if (listasTvModulo.ehCanalAdulto(`${nome || ''} ${descricao || ''} ${b}`)) return;
        if (!achados.has(b)) achados.set(b, { id: idLimpo(nome || b), nome: String(nome || b).slice(0, 60), base: b, url: b, descricao: String(descricao || '').slice(0, 140), ehAddon: true });
    };

    // 1. Catálogos públicos do Stremio (filtra os que têm tipo 'tv' ou 'channel' e citam Brasil/PT/IPTV/Sports)
    for (const catUrl of ['https://stremio-addons.net/api/addon_catalog/all/stremio-addons.net.json', 'https://api.strem.io/addonscollection.json']) {
        const dados = await buscarJson(catUrl).catch(() => null);
        const lista = Array.isArray(dados) ? dados : (dados && Array.isArray(dados.addons) ? dados.addons : []);
        for (const item of lista) {
            const m = item && item.manifest || {};
            const tipos = Array.isArray(m.types) ? m.types.map(String) : [];
            if (!tipos.includes('tv') && !tipos.includes('channel')) continue;
            const texto = `${m.name || ''} ${m.description || ''} ${item.transportUrl || ''}`;
            if (/\b(br|bra|pt-?br|brasil|brazil|portugues|iptv|live ?tv|canais|tv aberta|pluto|samsung|sport|futebol)\b/i.test(texto)) {
                adicionar(item.transportUrl, m.name, m.description);
            }
        }
    }

    // 2. Issues recentes da lista da comunidade Stremio sobre IPTV / Live TV Brasil
    const cab = { Accept: 'application/vnd.github+json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
    for (const termo of BUSCAS_ADDONS_TV.slice(0, 3)) {
        const q = `repo:Stremio-Community/stremio-addons-list ${termo}`;
        const r = await buscarJson(`https://api.github.com/search/issues?q=${encodeURIComponent(q)}&sort=updated&order=desc&per_page=15`, { headers: cab }).catch(() => null);
        for (const issue of (r && Array.isArray(r.items) ? r.items : [])) {
            const etiquetas = (issue.labels || []).map(l => String(l.name || l)).join(',');
            if (/inactive|invalid|unreachable/i.test(etiquetas)) continue;
            const texto = `${issue.title || ''} ${issue.body || ''}`;
            if (!/\b(br|brasil|portugues|iptv|tv|live|canais|sport)\b/i.test(texto)) continue;
            for (const m of String(issue.body || '').match(/https:\/\/[^\s)"'<>\]]+\/manifest\.json/gi) || []) {
                adicionar(m, issue.title, issue.body);
            }
        }
    }

    if (achados.size) registrar(`Addons Stremio de TV ao vivo: ${achados.size} candidato(s) para testar`);
    return [...achados.values()].slice(0, 8);
}

// Monta o arquivo #EXTM3U com todos os canais verificados que abriram de verdade,
// já separados com group-title do setor correspondente.
function gerarM3uVerificados(canaisVivos = []) {
    const vistos = new Set();
    const linhas = ['#EXTM3U'];
    for (const c of Array.isArray(canaisVivos) ? canaisVivos : []) {
        if (!c || !c.url || !/^https:\/\//i.test(c.url)) continue;
        if (listasTvModulo.ehCanalAdulto(c)) continue;
        if (vistos.has(c.url)) continue;
        vistos.add(c.url);
        const setor = listasTvModulo.setorDoCanal({ ...c, setor: '' }) || c.setor || 'tv-aberta';
        const grupo = ROTULO_SETOR[setor] || 'TV Aberta';
        const nome = String(c.nome || 'Canal').replace(/[\r\n]+/g, ' ').trim();
        const logo = c.logo && /^https:\/\//i.test(c.logo) ? ` tvg-logo="${c.logo.replace(/"/g, '')}"` : '';
        linhas.push(`#EXTINF:-1${logo} group-title="${grupo}",${nome}`);
        linhas.push(c.url);
    }
    return linhas.join('\n') + '\n';
}

// Publica o arquivo `tv-cacador-verificados.m3u` no GitHub (`invictusbr1/stream-tv-atualizacoes`).
async function publicarM3uVerificados(conteudoM3u, token, { api = require('axios') } = {}) {
    if (!token) return { ok: false, motivo: 'sem token do GitHub' };
    const cabecalhos = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'conecta-tv-cacador' };
    const endpoint = `https://api.github.com/repos/${REPOSITORIO}/contents/${ARQUIVO_M3U_VERIFICADOS}`;
    let sha;
    try {
        const atual = await api.get(endpoint, { headers: cabecalhos, timeout: 15000, validateStatus: s => s < 500 });
        if (atual && atual.data && atual.data.sha) sha = atual.data.sha;
    } catch { /* arquivo novo */ }
    try {
        await api.put(endpoint, {
            message: 'Canais de IPTV verificados pelo caçador',
            content: Buffer.from(String(conteudoM3u || '#EXTM3U\n'), 'utf8').toString('base64'),
            ...(sha ? { sha } : {}),
        }, { headers: cabecalhos, timeout: 25000 });
        return { ok: true, url: URL_M3U_VERIFICADOS };
    } catch (e) {
        return { ok: false, motivo: String(e && e.message || e).slice(0, 80) };
    }
}

// Executa a caçada completa de IPTV: sementes + descobertas do GitHub + addons Stremio de TV/TorBox + links extras.
async function cacarIptv(deps = {}, opcoes = {}) {
    const {
        buscarTexto,
        buscarJson,
        pastaDados = path.join(__dirname, 'dados'),
        token = '',
        registrar = () => {},
        api = require('axios'),
        publicar = true,
        torbox = null,
    } = deps;

    const linksExtras = Array.isArray(opcoes.links) ? opcoes.links : [];
    const candidatas = [];
    const urlsVistas = new Set();
    const adicionar = item => {
        if (!item || !item.url || urlsVistas.has(item.url)) return;
        urlsVistas.add(item.url);
        candidatas.push(item);
    };

    for (const link of linksExtras) {
        const ehManifest = /\/manifest\.json(\?|$)/i.test(link) || !/\.(m3u8|m3u)(\?|$)/i.test(link);
        adicionar({
            id: idLimpo(path.basename(link).replace(/\.m3u8?.*$/i, '') || 'lista-painel'),
            nome: `Lista colada (${new URL(link).hostname})`,
            url: link,
            ehAddon: ehManifest && typeof buscarJson === 'function',
        });
    }
    if (!opcoes.apenasLinks) {
        for (const s of SEMENTES_IPTV) adicionar(s);
        if (typeof buscarJson === 'function') {
            const doGithub = await descobrirListasGithub({ buscarJson, buscarTexto, token, registrar }).catch(() => []);
            for (const g of doGithub) adicionar(g);
            const addonsTv = await descobrirAddonsTvStremio({ buscarJson, token, registrar }).catch(() => []);
            for (const a of addonsTv) adicionar(a);
        }
    }

    registrar(`Caçada de IPTV: testando ${candidatas.length} lista(s) e addon(s) de TV ao vivo…`);
    const resultados = [];
    const todosCanaisVivos = [];
    const totalPorSetor = {};
    let listasAprovadas = 0;
    let totalTorbox = 0;

    for (const c of candidatas) {
        registrar(`  medindo ${c.nome} (${c.url})…`);
        const r = c.ehAddon
            ? await medirAddonTvStremio(c, { buscarJson, buscarTexto, torbox, limiteCanais: opcoes.limiteAmostra || 8 })
            : await medirListaIptv(c, { buscarTexto, limiteAmostra: opcoes.limiteAmostra || 6 });
        if (r.aprovada) {
            listasAprovadas++;
            totalTorbox += Number(r.prontosTorbox) || 0;
            for (const v of r.vivos || []) todosCanaisVivos.push(v);
            for (const [setor, qtd] of Object.entries(r.porSetor || {})) {
                totalPorSetor[setor] = (totalPorSetor[setor] || 0) + qtd;
            }
            if (!c.ehAddon) {
                perfisModulo.registrarLista(pastaDados, {
                    id: r.id,
                    nome: r.nome,
                    url: r.url,
                    nota: r.nota,
                    setor: r.setor,
                    canais: r.canais,
                    qualidade: r.qualidade,
                    taxaSucesso: r.taxaSucesso,
                });
            }
            registrar(`  ★ ${r.nome}: APROVADA (${r.qualidade}) — ${r.detalhe}`);
        } else {
            registrar(`  · ${r.nome}: ${r.status} — ${r.detalhe}`);
        }
        resultados.push({
            nome: r.nome,
            link: r.url,
            status: r.status,
            qualidade: r.qualidade && r.qualidade !== '—' ? `${r.qualidade} · ${ROTULO_SETOR[r.setor] || r.setor || 'TV'}` : '',
            detalhe: r.detalhe,
            aprovada: r.aprovada,
            setor: r.setor,
            canais: r.canais,
            nota: r.nota,
        });
    }

    // Grava e publica a lista consolidada de canais testados (`tv-cacador-verificados.m3u`)
    const m3uTexto = gerarM3uVerificados(todosCanaisVivos);
    try {
        fs.mkdirSync(pastaDados, { recursive: true });
        fs.writeFileSync(path.join(pastaDados, ARQUIVO_M3U_VERIFICADOS), m3uTexto, 'utf8');
    } catch { /* pasta somente leitura */ }

    if (todosCanaisVivos.length > 0) {
        perfisModulo.registrarLista(pastaDados, {
            id: 'cacador-verificados',
            nome: 'Verificados pelo caçador',
            url: URL_M3U_VERIFICADOS,
            nota: 9.5,
            setor: 'fornecedores',
            canais: todosCanaisVivos.length,
            qualidade: 'HD',
            reproducaoConfirmada: true,
        });
    }

    let publicado = false;
    if (publicar && token && (listasAprovadas > 0 || todosCanaisVivos.length > 0)) {
        await publicarM3uVerificados(m3uTexto, token, { api }).catch(() => null);
        const pubPerfis = await perfisModulo.publicar(pastaDados, token, { api }).catch(() => null);
        publicado = Boolean(pubPerfis && pubPerfis.ok);
    }

    // Sincroniza também no `perfis.json` local para o servidor/PC enxergar na hora
    try {
        require('../perfis-locais').gravar(perfisModulo.ler(pastaDados));
    } catch { /* sem perfis-locais */ }

    const resumoSetores = Object.entries(totalPorSetor)
        .sort((a, b) => b[1] - a[1])
        .map(([s, qtd]) => `${ROTULO_SETOR[s] || s}: ${qtd} canais`);

    const resumo = [
        `${listasAprovadas} de ${candidatas.length} lista(s)/addon(s) de IPTV aprovada(s) · ${todosCanaisVivos.length} canal(is) HLS confirmado(s)${totalTorbox ? ` + ${totalTorbox} transmissão(ões) pronta(s) na TorBox` : ''}.`,
        ...(resumoSetores.length ? [`Canais direcionados por setor: ${resumoSetores.join(' · ')}.`] : []),
    ];

    return {
        resumo,
        resultados,
        aprovadas: listasAprovadas,
        canaisConfirmados: todosCanaisVivos.length,
        prontosTorbox: totalTorbox,
        porSetor: totalPorSetor,
        publicado,
        m3uTexto,
    };
}

module.exports = {
    SEMENTES_IPTV,
    BUSCAS_GITHUB_IPTV,
    BUSCAS_ADDONS_TV,
    ROTULO_SETOR,
    ARQUIVO_M3U_VERIFICADOS,
    URL_M3U_VERIFICADOS,
    escolherAmostraDeCanais,
    testarCanalHls,
    medirListaIptv,
    medirAddonTvStremio,
    descobrirListasGithub,
    descobrirAddonsTvStremio,
    gerarM3uVerificados,
    publicarM3uVerificados,
    cacarIptv,
};
