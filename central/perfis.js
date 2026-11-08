'use strict';
// Fichas de fonte da central — é aqui que um fornecedor medido vira fornecedor
// USÁVEL pelo aplicativo, sem ninguém escrever código.
//
// O caminho completo:
//   1. o caçador encontra um candidato e MEDE (reprodução, idioma, anúncio);
//   2. `inferirDePagina` / `inferirDeStremio` descobrem COMO pedir o vídeo
//      daquele fornecedor (endereço por título + regra de leitura);
//   3. `validar` testa a ficha em títulos que NÃO serviram de exemplo — se não
//      funcionar em pelo menos dois, a ficha é descartada;
//   4. as fichas aprovadas ficam em `dados/perfis.json` e são publicadas no
//      GitHub, para o computador e o celular lerem o mesmo arquivo.
//
// Nada de ficha "no escuro": só entra o que foi medido com áudio em português
// (ou alta definição com legenda, que é a segunda regra) e sem anúncio.

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const motor = require('../perfis-motor');
const varredor = require('./varredor');
const { sondagemRapida } = require('./verificar-midia');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const REPOSITORIO = 'invictusbr1/stream-tv-atualizacoes';
const ARQUIVO_PUBLICADO = 'perfis.json';

function arquivo(pastaDados) {
    return path.join(pastaDados || path.join(__dirname, 'dados'), 'perfis.json');
}

function ler(pastaDados) {
    try {
        const dados = JSON.parse(fs.readFileSync(arquivo(pastaDados), 'utf8'));
        return {
            atualizadoEm: dados.atualizadoEm || '',
            perfis: Array.isArray(dados.perfis) ? dados.perfis : [],
            listasTv: Array.isArray(dados.listasTv) ? dados.listasTv : [],
            placar: Array.isArray(dados.placar) ? dados.placar : [],
            listasTorbox: Array.isArray(dados.listasTorbox) ? dados.listasTorbox : [],
        };
    } catch { return { atualizadoEm: '', perfis: [], listasTv: [], placar: [], listasTorbox: [] }; }
}

function gravar(pastaDados, dados) {
    let temporario = '';
    try {
        const destino = arquivo(pastaDados);
        fs.mkdirSync(path.dirname(destino), { recursive: true });
        temporario = destino + '.tmp-' + process.pid;
        fs.writeFileSync(temporario, JSON.stringify({
            atualizadoEm: new Date().toISOString(),
            perfis: dados.perfis || [],
            listasTv: dados.listasTv || [],
            placar: dados.placar || [],
            listasTorbox: dados.listasTorbox || [],
        }, null, 1));
        fs.renameSync(temporario, destino);
        return true;
    } catch {
        if (temporario) { try { fs.unlinkSync(temporario); } catch { /* sem arquivo temporário */ } }
        return false;
    }
}

function listar(pastaDados) { return ler(pastaDados).perfis; }

// ---------------------------------------------------------------- inferência
// Troca o número do título (e a temporada/episódio) por marcadores, virando o
// "molde" do endereço daquele fornecedor.
function modeloDeUrl(url, alvo) {
    let modelo = String(url || '');
    const trocar = (valor, marca) => {
        if (!valor) return;
        const escapado = String(valor).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regra = new RegExp('(^|[^0-9])' + escapado + '([^0-9]|$)');
        modelo = modelo.replace(regra, '$1' + marca + '$2');
    };
    trocar(alvo.temporada, '{temporada}');
    trocar(alvo.episodio, '{episodio}');
    trocar(alvo.imdb, '{imdb}');
    trocar(alvo.tmdbId, '{id}');
    return modelo;
}

