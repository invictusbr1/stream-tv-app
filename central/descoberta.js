'use strict';
// DESCOBERTA — a visão ampla do caçador.
//
// O caçador por título só pergunta aos addons que já conhece. A descoberta
// procura fornecedores NOVOS, todo dia, mesmo sem ninguém reclamar:
//
//   1. Memória: todo endereço visto fica registrado (de onde veio, quando foi
//      testado, o resultado e o motivo). Nada é testado duas vezes à toa; o
//      que foi recusado volta a ser testado depois de alguns dias.
//   2. Coleta de candidatos em vários lugares:
//        - os catálogos públicos de addons (os mesmos da caçada);
//        - listas/diretórios (ex.: awesome-stremio) e as que o usuário colocar
//          em central/descoberta-fontes.json;
//        - projetos no GitHub (addons brasileiros/dublados), com o token que
//          o projeto já usa;
//        - catálogos de addons que os próprios addons publicam (addon_catalog);
//        - pistas: a página de cada fornecedor achado aponta para outros.
//   3. Detetive de endereço: fonte que caiu é procurada pelo mesmo addon
//      (mesmo "id" do manifest) em outro endereço.
//   4. Exploração: os candidatos mais promissores (brasileiro/dublado,
//      novo endereço de fonte que caiu) passam por uma triagem rápida e, se
//      tiverem dublado, pela validação completa de sempre.
//
// Limites que não mudam: nada de login, conta ou contornar proteção. Addon que
// exige configuração (normalmente conta paga/debrid) é anotado e deixado de lado.

const fs = require('fs');
const path = require('path');
const cacada = require('./cacada-titulo');
const ef = require('./extrair-fornecedores');
// Endereço-base do addon (aceita stremio://, …/manifest.json, …/stream/…).
const baseDe = url => { const n = ef.normalizar(url); return n && enderecoPublico(n) ? ef.baseDeAddon(n) : ''; };
// Exemplos de README (127.0.0.1, seu_ip, 192.168…, example.com) não são addon de verdade.
function enderecoPublico(url) {
    let h; try { h = new URL(url).hostname.toLowerCase(); } catch { return false; }
    if (!/^[a-z0-9.-]+$/.test(h) || !h.includes('.') || /^\d+\.\d+\.\d+\.\d+$/.test(h) || h.startsWith('[')) return false;
    if (/(^|\.)(localhost|local|example|exemplo|test|invalid|seu-?dominio|seudominio|your-?domain|yourdomain)(\.|$)/.test(h)) return false;
    try { if (require('../seguranca').hostInterno(h)) return false; } catch { /* sem checagem extra */ }
    return true;
}

const DIA = 24 * 60 * 60 * 1000;
const TRIAGEM = 2; // sobe quando a triagem melhora: os descartados antes são revistos
const RETESTE = { 'só torrent': 60 * DIA, 'sem os títulos': 14 * DIA, 'fora do ar': 3 * DIA, 'sem dublado': 14 * DIA, recusada: 7 * DIA, 'pede configuração': 30 * DIA, 'sem vídeo': 30 * DIA, 'conta paga': 60 * DIA, erro: 2 * DIA };
const DIRETORIOS_PADRAO = [
    'https://raw.githubusercontent.com/doingodswork/awesome-stremio/master/README.md',
];
const BUSCAS_GITHUB = [
    'stremio addon dublado',
    'stremio addon brasil',
    'stremio addon pt-br',
    'stremio filmes series brasileiro',
    'stremio novelas',
    'addon stremio portugues',
];
// Filmes muito populares e dublados (animação e lançamentos): addon brasileiro
// quase sempre tem pelo menos um deles.
const AMOSTRAS_DE_TRIAGEM = [
    { tipo: 'movie', id: '27205', imdb: 'tt1375666', titulo: 'A Origem' },
    { tipo: 'movie', id: '1022789', imdb: 'tt22022452', titulo: 'Divertida Mente 2' },
    { tipo: 'movie', id: '872585', imdb: 'tt15398776', titulo: 'Oppenheimer' },
    { tipo: 'movie', id: '519182', imdb: 'tt7510222', titulo: 'Meu Malvado Favorito 4' },
    { tipo: 'movie', id: '299534', imdb: 'tt4154796', titulo: 'Vingadores: Ultimato' },
];
const PAGO = /torrent|debrid|magnet|usenet|easynews|jackett|premiumize|torbox|alldebrid|real-?debrid|offcloud/i;
const ADULTO = /adult|hentai|xxx|porn|\+18|18\+|nsfw/i;
const BRASIL = /\b(br|pt-?br|ptbr)\b|brasil|brazil|dublad|dual ?[áa]udio|portugu|nacional|novela|filmes|s[ée]ries brasileir|globo|\bsbt\b|record/i;

