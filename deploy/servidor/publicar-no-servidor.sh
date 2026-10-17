#!/usr/bin/env bash
# Instalado como /usr/local/sbin/conecta-publicar. Executado por systemd-run.
set -Eeuo pipefail
umask 077
ID="${1:-}"
SHA="${2:-}"
[[ "$ID" =~ ^[a-f0-9]{64}$ && "$SHA" =~ ^[a-f0-9]{64}$ ]] || exit 64
ROOT=/opt/conecta-tv
STATE=/var/lib/conecta-tv-updates
ENVFILE="$ROOT/deploy/servidor/.env"
ARCHIVE="/home/ubuntu/conecta-updates/$ID.tar.gz"
mkdir -p "$STATE/results" "$STATE/logs" "$STATE/backups" "$STATE/work"
STARTED="$(date -u +%FT%TZ)"
record() {
    python3 - "$STATE/results/$ID.json" "$ID" "$1" "$2" "$STARTED" <<'PY'
import json,os,sys,datetime
file,release,phase,message,started=sys.argv[1:]
with open(file+'.tmp','w') as out:
 json.dump(dict(id=release,phase=phase,message=message,started=started,updated=datetime.datetime.now(datetime.timezone.utc).isoformat()),out)
os.chmod(file+'.tmp',0o644)
os.replace(file+'.tmp',file)
PY
}
exec 9>"$STATE/deploy.lock"
if ! flock -n 9; then record busy 'Outra publicação já está em andamento.'; exit 75; fi
exec >>"$STATE/logs/$ID.log" 2>&1
record validating 'Validando pacote e configuração.'
STAGE="$(mktemp -d "$STATE/work/release-XXXXXXXX")"
BACKUP="$(mktemp -d "$STATE/backups/anterior-XXXXXXXX")"
CHANGED=0
NOTICE_READY=0
OLD_APP=''
OLD_CENTRAL=''
OLD_HTTPS=''
dc() { docker compose -p servidor --env-file "$ENVFILE" -f "$ROOT/deploy/servidor/docker-compose.yml" -f "$ROOT/deploy/servidor/docker-compose.oracle.yml" "$@"; }
stage_dc() { docker compose -p servidor --env-file "$ENVFILE" -f "$STAGE/deploy/servidor/docker-compose.yml" -f "$STAGE/deploy/servidor/docker-compose.oracle.yml" "$@"; }
notice() {
    [ "$NOTICE_READY" = 1 ] || return 0
    # Usa o disco persistente do app, inclusive ao publicar sobre uma versão antiga.
    dc exec -T app node - "$ID" "$1" < "$STAGE/avisos-servidor-store.cjs"
}
sync_code() {
    rsync -a --delete --exclude='.env' --exclude='config.local.json' --exclude='app.local.json' \
      --exclude='acessos.json' --exclude='autorizados.json' --exclude='bloqueados.json' \
      --exclude='dados/' --exclude='.git/' "$1/" "$ROOT/"
}
cleanup() {
    if [[ "$(dirname "$STAGE")" = "$STATE/work" && "$(basename "$STAGE")" = release-* ]]; then rm -rf -- "$STAGE"; fi
}
rollback() {
    local code=$?
    trap - ERR
    set +e
    [ -z "$OLD_APP" ] || docker tag "$OLD_APP" conecta-tv:servidor
    [ -z "$OLD_CENTRAL" ] || docker tag "$OLD_CENTRAL" conecta-tv-central:servidor
    [ -z "$OLD_HTTPS" ] || docker tag "$OLD_HTTPS" caddy:2-alpine
    if [ "$CHANGED" = 1 ]; then
        record rolling_back 'A nova versão falhou; restaurando a versão anterior.'
        sync_code "$BACKUP"
        dc up -d --no-build --force-recreate
        restored=0
        for attempt in $(seq 1 45); do
            app="$(dc ps -q app)"; central="$(dc ps -q central)"
            a="$(docker inspect --format '{{.State.Health.Status}}' "$app" 2>/dev/null)"
            c="$(docker inspect --format '{{.State.Health.Status}}' "$central" 2>/dev/null)"
            if [ "$a" = healthy ] && [ "$c" = healthy ]; then restored=1; break; fi
            sleep 2
        done
        if [ "$restored" = 1 ]; then notice restaurada || true; record rolled_back 'A nova versão falhou. A versão anterior foi restaurada e passou na verificação de saúde.'
        else notice falha || true; record failed 'A publicação e a recuperação precisam de verificação manual.'; fi
    else
        notice cancelada || true
        record failed 'O pacote não foi publicado. Os serviços anteriores foram mantidos.'
    fi
    exit "${code:-1}"
}
trap cleanup EXIT
trap rollback ERR
[ "$(id -u)" = 0 ]
[ -s "$ENVFILE" ]
[ "$(df --output=avail -B1 "$ROOT" | tail -1 | tr -d ' ')" -ge 3221225472 ]
[ "$(sha256sum "$ARCHIVE" | cut -d' ' -f1)" = "$SHA" ]
python3 - "$ARCHIVE" "$STAGE" "$ID" <<'PY'
import tarfile,sys,pathlib,json
archive,destination,release=sys.argv[1:]
with tarfile.open(archive,'r:gz') as tar:
 for member in tar.getmembers():
  name=pathlib.PurePosixPath(member.name)
  if name.is_absolute() or '..' in name.parts or '\\' in member.name or not member.isfile(): raise ValueError('Entrada inválida no pacote')
  if name.name in ['.env','config.local.json','app.local.json','acessos.json','autorizados.json','bloqueados.json'] or name.suffix.lower() in ['.key','.pem','.p12']: raise ValueError('Arquivo privado no pacote')
  if any(p in ['node_modules','dados','.git'] for p in name.parts): raise ValueError('Dados locais no pacote')
 tar.extractall(destination,filter='data')
