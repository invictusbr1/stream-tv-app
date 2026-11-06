// Política única de prioridade das fontes do Conecta TV.
//
// Antes, a ordem dos fornecedores era decidida em vários lugares ao mesmo
// tempo (peso escrito em cada fonte do motor, fórmula própria das fichas do
// caçador, contas soltas de saúde/placar e um critério separado no avaliador).
// Agora existe UM arquivo de regras (politica-fontes.json) e este módulo, que
// é o único que transforma essas regras em ordem:
//
//   1. Sem anúncio  — filtro obrigatório (fonte marcada com anúncio não entra);
//   2. Dublado      — o papel "dublado" sempre vem antes do "hd" (legendado);
//   3. Qualidade    — resolução MEDIDA no arquivo, no avaliador;
//   4. Reprodução direta (sem conversão de áudio);
//   5. Estabilidade — saúde e placar dos aparelhos;
//   6. Velocidade   — só desempata.
//
// O motor (fontes-motor.js) usa `ordenar` para montar a fila; o avaliador
// (avaliador.js) usa `prioridadeDaMedicao` para comparar o que cada fonte
// entregou de verdade; /api/motor/estado usa `explicar` para mostrar o porquê
// de cada posição.

const REGRAS = require('./politica-fontes.json');

const MIN = 60 * 1000;
const tempos = {
    castigo: (REGRAS.castigos?.duasFalhasSeguidasMin ?? 20) * MIN,
    castigoLongo: (REGRAS.castigos?.falhaRepetidaHoras ?? 4) * 60 * MIN,
    castigoLeve: (REGRAS.castigos?.tropecoDeRedeMin ?? 6) * MIN,
    validadeAcerto: (REGRAS.memoria?.lembraAcertoMin ?? 40) * MIN,
    validadeSemTitulo: (REGRAS.memoria?.lembraSemTituloMin ?? 30) * MIN,
    tempoPorFonte: REGRAS.memoria?.tempoPorFonteMs ?? 14000,
};

const PRIORIDADE_PADRAO = 50;

// --------------------------------------------------------------- regra 1
// A regra "sem anúncio" é obrigatória. Hoje nenhuma fonte ativa tem anúncio
// (as que tinham foram removidas), mas uma ficha nova do caçador marcada com
// anúncio é barrada aqui, em vez de depender de alguém lembrar de desligá-la.
function temAnuncio(fonte) {
    if (!fonte) return false;
    return fonte.anuncio === true || fonte.semAnuncio === false;
}

// --------------------------------------------------------------- prioridade
function regraDaFonte(id) {
    return (REGRAS.fontes && REGRAS.fontes[String(id)]) || null;
}

function prioridadeDaFicha(nota) {
    const f = REGRAS.fichasDoCacador || {};
    const n = Math.max(0, Math.min(10, Number(nota) || 0));
    return (f.base ?? 60) + n * (f.porPontoDeNota ?? 3);
}

// Prioridade fixa da fonte: o arquivo de regras manda; depois a nota da ficha
// do caçador; por último o peso que a própria fonte trouxe (usado nos testes).
function prioridade(fonte) {
    const regra = regraDaFonte(fonte?.id);
    if (regra && Number.isFinite(Number(regra.prioridade))) return Number(regra.prioridade);
    if (fonte && fonte.perfil && fonte.notaDaFicha !== undefined) return prioridadeDaFicha(fonte.notaDaFicha);
    if (fonte && Number.isFinite(Number(fonte.peso))) return Number(fonte.peso);
    return PRIORIDADE_PADRAO;
}

// Papel (dublado/hd): o arquivo de regras pode reclassificar uma fonte.
function papelDaFonte(fonte) {
    const regra = regraDaFonte(fonte?.id);
    return (regra && regra.papel) || fonte?.papel || 'dublado';
}

// --------------------------------------------------------------- pontuação
// Maior pontuação = tenta antes. Devolve também os motivos, em português,
// para o diagnóstico mostrar por que a fonte está naquela posição.
function pontuar(fonte, contexto = {}) {
    const a = REGRAS.ajustes || {};
    const agora = contexto.agora || Date.now();
    const s = contexto.saude || {};
    const base = prioridade(fonte);
    const total = (Number(s.acertos) || 0) + (Number(s.falhas) || 0);
    const taxa = total ? (Number(s.acertos) || 0) / total : 0;
    const placar = Number(contexto.placar) || 0;
    const castigada = (Number(s.castigoAte) || 0) > agora;
    const pontos = base
        + taxa * (a.taxaDeAcerto ?? 5)
        + placar * (a.placarDosAparelhos ?? 10)
        - (castigada ? (a.castigada ?? 1000) : 0);
    const motivos = [`prioridade ${base}`];
    if (total) motivos.push(`acerto ${Math.round(taxa * 100)}% (${total} tentativas)`);
    if (placar) motivos.push(`placar dos aparelhos ${placar > 0 ? '+' : ''}${placar}`);
    if (castigada) motivos.push(`de castigo até ${new Date(s.castigoAte).toLocaleTimeString('pt-BR')}${s.ultimoMotivo ? ` (${s.ultimoMotivo})` : ''}`);
    return { pontos: Math.round(pontos * 100) / 100, castigada, motivos };
}

