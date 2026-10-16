const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const executable = name => process.env.JAVA_HOME
    ? path.join(process.env.JAVA_HOME, 'bin', name + (process.platform === 'win32' ? '.exe' : '')) : name;
const available = spawnSync(executable('javac'), ['-version'], { encoding: 'utf8', windowsHide: true }).status === 0;
let classes;
before(() => {
    if (!available) return;
    classes = fs.mkdtempSync(path.join(os.tmpdir(), 'conecta-anime-test-'));
    const compiled = spawnSync(executable('javac'), ['-encoding', 'UTF-8', '--release', '8', '-d', classes,
        path.join(__dirname, 'app/src/main/java/br/streamtv/app/AnimeSource.java'),
        path.join(__dirname, 'test/br/streamtv/app/AnimeSourceTest.java')], { encoding: 'utf8', windowsHide: true });
    assert.equal(compiled.status, 0, compiled.stderr || String(compiled.error || 'compilation failed'));
});
after(() => {
    if (!classes) return;
    assert.equal(path.dirname(path.resolve(classes)), path.resolve(os.tmpdir()));
    assert.match(path.basename(classes), /^conecta-anime-test-/);
    fs.rmSync(classes, { recursive: true, force: true });
});
for (const [scenario, title] of [
    ['validation', 'Android Anime aceita somente pedido TV válido e áudio conhecido'],
    ['isolation', 'Android Anime preserva fontes de filmes, dramas e dublados'],
    ['one-piece', 'Android Anime conserva episódio absoluto validado de One Piece'],
    ['solo', 'Android Anime adapta temporadas do fornecedor ao TMDB sem trocar o episódio'],
    ['allowlist', 'Android Anime aceita apenas player público Blogger autorizado'],
    ['deadline', 'Android Anime limita o orçamento total de consultas'],
    ['not-found', 'Android Anime recusa episódio não confirmado ou vídeo indisponível'],
]) test(title, { skip: !available }, () => {
    const result = spawnSync(executable('java'), ['-cp', classes, 'br.streamtv.app.AnimeSourceTest', scenario], { encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 0, result.stderr || String(result.error || 'JVM test failed'));
});
