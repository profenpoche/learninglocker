#!/usr/bin/env bash
# Lance run-legacy.sh détaché de la session SSH (survit à la déconnexion).
# Journal : ~/legacy/seed-run.log ; PID : ~/legacy/seed-run.pid
#
#   ./seed/launch-detached.sh               # passe complète
#   STATEMENTS=500 ./seed/launch-detached.sh  # passe courte de validation
#   ./seed/launch-detached.sh stop          # arrête une passe en cours
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ -f seed-run.pid ]] && kill -0 "$(cat seed-run.pid)" 2>/dev/null; then
  if [[ "${1:-}" == stop ]]; then
    kill -- -"$(cat seed-run.pid)" && rm -f seed-run.pid && echo "Arrêté."
    exit 0
  fi
  echo "Une passe tourne déjà (PID $(cat seed-run.pid))." >&2
  exit 1
fi
[[ "${1:-}" == stop ]] && { echo "Aucune passe en cours."; exit 0; }

setsid bash -c './seed/run-legacy.sh > seed-run.log 2>&1' < /dev/null > /dev/null 2>&1 &
echo $! > seed-run.pid
echo "Lancé (PID $!), journal : $PWD/seed-run.log"
