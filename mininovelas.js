'use strict';
window.StreamMininovelas = (() => {
    let geracao = 0, fornecedor = 'dramabox';
    const source = window.StreamMininovelasSource;
    const fetcher = (url) => fetch(url, { signal: timeoutSignal(20000) });
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
            const items = source.catalogo(f.id, html);
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
        el('resultados-titulo').textContent = item.titulo; grid().append(voltar, estado);
        try {
            const html = await source.buscarPagina(item.pagina, fetcher);
            if (token !== geracao || !document.querySelector('[data-cat="short-drama"].ativo')) return;
            const eps = source.episodios(item.fornecedor, html);
            estado.textContent = ['reelshort','netshort'].includes(item.fornecedor) ? 'Prévia pública. Catálogo completo de episódios ainda em análise.' : 'Escolha um episódio. Episódios bloqueados permanecem indisponíveis.';
            eps.forEach(ep => {
                const b = document.createElement('button'); b.className = 'quiet'; b.type = 'button'; b.disabled = !ep.disponivel;
                b.textContent = ep.titulo + (ep.disponivel ? ' · áudio: ' + ep.audio : ' · indisponível');
                b.onclick = () => tocar(item, ep); grid().append(b);
            });
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
