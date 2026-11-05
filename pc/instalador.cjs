'use strict';
// Instala o mpv na primeira vez (em segundo plano) e conta o andamento à tela.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawn } = require('node:child_process');

function criarInstalador({ acharExe, executar = spawn, script = path.join(__dirname, 'instalar-mpv.ps1'), registro = path.join(__dirname, 'instalacao.log'), arquivoBaixado = path.join(process.env.TEMP || os.tmpdir(), 'conectatv-mpv', 'mpv.7z') } = {}) {
    let estado = { instalando: false, passo: '', erro: '' };
    let tamanho = 0;
    // Andamento do download: tamanho do arquivo já baixado / tamanho total.
    const porcento = () => {
        if (!estado.instalando || !tamanho || !/baixando o player/.test(estado.passo)) return null;
        try { return Math.min(99, Math.floor(fs.statSync(arquivoBaixado).size / tamanho * 100)); } catch { return 0; }
    };
    function iniciar() {
        if (estado.instalando || acharExe()) return estado;
        if (process.platform !== 'win32') { estado = { instalando: false, passo: '', erro: 'instale o mpv (apt install mpv)' }; return estado; }
        estado = { instalando: true, passo: 'preparando', erro: '' };
        let filho;
        try { filho = executar('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }); }
        catch (e) { estado = { instalando: false, passo: '', erro: e.message }; return estado; }
        let saida = '';
        // Registro completo em pc\instalacao.log (para descobrir o que falhou).
        try { fs.writeFileSync(registro, `=== ${new Date().toISOString()}\n`); } catch { /* pasta só de leitura */ }
        const ler = d => {
            try { fs.appendFileSync(registro, d.toString('utf8')); } catch { /* sem registro */ }
            saida = (saida + d.toString('utf8')).slice(-4000);
            for (const linha of saida.split(/\r?\n/)) {
                const t = /^TAMANHO (\d+)$/.exec(linha.trim());
                if (t) tamanho = Number(t[1]);
                const m = /^(PASSO|ERRO) (.+)$/.exec(linha.trim());
                if (m && m[1] === 'PASSO') estado.passo = m[2];
                if (m && m[1] === 'ERRO') estado.erro = m[2];
                if (/^WINGET /.test(linha.trim()) && estado.passo.includes('winget')) estado.detalhe = linha.trim().slice(7, 120);
            }
        };
        filho.stdout.on('data', ler); filho.stderr.on('data', ler);
        filho.on('error', e => { estado = { instalando: false, passo: '', erro: e.message }; });
        filho.on('close', () => {
            const ok = Boolean(acharExe());
            estado = { instalando: false, passo: ok ? 'pronto' : '', erro: ok ? '' : (estado.erro || 'não consegui instalar o player: ' + saida.trim().split(/\r?\n/).pop()) };
        });
        return estado;
    }
    return { iniciar, estado: () => ({ ...estado, porcento: porcento(), pronto: Boolean(acharExe()) }) };
}
module.exports = { criarInstalador };
