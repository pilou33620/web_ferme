"""Serveur de « La Ferme du Val Vert » — aucune dépendance externe.

    python server.py            → http://localhost:8000
    python server.py --port 9000 --nouvelle
    python server.py --host 0.0.0.0   → joignable depuis les autres appareils du réseau
"""
from __future__ import annotations

import argparse
import json
import os
import signal
import socket
import threading
import time
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

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
        self.last = time.monotonic()
        self.last_save = self.last

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
                    return self._json(200, world.game.view())
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
                return self._json(200 if ok else 422, {"ok": ok, "message": msg, "etat": world.game.view()})

    return Handler


def lan_ip():
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))
            return s.getsockname()[0]
    except OSError:
        return None


def main():
    p = argparse.ArgumentParser(description="La Ferme du Val Vert")
    p.add_argument("--port", type=int, default=int(os.environ.get("PORT", 8000)),
                   help="port d'écoute (défaut : $PORT ou 8000)")
    p.add_argument("--host", default=os.environ.get("HOST", "127.0.0.1"),
                   help="adresse d'écoute : 127.0.0.1 = cet appareil seulement, 0.0.0.0 = tout le réseau local")
    p.add_argument("--nouvelle", action="store_true", help="ignorer la sauvegarde")
    p.add_argument("--sans-navigateur", action="store_true")
    args = p.parse_args()

    world = World(fresh=args.nouvelle)

    def loop():
        while True:
            time.sleep(0.5)
            world.tick()

    threading.Thread(target=loop, daemon=True).start()
    srv = ThreadingHTTPServer((args.host, args.port), make_handler(world))
    url = f"http://localhost:{args.port}"
    print(f"🌾 La Ferme du Val Vert tourne sur {url}  (Ctrl+C pour quitter)")
    if args.host not in ("127.0.0.1", "localhost"):
        ip = lan_ip()
        if ip:
            print(f"   depuis un autre appareil du réseau : http://{ip}:{args.port}")

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
