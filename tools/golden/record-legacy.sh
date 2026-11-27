#!/usr/bin/env bash
# Enregistre le scénario golden sur la pile legacy, après restauration de l'instantané.
# À lancer sur la VM depuis ~/legacy.
#
#   ./golden/record-legacy.sh               # → snapshots/latest/golden/<date>
#   CHECK=1 ./golden/record-legacy.sh       # deux enregistrements + comparaison (contrôle du déterminisme)
#   XAPI_IMAGE=xapi-service:v2026-d ./golden/record-legacy.sh
#       candidat : xapi-service remplacé par cette image, enregistrement dans
#       snapshots/<instantané>/candidates/, comparaison avec golden/latest ; la référence n'est pas touchée.
#   API_IMAGE=ll-api:v2026 ./golden/record-legacy.sh
#       candidat : API Learning Locker 2026 (les routes non portées sont relayées vers api-legacy).
#       Nécessite LEGACY_MONGO=4.4 exporté (Mongoose 9 / driver 7 : serveur ≥ 4.4).
#   CANDIDATE=nom ./golden/record-legacy.sh
#       candidat sans changer d'image (ex. avec LEGACY_MONGO=4.4 exporté : pile legacy sur MongoDB 4.4).
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

if [[ -n "${XAPI_IMAGE:-}" || -n "${API_IMAGE:-}" || -n "${CANDIDATE:-}" ]]; then
  # Candidat : remplacer xapi-service et/ou l'API, enregistrer, comparer, puis remettre les images legacy.
  restore_images() {
    docker compose up -d --remove-orphans api xapi >/dev/null 2>&1 || true
    docker rm -f ll-presave >/dev/null 2>&1 || true
  }
  trap restore_images EXIT
  if [[ -n "${XAPI_IMAGE:-}" ]]; then
    XAPI_IMAGE="$XAPI_IMAGE" docker compose -f docker-compose.yml -f docker-compose.xapi-v2026.yml up -d xapi >/dev/null
  fi
  if [[ -n "${API_IMAGE:-}" ]]; then
    API_IMAGE="$API_IMAGE" docker compose -f docker-compose.yml -f docker-compose.api-v2026.yml up -d api api-legacy >/dev/null
  fi
  NAME=${CANDIDATE:-$(echo "${API_IMAGE:-$XAPI_IMAGE}" | tr ':/' '--')}
  CAND=$SNAP/candidates/$NAME-$STAMP
  mkdir -p "$(dirname "$CAND")"
  record "$CAND"
  echo "Candidat : $CAND"
  node golden/diff.mjs "$OUT/latest" "$CAND" --accept golden/accepted.json ${DIFF_ARGS:-} || true
  exit 0
fi

record "$OUT/$STAMP"
if [[ "${CHECK:-0}" == 1 ]]; then
  record "$OUT/$STAMP-bis"
  node golden/diff.mjs "$OUT/$STAMP" "$OUT/$STAMP-bis" --max 80 || true
fi
docker rm -f ll-presave >/dev/null
ln -sfn "$STAMP" "$OUT/latest"
echo "Enregistrement : $OUT/$STAMP"
