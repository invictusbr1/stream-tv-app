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
    return { progress: read('streamtv-progress').slice(0, 100), searches: read('streamtv-searches').slice(0, 100) };
  }

  async function restoreAndSync(session) {
    if (!session?.access_token) return;
    const cloud = session.user?.user_metadata?.streamtv;
    const local = localData();
    if ((!local.progress.length && !local.searches.length) && cloud) {
      try {
        localStorage.setItem('streamtv-progress', JSON.stringify(Array.isArray(cloud.progress) ? cloud.progress : []));
        localStorage.setItem('streamtv-searches', JSON.stringify(Array.isArray(cloud.searches) ? cloud.searches : []));
        window.StreamPersonal?.render(); window.StreamPersonal?.renderSearch();
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
    } catch { /* a reprodução continua mesmo quando a sincronização não está disponível */ }
  }

  function setStatus(message, error) {
    const node = document.getElementById('account-status');
    if (node) { node.textContent = message || ''; node.classList.toggle('account-error', Boolean(error)); }
  }

  function updateUi(session = readSession()) {
    const button = document.getElementById('account-open');
    if (button) button.textContent = session?.user?.email ? 'Minha conta' : 'Entrar';
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

  window.StreamAuth = { readSession, getAccessToken: () => readSession()?.access_token || null, signOut, sync: syncCloud, open: openDialog };
  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('account-open')?.addEventListener('click', openDialog);
    document.getElementById('account-close')?.addEventListener('click', closeDialog);
    document.getElementById('account-submit')?.addEventListener('click', () => submit('signin'));
    document.getElementById('account-signup')?.addEventListener('click', () => submit('signup'));
    document.getElementById('account-signout')?.addEventListener('click', async () => { await signOut(); setStatus('Você saiu da conta.'); });
    document.getElementById('account-dialog')?.addEventListener('click', event => { if (event.target.id === 'account-dialog') closeDialog(); });
    updateUi();
    window.setInterval(syncCloud, 30000);
  });
})();
