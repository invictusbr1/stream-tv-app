'use strict';
// mpv de mentira para os testes: abre o cano IPC, conta 1 s de vídeo em 2160p
// e termina (ou fecha quando recebe "quit"). MPV_FALSO=erro simula arquivo ruim.
const net = require('node:net');
const fs = require('node:fs');
const ipc = (process.argv.find(a => a.startsWith('--input-ipc-server=')) || '').split('=')[1];
const inicio = Number((process.argv.find(a => a.startsWith('--start=')) || '=0').split('=')[1]);
const modo = process.env.MPV_FALSO || 'ok';
if (process.env.MPV_FALSO_ARGS) fs.writeFileSync(process.env.MPV_FALSO_ARGS, JSON.stringify(process.argv.slice(2)));
try { fs.unlinkSync(ipc); } catch {}
const clientes = new Set();
const enviar = o => { for (const c of clientes) c.write(JSON.stringify(o) + '\n'); };
const sair = (motivo, codigo = 0) => { enviar({ event: 'end-file', reason: motivo, ...(motivo === 'error' ? { file_error: 'unrecognized file format' } : {}) }); setTimeout(() => process.exit(codigo), 50); };
net.createServer(c => {
    clientes.add(c);
    let resto = '';
    c.on('data', d => { resto += d; const l = resto.split('\n'); resto = l.pop(); for (const x of l) { const m = JSON.parse(x); if (m.command[0] === 'quit') sair('quit'); } });
    if (clientes.size === 1) {
        if (modo === 'erro') return setTimeout(() => sair('error', 2), 100);
        setTimeout(() => { enviar({ event: 'property-change', name: 'duration', data: 100 }); enviar({ event: 'property-change', name: 'height', data: 2160 }); }, 50);
        let t = inicio;
        const relogio = setInterval(() => { t += 0.2; enviar({ event: 'property-change', name: 'time-pos', data: t }); if (modo === 'ok' && t >= inicio + 1) { clearInterval(relogio); sair('eof'); } }, 50);
    }
}).listen(ipc);
setTimeout(() => process.exit(0), 20000);
