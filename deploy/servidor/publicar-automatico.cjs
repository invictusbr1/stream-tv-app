'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '../..');
// Documentos mantém o mesmo caminho dentro e fora de aplicativos empacotados do Windows.
const STATE = path.join(os.homedir(), 'Documents', 'ConnectaTV', 'Oracle');
const CONFIG = path.join(STATE, 'config.json');
const STATUS = path.join(STATE, 'status.json');
const PAUSE = path.join(ROOT, '.oracle-atualizacao-pausada');
const DEPLOY_FILES = ['docker-compose.yml', 'docker-compose.oracle.yml', 'Caddyfile', '.env.exemplo',
    'Instalar-No-Servidor.sh', 'LEIA-ME-SERVIDOR.md', 'publicar-automatico.cjs',
    'publicar-no-servidor.sh', 'ATUALIZACAO-AUTOMATICA.md'];
const REQUIRED = ['package.json', 'package-lock.json', 'server.js', 'index.html', 'Dockerfile',
    'avisos-servidor.js', 'avisos-servidor-store.cjs',
    'central/servidor.js', 'central/Dockerfile', 'deploy/servidor/docker-compose.yml',
    'deploy/servidor/docker-compose.oracle.yml', 'deploy/servidor/Caddyfile',
    'android/app/src/main/assets/catalog.js', 'android/app/src/main/assets/assistir.html'];
