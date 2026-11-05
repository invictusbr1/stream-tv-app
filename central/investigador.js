'use strict';
// INVESTIGADOR — fonte que caiu ou mudou de endereço: descobre para onde ela foi.
//
// Não é uma busca rápida: para cada fonte ele monta um DOSSIÊ juntando pistas
// de vários lugares, como um detetive, e só depois decide:
//
//   1. Redirecionamento: o endereço antigo manda para outro? (301/302, meta
//      refresh, location.href no script, link "canonical").
//   2. Recado na página antiga: "mudamos para…", "novo endereço…" e links
//      com o nome da fonte.
//   3. Certificados públicos (crt.sh): todo site https registra o certificado
//      num livro público. Domínio novo com o nome da fonte aparece lá.
//   4. Arquivo da internet (web.archive.org): a última foto do site antigo
//      costuma mostrar o recado ou o redirecionamento para o novo.
//   5. GitHub e a memória da descoberta: projetos e addons com o mesmo nome.
//   6. Variações do nome: o mesmo nome com outra terminação (.lat, .site, .top,
//      2, hd…) — só entra se o domínio existir de verdade (DNS).
//
// Cada candidato é conferido: é o MESMO fornecedor? (mesmo id do addon,
// mesmo nome no título da página, não é página de "domínio à venda"). O mais
// forte vai para a validação de sempre (dublado comprovado, HD, sem anúncio).
// Nada de login ou contornar proteção: endereço que pede conta é anotado e fica.

const fs = require('fs');
const path = require('path');
const dnsPadrao = require('dns').promises;

const TLDS = ['com', 'net', 'org', 'tv', 'cc', 'co', 'io', 'me', 'to', 'in', 'lat', 'top', 'xyz', 'site', 'online', 'bar', 'one', 'pro', 'vip', 'lol', 'club', 'fun', 'live', 'app', 'dev', 'biz', 'info', 'link', 'space', 'store', 'life', 'ink', 'plus', 'blog', 'click', 'icu', 'cfd', 'sbs', 'mov', 'com.br', 'net.br', 'tv.br'];
const GENERICOS = new Set(['www', 'addon', 'addons', 'api', 'stream', 'streams', 'player', 'embed', 'cdn', 'app', 'stremio', 'filmes', 'series', 'online', 'oficial', 'br', 'hd', 'tv', 'com', 'net', 'org', 'site', 'free', 'gratis', 'play', 'web', 'vercel', 'onrender', 'herokuapp', 'github', 'pages', 'netlify', 'workers', 'dev', 'fly']);
// Domínio de "estacionamento", à venda ou golpe (falsa verificação da Cloudflare).
const HOST_RUIM = /^ww\d+\.|expireddomains|sedoparking|parkingcrew|bodis|cloudfiare|cl0udflare|cloudflare-?verif|verification\.com|captcha-?verif|human-?verif/i;
// Conteúdo de vídeo (filmes/séries) — sem isso, nome igual é outra empresa.
const DE_VIDEO = /filmes?|s[ée]ries|assistir|epis[óo]dio|dublado|legendado|movies?|tv shows?|watch|stream|player|anime|temporada|season/i;
const ADULTO_PAGINA = /\b(porn|xxx|adult|sex|girls online|cams?|nsfw|hentai)\b/i;
const ESTACIONADO = /\bfor sale\b|domain (is )?for sale|buy this domain|this domain may be for sale|parked|sedo|dan\.com|afternic|godaddy|hugedomains|namecheap parking|domínio (está )?à venda|coming soon|index of \/|default web site page|it works!|welcome to nginx/i;
const RECADO = /(novo|nova|new)\s+(endere[cç]o|dom[ií]nio|link|url|site)|mudamos|nos mudamos|mudou(-se)?\s+para|moved\s+to|acesse\s+(agora|o novo)|agora estamos em/i;

const normalizar = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
function hostDe(url) { try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; } }

