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
const ESPERA_INICIAL = 10 * 60 * 1000;

function objeto(valor) {
    return Boolean(valor && typeof valor === 'object' && !Array.isArray(valor));
}

function numero(valor, padrao = 0) {
    const n = Number(valor);
    return Number.isSafeInteger(n) && n >= 0 ? n : padrao;
}

function texto(valor, limite = 1000) {
    return typeof valor === 'string' ? valor.slice(0, limite) : '';
}

function enderecoValido(valor) {
    if (typeof valor !== 'string' || valor.length > 8192 || /[\u0000-\u001f\u007f]/.test(valor)) return '';
    const url = valor.trim();
    try {
        const endereco = new URL(url);
        return ['https:', 'http:'].includes(endereco.protocol) && endereco.hostname
            && !endereco.username && !endereco.password ? url : '';
    } catch { return ''; }
}

// Os IDs já confirmados por um addon precisam sobreviver à próxima rodada.
// O limite impede que respostas enormes ou circulares derrubem a gravação.
function detalhesSeguros(valor) {
    if (!objeto(valor)) return undefined;
    try {
        const json = JSON.stringify(valor);
        return Buffer.byteLength(json, 'utf8') <= 16384 ? JSON.parse(json) : undefined;
    } catch { return undefined; }
}

