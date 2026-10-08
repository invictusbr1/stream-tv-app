// Motor de fontes do Conecta TV.
//
// Um único lugar decide qual fonte usar, na ordem da regra do projeto:
//   1. dublado e limpo        (sem anúncio)
//   2. alta definição limpa   (com legenda em português quando existir)
//   3. fonte com verificação  (último caso, e conferida antes)
//
// O motor é "inteligente" porque:
//   - lembra qual fonte deu certo para cada título (a próxima abertura é direta);
//   - lembra qual fonte não tem aquele título e não perde tempo repetindo;
//   - guarda o histórico de acertos e falhas de cada fonte;
//   - repete a tentativa quando o erro pode ser momentâneo (rede), mas não
//     quando a própria fonte respondeu que não tem o título;
//   - rebaixa temporariamente só a fonte que falhou duas vezes seguidas — uma
//     falha isolada costuma ser do título, não do fornecedor.

const fs = require('fs');
const path = require('path');
const os = require('os');

const TEMPO_FONTE = 14000;      // limite por fonte
const VALIDADE_ACERTO = 40 * 60 * 1000;  // lembra o acerto por 40 minutos
const VALIDADE_SEM_TITULO = 30 * 60 * 1000; // lembra "não tem este título" por 30 minutos
const CASTIGO = 6 * 60 * 1000;  // fonte que falhou sai da frente por 6 minutos
// No aplicativo instalado a pasta do programa é só de leitura: o histórico vive
// na pasta do usuário. Rodando do projeto, fica junto dos relatórios.
const ARQUIVO_SAUDE = process.pkg
    ? path.join(os.homedir(), '.conecta-tv', 'fontes-saude.json')
    : path.join(__dirname, 'relatorios', 'fontes-saude.json');

// ---------------------------------------------------------------
// Memória de idiomas confirmados pela central.
//
// A central ouve o áudio de cada fonte (ffmpeg + transcrição) e grava o
// resultado em "dados/idiomas.json". O aplicativo lê esse arquivo — quando a
// central está no mesmo computador — e já começa pela fonte que entrega
// português de verdade, deixando as que entregam outro idioma para o fim.
// ---------------------------------------------------------------
function caminhosDeIdiomas() {
    const caminhos = [];
    if (process.env.CENTRAL_IDIOMAS) caminhos.push(process.env.CENTRAL_IDIOMAS);
    if (process.pkg) {
        const pastaApp = path.dirname(process.execPath);
        caminhos.push(path.join(pastaApp, '..', 'Conecta TV Central', 'dados', 'idiomas.json'));
        caminhos.push(path.join(os.homedir(), 'Conecta TV Central', 'dados', 'idiomas.json'));
    } else {
        caminhos.push(path.join(__dirname, 'central', 'dados', 'idiomas.json'));
    }
    return caminhos;
}

let idiomasVerificados = { lidoEm: 0, mapa: {} };

function lerIdiomasVerificados() {
    if (Date.now() - idiomasVerificados.lidoEm < 60000) return idiomasVerificados.mapa;
    const mapa = {};
    for (const arquivo of caminhosDeIdiomas()) {
        try {
            const dados = JSON.parse(fs.readFileSync(arquivo, 'utf8')) || {};
            for (const [chave, valor] of Object.entries(dados)) {
                const partes = String(chave).split('|');
                if (partes.length < 2) continue;
                const fonteId = partes.shift();
                const titulo = partes.join('|');
                if (!mapa[titulo]) mapa[titulo] = {};
                const idioma = valor && valor.idioma;
                if (idioma === 'pt' || idioma === 'outro') mapa[titulo][fonteId] = idioma;
            }
            break;
        } catch { /* tenta o próximo caminho */ }
    }
    idiomasVerificados = { lidoEm: Date.now(), mapa };
    return mapa;
}

function esquecerIdiomas() { idiomasVerificados = { lidoEm: 0, mapa: {} }; }