// Palavras que identificam a fonte (ex.: "fenixflix", "fenixhub", "overflix").
function marcasDoCaso(caso) {
    const marcas = new Set();
    const juntar = t => { const x = normalizar(t).replace(/[^a-z0-9]/g, ''); if (x.length >= 5 && !GENERICOS.has(x)) marcas.add(x); };
    for (const parte of normalizar(caso.nome).split(/[^a-z0-9]+/)) juntar(parte);
    juntar(normalizar(caso.nome).replace(/\b(addon|stremio|oficial|br|hd)\b/g, ''));
    for (const url of caso.enderecos || []) {
        const h = hostDe(url);
        const rotulos = h.split('.');
        rotulos.slice(0, Math.max(1, rotulos.length - (/\.(com|net|org)\.br$/.test(h) ? 2 : 1))).forEach(juntar);
    }
    return [...marcas].slice(0, 6);
}

// Domínios candidatos pelo nome (o DNS decide quem existe).
function variacoes(marcas, enderecos = []) {
    const lista = new Set();
    for (const m of marcas) {
        for (const tld of TLDS) { lista.add(`${m}.${tld}`); }
        for (const extra of ['2', '3', 'hd', 'br', 'tv', 'online', 'oficial']) for (const tld of ['com', 'net', 'online', 'site', 'lat', 'top', 'xyz', 'com.br']) lista.add(`${m}${extra}.${tld}`);
        for (const tld of ['com', 'net', 'site', 'online', 'com.br']) lista.add(`novo${m}.${tld}`);
    }
    // Mesmo "subdomínio" com outro domínio-pai (ex.: fenixflix.fenixhub.online → fenixflix.fenixhub.site).
    for (const url of enderecos) {
        const h = hostDe(url); const r = h.split('.');
        if (r.length >= 3) for (const tld of TLDS) lista.add(`${r.slice(0, -1).join('.')}.${tld}`.replace(/\.(com|net)\.br$/, '.$1.br'));
    }
    for (const url of enderecos) lista.delete(hostDe(url));
    return [...lista];
}

function dominiosNoTexto(texto, marcas) {
    const achados = new Set();
    for (const m of String(texto || '').matchAll(/\b((?:[a-z0-9-]+\.)+[a-z]{2,10})\b/gi)) {
        const d = m[1].toLowerCase().replace(/^www\./, '');
        if (marcas.some(x => d.replace(/[^a-z0-9]/g, '').includes(x))) achados.add(d);
    }
    return [...achados];
}

