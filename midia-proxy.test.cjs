const test = require('node:test');
const assert = require('node:assert/strict');
const {
    reescreverPlaylist,
    hostPermitido,
    refererPadrao,
    urlViaProxy,
    textoDeBase64url,
    base64url
} = require('./midia-proxy');

const MASTER = `#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="Portuguese",LANGUAGE="por",URI="/playlist/1?type=audio&rendition=por"
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="English",LANGUAGE="eng",URI="/playlist/1?type=subtitle&rendition=eng"
#EXT-X-KEY:METHOD=AES-128,URI="/storage/enc.key",IV=0x43A6D967
#EXT-X-STREAM-INF:BANDWIDTH=4500000,RESOLUTION=1920x1080,AUDIO="audio",SUBTITLES="subs"
/playlist/1?type=video&rendition=1080p
`;

test('o encaminhamento passa lista, chave e pedaços de vídeo pelo aplicativo', () => {
    const saida = reescreverPlaylist(MASTER, 'https://vixsrc.to/playlist/1?token=abc&h=1', 'https://vixsrc.to/');
    assert.match(saida, /#EXT-X-MEDIA:TYPE=AUDIO/);
    assert.equal(saida.includes('URI="/playlist/1'), false);
    assert.match(saida, /URI="\/api\/hls\?u=/);
    assert.match(saida, /^\/api\/hls\?u=/m);
    const chave = saida.match(/#EXT-X-KEY:[^\n]*/)[0];
    assert.match(chave, /URI="\/api\/hls\?u=/);
    assert.equal(textoDeBase64url(chave.match(/u=([^&"]+)/)[1]), 'https://vixsrc.to/storage/enc.key');
});

test('cada pedaço guarda o endereço que o indicou, para o provedor liberar', () => {
    const pai = 'https://vixsrc.to/playlist/1?type=video&rendition=1080p&token=abc';
    const saida = reescreverPlaylist(MASTER, pai, 'https://vixsrc.to/');
    const linha = saida.match(/^\/api\/hls\?[^\s]+$/m)[0];
    const [u, r, p] = linha.replace('/api/hls?', '').split('&').map(parte => parte.slice(2));
    assert.equal(textoDeBase64url(u), 'https://vixsrc.to/playlist/1?type=video&rendition=1080p');
    assert.equal(textoDeBase64url(r), 'https://vixsrc.to/');
    assert.equal(textoDeBase64url(p), pai);
});

test('somente os endereços conhecidos podem ser encaminhados', () => {
    assert.equal(hostPermitido('vixsrc.to'), true);
    assert.equal(hostPermitido('sc-u16-01.mistyreef77.boats'), true);
    assert.equal(hostPermitido('vid7102402.hclod.qzz.io'), true);
    assert.equal(hostPermitido('exemplo.com.br'), false);
    assert.equal(hostPermitido('vixsrc.to.malicioso.net'), false);
    assert.equal(refererPadrao('vixsrc.to'), 'https://vixsrc.to/');
    assert.equal(refererPadrao('sc-u16-01.mistyreef77.boats'), 'https://vixsrc.to/');
    assert.equal(refererPadrao('vid1.hclod.qzz.io'), 'https://watchplay.shop/');
    assert.equal(refererPadrao('desconhecido.net'), '');
});

test('endereços de outros sites continuam intactos na lista', () => {
    const lista = '#EXTM3U\nhttps://outro-site.com/video.m3u8\n';
    assert.equal(reescreverPlaylist(lista, 'https://vixsrc.to/playlist/1'), lista);
});

test('o endereço entregue ao player é sempre do próprio aplicativo', () => {
    const url = urlViaProxy('https://vixsrc.to/playlist/1?token=abc', 'https://vixsrc.to/');
    assert.match(url, /^\/api\/hls\?u=/);
    assert.equal(textoDeBase64url(url.split('u=')[1].split('&')[0]), 'https://vixsrc.to/playlist/1?token=abc');
    assert.equal(textoDeBase64url(url.split('&r=')[1]), 'https://vixsrc.to/');
    assert.equal(base64url('abc'), 'YWJj');
});
