(function () {
  const PERFIL_KEY = 'streamtv-gosto';
  const PERFIL_VALIDADE = 7 * 24 * 60 * 60 * 1000;
  let configPromise;

  function lerLista(chave) {
    try { const dados = JSON.parse(localStorage.getItem(chave) || '[]'); return Array.isArray(dados) ? dados : []; } catch { return []; }
  }

  // Aprende com o que a pessoa já assistiu e com as buscas dela.
  async function montarPerfil(forcar) {
    try {
      const salvo = JSON.parse(localStorage.getItem(PERFIL_KEY) || 'null');
      if (salvo && !forcar && Date.now() - salvo.em < PERFIL_VALIDADE && salvo.titulos >= 3) return salvo;
    } catch { /* perfil recalculado */ }
    const vistos = lerLista('streamtv-progress').slice(0, 12);
    const buscas = lerLista('streamtv-searches').slice(0, 10).filter(x => typeof x === 'string');
    if (!vistos.length) return null;
    const config = await loadConfig();
    const generos = {};
    let somaAno = 0, comAno = 0;
    await Promise.all(vistos.map(async filme => {
      try {
        const resposta = await fetch(`https://api.themoviedb.org/3/movie/${filme.id}?api_key=${encodeURIComponent(config.tmdbKey || '')}&language=pt-BR`, { cache: 'force-cache' });
        if (!resposta.ok) return;
        const dados = await resposta.json();
        (dados.genres || []).forEach(g => { generos[g.name] = (generos[g.name] || 0) + 1; });
        const ano = Number(String(dados.release_date || '').slice(0, 4));
        if (ano) { somaAno += ano; comAno++; }
      } catch { /* título sem detalhe não entra no perfil */ }
    }));
    const perfil = {
      em: Date.now(),
      titulos: vistos.length,
      generos: Object.entries(generos).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([nome, quantos]) => ({ nome, quantos })),
      anoMedio: comAno ? Math.round(somaAno / comAno) : null,
      buscas,
      vistos: vistos.map(f => f.titulo).filter(Boolean).slice(0, 12)
    };
    try { localStorage.setItem(PERFIL_KEY, JSON.stringify(perfil)); } catch { /* sem armazenamento */ }
    return perfil;
  }

  function textoDoPerfil(perfil) {
    if (!perfil || !perfil.titulos) return '';
    const partes = [];
    if (perfil.vistos?.length) partes.push('já assistiu: ' + perfil.vistos.join('; '));
    if (perfil.generos?.length) partes.push('gêneros preferidos: ' + perfil.generos.map(g => g.nome).join(', '));
    if (perfil.anoMedio) partes.push('época preferida: por volta de ' + perfil.anoMedio);
    if (perfil.buscas?.length) partes.push('buscas recentes: ' + perfil.buscas.slice(0, 5).join(', '));
    return 'Perfil de quem está pedindo (' + perfil.titulos + ' títulos no histórico) — ' + partes.join('. ') + '. Use isso para recomendar parecidos, na mesma linha do que já assistiu, e evite repetir títulos já vistos.';
  }

  function mostrarPerfil(perfil) {
    const nota = document.getElementById('jarvis-perfil');
    if (!nota) return;
    if (!perfil || !perfil.titulos) { nota.textContent = 'O Jarvis vai aprender seu gosto conforme você assiste — nada é enviado além das suas perguntas.'; return; }
    const generos = perfil.generos?.map(g => g.nome).slice(0, 3).join(', ') || 'ainda juntando';
    nota.textContent = 'Aprendendo com ' + perfil.titulos + ' títulos do seu histórico · ' + generos;
  }

  function setStatus(message, error) {
    const node = document.getElementById('jarvis-status');
    if (node) { node.textContent = message || ''; node.classList.toggle('jarvis-error', Boolean(error)); }
  }

  function loadConfig() {
    if (!configPromise) configPromise = fetch('/config.json', { cache: 'no-store' }).then(r => (r.ok ? r.json() : {})).catch(() => ({}));
    return configPromise;
  }

  // Tanto o computador quanto o Android usam o servidor; nunca a chave do provedor.
  async function perguntarAoServidor(prompt) {
    const config = await loadConfig();
    let origem = '';
    if (config.app === 'android') {
      if (!config.jarvisServer) throw new Error('Configure o servidor do Jarvis para usar o assistente neste aparelho.');
      const url = new URL(config.jarvisServer);
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Endereço do Jarvis inválido.');
      origem = url.origin;
    }
    const tokenKey = 'streamtv-jarvis-acesso:' + origem;
    let token = '';
    try { token = sessionStorage.getItem(tokenKey) || ''; } catch { /* sem armazenamento */ }
    const pedir = () => fetch(origem + '/api/jarvis', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { 'X-Acesso': token } : {}) }, body: JSON.stringify({ prompt }) });
    let response = await pedir();
    if (response.status === 401 && origem) {
      const codigo = window.prompt('Informe o código de acesso ao servidor do Jarvis:');
      if (!codigo) throw new Error('É necessário entrar no servidor para usar o Jarvis.');
      const entrada = await fetch(origem + '/api/entrar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ codigo, nome: 'Jarvis Android', aparelho: 'Android' }) });
      const dados = await entrada.json().catch(() => ({}));
      if (!entrada.ok) throw new Error(dados.error || 'Não foi possível entrar no servidor.');
      token = dados.token || '';
      try { sessionStorage.setItem(tokenKey, token); } catch { /* válido nesta pergunta */ }
      response = await pedir();
    }
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
      const perfil = await montarPerfil().catch(() => null);
      mostrarPerfil(perfil);
      const contexto = textoDoPerfil(perfil);
      const pergunta = contexto ? `${prompt}\n\n${contexto}` : prompt;
      const answer = await perguntarAoServidor(pergunta);
      document.getElementById('jarvis-answer').textContent = answer;
      setStatus('');
    } catch (error) { setStatus(error.message || 'Jarvis indisponível.', true); }
    finally { button.disabled = false; }
  }

  function open() {
    const dialog = document.getElementById('jarvis-dialog');
    if (dialog?.showModal) dialog.showModal(); else dialog?.removeAttribute('hidden');
    document.getElementById('jarvis-prompt')?.focus();
    montarPerfil().then(mostrarPerfil).catch(() => {});
  }

  function close() {
    const dialog = document.getElementById('jarvis-dialog');
    if (dialog?.open) dialog.close(); else dialog?.setAttribute('hidden', '');
  }

  window.StreamJarvis = { open, perfil: montarPerfil };
  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('jarvis-open')?.addEventListener('click', open);
    document.getElementById('jarvis-close')?.addEventListener('click', close);
    document.getElementById('jarvis-ask')?.addEventListener('click', ask);
    document.getElementById('jarvis-dialog')?.addEventListener('click', event => { if (event.target.id === 'jarvis-dialog') close(); });
  });
})();
