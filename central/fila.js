'use strict';
// Fila persistente de candidatas — a memória de trabalho do caçador.
//
// Sem isso, cada rodada começa do zero e o que não deu tempo de testar se
// perde. Com a fila, o caçador trabalha como um bicho pequeno e teimoso: pega
// poucas candidatas por rodada, anota o resultado, respeita um castigo por
// domínio que já falhou e volta depois exatamente onde parou.

const fs = require('fs');
const path = require('path');

const MAX_ITENS = 4000;
const CASTIGO_PADRAO = 6 * 60 * 60 * 1000;   // domínio que errou 3x fica 6h parado
const CASTIGO_LONGO = 24 * 60 * 60 * 1000;   // errou 6x: volta no dia seguinte

function criarFila({ pastaDados } = {}) {
    const arquivo = path.join(pastaDados || path.join(__dirname, 'dados'), 'fila.json');
    let dados = { itens: {} };
    let lido = false;

    function carregar() {
        if (lido) return;
        try {
            const bruto = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
            if (bruto && bruto.itens && typeof bruto.itens === 'object') dados = { itens: bruto.itens };
        } catch { dados = { itens: {} }; }
        lido = true;
    }

    function gravar() {
        try {
            fs.mkdirSync(path.dirname(arquivo), { recursive: true });
            const chaves = Object.keys(dados.itens);
            // Se passar do teto, joga fora os mais antigos já tentados.
            if (chaves.length > MAX_ITENS) {
                const ordenados = chaves
                    .map(k => ({ k, v: dados.itens[k] }))
                    .sort((a, b) => Number(a.v.adicionadoEm || 0) - Number(b.v.adicionadoEm || 0));
                for (const item of ordenados.slice(0, chaves.length - MAX_ITENS)) delete dados.itens[item.k];
            }
            fs.writeFileSync(arquivo, JSON.stringify(dados, null, 1));
        } catch { /* disco cheio: segue só na memória */ }
    }

    function dominioDe(url) {
        try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
    }

    // Quantas falhas seguidas aquele domínio já acumulou.
    function castigoDoDominio(dominio) {
        const chave = `dominio:${dominio}`;
        const registro = dados.itens[chave];
        return registro ? Number(registro.falhas) || 0 : 0;
    }

    function enfileirar(candidatas = []) {
        carregar();
        let novos = 0;
        for (const candidata of candidatas) {
            if (!candidata || !candidata.url) continue;
            if (dados.itens[candidata.url]) continue;
            dados.itens[candidata.url] = {
                url: candidata.url,
                nome: candidata.nome || '',
                origem: candidata.origem || '',
                molde: candidata.molde || '',
                motivoEsperado: candidata.motivoEsperado || '',
                tentativas: 0,
                adicionadoEm: Date.now(),
                proxima: 0,
                estado: 'esperando',
            };
            novos += 1;
        }
        gravar();
        return novos;
    }

    // Pega o próximo lote que já pode ser testado (respeitando os castigos).
    function proximos(quantidade = 3) {
        carregar();
        const agora = Date.now();
        const lista = Object.values(dados.itens)
            .filter(item => item && item.url && item.estado !== 'resolvida' && Number(item.proxima || 0) <= agora)
            .filter(item => castigoDoDominio(dominioDe(item.url)) < 6)
            .sort((a, b) => (Number(a.tentativas) || 0) - (Number(b.tentativas) || 0) || Number(a.adicionadoEm || 0) - Number(b.adicionadoEm || 0));
        return lista.slice(0, quantidade).map(item => ({
            nome: item.nome, url: item.url, molde: item.molde, origem: item.origem, motivoEsperado: item.motivoEsperado,
        }));
    }

    // Anota o que aconteceu com a candidata (e castiga o domínio quando insiste
    // em falhar, para ninguém ficar batendo na mesma porta).
    function anotar(url, resultado = {}) {
        carregar();
        const item = dados.itens[url];
        if (item) {
            item.tentativas = (Number(item.tentativas) || 0) + 1;
            item.ultimaTentativa = Date.now();
            item.estado = resultado.aprovada ? 'resolvida' : (resultado.estado || 'tentada');
            item.motivo = String(resultado.motivo || '').slice(0, 160);
            if (resultado.aprovada) {
                delete dados.itens[url];
            } else {
                const espera = item.tentativas >= 3 ? CASTIGO_PADRAO : 10 * 60 * 1000;
                item.proxima = Date.now() + espera;
            }
        }
        const dominio = dominioDe(url);
        if (dominio && resultado.erroDeDominio) {
            const chave = `dominio:${dominio}`;
            const registro = dados.itens[chave] || { falhas: 0, adicionadoEm: Date.now() };
            registro.falhas = (Number(registro.falhas) || 0) + 1;
            registro.ultima = Date.now();
            registro.proxima = Date.now() + (registro.falhas >= 6 ? CASTIGO_LONGO : CASTIGO_PADRAO);
            dados.itens[chave] = registro;
        }
        gravar();
    }

    function resumo() {
        carregar();
        const itens = Object.entries(dados.itens).filter(([chave]) => !chave.startsWith('dominio:'));
        const agora = Date.now();
        return {
            total: itens.length,
            esperando: itens.filter(([, v]) => Number(v.proxima || 0) <= agora).length,
            resolvidas: Object.values(dados.itens).filter(v => v && v.estado === 'resolvida').length,
            castigadas: Object.entries(dados.itens).filter(([chave]) => chave.startsWith('dominio:')).length,
        };
    }

    return { enfileirar, proximos, anotar, resumo, arquivo };
}

module.exports = { criarFila };
