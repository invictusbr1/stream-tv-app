'use strict';
// Fichas de fonte no computador.
//
// O aplicativo junta as fichas de quatro lugares, do mais antigo para o mais
// novo (o de baixo manda):
//   1. a cópia que veio dentro do programa (`perfis.json`);
//   2. a pasta de dados da central (quando ela roda neste computador);
//   3. o arquivo guardado na pasta do usuário (`~/.conecta-tv/perfis.json`);
//   4. o último arquivo publicado que o aplicativo buscou no GitHub.
//
// O item 4 fica em memória: o programa instalado não consegue escrever dentro
// de si mesmo, e sem isso uma ficha aprovada pelo caçador só apareceria depois
// de reinstalar (foi o defeito encontrado em 10/10/2026).

const fs = require('fs');
const os = require('os');
const path = require('path');

const ARQUIVO_PROJETO = path.join(__dirname, 'perfis.json');
const ARQUIVO_USUARIO = path.join(os.homedir(), '.conecta-tv', 'perfis.json');
const ARQUIVO_CENTRAL = path.join(__dirname, 'central', 'dados', 'perfis.json');
const PUBLICADO = 'https://raw.githubusercontent.com/invictusbr1/stream-tv-atualizacoes/main/perfis.json';
const VALIDADE = 5 * 60 * 1000;

let memoria = null;
let lidoEm = 0;
let publicada = null;

function vazio() { return { atualizadoEm: '', perfis: [], listasTv: [], placar: [] }; }

function lerArquivo(caminho) {
    try {
        const dados = JSON.parse(fs.readFileSync(caminho, 'utf8'));
        return {
            atualizadoEm: dados.atualizadoEm || '',
            perfis: Array.isArray(dados.perfis) ? dados.perfis : [],
            listasTv: Array.isArray(dados.listasTv) ? dados.listasTv : [],
            placar: Array.isArray(dados.placar) ? dados.placar : [],
        };
    } catch { return null; }
}

function juntar(base, novo) {
    if (!novo) return base;
    const perfis = new Map(base.perfis.map(p => [p.id, p]));
    for (const perfil of novo.perfis) perfis.set(perfil.id, { ...(perfis.get(perfil.id) || {}), ...perfil });
    return {
        atualizadoEm: novo.atualizadoEm || base.atualizadoEm,
        perfis: [...perfis.values()],
        listasTv: [...new Map([...base.listasTv, ...novo.listasTv].map(l => [l.id || l.url, l])).values()],
        placar: novo.placar.length ? novo.placar : base.placar,
    };
}

function lerTudo() {
    let dados = vazio();
    for (const caminho of [ARQUIVO_PROJETO, ARQUIVO_CENTRAL, ARQUIVO_USUARIO]) dados = juntar(dados, lerArquivo(caminho));
    return juntar(dados, publicada);
}

function conteudo() {
    if (memoria && Date.now() - lidoEm < VALIDADE) return memoria;
    memoria = lerTudo();
    lidoEm = Date.now();
    return memoria;
}

function perfis() { return conteudo().perfis; }
function listasTv() { return conteudo().listasTv; }
function placar() { return conteudo().placar; }
function esquecer() { memoria = null; lidoEm = 0; }

// Guarda o que foi buscado: em memória sempre (é o que o aplicativo usa) e no
// disco quando dá (pasta do usuário; no projeto, também o arquivo do projeto).
function gravar(dados) {
    publicada = {
        atualizadoEm: dados.atualizadoEm || new Date().toISOString(),
        perfis: Array.isArray(dados.perfis) ? dados.perfis : [],
        listasTv: Array.isArray(dados.listasTv) ? dados.listasTv : [],
        placar: Array.isArray(dados.placar) ? dados.placar : [],
    };
    memoria = lerTudo();
    lidoEm = Date.now();
    for (const destino of [ARQUIVO_USUARIO, ...(process.pkg ? [] : [ARQUIVO_PROJETO])]) {
        try {
            fs.mkdirSync(path.dirname(destino), { recursive: true });
            fs.writeFileSync(destino, JSON.stringify(publicada, null, 1));
            break;
        } catch { /* tenta o próximo destino */ }
    }
    return true;
}

// Busca a versão publicada pela central. Chamado ao subir e a cada 6 horas.
async function atualizar() {
    try {
        const resposta = await fetch(PUBLICADO + '?t=' + Date.now(), { headers: { 'Cache-Control': 'no-cache' } });
        if (!resposta.ok) return { ok: false, motivo: 'http ' + resposta.status };
        const dados = await resposta.json();
        if (!Array.isArray(dados.perfis)) return { ok: false, motivo: 'arquivo inválido' };
        const antes = JSON.stringify(conteudo().perfis);
        gravar(dados);
        return { ok: true, mudou: JSON.stringify(dados.perfis) !== antes, perfis: dados.perfis.length, listas: (dados.listasTv || []).length };
    } catch (erro) {
        return { ok: false, motivo: String(erro.message).slice(0, 60) };
    }
}

module.exports = { perfis, listasTv, placar, gravar, atualizar, esquecer, ARQUIVO: ARQUIVO_PROJETO, ARQUIVO_USUARIO, PUBLICADO };