// ------------------------------------------------------------------ memória
function criarMemoria(pasta, { agora = () => Date.now() } = {}) {
    const arquivo = path.join(pasta, 'candidatos.json');
    let dados = { versao: 1, itens: {}, eventos: [] };
    try { const lido = JSON.parse(fs.readFileSync(arquivo, 'utf8')); if (lido && lido.itens) dados = { versao: 1, eventos: [], ...lido }; } catch { /* primeira vez */ }
    // Limpeza: endereços de exemplo não ficam; quem foi descartado por uma
    // triagem antiga (mais fraca) volta para a fila.
    for (const [base, item] of Object.entries(dados.itens)) {
        if (!enderecoPublico(base)) { delete dados.itens[base]; continue; }
        if ((item.triagem || 1) < TRIAGEM && ['sem dublado', 'fora do ar'].includes(item.status)) { item.status = 'novo'; item.testadoEm = 0; }
    }
    const gravar = () => { try { fs.mkdirSync(pasta, { recursive: true }); fs.writeFileSync(arquivo, JSON.stringify(dados)); } catch { /* segue sem memória */ } };
    function evento(tipo, base, detalhe = '') {
        dados.eventos.unshift({ em: agora(), tipo, base, detalhe: String(detalhe).slice(0, 160) });
        if (dados.eventos.length > 800) dados.eventos.length = 800;
    }
    // Junta um candidato (sem apagar o que já se sabe dele).
    function ver(c) {
        const base = baseDe(c.base || c.url || '');
        if (!base) return null;
        const atual = dados.itens[base];
        if (atual) {
            if (c.pista && !atual.pistas.includes(c.pista)) atual.pistas = [c.pista, ...atual.pistas].slice(0, 5);
            if (c.prioridade) atual.prioridade = Math.max(atual.prioridade || 0, c.prioridade);
            if (c.nome && !atual.nome) atual.nome = String(c.nome).slice(0, 60);
            if (c.descricao && !atual.descricao) atual.descricao = String(c.descricao).slice(0, 200);
            return atual;
        }
        const novo = { base, nome: String(c.nome || '').slice(0, 60), descricao: String(c.descricao || '').slice(0, 200), origem: String(c.origem || 'desconhecida').slice(0, 40), pistas: c.pista ? [String(c.pista).slice(0, 120)] : [], prioridade: Number(c.prioridade) || 0, vistoEm: agora(), testadoEm: 0, status: 'novo', motivo: '', vezes: 0 };
        dados.itens[base] = novo;
        evento('visto', base, novo.origem);
        return novo;
    }
    function anotar(base, status, motivo = '', extra = {}) {
        const item = dados.itens[base] || ver({ base, origem: 'teste' });
        if (!item) return;
        Object.assign(item, extra, { status, motivo: String(motivo || '').slice(0, 160), testadoEm: agora(), vezes: (item.vezes || 0) + 1, triagem: TRIAGEM });
        evento(status, base, motivo);
    }
    return { dados: () => dados, itens: () => Object.values(dados.itens), item: b => dados.itens[b], ver, anotar, evento, gravar };
}