const acertos = new Map();   // chave do título -> { fonte, expira, dados }
const semTitulo = new Map(); // `chave do título|fonte` -> expira
const saude = new Map();     // fonte -> { acertos, falhas, castigoAte, ultimoMotivo }

function carregarSaude() {
    try {
        const dados = JSON.parse(fs.readFileSync(ARQUIVO_SAUDE, 'utf8'));
        Object.entries(dados || {}).forEach(([chave, valor]) => saude.set(chave, valor));
    } catch { /* primeiro uso */ }
}
function salvarSaude() {
    try {
        fs.mkdirSync(path.dirname(ARQUIVO_SAUDE), { recursive: true });
        fs.writeFileSync(ARQUIVO_SAUDE, JSON.stringify(Object.fromEntries(saude), null, 2));
    } catch { /* sem permissão de escrita: segue só na memória */ }
}
carregarSaude();

function estadoDaFonte(id) {
    if (!saude.has(id)) saude.set(id, { acertos: 0, falhas: 0, falhasSeguidas: 0, semTitulo: 0, castigoAte: 0, ultimoMotivo: '' });
    return saude.get(id);
}
function anotarAcerto(id) {
    const s = estadoDaFonte(id);
    s.acertos += 1; s.falhasSeguidas = 0; s.castigoAte = 0; s.ultimoMotivo = '';
    salvarSaude();
}
function anotarFalha(id, motivo) {
    const s = estadoDaFonte(id);
    s.falhas += 1;
    s.falhasSeguidas = (s.falhasSeguidas || 0) + 1;
    if (s.falhasSeguidas >= 2) s.castigoAte = Date.now() + CASTIGO;
    s.ultimoMotivo = String(motivo || '').slice(0, 120);
    salvarSaude();
}
// A fonte respondeu que não tem este título: isso não é defeito da fonte.
function anotarSemTitulo(id, chave) {
    semTitulo.set(`${chave}|${id}`, Date.now() + VALIDADE_SEM_TITULO);
    const s = estadoDaFonte(id);
    s.semTitulo = (s.semTitulo || 0) + 1;
    salvarSaude();
}

function comPrazo(promessa, ms) {
    let relogio;
    return Promise.race([
        promessa,
        new Promise(resolve => { relogio = setTimeout(() => resolve(null), ms); })
    ]).finally(() => clearTimeout(relogio));
}

// ---------------------------------------------------------------
// Registro das fontes. Para acrescentar uma fonte nova, basta incluir
// um item aqui: o motor cuida da ordem, do cache e da saúde.
// ---------------------------------------------------------------
// Endereço da fonte dublada principal. Filme vai em /movie; episódio vai em
// /tvshow/{id}/{temporada}/{episódio} — o caminho /serie exige sessão paga e
// manda para a tela de login, por isso não é usado.
function enderecoWatchPlay(alvo) {
    return alvo.tipo === 'tv'
        ? `https://v2.watchplay.shop/tvshow/${alvo.tmdbId}/${alvo.temporada}/${alvo.episodio}`
        : `https://v2.watchplay.shop/movie/${alvo.tmdbId}`;
}

