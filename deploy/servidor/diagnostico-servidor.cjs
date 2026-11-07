'use strict';
// Diagnóstico do servidor (só LÊ, não apaga nada): disco, se o 4K da TorBox
// está liberado, conversões em andamento/paradas e ffmpeg rodando.
// (Base: liberar-espaco-servidor.cjs.)
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
echo "Disco: $(df -h / | tail -1 | awk '{print "usado "$3" de "$2" ("$5"), livre "$4}')"
L=$(df -BG / | tail -1 | awk '{gsub("G","",$4); print $4}')
if [ "$L" -ge 25 ]; then echo "4K da TorBox: deve funcionar (tem $L GB livres; o 4K precisa do tamanho do filme + 5 GB, em geral 20 a 30 GB)"; else echo "4K da TorBox: provavelmente BLOQUEADO (tem $L GB livres; o 4K precisa do tamanho do filme + 5 GB, em geral 20 a 30 GB) - use Liberar espaço"; fi
C=$(docker ps -q -f label=com.docker.compose.project=servidor -f label=com.docker.compose.service=app | head -1)
if [ -n "$C" ]; then
  echo "Conversões no servidor: $(docker exec "$C" sh -c 'du -sh /root/.conecta-tv/conversoes 2>/dev/null | cut -f1' || echo 0)"
  docker exec "$C" sh -c 'for d in /root/.conecta-tv/conversoes/*/; do [ -d "$d" ] || continue; n=$(ls "$d" | grep -c "\.ts$"); f=$(grep -c ENDLIST "$d/index.m3u8" 2>/dev/null); t=$(du -sh "$d" | cut -f1); m=$(( ( $(date +%s) - $(stat -c %Y "$d/index.m3u8" 2>/dev/null || echo 0) ) / 60 )); echo " - $(basename "$d"): $t, $n pedaços, $( [ "$f" = 1 ] && echo completa || echo "em andamento/parada"), mexida há $m min"; done' 2>/dev/null | tail -12
  echo "ffmpeg rodando agora: $(docker exec "$C" sh -c 'ps aux | grep -c "[f]fmpeg"' 2>/dev/null)"
  echo "App ligado desde: $(docker inspect -f '{{.State.StartedAt}}' "$C" | cut -c1-19)"
fi
echo "--- Onde está o espaço (só leitura) ---"
docker system df 2>/dev/null | sed 's/^/  /'
docker images --format '  imagem: {{.Repository}}:{{.Tag}} {{.Size}} ({{.CreatedSince}})' 2>/dev/null | head -15
docker system df -v 2>/dev/null | awk '/VOLUME NAME/{v=1;next} v&&NF==0{v=0} v{print "  volume: "$0}' | head -10
ls -lh /swapfile /swap.img 2>/dev/null | awk '{print "  swap: "$5" "$9}'
for d in /home/ubuntu /root /tmp /var/log /snap; do echo "  $d: $(du -sh $d 2>/dev/null | cut -f1)"; done
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
        if (/\bFIM\b/.test(saida)) console.log('Diagnóstico concluído.');
        else { console.log('Não deu certo (código ' + codigo + '). ' + String(erro).trim().slice(-300)); process.exitCode = 1; }
    });
}

if (require.main === module) principal();
