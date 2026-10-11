'use strict';
window.StreamMininovelas = (() => {
    let geracao = 0, fornecedor = 'dramabox';
    const source = window.StreamMininovelasSource;
    const fetcher = (url) => fetch(url, { signal: timeoutSignal(url.includes('doraminhatv') ? 65000 : 20000) });
    const grid = () => el('grid');
    async function open() {
        window.StreamLibrary?.cancel?.();
        const token = ++geracao;
        el('hero').hidden = true; el('catalogo').classList.add('oculto'); el('resultados').classList.remove('oculto');
        if (el('continuar-view')) el('continuar-view').hidden = true;
        window.mostrarCabecalhoDoCatalogo?.(false);
        el('resultados-titulo').textContent = 'Mininovelas';
        el('library-filters').hidden = true;
        document.querySelectorAll('.page-controls').forEach(x => { x.hidden = true; });
        grid().replaceChildren();
        const filtros = document.createElement('div'); filtros.style.gridColumn = '1 / -1';
        source.fornecedores.forEach(f => {
            const b = document.createElement('button'); b.type = 'button'; b.className = 'quiet';
            b.textContent = f.nome + (f.conector ? '' : ' · pendente'); b.setAttribute('aria-pressed', String(fornecedor === f.id));
            b.onclick = () => { fornecedor = f.id; open(); }; filtros.append(b);
        });
        const aviso = document.createElement('p'); aviso.style.gridColumn = '1 / -1';
        aviso.textContent = 'Carregando o catálogo do fornecedor…';
        grid().append(filtros, aviso);
        const f = source.fornecedores.find(f => f.id === fornecedor);
        if (!f.conector) { aviso.textContent = f.pendente || 'Reprodução dentro do Conecta TV ainda não disponível para este fornecedor.'; return; }
        try {
            const html = await source.buscarPagina(f.site, fetcher);
            if (token !== geracao || !document.querySelector('[data-cat="short-drama"].ativo')) return;
            let items = source.catalogo(f.id, html);
            if (f.destaque) {
                try { const destaque = source.catalogo(f.id,await source.buscarPagina(f.destaque,fetcher)); if (token !== geracao) return; items = [...destaque,...items.filter(i => !destaque.some(d => d.id === i.id))]; } catch {}
            }
            aviso.textContent = items.length ? 'Episódios públicos disponíveis. Outros podem exigir acesso no fornecedor. Idioma informado por episódio.' : 'O catálogo não respondeu no formato esperado. Tente novamente mais tarde.';
            items.forEach(item => {
                const b = document.createElement('button'); b.className = 'card'; b.type = 'button';
                if (/^https:\/\//.test(item.capa)) { const img = document.createElement('img'); img.src = item.capa; img.alt = ''; img.loading = 'lazy'; b.append(img); }
                const titulo = document.createElement('span'); titulo.className = 'card-titulo'; titulo.textContent = item.titulo; b.append(titulo);
                b.onclick = () => detalhes(item); grid().append(b);
            });
        } catch (e) { if (token === geracao) aviso.textContent = e.message; }
    }
    async function detalhes(item) {
        const token = ++geracao;
        grid().replaceChildren();
        const voltar = document.createElement('button'); voltar.className = 'quiet'; voltar.textContent = '‹ Voltar às mininovelas'; voltar.onclick = open;
        const estado = document.createElement('p'); estado.style.gridColumn = '1 / -1'; estado.textContent = 'Buscando episódios…';
        el('resultados-titulo').textContent = item.titulo;
        const resumo = document.createElement('div'); resumo.style.cssText = 'grid-column:1/-1;display:flex;gap:18px;align-items:flex-start;margin:10px 0';
        if (/^https:\/\//.test(item.capa)) { const img = document.createElement('img'); img.src = item.capa; img.alt = ''; img.style.cssText = 'width:85px!important;height:125px!important;min-width:85px!important;max-width:85px!important;object-fit:cover!important;border-radius:10px;flex-shrink:0'; resumo.append(img); }
        const descricao = document.createElement('p'); descricao.textContent = item.sinopse || 'Escolha abaixo o episódio que deseja assistir.'; descricao.style.cssText = 'margin:0;color:#bdc8d7;line-height:1.5;font-size:14px;max-width:650px;min-width:0;overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:5;-webkit-box-orient:vertical;overflow:hidden'; resumo.append(descricao);
        grid().append(voltar,resumo,estado);
        try {
            let html = await source.buscarPagina(item.pagina, fetcher), indice = null;
            if (item.fornecedor === 'doraminhatv') { const d = JSON.parse(html); if ('doraminhatv:' + d.id !== item.id) throw Error('O fornecedor retornou outro título.'); }
            if (item.fornecedor === 'reelshort') {
                indice = source.indiceReelShort(item.pagina, html);
                if (String(indice.livro) !== String(item.id).slice('reelshort:'.length)) throw Error('O fornecedor retornou outra mininovela.');
                if (indice.pagina !== item.pagina) {
                    estado.textContent = 'Carregando a lista de episódios…';
                    html = await source.buscarPagina(indice.pagina, fetcher);
                    if (String(source.dados(html).data?.book_id) !== String(indice.livro)) throw Error('O fornecedor retornou outra mininovela.');
                    const navegacao = source.indiceReelShort(indice.pagina, html);
                    indice = { ...navegacao, limite: indice.limite };
                } else indice.limite = item.reelLimite;
            }
            if (token !== geracao || !document.querySelector('[data-cat="short-drama"].ativo')) return;
            const eps = source.episodios(item.fornecedor, html, { limite: indice?.limite });
            estado.textContent = indice ? `${indice.total} episódios · os liberados podem ser assistidos aqui. Os demais exigem acesso no ReelShort.` : 'Escolha um episódio. Episódios bloqueados permanecem indisponíveis.';
            const lista = document.createElement('div'); lista.style.cssText = 'grid-column:1/-1;display:grid;grid-template-columns:repeat(auto-fit,minmax(105px,1fr));gap:12px';
            grid().append(lista);
            eps.forEach(ep => {
                const b = document.createElement('button'); b.type = 'button'; b.disabled = !ep.disponivel;
                b.style.cssText = 'padding:16px 10px;border-radius:12px;background:#222b39;color:#fff;border:1px solid #ffffff20;text-align:left;min-height:78px;opacity:' + (ep.disponivel ? '1' : '.5');
                const titulo = document.createElement('strong'); titulo.textContent = `Episódio ${ep.numero}`;
                const nota = document.createElement('small'); nota.style.cssText = 'display:block;margin-top:8px;color:#aebed0'; nota.textContent = ep.disponivel ? '▶ Assistir' : 'Bloqueado no fornecedor'; b.append(titulo,nota);
                b.onclick = async () => {
                    if (!ep.pagina) return tocar(item,ep);
                    b.disabled = true; nota.textContent = 'Carregando…';
                    try {
                        const pagina = await source.buscarPagina(ep.pagina, fetcher);
                        let confirmado;
                        if (item.fornecedor === 'doraminhatv') confirmado = source.episodioDora(pagina,ep.numero);
                        else {
                            const dados = source.dados(pagina);
                            if (String(dados.data?.book_id) !== String(indice.livro)) throw Error('Episódio de outra mininovela.');
                            confirmado = source.episodios('reelshort',pagina).find(e => e.numero === ep.numero);
                        }
                        if (!confirmado?.disponivel) throw Error('Este episódio não está liberado pelo fornecedor.');
                        if (token !== geracao || !document.querySelector('[data-cat="short-drama"].ativo')) return;
                        tocar(item,confirmado);
                    } catch (e) { if (token === geracao) estado.textContent = e.message; }
                    finally { b.disabled = false; nota.textContent = '▶ Assistir'; }
                }; lista.append(b);
            });
            if (indice) {
                const paginas = document.createElement('div'); paginas.style.cssText = 'grid-column:1/-1;display:flex;gap:12px;flex-wrap:wrap';
                for (const [titulo,pagina] of [['‹ Anteriores',indice.anterior],['Próximos ›',indice.proxima]]) {
                    if (!pagina) continue;
                    const b = document.createElement('button'); b.className = 'quiet'; b.textContent = titulo;
                    b.onclick = () => detalhes({ ...item, pagina, reelLimite: indice.limite }); paginas.append(b);
                } grid().append(paginas);
            }
            if (!eps.length) estado.textContent = 'Nenhum episódio público identificado agora.';
        } catch (e) { if (token === geracao) estado.textContent = e.message; }
    }
    async function tocar(item, ep) {
        playerRequest?.abort(); pararFrame(); const version = ++playerVersion;
        const req = new AbortController(); playerRequest = req; ultimoFoco = document.activeElement;
        filmeAtual = { id: item.id, titulo: item.titulo, episode: { season: 1, number: ep.numero } };
        players = []; fonteAtual = -1;
        document.body.style.overflow = 'hidden'; el('player').classList.add('ativo');
        el('titulo-player').textContent = `${item.titulo} · ${ep.titulo}`;
        const idioma = document.querySelector('.player-language'); if (idioma) idioma.textContent = 'Mininovela · áudio: ' + ep.audio;
        el('proxima').disabled = true; el('fontes').replaceChildren();
        ['menu-hd-btn', 'menu-dub-btn'].forEach(id => { if (el(id)) el(id).hidden = true; });
        mostrarStatus(source.fornecedores.find(f => f.id === item.fornecedor).nome);
        setLoading('Abrindo o episódio', 'Reproduzindo dentro do Conecta TV…');
        document.querySelector('.btn-voltar')?.focus();
        const ok = await StreamPlayback.start(item.id, version, req.signal, null, ep.url, true, { id:item.fornecedor, nome:source.fornecedores.find(f => f.id === item.fornecedor).nome, tipo:ep.tipo, audioInformado:ep.audio+' (informado pelo fornecedor)' });
        if (version !== playerVersion || req.signal.aborted) return;
        if (!ok) mostrarErro('O episódio não abriu agora.', 'O endereço público pode ter expirado. Volte e tente novamente.');
    }
    return { open };
})();