with open(pathlib.Path(destination)/'.conecta-release.json') as file:
 if json.load(file).get('id')!=release: raise ValueError('Identificador divergente')
for file in ['package.json','package-lock.json','server.js','index.html','Dockerfile','central/servidor.js','deploy/servidor/docker-compose.yml','deploy/servidor/docker-compose.oracle.yml']:
 if not (pathlib.Path(destination)/file).is_file(): raise ValueError('Pacote incompleto: '+file)
PY
cat > "$STATE/validar-compose.py" <<'PY'
import json,sys
data=json.load(sys.stdin)
values={}
for line in open(sys.argv[1]):
 if '=' in line and not line.lstrip().startswith('#'):
  key,value=line.rstrip('\n').split('=',1);values[key]=value.strip().strip('"').strip("'")
services=data['services']
assert set(services)=={'app','central','https'},'Serviços inesperados'
for service,source,target in [('app','dados-app','/dados'),('central','dados-central','/dados'),('https','certificados','/data')]:
 assert any(v.get('source')==source and v.get('target')==target and v.get('type')=='volume' for v in services[service].get('volumes',[])), 'Volume persistente alterado'
 assert data['volumes'][source]['name']=='servidor_'+source,'Nome do volume persistente alterado'
for service,key in [('app','ACESSO_CODIGO'),('central','CENTRAL_KEY'),('app','CENTRAL_TOKEN'),('central','CENTRAL_TOKEN')]:
 assert values.get(key) and services[service]['environment'].get(key)==values[key], 'Credencial do serviço divergente'
for service in ['app','central']:
 assert all(p.get('host_ip')=='127.0.0.1' for p in services[service].get('ports',[])), 'Serviço privado exposto'