const FONTES = [
    {
        id: 'watchplay',
        nome: 'Dublado · fonte limpa',
        papel: 'dublado',
        peso: 100,
        seAplica: alvo => alvo.tipo === 'tv' || alvo.tipo === 'movie',
        resolver: async id => {
            const alvo = typeof id === 'object' ? id : { tipo: 'movie', tmdbId: id };
            const axios = require('axios');
            const cookie = process.env.WATCHPLAY_COOKIE || (() => {
                try { return JSON.parse(require('fs').readFileSync(require('path').join(__dirname, 'config.local.json'), 'utf8')).watchplayCookie || ''; } catch { return ''; }
            })();
            const endereco = enderecoWatchPlay(alvo);
            const r = await axios.get(endereco, {
                timeout: 10000,
                maxRedirects: 0,
                maxContentLength: 1024 * 1024,
                responseType: 'text',
                validateStatus: s => s === 200,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
                    'Accept-Language': 'pt-BR,pt;q=0.9',
                    ...(cookie ? { Cookie: cookie } : {})
                }
            });
            const dados = require('./playback-source').parseWatchPlay(r.data);
            return { ...dados, fonte: dados.source || 'Dublado limpo', resolucao: '720p' };
        }
    },
    {
        // Séries dubladas do PipocaCine: o endereço de cada episódio sai da
        // página da própria série e o arquivo vai direto para o nosso player.
        id: 'pipoca-serie',
        nome: 'Dublado · série (arquivo limpo)',
        papel: 'dublado',
        peso: 85,
        seAplica: alvo => alvo.tipo === 'tv',
        resolver: async id => {
            if (typeof id !== 'object') return null;
            const dados = await require('./pipoca-source').resolverEpisodio(id.tmdbId, id.temporada, id.episodio);
            if (!dados) return null;
            return { ...dados, final: true };
        }
    },
    {
        // MGEB (mgeb.top), o MegaEmbed por trás do BRFlix: entrega as opções
        // de vídeo no próprio HTML. Medido com ffprobe: arquivo MP4 em HD
        // (1280 de largura) com áudio em português ("por") tanto nos filmes
        // quanto nas séries, sem anúncio e com avanço livre. Por isso é a
        // segunda opção dublada — atrás só da fonte dublada principal.
        id: 'mgeb',
        nome: 'Dublado · MGEB',
        papel: 'dublado',
        peso: 88,
        seAplica: alvo => alvo.tipo === 'tv' || alvo.tipo === 'movie',
        resolver: async id => {
            if (typeof id !== 'object') return null;
            const mgeb = require('./mgeb-source');
            const dados = id.tipo === 'tv'
                ? await mgeb.resolverEpisodio(id.tmdbId, id.temporada, id.episodio)
                : await mgeb.resolver('movie', id.tmdbId);
            if (!dados) return null;
            return dados;
        }
    },
    {
        id: 'pipoca',
        nome: 'PipocaCine · dublado',
        papel: 'dublado',
        // Filmes: esta é a fonte com dublado CONFERIDO (o provedor rotula o
        // arquivo como "HD DUB" e a faixa em português vem marcada como padrão
        // — medido com ffprobe). A fonte principal apenas "avisa" que é
        // dublada e em alguns títulos entrega o áudio original (caso do
        // "A Luta pela Esperança"), por isso ela passa a ser a segunda opção.
        peso: 105,
        // Esta entrada é só de filme; série é tratada logo acima.
        seAplica: alvo => alvo.tipo !== 'tv',
        resolver: async id => {
            // O motor entrega o alvo como objeto { tipo, tmdbId }. Antes esta
            // fonte só aceitava um número solto e por isso NUNCA era usada —
            // era o motivo de o filme cair para o áudio original (sem dublado)
            // quando a fonte principal abria mas não tocava.
            const alvo = typeof id === 'object' ? id : { tipo: 'movie', tmdbId: id };
            if (alvo.tipo === 'tv') return null; // somente filmes
            const dados = await require('./pipoca-source').resolverFilme(alvo.tmdbId);
            if (!dados) return null;
            return { ...dados, final: true };
        }
    },
    {
        id: 'vixsrc',
        nome: 'Full HD · legenda em português',
        papel: 'hd',
        peso: 80,
        resolver: async id => {
            const alvo = typeof id === 'object' ? id : { tipo: 'movie', tmdbId: id };
            const dados = await require('./vixsrc-source').resolver(alvo.tmdbId, alvo.tipo === 'tv' ? 'tv' : 'movie', alvo.temporada, alvo.episodio);
            if (!dados || !dados.url) return null;
            const legendas = Array.isArray(dados.legendas) ? dados.legendas : [];
            return {
                url: dados.url,
                audio: 'original',
                fonte: 'Vixsrc',
                resolucao: dados.qualidade || '',
                legendas,
                legendaPortugues: legendas.some(n => /portugu|brazil|brasil/i.test(String(n)))
            };
        }
    },
    {
        id: 'vidsrc',
        nome: 'Full HD · lançamentos',
        papel: 'hd',
        peso: 70,
        resolver: async id => {
            const alvo = typeof id === 'object' ? id : { tipo: 'movie', tmdbId: id };
            const dados = await require('./vidsrc-source').resolver(alvo.tipo === 'tv' ? 'tv' : 'movie', alvo.tmdbId, alvo.temporada, alvo.episodio);
            if (!dados || !dados.url) return null;
            return { url: dados.url, audio: 'original', fonte: dados.fonte, resolucao: dados.qualidade || 'Full HD', legendas: [], legendaPortugues: false };
        }
    }
];

