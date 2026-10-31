'use strict';
// Relatório da semana: o que a família viveu de verdade ao apertar "Assistir".
// Lê as sessões de reprodução (as mesmas da Central) e responde:
//   - quantas abriram de primeira, quantas precisaram trocar de fonte e quantas falharam;
//   - quanto tempo, em média, até a primeira imagem;
//   - quais fontes mais abriram e mais falharam;
//   - quem teve mais problema e quais títulos falharam.

function mediana(lista) {
    const v = lista.filter(n => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
    if (!v.length) return null;
    const meio = Math.floor(v.length / 2);
    return v.length % 2 ? v[meio] : Math.round((v[meio - 1] + v[meio]) / 2);
}

function relatorio(sessoes, { dias = 7, agora = Date.now() } = {}) {
    const corte = agora - dias * 86400000;
    const lista = (Array.isArray(sessoes) ? sessoes : []).filter(s => Date.parse(s.criadoEm || s.atualizadoEm) >= corte);
    const fontes = new Map(), pessoas = new Map(), titulos = new Map();
    let deprimeira = 0, comTroca = 0, falharam = 0, travamentos = 0, tempoTravadoMs = 0;
    const tempos = [];
    for (const s of lista) {
        const tentativas = Array.isArray(s.tentativas) ? s.tentativas : [];
        const abriuEm = tentativas.findIndex(t => t.resultado === 'abriu' || (t.tempoAberturaMs > 0));
        const quem = String(s.nome || 'Sem nome').slice(0, 40);
        const p = pessoas.get(quem) || { nome: quem, sessoes: 0, falhas: 0 };
        p.sessoes++;
        if (abriuEm === 0) deprimeira++;
        else if (abriuEm > 0) comTroca++;
        else if (tentativas.some(t => t.resultado === 'falhou')) { falharam++; p.falhas++; const chave = String(s.titulo || s.id || '?').slice(0, 80); titulos.set(chave, (titulos.get(chave) || 0) + 1); }
        pessoas.set(quem, p);
        for (const t of tentativas) {
            if (!t.fonteId) continue;
            const f = fontes.get(t.fonteId) || { id: t.fonteId, nome: String(t.fonte || t.fonteId).slice(0, 50), abriu: 0, falhou: 0, travamentos: 0 };
            if (t.resultado === 'abriu' || t.tempoAberturaMs > 0) f.abriu++;
            if (t.resultado === 'falhou') f.falhou++;
            f.travamentos += Number(t.travamentos) || 0;
            fontes.set(t.fonteId, f);
            travamentos += Number(t.travamentos) || 0;
            tempoTravadoMs += Number(t.tempoTravadoMs) || 0;
            if (Number(t.tempoAberturaMs) > 0) tempos.push(Number(t.tempoAberturaMs));
        }
    }
    const total = lista.length;
    const pct = n => total ? Math.round(n / total * 100) : 0;
    return {
        dias, total,
        deprimeira, comTroca, falharam,
        taxaDePrimeira: pct(deprimeira), taxaQueAbriu: pct(deprimeira + comTroca),
        aberturaMedianaMs: mediana(tempos),
        aberturaLentas: tempos.filter(n => n > 12000).length,
        travamentos, tempoTravadoMs,
        fontes: [...fontes.values()].map(f => ({ ...f, taxa: f.abriu + f.falhou ? Math.round(f.abriu / (f.abriu + f.falhou) * 100) : 0 }))
            .sort((a, b) => (b.abriu + b.falhou) - (a.abriu + a.falhou)).slice(0, 12),
        pessoas: [...pessoas.values()].sort((a, b) => b.falhas - a.falhas || b.sessoes - a.sessoes).slice(0, 10),
        titulosQueFalharam: [...titulos.entries()].map(([titulo, vezes]) => ({ titulo, vezes })).sort((a, b) => b.vezes - a.vezes).slice(0, 10),
    };
}

module.exports = { relatorio, mediana };
