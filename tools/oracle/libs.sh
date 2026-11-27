#!/usr/bin/env bash
# Démarre / arrête le serveur d'oracle des briques communes (lib-oracle-server.js) et, en mode « run »,
# génère les fixtures (voir libs.mjs). À lancer sur la VM depuis ~/legacy (copie de tools/oracle → oracle/).
#
#   ./oracle/libs.sh            # démarre, génère oracle/out/*.json.gz, arrête
#   ./oracle/libs.sh start      # démarre seulement (port 127.0.0.1:18092)
#   ./oracle/libs.sh stop
#
# Le conteneur (ll-lib-oracle) n'est PAS sur le réseau de la pile : il ne peut joindre aucune base.
set -euo pipefail
cd "$(dirname "$0")/.."

NAME=ll-lib-oracle
PORT=18092
IMAGE=ll-legacy/learninglocker:master

stop() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
start() {
  stop
  docker run -d --rm --name "$NAME" -p "127.0.0.1:$PORT:8090" \
    -v "$PWD/oracle/legacy:/oracle:ro" -e BABEL_ENV=test -e TZ=UTC \
    -e MONGODB_PATH=mongodb://base-interdite.invalid:1/aucune -e REDIS_URL=redis://redis-interdit.invalid:1 \
    -w /opt/ll --entrypoint sh "$IMAGE" -c \
    'mkdir -p /tmp/alias && ln -sfn /opt/ll/ui/src /tmp/alias/ui && ln -sfn /opt/ll/lib /tmp/alias/lib && ln -sfn /opt/ll/api/src /tmp/alias/api && NODE_PATH=/tmp/alias:/opt/ll/node_modules exec node_modules/.bin/babel-node /oracle/lib-oracle-server.js' >/dev/null
  until curl -fs -X POST -o /dev/null -d '{"value":"6b083fe419b92523f89d6725"}' "http://127.0.0.1:$PORT/objectid"; do
    docker ps -q --filter "name=$NAME" | grep -q . || { echo "Le serveur d'oracle s'est arrêté :" >&2; docker logs "$NAME" 2>&1 | tail -20 >&2; exit 1; }
    sleep 2
  done
}

case "${1:-run}" in
  start) start ;;
  stop) stop ;;
  run)
    trap stop EXIT
    start
    ORACLE="http://127.0.0.1:$PORT" node oracle/libs.mjs oracle/out
    ;;
  *) echo "usage : $0 [run|start|stop]" >&2; exit 2 ;;
esac
