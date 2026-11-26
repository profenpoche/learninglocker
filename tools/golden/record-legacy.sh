#!/usr/bin/env bash
# Enregistre le scénario golden sur la pile legacy, après restauration de l'instantané.
# À lancer sur la VM depuis ~/legacy.
#
#   ./golden/record-legacy.sh               # → snapshots/latest/golden/<date>
#   CHECK=1 ./golden/record-legacy.sh       # deux enregistrements + comparaison (contrôle du déterminisme)
set -euo pipefail
cd "$(dirname "$0")/.."

SNAP=snapshots/$(readlink snapshots/latest)
OUT=$SNAP/golden
mkdir -p "$OUT"

start_presave() {
  docker rm -f ll-presave >/dev/null 2>&1 || true
  docker compose run -d --rm --no-deps --name ll-presave -p 127.0.0.1:18090:8090 \
    -v "$PWD/seed/legacy:/seed:ro" -e BABEL_ENV=test --entrypoint sh api -c \
    'mkdir -p /tmp/alias && ln -sfn /opt/ll/ui/src /tmp/alias/ui && ln -sfn /opt/ll/lib /tmp/alias/lib && NODE_PATH=/tmp/alias:/opt/ll/node_modules exec node_modules/.bin/babel-node /seed/presave-server.js' >/dev/null
  until curl -fs -X POST -o /dev/null http://127.0.0.1:18090/templates; do
    docker ps -q --filter name=ll-presave | grep -q . || { echo "Le service presave s'est arrêté." >&2; exit 1; }
    sleep 2
  done
}

record() {
  ./golden/restore-legacy.sh "$SNAP"
  PRESAVE=http://127.0.0.1:18090 MANIFEST="$SNAP/manifest.json" node golden/record.mjs "$1"
}

start_presave
STAMP=$(date -u +%Y%m%dT%H%MZ)
record "$OUT/$STAMP"
if [[ "${CHECK:-0}" == 1 ]]; then
  record "$OUT/$STAMP-bis"
  node golden/diff.mjs "$OUT/$STAMP" "$OUT/$STAMP-bis" --max 80 || true
fi
docker rm -f ll-presave >/dev/null
ln -sfn "$STAMP" "$OUT/latest"
echo "Enregistrement : $OUT/$STAMP"
