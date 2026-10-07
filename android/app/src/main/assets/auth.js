(function () {
  const STORAGE_KEY = 'streamtv-auth-session';
  let configPromise;

  function loadConfig() {
    return configPromise || (configPromise = fetch('/config.json', { cache: 'no-store' }).then(r => r.ok ? r.json() : {}).catch(() => ({})));
  }

  function readSession() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch { return null; }
  }

  function writeSession(session) {
    if (session) localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    else localStorage.removeItem(STORAGE_KEY);
    updateUi(session);
  }

  async function request(path, options) {
    const config = await loadConfig();
    if (!config.supabaseUrl || !config.supabaseAnonKey) throw new Error('LOGIN_NAO_CONFIGURADO');
    const headers = Object.assign({ apikey: config.supabaseAnonKey, 'Content-Type': 'application/json' }, options?.headers || {});
    const session = readSession();
    if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
    const response = await fetch(`${config.supabaseUrl.replace(/\/$/, '')}${path}`, Object.assign({}, options, { headers }));
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error_description || data.msg || data.message || 'Não foi possível concluir o acesso.');
    return data;
  }

  async function signIn(email, password) {
    const data = await request('/auth/v1/token?grant_type=password', { method: 'POST', body: JSON.stringify({ email, password }) });
    writeSession(data); await restoreAndSync(data); return data;
  }

  async function signUp(email, password) {
    const data = await request('/auth/v1/signup', { method: 'POST', body: JSON.stringify({ email, password }) });
    if (data.access_token) { writeSession(data); await restoreAndSync(data); }
    return data;
  }

  async function signOut() {
    try { if (readSession()?.access_token) await request('/auth/v1/logout', { method: 'POST' }); } catch { /* sessão local ainda pode ser removida */ }
    writeSession(null);
  }

  function localData() {
    const read = key => { try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch { return []; } };
    return {
      progress: read('streamtv-progress').slice(0, 100),
      searches: read('streamtv-searches').slice(0, 100),
      favoritos: read('streamtv-favoritos').slice(0, 300),
      assistidos: read('streamtv-assistidos').slice(0, 800),
      dispositivos: atualizarMeuDispositivo()
    };
  }

  // ---------------------------------------------------------------
  // Dispositivos conectados: cada aparelho se identifica, informa o que
  // está assistindo e pode encerrar a sessão de outro.
  // ---------------------------------------------------------------
  const DEVICE_KEY = 'streamtv-dispositivo';
  let alarmePublicacao = null;

  function deviceInfo() {
    let id = null;
    try { id = localStorage.getItem(DEVICE_KEY); } catch { /* aparelho sem armazenamento */ }
    if (!id) {
      id = 'd' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
      try { localStorage.setItem(DEVICE_KEY, id); } catch { /* segue com identificador temporário */ }
    }
    const ua = navigator.userAgent || '';
    const tipo = /AndroidTV|Leanback|BRAVIA|MiBOX|FireTV|GoogleTV|SMART-TV/i.test(ua) ? 'tv'
      : /iPhone|iPad|iPod/i.test(ua) ? 'celular'
      : /Android/i.test(ua) ? 'celular'
      : /Windows|Macintosh|Linux|CrOS/i.test(ua) ? 'computador'
      : 'outro';
    const nome = tipo === 'tv' ? 'TV ou TV box'
      : /iPhone|iPad|iPod/i.test(ua) ? 'iPhone / iPad'
      : /Android/i.test(ua) ? 'Celular Android'
      : tipo === 'computador' ? 'Computador'
      : 'Aparelho';
    return { id, nome, tipo };
  }

  function lerDispositivos() {
    try { return JSON.parse(localStorage.getItem('streamtv-dispositivos') || '{}') || {}; } catch { return {}; }
  }

  function gravarDispositivos(lista) {
    try { localStorage.setItem('streamtv-dispositivos', JSON.stringify(lista)); } catch { /* sem armazenamento */ }
  }

  function atualizarMeuDispositivo(extra) {
    const eu = deviceInfo();
    const lista = lerDispositivos();
    const anterior = lista[eu.id] || {};
    lista[eu.id] = Object.assign({}, anterior, eu, { visto: new Date().toISOString(), removido: false }, extra || {});
    gravarDispositivos(lista);
    return lista;
  }

  function fundirDispositivos(remotos) {
    const lista = lerDispositivos();
    const eu = deviceInfo().id;
    let removido = false;
    for (const [id, dados] of Object.entries(remotos || {})) {
      if (!dados || typeof dados !== 'object') continue;
      if (id === eu) {
        if (dados.removido === true) removido = true;
        continue;
      }
      const anterior = lista[id];
      if (!anterior || String(dados.visto || '') > String(anterior.visto || '')) lista[id] = dados;
    }
    gravarDispositivos(lista);
    return removido;
  }

  function publicarAssistindo(filme, posicao) {
    if (!filme || !filme.id) return;
    const atual = {
      titulo: filme.titulo || filme.name || 'Sem título',
      id: filme.id,
      posicao: Math.max(0, Math.round(Number(posicao) || 0)),
      em: new Date().toISOString()
    };
    atualizarMeuDispositivo({ atual });
    if (alarmePublicacao) return;
    alarmePublicacao = setTimeout(() => { alarmePublicacao = null; syncCloud().catch(() => {}); }, 20000);
  }

  function listarDispositivos() {
    const eu = deviceInfo().id;
    return Object.entries(lerDispositivos())
      .map(([id, dados]) => Object.assign({ id, eu: id === eu }, dados))
      .sort((a, b) => String(b.visto || '').localeCompare(String(a.visto || '')));
  }

  async function encerrarDispositivo(id) {
    const lista = lerDispositivos();
    if (!lista[id] || id === deviceInfo().id) return;
    lista[id] = Object.assign({}, lista[id], { removido: true, atual: null });
    gravarDispositivos(lista);
    await syncCloud();
  }

  async function encerrarOutros() {
    const eu = deviceInfo().id;
    const lista = lerDispositivos();
    for (const [id, dados] of Object.entries(lista)) {
      if (id !== eu) lista[id] = Object.assign({}, dados, { removido: true, atual: null });
    }
    gravarDispositivos(lista);
    await syncCloud();
  }

  function tempoRelativo(iso) {
    const segundos = Math.max(0, Math.round((Date.now() - new Date(iso || 0).getTime()) / 1000));
    if (!iso || segundos < 60) return 'agora mesmo';
    if (segundos < 3600) return `há ${Math.round(segundos / 60)} min`;
    if (segundos < 86400) return `há ${Math.round(segundos / 3600)} h`;
    return `há ${Math.round(segundos / 86400)} dia(s)`;
  }

  function relogio(segundos) {
    const total = Math.max(0, Math.round(Number(segundos) || 0));
    return Math.floor(total / 60) + ':' + String(total % 60).padStart(2, '0');
  }

  function montarPainel() {
    if (document.getElementById('devices-dialog')) return;
    const dialogo = document.createElement('dialog');
    dialogo.id = 'devices-dialog';
    dialogo.className = 'account-dialog';
    dialogo.setAttribute('aria-labelledby', 'devices-title');
    dialogo.innerHTML = '<div class="account-head"><h2 id="devices-title">Dispositivos conectados</h2><button class="icon-btn" id="devices-close" aria-label="Fechar">×</button></div><p class="account-note">Aparelhos ligados na sua conta. O aplicativo mostra o que cada um está assistindo e permite encerrar a sessão à distância.</p><div id="devices-list" class="devices-list"></div><div class="account-actions"><button class="quiet" id="devices-clear" type="button">Encerrar as outras sessões</button></div><p id="devices-status" class="account-status" role="status" aria-live="polite"></p>';
    document.body.append(dialogo);
    document.getElementById('devices-close').onclick = () => dialogo.close();
    document.getElementById('devices-clear').onclick = async () => {
      document.getElementById('devices-status').textContent = 'Encerrando as outras sessões…';
      try { await encerrarOutros(); document.getElementById('devices-status').textContent = 'As outras sessões foram encerradas.'; }
      catch { document.getElementById('devices-status').textContent = 'Não foi possível encerrar agora.'; }
      renderDispositivos();
    };
    dialogo.addEventListener('click', evento => { if (evento.target === dialogo) dialogo.close(); });
  }

  function renderDispositivos() {
    const caixa = document.getElementById('devices-list');
    if (!caixa) return;
    const icones = { tv: '📺', celular: '📱', computador: '💻', outro: '🎬' };
    const lista = listarDispositivos();
    caixa.replaceChildren();
    if (!lista.length) { caixa.textContent = 'Nenhum aparelho registrado ainda. Este é o primeiro.'; return; }
    for (const aparelho of lista) {
      const linha = document.createElement('div');
      linha.className = 'device-row';
      const icone = document.createElement('span');
      icone.className = 'device-icon';
      icone.textContent = icones[aparelho.tipo] || icones.outro;
      const texto = document.createElement('div');
      texto.className = 'device-text';
      const nome = document.createElement('strong');
      nome.textContent = aparelho.nome + (aparelho.eu ? ' (este aparelho)' : '');
      const detalhe = document.createElement('small');
      const assistindo = aparelho.atual && aparelho.atual.titulo
        ? `assistindo ${aparelho.atual.titulo}${aparelho.atual.posicao ? ' · ' + relogio(aparelho.atual.posicao) : ''}`
        : 'sem reprodução agora';
      detalhe.textContent = `${assistindo} · visto ${tempoRelativo(aparelho.visto)}${aparelho.removido ? ' · sessão encerrada' : ''}`;
      texto.append(nome, detalhe);
      linha.append(icone, texto);
      if (!aparelho.eu) {
        const botao = document.createElement('button');
        botao.className = 'quiet';
        botao.textContent = aparelho.removido ? 'Encerrado' : 'Encerrar';
        botao.disabled = Boolean(aparelho.removido);
        botao.onclick = async () => {
          botao.disabled = true;
          await encerrarDispositivo(aparelho.id).catch(() => {});
          renderDispositivos();
        };
        linha.append(botao);
      }
      caixa.append(linha);
    }
  }

  function abrirPainel() {
    montarPainel();
    renderDispositivos();
    const dialogo = document.getElementById('devices-dialog');
    if (dialogo?.showModal) dialogo.showModal(); else dialogo?.removeAttribute('hidden');
  }

  async function restoreAndSync(session) {
    if (!session?.access_token) return;
    const cloud = session.user?.user_metadata?.streamtv;
    const local = localData();
    if ((!local.progress.length && !local.searches.length && !(local.favoritos || []).length) && cloud) {
      try {
        localStorage.setItem('streamtv-progress', JSON.stringify(Array.isArray(cloud.progress) ? cloud.progress : []));
        localStorage.setItem('streamtv-searches', JSON.stringify(Array.isArray(cloud.searches) ? cloud.searches : []));
        localStorage.setItem('streamtv-favoritos', JSON.stringify(Array.isArray(cloud.favoritos) ? cloud.favoritos : []));
        localStorage.setItem('streamtv-assistidos', JSON.stringify(Array.isArray(cloud.assistidos) ? cloud.assistidos : []));
        window.StreamPersonal?.render(); window.StreamPersonal?.renderSearch(); window.StreamPersonal?.renderFavoritos?.();
      } catch { /* armazenamento local pode estar indisponível */ }
    }
    await syncCloud();
  }

  async function syncCloud() {
    const session = readSession();
    if (!session?.access_token) return;
    const data = localData();
    try {
      const updated = await request('/auth/v1/user', { method: 'PUT', body: JSON.stringify({ data: { streamtv: data } }) });
      const next = Object.assign({}, session, { user: updated });
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      const removido = fundirDispositivos(updated?.user_metadata?.streamtv?.dispositivos);
      if (removido) await encerrarSessaoRemota();
    } catch { /* a reprodução continua mesmo quando a sincronização não está disponível */ }
  }

  function avisar(mensagem) {
    let caixa = document.getElementById('aviso-geral');
    if (!caixa) {
      caixa = document.createElement('div');
      caixa.id = 'aviso-geral';
      caixa.className = 'toast';
      document.body.append(caixa);
    }
    caixa.textContent = '';
    const texto = document.createElement('strong');
    texto.textContent = mensagem;
    caixa.append(texto);
    caixa.hidden = false;
    setTimeout(() => { caixa.hidden = true; }, 9000);
  }

  async function encerrarSessaoRemota() {
    try { await request('/auth/v1/logout', { method: 'POST' }); } catch { /* sessão local encerrada de qualquer forma */ }
    writeSession(null);
    avisar('Sua sessão foi encerrada em outro aparelho.');
  }

  function setStatus(message, error) {
    const node = document.getElementById('account-status');
    if (node) { node.textContent = message || ''; node.classList.toggle('account-error', Boolean(error)); }
  }

  function updateUi(session = readSession()) {
    const button = document.getElementById('account-open');
    if (button) button.textContent = session?.user?.email ? 'Minha conta' : 'Entrar';
    const atalho = document.getElementById('devices-open');
    if (atalho) atalho.hidden = !session?.user?.email;
    const signed = document.getElementById('account-signed');
    const form = document.getElementById('account-form');
    const email = document.getElementById('account-email');
    if (signed) signed.hidden = !session?.user?.email;
    if (form) form.hidden = Boolean(session?.user?.email);
    if (email && session?.user?.email) email.value = session.user.email;
  }

  function openDialog() {
    const dialog = document.getElementById('account-dialog');
    if (dialog?.showModal) dialog.showModal(); else dialog?.removeAttribute('hidden');
    updateUi();
    setStatus('');
    document.getElementById('account-email')?.focus();
  }

  function closeDialog() {
    const dialog = document.getElementById('account-dialog');
    if (dialog?.open) dialog.close(); else dialog?.setAttribute('hidden', '');
  }

  async function submit(mode) {
    const email = document.getElementById('account-email')?.value.trim();
    const password = document.getElementById('account-password')?.value;
    if (!email || !password) return setStatus('Informe e-mail e senha.', true);
    const button = document.getElementById('account-submit');
    if (button) button.disabled = true;
    setStatus(mode === 'signup' ? 'Criando sua conta…' : 'Entrando…');
    try {
      const data = mode === 'signup' ? await signUp(email, password) : await signIn(email, password);
      setStatus(mode === 'signup' && !data.access_token ? 'Conta criada. Confirme o e-mail para entrar.' : 'Acesso realizado.');
      if (data.access_token) document.getElementById('account-password').value = '';
      window.dispatchEvent(new CustomEvent('streamtv-auth-changed', { detail: readSession() }));
    } catch (error) {
      setStatus(error.message === 'LOGIN_NAO_CONFIGURADO' ? 'Login será ativado quando o Supabase for configurado no servidor.' : error.message, true);
    } finally { if (button) button.disabled = false; }
  }

  // Atalho de dispositivos no topo e dentro da conta
  function garantirAtalhos() {
    const acoes = document.querySelector('.acoes');
    if (acoes && !document.getElementById('devices-open')) {
      const botao = document.createElement('button');
      botao.id = 'devices-open';
      botao.className = 'icon-btn';
      botao.hidden = true;
      botao.type = 'button';
      botao.title = 'Dispositivos conectados';
      botao.setAttribute('aria-label', 'Dispositivos conectados');
      botao.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="4.5" width="12" height="9" rx="1.6"></rect><path d="M6.5 19.5h5"></path><rect x="16.5" y="9" width="5" height="10.5" rx="1.4"></rect></svg>';
      botao.onclick = abrirPainel;
      acoes.insertBefore(botao, document.getElementById('account-open'));
    }
    const acoesConta = document.querySelector('#account-signed .account-actions');
    if (acoesConta && !document.getElementById('account-devices')) {
      const link = document.createElement('button');
      link.id = 'account-devices';
      link.className = 'quiet';
      link.type = 'button';
      link.textContent = 'Dispositivos conectados';
      link.onclick = () => { document.getElementById('account-dialog')?.close(); abrirPainel(); };
      acoesConta.append(link);
    }
  }

  window.StreamAuth = {
    readSession,
    getAccessToken: () => readSession()?.access_token || null,
    signOut,
    sync: syncCloud,
    open: openDialog,
    dispositivos: listarDispositivos,
    abrirDispositivos: abrirPainel,
    encerrarDispositivo,
    publicarAssistindo
  };
  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('account-open')?.addEventListener('click', openDialog);
    document.getElementById('account-close')?.addEventListener('click', closeDialog);
    document.getElementById('account-submit')?.addEventListener('click', () => submit('signin'));
    document.getElementById('account-signup')?.addEventListener('click', () => submit('signup'));
    document.getElementById('account-signout')?.addEventListener('click', async () => { await signOut(); setStatus('Você saiu da conta.'); });
    document.getElementById('account-dialog')?.addEventListener('click', event => { if (event.target.id === 'account-dialog') closeDialog(); });
    garantirAtalhos();
    updateUi();
    window.setInterval(syncCloud, 30000);
  });
})();
