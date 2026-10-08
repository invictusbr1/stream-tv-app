const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { criarRegistro } = require('./titulos.js');

const pastaNova = () => fs.mkdtempSync(path.join(os.tmpdir(), 'titulos-problema-'));

test('lista como problema o título com falhas seguidas (e ignora o saudável)', () => {
    const registro = criarRegistro({ pastaDados: pastaNova() });
    registro.registrar({ em: '2026-10-08T10:00:00.000Z', tipo: 'falha', id: '921', titulo: 'A Luta pela Esperança', motivo: 'não abriu' });
    registro.registrar({ em: '2026-10-08T10:01:00.000Z', tipo: 'falha', id: '921', titulo: 'A Luta pela Esperança', motivo: 'não abriu' });
    registro.registrar({ em: '2026-10-08T10:02:00.000Z', tipo: 'confirmacao', id: '27205', titulo: 'A Origem', resolucao: '720p', taxa: '3000 kbps' });

    const problemas = registro.comProblema();
    assert.equal(problemas.length, 1);
    assert.equal(problemas[0].titulo, 'A Luta pela Esperança');
    assert.match(problemas[0].motivos.join(' '), /falhas seguidas/);
});

test('qualidade que cai vira problema, mesmo sem falha', () => {
    const registro = criarRegistro({ pastaDados: pastaNova() });
    registro.registrar({ em: '2026-10-08T11:00:00.000Z', tipo: 'confirmacao', id: '1101412', titulo: 'A Queda 2', resolucao: '1080p', taxa: '5000 kbps' });
    registro.registrar({ em: '2026-10-08T12:00:00.000Z', tipo: 'confirmacao', id: '1101412', titulo: 'A Queda 2', resolucao: '480p', taxa: '900 kbps' });

    const problemas = registro.comProblema();
    assert.equal(problemas.length, 1);
    assert.equal(problemas[0].melhorAltura, 1080);
    assert.match(problemas[0].motivos.join(' '), /1080p/);
});

test('a revisão fica guardada e zera as falhas seguidas quando resolve', () => {
    const registro = criarRegistro({ pastaDados: pastaNova() });
    registro.registrar({ em: '2026-10-08T10:00:00.000Z', tipo: 'falha', id: '921', titulo: 'A Luta pela Esperança' });
    registro.registrar({ em: '2026-10-08T10:01:00.000Z', tipo: 'falha', id: '921', titulo: 'A Luta pela Esperança' });
    const antes = registro.comProblema();
    assert.equal(antes.length, 1);

    registro.anotarRevisao('movie:921', { ok: true, solucao: { fonte: 'PipocaCine' }, tentativas: 1 });
    const depois = registro.listar()[0];
    assert.equal(depois.revisao.ok, true);
    assert.equal(depois.falhasSeguidas, 0);
    assert.equal(registro.comProblema().length, 0, 'resolvido sai da lista de problemas');
});

test('guarda o último episódio da série para a revisão testar o capítulo certo', () => {
    const registro = criarRegistro({ pastaDados: pastaNova() });
    registro.registrar({ em: '2026-10-08T10:00:00.000Z', tipo: 'falha', id: '1399', titulo: 'Game of Thrones', temporada: '2', numero: '5' });
    registro.registrar({ em: '2026-10-08T10:01:00.000Z', tipo: 'falha', id: '1399', titulo: 'Game of Thrones', temporada: '2', numero: '5' });
    const problema = registro.comProblema()[0];
    assert.deepEqual(problema.ultimoEpisodio, { temporada: '2', numero: '5' });
});
