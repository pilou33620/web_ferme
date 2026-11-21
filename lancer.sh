#!/bin/sh
# La Ferme du Val Vert (Linux, macOS, Raspberry Pi) : obtient l'exécutable du jeu (binaires.sh) puis le lance.
#   ./lancer.sh [--port 8799] [--host ADRESSE | --local] [--nouvelle] [--sans-navigateur] [--sans-maj] [--sans-pause]
cd "$(dirname "$0")" || exit 1
. ./binaires.sh
# Le jeu sort avec le code 75 quand il vient de se mettre à jour (git pull) :
# on reprend l'exécutable de la nouvelle version, puis on le relance.
export FERME_RELANCEUR=1
while :; do
  obtenir_binaires && bin/ferme "$@"
  code=$?
  [ "$code" -eq 75 ] || break
done
exit "$code"