// Nota de prioridade: brasileiro/dublado, novo endereço de fonte que caiu e
// nunca testado vêm primeiro; o que exige conta paga vai para o fim.
function pontuar(item, { agora = Date.now() } = {}) {
    const texto = `${item.nome || ''} ${item.descricao || ''} ${item.base || ''}`;
    let nota = Number(item.prioridade) || 0;
    if (BRASIL.test(texto)) nota += 5;
    if (PAGO.test(texto)) nota -= 8;
    // Português de Portugal (PT-PT) raramente tem a dublagem brasileira.
    if (/pt-?pt|portugal|portuguesas|\btuga\b/i.test(texto) && !/pt-?br|brasil/i.test(texto)) nota -= 4;
    if (item.status === 'novo') nota += 3;
    if ((item.pistas || []).length) nota += 1;
    if (item.status !== 'novo' && agora - Number(item.testadoEm || 0) > 30 * DIA) nota += 1;
    return nota;
}

function prontoParaTestar(item, { agora = Date.now() } = {}) {
    if (!item || item.status === 'aprovada' || item.status === 'já ativa') return false;
    if (item.status === 'novo') return true;
    return agora - Number(item.testadoEm || 0) >= (RETESTE[item.status] || 7 * DIA);
}

// ------------------------------------------------------------------ coleta
async function coletarCatalogos(memoria, { buscarJson, pastaDados, registrar = () => {} }) {
    const addons = await cacada.carregarCatalogo({ buscarJson, pastaDados, registrar }).catch(() => []);
    let n = 0;
    for (const a of addons) if (memoria.ver({ base: a.base, nome: a.nome, origem: 'catálogo', prioridade: a.brasileiro ? 2 : 0 })) n++;
    return n;
}

// Diretórios: JSON (lista de addons) ou texto/HTML com links de manifest.
async function coletarDiretorios(memoria, { buscarTexto, diretorios = DIRETORIOS_PADRAO, registrar = () => {} }) {
    const { extrairDoTexto } = require('./extrair-fornecedores');
    let total = 0;
    for (const url of diretorios) {
        const texto = await buscarTexto(url).catch(() => '');
        if (!texto) { registrar(`diretório ${url} não respondeu`); continue; }
        let achados = [];
        try {
            const j = JSON.parse(texto);
            const lista = Array.isArray(j) ? j : Array.isArray(j.addons) ? j.addons : [];
            achados = lista.map(e => ({ base: baseDe(e.transportUrl || e.url || e.manifestUrl || ''), nome: e.manifest && e.manifest.name || e.name, descricao: e.manifest && e.manifest.description || e.description }));
        } catch {
            achados = extrairDoTexto(texto, url).addons.map(base => ({ base }));
            // Listas em texto costumam linkar a página do addon (não o manifest):
            // vira candidato também; a triagem pergunta pelo /manifest.json.
            for (const m of texto.matchAll(/https:\/\/[a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s)\]"'<>]*)?/gi)) {
                const link = m[0].replace(/[.,;:!?]+$/, '');
                if (!ef.util(link) || /\.(png|jpe?g|gif|svg|webp|md|zip|7z|exe|apk)(\?|$)/i.test(link)) continue;
                achados.push({ base: link.replace(/\/(configure|install)(\/.*)?$/i, '') });
            }
        }
        let n = 0;
        for (const a of achados) if (a.base && memoria.ver({ ...a, origem: 'diretório', pista: url })) n++;
        registrar(`diretório ${new URL(url).hostname}: ${n} endereço(s)`);
        total += n;
    }
    return total;
}