// Fila de um papel, já filtrada e ordenada.
//   fontes   — lista completa (fixas + fichas)
//   papel    — 'dublado' | 'hd'
//   alvo     — título pedido (para `seAplica`)
//   contexto — { saudeDe(id), placarDe(id), agora }
function ordenar(fontes, papel, alvo, contexto = {}) {
    const agora = contexto.agora || Date.now();
    return (fontes || [])
        .filter(f => papelDaFonte(f) === papel)
        .filter(f => !temAnuncio(f))
        // Fonte desligada na política (morta, pede login...) não entra na fila.
        .filter(f => !(regraDaFonte(f.id) && regraDaFonte(f.id).desligada === true))
        .filter(f => !alvo || !f.seAplica || f.seAplica(alvo))
        .map((fonte, i) => ({
            fonte, i,
            ...pontuar(fonte, {
                agora,
                saude: contexto.saudeDe ? contexto.saudeDe(fonte.id) : {},
                placar: contexto.placarDe ? contexto.placarDe(fonte.id) : 0,
            }),
        }))
        // Empate: mantém a ordem de cadastro (estável).
        .sort((x, y) => (y.pontos - x.pontos) || (x.i - y.i));
}

// --------------------------------------------------------------- medição
// Regras 2 a 6 aplicadas ao que a fonte ENTREGOU (usado pelo avaliador).
function alturaEquivalente(largura, altura) {
    if (!(altura > 0)) return 0;
    return largura > 0 ? Math.max(Math.min(largura, altura), Math.max(largura, altura) * 9 / 16) : altura;
}

function alturaDoRotulo(valor) {
    const texto = String(valor || '');
    const pixels = texto.match(/(?:^|\D)(\d{3,4})\s*p\b/i) || texto.match(/\d{3,4}\s*[x×]\s*(\d{3,4})/i);
    if (pixels) return Number(pixels[1]);
    if (/\b(?:4k|uhd)\b/i.test(texto)) return 2160;
    if (/full\s*hd|\bfhd\b/i.test(texto)) return 1080;
    return /\bhd\b/i.test(texto) ? 720 : 0;
}

// Pequenos recortes, como 3832×1600, permanecem na família 4K.
function gavetaDaAltura(altura) {
    return altura >= 4320 * .98 ? 6 : altura >= 2160 * .98 ? 5 : altura >= 1440 * .98 ? 4
        : altura >= 1080 * .98 ? 3 : altura >= 720 * .98 ? 2 : altura > 0 ? 1 : 0;
}
const NOMES_GAVETAS = ['Sem confirmação', 'Qualidade básica', 'HD', 'Full HD', '2K', '4K', 'Acima de 4K'];

// Vetor comparado posição a posição (o primeiro critério que diferir decide):
//   [idioma, qualidade medida?, gaveta, altura, reprodução direta, taxa de bits, −tempo]
// idioma: 2 = português comprovado, 1 = a fonte diz que é dublado,
//         0 = sem informação, −1 = outro idioma comprovado.
function prioridadeDaMedicao({ dados, sonda, idiomaVerificado, ms }) {
    const pt = sonda?.portuguesa || sonda?.padraoPortugues || sonda?.audios?.some(a => /^(?:pt|por)(?:[-_]|$)/i.test(a.lang || ''));
    const outro = idiomaVerificado === 'outro' || (idiomaVerificado !== 'pt' && !pt && sonda?.audios?.some(a => a.lang && a.lang !== 'und' && !/^(?:pt|por)(?:[-_]|$)/i.test(a.lang)));
    const idioma = outro ? -1 : idiomaVerificado === 'pt' || pt ? 2 : dados.audio === 'pt-BR' ? 1 : 0;
    const medida = sonda && !sonda.conversao && sonda.altura > 0;
    const informada = alturaDoRotulo(dados.resolucao);
    const altura = medida ? alturaEquivalente(sonda.largura, sonda.altura) : informada;
    return [idioma, medida ? 1 : 0, idioma === 2 && medida ? gavetaDaAltura(altura) : 0, altura, dados.converter ? 0 : 1, sonda?.banda || 0, -(ms || 0)];
}

// Modo de TESTE: fonte marcada "principal": true em politica-fontes.json
// passa na frente de todas as outras sempre que entregar dublado (idioma ≥ 1
// no vetor). Fora disso a regra normal decide. Tirar a marca desfaz.
function principalEmTeste(id) {
    const regra = regraDaFonte(id);
    return Boolean(regra && regra.principal === true);
}

function compararPrioridade(a, b) {
    for (let i = 0; i < a.length; i++) { if (a[i] !== b[i]) return b[i] - a[i]; }
    return 0;
}

module.exports = {
    REGRAS, tempos,
    temAnuncio, prioridade, prioridadeDaFicha, papelDaFonte, pontuar, ordenar,
    alturaEquivalente, alturaDoRotulo, gavetaDaAltura, NOMES_GAVETAS,
    prioridadeDaMedicao, compararPrioridade, principalEmTeste,
};
