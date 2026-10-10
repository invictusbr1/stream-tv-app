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
    // Código do público (vem do arquivo de endereço que o aparelho consulta).
    let codigoDoArquivo = '';
    async function codigoDoAcesso() {
        const config = await lerConfig();
        return String(config.acessoCodigo || config.codigo || codigoDoArquivo || '').trim();
    }
    async function lerConfig() {
        if (cacheConfig) return cacheConfig;
        try {
            const config = await fetch('/config.json', { cache: 'no-store' }).then(r => (r.ok ? r.json() : {})).catch(() => ({}));
            cacheConfig = config || {};
        } catch { cacheConfig = {}; }
        return cacheConfig;
    }
    async function enderecosDaCentral() {
        try {
            const config = await lerConfig();
            // Pode haver dois endereços: um da rede de casa e outro da rede
            // privada (Tailscale). Tentamos na ordem até um responder.
            const lista = [config.central, config.centralAlt]
                .map(item => String(item || '').replace(/\/$/, ''))
                .filter((item, posicao, lista) => item && lista.indexOf(item) === posicao);
            // No celular, o endereço de casa e o do Tailscale podem não
            // responder. O arquivo de descoberta (GitHub Pages) diz qual é o
            // endereço público do servidor AGORA — e o próprio servidor
            // repassa o relato para a central.
            if (config.descoberta) {
                try {
                    const atual = await fetch(config.descoberta + '?t=' + Date.now(), { cache: 'no-store' }).then(r => r.ok ? r.json() : null);
                    const publico = String((atual && atual.endereco) || '').replace(/\/$/, '');
                    if (publico && !lista.includes(publico)) lista.push(publico);
                    // O código do público vem no mesmo arquivo: assim o relato
                    // chega mesmo quando o endereço mudou (túnel novo) e o
                    // aparelho ainda não tem crachá naquele endereço.
                    if (atual && atual.codigo) codigoDoArquivo = String(atual.codigo).slice(0, 60);
                } catch { /* sem internet ou arquivo fora do ar */ }
            }
            return lista;
        } catch { return []; }
    }
    async function enderecoCentral() {
        const lista = await enderecosDaCentral();
        return lista[0] || '';
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
            codigo: await codigoDoAcesso(),
            app: (await lerConfig()).app || (navigator.userAgent && /StreamTVAndroid/.test(navigator.userAgent) ? 'android' : 'web'),
            plataforma: (navigator.platform || '').slice(0, 40),
            navegador: (navigator.userAgent || '').slice(0, 160),
            assistindo: extra?.assistindo || null
        };
        try {
            const resposta = await fetch('/api/acesso', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });
            if (resposta.ok) return resposta.json();
        } catch { /* talvez esteja no aplicativo Android, que não tem servidor local */ }
        for (const central of await enderecosDaCentral()) {
            try {
                const resposta = await fetch(`${central}/api/acesso`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });
                if (resposta.ok) return resposta.json();
            } catch { /* tenta o próximo endereço */ }
        }
        return null;
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
            codigo: await codigoDoAcesso(),
            app: (await lerConfig()).app || (navigator.userAgent && /StreamTVAndroid/.test(navigator.userAgent) ? 'android' : 'web'),
            navegador: (navigator.userAgent || '').slice(0, 160),
            ...evento
        };
        try {
            const resposta = await fetch('/api/evento', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });
            if (resposta.ok) return true;
        } catch { /* no aplicativo Android não existe servidor local */ }
        for (const central of await enderecosDaCentral()) {
            try {
                const resposta = await fetch(`${central}/api/evento`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });
                if (resposta.ok) return true;
            } catch { /* tenta o próximo endereço */ }
        }
        return false;
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

    // Alguns aparelhos (TV, TV box) já mandam o nome no próprio endereço — é o
    // caso do aplicativo da TV Samsung. Assim ninguém precisa digitar no
    // controle remoto, e a central continua registrando quem está assistindo.
    function nomeDoEndereco() {
        try {
            const parametros = new URLSearchParams(location.search);
            const nome = String(parametros.get('nome') || '').trim().replace(/\s+/g, ' ');
            return nome.length >= 2 ? nome.slice(0, 60) : '';
        } catch { return ''; }
    }

    document.addEventListener('DOMContentLoaded', () => {
        const doEndereco = nomeDoEndereco();
        if (guardado()?.nome) registrar().catch(() => {});
        else if (doEndereco) { salvar(doEndereco); registrar().catch(() => {}); liberar(); }
        else mostrarPortao();
        setInterval(() => registrar().catch(() => {}), 10 * 60 * 1000);
    });
})();
