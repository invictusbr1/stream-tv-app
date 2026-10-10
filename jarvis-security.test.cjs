const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

async function ask(config, replies = []) {
  const calls = [], listeners = {}, stored = new Map();
  const nodes = {
    'jarvis-prompt': { value: 'Recomende um filme' },
    'jarvis-ask': { addEventListener: (_, fn) => { listeners.ask = fn; } },
    'jarvis-answer': {}, 'jarvis-status': { classList: { toggle() {} } }
  };
  const context = {
    URL, Date, console,
    window: { prompt: () => 'codigo-de-teste' },
    document: { getElementById: id => nodes[id], addEventListener: (_, fn) => fn() },
    localStorage: { getItem: () => null },
    sessionStorage: { getItem: k => stored.get(k), setItem: (k, v) => stored.set(k, v) },
    fetch: async (url, options) => {
      calls.push({ url, options });
      if (url === '/config.json') return { ok: true, json: async () => config };
      const next = replies.shift() || { status: 200, answer: 'Resposta' };
      return { ok: next.status < 400, status: next.status, json: async () => next };
    }
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('./jarvis.js'), 'utf8'), context);
  await listeners.ask();
  return { calls, nodes };
}

test('desktop ignores a legacy provider key and uses the server', async () => {
  const { calls, nodes } = await ask({ app: 'desktop', groqKey: 'legacy-secret' });
  assert.equal(calls[1].url, '/api/jarvis');
  assert.equal(nodes['jarvis-answer'].textContent, 'Resposta');
  assert.ok(!JSON.stringify(calls).includes('legacy-secret'));
});
test('Android uses the configured HTTPS server without a provider key', async () => {
  const { calls } = await ask({ app: 'android', jarvisServer: 'https://jarvis.example', groqKey: 'legacy-secret' });
  assert.equal(calls[1].url, 'https://jarvis.example/api/jarvis');
  assert.ok(!JSON.stringify(calls).includes('legacy-secret'));
});
test('Android without a server makes no AI request', async () => {
  const { calls, nodes } = await ask({ app: 'android', groqKey: 'legacy-secret' });
  assert.equal(calls.length, 1);
  assert.match(nodes['jarvis-status'].textContent, /Configure o servidor/);
});
test('Android rejects insecure origins and URLs containing credentials', async () => {
  for (const jarvisServer of ['http://jarvis.example', 'https://user:pass@jarvis.example', 'https://jarvis.example?key=secret']) {
    const { calls, nodes } = await ask({ app: 'android', jarvisServer });
    assert.equal(calls.length, 1);
    assert.match(nodes['jarvis-status'].textContent, /inválido/);
  }
});
test('Android authenticates after 401 and retries with the server token', async () => {
  const { calls, nodes } = await ask({ app: 'android', jarvisServer: 'https://jarvis.example' }, [
    { status: 401 }, { status: 200, token: 'device-token' }, { status: 200, answer: 'Autorizado' }
  ]);
  assert.equal(calls[2].url, 'https://jarvis.example/api/entrar');
  assert.equal(calls[3].options.headers['X-Acesso'], 'device-token');
  assert.equal(nodes['jarvis-answer'].textContent, 'Autorizado');
});
