(function (root) {
    'use strict';
    const fornecedores = [
        { id: 'reelshort', nome: 'ReelShort', site: 'https://www.reelshort.com/pt', conector: true },
        { id: 'dramabox', nome: 'DramaBox', site: 'https://www.dramaboxdb.com/pt', conector: true },
        { id: 'dramawave', nome: 'DramaWave', site: 'https://www.mydramawave.com/', conector: false },
        { id: 'sua-novela', nome: 'Sua Novela', site: null, conector: false, pendente: 'Aguardando identificação do aplicativo' },
        { id: 'netshort', nome: 'NetShort', site: 'https://netshort.com/pt', conector: false, pendente: 'Catálogo localizado; acesso gratuito ao episódio ainda não confirmado' },
        { id: 'shortmax', nome: 'ShortMax', site: 'https://www.shorttv.live/pt', conector: false },
        { id: 'freereels', nome: 'FreeReels', site: 'https://free-reels.com/', conector: false }
    ];
    function paginaPermitida(valor) {
        try {
            const u = new URL(valor);
            if (u.protocol !== 'https:' || u.port || u.username || u.password || u.search || u.hash) return false;
            if (u.hostname === 'www.reelshort.com') return /^\/(?:pt\/?|(?:pt\/)?(?:episodes\/(?:[a-z0-9-]|%[a-fA-F0-9]{2})+|full-episodes\/(?:[a-z0-9-]|%[a-fA-F0-9]{2})+(?:\/[1-9][0-9]?)?))$/.test(u.pathname);
            if (u.hostname === 'www.dramaboxdb.com') return /^\/(?:pt\/?|(?:pt\/)?movie\/[0-9]{1,20}\/[a-z0-9-]+)$/.test(u.pathname);
            if (u.hostname === 'netshort.com') return /^\/(?:pt\/?|(?:pt\/)?episode\/[a-z0-9-]+)$/.test(u.pathname);
        } catch {}
        return false;
    }
    function dados(html) {
        const m = String(html).match(/<script\b[^>]*\bid=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
        if (!m) throw Error('O fornecedor mudou o formato do catálogo.');
        return JSON.parse(m[1]).props.pageProps;
    }
    function dadosNetShort(html) {
        let texto = '';
        for (const m of String(html).matchAll(/self\.__next_f\.push\((.*?)\)<\/script>/gs)) {
            try { const a = JSON.parse(m[1]); if (a[0] === 1 && typeof a[1] === 'string') texto += a[1]; } catch {}
        }
        const objetos = [];
        for (const linha of texto.split('\n')) {
            try { objetos.push(JSON.parse(linha.slice(linha.indexOf(':') + 1))); } catch {}
        }
        if (!objetos.length) throw Error('O fornecedor mudou o formato do catálogo.');
        return objetos;
    }
    function catalogo(id, html) {
        const p = id === 'netshort' ? dadosNetShort(html) : dados(html), vistos = new Set(), items = [];
        const origem = id === 'reelshort' ? 'https://www.reelshort.com' : id === 'netshort' ? 'https://netshort.com' : 'https://www.dramaboxdb.com';
        const links = [...String(html).matchAll(/\bhref="([^"<>]+)"/g)].map(m => {
            try { const u = new URL(m[1].replace(/&amp;/g, '&'), origem); u.search = ''; u.hash = ''; return u.href; } catch { return ''; }
        }).filter(paginaPermitida);
        function visitar(x) {
            if (!x || typeof x !== 'object') return;
            const codigo = id === 'reelshort' ? x.book_id : id === 'netshort' ? x.shortPlayId : x.bookId;
            const titulo = id === 'reelshort' ? x.book_title : id === 'netshort' ? x.shortPlayName : x.bookName;
            if (codigo && titulo && !vistos.has(String(codigo))) {
                const pagina = links.find(link => id === 'dramabox' ? new URL(link).pathname.includes(`/movie/${codigo}/`) : id === 'netshort' ? new URL(link).pathname.endsWith(`-${codigo}`) : new URL(link).pathname.includes(`-${codigo}-`));
                if (pagina && paginaPermitida(pagina)) {
                    vistos.add(String(codigo));
                    items.push({ id: `${id}:${codigo}`, fornecedor: id, titulo, capa: x.book_pic || x.cover || x.shortPlayCover || '', sinopse: x.introduction || x.special_desc || x.shotIntroduce || '', pagina });
                }
            }
            Object.values(x).forEach(v => { if (v && typeof v === 'object') visitar(v); });
        }
        visitar(p);
        return items;
    }
    function midiaPermitida(id, valor) {
        try {
            const u = new URL(valor);
            if (u.protocol !== 'https:' || u.username || u.password || u.port) return false;
            if (id === 'netshort') return u.hostname === 'cfcdn.netshort.com' && u.searchParams.get('mime_type') === 'video_mp4';
            const dominio = id === 'reelshort' ? 'crazymaplestudios.com' : 'dramaboxdb.com';
            return u.hostname.endsWith('.' + dominio) && /\.(?:mp4|m3u8)$/i.test(u.pathname);
        } catch { return false; }
    }
    function episodios(id, html, contexto = {}) {
        if (id === 'netshort') {
            let info = null, livro = null;
            function visitar(x) {
                if (!x || typeof x !== 'object') return;
                if (x.initialCurrentEpisodeInfo) info = x.initialCurrentEpisodeInfo;
                if (Array.isArray(x.videoEpisodeInfos)) livro = x;
                Object.values(x).forEach(v => { if (v && typeof v === 'object') visitar(v); });
            }
            visitar(dadosNetShort(html));
            if (!info || !livro || livro.isDelisted !== false) return [];
            const permitido = info.isLock === false && (info.episodeGoldCoinPrice === 0 || info.episodeGoldCoinPrice === '0') && livro.videoEpisodeInfos.some(e => e.episodeId === info.episodeId && e.isLock === false);
            return [{numero:Number(info.episodeNo),titulo:`Episódio ${info.episodeNo}`, disponivel:permitido && midiaPermitida(id, info.playVoucher),url:permitido && midiaPermitida(id, info.playVoucher) ? info.playVoucher:null, tipo:'file',audio:livro.language || 'Não confirmado'}];
        }
        const p = dados(html);
        if (id === 'dramabox') return (p.chapterList || []).map(c => {
            const liberado = c.unlock === true && (c.chapterPrice === 0 || c.chapterPrice === '0') && Number.isInteger(Number(c.index)) && Number(c.index) >= 0;
            const url = liberado ? (c.mp4 || c.m3u8Url) : null;
            return { numero: Number(c.index) + 1, titulo: `Episódio ${Number(c.index) + 1}`, disponivel: liberado && midiaPermitida(id, url), url: liberado && midiaPermitida(id, url) ? url : null, audio: p.bookInfo?.language || 'Não confirmado' };
        });
        if (id === 'reelshort') {
            const d = p.data || {};
            if (Array.isArray(d.chapter_list)) {
                const links = [...String(html).matchAll(/\bhref="([^"<>]+)"/g)].map(m => { try { return new URL(m[1].replace(/&amp;/g, '&'), 'https://www.reelshort.com').href; } catch { return ''; } }).filter(paginaPermitida);
                return d.chapter_list.filter(c => Number(c.serial_number) > 0).map(c => {
                    const numero = Number(c.serial_number), pagina = links.find(u => new URL(u).pathname.endsWith('-' + d.book_id + '-' + c.chapter_id));
                    return { numero, titulo: `Episódio ${numero}`, disponivel: p.web_prohibit === 0 && numero < Number(contexto.limite) && Boolean(pagina), pagina, url: null, audio: d.lang || 'Não confirmado', capa: c.video_pic || '', sinopse: c.desc || '' };
                }).sort((a,b) => a.numero-b.numero);
            }
            const numero = Number(d.serial_number);
            const livre = p.web_prohibit === 0 && numero > 0 && Number(d.paid_start) > numero;
            return [{ numero, titulo: `Episódio ${numero}`, disponivel: livre && midiaPermitida(id, d.video_url), url: livre && midiaPermitida(id, d.video_url) ? d.video_url : null, audio: d.lang || 'Não confirmado' }];
        }
        return [];
    }
    function indiceReelShort(pagina, html) {
        const p = dados(html), d = p.data || {}, u = new URL(pagina);
        if (!paginaPermitida(pagina) || u.hostname !== 'www.reelshort.com') throw Error('Índice inválido.');
        if (Array.isArray(d.chapter_list)) return { pagina, livro: d.book_id, total: Number(d.chapter_count), limite: null, proxima: paginaPermitida(p.nextPageLink) ? p.nextPageLink : null, anterior: paginaPermitida(p.prevPageLink) ? p.prevPageLink : null };
        const final = '-' + d.chapter_id;
        if (!u.pathname.endsWith(final) || !u.pathname.includes('-' + d.book_id + '-')) throw Error('Índice não identificado.');
        const slug = u.pathname.split('/').pop().slice(0, -final.length).replace(/^(?:episode-[0-9]+|trailer)-/, '');
        const destino = new URL('/pt/full-episodes/' + slug, u.origin).href;
        if (!paginaPermitida(destino)) throw Error('Índice inválido.');
        return { pagina: destino, livro: d.book_id, limite: Number(d.paid_start), total: Number(d.chapter_count) };
    }
    async function buscarPagina(url, fetcher) {
        if (!paginaPermitida(url)) throw Error('Página não permitida.');
        const r = await fetcher('/api/mininovelas/pagina?url=' + encodeURIComponent(url));
        if (!r.ok) throw Error('O fornecedor não respondeu agora.');
        return r.text();
    }
    const api = { fornecedores, paginaPermitida, midiaPermitida, dados, dadosNetShort, catalogo, episodios, indiceReelShort, buscarPagina };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.StreamMininovelasSource = api;
})(typeof window !== 'undefined' ? window : globalThis);
