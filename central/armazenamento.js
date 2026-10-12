'use strict';
const fs = require('fs');
const path = require('path');
// Troca o arquivo só depois de terminar a escrita e mantém a versão anterior.
function gravarJson(arquivo, dados) {
    fs.mkdirSync(path.dirname(arquivo), { recursive: true });
    const tmp = arquivo + '.tmp';
    try {
        fs.writeFileSync(tmp, JSON.stringify(dados, null, 1), 'utf8');
        if (fs.existsSync(arquivo)) {
            try { JSON.parse(fs.readFileSync(arquivo, 'utf8')); fs.copyFileSync(arquivo, arquivo + '.bak'); } catch { /* preserva backup válido */ }
        }
        fs.renameSync(tmp, arquivo);
    } finally { try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch { /* será substituído na próxima gravação */ } }
}
function lerJson(arquivo, padrao, validar = () => true) {
    for (const nome of [arquivo, arquivo + '.bak']) {
        try { const dados = JSON.parse(fs.readFileSync(nome, 'utf8')); if (dados && validar(dados)) return dados; } catch { /* tenta cópia anterior */ }
    }
    return padrao;
}
module.exports = { gravarJson, lerJson };
