// Teste da central: sobe o servidor, manda um acesso e uma sessão e confere os
// números do painel.
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CHAVE = 'chave-de-teste-1234';
const TOKEN = 'token-de-teste-5678';
const PORTA = 4599;

function esperarServidor(ms = 15000) {
    const limite = Date.now() + ms;
    return (async function tentar() {
        while (Date.now() < limite) {
            try {
                const r = await fetch(`http://127.0.0.1:${PORTA}/api/health`);
                if (r.ok) return true;
            } catch { /* ainda subindo */ }
            await new Promise(r => setTimeout(r, 250));
        }
        throw new Error('a central não subiu a tempo');
    })();
}

test('a central guarda quem entrou, o que assistiu e mostra os números', async () => {
    const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'central-teste-'));
    fs.mkdirSync(path.join(pasta, 'dados'), { recursive: true });
    const filho = spawn(process.execPath, [path.join(__dirname, 'servidor.js')], {
        cwd: pasta,
        env: { ...process.env, PORT: String(PORTA), CENTRAL_KEY: CHAVE, CENTRAL_TOKEN: TOKEN, CENTRAL_DADOS: path.join(pasta, 'dados') },
        stdio: 'ignore'
    });
    try {
        await esperarServidor();

        // Sem chave, o painel não abre.
        const semChave = await fetch(`http://127.0.0.1:${PORTA}/api/status`, { headers: { accept: 'application/json' } });
        assert.equal(semChave.status, 401);

        // Sem token, o aplicativo não reporta.
        const semToken = await fetch(`http://127.0.0.1:${PORTA}/api/acesso`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nome: 'Fulano' }) });
        assert.equal(semToken.status, 401);

        const acesso = await fetch(`http://127.0.0.1:${PORTA}/api/acesso`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Central': TOKEN },
            body: JSON.stringify({ nome: 'Marlon', aparelho: 'Celular Android', dispositivo: 'd-cel-1', versao: '2.8.1' })
        });
        assert.equal(acesso.status, 200);
        assert.equal((await acesso.json()).aparelhos, 1);

        for (const [titulo, fonte, ok] of [['Game of Thrones · T1 E1', 'WatchPlay', true], ['Round 6 · T1 E1', 'PipocaCine', true], ['Filme novo', 'Vixsrc', false]]) {
            const evento = await fetch(`http://127.0.0.1:${PORTA}/api/evento`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Central': TOKEN },
                body: JSON.stringify({ tipo: 'play', dispositivo: 'd-cel-1', nome: 'Marlon', aparelho: 'Celular Android', titulo, fonte, audio: 'pt-BR', resolucao: '720p', ok })
            });
            assert.equal(evento.status, 200);
        }

        const painel = await fetch(`http://127.0.0.1:${PORTA}/api/status?chave=${CHAVE}`);
        assert.equal(painel.status, 200);
        const dados = await painel.json();
        assert.equal(dados.resumo.pessoas, 1);
        assert.equal(dados.resumo.aparelhos, 1);
        assert.equal(dados.resumo.online, 1);
        assert.equal(dados.resumo.sessoesHoje, 3);
        assert.equal(dados.resumo.falhasHoje, 1);
        assert.equal(dados.aparelhos[0].assistindo, 'Filme novo');
        assert.equal(dados.fontes.length, 3);
        assert.equal(dados.fontes.find(f => f.fonte === 'Vixsrc').taxa, 0);
        assert.ok(dados.alertas.length >= 1);
        assert.equal(dados.eventos.length, 3);

        // A página do painel é entregue com a chave e sem cache.
        const pagina = await fetch(`http://127.0.0.1:${PORTA}/`, { headers: { cookie: `central_chave=${CHAVE}` } });
        assert.equal(pagina.status, 200);
        assert.equal(pagina.headers.get('cache-control'), 'no-store');
        assert.match(await pagina.text(), /Central do Conecta TV/);
    } finally {
        filho.kill();
        await new Promise(r => setTimeout(r, 500));
        // O Windows às vezes segura a pasta por alguns instantes depois de
        // encerrar o processo; a limpeza não pode derrubar o teste.
        try { fs.rmSync(pasta, { recursive: true, force: true }); } catch { /* tenta na próxima */ }
    }
});
