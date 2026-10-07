#!/usr/bin/env bash
# Instalador do Conecta TV + Central num servidor Linux novo (Ubuntu, Debian ou
# Oracle Linux). Faz tudo: Docker, código, segredos, contêineres e firewall.
#
# Como usar (dentro do servidor, por SSH):
#   curl -fsSL https://raw.githubusercontent.com/invictusbr1/stream-tv-app/main/deploy/servidor/Instalar-No-Servidor.sh | bash
# ou, se o projeto já estiver na máquina:
#   bash deploy/servidor/Instalar-No-Servidor.sh
#
# Variáveis opcionais:
#   ACESSO_CODIGO, CENTRAL_KEY, CENTRAL_TOKEN (se não passar, eu crio e mostro)
#   PASTA=/opt/conecta-tv   REPO=https://github.com/invictusbr1/stream-tv-app.git
set -euo pipefail

PASTA="${PASTA:-/opt/conecta-tv}"
REPO="${REPO:-https://github.com/invictusbr1/stream-tv-app.git}"
AZUL='\033[36m'; VERDE='\033[32m'; AMARELO='\033[33m'; CINZA='\033[90m'; FIM='\033[0m'
titulo() { echo -e "\n${AZUL}== $* ==${FIM}"; }
ok()     { echo -e "${VERDE}  $*${FIM}"; }
aviso()  { echo -e "${AMARELO}  $*${FIM}"; }
nota()   { echo -e "${CINZA}  $*${FIM}"; }

if [ "$(id -u)" = "0" ]; then SUDO=""; else SUDO="sudo"; fi

# ------------------------------------------------------------------ 1. Docker
titulo "Preparando o Docker"
if ! command -v docker >/dev/null 2>&1; then
    nota "Instalando o Docker (leva um ou dois minutos)..."
    if command -v dnf >/dev/null 2>&1; then
        $SUDO dnf install -y dnf-utils
        $SUDO dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
        $SUDO dnf install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
    elif command -v apt-get >/dev/null 2>&1; then
        $SUDO apt-get update -y
        $SUDO apt-get install -y ca-certificates curl gnupg
        curl -fsSL https://get.docker.com | $SUDO sh
    else
        curl -fsSL https://get.docker.com | $SUDO sh
    fi
fi
$SUDO systemctl enable --now docker >/dev/null 2>&1 || true
ok "Docker pronto: $(docker --version)"

# ------------------------------------------------------------------ 2. Código
titulo "Baixando o aplicativo"
if [ -f "./package.json" ] && [ -d "./central" ]; then
    PASTA="$(pwd)"
    ok "Usando o projeto que já está nesta pasta: $PASTA"
else
    if ! command -v git >/dev/null 2>&1; then
        if command -v apt-get >/dev/null 2>&1; then $SUDO apt-get install -y git; else $SUDO dnf install -y git; fi
    fi
    if [ -d "$PASTA/.git" ]; then
        nota "Atualizando o que já existe em $PASTA..."
        git -C "$PASTA" pull --rebase --autostash
    else
        $SUDO mkdir -p "$(dirname "$PASTA")"
        $SUDO git clone --depth 1 "$REPO" "$PASTA"
        $SUDO chown -R "$(id -u):$(id -g)" "$PASTA" 2>/dev/null || true
    fi
    ok "Código em $PASTA"
fi

# ------------------------------------------------------------------ 3. Segredos
titulo "Criando os segredos"
ARQ_ENV="$PASTA/deploy/servidor/.env"
if [ -f "$ARQ_ENV" ]; then
    nota "Já existe um .env — vou manter os valores atuais."
    # shellcheck disable=SC1090
    set -a; . "$ARQ_ENV"; set +a
fi
aleatorio() { head -c 32 /dev/urandom | base64 | tr -d '/+=' | cut -c1-24; }
ACESSO_CODIGO="${ACESSO_CODIGO:-$(aleatorio)}"
CENTRAL_KEY="${CENTRAL_KEY:-$(aleatorio)}"
CENTRAL_TOKEN="${CENTRAL_TOKEN:-$(aleatorio)}"
cat > "$ARQ_ENV" <<EOF
ACESSO_CODIGO=$ACESSO_CODIGO
CENTRAL_KEY=$CENTRAL_KEY
CENTRAL_TOKEN=$CENTRAL_TOKEN
GROQ_API_KEY=${GROQ_API_KEY:-}
GEMINI_API_KEY=${GEMINI_API_KEY:-}
SUPABASE_URL=${SUPABASE_URL:-}
SUPABASE_ANON_KEY=${SUPABASE_ANON_KEY:-}
TZ=${TZ:-America/Sao_Paulo}
ORIGENS_PERMITIDAS=
EOF
chmod 600 "$ARQ_ENV"
ok "Segredos guardados em $ARQ_ENV (só o dono lê)"

# ------------------------------------------------------------------ 4. Subir
titulo "Construindo e subindo os aplicativos"
cd "$PASTA"
docker compose --env-file "$ARQ_ENV" -f deploy/servidor/docker-compose.yml up -d --build
sleep 5
docker compose --env-file "$ARQ_ENV" -f deploy/servidor/docker-compose.yml ps

# ------------------------------------------------------------------ 5. Firewall
titulo "Liberando as portas"
if command -v ufw >/dev/null 2>&1 && $SUDO ufw status 2>/dev/null | grep -q "Status: active"; then
    $SUDO ufw allow 3000/tcp >/dev/null 2>&1 || true
    $SUDO ufw allow 4100/tcp >/dev/null 2>&1 || true
    ok "ufw liberado nas portas 3000 e 4100"
fi
if command -v iptables >/dev/null 2>&1; then
    # As imagens da Oracle vêm com regras que recusam tudo menos SSH.
    for PORTA in 3000 4100; do
        $SUDO iptables -C INPUT -p tcp --dport "$PORTA" -j ACCEPT 2>/dev/null || \
            $SUDO iptables -I INPUT 5 -p tcp --dport "$PORTA" -j ACCEPT 2>/dev/null || true
    done
    if command -v netfilter-persistent >/dev/null 2>&1; then $SUDO netfilter-persistent save >/dev/null 2>&1 || true; fi
    if [ -f /etc/sysconfig/iptables ]; then $SUDO service iptables save >/dev/null 2>&1 || true; fi
    ok "iptables ajustado (se o provedor usar)"
fi

IP="$(curl -fsS --max-time 8 https://api.ipify.org || hostname -I | awk '{print $1}')"

# ------------------------------------------------------------------ 6. Resumo
titulo "Pronto!"
echo "  Conecta TV ........: http://$IP:3000"
echo "  Central do painel .: http://$IP:4100"
echo "  Código de acesso ..: $ACESSO_CODIGO"
echo "  Chave da central ..: $CENTRAL_KEY"
nota ""
nota "Na Oracle, além disto, libere as portas 3000 e 4100 na Security List da VCN"
nota "(Rede → Sub-rede → Security List → Add Ingress Rule: 0.0.0.0/0, TCP, 3000,4100)."
nota "E reserve o IP público (Rede → IPs públicos reservados) para ele nunca mudar."
nota ""
nota "Atualizar depois de uma mudança no projeto:"
nota "  cd $PASTA && git pull && docker compose --env-file deploy/servidor/.env -f deploy/servidor/docker-compose.yml up -d --build"
nota "Ver os logs:  docker compose -f $PASTA/deploy/servidor/docker-compose.yml logs -f"
