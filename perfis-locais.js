'use strict';
// Fichas de fonte no computador: o aplicativo lê o arquivo `perfis.json` que
// fica na pasta do projeto. Ele é escrito pelo servidor (que busca a versão
// publicada pela central) e vem com uma cópia embutida na hora de empacotar —
// assim funciona mesmo sem internet e sem a central ligada.

const fs = require('fs');
const path = require('path');

const ARQUIVO = path.join(__dirname, 'perfis.json');
// A central escreve as fichas dela aqui (é o mesmo computador): assim uma fonte
// aprovada aparece no aplicativo na hora, sem esperar a publicação.
const ARQUIVO_CENTRAL = path.join(__dirname, 'central', 'dados', 'perfis.json');
const PUBLICADO = 'https://raw.githubusercontent.com/invictusbr1/stream-tv-atualizacoes/main/perfis.json';
const VALIDADE = 30 * 60 * 1000;

let memoria = null;
let lidoEm = 0;

function lerArquivo() {
    const juntar = (caminho, base) => {
        try {
            const dados = JSON.parse(fs.readFileSync(caminho, 'utf8'));
            const perfis = new Map(base.perfis.map(p => [p.id, p]));
            for (const perfil of Array.isArray(dados.perfis) ? dados.perfis : []) perfis.set(perfil.id, { ...(perfis.get(perfil.id) || {}), ...perfil });
            return {
                atualizadoEm: dados.atualizadoEm || base.atualizadoEm,
                perfis: [...perfis.values()],
                listasTv: [...new Map([...base.listasTv, ...(Array.isArray(dados.listasTv) ? dados.listasTv : [])].map(l => [l.id || l.url, l])).values()],
                placar: Array.isArray(dados.placar) && dados.placar.length ? dados.placar : base.placar,
            };
        } catch { return base; }
    };
    return juntar(ARQUIVO_CENTRAL, juntar(ARQUIVO, { atualizadoEm: '', perfis: [], listasTv: [], placar: [] }));
}

function conteudo() {
    if (memoria && Date.now() - lidoEm < VALIDADE) return memoria;
    memoria = lerArquivo();
    lidoEm = Date.now();
    return memoria;
}

function perfis() { return conteudo().perfis; }
function listasTv() { return conteudo().listasTv; }
function placar() { return conteudo().placar; }
function esquecer() { memoria = null; lidoEm = 0; }

function gravar(dados) {
    try {
        fs.writeFileSync(ARQUIVO, JSON.stringify({
            atualizadoEm: dados.atualizadoEm || new Date().toISOString(),
            perfis: Array.isArray(dados.perfis) ? dados.perfis : [],
            listasTv: Array.isArray(dados.listasTv) ? dados.listasTv : [],
            placar: Array.isArray(dados.placar) ? dados.placar : [],
        }, null, 1));
        esquecer();
        return true;
    } catch { return false; }
}

// Busca a versão publicada pela central (GitHub). Se conseguir, guarda — é o
// que faz uma ficha aprovada no caçador chegar ao aplicativo sem atualização.
async function atualizar() {
    try {
        const resposta = await fetch(PUBLICADO + '?t=' + Date.now(), { headers: { 'Cache-Control': 'no-cache' } });
        if (!resposta.ok) return { ok: false, motivo: 'http ' + resposta.status };
        const dados = await resposta.json();
        if (!Array.isArray(dados.perfis)) return { ok: false, motivo: 'arquivo inválido' };
        const atual = conteudo();
        const mudou = JSON.stringify(dados.perfis) !== JSON.stringify(atual.perfis) || (dados.listasTv || []).length !== atual.listasTv.length;
        if (!mudou) return { ok: true, mudou: false, perfis: atual.perfis.length };
        gravar(dados);
        return { ok: true, mudou: true, perfis: dados.perfis.length, listas: (dados.listasTv || []).length };
    } catch (erro) {
        return { ok: false, motivo: String(erro.message).slice(0, 60) };
    }
}

module.exports = { perfis, listasTv, placar, gravar, atualizar, esquecer, ARQUIVO, PUBLICADO };
