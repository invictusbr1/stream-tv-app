(function (root) {
    'use strict';
    // Only presentation changes: the original stream and quality selection stay intact.
    function detect(data, width, height) {
        let left = width, top = height, right = -1, bottom = -1, lit = 0;
        for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 4;
            if (Math.max(data[i], data[i + 1], data[i + 2]) > 32) {
                lit++; left = Math.min(left, x); right = Math.max(right, x);
                top = Math.min(top, y); bottom = Math.max(bottom, y);
            }
        }
        if (lit < width * height * .2 || right < left) return null;
        // Keep a small margin around all detected content, including burned-in text.
        const box = { l: Math.max(0, (left - 2) / width), t: Math.max(0, (top - 2) / height),
            r: Math.max(0, (width - right - 3) / width), b: Math.max(0, (height - bottom - 3) / height) };
        if (Math.max(...Object.values(box)) > .24 || box.l + box.r > .32 || box.t + box.b > .32) return null;
        // Asymmetric framing may be part of the scene, or contain captions.
        if (Math.abs(box.l - box.r) > .035 || Math.abs(box.t - box.b) > .035) return null;
        return box;
    }
    function geometry(width, height, vw, vh, box) {
        const original = Math.min(width / vw, height / vh);
        const activeW = vw * (1 - box.l - box.r), activeH = vh * (1 - box.t - box.b);
        const scale = Math.min(width / activeW, height / activeH) / original;
        return { scale: Math.min(1.5, Math.max(1, scale)),
            x: (box.r - box.l) * vw * original / 2,
            y: (box.b - box.t) * vh * original / 2 };
    }
    function createConfidence() {
        let samples = [], last = -Infinity;
        return {
            reset() { samples = []; last = -Infinity; },
            add(box, time) {
                if (!box) { samples = []; last = time; return null; }
                if (time - last < 1) return null;
                last = time;
                if (samples.length && Object.keys(box).some(k => Math.abs(box[k] - samples[0].box[k]) > .018)) samples = [];
                samples.push({ box, time }); samples = samples.slice(-8);
                if (samples.length < 7 || time - samples[0].time < 12) return null;
                // Union of visible content: never choose the tightest/darkest frame.
                return Object.fromEntries(Object.keys(box).map(k => [k, Math.min(...samples.map(s => s.box[k]))]));
            }
        };
    }
    const api = { detect, geometry, createConfidence };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (!root.document) return;
    let video = null, canvas = null, timer = null, box = null,
        mode = /StreamTVAndroidTV|SMART-TV|Tizen|Web0S/i.test(root.navigator?.userAgent || '') ? 'original' : 'auto', blocked = false;
    const confidence = createConfidence();
    const get = id => root.document.getElementById(id);
    let lastScale = 1;
    function paintButton() {
        const button = get('framing-toggle'); if (!button) return;
        const enlarged = mode === 'fill' || lastScale > 1.025;
        button.hidden = !video || /StreamTVAndroidTV|SMART-TV|Tizen|Web0S/i.test(root.navigator?.userAgent || '');
        button.setAttribute('aria-pressed', String(enlarged));
        const label = enlarged ? 'Diminuir imagem' : 'Ampliar imagem';
        button.setAttribute('aria-label', label); button.title = label;
        const path = enlarged ? 'M20 14h-6v6M14 14l7 7M10 4v6H4M10 10 3 3' : 'M14 4h6v6M20 4l-7 7M4 14v6h6M4 20l7-7';
        button.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="'+path+'"/></svg>';
    }
    function status() { paintButton(); }
    function original() {
        if (!video) return;
        video.style.objectFit = 'contain'; video.style.transform = ''; lastScale = 1;
    }
    function captions() { return Array.from(video?.textTracks || []).some(track => track.mode === 'showing'); }
    function paint() {
        if (!video) return;
        original();
        if (mode === 'fill') { video.style.objectFit = 'cover'; video.style.transform = 'scale(1.12)'; status('Preenche a tela; pode cortar parte da imagem e das legendas.'); return; }
        if (mode === 'original') { status('Imagem completa, com o enquadramento original.'); return; }
        if (captions()) { box = null; status('Imagem completa para preservar as legendas.'); return; }
        if (blocked) { status('Não foi possível conferir as bordas desta fonte. Imagem original preservada.'); return; }
        if (!box) { status('Conferindo as bordas. A imagem original é mantida durante a análise.'); return; }
        const rect = video.getBoundingClientRect();
        // Original() removed any previous scale before measuring the layout box.
        const g = geometry(rect.width, rect.height, video.videoWidth, video.videoHeight, box);
        lastScale = g.scale;
        if (g.scale > 1.025) video.style.transform = `translate(${g.x * g.scale}px,${g.y * g.scale}px) scale(${g.scale})`;
        status(g.scale > 1.025 ? 'Bordas pretas reduzidas. A proporção da imagem foi preservada.' : 'O vídeo já está ajustado à área disponível.');
    }
    function reset() { box = null; confidence.reset(); original(); paint(); }
    function sample() {
        if (!video || mode !== 'auto' || blocked || video.paused || video.seeking || video.readyState < 2 || !video.videoWidth || root.document.hidden) return;
        if (captions()) { reset(); return; }
        try {
            canvas ||= root.document.createElement('canvas');
            canvas.width = 256; canvas.height = Math.max(32, Math.min(256, Math.round(256 * video.videoHeight / video.videoWidth)));
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const candidate = detect(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
            // Return immediately to the full picture if the aspect changes or
            // content (including text) appears in a previously cropped border.
            if (!candidate || (box && Object.keys(box).some(k => candidate[k] < box[k] - .01))) reset();
            const accepted = confidence.add(candidate, video.currentTime);
            if (accepted) { box = accepted; paint(); }
        } catch { blocked = true; box = null; original(); paint(); }
    }
    function attach(next) {
        clearInterval(timer); timer = null;
        if (video) {
            original(); video.removeEventListener('seeking', reset);
            video.removeEventListener('loadedmetadata', reset); video.textTracks?.removeEventListener?.('change', reset);
        }
        video = next; canvas = null; box = null; blocked = false; confidence.reset();
        if (video) mode = /StreamTVAndroidTV|SMART-TV|Tizen|Web0S/i.test(root.navigator?.userAgent || '') ? 'original' : 'auto';
        paintButton();
        if (!video) { status('Disponível no player de vídeo do aplicativo.'); return; }
        video.parentElement.classList.add('framing-area');
        video.addEventListener('seeking', reset); video.addEventListener('loadedmetadata', reset);
        video.textTracks?.addEventListener?.('change', reset);
        timer = setInterval(sample, 2000); paint();
    }
    function setMode(value) {
        if (!['auto', 'original', 'fill'].includes(value)) return;
        mode = value; reset();
        paintButton();
    }
    root.StreamFraming = { attach, setMode, toggle() { setMode(mode === 'fill' || lastScale > 1.025 ? 'original' : 'fill'); } };
    root.addEventListener('resize', paint);
    
})(typeof window !== 'undefined' ? window : globalThis);
