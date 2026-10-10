'use strict';
// Placar real das fontes — o que aconteceu com gente de verdade.
//
// A central já recebe dos aparelhos cada abertura ("play"), cada confirmação de
// que o vídeo tocou de verdade e cada falha, sempre com o nome/identificador da
// fonte. Este módulo transforma esses relatos em uma nota por fonte, que serve
// para duas coisas:
//
//   - o caçador usa essa nota junto com as medições dele (uma fonte que falha
//     com os usuários não pode continuar com nota alta só porque "abriu" no
//     laboratório);
//   - o aplicativo usa a mesma nota para colocar na frente a fonte que funciona
//     na vida real.
//
// Nada aqui abre página nem baixa vídeo: é leitura dos relatos já guardados.

const fs = require('fs');
const path = require('path');

// Nomes que o aplicativo manda no relato não são sempre o identificador da
// fonte (ex.: "Dublado limpo" é a watchplay). Esta é a ponte entre os dois.
const APELIDOS = [
    // A ordem importa: o nome mais específico vem antes. "Dublado limpo" é o
    // rótulo que a fonte dublada principal usa no aplicativo.
    [/mgeb|megaembed/i, 'mgeb'],
    [/fenix|hollymovies/i, 'fenix'],
    [/dublado · série|s[eé]rie \(arquivo/i, 'pipoca-serie'],
    [/pipoca|nixplay/i, 'pipoca'],
    [/vixsrc|mistyreef/i, 'vixsrc'],
    [/vidsrc/i, 'vidsrc'],
    [/watchplay|hclod/i, 'watchplay'],
    [/^dublado limpo$/i, 'watchplay'],
];

function identificador(evento) {
    const direto = String(evento.fonteId || '').trim();
    if (direto) return direto;
    const nome = String(evento.fonte || '').trim();
    if (!nome) return '';
    for (const [padrao, id] of APELIDOS) if (padrao.test(nome)) return id;
    return nome.toLowerCase().replace(/\s+/g, '-').slice(0, 40);
}

// Relatos que valem para o placar: só os que vieram de um aparelho de verdade.
// "vigia" e "avaliacao" são medições do próprio robô e não contam duas vezes;
// "sessao" e "atualizacao" não falam de fonte.
const TIPOS = new Set(['play', 'confirmacao', 'falha']);

function criarPlacar({ arquivoEventos, dias = 21 } = {}) {
    const limite = Date.now() - dias * 24 * 60 * 60 * 1000;
    let tabela = {};
    let atualizadoEm = '';
    let lidos = 0;

    function zerar(id) {
        return { id, nome: '', aberturas: 0, confirmacoes: 0, falhas: 0, falhasSeguidas: 0, titulos: {}, ultimoEm: '', ultimaFalha: '', ultimoMotivo: '' };
    }

    function anotar(evento, quando) {
        const id = identificador(evento);
        if (!id) return;
        const linha = tabela[id] || (tabela[id] = zerar(id));
        if (evento.fonte && !linha.nome) linha.nome = String(evento.fonte).slice(0, 40);
        linha.ultimoEm = quando;
        const titulo = String(evento.titulo || '').slice(0, 80);
        if (evento.tipo === 'falha' || evento.ok === false) {
            linha.falhas += 1;
            linha.falhasSeguidas += 1;
            linha.ultimaFalha = quando;
            linha.ultimoMotivo = String(evento.motivo || '').slice(0, 90);
            if (titulo) {
                const alvo = linha.titulos[titulo] || (linha.titulos[titulo] = { falhas: 0, aberturas: 0 });
                alvo.falhas += 1;
            }
        } else if (evento.tipo === 'confirmacao') {
            // O player avisou que o vídeo tocou de verdade: é a prova mais forte
            // e não conta como "pedido de abertura" (senão a mesma sessão seria
            // contada duas vezes).
            linha.confirmacoes += 1;
            linha.falhasSeguidas = 0;
            if (titulo) {
                const alvo = linha.titulos[titulo] || (linha.titulos[titulo] = { falhas: 0, aberturas: 0, confirmacoes: 0 });
                alvo.confirmacoes = (alvo.confirmacoes || 0) + 1;
            }
        } else {
            linha.aberturas += 1;
            linha.falhasSeguidas = 0;
            if (titulo) {
                const alvo = linha.titulos[titulo] || (linha.titulos[titulo] = { falhas: 0, aberturas: 0 });
                alvo.aberturas += 1;
            }
        }
    }

    function atualizar() {
        tabela = {};
        lidos = 0;
        let linhas = [];
        try { linhas = fs.readFileSync(arquivoEventos, 'utf8').split(/\r?\n/); } catch { linhas = []; }
        for (const bruta of linhas) {
            if (!bruta.trim()) continue;
            let evento = null;
            try { evento = JSON.parse(bruta); } catch { continue; }
            if (!evento || !TIPOS.has(String(evento.tipo || ''))) continue;
            const quando = String(evento.em || '');
            const em = Date.parse(quando);
            if (Number.isFinite(em) && em < limite) continue;
            anotar(evento, quando);
            lidos += 1;
        }
        atualizadoEm = new Date().toISOString();
        return resumo();
    }

    // Ajuste em pontos (de -2 a +1) que entra na nota do caçador.
    function ajuste(id) {
        const linha = tabela[String(id || '')];
        if (!linha) return 0;
        // Prova de uso: pedido de abertura, vídeo confirmado ou falha.
        const provas = linha.aberturas + linha.confirmacoes + linha.falhas;
        if (provas < 3) return 0;
        const pedidos = linha.aberturas + linha.falhas;
        const taxaFalha = pedidos ? linha.falhas / pedidos : 0;
        let pontos = 0.75 - taxaFalha * 2;
        // Vídeo confirmado (tocou de verdade) soma um pouco: é a melhor prova.
        pontos += Math.min(0.25, linha.confirmacoes * 0.05);
        if (linha.falhasSeguidas >= 3) pontos -= 0.5;
        return Math.max(-2, Math.min(1, Math.round(pontos * 100) / 100));
    }

    function resumo() {
        return Object.values(tabela)
            .map(linha => {
                const pedidos = linha.aberturas + linha.falhas;
                return {
                    id: linha.id,
                    nome: linha.nome || linha.id,
                    aberturas: linha.aberturas,
                    confirmacoes: linha.confirmacoes,
                    falhas: linha.falhas,
                    falhasSeguidas: linha.falhasSeguidas,
                    taxaFalha: pedidos ? Math.round((linha.falhas / pedidos) * 100) : 0,
                    ajuste: ajuste(linha.id),
                    ultimoEm: linha.ultimoEm,
                    ultimaFalha: linha.ultimaFalha,
                    ultimoMotivo: linha.ultimoMotivo,
                    titulos: Object.entries(linha.titulos)
                        .map(([titulo, dado]) => ({ titulo, ...dado }))
                        .sort((a, b) => b.falhas - a.falhas)
                        .slice(0, 8),
                };
            })
            .sort((a, b) => b.aberturas + b.falhas - (a.aberturas + a.falhas));
    }

    // Fonte que nunca abriu nada em 21 dias e já falhou: candidata a sair da
    // frente. Serve para o caçador rebaixar sozinho.
    function problematicas(minimoFalhas = 3) {
        return Object.values(tabela)
            .filter(linha => linha.falhas >= minimoFalhas && linha.aberturas === 0 && linha.confirmacoes === 0)
            .map(linha => ({ id: linha.id, nome: linha.nome || linha.id, falhas: linha.falhas, ultimoMotivo: linha.ultimoMotivo }));
    }

    return { atualizar, resumo, ajuste, problematicas, identificador, arquivoEventos };
}

module.exports = { criarPlacar, identificador };
