const { exec } = require('child_process');

const PORT = process.env.PORT || 3000;
require('./server');

// O servidor escolhe a porta livre e publica em CONECTA_PORTA (se a porta
// preferida estiver ocupada, ele assume a próxima). O navegador precisa abrir
// exatamente nessa porta — senão o usuário cairia numa instância antiga.
setTimeout(() => {
    exec(`start "" "http://localhost:${process.env.CONECTA_PORTA || PORT}"`);
}, 1200);

process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
