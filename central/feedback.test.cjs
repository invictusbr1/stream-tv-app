'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { criarFeedback } = require('./feedback');
test('relatos da família: guarda, conta os novos e marca como resolvido', () => {
    const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'relatos-'));
    try {
        const f = criarFeedback({ pastaDados: pasta });
        const r = f.registrar({ em: '2026-11-01T10:00:00Z', nome: 'Laryssa', aparelho: 'Celular', versao: '2.13.134', titulo: 'Quem Ama Cuida · T1 E140', fonte: 'FrostStream' }, { motivo: 'Trava ou para', mensagem: 'travou no meio\u0000 e voltou' });
        assert.equal(r.categoria, 'Trava ou para'); assert.equal(r.mensagem, 'travou no meio  e voltou');
        assert.equal(f.registrar({ nome: 'X' }, { motivo: 'Outro', mensagem: '' }), null, 'relato vazio não entra');
        assert.equal(f.novos(), 1);
        assert.equal(f.resolver(r.id), true); assert.equal(f.novos(), 0);
        assert.equal(f.listar()[0].status, 'resolvido');
    } finally { fs.rmSync(pasta, { recursive: true, force: true }); }
});
