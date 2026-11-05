# -*- coding: utf-8 -*-
"""Ponte SeleniumBase do caçador (roda só no PC).

Abre uma página num Chrome controlado pelo SeleniumBase e devolve, em uma
linha JSON, o mesmo formato do espionarPagina (verificar-navegador.js):
vídeos (.m3u8/.mp4), pedidos de rede, players (iframes) e respostas de API.

As opções vêm de central/configuracao-caca.json (a ponte .js passa como
argumentos). Página com verificação de robô: "recusar" pula; "manual" abre o
Chrome visível para a pessoa resolver e só então continua.

Uso: python selenium-ponte.py <url> [--referer URL] [--segundos N]
     [--visivel] [--sem-bloqueio] [--abrir N] [--robo recusar|manual] [--resolver N]
Saída: uma linha começando com PONTE: seguida do JSON.
"""
import json
import re
import sys
import time

VIDEO = re.compile(r"\.(m3u8|mp4)(\?|$)", re.I)
CHAMADA = re.compile(r"player|play|api|embed|stream|videos?|source|episodio|assistir", re.I)
CAPTCHA = re.compile(r"challenges\.cloudflare\.com/turnstile|hcaptcha\.com|recaptcha/api|<title>\s*(Verifica[cç][aã]o|Just a moment|Attention Required)", re.I)

COLETAR_TELA = r"""
const ler = el => el.getAttribute('src') || el.getAttribute('data-src') || el.getAttribute('data-url') || el.getAttribute('data-link') || el.getAttribute('data-player') || el.getAttribute('data-embed') || '';
const coletar = () => [...document.querySelectorAll('iframe, [data-url], [data-src], [data-link], [data-player], [data-embed]')].map(ler).filter(Boolean);
const vistos = new Set(coletar());
const botoes = [...document.querySelectorAll('[data-url], [data-player], [data-embed], [data-link], .server, .servidor, .opcao, .option, [class*=server], [class*=servidor], [class*=player-option], [class*=dublado], [class*=dub], li[data-id]')].slice(0, 8);
for (const b of botoes) { try { b.click(); } catch (e) {} }
coletar().forEach(x => vistos.add(x));
const video = document.querySelector('video');
if (video) { try { const t = video.play(); if (t && t.catch) t.catch(() => {}); } catch (e) {} }
return [...vistos].slice(0, 40).map(x => { try { return new URL(x, location.href).href; } catch (e) { return ''; } }).filter(Boolean);
"""
RECURSOS = "return performance.getEntriesByType('resource').map(e => e.name).slice(0, 300);"
VAZIO = {"videos": [], "pedidos": [], "molduras": [], "api": []}


