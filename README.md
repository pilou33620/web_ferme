# 🌾 La Ferme du Val Vert

Petit jeu de gestion de ferme : **moteur de simulation en Python**, **interface en HTML / CSS / JS**.
Le style graphique s'inspire d'une maquette d'appli « Farm App » (fond crème, onglets en pilule, carte vue du dessus avec zoom animé).

## Lancer le jeu

```bash
python server.py              # ouvre http://localhost:8000
python server.py --nouvelle   # ignore la sauvegarde et repart de zéro
python server.py --port 9000 --sans-navigateur
python server.py --host 0.0.0.0   # jouable depuis les autres appareils du réseau (iPad, PC…)
```

Le port et l'adresse peuvent aussi venir des variables d'environnement `PORT` et `HOST`.
Le fichier `web_launcher.json` permet de lancer le jeu depuis [web_launcher](https://github.com/pilou33620/web_launcher) (port libre automatique, accès réseau local).

Python 3.10 ou plus récent. **Aucune dépendance** : seulement la bibliothèque standard.
La partie est sauvegardée dans `sauvegarde.json` toutes les 10 s et à chaque action.

## But du jeu

Atteindre **15 000 €** de trésorerie sans faire faillite. Si le compte reste dans le rouge **3 jours de suite**, la banque saisit la ferme.

- **Temps** : à la vitesse ×1, une seconde réelle vaut 10 minutes de jeu (une journée dure environ 2 min 24 s). Le jeu propose une pause et les vitesses ×1 à ×8.
- **Cultures** (tomates, potager, maïs) : on sème, puis on arrose (600 L puisés dans le réservoir). Le fumier accélère la croissance. Il faut récolter à temps, sinon la récolte pourrit. Un sol trop sec fait flétrir les plants.
- **Élevage** (vaches, poules, moutons, cochons) : 3 repas par jour (06 h, 12 h, 18 h). Les animaux mal nourris tombent malades, et le vétérinaire coûte 25 € par animal soigné. Production : lait, œufs, laine, et fumier pour les cultures.
- **Météo** : soleil, nuages, pluie, orage ou canicule, avec 3 jours de prévisions. La pluie remplit le réservoir et arrose les champs. La canicule assèche les sols.
- **Marché** : les prix varient chaque jour. On y achète du foin, des animaux et des améliorations (arrosage intelligent, distributeur automatique, grand réservoir, clôture contre le renard, tracteur).

## Architecture

```
engine.py          logique pure du jeu (testable, sans entrées-sorties)
server.py          serveur HTTP (stdlib) : boucle temps réel + API JSON + fichiers statiques
web/index.html     structure des 4 écrans (Accueil, Ma ferme, Élevage, Marché)
web/style.css      design system (couleurs, cartes, pilules, anneaux…)
web/js/icons.js    icônes au trait
web/js/art.js      illustrations : bannière jour/nuit, avatar, animaux
web/js/map.js      carte vue du dessus : décor, cultures, réservoir, animaux animés, zoom
web/js/app.js      état, rendu des écrans, actions, notifications
tests/             tests unitaires du moteur
```

API :

- `GET /api/etat` renvoie l'état complet, avec les valeurs calculées dans `derive` et les données de référence dans `ref`.
- `POST /api/action` attend un JSON `{"type": "...", ...}`. Types possibles : `semer`, `arroser`, `fertiliser`, `recolter`, `nourrir`, `soigner`, `vendre`, `acheter`, `ameliorer`, `vitesse`, `nouvelle_partie`.

## Tests

```bash
python -m unittest discover -s tests -v
```
