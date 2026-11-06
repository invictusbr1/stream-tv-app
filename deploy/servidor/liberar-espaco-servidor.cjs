'use strict';
// Libera espaço no disco da Oracle (06/11/2026: o disco encheu com conversões
// da TorBox e o "Atualizar servidor" falhou no envio). Apaga SÓ o que se
// refaz sozinho:
//   - conversões de filmes (cache do conversor; refeitas ao abrir de novo);
//   - pacotes de atualização já instalados (mais de 30 min);
//   - cópias de segurança antigas de versões (fica as 2 mais novas);
//   - imagens Docker sem uso e cache de construção;
//   - registros antigos do sistema (mantém 200 MB).
// NÃO toca em: dados do app, códigos de acesso, aparelhos, .env, volumes.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const CONFIG = path.join(os.homedir(), 'Documents', 'ConnectaTV', 'Oracle', 'config.json');
const SCRIPT = `set -u
echo "ANTES: $(df -h / | tail -1 | awk '{print "usado "$3" de "$2" ("$5"), livre "$4}')"
C=$(docker ps -q -f label=com.docker.compose.project=servidor -f label=com.docker.compose.service=app | head -1)
if [ -n "$C" ]; then
  echo "Conversões de filmes: $(docker exec "$C" sh -c 'du -sh /root/.conecta-tv/conversoes 2>/dev/null | cut -f1' || echo '?')"
  docker exec "$C" sh -c 'rm -rf /root/.conecta-tv/conversoes/* 2>/dev/null; true'
fi
echo "Pacotes de atualização: $(du -sh /home/ubuntu/conecta-updates 2>/dev/null | cut -f1)"
find /home/ubuntu/conecta-updates -maxdepth 1 -type f -mmin +30 -delete 2>/dev/null
echo "Cópias de versões antigas: $(du -sh /var/lib/conecta-tv-updates/backups 2>/dev/null | cut -f1)"
ls -1dt /var/lib/conecta-tv-updates/backups/* 2>/dev/null | tail -n +3 | xargs -r rm -rf
docker image prune -f >/dev/null 2>&1
docker builder prune -f >/dev/null 2>&1
journalctl --vacuum-size=200M >/dev/null 2>&1
echo "DEPOIS: $(df -h / | tail -1 | awk '{print "usado "$3" de "$2" ("$5"), livre "$4}')"
echo FIM
`;

function principal() {
    let config;
    try { config = JSON.parse(fs.readFileSync(CONFIG, 'utf8')); } catch { console.log('Não achei a configuração do servidor (Documentos\\ConnectaTV\\Oracle\\config.json).'); process.exitCode = 2; return; }
    if (!/^[0-9.]+$/.test(config.host || '') || !/^[a-z][a-z0-9_-]*$/.test(config.user || '')) { console.log('Destino do servidor inválido.'); process.exitCode = 2; return; }
    const comum = ['-i', config.key, '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'UserKnownHostsFile=' + config.knownHosts, '-o', 'ConnectTimeout=15'];
    const ssh = spawn(process.platform === 'win32' ? 'ssh.exe' : 'ssh', [...comum, config.user + '@' + config.host, 'sudo bash -s'], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let saida = '', erro = '';
    ssh.stdout.on('data', d => { saida += d; });
    ssh.stderr.on('data', d => { erro += d; });
    ssh.stdin.end(SCRIPT);
    const relogio = setTimeout(() => ssh.kill(), 180000);
    ssh.on('close', codigo => {
        clearTimeout(relogio);
        const linhas = String(saida).split(/\r?\n/).filter(l => l.trim() && l.trim() !== 'FIM');
        linhas.forEach(l => console.log(l));
        if (/\bFIM\b/.test(saida)) console.log('Pronto. Agora aperte "Atualizar servidor".');
        else { console.log('Não deu certo (código ' + codigo + '). ' + String(erro).trim().slice(-300)); process.exitCode = 1; }
    });
}

if (require.main === module) principal();
