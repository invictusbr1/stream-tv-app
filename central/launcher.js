'use strict';
// Atalho do computador: sobe a central e abre o painel já dentro.
//
// É este arquivo que vira o programa "Central Conecta TV.exe" da Área de
// Trabalho. Ele não abre janela nenhuma além do painel no navegador.

const { exec } = require('child_process');

require('./servidor');

function abrirPainel() {
    const porta = process.env.CENTRAL_PORTA || process.env.PORT || '4100';
    const chave = process.env.CENTRAL_CHAVE || '';
    const endereco = `http://localhost:${porta}/${chave ? 'entrar?chave=' + encodeURIComponent(chave) : ''}`;
    // No Windows abre o navegador padrão; nos outros sistemas o comando é outro.
    const comando = process.platform === 'win32' ? `start "" "${endereco}"`
        : process.platform === 'darwin' ? `open "${endereco}"` : `xdg-open "${endereco}"`;
    exec(comando, () => { /* se não abrir, o endereço continua no console */ });
}

// Espera o servidor escolher a porta e a chave antes de abrir o navegador.
let tentativas = 0;
const relogio = setInterval(() => {
    tentativas++;
    if (process.env.CENTRAL_PORTA) {
        clearInterval(relogio);
        abrirPainel();
    } else if (tentativas > 40) {
        clearInterval(relogio);
        abrirPainel();
    }
}, 250);

process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
