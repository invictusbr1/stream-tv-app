'use strict';
// Qualidade por título.
//
// A central já sabe como cada FORNECEDOR se comporta. Aqui ela guarda o que
// aconteceu com cada TÍTULO: qual fonte o avaliador escolheu, em que qualidade
// aquilo realmente tocou (altura e taxa medidas pelo player), qual idioma foi
// confirmado e quando falhou. É o histórico que permite ver a evolução por
// filme/série — e não só a média do fornecedor.
//
// Alimentado pelos eventos que o aplicativo já envia:
//   tipo "avaliacao"   → disputa das fontes e a escolhida
//   tipo "confirmacao" → 20s de vídeo tocado: qualidade real medida
//   tipo "falha"       → não abriu (ou o áudio estava errado)

const fs = require('fs');
const path = require('path');

const MAX_TITULOS = 400;
const MAX_HISTORICO = 12;

function criarRegistro({ pastaDados } = {}) {
    const pasta = pastaDados || path.join(__dirname, 'dados');
    const arquivo = path.join(pasta, 'titulos.json');
    let dados = {};
    try { dados = JSON.parse(fs.readFileSync(arquivo, 'utf8')) || {}; } catch { dados = {}; }

    function gravar() {
        try { fs.mkdirSync(pasta, { recursive: true }); fs.writeFileSync(arquivo, JSON.stringify(dados, null, 1)); } catch { /* sem disco */ }
    }

    // A chave junta filme e série (série sem separar por episódio, para o
    // histórico ficar legível).
    function chaveDoEvento(evento) {
        const id = String((evento && evento.id) || '').trim();
        if (!/^\d{1,10}$/.test(id)) return null;
        const ehSerie = Boolean(evento.temporada || evento.numero || /T\d+.*E\d+/i.test(String(evento.episodio || '')));
        return (ehSerie ? 'tv:' : 'movie:') + id;
    }

    function registrar(evento) {
        const chave = chaveDoEvento(evento);
        if (!chave) return null;
        const atual = dados[chave] || {
            chave,
            id: String(evento.id),
            tipo: chave.startsWith('tv') ? 'tv' : 'movie',
            titulo: '',
            criadoEm: evento.em,
            historico: [],
        };
        if (evento.titulo) atual.titulo = String(evento.titulo).slice(0, 120);
        atual.atualizadoEm = evento.em;
        atual.dispositivo = evento.dispositivo || atual.dispositivo || '';
        atual.aparelho = evento.aparelho || atual.aparelho || '';

        if (evento.tipo === 'avaliacao') {
            atual.escolha = {
                fonteId: evento.fonteId || '',
                fonte: evento.fonte || '',
                em: evento.em,
                disputa: Array.isArray(evento.avaliacao) ? evento.avaliacao.slice(0, 4) : [],
            };
        } else if (evento.tipo === 'confirmacao') {
            atual.qualidade = {
                resolucao: evento.resolucao || '',
                taxa: evento.taxa || '',
                fonteId: evento.fonteId || '',
                fonte: evento.fonte || '',
                audio: evento.audio || '',
                em: evento.em,
            };
            atual.plays = Number(atual.plays || 0) + 1;
            atual.falhasSeguidas = 0;
        } else if (evento.tipo === 'falha' || evento.ok === false) {
            atual.falhas = Number(atual.falhas || 0) + 1;
            atual.falhasSeguidas = Number(atual.falhasSeguidas || 0) + 1;
        }

        atual.historico = [...(atual.historico || []), {
            em: evento.em,
            tipo: evento.tipo || '',
            fonteId: evento.fonteId || '',
            fonte: evento.fonte || '',
            resolucao: evento.resolucao || '',
            taxa: evento.taxa || '',
            ok: evento.ok !== false,
            motivo: String(evento.motivo || '').slice(0, 80),
        }].slice(-MAX_HISTORICO);

        dados[chave] = atual;
        // Limita o tamanho: os títulos mais antigos saem primeiro.
        const chaves = Object.keys(dados);
        if (chaves.length > MAX_TITULOS) {
            chaves.sort((a, b) => String(dados[a].atualizadoEm || '').localeCompare(String(dados[b].atualizadoEm || '')));
            for (const velha of chaves.slice(0, chaves.length - MAX_TITULOS)) delete dados[velha];
        }
        gravar();
        return atual;
    }

    function listar(limite = 60) {
        return Object.values(dados)
            .sort((a, b) => String(b.atualizadoEm || '').localeCompare(String(a.atualizadoEm || '')))
            .slice(0, limite);
    }

    // Resumo curto para o painel: título, fonte escolhida e qualidade medida.
    function resumo(limite = 8) {
        return listar(limite).map(item => ({
            id: item.id,
            titulo: item.titulo || item.chave,
            fonte: (item.qualidade && item.qualidade.fonte) || (item.escolha && item.escolha.fonte) || '',
            fonteId: (item.qualidade && item.qualidade.fonteId) || (item.escolha && item.escolha.fonteId) || '',
            qualidade: [item.qualidade && item.qualidade.resolucao, item.qualidade && item.qualidade.taxa].filter(Boolean).join(' · '),
            audio: (item.qualidade && item.qualidade.audio) || '',
            atualizadoEm: item.atualizadoEm || '',
            plays: item.plays || 0,
            falhas: item.falhas || 0,
            falhasSeguidas: item.falhasSeguidas || 0,
            disputa: (item.escolha && item.escolha.disputa) || [],
        }));
    }

    function limpar() { dados = {}; gravar(); }

    return { registrar, listar, resumo, limpar, total: () => Object.keys(dados).length };
}

module.exports = { criarRegistro, MAX_TITULOS, MAX_HISTORICO };