// Descobre a "chave" que vem logo antes do endereço do vídeo na página
// (file:, source:, src="...). A regra gerada tolera espaço e o sinal de igual
// ou dois-pontos, porque o mesmo site escreve de formas diferentes.
function padraoPara(texto, endereco) {
    const bruto = String(endereco || '');
    if (!bruto) return null;
    const formas = [bruto, bruto.replace(/\//g, '\\/')];
    for (const forma of formas) {
        const indice = String(texto || '').indexOf(forma);
        if (indice < 0) continue;
        const antes = texto.slice(Math.max(0, indice - 80), indice);
        const achado = /([A-Za-z_$][\w$.-]{0,40})["']?\s*[:=]\s*(["']?)$/.exec(antes);
        if (!achado) continue;
        const chave = achado[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const abertura = achado[2] ? achado[2].replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : '["\']';
        // O nome da chave pode vir entre aspas quando a página usa JSON
        // ("file":"…"), então a regra aceita as duas formas.
        const padrao = chave + '\\s*["\']?\\s*[:=]\\s*' + abertura + '([^"\'\\s<>]+)';
        const teste = new RegExp(padrao, 'i').exec(texto);
        if (teste && teste[1] && /^https?:/i.test(motor.aplicarPasso({ tipo: 'regex', padrao, grupo: 1 }, texto, ''))) return padrao;
    }
    return null;
}

// Endereços de player costumam estar num iframe; nesse caso a ficha leva dois
// passos: a página → o player → o vídeo.
function padraoDeIframe(html) {
    const achado = /<iframe[^>]+src\s*=\s*["']([^"']+)["']/i.exec(String(html || ''));
    if (!achado) return null;
    const endereco = achado[1];
    if (!/^https?:|^\/\//.test(endereco)) return null;
    const host = (/(?:\/\/)([^/]+)/.exec(endereco) || [])[1] || '';
    if (host && /(google|gstatic|cloudflare|jsdelivr|unpkg|facebook|twitter|whatsapp|disqus|histats|doubleclick|youtube)/i.test(host)) return null;
    return { endereco, padrao: '(<iframe[^>]+src\\s*=\\s*["\'])([^"\']+)(["\'])' };
}

// Monta a ficha a partir de uma página medida. `video` é o endereço que o
// caçador conseguiu reproduzir; `html` é a página de onde ele saiu.
function inferirDePagina({ candidata, html, video }) {
    const alvo = candidata.alvo || {};
    const modeloUrl = modeloDeUrl(candidata.url, alvo);
    if (!/\{id\}|\{imdb\}/.test(modeloUrl)) return null;
    const anuncios = varredor.sinaisDeAnuncio(html);
    if (anuncios.length) return null; // regra do projeto: sem anúncio
    const base = {
        id: String(candidata.nome || 'fonte').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'fonte',
        nome: candidata.nome || 'Fonte descoberta',
        nota: 0,
        dublado: Boolean(candidata.dublado),
        qualidade: candidata.qualidade || '',
        tipos: [],
        referer: (() => { try { return new URL(candidata.url).origin + '/'; } catch { return ''; } })(),
        origem: candidata.origem || 'caçador',
        ativo: false,
        medidoEm: new Date().toISOString(),
        evidencia: candidata.motivo || '',
    };
    if (alvo.tipo === 'tv') { base.urlTv = modeloUrl; base.tipos.push('tv'); } else { base.urlMovie = modeloUrl; base.tipos.push('movie'); }
    const padrao = padraoPara(html, video);
    if (padrao) {
        base.passos = [{ tipo: 'regex', padrao, grupo: 1, juntarComBase: true }];
        return base;
    }
    const iframe = padraoDeIframe(html);
    if (!iframe) return null;
    base.passos = [
        { tipo: 'regex', padrao: iframe.padrao, grupo: 2, juntarComBase: true },
        { tipo: 'regex', padrao: 'file\\s*[:=]\\s*["\']([^"\']+)', grupo: 1, juntarComBase: true },
    ];
    return base;
}

// Ficha de addon do Stremio: o endereço responde JSON com a lista de vídeos.
function inferirDeStremio({ candidata, imdbServico, modelo: modeloPronto }) {
    const url = String(candidata.url || '');
    const alvo = candidata.alvo || {};
    const modelo = modeloPronto || modeloDeUrl(url, { ...alvo, imdb: imdbServico || alvo.imdb });
    if (!/\{imdb\}/.test(modelo)) return null;
    const anuncios = varredor.sinaisDeAnuncio(JSON.stringify(candidata.detalhes || {}));
    if (anuncios.length) return null;
    return {
        id: String(candidata.nome || 'addon').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'addon',
        nome: candidata.nome || 'Addon descoberto',
        nota: 0,
        dublado: Boolean(candidata.dublado),
        qualidade: candidata.qualidade || '',
        tipos: alvo.tipo === 'tv' ? ['tv'] : ['movie'],
        referer: (() => { try { return new URL(url).origin + '/'; } catch { return ''; } })(),
        origem: candidata.origem || 'addon do Stremio',
        stremio: true,
        ativo: false,
        medidoEm: new Date().toISOString(),
        passos: [{ tipo: 'json', caminho: 'streams[0].url' }],
        ...(alvo.tipo === 'tv' ? { urlTv: modelo } : { urlMovie: modelo }),
    };
}

async function buscarTexto(endereco, referer = '') {
    const resposta = await require('./rede-cacador').get(endereco, {
        timeout: 15000, responseType: 'text', maxRedirects: 4,
        maxContentLength: 3 * 1024 * 1024, validateStatus: s => s < 400,
        headers: { 'User-Agent': UA, ...(referer ? { Referer: referer } : {}) },
    });
    return String(resposta.data || '');
}

// ---------------------------------------------------------------- validação
// Testa a ficha em títulos que não foram usados para criá-la. Só passa quem
// abre de verdade em pelo menos dois deles.
async function validar(ficha, amostras, { buscar = buscarTexto, sondar = sondagemRapida, registrar = () => {}, confirmarIdioma = null } = {}) {
    const provas = [];
    const titulosVistos = new Set();
    const videosVistos = new Set();
    for (const amostra of (Array.isArray(amostras) ? amostras : [])) {
        // Addons do Stremio são pedidos pelo CÓDIGO IMDb. Quando a amostra já é
        // um código (tt123…), ele vale como o próprio identificador — sem isso
        // o endereço saía com o campo vazio e a ficha era recusada por engano.
        const imdb = amostra.imdb || (/^tt\d+$/.test(String(amostra.id)) ? String(amostra.id) : '');
        const alvo = amostra.tipo === 'tv'
            ? { tipo: 'tv', tmdbId: String(amostra.id), temporada: String(amostra.temporada || 1), episodio: String(amostra.episodio || 1), imdb }
            : { tipo: 'movie', tmdbId: String(amostra.id), imdb };
        // Repetir a mesma série ou filme não oferece uma segunda prova, mesmo
        // quando outro episódio ou nome foi usado na amostra.
        const chave = alvo.tipo + ':' + (imdb || alvo.tmdbId);
        if (titulosVistos.has(chave)) continue;
        titulosVistos.add(chave);
        if (provas.length >= 3) break;
        // Addon com vários servidores para o mesmo título (ex.: BestCine com 11
        // espelhos): o primeiro pode estar fora e o terceiro funcionar. O app já
        // tenta todos (resolverTodos); a validação testa do mesmo jeito.
        let opcoes = [];
        if (typeof motor.resolverTodos === 'function') opcoes = await motor.resolverTodos(ficha, alvo, { buscar }).catch(() => []);
        if (!Array.isArray(opcoes) || !opcoes.length) { const unica = await motor.resolver(ficha, alvo, { buscar }).catch(() => null); opcoes = unica ? [unica] : []; }
        if (!opcoes.length) { provas.push({ amostra: amostra.titulo, ok: false, motivo: 'não achei o vídeo' }); continue; }
        // Uma página que sempre entrega a mesma prévia não comprova catálogo.
        if (opcoes.every(o => videosVistos.has(o.url))) { provas.push({ amostra: amostra.titulo, ok: false, motivo: 'o mesmo vídeo foi devolvido para outro título' }); continue; }
        let pronto = null, sonda = null;
        for (const opcao of opcoes.filter(o => !videosVistos.has(o.url)).slice(0, 4)) {
            const medida = await sondar(opcao.url, opcao.referer).catch(() => null);
            if (!pronto || (medida && medida.viva && !(sonda && sonda.viva))) { pronto = opcao; sonda = medida; }
            if (medida && medida.viva && (Number(medida.altura) || 0) >= 720 && medida.dublado !== false) { pronto = opcao; sonda = medida; break; }
        }
        videosVistos.add(pronto.url);
        const viva = Boolean(sonda && sonda.viva);
        const altura = Math.max(0, Number(sonda && sonda.altura) || 0);
        let dublado = sonda && typeof sonda.dublado === 'boolean' ? sonda.dublado : null;
        // Arquivo sem etiqueta de idioma: confirma ouvindo o áudio (transcrição),
        // nunca acreditando só no rótulo do fornecedor.
        if (viva && dublado === null && typeof confirmarIdioma === 'function') {
            const ouvido = await confirmarIdioma(pronto, amostra).catch(() => null);
            if (typeof ouvido === 'boolean') { dublado = ouvido; if (sonda) sonda.evidencia = ouvido ? 'áudio ouvido em português (transcrição)' : 'áudio ouvido em outro idioma'; }
        }
        const atendePadrao = viva && altura >= 720 && dublado === true && !sonda.avisoAudio;
        const motivo = !viva ? (sonda && sonda.certificadoInvalido ? 'o servidor do vídeo tem certificado https inválido (o celular não toca)' : 'o endereço não devolveu vídeo')
            : sonda.avisoAudio ? 'o áudio não é compatível com o player'
            : altura < 720 ? 'alta definição não comprovada'
            : dublado !== true ? 'áudio em português não comprovado'
            : '';
        provas.push({
            amostra: amostra.titulo, ok: viva, url: pronto.url,
            altura, dublado, atendePadrao,
            evidencia: sonda ? sonda.evidencia : '',
            motivo,
        });
        registrar(`ficha ${ficha.nome}: ${amostra.titulo} → ${atendePadrao ? 'HD com áudio em português' : motivo}`);
    }
    const abertas = provas.filter(p => p.ok);
    const aprovadas = abertas.filter(p => p.atendePadrao);
    if (aprovadas.length < 2 || abertas.some(p => !p.atendePadrao)) {
        return { aprovada: false, emAnalise: abertas.length > 0, motivo: 'faltam duas provas independentes em HD com áudio em português', provas, ajustes: { ativo: false } };
    }
    // A qualidade anunciada é a que todas as provas alcançaram.
    const altura = Math.min(...aprovadas.map(p => p.altura));
    const qualidade = altura >= 1080 ? '1080p' : altura >= 720 ? '720p' : altura ? altura + 'p' : '';
    const dublado = true;
    const nota = Math.max(0, Math.min(10,
        (dublado ? 4 : 1.5) +
        (altura >= 1080 ? 2 : altura >= 720 ? 1.4 : 0.6) +
        (abertas.length === provas.length ? 2 : 1.2)
    ));
    return {
        aprovada: true,
        provas,
        ajustes: {
            dublado,
            qualidade,
            nota: Math.round(nota * 10) / 10,
            ativo: true,
            evidencia: abertas.map(p => `${p.amostra}: ${p.evidencia || (p.dublado ? 'áudio em português' : 'áudio original')}${p.altura ? ' · ' + p.altura + 'p' : ''}`).join(' | ').slice(0, 240),
        },
    };
}

// ---------------------------------------------------------------- registro
function registrarFicha(pastaDados, ficha, avaliacao, extras = {}) {
    const dados = ler(pastaDados);
    const indice = dados.perfis.findIndex(p => p.id === ficha.id);
    const juntar = {
        ...ficha,
        ...(avaliacao && avaliacao.ajustes ? avaliacao.ajustes : {}),
        provas: (avaliacao && avaliacao.provas ? avaliacao.provas : []).slice(0, 3),
        ...extras,
    };
    // A mesma fonte pode ter ficha de filme e de série: junta as duas.
    if (indice >= 0) {
        const anterior = dados.perfis[indice];
        // Fonte que JÁ está ativa não é desligada por uma rodada ruim: os
        // endereços de alguns fornecedores são temporários e uma validação
        // pode falhar por azar (medido em 10/10/2026: o addon FenixHub abriu em
        // 2 de 3 títulos numa rodada e em 1 de 3 na seguinte). Só desliga depois
        // de três validações ruins seguidas — e nunca perde a nota que já tem.
        const seguiaAtiva = anterior.ativo !== false && juntar.ativo === false;
        if (seguiaAtiva) {
            // Uma ficha que funcionava conserva os endereços e regras já
            // validados. Uma tentativa incompleta não substitui sua receita.
            for (const campo of ['urlMovie', 'urlTv', 'passos', 'referer', 'tipos']) {
                if (Object.prototype.hasOwnProperty.call(anterior, campo)) juntar[campo] = anterior[campo];
            }
            juntar.ativo = true;
            juntar.nota = anterior.nota;
            juntar.qualidade = anterior.qualidade;
            juntar.dublado = anterior.dublado;
            // Metadados desconhecidos ou insuficientes mantêm a candidata em
            // análise; só indisponibilidade real entra no castigo existente.
            juntar.falhasDeValidacao = (Number(anterior.falhasDeValidacao) || 0) + (avaliacao && avaliacao.emAnalise ? 0 : 1);
            if (juntar.falhasDeValidacao >= 3) {
                juntar.ativo = false;
                juntar.motivo = `três validações seguidas sem abrir em dois títulos (${juntar.falhasDeValidacao})`;
            }
        } else if (juntar.ativo) {
            juntar.falhasDeValidacao = 0;
        }
        juntar.urlMovie = juntar.urlMovie || anterior.urlMovie || '';
        juntar.urlTv = juntar.urlTv || anterior.urlTv || '';
        juntar.tipos = [...new Set([...(anterior.tipos || []), ...(juntar.tipos || [])])];
        dados.perfis[indice] = juntar;
    } else dados.perfis.push(juntar);
    gravar(pastaDados, dados);
    return juntar;
}

function removerFicha(pastaDados, id) {
    const dados = ler(pastaDados);
    const antes = dados.perfis.length;
    dados.perfis = dados.perfis.filter(p => p.id !== id);
    gravar(pastaDados, dados);
    return dados.perfis.length < antes;
}

// Lista de canais ao vivo aprovada pelo caçador: entra no mesmo arquivo, para o
// aplicativo aceitar sem atualização de versão.
function registrarLista(pastaDados, lista) {
    if (!lista || !lista.url) return null;
    const dados = ler(pastaDados);
    const id = String(lista.id || lista.nome || 'lista').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
    const registro = {
        id,
        nome: String(lista.nome || id).slice(0, 60),
        url: String(lista.url),
        nota: Number(lista.nota) || 0,
        medidoEm: new Date().toISOString(),
    };
    const indice = dados.listasTv.findIndex(l => l.id === id || l.url === registro.url);
    if (indice >= 0) dados.listasTv[indice] = registro; else dados.listasTv.push(registro);
    gravar(pastaDados, dados);
    return registro;
}

function listasTv(pastaDados) { return ler(pastaDados).listasTv; }

// Guarda o placar real junto das fichas: o aplicativo lê daqui para colocar na
// frente a fonte que funciona com quem assiste.
function gravarPlacar(pastaDados, tabela) {
    const dados = ler(pastaDados);
    const placar = (Array.isArray(tabela) ? tabela : []).map(linha => ({
        id: linha.id, nome: linha.nome, ajuste: linha.ajuste,
        taxaFalha: linha.taxaFalha, aberturas: linha.aberturas, falhas: linha.falhas,
    }));
    gravar(pastaDados, { ...dados, placar });
    return placar;
}

// Publica as fichas aprovadas no mesmo repositório que guarda o aviso de
// versão — assim o celular e o computador leem o mesmo arquivo, sem depender
// de o computador estar ligado.
async function publicar(pastaDados, token, { api = axios } = {}) {
    if (!token) return { ok: false, motivo: 'sem token do GitHub' };
    const dados = ler(pastaDados);
    const cabecalhos = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'conecta-tv-cacador' };
    let atual = null;
    try { atual = await api.get(`https://api.github.com/repos/${REPOSITORIO}/contents/${ARQUIVO_PUBLICADO}`, { headers: cabecalhos, timeout: 20000, validateStatus: s => s < 500 }); } catch { atual = null; }
    // O caçador agora roda em DOIS lugares (Oracle e PC). Cada um publica só o
    // que sabe; o resto do arquivo publicado é preservado, para um não apagar
    // as fichas do outro.
    let publicado = null;
    try { if (atual && atual.data && atual.data.content) publicado = JSON.parse(Buffer.from(String(atual.data.content), 'base64').toString('utf8')); } catch { publicado = null; }
    const juntos = juntarPublicado(publicado, dados);
    const conteudo = JSON.stringify({
        atualizadoEm: new Date().toISOString(),
        // Uma suspensão precisa chegar ao aplicativo que ainda guarda uma
        // cópia antiga. Ausência do ID, por si só, não desativa essa cópia.
        perfis: juntos.perfis.map(p => p.ativo === false ? { id: p.id, ativo: false } : p),
        listasTv: juntos.listasTv,
        placar: juntos.placar,
        listasTorbox: juntos.listasTorbox,
    }, null, 1);
    try {
        const sha = atual && atual.data && atual.data.sha ? atual.data.sha : undefined;
        await api.put(`https://api.github.com/repos/${REPOSITORIO}/contents/${ARQUIVO_PUBLICADO}`, {
            message: `Fichas de fonte (${juntos.perfis.length})`,
            content: Buffer.from(conteudo, 'utf8').toString('base64'),
            ...(sha ? { sha } : {}),
        }, { headers: cabecalhos, timeout: 25000 });
        return { ok: true, perfis: juntos.perfis.filter(p => p.ativo !== false).length };
    } catch (erro) {
        return { ok: false, motivo: String(erro.message).slice(0, 80) };
    }
}

// Junta o arquivo já publicado com as fichas locais: a ficha local (mais nova)
// vence pelo id; as que só existem no publicado continuam; listas e placar
// locais só substituem quando existem.
function juntarPublicado(publicado, local) {
    const pub = publicado && typeof publicado === 'object' ? publicado : {};
    const porId = new Map();
    for (const p of Array.isArray(pub.perfis) ? pub.perfis : []) if (p && p.id) porId.set(p.id, p);
    for (const p of Array.isArray(local.perfis) ? local.perfis : []) if (p && p.id) porId.set(p.id, p);
    const listas = Array.isArray(local.listasTv) && local.listasTv.length ? local.listasTv : (Array.isArray(pub.listasTv) ? pub.listasTv : []);
    const placar = Array.isArray(local.placar) && local.placar.length ? local.placar : (Array.isArray(pub.placar) ? pub.placar : []);
    // Listas de torrent da TorBox: junta as duas (a local vence pelo endereço).
    const listasTorbox = [...new Map([...(Array.isArray(pub.listasTorbox) ? pub.listasTorbox : []), ...(Array.isArray(local.listasTorbox) ? local.listasTorbox : [])].filter(l => l && l.base).map(l => [l.base, l])).values()];
    return { perfis: [...porId.values()], listasTv: listas, placar, listasTorbox };
}

// Lista de torrent aprovada para a TorBox (achada pela descoberta do caçador):
// traz dublado pronto na TorBox que as listas atuais não tinham.
function aprovarListaTorbox(pastaDados, { base, nome = '', motivo = '', novos = 0 } = {}) {
    if (!/^https:\/\/[^\s"']+$/.test(String(base || ''))) return null;
    const dados = ler(pastaDados);
    const registro = { base: String(base).replace(/\/+$/, ''), nome: String(nome || base).slice(0, 60), ativo: true, motivo: String(motivo).slice(0, 160), novos: Number(novos) || 0, aprovadaEm: new Date().toISOString() };
    const outras = dados.listasTorbox.filter(l => l.base !== registro.base);
    gravar(pastaDados, { ...dados, listasTorbox: [...outras, registro] });
    return registro;
}
function listasTorbox(pastaDados) { return ler(pastaDados).listasTorbox; }

module.exports = {
    juntarPublicado,
    arquivo, ler, gravar, listar, registrarFicha, removerFicha, publicar, registrarLista, listasTv, gravarPlacar, aprovarListaTorbox, listasTorbox,
    inferirDePagina, inferirDeStremio, modeloDeUrl, padraoPara, padraoDeIframe, validar, buscarTexto,
    ARQUIVO_PUBLICADO, REPOSITORIO,
};
