#!/bin/sh
# Ancien nom, garde pour les raccourcis, services et lanceurs existants : voir demarrer_WEB_FERME.sh.
exec sh "$(dirname "$0")/demarrer_WEB_FERME.sh" "$@"
