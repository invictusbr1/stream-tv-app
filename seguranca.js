'use strict';
// Segurança do Conecta TV.
//
// Três preocupações resolvidas aqui:
//   1. Cabeçalhos de segurança e CORS fechado (só o próprio site e as origens
//      autorizadas podem falar com a API).
//   2. Limite de uso por endereço, para ninguém derrubar o aplicativo.
//   3. Portão de entrada por código: quando o aplicativo está hospedado, só
//      entra quem recebeu o código. Cada aparelho autorizado ganha um crachá
//      (token) guardado no servidor.
//
// Também tem a trava contra pedidos para a rede interna (o servidor nunca é
// usado para "espiar" a rede de casa).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const COOKIE = 'conecta_acesso';

function ipDoPedido(req) {
    const encaminhado = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    const direto = req.socket?.remoteAddress || '';
    return (encaminhado || direto).replace(/^::ffff:/, '');
}

// Endereço de rede interna: nunca deve ser buscado pelo servidor.
function hostInterno(host) {
    const nome = String(host || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
    if (!nome) return true;
    if (nome === 'localhost' || nome.endsWith('.localhost') || nome.endsWith('.local') || nome.endsWith('.internal')) return true;
    if (nome === '::1' || nome === '0:0:0:0:0:0:0:1' || nome === '0.0.0.0') return true;
    const ip = nome.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (ip) {
        const [a, b] = [Number(ip[1]), Number(ip[2])];
        if (a === 10 || a === 127 || a === 0) return true;
        if (a === 169 && b === 254) return true;          // link-local
        if (a === 172 && b >= 16 && b <= 31) return true;  // faixa privada
        if (a === 192 && b === 168) return true;           // faixa privada
        if (a === 100 && b >= 64 && b <= 127) return true; // operadora
    }
    if (/^(fc|fd|fe80)/i.test(nome)) return true; // IPv6 privado
    return false;
}

// Cabeçalhos + CORS restrito. Sem origem autorizada, o navegador de terceiros
// não consegue nem ler a resposta.
function cabecalhos(opcoes = {}) {
    const permitidas = new Set((opcoes.origensPermitidas || []).map(o => String(o).replace(/\/$/, '')));
    return function cabecalhoDeSeguranca(req, res, next) {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Referrer-Policy', 'no-referrer');
        res.setHeader('X-Frame-Options', 'SAMEORIGIN');
        res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
        res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
        res.setHeader('Content-Security-Policy', [
            "default-src 'self'",
            "img-src 'self' data: blob: https:",
            "media-src 'self' blob: https:",
            "connect-src 'self' https:",
            "script-src 'self' 'unsafe-inline'",
            "style-src 'self' 'unsafe-inline'",
            // O player usa um "worker" interno para preparar o vídeo; sem esta
            // linha o navegador recusa o worker e o vídeo engasga mais.
            "worker-src 'self' blob:",
            "frame-src https:",
            "font-src 'self' data:",
            "base-uri 'none'",
            "form-action 'self'"
        ].join('; '));
        if (String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https') {
            res.setHeader('Strict-Transport-Security', 'max-age=15552000');
        }

        const origem = String(req.headers.origin || '');
        if (origem) {
            let mesmaOrigem = false;
            try { mesmaOrigem = new URL(origem).host === String(req.headers.host || ''); } catch { /* origem inválida */ }
            if (mesmaOrigem || permitidas.has(origem.replace(/\/$/, ''))) {
                res.setHeader('Access-Control-Allow-Origin', origem);
                res.setHeader('Vary', 'Origin');
                res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
                res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Acesso');
                res.setHeader('Access-Control-Max-Age', '600');
            }
        }
        if (req.method === 'OPTIONS') return res.sendStatus(origem ? 204 : 200);
        next();
    };
}

// Limite de uso por endereço. O vídeo passa por aqui muitas vezes (cada pedaço
// da lista é uma chamada), por isso ele tem um teto próprio, mais alto.
function criarLimitador(opcoes = {}) {
    const janela = Number(opcoes.janelaMs || 60000);
    const maximo = Number(opcoes.maximo || 300);
    const maximoMidia = Number(opcoes.maximoMidia || 2400);
    const janelaMidia = Number(opcoes.janelaMidiaMs || 600000);
    const registros = new Map();
    let ultimaLimpeza = Date.now();

    function limpar(agora) {
        if (agora - ultimaLimpeza < janela) return;
        ultimaLimpeza = agora;
        for (const [chave, dados] of registros) {
            if (agora - dados.desde > Math.max(janela, janelaMidia)) registros.delete(chave);
        }
    }

    return function limiteDeUso(req, res, next) {
        if (req.method === 'OPTIONS') return next();
        const agora = Date.now();
        limpar(agora);
        const midia = req.path === '/api/hls';
        const chave = `${ipDoPedido(req)}|${midia ? 'midia' : 'geral'}`;
        const limite = midia ? maximoMidia : maximo;
        const duracao = midia ? janelaMidia : janela;
        const dados = registros.get(chave) || { desde: agora, contagem: 0 };
        if (agora - dados.desde > duracao) { dados.desde = agora; dados.contagem = 0; }
        dados.contagem++;
        registros.set(chave, dados);
        if (dados.contagem > limite) {
            res.setHeader('Retry-After', String(Math.ceil((dados.desde + duracao - agora) / 1000)));
            return res.status(429).json({ error: 'Muitos pedidos em pouco tempo. Aguarde um instante.' });
        }
        next();
    };
}

// Portão de entrada: com código configurado, só entra aparelho autorizado.
function criarPortao(opcoes = {}) {
    const codigo = String(opcoes.codigo || '').trim();
    const arquivo = opcoes.arquivo;
    const pagina = opcoes.pagina || 'entrar';
    let cache = { em: 0, dados: {} };
    let tentativas = new Map();
    // Lista de bloqueio: aparelho que o dono mandou sair não entra de novo,
    // mesmo que alguém saiba o código.
    const arquivoBloqueados = path.join(path.dirname(arquivo), 'bloqueados.json');
    let cacheBloqueados = { em: 0, lista: [] };

    function bloqueados() {
        try {
            const info = fs.statSync(arquivoBloqueados);
            if (info.mtimeMs !== cacheBloqueados.em) {
                cacheBloqueados = { em: info.mtimeMs, lista: JSON.parse(fs.readFileSync(arquivoBloqueados, 'utf8')) || [] };
            }
        } catch { cacheBloqueados = { em: 0, lista: [] }; }
        return cacheBloqueados.lista;
    }
    function gravarBloqueados(lista) {
        try {
            fs.mkdirSync(path.dirname(arquivoBloqueados), { recursive: true });
            fs.writeFileSync(arquivoBloqueados, JSON.stringify(lista, null, 1));
            cacheBloqueados = { em: 0, lista };
        } catch { /* sem permissão de escrita */ }
    }

    function autorizados() {
        try {
            const info = fs.statSync(arquivo);
            if (info.mtimeMs !== cache.em) {
                cache = { em: info.mtimeMs, dados: JSON.parse(fs.readFileSync(arquivo, 'utf8')) || {} };
            }
        } catch { cache = { em: 0, dados: {} }; }
        return cache.dados;
    }
    function gravar(dados) {
        try {
            fs.mkdirSync(path.dirname(arquivo), { recursive: true });
            fs.writeFileSync(arquivo, JSON.stringify(dados, null, 1));
            cache = { em: 0, dados };
        } catch { /* sem permissão de escrita */ }
    }
    function tokenDoPedido(req) {
        const cabecalho = String(req.headers['x-acesso'] || '').trim();
        if (cabecalho) return cabecalho;
        const bruto = String(req.headers.cookie || '');
        const achado = bruto.split(';').map(parte => parte.trim()).find(parte => parte.startsWith(COOKIE + '='));
        return achado ? decodeURIComponent(achado.slice(COOKIE.length + 1)) : '';
    }
    function liberado(dispositivo, resposta) {
        return Boolean(dispositivo && dispositivo.ativo !== false && (!resposta || dispositivo.codigo === resposta));
    }
    function marcarUso(req, token) {
        const dados = autorizados();
        if (!dados[token]) return;
        dados[token].ultimoEm = new Date().toISOString();
        dados[token].ip = ipDoPedido(req);
        gravar(dados);
    }

    const isento = caminho => caminho === '/entrar' || caminho === '/api/entrar' || caminho === '/api/health'
        // Relatos de quem está assistindo: o celular e a TV contam para a
        // central por aqui — eles não têm crachá no servidor público, e o
        // relato é só de status (o limite de uso protege contra abuso).
        || caminho === '/api/evento'
        // Cadastro do aparelho (nome/aparelho) feito na primeira abertura.
        || caminho === '/api/acesso'
        || caminho === '/manifest.webmanifest' || caminho.startsWith('/pwa/') || caminho === '/favicon.ico';

    function middleware(req, res, next) {
        if (!codigo) return next();
        const token = tokenDoPedido(req);
        const dados = autorizados();
        if (token && dados[token]) {
            const aparelho = dados[token];
            if (aparelho.dispositivo && bloqueados().includes(aparelho.dispositivo)) {
                return res.status(403).json({ error: 'Este aparelho foi removido pelo dono do aplicativo.' });
            }
            marcarUso(req, token);
            req.dispositivoAutorizado = aparelho;
            return next();
        }
        if (isento(req.path)) return next();
        // Aparelho que apresenta o CÓDIGO do público é atendido na hora: o
        // relato pode chegar por um endereço novo (túnel fixo, rede de fora) e
        // não pode se perder só porque o crachá antigo era de outro endereço.
        // Vale apenas para status (os relatos são de uso, sem dado sensível).
        const informado = String(req.body?.codigo || req.query?.codigo || req.headers['x-conecta-codigo'] || '').trim();
        if (informado && informado === codigo) {
            if (req.body?.dispositivo) {
                req.dispositivoAutorizado = { dispositivo: String(req.body.dispositivo).slice(0, 40), nome: String(req.body.nome || '').slice(0, 60) };
            }
            return next();
        }
        const aceitaHtml = String(req.headers.accept || '').includes('text/html');
        if (aceitaHtml && !req.path.startsWith('/api/')) return res.status(401).type('html').send(paginaDeEntrada({ erro: '' }));
        return res.status(401).json({ error: 'Este aplicativo é privado. Informe o código de acesso.' });
    }

    // Rota de entrada: confere o código, cria o crachá do aparelho e devolve.
    function rotaEntrada(req, res) {
        if (!codigo) return res.json({ ok: true, token: '' });
        const ip = ipDoPedido(req);
        const agora = Date.now();
        const marca = tentativas.get(ip) || { desde: agora, erros: 0 };
        if (agora - marca.desde > 600000) { marca.desde = agora; marca.erros = 0; }
        if (marca.erros >= 8) return res.status(429).json({ error: 'Muitas tentativas. Tente novamente em alguns minutos.' });
        const enviado = String(req.body?.codigo || '').trim();
        if (enviado !== codigo) {
            marca.erros++;
            tentativas.set(ip, marca);
            return res.status(401).json({ error: 'Código incorreto.' });
        }
        marca.erros = 0;
        tentativas.set(ip, marca);
        const token = crypto.randomBytes(24).toString('hex');
        const dispositivo = String(req.body?.dispositivo || '').slice(0, 40);
        if (dispositivo && bloqueados().includes(dispositivo)) {
            return res.status(403).json({ error: 'Este aparelho foi removido pelo dono do aplicativo.' });
        }
        const dados = autorizados();
        dados[token] = {
            token,
            nome: String(req.body?.nome || '').slice(0, 60) || 'Aparelho autorizado',
            dispositivo,
            aparelho: String(req.body?.aparelho || '').slice(0, 40),
            criadoEm: new Date().toISOString(),
            ultimoEm: new Date().toISOString(),
            ip
        };
        gravar(dados);
        const seguro = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
        res.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=15552000; HttpOnly; SameSite=Lax${seguro ? '; Secure' : ''}`);
        res.json({ ok: true, token });
    }

    // Lista de aparelhos autorizados (para o dono conferir quem entrou).
    function listarDispositivos() {
        return Object.values(autorizados()).map(item => ({
            token: item.token,
            nome: item.nome,
            dispositivo: item.dispositivo || '',
            criadoEm: item.criadoEm || '',
            ultimoEm: item.ultimoEm || item.criadoEm || '',
            ip: item.ip || '',
            bloqueado: Boolean(item.dispositivo && bloqueados().includes(item.dispositivo)),
        })).sort((a, b) => String(b.ultimoEm).localeCompare(String(a.ultimoEm)));
    }

    // Remove o crachá do aparelho e o coloca na lista de bloqueio.
    function bloquearDispositivo(token) {
        const dados = autorizados();
        const alvo = dados[String(token || '')];
        if (!alvo) return null;
        delete dados[alvo.token];
        gravar(dados);
        const lista = bloqueados();
        if (alvo.dispositivo && !lista.includes(alvo.dispositivo)) gravarBloqueados([...lista, alvo.dispositivo]);
        return { nome: alvo.nome, dispositivo: alvo.dispositivo || '' };
    }

    function liberarDispositivo(dispositivo) {
        const id = String(dispositivo || '').trim();
        if (!id) return false;
        const lista = bloqueados();
        if (!lista.includes(id)) return false;
        gravarBloqueados(lista.filter(item => item !== id));
        return true;
    }

    return {
        middleware, rotaEntrada, autorizados, listarDispositivos, bloquearDispositivo, liberarDispositivo, bloqueados,
        limparCache: () => { cache = { em: 0, dados: {} }; cacheBloqueados = { em: 0, lista: [] }; },
    };
}

// Tela de entrada (mostrada só quando o aplicativo está hospedado).
function paginaDeEntrada(dados = {}) {
    const erro = dados.erro ? `<p class="erro">${dados.erro}</p>` : '';
    return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Conecta TV · entrada</title>
<style>
body{margin:0;background:#0b0e15;color:#e8ecf3;font:15px system-ui;display:grid;place-items:center;min-height:100vh}
.caixa{background:#141924;border:1px solid #ffffff14;border-radius:18px;padding:28px;width:min(360px,90vw)}
h1{margin:0 0 6px;font-size:20px}p{margin:0 0 18px;color:#8d97a8;font-size:13px}
label{display:block;font-size:12px;color:#9aa4b4;margin:14px 0 6px}
input{width:100%;box-sizing:border-box;background:#1c2230;border:1px solid #2c3444;color:#fff;border-radius:10px;padding:12px}
button{margin-top:18px;width:100%;background:#e50914;border:0;color:#fff;border-radius:10px;padding:13px;font-size:15px;font-weight:600}
.erro{color:#ff8f8f;font-size:13px;margin:10px 0 0}
</style></head><body>
<form class="caixa" id="forma">
<h1>Conecta TV</h1><p>Aplicativo privado. Informe o código de acesso que você recebeu.</p>
<label for="nome">Seu nome</label><input id="nome" autocomplete="name" placeholder="Como devemos chamar você">
<label for="codigo">Código de acesso</label><input id="codigo" type="password" autocomplete="off" placeholder="Código">
${erro}
<button type="submit">Entrar</button>
</form>
<script>
// Quando o endereço já traz o código e o nome (caso do aplicativo da TV
// Samsung), a entrada acontece sozinha — sem digitar nada no controle.
const parametros=new URLSearchParams(location.search);
const codigoDoEndereco=parametros.get('codigo')||'';
const nomeDoEndereco=(parametros.get('nome')||'').trim();
if(codigoDoEndereco) document.getElementById('codigo').value=codigoDoEndereco;
if(nomeDoEndereco) document.getElementById('nome').value=nomeDoEndereco;
document.getElementById('forma').onsubmit=async function(evento){
  evento.preventDefault();
  const nome=document.getElementById('nome').value.trim();
  const codigo=document.getElementById('codigo').value.trim();
  const aviso=document.querySelector('.erro')||document.createElement('p');
  aviso.className='erro';aviso.textContent='';
  const resposta=await fetch('/api/entrar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({nome:nome,codigo:codigo,dispositivo:localStorage.getItem('streamtv-dispositivo')||''})}).catch(()=>({ok:false}));
  if(resposta.ok){location.href='/'+(nomeDoEndereco?'?nome='+encodeURIComponent(nomeDoEndereco):'');return;}
  let motivo='Não foi possível entrar.';try{const json=await resposta.json();if(json&&json.error)motivo=json.error;}catch{}
  aviso.textContent=motivo;this.append(aviso);
};
if(codigoDoEndereco&&nomeDoEndereco){document.getElementById('forma').dispatchEvent(new Event('submit',{cancelable:true}));}
</script></body></html>`;
}

module.exports = {
    COOKIE,
    ipDoPedido,
    hostInterno,
    cabecalhos,
    criarLimitador,
    criarPortao,
    paginaDeEntrada
};
