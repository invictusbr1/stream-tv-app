const test = require('node:test');
const assert = require('node:assert/strict');
const motor = require('./fontes-motor');

// Troca as fontes reais por fontes de teste, na mesma ordem de papel que o
// motor usa (dublado antes de alta definição).
function comFontesDeTeste(lista) {
    motor.reiniciarParaTeste();
    motor.FONTES.length = 0;
    lista.forEach(item => motor.FONTES.push(item));
}

test('o motor tenta o dublado antes da alta definição', async () => {
    const tentativas = [];
    comFontesDeTeste([
        { id: 'dub1', nome: 'Dublado 1', papel: 'dublado', peso: 100, resolver: async () => { tentativas.push('dub1'); return null; } },
        { id: 'dub2', nome: 'Dublado 2', papel: 'dublado', peso: 90, resolver: async () => { tentativas.push('dub2'); return { url: 'https://exemplo/pl/abc/master.m3u8', audio: 'pt-BR', fonte: 'Dublado 2' }; } },
        { id: 'hd1', nome: 'HD 1', papel: 'hd', peso: 80, resolver: async () => { tentativas.push('hd1'); return { url: 'https://exemplo/hd.m3u8', audio: 'original' }; } }
    ]);
    const escolhido = await motor.escolher('dublado', { tipo: 'movie', tmdbId: '111' });
    assert.equal(escolhido.fonte, 'Dublado 2');
    assert.deepEqual(tentativas, ['dub1', 'dub2'], 'quem não tem o título não é insistido; vai direto para a próxima');
});

test('erro de rede ganha uma segunda tentativa antes de desistir da fonte', async () => {
    const tentativas = [];
    comFontesDeTeste([
        { id: 'instavel', nome: 'Instável', papel: 'dublado', peso: 100, resolver: async () => { tentativas.push('instavel'); if (tentativas.length === 1) throw Error('caiu a conexão'); return { url: 'https://exemplo/pl/ok/master.m3u8', audio: 'pt-BR', fonte: 'Instável' }; } }
    ]);
    const escolhido = await motor.escolher('dublado', { tipo: 'movie', tmdbId: '5150' });
    assert.equal(escolhido.fonte, 'Instável');
    assert.deepEqual(tentativas, ['instavel', 'instavel'], 'a falha passageira foi repetida e deu certo');
});

test('a fonte que não tem o título não é mais tentada naquele título', async () => {
    let semChamadas = 0, comChamadas = 0;
    comFontesDeTeste([
        { id: 'sem', nome: 'Sem o título', papel: 'dublado', peso: 100, resolver: async () => { semChamadas++; return null; } },
        { id: 'com', nome: 'Com o título', papel: 'dublado', peso: 10, resolver: async () => { comChamadas++; return { url: 'https://exemplo/pl/ok/master.m3u8', audio: 'pt-BR', fonte: 'Com o título' }; } }
    ]);
    await motor.escolher('dublado', { tipo: 'movie', tmdbId: '6161' });
    assert.equal(semChamadas, 1);
    assert.equal(comChamadas, 1);
    motor.esquecerAcertos();
    const deNovo = await motor.escolher('dublado', { tipo: 'movie', tmdbId: '6161' });
    assert.equal(deNovo.fonte, 'Com o título');
    assert.equal(semChamadas, 1, 'a fonte que não tem este título não foi consultada de novo');
    assert.equal(comChamadas, 2);
});

test('a memória de "não tem este título" vale só para aquele título', async () => {
    comFontesDeTeste([
        { id: 'primeira', nome: 'Primeira', papel: 'dublado', peso: 100, resolver: async alvo => alvo.tmdbId === '1' ? null : ({ url: 'https://exemplo/pl/a/master.m3u8', audio: 'pt-BR', fonte: 'Primeira' }) },
        { id: 'segunda', nome: 'Segunda', papel: 'dublado', peso: 10, resolver: async () => ({ url: 'https://exemplo/pl/b/master.m3u8', audio: 'pt-BR', fonte: 'Segunda' }) }
    ]);
    const um = await motor.escolher('dublado', { tipo: 'movie', tmdbId: '1' });
    const dois = await motor.escolher('dublado', { tipo: 'movie', tmdbId: '2' });
    assert.equal(um.fonte, 'Segunda');
    assert.equal(dois.fonte, 'Primeira', 'no outro título a fonte principal volta a ser tentada');
});

