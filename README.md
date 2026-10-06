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

Le port et l'adresse peuvent aussi venir des variables d'environnement `PORT` et `HOST`. Si le port est déjà pris, le jeu essaie le suivant.
Le fichier `web_launcher.json` permet de lancer le jeu depuis [web_launcher](https://github.com/pilou33620/web_launcher) (port libre automatique, accès réseau local).
Sous Windows, on peut aussi double-cliquer sur **`Lancer la ferme.bat`**.

Python 3.10 ou plus récent. **Aucune dépendance** : seulement la bibliothèque standard.

### Mises à jour automatiques

À chaque démarrage, le jeu interroge son dépôt GitHub (`git fetch`). S'il y a des nouveautés, il les installe (`git merge --ff-only`) puis **se relance tout seul** sur la nouvelle version. Le menu principal affiche alors ce qui a changé et le numéro de version. Il faut que le jeu ait été installé avec `git clone`.

La mise à jour **n'écrase jamais rien**. Elle est ignorée, avec un message, si un fichier du jeu a été modifié sur le poste, s'il y a des commits locaux non publiés, ou si le dépôt est injoignable. Le jeu démarre alors avec la version actuelle. Pour sauter la vérification : `python server.py --sans-maj`. Votre sauvegarde (`sauvegarde.json`) n'est pas suivie par git : elle est conservée d'une version à l'autre.
La partie est sauvegardée dans `sauvegarde.json` toutes les 10 s et à chaque action.

Le jeu s'ouvre sur le **menu principal**, et le temps reste en pause tant qu'il est affiché. Il propose « Reprendre la partie » (ou « Commencer » pour une partie neuve) et « Nouvelle partie », avec une confirmation avant d'effacer la ferme en cours. On y revient à tout moment avec le bouton ☰ de la barre latérale ou la touche Échap.

## But du jeu

Atteindre **15 000 €** de trésorerie sans faire faillite. Si le compte reste dans le rouge **3 jours de suite**, la banque saisit la ferme.

- **Temps** : à la vitesse ×1, une seconde réelle vaut 10 minutes de jeu (une journée dure environ 2 min 24 s). Le jeu propose une pause et les vitesses ×1 à ×8.
- **Cultures** : trois parcelles libres au départ (A, B, C). Sur chacune, on choisit quoi semer : tomates, carottes, salades, pommes de terre, maïs, fraises ou potirons. Chaque culture a sa durée, son prix de graines, son rendement et ses besoins en eau. On arrose avec 600 L puisés dans le réservoir. Quand il pleut, les parcelles en plein champ s'arrosent toutes seules. Il faut récolter à temps, sinon la récolte pourrit. Un sol trop sec fait flétrir les plants.
- **Agrandir la ferme** : un terrain est toujours à vendre en bas de la carte (« À vendre », ou le bouton « Agrandir »). Chaque achat ajoute une parcelle libre de 1 ha, de D jusqu'à I : 1 800 €, 2 600 €, 3 500 €, 4 500 €, 5 500 € puis 6 500 €, avec 8 €/jour d'entretien chacune. On peut y semer et y construire une serre comme sur les autres.
- **Tracteur** : il circule sur les chemins de la propriété, vient labourer les parcelles libres et biner les cultures en plein champ (il laisse des traces de roues), et rentre dormir dans la cour la nuit. Il est rouge au départ. L'amélioration « Tracteur » (+20 % de rendement) le remplace par un modèle neuf, vert et plus rapide.
- **Engrais** : le **fumier** est bio et améliore la qualité (pousse ×1,5). L'**engrais chimique** (35 €) pousse plus vite (×1,8) et donne +20 % de récolte. En contrepartie, la qualité baisse, la récolte n'est plus bio, et le miel non plus pendant 3 jours.
- **Qualité et bio** : chaque produit a une qualité de 1 à 5 étoiles et une part bio.
  - Pour les cultures, la qualité dépend du sol (ni trop sec, ni détrempé), des coups de chaleur, des orages et d'une récolte faite à temps.
  - Pour l'élevage, elle dépend de la santé et de la satiété des bêtes. Le **foin bio** rend le lait, les œufs et la laine bio.
  - Les produits frais s'abîment : le lait tourne en quelques jours, les salades et les fraises vite, alors que les pommes de terre, la laine et le miel se gardent.
- **Serres** : débloquées après 3 000 € de ventes, 4 000 € l'une, 15 €/jour d'entretien. Une serre remplace une parcelle libre. La pousse y est 25 % plus rapide, le sol sèche moins vite, et les cultures sont à l'abri des orages et de la canicule. En contrepartie, la pluie n'arrose plus. C'est le seul endroit où poussent les melons et les poivrons.
- **Éoliennes** : aucune au départ. On peut en acheter deux (2 000 € pièce), installées près de la maison. Elles rapportent jusqu'à 90 €/jour chacune selon le vent (beaucoup par temps d'orage, presque rien en canicule).
- **Élevage** (vaches, poules, moutons, cochons) : 3 repas par jour (06 h, 12 h, 18 h). Les animaux mal nourris tombent malades, et le vétérinaire coûte 25 € par animal soigné. Production : lait, œufs, laine, et fumier pour les cultures. On peut aussi **vendre un animal** au marché aux bestiaux : plus il est en forme, plus il vaut cher.
- **Ruches** : 250 € l'une, 6 au maximum. Elles produisent du miel (rien sous la pluie). Plus il y a de cultures différentes en fleurs, meilleur il est. Elles pollinisent aussi les récoltes : +5 % par ruche, jusqu'à +15 %.
- **Météo** : soleil, nuages, pluie, orage ou canicule, avec 7 jours de prévisions. L'écran **Météo** montre la ferme en paysage animé : soleil, nuages poussés par le vent, pluie, éclairs, canicule, arc-en-ciel le matin qui suit la pluie, jour et nuit. On y voit vos vraies cultures, le niveau du réservoir, vos vaches, vos éoliennes et le tracteur. Les boutons du haut permettent de prévisualiser chaque ambiance ; « En direct » revient à la météo du jeu. En dessous : conditions du jour (température, humidité, vent, risque de pluie, UV, sol), heure par heure, prévisions 7 jours et conseils pour la ferme (arroser, récolter avant l'orage, marché sous la pluie…). La pluie remplit le réservoir et arrose les champs (pas les serres), et elle éloigne les clients du marché. La canicule assèche les sols.
- **Marché** (le jour 1 est un lundi) : il a lieu **le mardi, le jeudi et le samedi, de 7 h à 13 h**, sur une place animée (clients, pigeons, fontaine, marchands qui crient leurs produits).
  - **Votre étal** : ce sont les **clients qui achètent**, tout seuls, pendant le marché. Vous choisissez ce qui est en vente et vous **fixez vos prix**, ou vous gardez le prix conseillé. Chaque client compare votre prix au prix qu'il juge honnête, c'est-à-dire le cours du jour × la qualité × le bio (+30 %). Trop cher, il passe son chemin. Bonne qualité et bio font monter votre **réputation**, et une bonne réputation attire plus de monde.
  - **Vente en gros** (immédiate mais moins chère) : le fromager prend le lait (son camion passe chaque soir à 20 h si la collecte est active), la boulangère les œufs et le miel, le grainetier le maïs et la coopérative la laine. Les jours de marché, le primeur rachète les fruits et légumes, et la fleuriste le fumier.
  - **Boutiques ouvertes tous les jours** : le grainetier (foin, foin bio), le marché aux bestiaux (achat et vente d'animaux) et la coopérative (ruches, éoliennes, serres, améliorations).
  Les cours varient chaque jour.

## Architecture

```
engine.py          logique pure du jeu (testable, sans entrées-sorties)
server.py          serveur HTTP (stdlib) : boucle temps réel + API JSON + fichiers statiques
mise_a_jour.py     mise à jour automatique depuis git au démarrage, puis redémarrage
web/index.html     structure des 5 écrans (Accueil, Ma ferme, Météo, Élevage, Marché)
web/style.css      design system (couleurs, cartes, pilules, anneaux…)
web/js/icons.js    icônes au trait
web/js/art.js      illustrations : bannière jour/nuit, avatar, animaux
web/js/market.js   place du marché : étals, marchands, clients, pigeons et bêtes animés
web/js/map.js      carte vue du dessus : décor, cultures, serres, éoliennes, réservoir, animaux, tracteur, terrains à vendre, zoom
web/js/weather.js  écran Météo : paysage animé selon le temps (soleil, nuages, vent, pluie, orage, canicule, éclaircie)
web/js/app.js      état, rendu des écrans, actions, notifications
tests/             tests unitaires du moteur
```

API :

- `GET /api/etat` renvoie l'état complet, avec les valeurs calculées dans `derive` et les données de référence dans `ref`.
- `POST /api/action` attend un JSON `{"type": "...", ...}`. Types possibles : `semer` (avec `champ` et `culture`), `construire` (`batiment` : `eolienne`, `ruche`, ou `serre` avec `champ`), `arroser`, `fertiliser` (`engrais` : `fumier` ou `chimique`), `recolter`, `nourrir`, `soigner`, `vendre` (vente en gros), `etal` (`produit`, puis `actif` et/ou `prix`, `null` = prix conseillé), `collecte` (`actif`), `vendre_animal` (`categorie`, `id` facultatif), `acheter_parcelle` (achète le prochain terrain à vendre), `acheter` (`foin`, `foin_bio` ou un animal), `ameliorer`, `vitesse`, `menu` (`ouvert` : met en pause / reprend), `nouvelle_partie`.

## Tests

```bash
python -m unittest discover -s tests -v
```
