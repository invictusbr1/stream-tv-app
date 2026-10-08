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
        if (evento.temporada || evento.numero) {
            atual.ultimoEpisodio = { temporada: String(evento.temporada || '1'), numero: String(evento.numero || '1') };
        }

        if (evento.tipo === 'avaliacao') {
            atual.escolha = {
                fonteId: evento.fonteId || '',
                fonte: evento.fonte || '',
                em: evento.em,
                disputa: Array.isArray(evento.avaliacao) ? evento.avaliacao.slice(0, 4) : [],
            };
        } else if (evento.tipo === 'confirmacao') {
            const alturaAtual = Number(String(evento.resolucao || '').replace(/\D/g, '')) || 0;
            const melhorConhecida = Number(atual.melhorAltura || 0);
            if (alturaAtual && alturaAtual >= melhorConhecida) {
                atual.melhorAltura = alturaAtual;
                atual.quedaDeQualidade = false;
            } else if (alturaAtual && melhorConhecida && alturaAtual < melhorConhecida) {
                // Já rodou melhor neste título — fica registrado para a revisão.
                atual.quedaDeQualidade = true;
                atual.quedaEm = evento.em;
                atual.quedaDetalhe = `já tocou em ${melhorConhecida}p; agora veio ${alturaAtual}p`;
            }
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

    // Títulos que merecem revisão: falhas seguidas, falhas sem nunca tocar, ou
    // qualidade caindo em relação ao que já rodou antes.
    function comProblema(limite = 8) {
        return Object.values(dados)
            .map(item => {
                const falhasSeguidas = Number(item.falhasSeguidas || 0);
                const falhas = Number(item.falhas || 0);
                const plays = Number(item.plays || 0);
                // Revisão que deu certo DEPOIS da última falha tira o título da
                // lista (o problema foi tratado); se falhar de novo, volta.
                const ultimaFalha = [...(item.historico || [])].reverse().find(h => h.tipo === 'falha' || h.ok === false);
                const revisaoResolveu = item.revisao && item.revisao.ok
                    && (!ultimaFalha || new Date(item.revisao.em).getTime() >= new Date(ultimaFalha.em).getTime());
                let gravidade = 0;
                const motivos = [];
                if (revisaoResolveu && !item.quedaDeQualidade) return { item, gravidade: 0, motivos: [] };
                if (falhasSeguidas >= 2) { gravidade += 3 + falhasSeguidas; motivos.push(falhasSeguidas + ' falhas seguidas'); }
                else if (falhas >= 1 && plays === 0) { gravidade += 2 + falhas; motivos.push(falhas + ' falha(s) e nunca tocou'); }
                if (item.quedaDeQualidade) { gravidade += 2; motivos.push(item.quedaDetalhe || 'qualidade caiu'); }
                if (!item.qualidade && falhas === 0 && plays === 0) { gravidade += 1; motivos.push('nunca teve medição de qualidade'); }
                return { item, gravidade, motivos };
            })
            .filter(entrada => entrada.gravidade >= 2)
            .sort((a, b) => b.gravidade - a.gravidade || String(b.item.atualizadoEm || '').localeCompare(String(a.item.atualizadoEm || '')))
            .slice(0, limite)
            .map(({ item, gravidade, motivos }) => ({
                chave: item.chave,
                id: item.id,
                tipo: item.tipo,
                titulo: item.titulo || item.chave,
                gravidade,
                motivos,
                falhas: Number(item.falhas || 0),
                falhasSeguidas: Number(item.falhasSeguidas || 0),
                plays: Number(item.plays || 0),
                melhorAltura: Number(item.melhorAltura || 0),
                ultimoEpisodio: item.ultimoEpisodio || null,
                ultimaFonte: (item.qualidade && item.qualidade.fonte) || (item.escolha && item.escolha.fonte) || '',
                atualizadoEm: item.atualizadoEm || '',
                revisao: item.revisao || null,
            }));
    }

    // Resultado de uma revisão automática (o revisor chama isto).
    function anotarRevisao(chave, dadosDaRevisao) {
        const item = dados[chave];
        if (!item) return null;
        item.revisao = {
            em: dadosDaRevisao.em || new Date().toISOString(),
            ok: Boolean(dadosDaRevisao.ok),
            solucao: dadosDaRevisao.solucao || null,
            tentativas: Number(dadosDaRevisao.tentativas || 0),
            motivo: String(dadosDaRevisao.motivo || '').slice(0, 120),
        };
        if (dadosDaRevisao.ok) item.falhasSeguidas = 0;
        dados[chave] = item;
        gravar();
        return item.revisao;
    }

    return { registrar, listar, resumo, comProblema, anotarRevisao, limpar, total: () => Object.keys(dados).length };
}

module.exports = { criarRegistro, MAX_TITULOS, MAX_HISTORICO };
