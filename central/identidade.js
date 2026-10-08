'use strict';
// Identidade dos aparelhos que aparecem na central.
//
// Duas perguntas respondidas aqui:
//   1. Que tipo de aparelho é? (aplicativo Android, iPhone, computador, TV...)
//   2. De onde ele está falando? (rede de casa, rede privada Tailscale ou
//      internet) — é o que permite reconhecer o aparelho pelo IP.

const dns = require('dns');

// ---------------------------------------------------------------- tipo de aparelho
const REGRAS_APARELHO = [
    { tipo: 'Aplicativo Android', teste: /StreamTVAndroid|ConectaTVAndroid/i },
    { tipo: 'Aplicativo Android (TV)', teste: /StreamTVAndroidTV/i },
    { tipo: 'iPhone / iPad', teste: /iPhone|iPad|iPod/i },
    { tipo: 'Celular Android', teste: /Android/i },
    { tipo: 'Computador', teste: /Windows|Macintosh|Linux|CrOS/i },
    { tipo: 'TV ou TV box', teste: /BRAVIA|MiBOX|FireTV|GoogleTV|SMART-TV|Leanback|Web0S|Tizen/i }
];

function tipoDeAparelho(dados = {}) {
    const texto = [dados.aparelho, dados.navegador, dados.plataforma].filter(Boolean).join(' ');
    // O aplicativo do celular manda "app: android"; a TV aparece no aparelho.
    if (dados.app === 'android') return /tv|box|leanback/i.test(texto) ? 'Aplicativo Android (TV)' : 'Aplicativo Android';
    for (const regra of REGRAS_APARELHO) if (regra.teste.test(texto)) return regra.tipo;
    if (dados.app === 'central') return 'Aplicativo da central';
    if (dados.app === 'desktop') return 'Computador';
    return dados.aparelho ? String(dados.aparelho).slice(0, 40) : 'Aparelho não identificado';
}

// ---------------------------------------------------------------- rede do IP
function classificarIp(ip) {
    const valor = String(ip || '').replace(/^::ffff:/, '').trim();
    if (!valor) return { rede: 'desconhecida', rotulo: 'sem IP' };
    const partes = valor.split('.').map(Number);
    if (valor === '::1' || partes[0] === 127) return { rede: 'propria', rotulo: 'o próprio computador' };
    if (partes[0] === 100 && partes[1] >= 64 && partes[1] <= 127) return { rede: 'tailscale', rotulo: 'rede privada (Tailscale)' };
    if (partes[0] === 10 || (partes[0] === 192 && partes[1] === 168) || (partes[0] === 172 && partes[1] >= 16 && partes[1] <= 31))
        return { rede: 'casa', rotulo: 'rede de casa (Wi-Fi)' };
    if (partes[0] === 169 && partes[1] === 254) return { rede: 'local', rotulo: 'rede local do aparelho' };
    if (/^(fc|fd|fe80)/i.test(valor)) return { rede: 'tailscale', rotulo: 'rede privada' };
    return { rede: 'internet', rotulo: 'internet (fora de casa)' };
}

// Nome da rede quando dá para descobrir (reverso do IP). Falha em silêncio.
function nomeDoIp(ip) {
    return new Promise(resolve => {
        const valor = String(ip || '').trim();
        if (!valor) return resolve('');
        dns.reverse(valor, (erro, nomes) => resolve(erro || !nomes || !nomes.length ? '' : String(nomes[0]).slice(0, 60)));
    });
}

// ---------------------------------------------------------------- localização (opcional)
// Ajuda a reconhecer o aparelho quando ele está fora de casa (cidade/operadora).
// Usa um serviço público gratuito, com cache, e só para IPs da internet.
const cacheLocal = new Map();
async function localizacaoDoIp(ip) {
    const valor = String(ip || '').trim();
    const achado = classificarIp(valor);
    if (achado.rede !== 'internet') return null;
    const guardado = cacheLocal.get(valor);
    if (guardado && guardado.expira > Date.now()) return guardado.dados;
    try {
        const resposta = await fetch(`https://ipapi.co/${encodeURIComponent(valor)}/json/`, {
            headers: { 'User-Agent': 'central-conecta-tv' },
            signal: AbortSignal.timeout(4000)
        });
        if (!resposta.ok) throw new Error('http ' + resposta.status);
        const dados = await resposta.json();
        const resumo = [dados.city, dados.region_code || dados.region, dados.country_name].filter(Boolean).join(', ');
        const limpo = resumo ? { cidade: resumo.slice(0, 60), operadora: String(dados.org || '').slice(0, 50) } : null;
        cacheLocal.set(valor, { dados: limpo, expira: Date.now() + 6 * 60 * 60 * 1000 });
        return limpo;
    } catch {
        cacheLocal.set(valor, { dados: null, expira: Date.now() + 30 * 60 * 1000 });
        return null;
    }
}

// Junta tudo o que a central sabe sobre o aparelho e a conexão dele.
async function descrever(dispositivo = {}, eventosDoAparelho = []) {
    const ip = dispositivo.ip || '';
    const rede = classificarIp(ip);
    const tipo = tipoDeAparelho(dispositivo);
    const nomeRede = await nomeDoIp(ip);
    const local = await localizacaoDoIp(ip);
    const falhas = eventosDoAparelho.filter(e => e.ok === false).length;
    const sessoes = eventosDoAparelho.filter(e => e.ok !== false && (e.tipo === 'play' || e.tipo === 'sessao')).length;
    return {
        tipo,
        rede: rede.rede,
        redeRotulo: rede.rotulo,
        nomeRede,
        local: local ? local.cidade : '',
        operadora: local ? local.operadora : '',
        sessoes,
        falhas,
        saude: sessoes + falhas ? Math.round((sessoes / (sessoes + falhas)) * 100) : null
    };
}

module.exports = { tipoDeAparelho, classificarIp, nomeDoIp, localizacaoDoIp, descrever };