const privateFile = name => /(^|\/)(node_modules|dados|\.git)(\/|$)|\.local\.|\.test\.|\.bak|(^|\/)\.env($|-)|(^|\/)(acessos|autorizados|bloqueados)\.json$|\.(key|pem|p12|lnk)$/i.test(name);
const pause = ms => new Promise(r => setTimeout(r, ms));
function readJson(file, fallback = {}) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } }
function atomicJson(file, value) {
    const temporary = file + '.' + process.pid + '.tmp';
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2)); fs.renameSync(temporary, file);
}
function status(patch) { atomicJson(STATUS, { ...readJson(STATUS), ...patch, atualizadoEm: new Date().toISOString() }); }
function log(message) {
    const line = new Date().toISOString() + ' ' + message;
    fs.appendFileSync(path.join(STATE, 'atualizacao.log'), line + '\n');
    if (!process.argv.includes('--watch')) console.log(message);
}
function files(root = ROOT) {
    const result = new Set();
    const add = relative => {
        const normalized = relative.replaceAll('\\', '/');
        if (privateFile(normalized)) return;
        const full = path.join(root, normalized);
        if (fs.lstatSync(full).isSymbolicLink()) throw new Error('Link simbólico não permitido no pacote: ' + normalized);
        result.add(normalized);
    };
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        if (!entry.isFile()) continue;
        // Cópia antiga de package.json com extensão incorreta; não é código executável.
        if (entry.name === 'package.js') continue;
        if (/\.(js|cjs|css|svg|png|ico|webp)$/i.test(entry.name) ||
            ['package.json', 'package-lock.json', 'index.html', 'fontes.json', 'perfis.json', 'diagnostico-controle.mp4', 'Dockerfile', '.dockerignore'].includes(entry.name)) add(entry.name);
    }
    for (const directory of ['central', 'pwa']) {
        const visit = relative => {
            for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
                const child = relative + '/' + entry.name;
                if (privateFile(child) || entry.name === 'android') continue;
                if (entry.isSymbolicLink()) throw new Error('Link simbólico não permitido: ' + child);
                if (entry.isDirectory()) visit(child);
                else if (entry.isFile() && (/\.(js|cjs|html|css|png|svg|ico|webmanifest|webp|woff2?)$/i.test(entry.name) || entry.name === 'Dockerfile')) add(child);
            }
        };
        visit(directory);
    }
    for (const asset of ['assistir.html', 'catalog.js', 'android.js']) add('android/app/src/main/assets/' + asset);
    for (const file of DEPLOY_FILES) add('deploy/servidor/' + file);
    for (const required of REQUIRED) if (!result.has(required)) throw new Error('Arquivo obrigatório ausente: ' + required);
    return [...result].sort();
}
function fingerprint(root = ROOT) {
    const names = files(root), digest = crypto.createHash('sha256');
    for (const name of names) digest.update(name).update('\0').update(fs.readFileSync(path.join(root, name))).update('\0');
    return { id: digest.digest('hex'), names };
}
function run(command, args, options = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, { windowsHide: true, ...options });
        let output = '';
        child.stdout?.on('data', b => { output = (output + b).slice(-12000); });
        child.stderr?.on('data', b => { output = (output + b).slice(-12000); });
        child.once('error', reject);
        child.once('exit', code => code === 0 ? resolve(output) : reject(new Error(command + ' falhou: ' + output.trim())));
    });
}
async function validate(snapshot, names) {
    for (const name of names) {
        if (/\.(js|cjs)$/.test(name)) await run(process.execPath, ['--check', path.join(snapshot, name)]);
        if (name.endsWith('.json')) JSON.parse(fs.readFileSync(path.join(snapshot, name), 'utf8'));
    }
}
async function packageSource(expected, root = ROOT, directory = STATE) {
    const snapshot = fs.mkdtempSync(path.join(directory, 'snapshot-'));
    try {
        for (const name of expected.names) {
            const destination = path.join(snapshot, name);
            fs.mkdirSync(path.dirname(destination), { recursive: true }); fs.copyFileSync(path.join(root, name), destination);
        }
        if (fingerprint(root).id !== expected.id || fingerprint(snapshot).id !== expected.id) throw new Error('Arquivos mudaram durante a cópia; aguardando nova estabilização.');
        await validate(snapshot, expected.names);
        fs.writeFileSync(path.join(snapshot, '.conecta-release.json'), JSON.stringify({ id: expected.id, criadoEm: new Date().toISOString() }));
        const archive = path.join(directory, expected.id + '.tar.gz');
        const listing = path.join(directory, expected.id + '.files.txt');
        fs.writeFileSync(listing, [...expected.names, '.conecta-release.json'].join('\n') + '\n');
        await run('tar.exe', ['-czf', archive, '-C', snapshot, '-T', listing]);
        fs.unlinkSync(listing);
        const publisher=path.join(directory,expected.id+'.publicar.sh');
        fs.writeFileSync(publisher,fs.readFileSync(path.join(snapshot,'deploy/servidor/publicar-no-servidor.sh'),'utf8').replace(/\r\n/g,'\n'));
        return { archive, publisher, sha256: crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex') };
    } finally {
        // A pasta é criada por mkdtemp acima, sempre dentro do estado do monitor.
        if (path.dirname(path.resolve(snapshot)) !== path.resolve(directory)) throw new Error('Pasta de trabalho fora do diretório esperado');
        fs.rmSync(snapshot, { recursive: true, force: true });
    }
}
function connection(config) {
    if (!/^[0-9.]+$/.test(config.host) || !/^[a-z][a-z0-9_-]*$/.test(config.user)) throw new Error('Destino SSH inválido');
    const common = ['-i', config.key, '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'UserKnownHostsFile=' + config.knownHosts, '-o', 'ConnectTimeout=15', '-o', 'ServerAliveInterval=20'];
    return { ssh: command => run('ssh.exe', [...common, config.user + '@' + config.host, command]),
        upload: (file, remote) => run('scp.exe', [...common, file, config.user + '@' + config.host + ':' + remote]) };
}
async function publish(expected) {
    const config = readJson(CONFIG);
    const remote = connection(config);
    status({ fase: 'preparando', release: expected.id, erro: '' });
    log('Preparando versão ' + expected.id.slice(0, 12));
    const bundle = await packageSource(expected);
    const remoteFile = '/home/' + config.user + '/conecta-updates/' + expected.id + '.tar.gz';
    status({ fase: 'enviando' });
    await remote.upload(bundle.archive, remoteFile);
    // Instala o publicador desta versão antes da execução (inclui os avisos prévios).
    const remoteScript='/home/'+config.user+'/conecta-updates/'+expected.id+'.publicar.sh';
    await remote.upload(bundle.publisher,remoteScript);
    await remote.ssh('sudo install -o root -g root -m 0750 '+remoteScript+' /usr/local/sbin/conecta-publicar');
    const unit = 'conecta-publicar-' + expected.id.slice(0, 12) + '-' + Date.now();
    await remote.ssh('sudo systemd-run --quiet --collect --unit=' + unit + ' /usr/local/sbin/conecta-publicar ' + expected.id + ' ' + bundle.sha256);
    const deadline = Date.now() + 30 * 60 * 1000;
    while (Date.now() < deadline) {
        await pause(15000);
        const record = JSON.parse(await remote.ssh('sudo cat /var/lib/conecta-tv-updates/results/' + expected.id + '.json'));
        status({ fase: record.phase, mensagemServidor: record.message });
        if (record.phase === 'healthy') {
            const response = await fetch('https://' + config.host + '/api/health', { signal: AbortSignal.timeout(20000) });
            if (!response.ok || (await response.json()).status !== 'ok') throw new Error('A verificação pública não confirmou a publicação; confira o servidor.');
            status({ fase: 'aguardando', ultimoSucesso: expected.id, ultimoSucessoEm: new Date().toISOString(), erro: '' });
            log('Publicada e verificada: ' + expected.id.slice(0, 12));
            fs.unlinkSync(bundle.archive);
            return;
        }
        if (['failed', 'rolled_back', 'busy'].includes(record.phase)) throw new Error(record.message || record.phase);
    }
    throw new Error('A publicação ultrapassou o prazo do monitor. O trabalho do servidor pode continuar; confira o status antes de repetir.');
}
function lock() {
    const file = path.join(STATE, 'monitor.lock');
    if (fs.existsSync(file)) {
        const old = readJson(file);
        if (old.pid) { try { process.kill(old.pid, 0); return false; } catch {} }
        fs.unlinkSync(file);
    }
    fs.writeFileSync(file, JSON.stringify({ pid: process.pid }), { flag: 'wx' });
    const release = () => { if (readJson(file).pid === process.pid) fs.unlinkSync(file); };
    process.once('exit', release);
    process.once('SIGTERM', () => process.exit(0));
    process.once('SIGINT', () => process.exit(0));
    return true;
}
async function main() {
    fs.mkdirSync(STATE, { recursive: true });
    if (process.argv.includes('--status')) { console.log(JSON.stringify(readJson(STATUS), null, 2)); return; }
    if (!lock()) throw new Error('O monitor já está em execução.');
    if (process.argv.includes('--once')) { await publish(fingerprint()); return; }
    if (!process.argv.includes('--watch')) throw new Error('Use --watch, --once ou --status.');
    log('Monitor iniciado. Aguardando dois minutos sem alterações.');
    let observed = '', changedAt = Date.now(), failed = '';
    for (;;) {
        try {
            if (fs.existsSync(PAUSE)) { status({ fase: 'pausado' }); await pause(15000); continue; }
            const current = fingerprint();
            if (current.id !== observed) { observed = current.id; changedAt = Date.now(); failed = ''; }
            const previous = readJson(STATUS);
            if (current.id === previous.ultimoSucesso) status({ fase: 'aguardando', observado: current.id });
            else if (current.id !== failed && Date.now() - changedAt >= 120000) {
                try { await publish(current); }
                catch (error) { failed = current.id; status({ fase: 'erro', erro: error.message }); log('Publicação não confirmada: ' + error.message); }
            } else if (current.id !== failed) status({ fase: 'estabilizando', observado: current.id });
        } catch (error) { status({ fase: 'erro', erro: error.message }); }
        await pause(15000);
    }
}
module.exports = { files, fingerprint, packageSource, validate, privateFile };
if (require.main === module) main().catch(error => { fs.mkdirSync(STATE, { recursive: true }); status({ fase: 'erro', erro: error.message }); log(error.message); process.exitCode = 1; });
