"""Mise à jour automatique du jeu depuis son dépôt git, au démarrage.

Règle d'or : ne jamais rien écraser. La mise à jour n'est faite qu'en « avance rapide »
(fast-forward) et seulement si aucun fichier du jeu n'a été modifié localement. Dans tous
les autres cas (pas de git, pas de réseau, modifications ou commits locaux), on le signale
et le jeu se lance tel quel.
"""
from __future__ import annotations

import os
import runpy
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).parent
ENV_MAJ = "FERME_MAJ"          # transmis au processus relancé : résumé de la mise à jour installée


def _git(*args: str, timeout: float = 20) -> tuple[int, str, str]:
    env = {**os.environ, "GIT_TERMINAL_PROMPT": "0"}   # jamais de demande de mot de passe bloquante
    r = subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True, encoding="utf-8",
                       errors="replace", timeout=timeout, env=env)
    return r.returncode, r.stdout.strip(), r.stderr.strip()


def _raison(err: str) -> str:
    """La ligne utile d'un message d'erreur git (« fatal: … »), sans son préfixe."""
    lines = [l.strip() for l in err.splitlines() if l.strip()]
    line = next((l for l in lines if l.startswith(("fatal:", "error:"))), lines[0] if lines else "erreur inconnue")
    return line.split(":", 1)[1].strip() if line.startswith(("fatal:", "error:")) else line


def version() -> str:
    """Identifiant court de la version installée (commit), ou chaîne vide hors git."""
    try:
        code, out, _ = _git("rev-parse", "--short", "HEAD", timeout=5)
        return out if code == 0 else ""
    except (OSError, subprocess.SubprocessError):
        return ""


def verifier() -> str | None:
    """Cherche et installe une mise à jour. Renvoie un résumé si le code a changé, sinon None.

    Ne lève jamais d'exception : au pire, le jeu démarre avec la version actuelle.
    """
    try:
        code, inside, _ = _git("rev-parse", "--is-inside-work-tree", timeout=5)
        if code or inside != "true":
            print("Mises à jour : le jeu n'est pas dans un dépôt git, vérification ignorée.")
            return None
        code, upstream, _ = _git("rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}", timeout=5)
        if code:
            print("Mises à jour : aucune branche distante suivie, vérification ignorée.")
            return None

        print("Recherche de mises à jour…")
        code, _, err = _git("fetch", "--quiet", timeout=30)
        if code:
            print(f"Mises à jour : dépôt injoignable ({_raison(err)}). "
                  "On joue avec la version actuelle.")
            return None

        _, counts, _ = _git("rev-list", "--left-right", "--count", f"HEAD...{upstream}")
        ahead, behind = (int(x) for x in counts.split())
        if behind == 0:
            print(f"Le jeu est à jour (version {version()}).")
            return None
        if ahead:
            print(f"Mises à jour : {behind} disponible(s), mais {ahead} commit(s) local(aux) non publié(s). "
                  "Fusionnez à la main (git pull) : rien n'a été modifié.")
            return None
        _, dirty, _ = _git("status", "--porcelain", "--untracked-files=no")
        if dirty:
            print(f"Mises à jour : {behind} disponible(s), mais des fichiers du jeu ont été modifiés sur ce poste. "
                  "Mise à jour ignorée pour ne rien écraser.")
            return None

        _, log, _ = _git("log", "--format=%s", f"HEAD..{upstream}")
        before = version()
        code, _, err = _git("merge", "--ff-only", upstream, timeout=60)
        if code:
            print(f"Mises à jour : installation impossible ({_raison(err)}). "
                  "On joue avec la version actuelle.")
            return None

        titles = [t for t in log.splitlines() if t.strip()]
        resume = " · ".join(titles[:3]) + (f" (et {len(titles) - 3} autre(s))" if len(titles) > 3 else "")
        print(f"Mise à jour installée : {before} → {version()} ({behind} nouveauté(s)).")
        for t in titles[:5]:
            print(f"  • {t}")
        return resume or f"{behind} nouveauté(s)"
    except (OSError, subprocess.SubprocessError, ValueError) as e:
        print(f"Mises à jour : vérification impossible ({e}). On joue avec la version actuelle.")
        return None


def redemarrer(resume: str):
    """Relance le jeu sur le nouveau code (mêmes arguments), sans revérifier les mises à jour.

    Le redémarrage se fait dans le même processus : les modules du jeu sont oubliés puis
    `server.py` est réexécuté. Un lanceur garde ainsi la main sur le processus
    qu'il a démarré, et l'arrêter arrête bien le jeu.
    """
    print("Redémarrage du jeu sur la nouvelle version…\n", flush=True)
    os.environ[ENV_MAJ] = resume
    for name, mod in list(sys.modules.items()):
        f = getattr(mod, "__file__", None)
        if f and Path(f).resolve().parent == ROOT.resolve() and name != "__main__":
            del sys.modules[name]
    runpy.run_path(str(ROOT / "server.py"), run_name="__main__")
    sys.exit(0)
