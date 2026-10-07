// Fonte limpa "Full HD" para filmes e séries (VidSrc).
//
// A API pública entrega a lista de endereços do vídeo; quando vem protegida, o
// próprio serviço publica o decodificador (WebAssembly) e nós usamos aqui — em
// Node (servidor do aplicativo) ou no navegador (aplicativo do celular).
// Assim o filme toca dentro do player do Conecta TV, sem abrir a página do
// provedor e sem anúncio no caminho do usuário.
//
// Baseado no comportamento observado em 07/10/2026 (API `data.vidsrc.sh`).

(function (root) {
    'use strict';

    const API = 'https://data.vidsrc.sh/api.php';
    const HOSTS = [];

    function bytesDeBase64(texto) {
        if (typeof Buffer !== 'undefined' && Buffer.from) return new Uint8Array(Buffer.from(String(texto), 'base64'));
        const bin = atob(String(texto));
        const saida = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) saida[i] = bin.charCodeAt(i);
        return saida;
    }

    async function pegarJson(url) {
        const r = await fetch(url, { headers: { accept: 'application/json' }, credentials: 'omit' });
        if (!r.ok) throw new Error(`api ${r.status}`);
        return r.json();
    }

    async function pegarBytes(url) {
        const r = await fetch(url, { credentials: 'omit' });
        if (!r.ok) throw new Error(`wasm ${r.status}`);
        return new Uint8Array(await r.arrayBuffer());
    }

    // Decodifica a lista de endereços quando a API devolve protegida.
    async function decifrar(vs, cifrado) {
        const bytes = vs && vs.wasm_url ? await pegarBytes(vs.wasm_url) : bytesDeBase64(vs && vs.wasm);
        const modulo = await WebAssembly.compile(bytes);
        const instancia = await WebAssembly.instantiate(modulo, {});
        const ex = instancia.exports;
        const entrada = bytesDeBase64(cifrado);
        const ponteiro = ex.alloc(entrada.length);
        new Uint8Array(ex.memory.buffer, ponteiro, entrada.length).set(entrada);
        const tamanho = ex.decrypt(ponteiro, entrada.length);
        const texto = new TextDecoder().decode(new Uint8Array(ex.memory.buffer, ponteiro + 12, tamanho));
        return texto.split('\n').map(l => l.trim()).filter(Boolean);
    }

    function registrarHost(url) {
        try {
            const host = new URL(url).hostname;
            if (!HOSTS.includes(host)) HOSTS.push(host);
        } catch { /* endereço inválido */ }
    }

    // O endereço do vídeo exige um token gerado na hora, válido para o próprio
    // aparelho (é assim que o provedor autoriza a reprodução). O token é
    // aplicado no lugar de __TOKEN__ ou como ?token= no fim do endereço.
    async function aplicarToken(url) {
        let origem = '';
        try {
            origem = new URL(url).origin;
        } catch {
            return url;
        }
        let token = '';
        try {
            const r = await fetch(`${origem}/generate.php`, { credentials: 'omit' });
            if (r.ok) {
                const texto = (await r.text()).trim();
                if (texto.startsWith('{') || texto.startsWith('[')) {
                    try {
                        const j = JSON.parse(texto);
                        token = typeof j === 'string' ? j : String((j && (j.token || j.data || j.result)) || '');
                    } catch { token = ''; }
                } else token = texto;
            }
        } catch {
            token = '';
        }
        return montarComToken(url, token);
    }

    // Coloca o token no endereço: troca o marcador __TOKEN__ ou acrescenta
    // ?token= no fim. Sem token, devolve o endereço original.
    function montarComToken(url, token) {
        if (!token) return url;
        if (url.includes('__TOKEN__')) return url.split('__TOKEN__').join(token);
        return `${url}${url.includes('?') ? '&' : '?'}token=${token}`;
    }

    async function resolver(tipo, tmdbId, temporada, episodio) {
        const id = String(tmdbId || '').trim();
        if (!/^\d{1,10}$/.test(id)) return null;
        const ehSerie = tipo === 'tv' || tipo === 'series';
        const parametros = new URLSearchParams({ type: ehSerie ? 'tv' : 'movie', tmdb: id, stream_urls: '' });
        if (ehSerie && temporada && episodio) {
            parametros.set('season', String(temporada));
            parametros.set('episode', String(episodio));
        }
        let dados;
        try {
            dados = await pegarJson(`${API}?${parametros.toString()}`);
        } catch {
            return null;
        }
        if (!dados || !dados.data) return null;
        let lista = dados.data.stream_urls;
        try {
            if (typeof lista === 'string' && dados.vs) lista = await decifrar(dados.vs, lista);
        } catch {
            return null;
        }
        if (!Array.isArray(lista) || !lista.length) return null;
        const url = String(lista[0] || '').trim();
        if (!/^https:\/\//i.test(url)) return null;
        const comToken = await aplicarToken(url);
        registrarHost(comToken);
        return {
            url: comToken,
            fonte: 'VidSrc',
            qualidade: 'Full HD',
            audio: 'original',
            titulo: String(dados.data.title || ''),
            arquivo: String(dados.data.file_name || '')
        };
    }

    const api = { resolver, montarComToken, hosts: () => [...HOSTS] };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.VidSrcSource = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
