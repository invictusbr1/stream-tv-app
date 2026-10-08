const test = require('node:test');
const assert = require('node:assert/strict');
const { extrairDoZip } = require('./legendas-online');

// Monta um .zip simples (sem compressão) com um arquivo de legenda dentro —
// é o mesmo formato que o provedor entrega.
function zipSimples(nome, conteudo) {
    const nomeBytes = Buffer.from(nome, 'utf8');
    const dados = Buffer.from(conteudo, 'utf8');
    const cabecalho = Buffer.alloc(30);
    cabecalho.writeUInt32LE(0x04034b50, 0);
    cabecalho.writeUInt16LE(20, 4);
    cabecalho.writeUInt16LE(0, 6);
    cabecalho.writeUInt16LE(0, 8); // sem compressão
    cabecalho.writeUInt32LE(dados.length, 18);
    cabecalho.writeUInt32LE(dados.length, 22);
    cabecalho.writeUInt16LE(nomeBytes.length, 26);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10); // sem compressão
    central.writeUInt32LE(dados.length, 20);
    central.writeUInt32LE(dados.length, 24);
    central.writeUInt16LE(nomeBytes.length, 28);
    central.writeUInt32LE(0, 42);

    const fim = Buffer.alloc(22);
    fim.writeUInt32LE(0x06054b50, 0);
    fim.writeUInt16LE(1, 8);
    fim.writeUInt16LE(1, 10);
    const tamanhoCentral = 46 + nomeBytes.length;
    fim.writeUInt32LE(tamanhoCentral, 12);
    const inicioCentral = 30 + nomeBytes.length + dados.length;
    fim.writeUInt32LE(inicioCentral, 16);

    return Buffer.concat([cabecalho, nomeBytes, dados, central, nomeBytes, fim]);
}

test('extrai a legenda de dentro do arquivo .zip do provedor', () => {
    const legenda = '1\n00:00:01,000 --> 00:00:02,000\nOlá, mundo!\n';
    const achado = extrairDoZip(zipSimples('filme-brasil.srt', legenda));
    assert.equal(achado.nome, 'filme-brasil.srt');
    assert.equal(achado.texto, legenda);
});

test('zip sem legenda devolve nada (o motor segue sem travar)', () => {
    assert.equal(extrairDoZip(zipSimples('leia-me.txt', 'nada aqui')), null);
    assert.equal(extrairDoZip(Buffer.from('não é zip')), null);
    assert.equal(extrairDoZip(null), null);
});
