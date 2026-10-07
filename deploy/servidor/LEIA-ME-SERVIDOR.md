# Servidor grátis na nuvem (Oracle Cloud Always Free)

## Por que a Oracle é a indicada

| Item | O que a Oracle dá de graça, para sempre |
| --- | --- |
| Máquina | até 4 núcleos ARM (Ampere) com 24 GB de memória — sobra para o Conecta TV e a central |
| Disco | 200 GB |
| Tráfego | **10 TB por mês de saída** — é o que decide, porque vídeo consome banda |
| Endereço | IPv4 público fixo (reserve para nunca mudar) |

Os outros gratuitos não servem para vídeo: o Google dá 1 GB de saída por mês
(acaba em um filme), o Render dorme e não tem disco, e o ngrok limita a banda.

O que a Oracle pede em troca: cartão de crédito **só para conferir identidade**
(a conta Always Free não é cobrada) e paciência na criação — a capacidade ARM
às vezes está cheia, e aí você tenta de novo mais tarde ou em outra região.

## Passo a passo (uma vez só)

1. **Criar a conta** em <https://signup.cloud.oracle.com> (escolha a região mais
   perto do Brasil, por exemplo `Brazil East (São Paulo)` ou `US East (Ashburn)`).
2. **Criar a máquina:** Menu → Compute → Instances → **Create instance**
   - Image: **Ubuntu 22.04** (ou Oracle Linux 9)
   - Shape: **VM.Standard.A1.Flex** — 2 OCPU e 12 GB já bastam (pode usar 4/24)
   - Adicione sua chave SSH (ou deixe a Oracle gerar e baixe a chave)
   - Em Networking, marque **Assign a public IPv4 address**
3. **Reservar o IP** (para o endereço nunca mudar): Networking → Reserved public
   IPs → Reserve, e depois aponte para a instância. Sem isso, o IP pode mudar se
   você parar/criar a máquina.
4. **Liberar as portas na rede:** Networking → Virtual Cloud Networks → sua VCN →
   Security Lists → Default → **Add Ingress Rules**:
   - Source `0.0.0.0/0`, IP Protocol `TCP`, Destination Port Range `3000`
   - Repita com `4100`
   (Pode trocar o Source pelo seu IP de casa para ficar mais fechado.)
5. **Conectar por SSH** (Windows: abra o PowerShell na pasta da chave):

   ```powershell
   ssh -i chave.key ubuntu@SEU-IP
   ```

6. **Instalar tudo com um comando** (dentro do servidor):

   ```bash
   curl -fsSL https://raw.githubusercontent.com/invictusbr1/stream-tv-app/main/deploy/servidor/Instalar-No-Servidor.sh | bash
   ```

   O instalador baixa o Docker, o projeto, cria os segredos, sobe os dois
   aplicativos, ajusta o firewall e mostra no fim:

   ```
   Conecta TV ........: http://SEU-IP:3000
   Central do painel .: http://SEU-IP:4100
   Código de acesso ..: (gerado)
   Chave da central ..: (gerada)
   ```

7. **Guardar os segredos.** Eles ficam em
   `/opt/conecta-tv/deploy/servidor/.env` (só o dono lê). Se perder, rode o
   instalador de novo que ele mantém os valores.

## Usar

- Abra `http://SEU-IP:3000` no celular: vai pedir o **código de acesso** na
  primeira vez e guardar o crachá por 6 meses.
- O painel da central abre em `http://SEU-IP:4100` com a **chave da central**.
- Quer usar no celular como aplicativo? Use "Adicionar à Tela de Início" (é um
  PWA) — fica com ícone, sem barra do navegador.
- Quer domínio bonito e HTTPS (`https://tv.suacasa.com`)? Aponte um domínio para
  o IP e rode o `Endereco-Fixo-Cloudflare.ps1`/Caddy, ou use o Cloudflare como
  proxy na frente do IP.

## Manutenção

```bash
cd /opt/conecta-tv
git pull
docker compose --env-file deploy/servidor/.env -f deploy/servidor/docker-compose.yml up -d --build
```

- Ver logs: `docker compose -f deploy/servidor/docker-compose.yml logs -f`
- Ver estado: `docker compose -f deploy/servidor/docker-compose.yml ps`
- Desligar: `docker compose -f deploy/servidor/docker-compose.yml down`
- Os dados (aparelhos autorizados, sessões da central) ficam em volumes do
  Docker e sobrevivem às atualizações.

## Cuidados honestos

- Servidor público = qualquer pessoa que descubra o endereço tenta usar. O
  código de acesso é o que segura; use um código grande e troque se vazar.
- A Oracle cancela contas Always Free paradas por muito tempo — mantenha a
  máquina em uso.
- Assim como qualquer hospedagem, o provedor pode reclamar do tipo de conteúdo.
  Se um dia cair, o mesmo instalador sobe em outra máquina em minutos.