// ------------------------------------------------------------------ pistas
async function pistaRedirecionamento(caso, { obter, anotar }) {
    const saida = [];
    for (const url of (caso.enderecos || []).slice(0, 4)) {
        let atual; try { atual = new URL(url).href; } catch { continue; }
        for (let i = 0; i < 5; i++) {
            const r = await obter(atual, { seguir: false }).catch(e => ({ erro: e.message }));
            if (r.erro) { anotar('redirecionamento', `${hostDe(atual)} não respondeu (${String(r.erro).slice(0, 50)})`); break; }
            if (r.status >= 300 && r.status < 400 && r.location) {
                const proximo = new URL(r.location, atual).href;
                anotar('redirecionamento', `${hostDe(atual)} manda para ${hostDe(proximo)} (HTTP ${r.status})`, 5);
                if (hostDe(proximo) !== hostDe(atual)) saida.push({ dominio: hostDe(proximo), url: proximo, peso: 5, motivo: `redirecionamento de ${hostDe(atual)}` });
                atual = proximo; continue;
            }
            const texto = String(r.texto || '');
            const meta = /<meta[^>]+http-equiv=["']?refresh["']?[^>]+url=([^"'>\s]+)/i.exec(texto) || /(?:window\.)?location(?:\.href)?\s*=\s*["'](https?:\/\/[^"']+)["']/i.exec(texto) || /<link[^>]+rel=["']canonical["'][^>]+href=["'](https?:\/\/[^"']+)["']/i.exec(texto);
            if (meta) { const alvo = new URL(meta[1], atual).href; if (hostDe(alvo) !== hostDe(atual)) { saida.push({ dominio: hostDe(alvo), url: alvo, peso: 4, motivo: `a página de ${hostDe(atual)} aponta para ele` }); anotar('redirecionamento', `${hostDe(atual)} aponta para ${hostDe(alvo)} no próprio HTML`, 4); } }
            break;
        }
    }
    return saida;
}

async function pistaRecado(caso, marcas, { obter, anotar }) {
    const saida = [];
    for (const url of (caso.enderecos || []).slice(0, 4)) {
        let raiz = url; try { raiz = new URL(url).origin + '/'; } catch { continue; }
        const r = await obter(raiz, { seguir: true }).catch(() => null);
        if (!r || !r.texto) continue;
        const texto = String(r.texto);
        const temRecado = RECADO.test(texto);
        for (const d of dominiosNoTexto(texto, marcas)) {
            if (d === hostDe(raiz)) continue;
            saida.push({ dominio: d, url: `https://${d}/`, peso: temRecado ? 4 : 2, motivo: temRecado ? `recado de mudança em ${hostDe(raiz)}` : `citado na página de ${hostDe(raiz)}` });
        }
        if (temRecado) anotar('recado', `a página de ${hostDe(raiz)} tem recado de mudança`, 3);
    }
    return saida;
}

async function pistaCertificados(marcas, { buscarJson, anotar, agora = Date.now() }) {
    const saida = [];
    for (const m of marcas.slice(0, 3)) {
        const lista = await buscarJson(`https://crt.sh/?q=${encodeURIComponent('%' + m + '%')}&output=json&exclude=expired`, { tempo: 45000 }).catch(() => null);
        if (!Array.isArray(lista)) { anotar('certificados', `crt.sh não respondeu para "${m}"`); continue; }
        const porDominio = new Map();
        for (const c of lista) {
            const quando = Date.parse(c.not_before || c.entry_timestamp || '') || 0;
            for (const nome of String(c.name_value || '').split(/\s+/)) {
                const d = nome.toLowerCase().replace(/^\*\./, '').replace(/^www\./, '');
                if (!d.includes('.') || !d.replace(/[^a-z0-9]/g, '').includes(m)) continue;
                porDominio.set(d, Math.max(porDominio.get(d) || 0, quando));
            }
        }
        const recentes = [...porDominio.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25);
        for (const [d, quando] of recentes) {
            const dias = Math.round((agora - quando) / 86400000);
            saida.push({ dominio: d, url: `https://${d}/`, peso: dias <= 120 ? 3 : 1, motivo: `certificado de ${dias} dia(s) atrás` });
        }
        anotar('certificados', `"${m}": ${porDominio.size} domínio(s) com certificado; mais recente: ${recentes[0] ? recentes[0][0] : 'nenhum'}`, recentes.length ? 2 : 0);
    }
    return saida;
}

async function pistaArquivo(caso, marcas, { buscarJson, obter, anotar }) {
    const saida = [];
    for (const url of (caso.enderecos || []).slice(0, 2)) {
        const h = hostDe(url);
        if (!h) continue;
        const cdx = await buscarJson(`https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(h)}&output=json&limit=-4&fl=timestamp,original,statuscode`, { tempo: 30000 }).catch(() => null);
        const linhas = Array.isArray(cdx) ? cdx.slice(1) : [];
        if (!linhas.length) { anotar('arquivo', `sem fotos de ${h} no arquivo da internet`); continue; }
        for (const [ts, original] of linhas.slice(-3)) {
            const r = await obter(`https://web.archive.org/web/${ts}id_/${original}`, { seguir: false }).catch(() => null);
            if (!r) continue;
            if (r.location) { const d = hostDe(r.location.replace(/^https?:\/\/web\.archive\.org\/web\/\d+(id_)?\//, '')); if (d && d !== h) saida.push({ dominio: d, url: `https://${d}/`, peso: 4, motivo: `foto de ${ts.slice(0, 8)} redirecionava para ele` }); }
            for (const d of dominiosNoTexto(r.texto, marcas)) if (d !== h && !d.endsWith('archive.org')) saida.push({ dominio: d, url: `https://${d}/`, peso: RECADO.test(r.texto || '') ? 3 : 1, motivo: `citado na foto de ${ts.slice(0, 8)} de ${h}` });
        }
        anotar('arquivo', `${linhas.length} foto(s) recentes de ${h} lidas`);
    }
    return saida;
}

async function pistaGithubEMemoria(marcas, { buscarJson, token, memoria, anotar }) {
    const saida = [];
    for (const item of memoria ? memoria.itens() : []) {
        const texto = normalizar(`${item.nome} ${item.base}`).replace(/[^a-z0-9]/g, '');
        if (marcas.some(m => texto.includes(m))) saida.push({ dominio: hostDe(item.base), url: item.base, peso: 2, motivo: `mesmo nome na memória da descoberta (${item.origem})`, addon: true });
    }
    if (token) {
        for (const m of marcas.slice(0, 2)) {
            const r = await buscarJson(`https://api.github.com/search/repositories?q=${encodeURIComponent(m)}&sort=updated&per_page=10`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' } }).catch(() => null);
            for (const repo of (r && r.items) || []) {
                if (/^https:\/\//.test(repo.homepage || '') && normalizar(repo.homepage + repo.name).replace(/[^a-z0-9]/g, '').includes(m)) saida.push({ dominio: hostDe(repo.homepage), url: repo.homepage, peso: 2, motivo: `site do projeto github.com/${repo.full_name}` });
            }
        }
    }
    if (saida.length) anotar('memória/github', `${saida.length} referência(s) com o mesmo nome`, 1);
    return saida;
}

async function pistaVariacoes(caso, marcas, { resolver, anotar, limite = 400 }) {
    const lista = variacoes(marcas, caso.enderecos).slice(0, limite);
    const vivos = [];
    let i = 0;
    async function trabalhador() {
        while (i < lista.length) {
            const d = lista[i++];
            const ok = await resolver(d).then(r => Array.isArray(r) && r.length > 0).catch(() => false);
            if (ok) vivos.push(d);
        }
    }
    await Promise.all(Array.from({ length: 16 }, trabalhador));
    anotar('variações do nome', `${lista.length} domínios parecidos testados no DNS, ${vivos.length} existem`, vivos.length ? 1 : 0);
    return vivos.map(d => ({ dominio: d, url: `https://${d}/`, peso: 1, motivo: 'variação do nome que existe' }));
}

// ------------------------------------------------------------------ conferência
// O candidato é o mesmo fornecedor? Devolve nota e evidência.
async function conferir(cand, caso, marcas, { obter, buscarJson }) {
    const evid = [];
    let nota = 0, addonBase = '', manifest = null;
    const caminhos = new Set(['']);
    for (const url of caso.enderecos || []) { try { const p = new URL(url).pathname.replace(/\/(manifest\.json|stream\/.*|configure.*)$/i, '').replace(/\/+$/, ''); if (p) caminhos.add(p); } catch { /* ignora */ } }
    for (const p of caminhos) {
        const base = `https://${cand.dominio}${p}`;
        const m = await buscarJson(base + '/manifest.json').catch(() => null);
        if (m && m.id) { manifest = m; addonBase = base; break; }
    }
    if (manifest) {
        if (caso.manifestId && manifest.id === caso.manifestId) { nota += 10; evid.push('mesmo id de addon'); }
        else if (marcas.some(m => normalizar(manifest.name).replace(/[^a-z0-9]/g, '').includes(m))) { nota += 5; evid.push(`addon "${manifest.name}"`); }
        else { nota += 1; evid.push(`é addon, mas outro nome ("${String(manifest.name).slice(0, 30)}")`); }
        if (manifest.behaviorHints && manifest.behaviorHints.configurationRequired) { nota -= 3; evid.push('pede configuração'); }
    }
    const pagina = await obter(`https://${cand.dominio}/`, { seguir: true }).catch(() => null);
    const html = String(pagina && pagina.texto || '');
    const titulo = (/<title[^>]*>([^<]{0,140})/i.exec(html) || [])[1] || '';
    if (!manifest && !html) return { ...cand, nota: -1, evidencia: 'não respondeu' };
    const finalHost = hostDe(pagina && pagina.urlFinal || '');
    if (finalHost && HOST_RUIM.test(finalHost)) return { ...cand, nota: -8, evidencia: /cloudfiare|verif|captcha/i.test(finalHost) ? `redireciona para golpe (${finalHost}) — evitar` : `domínio estacionado (${finalHost})`, finalHost: '' };
    if (ESTACIONADO.test(titulo + ' ' + html.slice(0, 4000))) return { ...cand, nota: -5, evidencia: 'domínio estacionado/à venda' };
    if (ADULTO_PAGINA.test(titulo)) return { ...cand, nota: -10, evidencia: 'outro site (conteúdo adulto)' };
    const deVideo = DE_VIDEO.test(titulo + ' ' + html.slice(0, 20000).replace(/<[^>]+>/g, ' '));
    if (titulo && marcas.some(m => normalizar(titulo).replace(/[^a-z0-9]/g, '').includes(m))) {
        // Nome no título só conta se o site for de vídeo (vidora.online era uma agência).
        if (deVideo) { nota += 2; evid.push(`título "${titulo.trim().slice(0, 40)}"`); }
        else evid.push(`mesmo nome, mas não é site de vídeo ("${titulo.trim().slice(0, 30)}")`);
    }
    if (deVideo) nota += 1;
    // Site em outro idioma (clones franceses/turcos com o mesmo nome) não é o nosso.
    const lang = ((/<html[^>]*\blang=["']?([a-z]{2})/i.exec(html) || [])[1] || '').toLowerCase();
    const portugues = /assistir|filmes|s[ée]ries|dublado|legendado|epis[óo]dio|gr[áa]tis|temporada/i.test(titulo + ' ' + html.slice(0, 20000));
    if ((lang && lang !== 'pt') && !portugues) { nota -= 3; evid.push(`site em outro idioma (${lang})`); }
    // Projeto pessoal publicado de graça (vercel/netlify/github.io): quase sempre
    // é uma cópia de estudante, não o fornecedor.
    if (/\.(vercel\.app|netlify\.app|github\.io|pages\.dev)$/.test(cand.dominio) && !manifest) { nota -= 3; evid.push('projeto pessoal (cópia)'); }
    if (/login|entrar|cadastr|sign ?in/i.test(titulo)) { nota -= 2; evid.push('página de login'); }
    if (pagina && pagina.urlFinal && hostDe(pagina.urlFinal) !== cand.dominio) evid.push(`redireciona para ${hostDe(pagina.urlFinal)}`);
    return { ...cand, nota: nota + cand.peso, evidencia: evid.join(' · ') || 'responde, sem sinal claro', addonBase, urlFinal: pagina && pagina.urlFinal || cand.url, finalHost: finalHost !== cand.dominio ? finalHost : '' };
}

// ------------------------------------------------------------------ investigação
async function investigar(caso, deps) {
    const { obter, buscarJson, resolver = d => dnsPadrao.resolve(d), memoria = null, token = '', registrar = () => {}, verificarLinks = null, verificarPaginas = null, explorarSite = null, pasta = '' } = deps;
    const inicio = Date.now();
    const marcas = marcasDoCaso(caso);
    const dossie = { caso: { nome: caso.nome, enderecos: caso.enderecos, manifestId: caso.manifestId || '' }, marcas, pistas: [], candidatos: [], conclusao: '', em: new Date().toISOString() };
    const anotar = (tipo, texto, forca = 0) => { dossie.pistas.push({ tipo, texto, forca }); registrar(`  [${tipo}] ${texto}`); };
    registrar(`investigando ${caso.nome}: ${(caso.enderecos || []).map(hostDe).join(', ') || 'sem endereço antigo'} — marcas: ${marcas.join(', ') || 'nenhuma'}`);
    if (!marcas.length && !(caso.enderecos || []).length) { dossie.conclusao = 'sem nome ou endereço para investigar'; return dossie; }

    const todas = [
        ...await pistaRedirecionamento(caso, { obter, anotar }),
        ...await pistaRecado(caso, marcas, { obter, anotar }),
        ...await pistaCertificados(marcas, { buscarJson, anotar }),
        ...await pistaArquivo(caso, marcas, { buscarJson, obter, anotar }),
        ...await pistaGithubEMemoria(marcas, { buscarJson, token, memoria, anotar }),
        ...await pistaVariacoes(caso, marcas, { resolver, anotar }),
    ];
    // Junta as pistas por domínio: várias pistas independentes somam.
    const antigos = new Set((caso.enderecos || []).map(hostDe));
    const porDominio = new Map();
    for (const p of todas) {
        if (!p.dominio || antigos.has(p.dominio)) continue;
        const atual = porDominio.get(p.dominio) || { dominio: p.dominio, url: p.url, peso: 0, motivos: [] };
        atual.peso += p.peso;
        if (!atual.motivos.includes(p.motivo)) atual.motivos.push(p.motivo);
        porDominio.set(p.dominio, atual);
    }
    const fila = [...porDominio.values()].sort((a, b) => b.peso - a.peso).slice(0, 25);
    registrar(`  ${porDominio.size} domínio(s) suspeito(s); conferindo os ${fila.length} mais fortes…`);
    for (const c of fila) {
        const r = await conferir({ ...c, motivo: c.motivos.join(' + ') }, caso, marcas, { obter, buscarJson }).catch(() => ({ ...c, nota: -1, evidencia: 'erro ao conferir' }));
        dossie.candidatos.push({ dominio: r.dominio, nota: r.nota, motivo: c.motivos.join(' + '), evidencia: r.evidencia, addonBase: r.addonBase || '', url: r.urlFinal || r.url, finalHost: r.finalHost || '' });
    }
    // Convergência: vários domínios parecidos que levam ao MESMO endereço são a
    // pista mais forte de todas (ex.: vidfast.io/.me/.xyz → vidfast.vc). Clones
    // de nome, ao contrário, não levam a lugar nenhum em comum.
    const destinos = new Map();
    for (const c of dossie.candidatos) if (c.finalHost && c.nota > 0 && !antigos.has(c.finalHost)) destinos.set(c.finalHost, (destinos.get(c.finalHost) || 0) + 1);
    for (const [destino, quantos] of destinos) {
        // Um site com o nome que manda para outro endereço já é pista boa
        // (o dono mudou); vários levando ao mesmo destino é pista fortíssima.
        let alvo = dossie.candidatos.find(c => c.dominio === destino);
        if (!alvo) {
            const r = await conferir({ dominio: destino, url: `https://${destino}/`, peso: 0, motivo: '' }, caso, marcas, { obter, buscarJson }).catch(() => null);
            if (!r || r.nota < 0) continue;
            alvo = { dominio: destino, nota: r.nota, motivo: '', evidencia: r.evidencia, addonBase: r.addonBase || '', url: r.urlFinal || r.url, finalHost: '' };
            dossie.candidatos.push(alvo);
        }
        alvo.nota += 3 * Math.min(quantos, 3);
        alvo.motivo = [quantos > 1 ? `${quantos} domínios parecidos redirecionam para ele` : `${dossie.candidatos.find(c => c.finalHost === destino).dominio} redireciona para ele`, alvo.motivo].filter(Boolean).join(' + ');
        anotar('convergência', `${quantos} domínio(s) com o nome levam a ${destino}`, 4);
        // Quem só redireciona não é candidato separado.
        for (const c of dossie.candidatos) if (c.finalHost === destino) { c.nota = Math.min(c.nota, 1); c.evidencia += ` (é só um atalho para ${destino})`; }
    }
    const titulosComNome = dossie.candidatos.filter(c => /título "/.test(c.evidencia) && !c.finalHost).length;
    if (titulosComNome >= 4 && !destinos.size) { for (const c of dossie.candidatos) if (/título "/.test(c.evidencia)) { c.nota -= 1; c.evidencia += ' · pode ser clone (vários sites com o mesmo nome)'; } anotar('clones', `${titulosComNome} sites diferentes usam o nome — provavelmente cópias`, 0); }
    dossie.candidatos.sort((a, b) => b.nota - a.nota);
    const fortes = dossie.candidatos.filter(c => c.nota >= 6);
    // Os mais fortes vão para a validação de sempre (dublado, HD, sem anúncio).
    dossie.validacao = [];
    for (const c of fortes.slice(0, 3)) {
        registrar(`  ★ ${c.dominio} (nota ${c.nota}: ${c.evidencia}) — validando…`);
        let r = [];
        if (c.addonBase && typeof verificarLinks === 'function') r = await verificarLinks([c.addonBase]).catch(() => []);
        // Site de filmes: entra num filme do site e testa os players de dentro.
        else if (typeof explorarSite === 'function') r = (await explorarSite(c.url).catch(() => ({ resultados: [] }))).resultados || [];
        else if (typeof verificarPaginas === 'function') r = (await verificarPaginas([c.url]).catch(() => ({ resultados: [] }))).resultados || [];
        dossie.validacao.push(...r.map(x => ({ ...x, dominio: c.dominio })));
    }
    const aprovada = dossie.validacao.find(v => v.status === 'aprovada' || v.status === 'já ativa');
    dossie.conclusao = aprovada ? `ACHOU: ${caso.nome} está em ${aprovada.dominio} (${aprovada.status})`
        : fortes.length ? `endereço novo provável: ${fortes[0].dominio} (${fortes[0].evidencia}), mas não passou na validação`
        : dossie.candidatos.length && dossie.candidatos[0].nota > 0 ? `pistas fracas: ${dossie.candidatos.slice(0, 3).map(c => c.dominio).join(', ')}`
        : 'nenhum endereço novo encontrado';
    dossie.segundos = Math.round((Date.now() - inicio) / 1000);
    registrar(`  conclusão: ${dossie.conclusao} (${dossie.segundos}s)`);
    if (pasta) { try { fs.mkdirSync(path.join(pasta, 'investigacoes'), { recursive: true }); fs.writeFileSync(path.join(pasta, 'investigacoes', (marcas[0] || 'caso') + '.json'), JSON.stringify(dossie, null, 1)); } catch { /* segue */ } }
    return dossie;
}

// Casos automáticos: fontes do app desativadas ou que não respondem e
// fornecedores que a descoberta viu cair.
function casosAutomaticos({ fichas = [], memoria = null, descartadas = [] } = {}) {
    const casos = new Map();
    const juntar = (nome, url, extra = {}) => {
        const chave = normalizar(nome).replace(/[^a-z0-9]/g, '') || hostDe(url);
        if (!chave) return;
        const c = casos.get(chave) || { nome, enderecos: [], manifestId: '', origem: extra.origem || '' };
        if (url && !c.enderecos.includes(url)) c.enderecos.push(url);
        if (extra.manifestId && !c.manifestId) c.manifestId = extra.manifestId;
        casos.set(chave, c);
    };
    for (const f of fichas) {
        if (f.ativo !== false) continue;
        // Desligada por certificado inválido não "mudou de endereço": não investiga.
        if (/certificado/i.test(f.motivoDesligada || '')) continue;
        const url = String(f.urlMovie || f.urlTv || '').split('/stream/')[0];
        if (url) juntar(f.nome || f.id, url, { origem: 'fonte desativada' });
    }
    for (const i of memoria ? memoria.itens() : []) {
        if ((i.quedas || 0) >= 2) juntar(i.nome || i.base, i.base, { manifestId: i.manifestId, origem: 'fonte do app caiu' });
    }
    for (const nome of descartadas) juntar(nome, '', { origem: 'site antigo que sumiu' });
    return [...casos.values()];
}

// HTTP de verdade (o caçador usa este; os testes trocam por um falso).
function criarObter(axios, ua) {
    return async (url, { seguir = true } = {}) => {
        const r = await axios.get(url, { timeout: 12000, maxRedirects: seguir ? 5 : 0, responseType: 'text', transformResponse: x => x, maxContentLength: 3 * 1024 * 1024, headers: { 'User-Agent': ua, Accept: 'text/html,application/json;q=0.9,*/*;q=0.8' }, validateStatus: () => true });
        const final = r.request && r.request.res && r.request.res.responseUrl || url;
        return { status: r.status, location: r.headers && r.headers.location || '', texto: typeof r.data === 'string' ? r.data.slice(0, 400000) : '', urlFinal: final };
    };
}

module.exports = { investigar, casosAutomaticos, marcasDoCaso, variacoes, dominiosNoTexto, conferir, criarObter, TLDS };
