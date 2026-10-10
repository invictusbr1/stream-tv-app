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
        };
    } catch { return { atualizadoEm: '', perfis: [], listasTv: [], placar: [] }; }
}

function gravar(pastaDados, dados) {
    try {
        const destino = arquivo(pastaDados);
        fs.mkdirSync(path.dirname(destino), { recursive: true });
        fs.writeFileSync(destino, JSON.stringify({
            atualizadoEm: new Date().toISOString(),
            perfis: dados.perfis || [],
            listasTv: dados.listasTv || [],
            placar: dados.placar || [],
        }, null, 1));
        return true;
    } catch { return false; }
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
        const achado = /([A-Za-z_$][\w$.-]{0,40})\s*[:=]\s*(["']?)$/.exec(antes);
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
function inferirDeStremio({ candidata, imdbServico }) {
    const url = String(candidata.url || '');
    const alvo = candidata.alvo || {};
    const modelo = modeloDeUrl(url, { ...alvo, imdb: imdbServico || alvo.imdb });
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
    const resposta = await axios.get(endereco, {
        timeout: 15000, responseType: 'text', maxRedirects: 4,
        maxContentLength: 3 * 1024 * 1024, validateStatus: s => s < 400,
        headers: { 'User-Agent': UA, ...(referer ? { Referer: referer } : {}) },
    });
    return String(resposta.data || '');
}

// ---------------------------------------------------------------- validação
// Testa a ficha em títulos que não foram usados para criá-la. Só passa quem
// abre de verdade em pelo menos dois deles.
async function validar(ficha, amostras, { buscar = buscarTexto, registrar = () => {} } = {}) {
    const provas = [];
    for (const amostra of amostras.slice(0, 3)) {
        const alvo = amostra.tipo === 'tv'
            ? { tipo: 'tv', tmdbId: String(amostra.id), temporada: String(amostra.temporada || 1), episodio: String(amostra.episodio || 1), imdb: amostra.imdb || '' }
            : { tipo: 'movie', tmdbId: String(amostra.id), imdb: amostra.imdb || '' };
        const pronto = await motor.resolver(ficha, alvo, { buscar }).catch(() => null);
        if (!pronto) { provas.push({ amostra: amostra.titulo, ok: false, motivo: 'não achei o vídeo' }); continue; }
        const sonda = await sondagemRapida(pronto.url, pronto.referer).catch(() => null);
        const viva = Boolean(sonda && sonda.viva);
        provas.push({
            amostra: amostra.titulo, ok: viva, url: pronto.url,
            altura: sonda ? sonda.altura : 0,
            dublado: sonda ? sonda.dublado : null,
            evidencia: sonda ? sonda.evidencia : '',
            motivo: viva ? '' : 'o endereço não devolveu vídeo',
        });
        registrar(`ficha ${ficha.nome}: ${amostra.titulo} → ${viva ? 'abriu' : 'não abriu'}`);
    }
    const abertas = provas.filter(p => p.ok);
    if (abertas.length < 2) return { aprovada: false, provas };
    const comAudio = abertas.filter(p => p.dublado === true).length;
    const semAudio = abertas.filter(p => p.dublado === false).length;
    const altura = Math.max(0, ...abertas.map(p => p.altura || 0));
    const qualidade = altura >= 1080 ? '1080p' : altura >= 720 ? '720p' : altura ? altura + 'p' : '';
    const dublado = comAudio > 0 && semAudio === 0;
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
async function publicar(pastaDados, token) {
    if (!token) return { ok: false, motivo: 'sem token do GitHub' };
    const dados = ler(pastaDados);
    const conteudo = JSON.stringify({
        atualizadoEm: new Date().toISOString(),
        perfis: dados.perfis.filter(p => p.ativo !== false),
        listasTv: dados.listasTv || [],
        placar: dados.placar || [],
    }, null, 1);
    const cabecalhos = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'conecta-tv-cacador' };
    try {
        const atual = await axios.get(`https://api.github.com/repos/${REPOSITORIO}/contents/${ARQUIVO_PUBLICADO}`, { headers: cabecalhos, timeout: 20000, validateStatus: s => s < 500 }).catch(() => null);
        const sha = atual && atual.data && atual.data.sha ? atual.data.sha : undefined;
        await axios.put(`https://api.github.com/repos/${REPOSITORIO}/contents/${ARQUIVO_PUBLICADO}`, {
            message: `Fichas de fonte (${dados.perfis.length})`,
            content: Buffer.from(conteudo, 'utf8').toString('base64'),
            ...(sha ? { sha } : {}),
        }, { headers: cabecalhos, timeout: 25000 });
        return { ok: true, perfis: dados.perfis.length };
    } catch (erro) {
        return { ok: false, motivo: String(erro.message).slice(0, 80) };
    }
}

module.exports = {
    arquivo, ler, gravar, listar, registrarFicha, removerFicha, publicar, registrarLista, listasTv, gravarPlacar,
    inferirDePagina, inferirDeStremio, modeloDeUrl, padraoPara, padraoDeIframe, validar, buscarTexto,
    ARQUIVO_PUBLICADO, REPOSITORIO,
};