assert services['app']['image']=='conecta-tv:servidor'
assert services['central']['image']=='conecta-tv-central:servidor'
assert services['https']['image']=='caddy:2-alpine'
PY
stage_dc config --format json | python3 "$STATE/validar-compose.py" "$ENVFILE"
NOTICE_READY=1
ENV_HASH="$(sha256sum "$ENVFILE" | cut -d' ' -f1)"
OLD_APP="$(docker inspect --format '{{.Image}}' servidor-app-1)"
OLD_CENTRAL="$(docker inspect --format '{{.Image}}' servidor-central-1)"
OLD_HTTPS="$(docker inspect --format '{{.Image}}' servidor-https-1)"
docker tag "$OLD_APP" "conecta-tv:anterior-${ID:0:12}"
docker tag "$OLD_CENTRAL" "conecta-tv-central:anterior-${ID:0:12}"
docker tag "$OLD_HTTPS" "conecta-tv-https:anterior-${ID:0:12}"
record building 'Construindo os serviços, um de cada vez. A versão atual continua atendendo.'
notice preparando
stage_dc build app
stage_dc build central
notice reiniciando
record notifying 'Avisando quem está assistindo. Reinício em 45 segundos.'
sleep 45
record installing 'Aplicando a nova versão e preservando dados e senhas.'
rsync -a --exclude='.env' --exclude='config.local.json' --exclude='app.local.json' --exclude='dados/' "$ROOT/" "$BACKUP/"
OLD_CADDY="$(sha256sum "$ROOT/deploy/servidor/Caddyfile" | cut -d' ' -f1)"
CHANGED=1
sync_code "$STAGE"
[ "$(sha256sum "$ENVFILE" | cut -d' ' -f1)" = "$ENV_HASH" ]
dc up -d --no-build
if [ "$(sha256sum "$ROOT/deploy/servidor/Caddyfile" | cut -d' ' -f1)" != "$OLD_CADDY" ]; then dc up -d --no-build --force-recreate https; fi
record checking 'Verificando aplicativo, Central e arquivos essenciais.'
HEALTHY=0
for attempt in $(seq 1 60); do
    app="$(dc ps -q app)"; central="$(dc ps -q central)"
    a="$(docker inspect --format '{{.State.Health.Status}}' "$app" 2>/dev/null || true)"
    c="$(docker inspect --format '{{.State.Health.Status}}' "$central" 2>/dev/null || true)"
    if [ "$a" = healthy ] && [ "$c" = healthy ]; then HEALTHY=1; break; fi
    sleep 2
done
[ "$HEALTHY" = 1 ]
dc exec -T app node - <<'NODE'
const assert=require('node:assert/strict');
(async()=>{
 const login=await fetch('http://127.0.0.1:3000/api/entrar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({codigo:process.env.ACESSO_CODIGO,nome:'Verificação de atualização',aparelho:'Servidor',dispositivo:'verificacao-atualizacao-oracle'}),signal:AbortSignal.timeout(15000)});
 assert.equal(login.status,200); const token=(await login.json()).token; assert.ok(token);
 for(const route of ['/','/playback.js','/catalog.js']) {
  const r=await fetch('http://127.0.0.1:3000'+route,{headers:{'X-Acesso':token},signal:AbortSignal.timeout(15000)});
  assert.equal(r.status,200,route); assert.ok((await r.arrayBuffer()).byteLength>0,route);
 }
 const denied=await fetch('http://127.0.0.1:3000/api/dispositivos'); assert.equal(denied.status,401);
})().catch(e=>{console.error(e.message);process.exitCode=1;});
NODE
dc exec -T central node - <<'NODE'
const assert=require('node:assert/strict');
(async()=>{
 const r=await fetch('http://127.0.0.1:4100/api/status',{headers:{'X-Chave':process.env.CENTRAL_KEY},signal:AbortSignal.timeout(15000)});
 assert.equal(r.status,200);
})().catch(e=>{console.error(e.message);process.exitCode=1;});
NODE
PUBLIC_IP="$(python3 - "$ENVFILE" <<'PY'
import sys,ipaddress
values=dict(line.rstrip('\n').split('=',1) for line in open(sys.argv[1]) if '=' in line and not line.lstrip().startswith('#'))
print(ipaddress.IPv4Address(values['PUBLIC_IP'].strip().strip('"').strip("'")))
PY
)"
curl --fail --silent --show-error --max-time 20 "https://$PUBLIC_IP/api/health" | python3 -c 'import json,sys; assert json.load(sys.stdin).get("status")=="ok"'
notice concluida
record healthy 'Versão publicada e verificada. Dados, volumes e códigos de acesso foram preservados.'
cp "$STATE/results/$ID.json" "$STATE/current.json"
# Limita históricos de código e pacotes; nunca remove volumes de dados.
python3 - "$STATE" /home/ubuntu/conecta-updates <<'PY'
import pathlib,sys,shutil
state,incoming=map(pathlib.Path,sys.argv[1:])
for directory,pattern,keep in [(state/'backups','anterior-*',3),(incoming,'*.tar.gz',3),(state/'logs','*.log',10),(state/'results','*.json',10)]:
 entries=sorted(directory.glob(pattern),key=lambda p:p.stat().st_mtime,reverse=True)
 for entry in entries[keep:]:
  if entry.parent.resolve()!=directory.resolve() or entry.is_symlink(): continue
  if entry.is_dir(): shutil.rmtree(entry)
  else: entry.unlink()
PY
