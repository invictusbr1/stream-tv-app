// Read only the public player configuration; never execute provider JavaScript.
function parseWatchPlay(html) {
    const quoted = '"(?:[^"\\\\]|\\\\.)*"';
    const audio = html.match(new RegExp('window\\.MyPlayerAudio\\s*=\\s*(' + quoted + ')'));
    const source = html.match(new RegExp('\\burl\\s*:\\s*(' + quoted + ')'));
    if (!audio || JSON.parse(audio[1]) !== 'Dublado' || !source) throw new Error('Fonte dublada indisponível');
    const url = new URL(JSON.parse(source[1]));
    // The observed provider publishes its signed HLS streams on this CDN.
    if (url.protocol !== 'https:' || !/^[a-z0-9-]+\.hclod\.qzz\.io$/i.test(url.hostname) || url.port || url.username || url.password || !url.pathname.endsWith('.m3u8')) throw new Error('Endereço de mídia não reconhecido');
    return { url: url.href, audio: 'pt-BR', source: 'WatchPlay', type: 'hls' };
}
module.exports = { parseWatchPlay };