function criarFila({ pastaDados } = {}) {
    const arquivo = path.join(pastaDados || path.join(__dirname, 'dados'), 'fila.json');
    let dados = { itens: Object.create(null), ultimoDominio: '' };
    let lido = false;
    let conteudoValido = null;
    const persistencia = { ok: true, recuperada: false, erroCarregamento: null, erroGravacao: null, erroBackup: null, descartados: 0 };

    function ler(origem) {
        const bruto = JSON.parse(fs.readFileSync(origem, 'utf8'));
        if (!objeto(bruto) || !objeto(bruto.itens)) throw Object.assign(new Error('fila inválida'), { code: 'FILA_INVALIDA' });
        const agora = Date.now();
        const itens = Object.create(null);
        let descartados = 0;
        for (const [chave, registro] of Object.entries(bruto.itens)) {
            if (!objeto(registro)) { descartados += 1; continue; }
            if (chave.startsWith('dominio:')) {
                const dominio = chave.slice('dominio:'.length);
                const url = enderecoValido(`https://${dominio}/`);
                if (!url || dominioDe(url) !== dominio || !numero(registro.falhas)) { descartados += 1; continue; }
                itens[chave] = {
                    falhas: numero(registro.falhas), adicionadoEm: numero(registro.adicionadoEm, agora),
                    ultima: numero(registro.ultima), proxima: Math.min(numero(registro.proxima), agora + CASTIGO_LONGO),
                };
                continue;
            }
            const url = enderecoValido(registro.url);
            if (!url || chave !== url || itens[url]) { descartados += 1; continue; }
            const detalhes = detalhesSeguros(registro.detalhes);
            itens[url] = {
                url, nome: texto(registro.nome), origem: texto(registro.origem), molde: texto(registro.molde, 8192),
                motivoEsperado: texto(registro.motivoEsperado), tentativas: numero(registro.tentativas),
                adicionadoEm: numero(registro.adicionadoEm, agora), proxima: Math.min(numero(registro.proxima), agora + CASTIGO_LONGO),
                estado: texto(registro.estado, 80) || 'esperando', motivo: texto(registro.motivo, 160),
                ultimaTentativa: numero(registro.ultimaTentativa), ...(detalhes ? { detalhes } : {}),
            };
        }
        return { dados: { itens, ultimoDominio: texto(bruto.ultimoDominio, 253) }, descartados };
    }

    function carregar() {
        if (lido) return;
        try {
            const leitura = ler(arquivo);
            dados = leitura.dados;
            persistencia.descartados = leitura.descartados;
            if (leitura.descartados) persistencia.erroCarregamento = 'REGISTROS_INVALIDOS';
        } catch (erro) {
            persistencia.erroCarregamento = erro.code === 'ENOENT' ? null : (erro.code || 'JSON_INVALIDO');
            try {
                const leitura = ler(arquivo + '.bak');
                dados = leitura.dados;
                persistencia.descartados = leitura.descartados;
                persistencia.recuperada = true;
            } catch { /* primeiro uso ou cópia também indisponível */ }
            persistencia.ok = !persistencia.erroCarregamento && !persistencia.recuperada;
        }
        limitar();
        if (!persistencia.erroCarregamento || persistencia.recuperada || Object.keys(dados.itens).length) {
            conteudoValido = JSON.stringify(dados, null, 1);
        }
        lido = true;
    }

    function limitar() {
        const chaves = Object.keys(dados.itens);
        // Preserva castigos ativos e candidatas ainda não medidas. Quando
        // só restam novidades, as mais antigas mantêm sua vez na fila.
        if (chaves.length > MAX_ITENS) {
            const agora = Date.now();
            const prioridade = ({ k, v }) => k.startsWith('dominio:')
                ? (v.proxima > agora && v.falhas >= 3 ? 3 : 0)
                : (v.estado === 'resolvida' ? 0 : (v.tentativas > 0 ? 1 : 2));
            const ordenados = chaves
                .map(k => ({ k, v: dados.itens[k] }))
                .sort((a, b) => prioridade(a) - prioridade(b)
                    || (prioridade(a) === 2 ? b.v.adicionadoEm - a.v.adicionadoEm : a.v.adicionadoEm - b.v.adicionadoEm));
            for (const item of ordenados.slice(0, chaves.length - MAX_ITENS)) delete dados.itens[item.k];
            persistencia.descartados += chaves.length - MAX_ITENS;
        }
    }

    function gravar() {
        limitar();
        try {
            fs.mkdirSync(path.dirname(arquivo), { recursive: true });
            const temporario = arquivo + '.tmp';
            const conteudo = JSON.stringify(dados, null, 1);
            fs.writeFileSync(temporario, conteudo);
            // Nunca troca a última cópia válida por um arquivo corrompido.
            if (conteudoValido !== null) {
                try {
                    fs.writeFileSync(arquivo + '.bak.tmp', conteudoValido);
                    fs.renameSync(arquivo + '.bak.tmp', arquivo + '.bak');
                    persistencia.erroBackup = null;
                }
                catch (erro) { persistencia.erroBackup = erro.code || 'FALHA_BACKUP'; }
            }
            fs.renameSync(temporario, arquivo);
            conteudoValido = conteudo;
            persistencia.ok = !persistencia.erroBackup;
            persistencia.erroGravacao = null;
        } catch (erro) {
            // A rodada continua na memória, mas o painel pode mostrar que o
            // estado ainda não sobrevive a um reinício.
            persistencia.ok = false;
            persistencia.erroGravacao = erro.code || 'FALHA_GRAVACAO';
        }
    }

    function dominioDe(url) {
        try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
    }

    // Quantas falhas seguidas aquele domínio já acumulou.
    function dominioDisponivel(dominio, agora) {
        const chave = `dominio:${dominio}`;
        const registro = dados.itens[chave];
        return !registro || Number(registro.falhas || 0) < 3 || Number(registro.proxima || 0) <= agora;
    }

    function enfileirar(candidatas = []) {
        carregar();
        const novos = [];
        if (!Array.isArray(candidatas)) return 0;
        for (const candidata of candidatas) {
            if (!objeto(candidata)) continue;
            const url = enderecoValido(candidata.url);
            if (!url || dados.itens[url]) continue;
            const detalhes = detalhesSeguros(candidata.detalhes);
            dados.itens[url] = {
                url,
                nome: texto(candidata.nome),
                origem: texto(candidata.origem),
                molde: texto(candidata.molde, 8192),
                motivoEsperado: texto(candidata.motivoEsperado),
                ...(detalhes ? { detalhes } : {}),
                tentativas: 0,
                adicionadoEm: Date.now(),
                proxima: 0,
                estado: 'esperando',
            };
            novos.push(url);
        }
        if (novos.length) gravar();
        return novos.filter(url => dados.itens[url]).length;
    }

    // Pega o próximo lote que já pode ser testado (respeitando os castigos).
    function proximos(quantidade = 3) {
        carregar();
        const agora = Date.now();
        const lista = Object.values(dados.itens)
            .filter(item => item && item.url && item.estado !== 'resolvida' && Number(item.proxima || 0) <= agora)
            .filter(item => dominioDisponivel(dominioDe(item.url), agora))
            .sort((a, b) => (Number(a.tentativas) || 0) - (Number(b.tentativas) || 0) || Number(a.adicionadoEm || 0) - Number(b.adicionadoEm || 0));
        // Alterna os domínios: um site com milhares de URLs não ocupa toda a rodada.
        const grupos = new Map();
        for (const item of lista) {
            const dominio = dominioDe(item.url);
            if (!grupos.has(dominio)) grupos.set(dominio, []);
            grupos.get(dominio).push(item);
        }
        const escolhidos = [];
        const n = Number(quantidade);
        const limite = Number.isFinite(n) ? Math.max(0, Math.min(MAX_ITENS, Math.floor(n))) : 0;
        // O cursor também funciona quando a última URL daquele domínio foi
        // aprovada e removida: começa no próximo nome, sem voltar ao maior.
        const dominios = [...grupos.keys()].sort();
        const seguinte = dominios.findIndex(dominio => dominio > dados.ultimoDominio);
        const inicio = seguinte < 0 ? 0 : seguinte;
        const ordem = dominios.slice(inicio).concat(dominios.slice(0, inicio));
        while (escolhidos.length < limite && grupos.size) {
            for (const dominio of ordem) {
                const itens = grupos.get(dominio);
                if (!itens) continue;
                escolhidos.push(itens.shift());
                dados.ultimoDominio = dominio;
                if (!itens.length) grupos.delete(dominio);
                if (escolhidos.length >= limite) break;
            }
        }
        if (escolhidos.length) gravar();
        return escolhidos.map(item => ({
            nome: item.nome, url: item.url, molde: item.molde, origem: item.origem, motivoEsperado: item.motivoEsperado,
            ...(item.detalhes ? { detalhes: detalhesSeguros(item.detalhes) } : {}),
        }));
    }

    // Anota o que aconteceu com a candidata (e castiga o domínio quando insiste
    // em falhar, para ninguém ficar batendo na mesma porta).
    function anotar(url, resultado = {}) {
        carregar();
        url = enderecoValido(url);
        if (!url) return;
        if (!objeto(resultado)) resultado = {};
        const agora = Date.now();
        const item = dados.itens[url];
        if (item) {
            item.tentativas = (Number(item.tentativas) || 0) + 1;
            item.ultimaTentativa = agora;
            item.estado = resultado.aprovada ? 'resolvida' : (texto(resultado.estado, 80) || 'tentada');
            item.motivo = String(resultado.motivo || '').slice(0, 160);
            if (resultado.aprovada) {
                delete dados.itens[url];
            } else {
                const espera = item.tentativas >= 3
                    ? Math.min(CASTIGO_LONGO, CASTIGO_PADRAO * 2 ** Math.min(2, item.tentativas - 3))
                    : ESPERA_INICIAL * item.tentativas;
                item.proxima = agora + espera;
            }
        }
        const dominio = dominioDe(url);
        if (dominio && (resultado.aprovada || resultado.erroDeDominio === false)) delete dados.itens[`dominio:${dominio}`];
        if (dominio && !resultado.aprovada && resultado.erroDeDominio) {
            const chave = `dominio:${dominio}`;
            const registro = dados.itens[chave] || { falhas: 0, adicionadoEm: agora };
            registro.falhas = (Number(registro.falhas) || 0) + 1;
            registro.ultima = agora;
            registro.proxima = agora + (registro.falhas >= 6 ? CASTIGO_LONGO : CASTIGO_PADRAO);
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
            esperando: itens.filter(([, v]) => v.estado !== 'resolvida' && Number(v.proxima || 0) <= agora && dominioDisponivel(dominioDe(v.url), agora)).length,
            resolvidas: Object.values(dados.itens).filter(v => v && v.estado === 'resolvida').length,
            castigadas: Object.entries(dados.itens).filter(([chave, v]) => chave.startsWith('dominio:') && Number(v.falhas || 0) >= 3 && Number(v.proxima || 0) > agora).length,
            persistencia: { ...persistencia },
        };
    }

    return { enfileirar, proximos, anotar, resumo, arquivo };
}

module.exports = { criarFila };
