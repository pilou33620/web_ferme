"""Serveur de « La Ferme du Val Vert » — aucune dépendance externe.

    python server.py            → http://localhost:8000
    python server.py --port 9000 --nouvelle
    python server.py --host 0.0.0.0   → joignable depuis les autres appareils du réseau
    python server.py --sans-maj → ne pas chercher de mise à jour au démarrage
"""
from __future__ import annotations

import argparse
import json
import os
import signal
import socket
import sys
import threading
import time
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import mise_a_jour
from engine import GAME_MIN_PER_SEC, ActionError, Game

ROOT = Path(__file__).parent
WEB = ROOT / "web"
SAVE = ROOT / "sauvegarde.json"


class World:
    """Le jeu + l'horloge réelle, protégés par un verrou."""

    def __init__(self, fresh: bool):
        self.lock = threading.Lock()
        if SAVE.exists() and not fresh:
            try:
                self.game = Game.loads(SAVE.read_text(encoding="utf-8"))
            except (ValueError, KeyError):
                self.game = Game()
        else:
            self.game = Game()
        # le jeu démarre sur le menu principal : le temps ne s'écoule pas avant qu'on choisisse
        self.game.act({"type": "menu", "ouvert": True})
        self.last = time.monotonic()
        self.last_save = self.last
        self.version = mise_a_jour.version()
        self.maj = os.environ.get(mise_a_jour.ENV_MAJ)   # résumé de la mise à jour qui vient d'être installée
        if self.maj:
            self.game.log(f"Jeu mis à jour : {self.maj}", "succes")

    def view(self) -> dict:
        v = self.game.view()
        v["version"], v["maj"] = self.version, self.maj
        return v

    def tick(self):
        with self.lock:
            now = time.monotonic()
            dt, self.last = now - self.last, now
            self.game.advance(dt * GAME_MIN_PER_SEC * self.game.s["vitesse"])
            if now - self.last_save > 10:
                self.save()

    def save(self):
        SAVE.write_text(self.game.dumps(), encoding="utf-8")
        self.last_save = time.monotonic()


def make_handler(world: World):
    class Handler(SimpleHTTPRequestHandler):
        def __init__(self, *a, **kw):
            super().__init__(*a, directory=str(WEB), **kw)

        def log_message(self, *a):  # silence
            pass

        def _json(self, code: int, payload: dict):
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            if self.path.startswith("/api/etat"):
                world.tick()
                with world.lock:
                    return self._json(200, world.view())
            return super().do_GET()

        def do_POST(self):
            if not self.path.startswith("/api/action"):
                return self._json(404, {"erreur": "introuvable"})
            try:
                length = int(self.headers.get("Content-Length", 0))
                action = json.loads(self.rfile.read(length) or b"{}")
            except ValueError:
                return self._json(400, {"erreur": "JSON invalide"})
            world.tick()
            with world.lock:
                try:
                    msg = world.game.act(action)
                    ok = True
                except ActionError as e:
                    msg, ok = str(e), False
                world.save()
                return self._json(200 if ok else 422, {"ok": ok, "message": msg, "etat": world.view()})

    return Handler


def lan_ip():
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))
            return s.getsockname()[0]
    except OSError:
        return None


PORTS_CANDIDATS = [8000, 8001, 8002, 8080, 8888, 5000]


class FermeServer(ThreadingHTTPServer):
    def server_bind(self):
        # Sous Windows, SO_REUSEADDR permettrait de partager un port déjà pris :
        # on réserve le port en exclusivité pour échouer proprement à la place.
        if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            self.allow_reuse_address = False
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


def ouvrir_serveur(host, ports, handler):
    for port in ports:
        try:
            return FermeServer((host, port), handler), port
        except OSError as e:
            print(f"Port {port} indisponible ({e.strerror or e}), essai du suivant…")
    raise SystemExit(f"Aucun port libre parmi {ports}. Essayez --port <numéro>.")


def main():
    p = argparse.ArgumentParser(description="La Ferme du Val Vert")
    env_port = os.environ.get("PORT")
    p.add_argument("--port", type=int, default=int(env_port) if env_port else None,
                   help=f"port prioritaire (défaut : $PORT, sinon le premier libre parmi {PORTS_CANDIDATS})")
    p.add_argument("--host", default=os.environ.get("HOST", "127.0.0.1"),
                   help="adresse d'écoute : 127.0.0.1 = cet appareil seulement, 0.0.0.0 = tout le réseau local")
    p.add_argument("--nouvelle", action="store_true", help="ignorer la sauvegarde")
    p.add_argument("--sans-navigateur", action="store_true")
    p.add_argument("--sans-maj", action="store_true", help="ne pas chercher de mise à jour au démarrage")
    args = p.parse_args()
    for stream in (sys.stdout, sys.stderr):   # console Windows : ne jamais planter sur un accent ou un emoji
        try:
            stream.reconfigure(errors="replace", line_buffering=True)
        except AttributeError:
            pass

    # mise à jour automatique depuis git, puis redémarrage sur le nouveau code
    # (le code relancé reçoit FERME_MAJ et ne revérifie pas : pas de boucle)
    if not args.sans_maj and not os.environ.get(mise_a_jour.ENV_MAJ):
        resume = mise_a_jour.verifier()
        if resume:
            mise_a_jour.redemarrer(resume)

    world = World(fresh=args.nouvelle)

    def loop():
        while True:
            time.sleep(0.5)
            world.tick()

    threading.Thread(target=loop, daemon=True).start()
    ports = PORTS_CANDIDATS if args.port is None else [args.port] + [x for x in PORTS_CANDIDATS if x != args.port]
    srv, port = ouvrir_serveur(args.host, ports, make_handler(world))
    url = f"http://localhost:{port}"
    print(f"🌾 La Ferme du Val Vert tourne sur {url}  (Ctrl+C pour quitter)")
    if args.host not in ("127.0.0.1", "localhost"):
        ip = lan_ip()
        if ip:
            print(f"   depuis un autre appareil du réseau : http://{ip}:{port}")

    # arrêt demandé par un autre programme (launcher, kill…) → même sortie propre que Ctrl+C
    def stop(*_):
        raise KeyboardInterrupt
    for name in ("SIGTERM", "SIGBREAK"):
        if hasattr(signal, name):
            signal.signal(getattr(signal, name), stop)
    if not args.sans_navigateur:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        with world.lock:
            world.save()
        print("\nPartie sauvegardée.")


if __name__ == "__main__":
    main()
