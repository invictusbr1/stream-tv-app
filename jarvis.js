(function () {
  const MODELOS_GROQ = ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'qwen/qwen3.8-27b', 'llama-3.3-70b-versatile'];
  const INSTRUCAO = 'Você é o Jarvis do Stream TV. Responda em português, seja direto e nunca prometa que uma fonte funciona.';
  let configPromise;

  function setStatus(message, error) {
    const node = document.getElementById('jarvis-status');
    if (node) { node.textContent = message || ''; node.classList.toggle('jarvis-error', Boolean(error)); }
  }

  function loadConfig() {
    if (!configPromise) configPromise = fetch('/config.json', { cache: 'no-store' }).then(r => (r.ok ? r.json() : {})).catch(() => ({}));
    return configPromise;
  }

  // No aparelho: pergunta direto ao provedor, sem servidor no meio.
  async function perguntarAoProvedor(chave, prompt) {
    let ultimoErro = null;
    for (const model of MODELOS_GROQ) {
      try {
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${chave}` },
          body: JSON.stringify({ model, temperature: 0.6, max_tokens: 900, messages: [{ role: 'system', content: INSTRUCAO }, { role: 'user', content: prompt }] })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) { ultimoErro = new Error(data.error?.message || 'Jarvis indisponível.'); continue; }
        const answer = data.choices?.[0]?.message?.content?.trim();
        if (answer) return answer;
      } catch (error) { ultimoErro = error; }
    }
    throw ultimoErro || new Error('Jarvis indisponível.');
  }

  // No computador: o servidor local guarda a chave e responde por /api/jarvis.
  async function perguntarAoServidor(prompt) {
    const response = await fetch('/api/jarvis', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Jarvis indisponível.');
    return data.answer || 'Não encontrei uma resposta.';
  }

  async function ask() {
    const input = document.getElementById('jarvis-prompt');
    const button = document.getElementById('jarvis-ask');
    const prompt = input?.value.trim();
    if (!prompt) return setStatus('Escreva uma pergunta para o Jarvis.', true);
    button.disabled = true; setStatus('Jarvis está pensando…');
    try {
      const config = await loadConfig();
      const answer = config.groqKey ? await perguntarAoProvedor(config.groqKey, prompt) : await perguntarAoServidor(prompt);
      document.getElementById('jarvis-answer').textContent = answer;
      setStatus('');
    } catch (error) { setStatus(error.message || 'Jarvis indisponível.', true); }
    finally { button.disabled = false; }
  }

  function open() {
    const dialog = document.getElementById('jarvis-dialog');
    if (dialog?.showModal) dialog.showModal(); else dialog?.removeAttribute('hidden');
    document.getElementById('jarvis-prompt')?.focus();
  }

  function close() {
    const dialog = document.getElementById('jarvis-dialog');
    if (dialog?.open) dialog.close(); else dialog?.setAttribute('hidden', '');
  }

  window.StreamJarvis = { open };
  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('jarvis-open')?.addEventListener('click', open);
    document.getElementById('jarvis-close')?.addEventListener('click', close);
    document.getElementById('jarvis-ask')?.addEventListener('click', ask);
    document.getElementById('jarvis-dialog')?.addEventListener('click', event => { if (event.target.id === 'jarvis-dialog') close(); });
  });
})();
