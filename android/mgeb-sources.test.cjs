const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// Executa o seletor Java usado pelo aparelho; não duplica sua lógica em JS.
const executable = name => process.env.JAVA_HOME
    ? path.join(process.env.JAVA_HOME, 'bin', name + (process.platform === 'win32' ? '.exe' : ''))
    : name;
const javac = executable('javac');
const java = executable('java');
const available = spawnSync(javac, ['-version'], { encoding: 'utf8', windowsHide: true }).status === 0;
let classes;
before(() => {
    if (!available) return;
    classes = fs.mkdtempSync(path.join(os.tmpdir(), 'conecta-mgeb-test-'));
    const compiled = spawnSync(javac, ['-encoding', 'UTF-8', '--release', '8', '-d', classes,
        path.join(__dirname, 'app/src/main/java/br/streamtv/app/MgebSources.java'),
        path.join(__dirname, 'test/br/streamtv/app/MgebSourcesTest.java')], { encoding: 'utf8', windowsHide: true });
    assert.equal(compiled.status, 0, compiled.stderr || String(compiled.error || 'compilation failed'));
});
after(() => {
    if (!classes) return;
    const resolved = path.resolve(classes);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.match(path.basename(resolved), /^conecta-mgeb-test-/);
    fs.rmSync(resolved, { recursive: true, force: true });
});

for (const [scenario, title] of [
    ['quality', 'Android MGEB prioriza resolução declarada e MP4 no empate'],
    ['legacy', 'Android MGEB conserva MP4 preferido quando não há declaração de altura'],
    ['normalization', 'Android MGEB normaliza o endereço sem alterar a query assinada'],
    ['fallback', 'Android MGEB tenta HLS quando a opção MP4 falha'],
    ['budget', 'Android MGEB limita a três opções distintas'],
    ['success', 'Android MGEB encerra tentativas após a primeira opção funcionar'],
]) {
    test(title, { skip: !available }, () => {
        const result = spawnSync(java, ['-cp', classes, 'br.streamtv.app.MgebSourcesTest', scenario], { encoding: 'utf8', windowsHide: true });
        assert.equal(result.status, 0, result.stderr || String(result.error || 'JVM test failed'));
    });
}
