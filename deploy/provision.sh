#!/usr/bin/env bash
# Provisionnement du socle Learning Locker 2026 sur Ubuntu Server 24.04 LTS.
# Idempotent : peut être relancé sans effet de bord.
#
# Usage : sudo ./provision.sh [--harden-ssh]
#   --harden-ssh  désactive l'authentification SSH par mot de passe (vérifier
#                 d'abord qu'une clé fonctionne, sinon risque de perte d'accès).
#
# Composants : Node.js 24 LTS (NodeSource), MongoDB 8.0 (dépôt officiel),
# Redis (paquet Ubuntu), nginx, Docker Engine (pile legacy de référence),
# ufw, utilisateur système et arborescence /opt, /etc, /var/lib.

set -euo pipefail

NODE_MAJOR=24
MONGO_SERIES=8.0
APP_USER=learninglocker
HARDEN_SSH=false
[[ "${1:-}" == "--harden-ssh" ]] && HARDEN_SSH=true

log() { printf '\n==> %s\n' "$*"; }

if [[ $EUID -ne 0 ]]; then
  echo "À lancer avec sudo." >&2
  exit 1
fi

. /etc/os-release
if [[ "$ID" != "ubuntu" || "$VERSION_ID" != "24.04" ]]; then
  echo "Script prévu pour Ubuntu 24.04 (détecté : $PRETTY_NAME)." >&2
  exit 1
fi
CODENAME="$VERSION_CODENAME"   # noble
ARCH="$(dpkg --print-architecture)"
export DEBIAN_FRONTEND=noninteractive
APT_OPTS=(-y -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold)

# ---------------------------------------------------------------------------
log "Mise à jour du système"
apt-get update
apt-get "${APT_OPTS[@]}" upgrade
apt-get "${APT_OPTS[@]}" install ca-certificates curl gnupg build-essential \
  ufw jq unzip lvm2

# ---------------------------------------------------------------------------
log "Extension du volume racine (LVM) si de l'espace est libre"
ROOT_DEV="$(findmnt -no SOURCE /)"
if lvs "$ROOT_DEV" >/dev/null 2>&1; then
  VG="$(lvs --noheadings -o vg_name "$ROOT_DEV" | tr -d ' ')"
  FREE_EXTENTS="$(vgs --noheadings -o vg_free_count "$VG" | tr -d ' ')"
  if [[ "$FREE_EXTENTS" -gt 0 ]]; then
    lvextend -r -l +100%FREE "$ROOT_DEV"
  else
    echo "Aucun espace libre dans le VG $VG."
  fi
fi

# ---------------------------------------------------------------------------
install -d -m 0755 /etc/apt/keyrings

log "Node.js $NODE_MAJOR (NodeSource)"
if [[ ! -f /etc/apt/keyrings/nodesource.gpg ]]; then
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
    | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
fi
echo "deb [arch=$ARCH signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" \
  > /etc/apt/sources.list.d/nodesource.list

log "MongoDB $MONGO_SERIES (dépôt officiel)"
if [[ ! -f /etc/apt/keyrings/mongodb-server-${MONGO_SERIES}.gpg ]]; then
  curl -fsSL "https://www.mongodb.org/static/pgp/server-${MONGO_SERIES}.asc" \
    | gpg --dearmor -o "/etc/apt/keyrings/mongodb-server-${MONGO_SERIES}.gpg"
fi
echo "deb [arch=amd64,arm64 signed-by=/etc/apt/keyrings/mongodb-server-${MONGO_SERIES}.gpg] https://repo.mongodb.org/apt/ubuntu ${CODENAME}/mongodb-org/${MONGO_SERIES} multiverse" \
  > "/etc/apt/sources.list.d/mongodb-org-${MONGO_SERIES}.list"

log "Docker Engine (dépôt officiel)"
if [[ ! -f /etc/apt/keyrings/docker.asc ]]; then
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
fi
echo "deb [arch=$ARCH signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${CODENAME} stable" \
  > /etc/apt/sources.list.d/docker.list

apt-get update
apt-get "${APT_OPTS[@]}" install nodejs mongodb-org redis-server nginx \
  docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# ---------------------------------------------------------------------------
