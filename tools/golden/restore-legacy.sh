#!/usr/bin/env bash
# Remet la pile legacy dans l'état exact d'un instantané du jeu de test :
# base MongoDB, volume de fichiers, Redis vidé, récepteur de forwarding vidé.
# À lancer sur la VM depuis ~/legacy.
#
#   ./golden/restore-legacy.sh                    # snapshots/latest
#   ./golden/restore-legacy.sh snapshots/<date>
set -euo pipefail
cd "$(dirname "$0")/.."

SNAP=${1:-snapshots/latest}
MONGO=mongodb://127.0.0.1:27018/learninglocker_v2
[[ -f "$SNAP/learninglocker_v2.archive.gz" ]] || { echo "Instantané introuvable : $SNAP" >&2; exit 1; }

echo "==> Arrêt des services applicatifs"
docker compose stop nginx ui api xapi worker scheduler >/dev/null
docker compose up -d mongo redis echo >/dev/null
until docker compose exec -T mongo mongo --quiet --eval 'db.runCommand({ping:1}).ok' >/dev/null 2>&1; do sleep 1; done

echo "==> Base MongoDB ($SNAP)"
mongosh --quiet "$MONGO" --eval 'db.dropDatabase()' >/dev/null
mongorestore --uri="${MONGO%/*}" --gzip --archive="$SNAP/learninglocker_v2.archive.gz" --quiet

echo "==> Redis, fichiers, récepteur de forwarding"
docker compose exec -T redis redis-cli FLUSHALL >/dev/null
docker run --rm -v ll-legacy_storage:/data -v "$PWD/$SNAP:/in:ro" alpine sh -c 'rm -rf /data/* && tar -xzf /in/storage.tar.gz -C /data'
docker compose exec -T echo sh -c ': > /data/forwarded.ndjson'

echo "==> Redémarrage"
docker compose start scheduler worker xapi api ui nginx >/dev/null
for url in http://127.0.0.1:18080/api http://127.0.0.1:18080/data/xAPI/about http://127.0.0.1:18080/login; do
  until curl -fs -o /dev/null "$url"; do sleep 1; done
done
echo "Pile legacy restaurée depuis $SNAP"
