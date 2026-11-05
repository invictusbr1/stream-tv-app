'use strict';
// Relatos da família (problema ou ideia), enviados pelo botão "Relatar
// problema ou ideia" do aplicativo. Ficam em dados/feedback.json até alguém
// marcar como resolvido no painel.
const path = require('path');
const crypto = require('crypto');
const { lerJson, gravarJson } = require('./armazenamento');

const LIMITE = 300;

function criarFeedback({ pastaDados } = {}) {
    const arquivo = path.join(pastaDados || path.join(__dirname, 'dados'), 'feedback.json');
    const ler = () => { const d = lerJson(arquivo, { itens: [] }, x => x && Array.isArray(x.itens)); return Array.isArray(d.itens) ? d.itens : []; };
    const gravar = itens => gravarJson(arquivo, { itens: itens.slice(0, LIMITE) });
    const limpar = (v, n) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
    function registrar(evento, corpo = {}) {
        const item = {
            id: crypto.randomBytes(6).toString('hex'),
            em: evento.em || new Date().toISOString(),
            status: 'novo',
            categoria: limpar(corpo.motivo || evento.motivo, 40) || 'Outro',
            mensagem: limpar(corpo.mensagem, 600),
            nome: evento.nome, aparelho: evento.aparelho, app: evento.app, versao: evento.versao, dispositivo: evento.dispositivo,
            titulo: evento.titulo, idTitulo: evento.id, temporada: evento.temporada, numero: evento.numero,
            fonte: evento.fonte, fonteId: evento.fonteId, resolucao: evento.resolucao,
        };
        if (!item.mensagem && item.categoria === 'Outro') return null;
        const itens = ler(); itens.unshift(item); gravar(itens);
        return item;
    }
    function listar() { return ler(); }
    function novos() { return ler().filter(i => i.status === 'novo').length; }
    function resolver(id, status = 'resolvido') {
        const itens = ler(); const item = itens.find(i => i.id === id); if (!item) return false;
        item.status = status === 'novo' ? 'novo' : 'resolvido'; item.resolvidoEm = new Date().toISOString(); gravar(itens); return true;
    }
    return { registrar, listar, novos, resolver };
}
module.exports = { criarFeedback };
