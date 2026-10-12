'use strict';
const source = require('../mininovelas-source');
async function cacarMininovelas({ buscar = require('../mininovelas-http').buscarPagina, tocar = require('./verificar-navegador').tocarNoNavegador, registrar = () => {}, signal } = {}) {
    const candidatas = [];
    for (const f of source.fornecedores) {
        require('./rede-cacador').checarRodada();
        if (signal?.aborted) break;
        if (!f.conector) { candidatas.push({ nome:f.nome, situacao:'pendente', motivo:f.pendente || 'Conector de reprodução interna ainda em análise' }); continue; }
        registrar('mininovelas: testando episódios públicos de ' + f.nome);
        const provas = [];
        try {
            const items = source.catalogo(f.id, await buscar(f.site));
            for (const item of items.slice(0, 2)) {
                require('./rede-cacador').checarRodada();
                if (signal?.aborted) break;
                try {
                    let ep = source.episodios(f.id, await buscar(item.pagina)).find(e => e.disponivel);
                    if (ep?.pagina && f.id === 'doraminhatv') ep = source.episodioDora(await buscar(ep.pagina),ep.numero);
                    if (!ep || !ep.disponivel || !ep.url) { provas.push({ titulo:item.titulo, tocou:false, motivo:'Nenhum episódio público liberado' }); continue; }
                    const medida = await tocar(ep.url, { tipo:ep.tipo || (/\.mp4(?:\?|$)/i.test(ep.url) ? 'file':'hls'), segundos:12, signal });
                    provas.push({ titulo:item.titulo, episodio:ep.numero, tocou:medida.tocou === true, altura:medida.altura || 0, idiomaInformado:ep.audio, motivo:medida.erro || '' });
                } catch { provas.push({ titulo:item.titulo, tocou:false, motivo:'Página do episódio indisponível' }); }
            }
            const sucessos = provas.filter(p => p.tocou).length;
            candidatas.push({ nome:f.nome, situacao:sucessos ? 'prévia confirmada':'em análise', motivo:`${sucessos}/${provas.length} prévias reproduzidas; catálogo completo e dublagem ainda não aprovados`, provas });
        } catch { candidatas.push({ nome:f.nome, situacao:'em análise', motivo:'Catálogo público indisponível nesta rodada', provas }); }
    }
    return { id:'short-drama', nome:'Mininovelas', atualizadoEm:new Date().toISOString(), ranking:[], jaNoApp:[], candidatas, historico:[] };
}
module.exports = { cacarMininovelas };
