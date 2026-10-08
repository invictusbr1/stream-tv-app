const test = require('node:test');
const assert = require('node:assert/strict');
const { parecePortugues, audioTocaNoNavegador, extrairDoZip, chaveDoTitulo } = require('./verificar-midia');

test('reconhece português numa transcrição (e inglês como outro idioma)', () => {
    assert.equal(parecePortugues('Você não pode fazer isso agora, está tudo bem?'), true);
    assert.equal(parecePortugues('You could come and watch, you get hit every time'), false);
    assert.equal(parecePortugues(''), false);
});

// Medido em 08/10/2026: o arquivo do FenixFlix (MKV com som EAC3) toca o vídeo
// e sai mudo no navegador — a verificação precisa avisar isso antes de indicar
// a fonte.
test('avisa quando o áudio do arquivo não toca no navegador', () => {
    assert.equal(audioTocaNoNavegador('matroska,webm', 'eac3'), false);
    assert.equal(audioTocaNoNavegador('matroska,webm', 'opus'), true);
    assert.equal(audioTocaNoNavegador('mov,mp4,m4a,3gp,3g2,mj2', 'aac'), true);
    assert.equal(audioTocaNoNavegador('mov,mp4,m4a,3gp,3g2,mj2', 'eac3'), true);
});

test('a chave do título é a mesma usada pelo motor do aplicativo', () => {
    assert.equal(chaveDoTitulo('movie', { id: '921' }), 'movie:921');
    assert.equal(chaveDoTitulo('tv', { id: '1399', temporada: '1', episodio: '14' }), 'tv:1399:1:14');
    assert.equal(chaveDoTitulo('tv', { id: '1399' }), 'tv:1399:1:1');
});

// Monta um .zip simples (sem compressão) para conferir a extração do pacote
// de ferramentas (ffmpeg/ffprobe).
function zipSimples(nome, conteudo) {
    const nomeBytes = Buffer.from(nome, 'utf8');
    const dados = Buffer.from(conteudo, 'utf8');
    const cabecalho = Buffer.alloc(30);
    cabecalho.writeUInt32LE(0x04034b50, 0);
    cabecalho.writeUInt16LE(20, 4);
    cabecalho.writeUInt32LE(dados.length, 18);
    cabecalho.writeUInt32LE(dados.length, 22);
    cabecalho.writeUInt16LE(nomeBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(dados.length, 20);
    central.writeUInt32LE(dados.length, 24);
    central.writeUInt16LE(nomeBytes.length, 28);
    const fim = Buffer.alloc(22);
    fim.writeUInt32LE(0x06054b50, 0);
    fim.writeUInt16LE(1, 8);
    fim.writeUInt16LE(1, 10);
    fim.writeUInt32LE(46 + nomeBytes.length, 12);
    fim.writeUInt32LE(30 + nomeBytes.length + dados.length, 16);
    return Buffer.concat([cabecalho, nomeBytes, dados, central, nomeBytes, fim]);
}

test('extrai o ffmpeg de dentro do pacote oficial', () => {
    const pacote = zipSimples('ffmpeg-7.0-essentials_build/bin/ffmpeg.exe', 'conteúdo do programa');
    const achados = extrairDoZip(pacote, ['/ffmpeg.exe', '/ffprobe.exe']);
    assert.equal(String(achados['/ffmpeg.exe']), 'conteúdo do programa');
    assert.equal(achados['/ffprobe.exe'], undefined);
    assert.equal(extrairDoZip(Buffer.from('não é zip'), ['/ffmpeg.exe']), null);
});