// Ordem do momento: papel primeiro, depois peso, depois saúde da fonte.
// Fontes que não valem para aquele tipo de título (filme x série) nem entram.
function ordem(papel, alvo) {
    const agora = Date.now();
    return FONTES
        .filter(f => f.papel === papel)
        .filter(f => !alvo || !f.seAplica || f.seAplica(alvo))
        .map(f => {
            const s = estadoDaFonte(f.id);
            const castigada = s.castigoAte > agora ? 1 : 0;
            const taxa = s.acertos / Math.max(1, s.acertos + s.falhas);
            // Menor nota vem primeiro. A regra do produto manda (peso): a fonte
            // que acabou de falhar vai para o fim e o histórico só desempata.
            return { fonte: f, nota: (castigada ? 1000 : 0) - f.peso - taxa * 5 };
        })
        .sort((a, b) => a.nota - b.nota)
        .map(item => item.fonte);
}

function chaveDoTitulo(alvo) {
    return alvo.tipo === 'tv'
        ? `tv:${alvo.tmdbId}:${alvo.temporada}:${alvo.episodio}`
        : `movie:${alvo.tmdbId}`;
}

// Escolhe a primeira fonte que responde. Erro de rede ganha uma segunda
// tentativa; "não tenho este título" não se repete — a fonte vai para o fim da
// fila só naquele título, e o resultado bom fica lembrado para a próxima vez.
async function escolher(papel, alvo, opcoes = {}) {
    // O aplicativo pode pedir para pular fontes que acabaram de não tocar
    // (rodízio de fontes dubladas antes de cair para o áudio original).
    const exceto = new Set((opcoes.exceto || []).map(item => String(item)));
    // A memória é por título E por papel: um filme que abriu dublado não pode
    // ser devolvido quando o aplicativo pede a versão de alta definição.
    const chave = `${papel}:${chaveDoTitulo(alvo)}`;
    const lembrado = acertos.get(chave);
    // Um acerto lembrado não vale quando a fonte acabou de não tocar neste
    // título (aviso do player) nem quando o aplicativo pediu para pulá-la.
    const lembradoBloqueado = lembrado && lembrado.dados
        && (semTitulo.get(`${chave}|${lembrado.dados.fonteId}`) || 0) > Date.now();
    if (lembrado && lembrado.expira > Date.now() && lembrado.dados && !lembradoBloqueado && !exceto.has(String(lembrado.dados.fonteId))) return lembrado.dados;

    const agora = Date.now();
    const lista = ordem(papel, alvo).filter(fonte => !exceto.has(String(fonte.id)));
    // O que a central já confirmou manda: fonte com português confirmado vai
    // na frente; fonte que entregou outro idioma vai para o fim da fila.
    const idiomasDoTitulo = lerIdiomasVerificados()[chaveDoTitulo(alvo)] || {};
    if (Object.keys(idiomasDoTitulo).length) {
        const pesoDoIdioma = fonte => (idiomasDoTitulo[fonte.id] === 'pt' ? -1 : idiomasDoTitulo[fonte.id] === 'outro' ? 1 : 0);
        lista.sort((a, b) => pesoDoIdioma(a) - pesoDoIdioma(b));
    }
    const semEsteTitulo = fonte => (semTitulo.get(`${chave}|${fonte.id}`) || 0) > agora;
    // Quem já disse que não tem o título só é tentado se ninguém mais responder.
    const tentar = [...lista.filter(f => !semEsteTitulo(f)), ...lista.filter(semEsteTitulo)];

    for (const fonte of tentar) {
        let erroDeRede = false;
        for (let tentativa = 0; tentativa < 2; tentativa++) {
            let dados = null;
            try {
                dados = await comPrazo(fonte.resolver(alvo), TEMPO_FONTE);
                erroDeRede = false;
            } catch (erro) {
                dados = null;
                erroDeRede = true;
                anotarFalha(fonte.id, erro.message);
            }
            if (dados && dados.url) {
                anotarAcerto(fonte.id);
                const pronto = { ...dados, fonteId: fonte.id };
                // Fontes com endereço assinado informam por quanto tempo o
                // resultado vale (ex.: PipocaCine responde 410 depois de um
                // tempo) — nunca guardamos mais do que isso.
                const validade = Number(dados.validadeMs) > 0 ? Math.min(Number(dados.validadeMs), VALIDADE_ACERTO) : VALIDADE_ACERTO;
                acertos.set(chave, { dados: pronto, expira: Date.now() + validade });
                return pronto;
            }
            if (!dados) {
                if (erroDeRede) { anotarFalha(fonte.id, 'sem resposta'); continue; }
                anotarSemTitulo(fonte.id, chave);
                break; // a fonte respondeu: este título não está lá. Não insiste.
            }
        }
    }
    return null;
}

