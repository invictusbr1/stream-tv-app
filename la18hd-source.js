'use strict';
// O endereço HLS contém credencial temporária pública: resolve novamente a
// cada abertura, sem gravar a URL ou executar scripts da página do fornecedor.
const PAGE = 'https://la18hd.su/vivo/canales.php?stream=premiere1';
function extract(html) {
    const found = /var\s+playbackURL\s*=\s*["']([^"']+)["']/.exec(String(html));
    if (!found) throw Error('Transmissão indisponível');
    const url = new URL(found[1]);
    if (url.protocol !== 'https:' || url.username || url.password ||
        (url.port && url.port !== '443') || !/(^|\.)fubo18\.com$/i.test(url.hostname) ||
        url.pathname !== '/premiere1/mono.m3u8' || url.hash) throw Error('Endereço da transmissão inválido');
    return url.href;
}
async function resolve(get) {
    const url = extract(await get(PAGE, PAGE));
    const playlist = String(await get(url, PAGE));
    if (!playlist.trimStart().startsWith('#EXTM3U') || !/#EXTINF:/.test(playlist)) throw Error('A fonte não entregou uma transmissão HLS');
    return {url, referer: PAGE, type:'hls', live:true, audio:'fonte', source:'LA18HD · Premiere', fonteId:'la18hd-premiere1'};
}
module.exports = { PAGE, extract, resolve };
