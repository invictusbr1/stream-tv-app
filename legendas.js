// Legendas próprias do Conecta TV: usa os arquivos da pasta "Legendas" e,
// quando configurado, a busca online. Não depende do player da fonte.
(function () {
    'use strict';

    function srtParaVtt(texto) {
        const linhas = String(texto || '').replace(/\r/g, '').split('\n');
        const saida = ['WEBVTT', ''];
        for (const linha of linhas) {
            if (/^\s*\d+\s*$/.test(linha)) continue;
            saida.push(linha.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2'));
        }
        return saida.join('\n');
    }

    async function buscar(id, titulo) {
        try {
            const resposta = await fetch(`/api/legendas?id=${encodeURIComponent(id || '')}&filme=${encodeURIComponent(titulo || '')}`, { cache: 'no-store' });
            if (!resposta.ok) return [];
            const dados = await resposta.json();
            return Array.isArray(dados.encontradas) ? dados.encontradas : [];
        } catch { return []; }
    }

    async function anexar(video, filme) {
        if (!video || !filme) return 0;
        const arquivos = await buscar(filme.id, filme.titulo);
        let anexadas = 0;
        for (const nome of arquivos.slice(0, 3)) {
            try {
                const bruto = await fetch('/api/legenda?arquivo=' + encodeURIComponent(nome), { cache: 'no-store' }).then(r => (r.ok ? r.text() : ''));
                if (!bruto.trim()) continue;
                const conteudo = /^WEBVTT/.test(bruto.trim()) ? bruto : srtParaVtt(bruto);
                const trilha = document.createElement('track');
                trilha.kind = 'subtitles';
                trilha.label = nome.replace(/\.(srt|vtt)$/i, '').slice(0, 42);
                trilha.srclang = 'pt';
                trilha.src = URL.createObjectURL(new Blob([conteudo], { type: 'text/vtt' }));
                trilha.default = false;
                video.append(trilha);
                anexadas++;
            } catch { /* arquivo ilegível: tenta o próximo */ }
        }
        return anexadas;
    }

    window.StreamLegendas = { anexar, buscar, srtParaVtt };
})();
