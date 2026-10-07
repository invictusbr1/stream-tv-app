// Portão de entrada: só libera o aplicativo depois de informar o nome.
// Também registra o acesso (nome, aparelho e IP) na central do aplicativo.
(function () {
    'use strict';
    const CHAVE = 'streamtv-usuario';
    const VERSAO = '1.0';

    function guardado() { try { return JSON.parse(localStorage.getItem(CHAVE) || 'null'); } catch { return null; } }

    function aparelho() {
        const ua = navigator.userAgent || '';
        if (/AndroidTV|Leanback|BRAVIA|MiBOX|FireTV|GoogleTV|SMART-TV/i.test(ua)) return 'TV ou TV box';
        if (/Android/i.test(ua)) return 'Celular Android';
        if (/iPhone|iPad|iPod/i.test(ua)) return 'iPhone / iPad';
        if (/Windows|Macintosh|Linux|CrOS/i.test(ua)) return 'Computador';
        return 'Aparelho';
    }

    function identificador() {
        try {
            let id = localStorage.getItem('streamtv-dispositivo');
            if (!id) { id = 'd' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); localStorage.setItem('streamtv-dispositivo', id); }
            return id;
        } catch { return ''; }
    }

    function salvar(nome) {
        const dados = { nome, aparelho: aparelho(), desde: new Date().toISOString() };
        try { localStorage.setItem(CHAVE, JSON.stringify(dados)); } catch { /* sem armazenamento */ }
        return dados;
    }

    let cacheConfig = null;
    async function lerConfig() {
        if (cacheConfig) return cacheConfig;
        try {
            const config = await fetch('/config.json', { cache: 'no-store' }).then(r => (r.ok ? r.json() : {})).catch(() => ({}));
            cacheConfig = config || {};
        } catch { cacheConfig = {}; }
        return cacheConfig;
    }
    async function enderecoCentral() {
        try {
            const config = await lerConfig();
            return String(config.central || '').replace(/\/$/, '');
        } catch { return ''; }
    }
    // A versão mostrada na central é a do próprio aplicativo (não um número fixo).
    async function versaoDoApp() {
        try {
            const config = await lerConfig();
            return String(config.versionName || VERSAO).slice(0, 20);
        } catch { return VERSAO; }
    }

    async function registrar(extra) {
        const dados = guardado();
        if (!dados?.nome) return null;
        const corpo = {
            nome: dados.nome,
            aparelho: dados.aparelho || aparelho(),
            dispositivo: identificador(),
            versao: extra?.versao || await versaoDoApp(),
            assistindo: extra?.assistindo || null
        };
        try {
            const resposta = await fetch('/api/acesso', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });
            if (resposta.ok) return resposta.json();
        } catch { /* talvez esteja no aplicativo Android, que não tem servidor local */ }
        try {
            const central = await enderecoCentral();
            if (!central) return null;
            const resposta = await fetch(`${central}/api/acesso`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });
            return resposta.ok ? resposta.json() : null;
        } catch { return null; }
    }

    function liberar() { document.getElementById('portao')?.remove(); }

    // Conta para a central o que está sendo assistido e como terminou.
    async function reportar(evento) {
        const dados = guardado();
        const corpo = {
            nome: dados?.nome || 'Anônimo',
            aparelho: dados?.aparelho || aparelho(),
            dispositivo: identificador(),
            versao: evento?.versao || await versaoDoApp(),
            ...evento
        };
        try {
            const resposta = await fetch('/api/evento', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });
            if (resposta.ok) return true;
        } catch { /* no aplicativo Android não existe servidor local */ }
        try {
            const central = await enderecoCentral();
            if (!central) return false;
            const resposta = await fetch(`${central}/api/evento`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });
            return resposta.ok;
        } catch { return false; }
    }

    function mostrarPortao() {
        if (document.getElementById('portao')) return;
        const caixa = document.createElement('div');
        caixa.id = 'portao';
        caixa.innerHTML = '<div class="portao-card"><h2>Bem-vindo ao Conecta TV</h2><p>Para liberar o aplicativo, diga como você quer aparecer na central da família. Serve um apelido.</p><label>Seu nome<input id="portao-nome" maxlength="60" autocomplete="name" placeholder="Ex.: Marlon"></label><button class="primary" id="portao-entrar" type="button">Entrar</button><p id="portao-erro" class="portao-erro" role="status" aria-live="polite"></p><p class="portao-nota">Ficam registrados o seu nome, o aparelho e o endereço IP de conexão. Esses dados aparecem somente na central do Conecta TV, para controle de quem está usando.</p></div>';
        document.body.append(caixa);
        const campo = document.getElementById('portao-nome');
        const erro = document.getElementById('portao-erro');
        campo.focus();
        const entrar = async () => {
            const nome = campo.value.trim().replace(/\s+/g, ' ');
            if (nome.length < 2) { erro.textContent = 'Escreva pelo menos 2 letras do seu nome.'; campo.focus(); return; }
            document.getElementById('portao-entrar').disabled = true;
            salvar(nome);
            await registrar().catch(() => {});
            liberar();
        };
        document.getElementById('portao-entrar').onclick = entrar;
        campo.addEventListener('keydown', evento => { if (evento.key === 'Enter') { evento.preventDefault(); entrar(); } });
    }

    window.StreamAcesso = { registrar, reportar, aparelho, identificador, usuario: guardado, abrirPortao: mostrarPortao };

    document.addEventListener('DOMContentLoaded', () => {
        if (guardado()?.nome) registrar().catch(() => {});
        else mostrarPortao();
        setInterval(() => registrar().catch(() => {}), 10 * 60 * 1000);
    });
})();
