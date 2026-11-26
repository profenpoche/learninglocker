#!/usr/bin/env bash
# Génère l'oracle des pipelines de visualisation (voir pipelines.mjs).
# À lancer sur la VM depuis ~/legacy (copie de tools/oracle → ~/legacy/oracle) :
#
#   ./oracle/pipelines.sh [sortie]     # défaut : oracle/out/visualisation-pipelines.json.gz
#
# Démarre le service presave (vrai code du front, image legacy) dans un conteneur dédié
# (ll-presave-oracle, port 127.0.0.1:18091, distinct de ll-presave/18090 du golden), lit la base
# legacy en lecture seule, écrit les cas, puis arrête le conteneur dans tous les cas.
set -euo pipefail
cd "$(dirname "$0")/.."

NAME=ll-presave-oracle
PORT=18091
OUT=${1:-oracle/out/visualisation-pipelines.json.gz}

stop() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap stop EXIT
stop
docker compose run -d --rm --no-deps --name "$NAME" -p "127.0.0.1:$PORT:8090" \
  -v "$PWD/seed/legacy:/seed:ro" -e BABEL_ENV=test -e TZ=UTC --entrypoint sh api -c \
  'mkdir -p /tmp/alias && ln -sfn /opt/ll/ui/src /tmp/alias/ui && ln -sfn /opt/ll/lib /tmp/alias/lib && NODE_PATH=/tmp/alias:/opt/ll/node_modules exec node_modules/.bin/babel-node /seed/presave-server.js' >/dev/null
until curl -fs -X POST -o /dev/null "http://127.0.0.1:$PORT/templates"; do
  docker ps -q --filter "name=$NAME" | grep -q . || { echo "Le service presave s'est arrêté." >&2; exit 1; }
  sleep 2
done

PRESAVE="http://127.0.0.1:$PORT" node oracle/pipelines.mjs "$OUT"
