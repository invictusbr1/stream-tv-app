'use strict';
// Leva a chave da TorBox (CHAVE-TORBOX.local.txt) para o servidor Oracle,
// no arquivo .env do servidor (o mesmo das outras senhas), e reinicia só o
// app. A chave vai pela entrada do SSH — nunca na linha de comando, no
// registro, no pacote de atualização ou no GitHub.
//
// Antes: "Atualizar servidor" (para o servidor saber ler TORBOX_API_KEY).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const RAIZ = path.resolve(__dirname, '../..');
const CONFIG = path.join(os.homedir(), 'Documents', 'ConnectaTV', 'Oracle', 'config.json');
// Script Python que roda no servidor (texto em deploy: grava o .env com
// permissão 600 e sobe de novo só o contêiner do app).
const SCRIPT = 'aW1wb3J0IHN5cyxyZSxvcyxzdWJwcm9jZXNzCms9c3lzLnN0ZGluLnJlYWRsaW5lKCkuc3RyaXAoKQppZiBub3QgcmUuZnVsbG1hdGNoKHInW0EtWmEtejAtOS1dezIwLDgwfScsayk6CiAgICBwcmludCgnQ0hBVkVfSU5WQUxJREEnKTtzeXMuZXhpdCgyKQpSPScvb3B0L2NvbmVjdGEtdHYvZGVwbG95L3NlcnZpZG9yJwpFPVIrJy8uZW52JwpMPVtsIGZvciBsIGluIG9wZW4oRSkucmVhZCgpLnNwbGl0bGluZXMoKSBpZiBub3QgbC5zdGFydHN3aXRoKCdUT1JCT1hfQVBJX0tFWT0nKV0KTC5hcHBlbmQoJ1RPUkJPWF9BUElfS0VZPScraykKdD1FKycudG1wJwpzdD1vcy5zdGF0KEUpCmZkPW9zLm9wZW4odCxvcy5PX1dST05MWXxvcy5PX0NSRUFUfG9zLk9fVFJVTkMsMG82MDApCm9zLndyaXRlKGZkLCgnXG4nLmpvaW4oTCkrJ1xuJykuZW5jb2RlKCkpO29zLmNsb3NlKGZkKQpvcy5jaG93bih0LHN0LnN0X3VpZCxzdC5zdF9naWQpO29zLmNobW9kKHQsc3Quc3RfbW9kZSYwbzc3NykKb3MucmVwbGFjZSh0LEUpCmlmICdUT1JCT1hfQVBJX0tFWScgbm90IGluIG9wZW4oUisnL2RvY2tlci1jb21wb3NlLnltbCcpLnJlYWQoKToKICAgIHByaW50KCdGQUxUQV9BVFVBTElaQVInKTtzeXMuZXhpdCgwKQpjPVsnZG9ja2VyJywnY29tcG9zZScsJy1wJywnc2Vydmlkb3InLCctLWVudi1maWxlJyxFLCctZicsUisnL2RvY2tlci1jb21wb3NlLnltbCcsJy1mJyxSKycvZG9ja2VyLWNvbXBvc2Uub3JhY2xlLnltbCcsJ3VwJywnLWQnLCctLW5vLWJ1aWxkJywnYXBwJ10Kcj1zdWJwcm9jZXNzLnJ1bihjLGNhcHR1cmVfb3V0cHV0PVRydWUsdGV4dD1UcnVlKQpwcmludCgnT0snIGlmIHIucmV0dXJuY29kZT09MCBlbHNlICdFUlJPX0RPQ0tFUiAnK3Iuc3RkZXJyWy0zMDA6XS5yZXBsYWNlKGssJyoqKicpKQo=';

function lerChave() {
    try {
        const linha = fs.readFileSync(path.join(RAIZ, 'CHAVE-TORBOX.local.txt'), 'utf8').split(/\r?\n/).map(l => l.trim()).find(l => l && !l.startsWith('#')) || '';
        return /^[A-Za-z0-9-]{20,80}$/.test(linha) ? linha : '';
    } catch { return ''; }
}

function principal() {
    const chave = lerChave();
    if (!chave) { console.log('Não achei a chave em CHAVE-TORBOX.local.txt.'); process.exitCode = 2; return; }
    let config;
    try { config = JSON.parse(fs.readFileSync(CONFIG, 'utf8')); } catch { console.log('Não achei a configuração do servidor (Documentos\\ConnectaTV\\Oracle\\config.json).'); process.exitCode = 2; return; }
    if (!/^[0-9.]+$/.test(config.host || '') || !/^[a-z][a-z0-9_-]*$/.test(config.user || '')) { console.log('Destino do servidor inválido.'); process.exitCode = 2; return; }
    const comum = ['-i', config.key, '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'UserKnownHostsFile=' + config.knownHosts, '-o', 'ConnectTimeout=15'];
    const comando = 'sudo python3 -c "$(echo ' + SCRIPT + ' | base64 -d)"';
    const ssh = spawn(process.platform === 'win32' ? 'ssh.exe' : 'ssh', [...comum, config.user + '@' + config.host, comando], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let saida = '', erro = '';
    ssh.stdout.on('data', d => { saida += d; });
    ssh.stderr.on('data', d => { erro += d; });
    ssh.stdin.end(chave + '\n');
    const relogio = setTimeout(() => ssh.kill(), 120000);
    ssh.on('close', codigo => {
        clearTimeout(relogio);
        const limpo = s => String(s).split(chave).join('***').trim();
        const r = limpo(saida);
        if (/\bOK\b/.test(r)) console.log('Chave da TorBox instalada no servidor e app reiniciado. A fonte TorBox já está valendo.');
        else if (/FALTA_ATUALIZAR/.test(r)) console.log('Chave gravada no servidor, mas ele ainda é a versão antiga: aperte "Atualizar servidor" e depois este botão de novo.');
        else if (/CHAVE_INVALIDA/.test(r)) console.log('A chave do arquivo não parece válida.');
        else { console.log('Não deu certo (código ' + codigo + '). ' + (r || limpo(erro)).slice(-400)); process.exitCode = 1; }
    });
}

if (require.main === module) principal();
module.exports = { lerChave };
