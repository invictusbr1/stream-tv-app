# Endereço fixo do Conecta TV e da Central

Hoje o endereço para usar fora de casa é um link temporário
(`https://alguma-coisa.trycloudflare.com`) que **muda toda vez** que você abre o
atalho "Conecta TV no celular". Este documento resolve isso de duas formas.

## Caminho 1 — Tailscale (recomendado, grátis, sem domínio)

O Tailscale cria uma rede privada entre os **seus** aparelhos. O computador ganha
um endereço fixo (algo como `100.101.102.103`) que funciona de qualquer rede —
4G, wi-fi de outra casa, hotel — sem abrir porta no roteador e sem expor nada na
internet. Máximo de 100 aparelhos no plano grátis.

**No computador:** dê dois cliques no atalho **"Endereco fixo (Tailscale)"** da
Área de Trabalho.

1. O Windows vai pedir permissão de administrador (é a instalação do Tailscale,
   assinada pela própria Tailscale).
2. O navegador abre para você criar/entrar na conta (grátis, com Google, email
   ou Microsoft).
3. No fim, a janela mostra os endereços fixos e grava tudo em
   `ENDERECO-FIXO.txt`.

**No celular:** instale o aplicativo **Tailscale** (Play Store / App Store),
entre com a **mesma conta** e deixe ligado. Depois abra no navegador:

```
http://SEU-ENDERECO-FIXO:3000     (Conecta TV)
http://SEU-ENDERECO-FIXO:4100     (Central)
```

Se o MagicDNS estiver ligado (vem ligado por padrão), também funciona pelo nome:
`http://nome-do-pc.sua-rede.ts.net:3000`.

Dicas:

- No celular, use "Adicionar à Tela de Início" para virar um ícone.
- Só aparelhos que entraram na sua conta alcançam esses endereços. Não precisa
  de código de acesso nem de senha extra.
- O computador precisa estar ligado e com o Tailscale em execução (ele já sobe
  junto com o Windows).

## Caminho 2 — Cloudflare Tunnel com domínio próprio (endereço público em https)

Use quando quiser abrir **em qualquer aparelho, sem instalar nada nele** — por
exemplo uma TV ou o computador de outra pessoa. Aqui o endereço é público, então
o **código de acesso** (ACESSO_CODIGO) passa a ser obrigatório.

O que precisa:

1. Um domínio seu (a única parte paga — um `.xyz` custa alguns reais por ano; o
   `eu.org` é gratuito, mas demora para ser aprovado).
2. O domínio apontado para o **Cloudflare** (grátis, só trocar os servidores de
   nome no registrador).

Depois, no computador:

```powershell
pwsh -File "C:\Users\tikto\Conecta TV\Endereco-Fixo-Cloudflare.ps1" -Endereco tv.seudominio.com -EnderecoCentral painel.seudominio.com
```

O script faz o login no Cloudflare, cria o túnel, aponta o DNS, escreve a
configuração e instala como serviço do Windows (liga junto com o computador).
No fim ele mostra os endereços fixos:

```
https://tv.seudominio.com       -> Conecta TV
https://painel.seudominio.com   -> Central
```

## Qual escolher

| Situação | Melhor caminho |
| --- | --- |
| Celular/computador da família, uso pessoal | **Tailscale** |
| Quero abrir na TV sem instalar nada nela | Cloudflare + domínio |
| Não quero gastar nada e não quero conta | Tailscale (a conta é só para a rede privada) |
| Quero endereço bonito tipo `tv.suacasa.com` | Cloudflare + domínio |

## Depois de resolver

- O aplicativo continua rodando no computador pelo atalho "Conecta TV" (ou pelo
  "Endereco fixo" se você usar o Cloudflare como serviço).
- A Central continua pelo atalho "Central Conecta TV".
- No celular, guarde o endereço fixo na Tela de Início — ele não muda mais.