test('quando o dublado não existe, o motor entrega a alta definição', async () => {
    comFontesDeTeste([
        { id: 'dub1', nome: 'Dublado', papel: 'dublado', peso: 100, resolver: async () => null },
        { id: 'hd9', nome: 'HD', papel: 'hd', peso: 80, resolver: async () => ({ url: 'https://exemplo/pl/xyz/master.m3u8', audio: 'original', fonte: 'HD', resolucao: 'Full HD' }) }
    ]);
    const escolhido = await motor.escolher('hd', { tipo: 'movie', tmdbId: '222' });
    assert.equal(escolhido.fonte, 'HD');
    assert.equal(escolhido.resolucao, 'Full HD');
});

test('a fonte que falhou duas vezes sai da frente temporariamente (ordem inteligente)', async () => {
    const ordemDeChamada = [];
    comFontesDeTeste([
        { id: 'ruim', nome: 'Ruim', papel: 'dublado', peso: 100, resolver: async () => { ordemDeChamada.push('ruim'); throw Error('servidor fora do ar'); } },
        { id: 'boa', nome: 'Boa', papel: 'dublado', peso: 10, resolver: async () => { ordemDeChamada.push('boa'); return { url: 'https://exemplo/pl/ok/master.m3u8', audio: 'pt-BR', fonte: 'Boa' }; } }
    ]);
    await motor.escolher('dublado', { tipo: 'movie', tmdbId: '333' });
    const castigada = motor.estado().find(f => f.id === 'ruim');
    assert.equal(castigada.castigada, true, 'a que falhou duas vezes seguidas fica marcada');
    assert.deepEqual(ordemDeChamada, ['ruim', 'ruim', 'boa'], 'a falha de rede foi repetida antes de trocar de fonte');
    const primeira = motor.estado().find(f => f.id === 'boa');
    assert.equal(primeira.acertos >= 1, true, 'a que acertou ganha crédito');
});

test('uma falha isolada não derruba a fonte na frente das outras', async () => {
    comFontesDeTeste([
        { id: 'principal', nome: 'Principal', papel: 'dublado', peso: 100, resolver: async () => null },
        { id: 'apoio', nome: 'Apoio', papel: 'dublado', peso: 10, resolver: async () => ({ url: 'https://exemplo/pl/ok/master.m3u8', audio: 'pt-BR', fonte: 'Apoio' }) }
    ]);
    await motor.escolher('dublado', { tipo: 'movie', tmdbId: '777' });
    const principal = motor.estado().find(f => f.id === 'principal');
    assert.equal(principal.castigada, false, 'não ter o título não é defeito da fonte');
    assert.equal(principal.semTitulo, 1, 'mas fica anotado que ela não tem esse título');
});

test('o acerto fica guardado: a próxima abertura não repete a busca', async () => {
    let chamadas = 0;
    comFontesDeTeste([
        { id: 'unica', nome: 'Única', papel: 'dublado', peso: 100, resolver: async () => { chamadas++; return { url: 'https://exemplo/pl/cache/master.m3u8', audio: 'pt-BR', fonte: 'Única' }; } }
    ]);
    await motor.escolher('dublado', { tipo: 'movie', tmdbId: '444' });
    await motor.escolher('dublado', { tipo: 'movie', tmdbId: '444' });
    assert.equal(chamadas, 1, 'a segunda vez vem do que ficou guardado');
});

test('o endereço entregue ao player passa pelo encaminhamento do aplicativo', () => {
    const preparado = motor.prepararParaPlayer({ url: 'https://vixsrc.to/playlist/1?token=abc', audio: 'original', fonte: 'Vixsrc' });
    assert.match(preparado.urlAplicativo, /^\/api\/hls\?u=/);
});