def responder(dados):
    sys.stdout.write("PONTE:" + json.dumps(dados, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def avisar(texto):
    # Vai para o log do caçador (a ponte .js repassa o que vier com AVISO:).
    sys.stdout.write("AVISO:" + texto + "\n")
    sys.stdout.flush()


def numero(valor, padrao, minimo, maximo):
    try:
        return max(minimo, min(maximo, int(float(valor))))
    except (TypeError, ValueError):
        return padrao


def ler_args(argv):
    op = {"url": "", "referer": "", "segundos": 15, "visivel": False, "bloqueio": True,
          "abrir": 25, "robo": "recusar", "resolver": 180}
    i = 0
    while i < len(argv):
        a = argv[i]
        prox = argv[i + 1] if i + 1 < len(argv) else None
        if a == "--referer" and prox is not None: op["referer"] = prox; i += 2; continue
        if a == "--segundos" and prox is not None: op["segundos"] = numero(prox, 15, 4, 45); i += 2; continue
        if a == "--abrir" and prox is not None: op["abrir"] = numero(prox, 25, 5, 90); i += 2; continue
        if a == "--resolver" and prox is not None: op["resolver"] = numero(prox, 180, 30, 600); i += 2; continue
        if a == "--robo" and prox is not None: op["robo"] = "manual" if prox == "manual" else "recusar"; i += 2; continue
        if a == "--visivel": op["visivel"] = True; i += 1; continue
        if a == "--sem-bloqueio": op["bloqueio"] = False; i += 1; continue
        if not op["url"]: op["url"] = a
        i += 1
    return op


def html_de(sb):
    try:
        return sb.driver.page_source or ""
    except Exception:
        return ""


def abrir(sb, op):
    sb.driver.set_page_load_timeout(op["abrir"])
    if op["referer"]:
        try:
            sb.driver.execute_cdp_cmd("Network.enable", {})
            sb.driver.execute_cdp_cmd("Network.setExtraHTTPHeaders", {"headers": {"Referer": op["referer"]}})
        except Exception:
            pass
    try:
        sb.driver.get(op["url"])
    except Exception:
        pass  # tempo esgotado: segue com o que já carregou


def esperar_pessoa(sb, op):
    """Modo manual: a janela está visível; espera a verificação sumir."""
    avisar("a página pediu verificação de robô — resolva na janela do Chrome que abriu (até %d s)" % op["resolver"])
    fim = time.time() + op["resolver"]
    while time.time() < fim:
        time.sleep(2)
        if not CAPTCHA.search(html_de(sb)):
            avisar("verificação resolvida; continuando sozinho")
            time.sleep(2)
            return True
    return False


def coletar(sb, op):
    videos, pedidos, molduras, api, chamadas = [], [], [], [], []

    def anotar(alvo, metodo="GET"):
        if not alvo or not alvo.startswith("http"):
            return
        alvo = alvo[:500]
        if len(pedidos) < 120 and alvo[:300] not in pedidos:
            pedidos.append(alvo[:300])
        if VIDEO.search(alvo) and alvo not in videos and len(videos) < 10:
            videos.append(alvo)
        if len(chamadas) < 20 and (metodo != "GET" or CHAMADA.search(alvo)):
            if not any(c["url"] == alvo[:400] for c in chamadas):
                chamadas.append({"url": alvo[:400], "metodo": metodo, "corpo": ""})

    try:
        for x in sb.driver.execute_script(COLETAR_TELA) or []:
            if x not in molduras:
                molduras.append(str(x)[:400])
    except Exception:
        pass
    fim = time.time() + op["segundos"]
    while time.time() < fim:
        time.sleep(1.5)
        try:
            for entrada in sb.driver.get_log("performance"):
                try:
                    msg = json.loads(entrada.get("message", "{}")).get("message", {})
                except ValueError:
                    continue
                params = msg.get("params", {})
                if msg.get("method") == "Network.requestWillBeSent":
                    pedido = params.get("request", {})
                    anotar(pedido.get("url", ""), pedido.get("method", "GET"))
                elif msg.get("method") == "Network.responseReceived":
                    anotar(params.get("response", {}).get("url", ""))
        except Exception:
            pass
    try:
        for alvo in sb.driver.execute_script(RECURSOS) or []:
            anotar(str(alvo))
    except Exception:
        pass
    try:
        for x in sb.driver.execute_script("return [...document.querySelectorAll('iframe')].map(f => f.src).filter(Boolean);") or []:
            if x not in molduras and len(molduras) < 40:
                molduras.append(str(x)[:400])
    except Exception:
        pass
    html = html_de(sb)
    if VIDEO.search(html):
        api.append({"url": op["url"][:400], "corpo": html[:200000]})
    return {"videos": videos, "pedidos": pedidos, "molduras": molduras, "api": api[:8], "chamadas": chamadas}


def sessao(SB, op, visivel):
    return SB(headless=not visivel, log_cdp_events=True, ad_block=op["bloqueio"], page_load_strategy="eager")


def principal():
    op = ler_args(sys.argv[1:])
    if not re.match(r"^https?://", op["url"] or "", re.I):
        responder({"ok": False, "erro": "endereço inválido", **VAZIO})
        return 2
    try:
        from seleniumbase import SB
    except Exception as erro:
        responder({"ok": False, "semRobo": True, "erro": "SeleniumBase não instalado (" + str(erro)[:80] + ")", **VAZIO})
        return 3
    try:
        with sessao(SB, op, op["visivel"]) as sb:
            abrir(sb, op)
            if CAPTCHA.search(html_de(sb)):
                if op["robo"] != "manual":
                    responder({"ok": False, "captcha": True, "erro": "a página pede verificação de robô; pulada (em configuracao-caca.json, \"verificacao_de_robo\": \"manual\" deixa você resolver)", **VAZIO})
                    return 0
                if not op["visivel"]:
                    # Janela escondida não deixa ninguém resolver: reabre visível.
                    resultado = None
                    with sessao(SB, op, True) as sb2:
                        abrir(sb2, op)
                        if CAPTCHA.search(html_de(sb2)) and not esperar_pessoa(sb2, op):
                            responder({"ok": False, "captcha": True, "erro": "a verificação não foi resolvida a tempo", **VAZIO})
                            return 0
                        resultado = coletar(sb2, op)
                    responder({"ok": True, "como": "seleniumbase (manual)", **resultado})
                    return 0
                if not esperar_pessoa(sb, op):
                    responder({"ok": False, "captcha": True, "erro": "a verificação não foi resolvida a tempo", **VAZIO})
                    return 0
            resultado = coletar(sb, op)
    except Exception as erro:
        responder({"ok": False, "erro": "SeleniumBase: " + str(erro)[:120], **VAZIO})
        return 1
    responder({"ok": True, "como": "seleniumbase", **resultado})
    return 0


if __name__ == "__main__":
    sys.exit(principal())