// GitHub: repositórios de addons brasileiros. O endereço publicado costuma
// estar no "homepage" do projeto ou no README.
async function coletarGithub(memoria, { buscarJson, buscarTexto, token = '', buscas = BUSCAS_GITHUB, registrar = () => {} }) {
    if (!token) { registrar('GitHub: sem token (.streamtv\\github-token.txt) — pulei'); return 0; }
    const { extrairDoTexto } = require('./extrair-fornecedores');
    const cab = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' };
    const vistos = new Set();
    let total = 0;
    for (const q of buscas) {
        const r = await buscarJson(`https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=updated&per_page=20`, { headers: cab }).catch(() => null);
        for (const repo of (r && Array.isArray(r.items) ? r.items : [])) {
            if (vistos.has(repo.full_name) || repo.archived) continue;
            vistos.add(repo.full_name);
            const pista = 'github.com/' + repo.full_name;
            const textoRepo = `${repo.name} ${repo.description || ''}`;
            if (ADULTO.test(textoRepo)) continue;
            if (/^https:\/\//i.test(repo.homepage || '')) { if (memoria.ver({ base: repo.homepage, nome: repo.name, descricao: repo.description, origem: 'github', pista, prioridade: 1 })) total++; }
            if (vistos.size > 60) continue;
            const readme = await buscarTexto(`https://raw.githubusercontent.com/${repo.full_name}/${repo.default_branch || 'main'}/README.md`).catch(() => '');
            for (const base of readme ? extrairDoTexto(readme, 'https://github.com/' + repo.full_name).addons : []) {
                if (memoria.ver({ base, nome: repo.name, descricao: repo.description, origem: 'github', pista, prioridade: 1 })) total++;
            }
        }
    }
    registrar(`GitHub: ${vistos.size} projeto(s) olhados, ${total} endereço(s)`);
    return total;
}

// Lista da comunidade (Stremio-Community/stremio-addons-list): cada addon
// enviado ao catálogo stremio-addons.net vira uma "issue" com o endereço do
// manifest. Busca as brasileiras/dubladas mais novas — é por aqui que addon
// novo aparece primeiro. Funciona sem token (limite baixo, uma vez por dia).
const BUSCAS_LISTA_COMUNIDADE = ['dublado', 'brasil', 'pt-br', 'brazuca', 'portugues', 'português', 'nacional', 'novelas', 'legendado'];
async function coletarListaComunidade(memoria, { buscarJson, token = '', buscas = BUSCAS_LISTA_COMUNIDADE, registrar = () => {} }) {
    const cab = { Accept: 'application/vnd.github+json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
    const vistas = new Set();
    let total = 0;
    for (const termo of buscas) {
        const q = `repo:Stremio-Community/stremio-addons-list ${termo}`;
        const r = await buscarJson(`https://api.github.com/search/issues?q=${encodeURIComponent(q)}&sort=created&order=desc&per_page=30`, { headers: cab }).catch(() => null);
        for (const issue of (r && Array.isArray(r.items) ? r.items : [])) {
            if (vistas.has(issue.number)) continue;
            vistas.add(issue.number);
            const etiquetas = (issue.labels || []).map(l => String(l.name || l)).join(',');
            // Recusada pelo catálogo (inativa, endereço inválido/fora do ar) não vale testar.
            if (/inactive|invalid|unreachable/i.test(etiquetas)) continue;
            const texto = `${issue.title || ''} ${issue.body || ''}`;
            if (ADULTO.test(texto)) continue;
            for (const m of String(issue.body || '').match(/https?:\/\/[^\s)"'<>\]]+\/manifest\.json/g) || []) {
                const base = baseDe(m);
                if (base && memoria.ver({ base, nome: String(issue.title || '').slice(0, 80), descricao: String(issue.body || '').replace(/\s+/g, ' ').slice(0, 200), origem: 'lista-comunidade', pista: `stremio-addons-list#${issue.number}`, prioridade: 1 })) total++;
            }
        }
    }
    registrar(`Lista da comunidade (stremio-addons.net): ${vistas.size} addon(s) olhados, ${total} endereço(s) novo(s)`);
    return total;
}

// Pistas: a página de quem já foi aprovado (ou promete) aponta para outros.
async function coletarPistas(memoria, { buscarTexto, limite = 6, registrar = () => {} }) {
    const { extrairFornecedores } = require('./extrair-fornecedores');
    const fontes = memoria.itens().filter(i => ['aprovada', 'já ativa', 'promissora'].includes(i.status) && !i.pistasLidasEm).slice(0, limite);
    let total = 0, players = [];
    for (const item of fontes) {
        let origem = item.base; try { origem = new URL(item.base).origin + '/'; } catch { /* base inválida */ }
        const ex = await extrairFornecedores(origem, { buscarTexto }).catch(() => null);
        item.pistasLidasEm = Date.now();
        if (!ex) continue;
        for (const base of ex.addons) if (base !== item.base && memoria.ver({ base, origem: 'pista', pista: 'página de ' + (item.nome || item.base), prioridade: 2 })) total++;
        players = players.concat(ex.players);
    }
    if (fontes.length) registrar(`pistas: ${fontes.length} página(s) lidas, ${total} endereço(s) novos, ${players.length} player(s)`);
    return { total, players };
}

// ------------------------------------------------------------------ detetive
const normalizarNome = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').replace(/\b(addon|stremio|br|hd)\b/g, ' ').trim();

// Para cada fonte do app, guarda o "id" do manifest. Se a fonte caiu, um
// candidato com o mesmo id (ou o mesmo nome) em outro endereço vira
// prioridade máxima — é o mesmo fornecedor de casa nova.
async function detetive(memoria, { fichas = [], buscarJson, registrar = () => {} }) {
    const pistas = [];
    for (const f of fichas.filter(x => x && x.stremio !== false && (x.urlMovie || x.urlTv))) {
        const base = String(f.urlTv || f.urlMovie).split('/stream/')[0];
        const item = memoria.ver({ base, nome: f.nome, origem: 'fonte do app' });
        if (!item) continue;
        if (f.ativo !== false && item.manifestId && Date.now() - Number(item.conferidoEm || 0) < DIA) continue;
        const m = await buscarJson(base + '/manifest.json').catch(() => null);
        item.conferidoEm = Date.now();
        if (m && m.id) { item.manifestId = String(m.id).slice(0, 120); item.quedas = 0; if (item.status === 'novo') item.status = f.ativo === false ? 'recusada' : 'já ativa'; continue; }
        item.quedas = (item.quedas || 0) + 1;
        if (item.quedas < 2 && f.ativo !== false) continue;
        // Caiu: procura o mesmo addon em outro endereço.
        const alvoId = item.manifestId, alvoNome = normalizarNome(f.nome);
        for (const outro of memoria.itens()) {
            if (outro.base === base) continue;
            const mesmo = (alvoId && outro.manifestId === alvoId) || (alvoNome.length >= 4 && normalizarNome(outro.nome) === alvoNome);
            if (!mesmo) continue;
            outro.prioridade = Math.max(outro.prioridade || 0, 20);
            outro.pistas = [`novo endereço de ${f.nome}`, ...(outro.pistas || [])].slice(0, 5);
            if (outro.status !== 'aprovada') outro.status = 'novo';
            pistas.push({ de: base, para: outro.base, nome: f.nome });
            memoria.evento('mudou de endereço?', outro.base, `${f.nome}: ${base} → ${outro.base}`);
        }
    }
    if (pistas.length) registrar(`detetive: ${pistas.length} possível(is) endereço(s) novo(s) de fonte que caiu`);
    return pistas;
}

// ------------------------------------------------------------------ exploração
// Triagem rápida (manifest + 3 títulos) e, se tiver dublado, validação completa.
async function triar(item, { buscarJson, amostras }) {
    const m = await buscarJson(item.base + '/manifest.json').catch(() => null);
    if (!m || typeof m !== 'object' || !m.id) return { status: 'fora do ar', motivo: 'o endereço não respondeu como addon' };
    const extra = { manifestId: String(m.id).slice(0, 120), nome: String(m.name || item.nome || '').slice(0, 60), descricao: String(m.description || item.descricao || '').slice(0, 200) };
    const recursos = JSON.stringify(m.resources || '');
    const tipos = Array.isArray(m.types) ? m.types.map(String) : [];
    // Addon que lista outros addons: tudo o que ele lista vira candidato.
    const catalogosDeAddons = Array.isArray(m.addonCatalogs) ? m.addonCatalogs : [];
    if (ADULTO.test(`${m.name} ${m.description}`)) return { status: 'sem vídeo', motivo: 'conteúdo adulto', extra };
    if (PAGO.test(`${m.name} ${m.id} ${m.description || ''}`)) return { status: 'conta paga', motivo: 'precisa de conta paga (torrent/debrid)', extra, catalogosDeAddons };
    if (m.behaviorHints && m.behaviorHints.configurationRequired) return { status: 'pede configuração', motivo: 'o addon pede configuração/conta antes de usar', extra, catalogosDeAddons };
    if (!/stream/.test(recursos) || !tipos.some(t => t === 'movie' || t === 'series')) return { status: 'sem vídeo', motivo: 'não entrega filmes/séries', extra, catalogosDeAddons };
    const tiposDoAddon = tipos.filter(t => t === 'movie' || t === 'series');
    // Addon de anime: os títulos de teste incluem animes dublados.
    if (cacada.addonDeAnime(m)) amostras = [...cacada.ANIMES_POPULARES.slice(0, 3), ...amostras];
    // Addon que se declara dublado/brasileiro: stream sem etiqueta também
    // conta (a validação completa ainda exige o áudio em português COMPROVADO).
    const declaraDublado = /dublad|dual ?[áa]udio|pt-?br|🇧🇷|brasil/i.test(`${m.name || ''} ${m.description || ''}`) && !/legendad|pt-?pt|portugal/i.test(`${m.name || ''} ${m.description || ''}`);
    let comTitulo = 0, soTorrent = 0, http = 0;
    for (const alvo of amostras) {
        if (!tiposDoAddon.includes(alvo.tipo === 'tv' ? 'series' : 'movie')) continue;
        const imdb = alvo.imdb;
        if (!imdb) continue;
        const caminho = alvo.tipo === 'tv' ? `/stream/series/${imdb}:${alvo.temporada || 1}:${alvo.episodio || 1}.json` : `/stream/movie/${imdb}.json`;
        const dados = await buscarJson(item.base + caminho).catch(() => null);
        const streams = dados && Array.isArray(dados.streams) ? dados.streams : [];
        if (!streams.length) continue;
        comTitulo++;
        const diretos = streams.filter(x => x && typeof x.url === 'string' && /^https?:\/\//i.test(x.url));
        if (streams.some(x => PAGO.test(`${x && x.name || ''} ${x && (x.title || x.description) || ''}`))) return { status: 'conta paga', motivo: 'entrega pelo TorBox/Real-Debrid de outra pessoa (conta paga configurada no endereço)', extra, catalogosDeAddons };
        if (!diretos.length) { if (streams.some(x => x && (x.infoHash || /^magnet:/i.test(String(x.url || ''))))) soTorrent++; continue; }
        http++;
        if (cacada.streamsUteis(diretos).length) return { status: 'promissora', motivo: `tem "${alvo.titulo}" com rótulo dublado`, extra, catalogosDeAddons };
        if (declaraDublado) return { status: 'promissora', motivo: `tem "${alvo.titulo}" e o addon se declara dublado`, extra, catalogosDeAddons };
    }
    if (!comTitulo) return { status: 'sem os títulos', motivo: `não tem nenhum dos ${amostras.length} títulos populares de teste`, extra, catalogosDeAddons };
    if (!http && soTorrent) return { status: 'só torrent', motivo: 'só entrega torrent (o app não toca torrent)', extra, catalogosDeAddons };
    return { status: 'sem dublado', motivo: `tem ${comTitulo} dos títulos, mas sem versão dublada`, extra, catalogosDeAddons };
}

async function lerCatalogosDeAddons(memoria, item, catalogos, { buscarJson }) {
    let n = 0;
    for (const c of catalogos.slice(0, 3)) {
        if (!c || !c.type || !c.id) continue;
        const dados = await buscarJson(`${item.base}/addon_catalog/${encodeURIComponent(c.type)}/${encodeURIComponent(c.id)}.json`).catch(() => null);
        for (const e of (dados && Array.isArray(dados.addons) ? dados.addons : []).slice(0, 300)) {
            const base = baseDe(e.transportUrl || '');
            if (base && memoria.ver({ base, nome: e.manifest && e.manifest.name, descricao: e.manifest && e.manifest.description, origem: 'lista de addon', pista: 'listado por ' + (item.nome || item.base) })) n++;
        }
    }
    return n;
}

async function explorar(memoria, deps, { quantos = 6, agora = Date.now() } = {}) {
    const { buscarJson, registrar = () => {} } = deps;
    const novelas = await cacada.novelasAtuais(buscarJson).catch(() => cacada.NOVELAS_FIXAS);
    const amostras = [...AMOSTRAS_DE_TRIAGEM, novelas[0], cacada.SERIES_POPULARES[0], cacada.SERIES_POPULARES[1]].filter(Boolean);
    const fila = memoria.itens().filter(i => prontoParaTestar(i, { agora })).sort((a, b) => pontuar(b, { agora }) - pontuar(a, { agora }));
    const escolhidos = fila.slice(0, quantos);
    registrar(`exploração: ${fila.length} candidato(s) na fila, testando ${escolhidos.length}`);
    const resultados = [];
    for (const item of escolhidos) {
        const t = await triar(item, { buscarJson, amostras }).catch(e => ({ status: 'erro', motivo: String(e.message || e).slice(0, 80) }));
        if (t.catalogosDeAddons && t.catalogosDeAddons.length) {
            const n = await lerCatalogosDeAddons(memoria, item, t.catalogosDeAddons, { buscarJson }).catch(() => 0);
            if (n) registrar(`  ${item.nome || item.base} lista outros addons: ${n} candidato(s) novo(s)`);
        }
        if (t.status !== 'promissora') {
            memoria.anotar(item.base, t.status, t.motivo, t.extra || {});
            registrar(`  · ${t.extra && t.extra.nome || item.base}: ${t.status} — ${t.motivo}`);
            resultados.push({ link: item.base, nome: t.extra && t.extra.nome || item.base, status: t.status, detalhe: t.motivo });
            continue;
        }
        registrar(`  ★ ${t.extra.nome}: ${t.motivo} — validando de verdade…`);
        const [r] = await cacada.verificarLinks([item.base], deps).catch(e => [{ status: 'recusada', detalhe: String(e.message || e).slice(0, 80) }]);
        const status = r && r.status === 'aprovada' ? 'aprovada' : r && r.status === 'já ativa' ? 'já ativa' : 'recusada';
        memoria.anotar(item.base, status, r && (r.detalhe || r.qualidade) || t.motivo, t.extra);
        resultados.push({ link: item.base, nome: t.extra.nome, status: r ? r.status : 'recusada', qualidade: r && r.qualidade, detalhe: r && r.detalhe || t.motivo });
    }
    memoria.gravar();
    return resultados;
}

// ------------------------------------------------------------------ relatório
function relatorio(memoria, { dias = 7, agora = Date.now() } = {}) {
    const desde = agora - dias * DIA;
    const itens = memoria.itens();
    const eventos = memoria.dados().eventos.filter(e => e.em >= desde);
    const contar = tipo => eventos.filter(e => e.tipo === tipo).length;
    const porStatus = {};
    for (const i of itens) porStatus[i.status] = (porStatus[i.status] || 0) + 1;
    const porOrigem = {};
    for (const i of itens) porOrigem[i.origem] = (porOrigem[i.origem] || 0) + 1;
    const testados = itens.filter(i => i.testadoEm >= desde).sort((a, b) => b.testadoEm - a.testadoEm);
    return {
        dias, conhecidos: itens.length, vistosNoPeriodo: contar('visto'), testadosNoPeriodo: testados.length,
        aprovadasNoPeriodo: testados.filter(i => i.status === 'aprovada').length,
        naFila: itens.filter(i => prontoParaTestar(i, { agora })).length,
        porStatus, porOrigem,
        mudancas: eventos.filter(e => e.tipo === 'mudou de endereço?').slice(0, 10),
        ultimos: testados.slice(0, 60).map(i => ({ link: i.base, nome: i.nome || i.base, status: i.status, detalhe: i.motivo, origem: i.origem })),
    };
}

module.exports = {
    baseDe, enderecoPublico, AMOSTRAS_DE_TRIAGEM, criarMemoria, pontuar, prontoParaTestar, coletarCatalogos, coletarDiretorios, coletarGithub, coletarListaComunidade, coletarPistas,
    detetive, triar, explorar, relatorio, normalizarNome, DIRETORIOS_PADRAO, BUSCAS_GITHUB, RETESTE,
};
