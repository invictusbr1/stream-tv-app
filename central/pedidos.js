'use strict';
// Pedidos do usuário — o caminho mais curto entre "quero ver isso" e "o caçador
// foi atrás disso". O que entra aqui vai na FRENTE das amostras do caçador, na
// próxima rodada, e fica registrado para o painel mostrar o que está faltando.

const fs = require('fs');
const path = require('path');

const MAX = 300;

function criarPedidos({ pastaDados } = {}) {
    const arquivo = path.join(pastaDados || path.join(__dirname, 'dados'), 'pedidos.json');
    let dados = [];
    let lido = false;

    function carregar() {
        if (lido) return;
        try { dados = JSON.parse(fs.readFileSync(arquivo, 'utf8')) || []; } catch { dados = []; }
        if (!Array.isArray(dados)) dados = [];
        lido = true;
    }

    function gravar() {
        try {
            fs.mkdirSync(path.dirname(arquivo), { recursive: true });
            fs.writeFileSync(arquivo, JSON.stringify(dados.slice(-MAX), null, 1));
        } catch { /* disco cheio: segue na memória */ }
    }

    function chave(item) {
        return `${item.tipo === 'tv' ? 'tv' : 'movie'}:${item.id}${item.temporada ? ':' + item.temporada : ''}${item.numero ? ':' + item.numero : ''}`;
    }

    // Um pedido por título (aparelhos diferentes pedindo a mesma coisa somam).
    function registrar(evento = {}) {
        carregar();
        const id = String(evento.id || '').trim();
        if (!/^\d{1,10}$/.test(id)) return null;
        const item = {
            id,
            tipo: evento.tipo === 'tv' ? 'tv' : 'movie',
            temporada: evento.temporada ? String(evento.temporada).slice(0, 3) : '',
            numero: evento.numero ? String(evento.numero).slice(0, 4) : '',
            titulo: String(evento.titulo || '').slice(0, 120),
            quem: String(evento.nome || '').slice(0, 60),
            pedidos: 1,
            primeiroEm: new Date().toISOString(),
            ultimoEm: new Date().toISOString(),
        };
        const igual = dados.find(atual => chave(atual) === chave(item));
        if (igual) {
            igual.pedidos = (Number(igual.pedidos) || 0) + 1;
            igual.ultimoEm = item.ultimoEm;
            if (!igual.titulo && item.titulo) igual.titulo = item.titulo;
        } else dados.push(item);
        gravar();
        return item;
    }

    function listar(limite = 40) {
        carregar();
        return [...dados].sort((a, b) => (Number(b.pedidos) || 0) - (Number(a.pedidos) || 0) || String(b.ultimoEm).localeCompare(String(a.ultimoEm))).slice(0, limite);
    }

    // Títulos pedidos recentemente (7 dias) — entram na frente das amostras.
    function recentes(tipo = '') {
        carregar();
        const limite = Date.now() - 7 * 24 * 60 * 60 * 1000;
        return dados
            .filter(item => (!tipo || (tipo === 'tv' ? item.tipo === 'tv' : item.tipo !== 'tv')))
            .filter(item => Date.parse(item.ultimoEm) > limite)
            .sort((a, b) => (Number(b.pedidos) || 0) - (Number(a.pedidos) || 0));
    }

    return { registrar, listar, recentes, resumo: () => ({ total: listar(MAX).length, lista: listar(20) }), arquivo };
}

module.exports = { criarPedidos };