function estado() {
    return FONTES.map(f => {
        const s = estadoDaFonte(f.id);
        return {
            id: f.id,
            nome: f.nome,
            papel: f.papel,
            acertos: s.acertos,
            falhas: s.falhas,
            falhasSeguidas: s.falhasSeguidas || 0,
            semTitulo: s.semTitulo || 0,
            castigada: s.castigoAte > Date.now(),
            ultimoMotivo: s.ultimoMotivo
        };
    });
}

// Preparo do endereço para o player: tudo passa pelo encaminhamento do
// aplicativo (o navegador não consegue falar direto com alguns provedores).
function prepararParaPlayer(escolhido) {
    const midia = require('./midia-proxy');
    if (escolhido.final) return escolhido; // já é um arquivo direto liberado
    let referer = '';
    let host = '';
    try {
        host = new URL(escolhido.url).hostname;
        referer = midia.refererPadrao(host);
        if (!referer) midia.liberarHost(host);
    } catch { /* endereço inválido */ }
    return { ...escolhido, urlAplicativo: midia.urlViaProxy(escolhido.url, referer) };
}

// Usado pelos testes: limpa histórico e memória de acertos.
function reiniciarParaTeste() {
    saude.clear();
    acertos.clear();
    semTitulo.clear();
}

// Usado pelos testes: esquece só "esta fonte abriu este título".
function esquecerAcertos() {
    acertos.clear();
}

// O player avisou que a fonte abriu mas não tocou: ela perde prioridade no
// geral e, quando o título é informado, também naquele título — assim a
// próxima abertura já começa pela fonte seguinte.
function registrarFalha(fonteId, motivo, chaveTitulo) {
    const id = String(fonteId || '').trim();
    if (!id) return false;
    if (!FONTES.some(fonte => fonte.id === id)) return false;
    anotarFalha(id, motivo || 'a reprodução não abriu');
    if (chaveTitulo) semTitulo.set(`${chaveTitulo}|${id}`, Date.now() + VALIDADE_SEM_TITULO);
    return true;
}

function alvoDoEvento(tipo, tmdbId, temporada, episodio) {
    const id = String(tmdbId || '').trim();
    if (!/^\d{1,10}$/.test(id)) return null;
    return String(tipo) === 'tv'
        ? { tipo: 'tv', tmdbId: id, temporada: String(temporada || 1), episodio: String(episodio || 1) }
        : { tipo: 'movie', tmdbId: id };
}

module.exports = { escolher, prepararParaPlayer, estado, FONTES, enderecoWatchPlay, reiniciarParaTeste, esquecerAcertos, registrarFalha, chaveDoTitulo, alvoDoEvento, lerIdiomasVerificados, esquecerIdiomas };
