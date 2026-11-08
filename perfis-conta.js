// Perfis "Quem está assistindo?" do Conecta TV.
//
// Uma conta (ou um aparelho sem conta) tem até 5 perfis, cada um com nome,
// avatar e os próprios dados: continuar assistindo, favoritos, assistidos e
// buscas. Funciona primeiro no aparelho; com a conta conectada, os perfis vão
// para o Supabase (tabela perfis_conta, protegida por RLS) e aparecem em todos
// os aparelhos da família.
//
// Como os dados ficam separados sem mexer no resto do aplicativo: o perfil
// ATIVO usa as chaves de sempre do localStorage (streamtv-progress etc.). Ao
// trocar de perfil, os dados do atual são guardados em
// "streamtv-perfil-dados:<id>" e os do escolhido voltam para as chaves de sempre.
(function () {
  const CHAVE = 'streamtv-perfis';
  const PREFIXO = 'streamtv-perfil-dados:';
  const DADOS = ['streamtv-progress', 'streamtv-favoritos', 'streamtv-assistidos', 'streamtv-searches'];
  const MAX = 5;
  const NOME_MAX = 20;
  const A = () => window.StreamAvatares;

  // ------------------------------------------------------------ armazenamento
  const ler = (chave, padrao) => { try { const v = JSON.parse(localStorage.getItem(chave) || 'null'); return v ?? padrao; } catch { return padrao; } };
  const gravar = (chave, valor) => { try { localStorage.setItem(chave, JSON.stringify(valor)); } catch { /* aparelho sem armazenamento */ } };
  const apagar = chave => { try { localStorage.removeItem(chave); } catch { /* idem */ } };
  const novoId = () => (window.crypto && crypto.randomUUID) ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); });
  const limparNome = nome => String(nome || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, NOME_MAX);
  const resumo = texto => { let h = 0; for (let i = 0; i < texto.length; i++) h = (h * 31 + texto.charCodeAt(i)) | 0; return String(h); };

  let estado = ler(CHAVE, null);
  function salvarEstado() { gravar(CHAVE, estado); }

  function garantir() {
    if (!estado || !Array.isArray(estado.lista)) estado = { ativo: null, lista: [], enviados: {}, apresentado: false };
    estado.enviados = estado.enviados || {};
    estado.lista = estado.lista.filter(p => p && p.id).slice(0, MAX);
    if (!estado.lista.length) {
      // Primeiro uso: o que já existe no aparelho vira o perfil "Principal".
      estado.lista.push({ id: novoId(), nome: 'Principal', avatar: 'robo', ordem: 0, atualizado: Date.now() });
    }
    if (!estado.lista.some(p => p.id === estado.ativo)) estado.ativo = estado.lista[0].id;
    salvarEstado();
  }

  function dadosAtuais() { const d = {}; for (const k of DADOS) { const v = ler(k, []); d[k] = Array.isArray(v) ? v : []; } return d; }
  function aplicarDados(dados) {
    for (const k of DADOS) gravar(k, Array.isArray(dados?.[k]) ? dados[k] : []);
    const p = window.StreamPersonal;
    try { p?.render?.(); p?.renderSearch?.(); p?.renderFavoritos?.(); } catch { /* telas ainda não montadas */ }
  }
  function dadosDe(id) { return id === estado.ativo ? dadosAtuais() : (ler(PREFIXO + id, null)?.dados || {}); }

  function lista() { garantir(); return estado.lista.slice().sort((a, b) => (a.ordem || 0) - (b.ordem || 0)); }
  function atual() { garantir(); return estado.lista.find(p => p.id === estado.ativo); }

  function trocar(id) {
    garantir();
    const alvo = estado.lista.find(p => p.id === id);
    if (!alvo) return false;
    if (id !== estado.ativo) {
      gravar(PREFIXO + estado.ativo, { dados: dadosAtuais(), atualizado: Date.now() });
      const guardado = ler(PREFIXO + id, null);
      aplicarDados(guardado?.dados || {});
      apagar(PREFIXO + id);
      estado.ativo = id;
      // O resumo do que foi enviado vale para os dados recém-carregados.
      estado.enviados[id] = resumo(JSON.stringify(dadosAtuais()));
    }
    estado.apresentado = true;
    salvarEstado();
    atualizarTopo();
    window.dispatchEvent(new CustomEvent('streamtv-perfil-mudou', { detail: { ...alvo } }));
    nuvem.agendar();
    return true;
  }

  function criar(nome, avatar) {
    garantir();
    if (estado.lista.length >= MAX) throw new Error(`Limite de ${MAX} perfis.`);
    const n = limparNome(nome);
    if (!n) throw new Error('Dê um nome ao perfil.');
    const p = { id: novoId(), nome: n, avatar: A()?.existe(avatar) ? avatar : sugerirAvatar(), ordem: Math.max(0, ...estado.lista.map(x => x.ordem || 0)) + 1, atualizado: Date.now() };
    estado.lista.push(p);
    gravar(PREFIXO + p.id, { dados: {}, atualizado: Date.now() });
    salvarEstado(); nuvem.agendar();
    return p;
  }

  function editar(id, { nome, avatar }) {
    garantir();
    const p = estado.lista.find(x => x.id === id);
    if (!p) return;
    const n = limparNome(nome);
    if (!n) throw new Error('Dê um nome ao perfil.');
    p.nome = n;
    if (A()?.existe(avatar)) p.avatar = avatar;
    p.atualizado = Date.now();
    salvarEstado(); atualizarTopo(); nuvem.agendar();
  }

  function remover(id) {
    garantir();
    if (estado.lista.length <= 1) throw new Error('A conta precisa ter pelo menos um perfil.');
    const p = estado.lista.find(x => x.id === id);
    if (!p) return;
    if (id === estado.ativo) trocar(estado.lista.find(x => x.id !== id).id);
    estado.lista = estado.lista.filter(x => x.id !== id);
    apagar(PREFIXO + id);
    delete estado.enviados[id];
    estado.removidos = [...new Set([...(estado.removidos || []), id])].slice(-20);
    salvarEstado(); nuvem.agendar();
  }

  function sugerirAvatar() {
    const usados = new Set((estado?.lista || []).map(p => p.avatar));
    const livre = (A()?.lista || []).find(a => !usados.has(a.id));
    return livre ? livre.id : 'robo';
  }

  // ------------------------------------------------------------ nuvem (Supabase)
  // Última alteração vence, perfil a perfil. Os dados do perfil ativo contam
  // como alterados quando mudam desde o último envio.
  const nuvem = (() => {
    let config = null, emCurso = null, timer = null, ativa = false;
    async function cfg() { return config || (config = await (window.configConecta?window.configConecta():fetch('/config.json',{cache:'no-store'}).then(r=>r.ok?r.json():{}).catch(()=>({})))); }
    async function rest(caminho, opcoes = {}) {
      const c = await cfg();
      const token = window.StreamAuth?.getAccessToken?.();
      if (!token || !c.supabaseUrl || !c.supabaseAnonKey) return undefined;
      const r = await fetch(`${c.supabaseUrl.replace(/\/$/, '')}/rest/v1/${caminho}`, Object.assign({}, opcoes, {
        headers: Object.assign({ apikey: c.supabaseAnonKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, opcoes.headers || {}),
      }));
      if (!r.ok) throw new Error('perfis: ' + r.status);
      return r.status === 204 || r.status === 201 ? null : r.json();
    }
    function linha(p) {
      return { id: p.id, nome: p.nome, avatar: p.avatar, ordem: p.ordem || 0, dados: dadosDe(p.id), atualizado_em: new Date(p.atualizado || Date.now()).toISOString() };
    }
    async function sincronizar() {
      garantir();
      const remotos = await rest('perfis_conta?select=id,nome,avatar,ordem,dados,atualizado_em&order=ordem.asc');
      if (remotos === undefined) { ativa = false; return false; }
      // Alteração local nos dados do perfil ativo desde o último envio?
      const agoraResumo = resumo(JSON.stringify(dadosAtuais()));
      const ativo = atual();
      if (estado.enviados[ativo.id] !== agoraResumo) ativo.atualizado = Date.now();
      // Apagados em outro aparelho somem daqui (se já tinham ido para a nuvem).
      const ids = new Set(remotos.map(r => r.id));
      const sumiram = estado.lista.filter(p => p.sincronizado && !ids.has(p.id));
      for (const p of sumiram) if (estado.lista.length > 1) { if (p.id === estado.ativo) trocar(estado.lista.find(x => x.id !== p.id).id); estado.lista = estado.lista.filter(x => x.id !== p.id); apagar(PREFIXO + p.id); }
      // Chegando da nuvem.
      for (const r of remotos) {
        if ((estado.removidos || []).includes(r.id)) continue;
        const ts = Date.parse(r.atualizado_em) || 0;
        let p = estado.lista.find(x => x.id === r.id);
        if (!p) {
          if (estado.lista.length >= MAX) continue;
          // Aparelho novo, ainda só com o primeiro perfil vazio e nunca enviado:
          // ele dá lugar aos perfis da conta (em vez de virar um perfil repetido).
          const vazio = estado.lista.length === 1 && !estado.lista[0].sincronizado
            && DADOS.every(k => !(dadosAtuais()[k] || []).length);
          p = { id: r.id, nome: r.nome, avatar: r.avatar, ordem: r.ordem, atualizado: ts, sincronizado: true };
          if (vazio) { estado.lista = [p]; estado.ativo = p.id; aplicarDados(r.dados); estado.enviados[p.id] = resumo(JSON.stringify(dadosAtuais())); }
          else { estado.lista.push(p); gravar(PREFIXO + p.id, { dados: r.dados || {}, atualizado: ts }); }
          continue;
        }
        p.sincronizado = true;
        if (ts > (p.atualizado || 0)) {
          Object.assign(p, { nome: r.nome, avatar: r.avatar, ordem: r.ordem, atualizado: ts });
          if (p.id === estado.ativo) { aplicarDados(r.dados); estado.enviados[p.id] = resumo(JSON.stringify(dadosAtuais())); }
          else gravar(PREFIXO + p.id, { dados: r.dados || {}, atualizado: ts });
        }
      }
      // Indo para a nuvem: perfis novos ou mais recentes aqui.
      const enviar = estado.lista.filter(p => { const r = remotos.find(x => x.id === p.id); return !r || (p.atualizado || 0) > (Date.parse(r.atualizado_em) || 0); });
      if (enviar.length) {
        await rest('perfis_conta?on_conflict=id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(enviar.map(linha)) });
        for (const p of enviar) { p.sincronizado = true; if (p.id === estado.ativo) estado.enviados[p.id] = resumo(JSON.stringify(dadosAtuais())); }
      }
      for (const id of estado.removidos || []) await rest(`perfis_conta?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => {});
      estado.removidos = [];
      salvarEstado(); atualizarTopo();
      ativa = true;
      return remotos.length > 0;
    }
    return {
      sincronizar() { return emCurso || (emCurso = sincronizar().catch(() => false).finally(() => { emCurso = null; })); },
      agendar() { clearTimeout(timer); timer = setTimeout(() => this.sincronizar(), 1500); },
      ativa: () => ativa,
    };
  })();

  // ------------------------------------------------------------ interface
  const CSS = `
  .perfil-topo{display:inline-flex;align-items:center;gap:8px;margin-left:8px;padding:3px;border-radius:12px;border:2px solid transparent;background:none;color:inherit;cursor:pointer}
  .perfil-topo:hover,.perfil-topo:focus-visible{border-color:#ffffff55;outline:none}
  .perfil-topo .perfil-mini{width:32px;height:32px}
  @media(max-width:900px){.perfil-topo{margin-left:auto}}
  .perfil-mini,.perfil-grande{display:block;border-radius:22%;overflow:hidden;flex:0 0 auto}
  .perfil-mini svg,.perfil-grande svg{display:block;width:100%;height:100%}
  #perfis-tela{position:fixed;inset:0;z-index:9000;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:34px;padding:24px;background:radial-gradient(ellipse at top,#1b2130 0%,#0b0d12 70%);color:#f5f6f8;animation:perfisEntrar .25s ease-out}
  #perfis-tela[hidden]{display:none}
  @keyframes perfisEntrar{from{opacity:0;transform:scale(1.03)}to{opacity:1;transform:none}}
  #perfis-tela .perfis-marca{position:absolute;top:22px;left:28px;display:flex;align-items:center;gap:10px;font-weight:800;letter-spacing:.06em}
  #perfis-tela .perfis-marca span{color:#e50924}
  #perfis-tela h1{margin:0;font-size:clamp(26px,4vw,44px);font-weight:600;text-align:center}
  .perfis-grade{display:flex;flex-wrap:wrap;justify-content:center;gap:clamp(16px,3vw,34px);max-width:960px}
  .perfil-cartao{display:flex;flex-direction:column;align-items:center;gap:12px;background:none;border:0;color:#9aa3b2;cursor:pointer;font:inherit;padding:0;width:clamp(96px,14vw,150px)}
  .perfil-cartao .perfil-grande{width:100%;aspect-ratio:1;border:3px solid transparent;transition:transform .15s,border-color .15s}
  .perfil-cartao:hover .perfil-grande,.perfil-cartao:focus-visible .perfil-grande{border-color:#fff;transform:scale(1.06)}
  .perfil-cartao:hover,.perfil-cartao:focus-visible{color:#fff;outline:none}
  .perfil-cartao .perfil-nome{font-size:clamp(14px,1.6vw,18px);max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .perfil-novo .perfil-grande{display:flex;align-items:center;justify-content:center;background:#ffffff0d;border:3px dashed #ffffff33}
  .perfil-novo .perfil-grande svg{width:42%;height:42%}
  .perfis-editando .perfil-cartao .perfil-grande{position:relative}
  .perfis-editando .perfil-cartao .perfil-grande:after{content:"✎";position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:34px;color:#fff;background:#0009}
  .perfis-botao{padding:10px 26px;border-radius:999px;border:1px solid #ffffff55;background:none;color:#cfd5df;font:inherit;letter-spacing:.08em;text-transform:uppercase;font-size:13px;cursor:pointer}
  .perfis-botao:hover,.perfis-botao:focus-visible{border-color:#fff;color:#fff;outline:none}
  .perfis-nuvem{font-size:13px;color:#7d8696;text-align:center;max-width:440px;margin:0}
  #perfil-editor{width:min(560px,94vw);border:1px solid #ffffff1c;border-radius:18px;background:#171b24;color:#f5f6f8;padding:24px;box-shadow:0 20px 80px #000b}
  #perfil-editor::backdrop{background:#000c}
  #perfil-editor h2{margin:0 0 16px;font-size:22px}
  .perfil-editor-topo{display:flex;align-items:center;gap:16px;margin-bottom:16px}
  .perfil-editor-topo .perfil-grande{width:88px;height:88px}
  .perfil-editor-topo label{flex:1;display:flex;flex-direction:column;gap:6px;font-size:13px;color:#9aa3b2}
  .perfil-editor-topo input{font:inherit;font-size:17px;padding:11px 12px;border-radius:10px;border:1px solid #ffffff2a;background:#0f131b;color:#fff}
  .perfil-avatares{display:grid;grid-template-columns:repeat(auto-fill,minmax(58px,1fr));gap:10px;margin:6px 0 18px;max-height:46vh;overflow:auto;padding:4px}
  .perfil-avatares button{padding:0;border:3px solid transparent;border-radius:24%;background:none;cursor:pointer;aspect-ratio:1}
  .perfil-avatares button .perfil-mini{width:100%;height:100%}
  .perfil-avatares button[aria-pressed="true"]{border-color:#fff}
  .perfil-avatares button:focus-visible{border-color:#e50924;outline:none}
  .perfil-editor-acoes{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
  .perfil-editor-acoes .primary{margin-right:auto}
  .perfil-editor-erro{color:#fc8181;min-height:1.2em;margin:0 0 10px;font-size:14px}
  #perfil-menu{position:fixed;z-index:8500;min-width:220px;background:#171b24;border:1px solid #ffffff1c;border-radius:14px;padding:8px;box-shadow:0 16px 50px #000a}
  #perfil-menu[hidden]{display:none}
  #perfil-menu button{display:flex;align-items:center;gap:10px;width:100%;padding:9px 10px;border:0;border-radius:9px;background:none;color:#e2e6ee;font:inherit;text-align:left;cursor:pointer}
  #perfil-menu button:hover,#perfil-menu button:focus-visible{background:#ffffff12;outline:none}
  #perfil-menu .perfil-mini{width:28px;height:28px}
  #perfil-menu hr{border:0;border-top:1px solid #ffffff14;margin:6px 4px}
  `;
  const MAIS = '<svg viewBox="0 0 24 24" fill="none" stroke="#cfd5df" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';

  function el(tag, props = {}, ...filhos) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'html') n.innerHTML = v; else if (k === 'class') n.className = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else if (v !== undefined && v !== null) n.setAttribute(k, v);
    }
    filhos.flat().forEach(f => f != null && n.append(f));
    return n;
  }
  const desenho = (avatar, classe) => el('span', { class: classe, html: A()?.svg(avatar) || '' });

  function montarEstilo() {
    if (document.getElementById('perfis-estilo')) return;
    document.head.append(el('style', { id: 'perfis-estilo', html: CSS }));
  }

  // Botão com o avatar no topo (celular e computador).
  function atualizarTopo() {
    const topo = document.getElementById('topbar');
    if (!topo || !A()) return;
    let botao = document.getElementById('perfil-abrir');
    if (!botao) {
      botao = el('button', { id: 'perfil-abrir', class: 'perfil-topo', type: 'button', onclick: e => { e.stopPropagation(); alternarMenu(botao); } });
      const acoes = topo.querySelector('.acoes');
      if (acoes) acoes.after(botao); else topo.append(botao);
    }
    const p = atual();
    botao.replaceChildren(desenho(p.avatar, 'perfil-mini'));
    botao.setAttribute('aria-label', `Perfil: ${p.nome}. Trocar ou gerenciar perfis`);
    botao.title = p.nome;
  }

  function alternarMenu(ancora) {
    let menu = document.getElementById('perfil-menu');
    if (menu && !menu.hidden) { menu.hidden = true; return; }
    if (!menu) { menu = el('div', { id: 'perfil-menu', role: 'menu' }); document.body.append(menu); document.addEventListener('click', () => { menu.hidden = true; }); }
    menu.replaceChildren(
      ...lista().map(p => el('button', { role: 'menuitem', type: 'button', onclick: () => { menu.hidden = true; trocar(p.id); } },
        desenho(p.avatar, 'perfil-mini'), el('span', {}, p.nome + (p.id === estado.ativo ? ' ✓' : '')))),
      el('hr'),
      el('button', { role: 'menuitem', type: 'button', onclick: () => { menu.hidden = true; mostrarTela(true); } }, 'Gerenciar perfis'),
      el('button', { role: 'menuitem', type: 'button', onclick: () => { menu.hidden = true; window.StreamAuth?.open?.(); } }, window.StreamAuth?.readSession?.()?.user?.email ? 'Minha conta' : 'Entrar para sincronizar'),
    );
    const r = ancora.getBoundingClientRect();
    menu.hidden = false;
    menu.style.top = Math.round(r.bottom + 8) + 'px';
    menu.style.right = Math.max(8, Math.round(window.innerWidth - r.right)) + 'px';
    menu.querySelector('button')?.focus();
  }

  // Tela "Quem está assistindo?".
  function mostrarTela(gerenciar = false) {
    montarEstilo();
    let tela = document.getElementById('perfis-tela');
    if (!tela) { tela = el('section', { id: 'perfis-tela', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'perfis-titulo' }); document.body.append(tela); tela.addEventListener('keydown', navegarComSetas); }
    const pode = lista().length < MAX;
    const grade = el('div', { class: 'perfis-grade' },
      ...lista().map(p => el('button', { class: 'perfil-cartao', type: 'button', onclick: () => gerenciar ? abrirEditor(p.id) : (fecharTela(), trocar(p.id)) },
        desenho(p.avatar, 'perfil-grande'), el('span', { class: 'perfil-nome' }, p.nome))),
      pode ? el('button', { class: 'perfil-cartao perfil-novo', type: 'button', onclick: () => abrirEditor(null) },
        el('span', { class: 'perfil-grande', html: MAIS }), el('span', { class: 'perfil-nome' }, 'Adicionar perfil')) : null);
    const logado = Boolean(window.StreamAuth?.readSession?.()?.user?.email);
    tela.classList.toggle('perfis-editando', gerenciar);
    tela.replaceChildren(
      el('div', { class: 'perfis-marca', html: '<img src="/conecta-mark.svg" width="30" height="30" alt=""><b>CONECTA <span>TV</span></b>' }),
      el('h1', { id: 'perfis-titulo' }, gerenciar ? 'Gerenciar perfis' : 'Quem está assistindo?'),
      grade,
      el('button', { class: 'perfis-botao', type: 'button', onclick: () => mostrarTela(!gerenciar) }, gerenciar ? 'Concluído' : 'Gerenciar perfis'),
      el('p', { class: 'perfis-nuvem' }, logado ? 'Seus perfis acompanham a sua conta em todos os aparelhos.' : 'Os perfis ficam neste aparelho. Entre na sua conta para levá-los a todos os aparelhos.'),
    );
    tela.hidden = false;
    document.body.style.overflow = 'hidden';
    setTimeout(() => (tela.querySelector('.perfil-cartao') || tela.querySelector('button'))?.focus(), 30);
  }
  function fecharTela() {
    const tela = document.getElementById('perfis-tela');
    if (tela) tela.hidden = true;
    document.body.style.overflow = '';
    estado.apresentado = true; salvarEstado();
  }
  // Controle remoto / teclado: setas andam entre os cartões e os botões.
  function navegarComSetas(evento) {
    const teclas = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 };
    if (!(evento.key in teclas)) return;
    const focos = [...document.querySelectorAll('#perfis-tela button')];
    const i = focos.indexOf(document.activeElement);
    const proximo = focos[Math.max(0, Math.min(focos.length - 1, (i < 0 ? 0 : i + teclas[evento.key])))];
    if (proximo) { proximo.focus(); evento.preventDefault(); }
  }

  // Editor: nome + escolha do avatar.
  function abrirEditor(id) {
    montarEstilo();
    const existente = id ? lista().find(p => p.id === id) : null;
    let escolhido = existente ? existente.avatar : sugerirAvatar();
    let dlg = document.getElementById('perfil-editor');
    if (!dlg) { dlg = el('dialog', { id: 'perfil-editor', 'aria-labelledby': 'perfil-editor-titulo' }); document.body.append(dlg); }
    const previa = desenho(escolhido, 'perfil-grande');
    const nome = el('input', { id: 'perfil-editor-nome', maxlength: String(NOME_MAX), autocomplete: 'off', placeholder: 'Ex.: Marlon, Kids, Mãe', value: existente ? existente.nome : '' });
    const erro = el('p', { class: 'perfil-editor-erro', role: 'alert' });
    const grade = el('div', { class: 'perfil-avatares', role: 'group', 'aria-label': 'Escolha o avatar' },
      ...(A()?.lista || []).map(a => {
        const b = el('button', { type: 'button', 'aria-label': a.nome, title: a.nome, 'aria-pressed': String(a.id === escolhido),
          onclick: () => { escolhido = a.id; previa.innerHTML = A().svg(a.id); grade.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b))); } },
          desenho(a.id, 'perfil-mini'));
        return b;
      }));
    const salvar = () => {
      try {
        if (existente) editar(existente.id, { nome: nome.value, avatar: escolhido });
        else criar(nome.value, escolhido);
        dlg.close();
        mostrarTela(Boolean(document.getElementById('perfis-tela')?.classList.contains('perfis-editando')));
      } catch (e) { erro.textContent = e.message; nome.focus(); }
    };
    nome.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); salvar(); } });
    dlg.replaceChildren(
      el('h2', { id: 'perfil-editor-titulo' }, existente ? 'Editar perfil' : 'Novo perfil'),
      el('div', { class: 'perfil-editor-topo' }, previa, el('label', { for: 'perfil-editor-nome' }, 'Nome do perfil', nome)),
      erro,
      el('div', { class: 'options-label' }, 'Avatar'),
      grade,
      el('div', { class: 'perfil-editor-acoes' },
        el('button', { class: 'primary', type: 'button', onclick: salvar }, 'Salvar'),
        existente && lista().length > 1 ? el('button', { class: 'quiet', type: 'button', onclick: () => {
          if (!confirmarRemocao(existente)) return;
          try { remover(existente.id); dlg.close(); mostrarTela(true); } catch (e) { erro.textContent = e.message; }
        } }, 'Excluir perfil') : null,
        el('button', { class: 'quiet', type: 'button', onclick: () => dlg.close() }, 'Cancelar')),
    );
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
    setTimeout(() => nome.focus(), 30);
  }
  // Excluir apaga o histórico daquele perfil: pede um segundo toque no mesmo botão.
  const pendentes = new Map();
  function confirmarRemocao(p) {
    const agora = Date.now();
    if ((pendentes.get(p.id) || 0) > agora) { pendentes.delete(p.id); return true; }
    pendentes.set(p.id, agora + 5000);
    const erro = document.querySelector('#perfil-editor .perfil-editor-erro');
    if (erro) erro.textContent = `Toque de novo em "Excluir perfil" para apagar ${p.nome} e o histórico dele.`;
    return false;
  }

  // ------------------------------------------------------------ início
  function depoisDoPortao(fazer) {
    // O acesso.js monta o portão no mesmo DOMContentLoaded: confere logo depois.
    setTimeout(() => {
      if (!document.getElementById('portao')) return fazer();
      const espera = setInterval(() => { if (!document.getElementById('portao')) { clearInterval(espera); fazer(); } }, 400);
    }, 60);
  }

  function iniciar() {
    if (!A()) return;
    garantir();
    montarEstilo();
    atualizarTopo();
    // Mais de um perfil: pergunta quem está assistindo. Na primeira vez,
    // apresenta a tela mesmo com um só perfil, para a pessoa conhecer.
    // Espera o portão de boas-vindas (acesso.js, "Seu nome") ser respondido.
    depoisDoPortao(() => {
      const p = estado.lista[0];
      const apelido = limparNome(window.StreamAcesso?.usuario?.()?.nome);
      if (!estado.apresentado && estado.lista.length === 1 && p.nome === 'Principal' && !p.sincronizado && apelido) editar(p.id, { nome: apelido, avatar: p.avatar });
      if (estado.lista.length > 1 || !estado.apresentado) mostrarTela(false);
    });
    nuvem.sincronizar().then(() => { if (estado.lista.length > 1 && document.getElementById('perfis-tela')?.hidden === false) mostrarTela(false); });
    window.setInterval(() => nuvem.sincronizar(), 30000);
    window.addEventListener('streamtv-auth-changed', () => nuvem.sincronizar().then(() => { if (estado.lista.length > 1) mostrarTela(false); }));
  }

  window.StreamPerfis = {
    lista, atual, trocar, criar, editar, remover,
    mostrar: () => mostrarTela(false),
    gerenciar: () => mostrarTela(true),
    // auth.js: ao entrar, os perfis da nuvem mandam (devolve true se a conta já tinha perfis).
    aoEntrar: () => nuvem.sincronizar(),
    nuvemAtiva: () => nuvem.ativa(),
    sincronizar: () => nuvem.sincronizar(),
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
})();
