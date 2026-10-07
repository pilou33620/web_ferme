# 🌾 La Ferme du Val Vert

Petit jeu de gestion de ferme : **moteur de simulation en Python**, **interface en HTML / CSS / JS**.
Le style graphique s'inspire d'une maquette d'appli « Farm App » (fond crème, onglets en pilule, carte vue du dessus avec zoom animé).

## Lancer le jeu

```bash
python server.py              # ouvre http://localhost:8000 (et accessible depuis le réseau local)
python server.py --nouvelle   # ignore la sauvegarde et repart de zéro
python server.py --port 9000 --sans-navigateur
python server.py --local      # cet appareil seulement, pas d'accès depuis le réseau
```

### Jouer depuis un autre appareil (téléphone, tablette, autre PC)

Par défaut le jeu écoute sur tout le réseau local (`0.0.0.0`). Au démarrage, la console affiche l'adresse à taper sur l'autre appareil, par exemple `http://192.168.1.20:8000`. Les deux appareils doivent être sur le même réseau (même box / Wi-Fi).

Sous Windows, au premier lancement, le pare-feu demande s'il faut autoriser Python : cochez **Réseaux privés** et validez. Si la fenêtre n'est pas apparue ou a été refusée : *Pare-feu Windows Defender → Autoriser une application → Python → cocher « Privé »*. Vérifiez aussi que votre Wi-Fi est réglé en réseau **privé** et non public.

Tous les appareils jouent la **même partie** : ce qui est fait sur l'un apparaît sur les autres.

Le port et l'adresse peuvent aussi venir des variables d'environnement `PORT` et `HOST` (`--host` permet de choisir l'adresse d'écoute exacte). Si le port est déjà pris, le jeu essaie le suivant.
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

**Mode libre** : à la création d'une partie, on choisit entre la partie classique et le mode libre (pas d'objectif d'argent, seule la faillite reste possible). Après une victoire, « Continuer en mode libre » garde la ferme et continue sans fin.

- **Temps** : à la vitesse ×1, une seconde réelle vaut 1 minute de jeu (une journée dure 24 min, 3 min en ×8). Le jeu propose une pause et les vitesses ×1 à ×8.
- **Saisons** : l'année compte quatre saisons de 7 jours (printemps, été, automne, hiver), affichées dans la barre latérale.
  - Chaque culture a ses saisons de semis en plein champ (tomates, fraises, maïs, pommes de terre : printemps et été ; potirons jusqu'à l'automne ; carottes et salades presque toute l'année). Sous serre, tout se sème toute l'année.
  - La pousse est plus rapide l'été (+10 %), plus lente l'automne (−15 %) et l'hiver (−40 %, −10 % sous serre).
  - La météo suit la saison : canicules et orages l'été, pluie l'automne, froid et neige l'hiver. Quand il gèle, les cultures fragiles en plein champ perdent de la santé ; seules les carottes et les salades résistent.
  - Les bêtes mangent plus en automne et en hiver (+10 % / +30 % de foin), ne broutent plus l'hiver, les poules pondent moins ; les abeilles ne font pas de miel l'hiver.
  - Les légumes hors saison se vendent 35 % plus cher ; l'hiver, le lait, les œufs et les produits transformés sont plus recherchés.
  - La carte et l'écran Météo changent de couleurs selon la saison (herbe sèche l'été, feuillage roux l'automne, givre et neige l'hiver).
- **Atelier de transformation** (2 500 €, 8 €/jour) : un bâtiment à côté du réservoir, visible sur la carte avec le matériel installé dans la cour (fumée à la cheminée, anneau de progression pendant une fournée). On y achète du matériel :

  | Matériel | Prix | Recettes |
  |---|---|---|
  | Cuve à fromage | 1 800 € | 10 L de lait → 1 kg de fromage |
  | Chaudron en cuivre | 900 € | confiture de fraises, confiture de melon |
  | Autoclave de conserverie | 1 500 € | sauce tomate, velouté de potiron (potiron + carottes) |
  | Rouet électrique | 1 200 € | pelotes de laine |
  | Four à pain | 2 000 € | pain de maïs (maïs + œufs), pain d'épices (miel + œufs) |

  Chaque machine traite une fournée à la fois (de 1 lot à sa capacité), avec un entretien journalier. Les produits finis se gardent longtemps, se vendent plus cher (au marché ou en gros : fromager, boulangère, coopérative), gardent la qualité et la part bio de leurs ingrédients (+6 de qualité). La « relance automatique » relance la même recette à la fin de chaque fournée.
