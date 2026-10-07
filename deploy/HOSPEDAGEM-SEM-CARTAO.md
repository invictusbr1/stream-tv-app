# Hospedar de graça sem brigar com cadastro

Resumo direto: **nenhum servidor grátis é perfeito** — cada um tem um preço
escondido (hibernar, limite de banda, disco temporário ou cartão de crédito na
verificação). Aqui está o mapa, do mais fácil para o mais chato.

## 1. Sem cadastro nenhum: o PC com Tailscale (já pronto)

Zero sites, zero cartão, zero espera. O celular passa a acessar o PC por um
endereço fixo e privado, de qualquer rede.

- Atalho na Área de Trabalho: **"Endereco fixo (Tailscale)"**.
- Vantagem: banda ilimitada (é a sua internet), nada exposto publicamente.
- Limite: o PC precisa estar ligado.

Se o que te incomoda é cadastro, **este é o caminho** — 5 minutos e acabou.

## 2. Sem cartão: Hugging Face Spaces (Docker, grátis)

É o mais próximo da "nuvem grátis" sem pedir cartão:

| Item | Valor |
| --- | --- |
| Cartão de crédito | **não pede** |
| Endereço | fixo: `https://SEU-USUARIO-NOME.hf.space` |
| Máquina | 2 vCPU e 16 GB (bem mais que o necessário) |
| Banda | uso razoável (dá para a família, não para distribuir) |
| Pegadinha | hiberna depois de um tempo parado (acorda em ~30–60 s) e o disco é temporário |

Pacote pronto em `deploy/huggingface/`:

1. Crie a conta em <https://huggingface.co> e um **Space** novo (tipo *Docker*).
2. Em **Settings → Variables and secrets**, cadastre como *Secret*:
   `ACESSO_CODIGO`, `CENTRAL_KEY`, `CENTRAL_TOKEN`.
3. No seu computador:

```powershell
pwsh -File "C:\Users\tikto\OneDrive\Área de Trabalho\stream tv\deploy\huggingface\Publicar-No-HuggingFace.ps1" -Space seu-usuario/conecta-tv
```

4. Espere a construção (aba *Logs*) e abra `https://seu-usuario-conecta-tv.hf.space`.

## 3. Com cartão, mas com plano grátis que não dorme

| Provedor | Banda grátis | Dorme? | Cartão? | Observação |
| --- | --- | --- | --- | --- |
| **Koyeb** | 100 GB/mês | não | sim (verificação) | roda o mesmo `Dockerfile` |
| **Fly.io** | 100 GB/mês | não | sim | ótimo desempenho, configuração em CLI |
| **Render** | 100 GB/mês | sim (15 min) | sim | o mais simples de configurar |
| **AWS / Azure free tier** | 100 GB/mês | não | sim | grátis só por 12 meses |

100 GB por mês dá perto de **200 horas** de vídeo dublado (medido: ~0,46 GB por
hora). Para uma família é suficiente; para muitos aparelhos, não.

Todos esses usam o **mesmo pacote** que já está pronto em `deploy/servidor/`
(`docker-compose.yml` + `Instalar-No-Servidor.sh`), porque é tudo Docker.

## 4. Oracle (quando o cadastro colabora)

Continua sendo a melhor em banda (10 TB/mês). Se um dia o cadastro passar:

- Tente em outro navegador (ou aba anônima), com outro e-mail (Gmail costuma
  funcionar melhor) e outro cartão.
- Na criação da máquina, escolha uma região diferente se aparecer "out of
  capacity" (a ARM vive cheia).
- O pacote `deploy/servidor/` já está pronto para ela.

## Decisão em uma linha

- **Não quero cadastro:** Tailscale no PC.
- **Quero nuvem sem cartão:** Hugging Face Spaces.
- **Quero nuvem que não dorme e aceito cartão:** Koyeb ou Fly.io.
- **Quero o máximo de banda e o cadastro deixar:** Oracle.
