#!/usr/bin/env bash
# Génère le jeu de données de test sur la pile legacy, puis en fait un instantané.
# À lancer sur la VM, depuis ~/legacy (où se trouvent docker-compose.yml et seed/).
#
#   ./seed/run-legacy.sh            # base vierge, seed complet, instantané
#   KEEP=1 ./seed/run-legacy.sh     # ne pas effacer les volumes existants
#   SNAPSHOT_ONLY=1 ./seed/run-legacy.sh  # refaire seulement l'instantané de snapshots/latest
#
# Produit dans ~/legacy/snapshots/<date>/ :
#   learninglocker_v2.archive.gz  (mongodump de la base legacy MongoDB 4.2)
#   storage.tar.gz                (fichiers : logos, exports, CSV, pièces jointes, states)
#   manifest.json                 (identifiants, clés des clients, comptes de test)
#   inventory.json                (inventaire tools/verify-db)
#   forwarded.ndjson              (requêtes reçues par le récepteur de forwarding)
set -euo pipefail
cd "$(dirname "$0")/.."

ADMIN_EMAIL=admin@profenpoche.test
ADMIN_PASSWORD=Admin-Test-2026
ORG_NAME="Profenpoche Test"
STAMP=$(date -u +%Y%m%dT%H%MZ)
SNAP=snapshots/$STAMP
MONGO=mongodb://127.0.0.1:27018/learninglocker_v2

log() { printf '\n==> %s\n' "$*"; }

if [[ "${SNAPSHOT_ONLY:-0}" == 1 ]]; then
  STAMP=$(readlink snapshots/latest)
  SNAP=snapshots/$STAMP
  docker compose up -d
else

if [[ "${KEEP:-0}" != 1 ]]; then
  log "Remise à zéro de la pile legacy (volumes compris)"
  docker compose down -v --remove-orphans
fi
docker rm -f ll-presave >/dev/null 2>&1 || true

log "Démarrage de MongoDB 4.2 et Redis 4"
docker compose up -d mongo redis
until docker compose exec -T mongo mongo --quiet --eval 'db.runCommand({ping:1}).ok' >/dev/null 2>&1; do sleep 2; done

log "Migrations et administrateur du site"
docker compose run --rm -T api node cli/dist/server migrateMongo --up
docker compose run --rm -T api node cli/dist/server createSiteAdmin "$ADMIN_EMAIL" "$ORG_NAME" "$ADMIN_PASSWORD"

log "Démarrage de toute la pile"
docker compose up -d
for url in http://127.0.0.1:18080/api http://127.0.0.1:18080/data/xAPI/about http://127.0.0.1:18080/login; do
  until curl -fs -o /dev/null "$url"; do sleep 2; done
done

log "Service presave (code de sérialisation du front React)"
docker compose run -d --rm --no-deps --name ll-presave -p 127.0.0.1:18090:8090 \
  -v "$PWD/seed/legacy:/seed:ro" -e BABEL_ENV=test --entrypoint sh api -c \
  'mkdir -p /tmp/alias && ln -sfn /opt/ll/ui/src /tmp/alias/ui && ln -sfn /opt/ll/lib /tmp/alias/lib && NODE_PATH=/tmp/alias:/opt/ll/node_modules exec node_modules/.bin/babel-node /seed/presave-server.js' >/dev/null
until curl -fs -X POST -o /dev/null http://127.0.0.1:18090/templates; do
  if ! docker ps -q --filter name=ll-presave | grep -q .; then
    echo "Le service presave s'est arrêté (relancer sans -d pour voir l'erreur)." >&2; exit 1
  fi
  sleep 2
done

log "Génération des données (API publiques)"
mkdir -p "$SNAP"
OUT="$SNAP" ADMIN_EMAIL="$ADMIN_EMAIL" ADMIN_PASSWORD="$ADMIN_PASSWORD" node seed/seed.mjs

log "Formes de données héritées"
mongosh --quiet "$MONGO" seed/legacy-quirks.js | tee "$SNAP/legacy-quirks.json"

docker rm -f ll-presave >/dev/null
fi

log "Attente de la fin des écritures du worker"
# Le worker continue d'alimenter le cache du query builder quelques minutes après le seed :
# on attend que la base ne bouge plus (2 mesures identiques à 30 s d'écart, 15 min au plus).
footprint() { mongosh --quiet "$MONGO" --eval 'print(db.getCollectionNames().sort().map(c => c + "=" + db[c].estimatedDocumentCount()).join(" "))'; }
prev=$(footprint)
for _ in $(seq 1 30); do
  sleep 30
  cur=$(footprint)
  [[ "$cur" == "$prev" ]] && break
  prev=$cur
done

log "Instantané (services applicatifs arrêtés, pour un inventaire et un dump identiques)"
docker compose stop nginx ui api xapi worker scheduler
mongosh --quiet "$MONGO" verify-db/inventory.js > "$SNAP/inventory.json"
mongodump --uri="$MONGO" --gzip --archive="$SNAP/learninglocker_v2.archive.gz" --quiet
docker run --rm -v ll-legacy_storage:/data:ro -v "$PWD/$SNAP:/out" alpine tar -czf /out/storage.tar.gz -C /data .
docker compose cp echo:/data/forwarded.ndjson "$SNAP/forwarded.ndjson" 2>/dev/null || true
docker compose start scheduler worker xapi api ui nginx
ln -sfn "$STAMP" snapshots/latest
ls -lh "$SNAP"
log "Terminé : $SNAP"