- **Commandes de clients** : restaurants, cantine, épiceries… passent commande (jusqu'à 3 à la fois) pour ce que la ferme peut produire : une quantité, parfois une qualité minimale ou du bio, avant une date. Livrer rapporte bien plus que le marché et +3 de réputation ; une commande ratée coûte 5 points.
- **Événements aléatoires** (environ un jour sur trois) : subvention, foin offert par le voisin, essaim sauvage, grêle, sangliers (la clôture les arrête), gelée blanche, fuite au réservoir, panne d'une technologie (24 h), contrôle bio (amende si engrais ou insecticide dans la semaine), blogueuse culinaire et foire agricole (plus de clients au prochain marché), concours agricole, visite d'école, campagne de vaccination, chute des cours. Ils s'affichent sur l'Accueil, avec la saison.
- **Cultures** : trois parcelles en friche au départ (A, B, C). Sur chacune, on choisit quoi semer : tomates, carottes, salades, pommes de terre, maïs, fraises ou potirons. Chaque culture a sa durée, son prix de graines, son rendement et ses besoins en eau. On arrose avec 600 L puisés dans le réservoir. Quand il pleut, les parcelles en plein champ s'arrosent toutes seules. Il faut récolter à temps, sinon la récolte pourrit. Un sol trop sec fait flétrir les plants.
- **Soins des cultures** :
  - **Préparer le sol** : une planche en friche, récoltée ou flétrie doit être labourée avant d'être semée. Avec le tracteur, toute la parcelle est labourée d'un coup.
  - **Mauvaises herbes** : elles envahissent les planches cultivées en 2 à 3 jours (plus vite sur sol humide). Elles ralentissent la pousse (jusqu'à deux fois moins vite) et, quand la planche est envahie, la qualité baisse. On désherbe à la main, ou le robot désherbeur s'en charge.
  - **Nuisibles** : pucerons, limaces, doryphores… attaquent une planche au hasard (moins souvent sous serre) et rongent la santé des plants jusqu'à les faire flétrir. **Purin d'ortie** (10 €) : la culture reste bio, mais ils peuvent revenir. **Insecticide** (30 €) : protège la planche 3 jours, mais la récolte et le miel ne sont plus bio.
- **Plusieurs cultures par parcelle** : chaque parcelle se découpe en 1, 2 ou 3 **planches** (boutons « Planches » de la parcelle, quand tout est récolté). Chaque planche a sa culture, sa croissance, son engrais et sa récolte ; le sol et l'arrosage restent communs. Deux cultures différentes sur la même parcelle s'entraident (**association de cultures : +10 % de récolte**), et la variété améliore aussi le miel.
- **Agrandir la ferme** : un terrain est toujours à vendre en bas de la carte (« À vendre », ou le bouton « Agrandir »). Chaque achat ajoute une parcelle libre de 1 ha, de D jusqu'à I : 1 800 €, 2 600 €, 3 500 €, 4 500 €, 5 500 € puis 6 500 €, avec 8 €/jour d'entretien chacune. On peut y semer et y construire une serre comme sur les autres.
- **Tracteur** : il circule sur les chemins de la propriété, vient labourer les parcelles libres et biner les cultures en plein champ (il laisse des traces de roues), et rentre dormir dans la cour la nuit. Il est rouge au départ. L'amélioration « Tracteur » (+20 % de rendement, labour de toute une parcelle d'un coup) le remplace par un modèle neuf, vert et plus rapide.
- **Technologies modernes** (coopérative, ou section « Technologies modernes » du marché) : chères, avec un entretien journalier.
  - **Drone agricole** (5 500 €, 10 €/j) : survole et traite les cultures, qui perdent deux fois moins de santé et de qualité. Il reste sur son aire les jours d'orage.
  - **Robot désherbeur** (8 000 €, 12 €/j) : longe les rangs et arrache les mauvaises herbes (plus besoin de désherber), les cultures poussent 15 % plus vite, sans produit chimique.
  - **Semoir autonome** (9 000 €, 12 €/j) : prépare le sol et ressème la même culture dès qu'une planche est récoltée (graines payées automatiquement).
  - **Robot de récolte** (12 000 €, 18 €/j) : récolte chaque planche dès qu'elle est mûre, jour et nuit, avec un petit bonus de qualité.
  - **Robot de traite** (6 000 €, 10 €/j) : trait les vaches et ramasse œufs, laine et fumier tout seul.
  On les voit travailler sur la carte (le drone pulvérise, les robots suivent les chemins et les rangs) et sur l'écran Météo.
- **Engrais** : le **fumier** est bio et améliore la qualité (pousse ×1,5). L'**engrais chimique** (35 €) pousse plus vite (×1,8) et donne +20 % de récolte. En contrepartie, la qualité baisse, la récolte n'est plus bio, et le miel non plus pendant 3 jours.
- **Qualité et bio** : chaque produit a une qualité de 1 à 5 étoiles et une part bio.
  - Pour les cultures, la qualité dépend du sol (ni trop sec, ni détrempé), des coups de chaleur, des orages et d'une récolte faite à temps.
  - Pour l'élevage, elle dépend de la santé, de la satiété et de l'humeur des bêtes. Le **foin bio** rend le lait, les œufs et la laine bio.
  - Les produits frais s'abîment : le lait tourne en quelques jours, les salades et les fraises vite, alors que les pommes de terre, la laine et le miel se gardent.
- **Serres** : débloquées après 3 000 € de ventes, 4 000 € l'une, 15 €/jour d'entretien. Une serre remplace une parcelle libre. La pousse y est 25 % plus rapide, le sol sèche moins vite, et les cultures sont à l'abri des orages et de la canicule. En contrepartie, la pluie n'arrose plus. C'est le seul endroit où poussent les melons et les poivrons.
- **Éoliennes** : aucune au départ. On peut en acheter deux (2 000 € pièce), installées près de la maison. Elles rapportent jusqu'à 90 €/jour chacune selon le vent (beaucoup par temps d'orage, presque rien en canicule).
- **Élevage** (vaches, poules, moutons, cochons) : on démarre **sans aucun animal** ; on achète ses premières bêtes au marché aux bestiaux (ou depuis l'écran Élevage). 3 repas par jour (06 h, 12 h, 18 h) ; le repas du soir tient toute la nuit. Les animaux mal nourris tombent malades, et le vétérinaire coûte 25 € par animal soigné. Production : lait, œufs, laine, et fumier pour les cultures. On peut aussi **vendre un animal** au marché aux bestiaux : plus il est en forme, plus il vaut cher.
- **Soins des animaux** (écran Élevage, par catégorie ou pour tout le troupeau) :
  - **Récolter à la main** : traire les vaches, ramasser les œufs, tondre les moutons, ramasser le fumier. La production attend dans l'enclos, au plus une journée : au-delà, elle est perdue. Le camion du soir ne prend que le lait déjà trait.
  - **Nettoyer l'enclos** : la litière se salit en 2 à 3 jours ; un enclos sale rend les bêtes malades. Changer la litière rapporte du fumier.
  - **Câliner / brosser** : chaque animal a une humeur (😊 → 😢) qui baisse sans attention. Un câlin la remonte (une fois toutes les 2 h par animal). Des bêtes heureuses produisent 10 % de plus et mieux ; des bêtes malheureuses, 15 % de moins.
  - **Sortir au pré** (la cour pour les poules) : dehors, les bêtes broutent (faim 2,5 fois moins vite), l'enclos se salit moins et leur humeur remonte. Il faut les rentrer le soir : dehors la nuit ou sous la pluie, elles deviennent grognonnes, et le renard emporte les poules restées dehors. Pas de sortie par temps d'orage.
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
web/js/map.js      carte vue du dessus : décor de saison, cultures, serres, éoliennes, réservoir, atelier et son matériel, animaux, tracteur, terrains à vendre, neige, zoom
web/js/weather.js  écran Météo : paysage animé selon le temps (soleil, nuages, vent, pluie, orage, canicule, éclaircie)
web/js/app.js      état, rendu des écrans, actions, notifications
tests/             tests unitaires du moteur
```

API :

- `GET /api/etat` renvoie l'état complet, avec les valeurs calculées dans `derive` et les données de référence dans `ref`.
- `POST /api/action` attend un JSON `{"type": "...", ...}`. Types possibles : `semer` (avec `champ`, `culture` et `planche`, 0 par défaut), `diviser` (`champ`, `planches` de 1 à 3), `construire` (`batiment` : `eolienne`, `ruche`, ou `serre` avec `champ`), `arroser` (`champ`), `fertiliser` (`champ`, `planche`, `engrais` : `fumier` ou `chimique`), `recolter` (`champ`, `planche`), `technologie` (`tech` : `drone`, `desherbeur`, `semoir` ou `recolteur`), `nourrir`, `soigner`, `vendre` (vente en gros), `etal` (`produit`, puis `actif` et/ou `prix`, `null` = prix conseillé), `collecte` (`actif`), `vendre_animal` (`categorie`, `id` facultatif), `acheter_parcelle` (achète le prochain terrain à vendre), `acheter` (`foin`, `foin_bio` ou un animal), `ameliorer`, `vitesse`, `menu` (`ouvert` : met en pause / reprend), `nouvelle_partie` (`mode` : `classique` ou `libre`), `continuer` (après une victoire, passe en mode libre), `construire` avec `batiment` : `atelier`, `equiper` (`equipement`), `transformer` (`recette`, `lots` : nombre ou `"max"`), `atelier_auto` (`equipement`, `actif`), `livrer` et `refuser` (`id` de la commande).

## Tests

```bash
python -m unittest discover -s tests -v
```
