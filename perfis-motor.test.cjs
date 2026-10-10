const test = require('node:test');
const assert = require('node:assert/strict');
const perfis = require('./perfis-motor');

const ficha = {
    id: 'exemplo',
    nome: 'Exemplo · dublado',
    nota: 8.4,
    dublado: true,
    qualidade: '1080p',
    tipos: ['movie', 'tv'],
    urlMovie: 'https://exemplo.test/filme/{id}',
    urlTv: 'https://exemplo.test/serie/{id}/{temporada}/{episodio}',
    referer: 'https://exemplo.test/',
    // O caçador grava a regra com espaçamento tolerante (\s*), porque a mesma
    // página aparece de formas diferentes entre os títulos.
    passos: [{ tipo: 'regex', padrao: 'file\\s*[:=]\\s*"([^"]+)"', grupo: 1 }],
};

test('monta o endereço da ficha por filme e por episódio', () => {
    assert.equal(perfis.preencher(ficha.urlMovie, { tmdbId: '27205' }), 'https://exemplo.test/filme/27205');
    assert.equal(
        perfis.preencher(ficha.urlTv, { tmdbId: '1399', temporada: '2', episodio: '7' }),
        'https://exemplo.test/serie/1399/2/7'
    );
});

test('lê o vídeo da página com a regra gravada pelo caçador', () => {
    const pagina = 'var player = { file: "https://cdn.exemplo.test/hls/master.m3u8", outro: 1 };';
    const achado = perfis.aplicarPasso(ficha.passos[0], pagina, ficha.referer);
    assert.equal(achado, 'https://cdn.exemplo.test/hls/master.m3u8');
    // A mesma regra vale quando a página escreve tudo junto…
    const compacta = 'sources:[{file:"https://cdn.exemplo.test/outro.m3u8"}]';
    assert.equal(perfis.aplicarPasso(ficha.passos[0], compacta, ficha.referer), 'https://cdn.exemplo.test/outro.m3u8');
    // …e quando a barra vem escapada, como acontece dentro de JavaScript.
    const escapada = 'player.file = "https:\\/\\/cdn.exemplo.test\\/terceiro.m3u8";';
    assert.equal(perfis.aplicarPasso(ficha.passos[0], escapada, ficha.referer), 'https://cdn.exemplo.test/terceiro.m3u8');
});

test('resolve a ficha inteira buscando a página', async () => {
    const buscar = async endereco => {
        assert.equal(endereco, 'https://exemplo.test/filme/27205');
        return '<script>sources:[{file:"https:\\/\\/cdn.exemplo.test\\/filme.m3u8"}]</script>';
    };
    const pronto = await perfis.resolver(
        { ...ficha, passos: [{ tipo: 'regex', padrao: 'file\\s*:\\s*"([^"]+)"', grupo: 1, juntarComBase: true }] },
        { tipo: 'movie', tmdbId: '27205' },
        { buscar }
    );
    assert.equal(pronto.url, 'https://cdn.exemplo.test/filme.m3u8');
    assert.equal(pronto.fonteId, 'exemplo');
    assert.equal(pronto.type, 'hls');
});

test('segue dois passos (página → embed → vídeo)', async () => {
    const fichaDupla = {
        ...ficha,
        urlMovie: 'https://exemplo.test/f/{id}',
        passos: [
            { tipo: 'regex', padrao: 'iframe[^"]+"([^"]+)"', grupo: 1 },
            { tipo: 'json', caminho: 'sources[0].file' },
        ],
    };
    const buscar = async endereco => {
        if (endereco === 'https://exemplo.test/f/1') return '<iframe src="https://embed.exemplo.test/e/1"></iframe>';
        if (endereco === 'https://embed.exemplo.test/e/1') return '{"sources":[{"file":"https://cdn.exemplo.test/2.m3u8"}]}';
        throw new Error('endereço inesperado');
    };
    const pronto = await perfis.resolver(fichaDupla, { tipo: 'movie', tmdbId: '1' }, { buscar });
    assert.equal(pronto.url, 'https://cdn.exemplo.test/2.m3u8');
});

test('recusa endereço inseguro (http, rede interna, localhost)', async () => {
    assert.equal(perfis.ehEnderecoSeguro('http://exemplo.test/x'), false);
    assert.equal(perfis.ehEnderecoSeguro('https://127.0.0.1/x'), false);
    assert.equal(perfis.ehEnderecoSeguro('https://192.168.0.10/x'), false);
    assert.equal(perfis.ehEnderecoSeguro('https://localhost/x'), false);
    assert.equal(perfis.ehEnderecoSeguro('https://exemplo.test/x'), true);
    // Fornecedor que só entrega http:// tem o endereço promovido para https://
    // (o aplicativo exige https) — foi o caso do addon FenixHub, medido em
    // 10/10/2026: o mesmo endereço responde em https e toca em português.
    const buscar = async () => '<script>file:"http://exemplo.test/v.m3u8"</script>';
    const pronto = await perfis.resolver(ficha, { tipo: 'movie', tmdbId: '1' }, { buscar });
    assert.equal(pronto.url, 'https://exemplo.test/v.m3u8');
    // Endereço de rede interna continua fora, mesmo depois da promoção.
    const interno = async () => '<script>file:"http://192.168.0.10/v.m3u8"</script>';
    assert.equal(await perfis.resolver(ficha, { tipo: 'movie', tmdbId: '1' }, { buscar: interno }), null);
});

test('a ficha de filme não é usada para episódio (e a ordem é pela nota)', () => {
    const soFilme = { ...ficha, id: 'so-filme', urlTv: '', nota: 9.9 };
    const alvoTv = { tipo: 'tv', tmdbId: '1', temporada: '1', episodio: '1' };
    assert.deepEqual(perfis.ordenar([soFilme, { ...ficha, id: 'serve', nota: 8 }], alvoTv, 'dublado').map(p => p.id), ['serve']);
    const alvoFilme = { tipo: 'movie', tmdbId: '1' };
    assert.deepEqual(perfis.ordenar([{ ...ficha, id: 'baixa', nota: 5 }, { ...ficha, id: 'alta', nota: 9 }], alvoFilme, 'dublado').map(p => p.id), ['alta', 'baixa']);
    // Fonte de áudio original não entra quando o pedido é dublado.
    assert.deepEqual(perfis.ordenar([{ ...ficha, id: 'so-original', dublado: false }], alvoFilme, 'dublado'), []);
});

test('ficha inativa é ignorada', () => {
    assert.deepEqual(perfis.perfisValidos([{ id: 'a', ativo: true }, { id: 'b', ativo: false }]).map(p => p.id), ['a']);
});