log "Réglages noyau recommandés pour MongoDB 8.0 (THP, swappiness)"
# MongoDB 8.0 (tcmalloc) recommande THP « always », defrag « defer+madvise »,
# max_ptes_none à 0 et une swappiness basse.
cat > /etc/systemd/system/mongodb-thp.service <<'EOF'
[Unit]
Description=Réglages Transparent Huge Pages pour MongoDB 8.0
DefaultDependencies=no
After=sysinit.target local-fs.target
Before=mongod.service

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/bin/sh -c 'echo always > /sys/kernel/mm/transparent_hugepage/enabled && echo defer+madvise > /sys/kernel/mm/transparent_hugepage/defrag && echo 0 > /sys/kernel/mm/transparent_hugepage/khugepaged/max_ptes_none'

[Install]
WantedBy=basic.target
EOF
systemctl daemon-reload
systemctl enable --now mongodb-thp.service
echo 'vm.swappiness = 1' > /etc/sysctl.d/60-mongodb.conf
sysctl -q -p /etc/sysctl.d/60-mongodb.conf

log "Configuration MongoDB (écoute locale uniquement)"
# Le mongod.conf fourni écoute déjà sur 127.0.0.1 ; on le vérifie.
grep -qE '^\s*bindIp:\s*127\.0\.0\.1\s*$' /etc/mongod.conf \
  || echo "ATTENTION : bindIp de /etc/mongod.conf n'est pas 127.0.0.1" >&2
systemctl enable mongod
systemctl restart mongod

log "Configuration Redis"
REDIS_CONF=/etc/redis/redis.conf
sed -i -E 's/^#?\s*supervised .*/supervised systemd/' "$REDIS_CONF"
sed -i -E 's/^#?\s*maxmemory-policy .*/maxmemory-policy noeviction/' "$REDIS_CONF"
grep -qE '^bind 127\.0\.0\.1' "$REDIS_CONF" \
  || echo "ATTENTION : Redis n'est pas lié à 127.0.0.1" >&2
# Recommandation Redis pour la persistance en arrière-plan.
echo 'vm.overcommit_memory = 1' > /etc/sysctl.d/60-redis.conf
sysctl -q -p /etc/sysctl.d/60-redis.conf
systemctl enable redis-server
systemctl restart redis-server

log "nginx et Docker"
systemctl enable --now nginx
systemctl enable --now docker
SUDO_USER_NAME="${SUDO_USER:-}"
if [[ -n "$SUDO_USER_NAME" && "$SUDO_USER_NAME" != "root" ]]; then
  usermod -aG docker "$SUDO_USER_NAME"
fi

# ---------------------------------------------------------------------------
log "Utilisateur système et arborescence"
if ! id "$APP_USER" >/dev/null 2>&1; then
  useradd --system --home-dir /opt/learninglocker --shell /usr/sbin/nologin "$APP_USER"
fi
install -d -m 0755 -o root -g root /opt/learninglocker
install -d -m 0750 -o root -g "$APP_USER" /etc/learninglocker
install -d -m 0750 -o "$APP_USER" -g "$APP_USER" /var/lib/learninglocker /var/lib/learninglocker/storage
install -d -m 0750 -o root -g root /var/backups/learninglocker

# ---------------------------------------------------------------------------
log "Pare-feu (ufw)"
ufw allow OpenSSH >/dev/null
ufw allow 'Nginx Full' >/dev/null
ufw --force enable >/dev/null
ufw status verbose

if $HARDEN_SSH; then
  log "Durcissement SSH (clés uniquement)"
  cat > /etc/ssh/sshd_config.d/90-hardening.conf <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
EOF
  sshd -t && systemctl reload ssh
fi

# ---------------------------------------------------------------------------
log "Versions installées"
echo "node    $(node --version)  npm $(npm --version)"
echo "mongod  $(mongod --version | head -1)"
echo "mongosh $(mongosh --version)"
echo "redis   $(redis-server --version | awk '{print $3}')"
echo "nginx   $(nginx -v 2>&1)"
echo "docker  $(docker --version)"
df -h /
[[ -f /var/run/reboot-required ]] && echo "REDÉMARRAGE NÉCESSAIRE (noyau ou bibliothèques mis à jour)."
log "Terminé"
