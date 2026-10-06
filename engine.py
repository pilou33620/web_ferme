"""Moteur de simulation de « La Ferme du Val Vert ».

Logique pure, sans dépendance : le serveur appelle `Game.advance()` régulièrement
et `Game.act()` pour les actions du joueur. Le temps est compté en minutes de jeu.
"""
from __future__ import annotations

import json
import math
import random
from copy import deepcopy

MIN_PER_DAY = 1440
MEALS = [6, 12, 18]           # heures des repas
MEAL_WINDOW = (-1, 3)         # fenêtre : 1 h avant → 3 h après
GAME_MIN_PER_SEC = 10         # vitesse x1 : 1 s réelle = 10 min de jeu
TARGET_MONEY = 15000

JOURS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"]
MARKET_DAYS = (1, 3, 5)       # mardi, jeudi, samedi (le jour 1 est un lundi)
MARKET_HOURS = (7, 13)
COLLECTE_HEURE = 20           # passage du camion de la fromagerie

# --- Données de référence -------------------------------------------------

# Parcelles : terrains nus, le joueur choisit ce qu'il y fait pousser.
FIELDS = {
    "parcelle_a": {"nom": "Parcelle A", "taille": 1.25},
    "parcelle_b": {"nom": "Parcelle B", "taille": 1.0},
    "parcelle_c": {"nom": "Parcelle C", "taille": 1.0},
}

# Cultures au choix. `soif` multiplie l'évaporation ; `serre` = culture réservée aux serres.
# Le produit récolté porte la même clé que la culture.
CROPS = {
    "tomates":  {"nom": "Tomates", "emoji": "🍅", "type": "légume", "jours": 4.0, "rendement": 260,
                 "graines": 60, "prix": 2.4, "soif": 1.1},
    "carottes": {"nom": "Carottes", "emoji": "🥕", "type": "légume", "jours": 3.0, "rendement": 230,
                 "graines": 40, "prix": 1.7, "soif": 1.0},
    "salades":  {"nom": "Salades", "emoji": "🥬", "type": "légume", "jours": 2.0, "rendement": 150,
                 "graines": 30, "prix": 2.2, "soif": 1.2},
    "pommes_de_terre": {"nom": "Pommes de terre", "emoji": "🥔", "type": "légume", "jours": 5.0,
                 "rendement": 480, "graines": 50, "prix": 1.0, "soif": 0.7},
    "mais":     {"nom": "Maïs", "emoji": "🌽", "type": "céréale", "jours": 5.0, "rendement": 340,
                 "graines": 70, "prix": 0.9, "soif": 1.0},
    "fraises":  {"nom": "Fraises", "emoji": "🍓", "type": "fruit", "jours": 4.0, "rendement": 120,
                 "graines": 90, "prix": 6.0, "soif": 1.3},
    "potirons": {"nom": "Potirons", "emoji": "🎃", "type": "légume", "jours": 6.0, "rendement": 400,
                 "graines": 60, "prix": 1.5, "soif": 0.9},
    "melons":   {"nom": "Melons", "emoji": "🍈", "type": "fruit", "jours": 5.0, "rendement": 240,
                 "graines": 120, "prix": 3.8, "soif": 1.2, "serre": True},
    "poivrons": {"nom": "Poivrons", "emoji": "🫑", "type": "légume", "jours": 4.0, "rendement": 180,
                 "graines": 100, "prix": 4.2, "soif": 1.1, "serre": True},
}

ANIMALS = {
    "vaches":  {"nom": "Vaches", "unite": "vache", "ration": 5.0, "produit": "lait", "par_jour": 22.0, "prix": 900},
    "poules":  {"nom": "Poules", "unite": "poule", "ration": 0.2, "produit": "oeufs", "par_jour": 0.8, "prix": 25},
    "moutons": {"nom": "Moutons", "unite": "mouton", "ration": 2.0, "produit": "laine", "par_jour": 0.3, "prix": 180},
    "cochons": {"nom": "Cochons", "unite": "cochon", "ration": 3.0, "produit": "fumier", "par_jour": 6.0, "prix": 250},
}

NAMES = {
    "vaches": ["Marguerite", "Blanchette", "Noisette", "Caramel", "Praline", "Rosalie", "Vanille", "Câline",
               "Dorée", "Églantine", "Fleurette", "Gaufrette", "Iris", "Jonquille", "Lilas", "Mirabelle",
               "Nougat", "Paquerette", "Réglisse", "Sucette", "Tulipe", "Violette"],
    "poules": ["Cocotte", "Picotte", "Plume", "Roussette", "Grisette", "Poupoule", "Coquine", "Biscotte",
               "Paillette", "Cannelle", "Muscade", "Perle", "Pistache", "Prune", "Quiche", "Rillette",
               "Sardine", "Tartine", "Ursule", "Zézette", "Agathe", "Bulle", "Capucine", "Domino"],
    "moutons": ["Frisette", "Bouclette", "Nuage", "Flocon", "Coton", "Laine", "Pompon", "Duvet", "Moumoute"],
    "cochons": ["Truffe", "Saucisson", "Groin", "Patapouf", "Rosette", "Boudin", "Jambon", "Lardon"],
}

# Négociants qui achètent en gros (moins cher qu'au marché). `marche` : présent seulement les jours de marché.
BUYERS = {
    "maraicher":  {"nom": "Marius, le primeur", "marche": True},
    "fromager":   {"nom": "Gérard, le fromager", "marche": False},
    "boulanger":  {"nom": "Odile, la boulangère", "marche": False},
    "grainetier": {"nom": "Lucien, le grainetier", "marche": False},
    "artisan":    {"nom": "la coopérative", "marche": False},
    "fleuriste":  {"nom": "Rose, la fleuriste", "marche": True},
}

# Produits vendables. `perime` : points de qualité perdus par jour (fraîcheur) ;
# `attrait` : envie des clients du marché ; `panier` : quantité achetée par un client.
_CROP_MARKET = {
    "tomates": (5, 3.0, (1, 3)), "carottes": (2, 2.5, (1, 2)), "salades": (12, 3.0, (0.5, 1.5)),
    "pommes_de_terre": (1, 2.5, (2, 5)), "mais": (1, 1.0, (1, 2)), "fraises": (10, 3.0, (0.5, 1.5)),
    "potirons": (0.5, 1.5, (2, 5)), "melons": (4, 2.0, (1, 3)), "poivrons": (4, 1.5, (0.5, 1.5)),
}
ITEMS = {
    **{k: {"nom": c["nom"], "unite": "kg", "prix": c["prix"], "perime": _CROP_MARKET[k][0],
           "attrait": _CROP_MARKET[k][1], "panier": _CROP_MARKET[k][2],
           "grossiste": "grainetier" if k == "mais" else "maraicher"} for k, c in CROPS.items()},
    "lait":   {"nom": "Lait", "unite": "L", "prix": 0.75, "perime": 20, "attrait": 2.5, "panier": (1, 3), "grossiste": "fromager"},
    "oeufs":  {"nom": "Œufs", "unite": "u", "prix": 0.3, "perime": 4, "attrait": 3.0, "panier": (6, 12), "grossiste": "boulanger"},
    "laine":  {"nom": "Laine", "unite": "kg", "prix": 9.0, "perime": 0, "attrait": 0.4, "panier": (0.3, 1), "grossiste": "artisan"},
    "miel":   {"nom": "Miel", "unite": "kg", "prix": 11.0, "perime": 0, "attrait": 1.8, "panier": (0.5, 1), "grossiste": "boulanger"},
    "fumier": {"nom": "Fumier", "unite": "kg", "prix": 0.08, "perime": 0, "attrait": 0.4, "panier": (5, 20), "grossiste": "fleuriste"},
}
EMOJI = {"lait": "🥛", "oeufs": "🥚", "laine": "🧶", "miel": "🍯", "fumier": "💩"}
GROS = 0.6                    # le négociant paie 60 % du cours du jour (avant qualité)

FEED_PRICE = 0.25             # €/kg de foin
FEED_BIO_PRICE = 0.33         # €/kg de foin bio
VET_PRICE = 25
CHEM_PRICE = 35               # dose d'engrais chimique pour une parcelle

UPGRADES = {
    "arrosage":  {"nom": "Arrosage intelligent", "prix": 1200,
                   "desc": "Arrose automatiquement les parcelles quand le sol descend sous 35 % (sauf s'il pleut)."},
    "distributeur": {"nom": "Distributeur automatique", "prix": 1500,
                   "desc": "Nourrit les animaux à chaque repas (06 h, 12 h, 18 h)."},
    "reservoir": {"nom": "Grand réservoir", "prix": 900,
                   "desc": "+4 000 L de capacité et pompe deux fois plus rapide."},
    "cloture":   {"nom": "Clôture renforcée", "prix": 400,
                   "desc": "Protège le poulailler du renard."},
    "tracteur":  {"nom": "Tracteur", "prix": 2200,
                   "desc": "+20 % de rendement à chaque récolte."},
}

# Constructions : à acheter en cours de partie, rien n'est fourni au départ.
BUILDINGS = {
    "eolienne": {"nom": "Éolienne", "prix": 2000, "max": 2, "gain_max": 90,
                 "desc": "Revend son électricité : jusqu'à 90 €/jour selon le vent."},
    "serre":    {"nom": "Serre", "prix": 4000, "entretien": 15, "ventes_requises": 3000,
                 "desc": "Remplace une parcelle : pousse +25 %, sol qui sèche moins vite, "
                         "à l'abri des orages et de la canicule. Permet les melons et les poivrons."},
    "ruche":    {"nom": "Ruche", "prix": 250, "max": 6, "miel_jour": 0.8,
                 "desc": "Les abeilles font du miel et pollinisent vos cultures (+5 % de récolte par ruche, jusqu'à +15 %)."},
}
SERRE_BOOST = 1.25
SERRE_EVAP = 0.4
RAIN_WATER = 0.15             # humidité gagnée par minute de pluie (plein champ seulement)

WEATHER = {  # `vent` : de 0 à 1, fait tourner les éoliennes ; `miel` : activité des abeilles ; `clients` : affluence
    "soleil":   {"nom": "Ensoleillé", "temp": 26, "pluie": 0.0, "evap": 1.0, "vent": 0.35, "miel": 1.2, "clients": 1.0, "poids": 40},
    "nuageux":  {"nom": "Nuageux", "temp": 20, "pluie": 0.0, "evap": 0.7, "vent": 0.55, "miel": 0.8, "clients": 1.0, "poids": 25},
    "pluie":    {"nom": "Pluie", "temp": 16, "pluie": 1.0, "evap": 0.3, "vent": 0.7, "miel": 0.2, "clients": 0.6, "poids": 18},
    "orage":    {"nom": "Orage", "temp": 19, "pluie": 1.6, "evap": 0.4, "vent": 1.0, "miel": 0.0, "clients": 0.3, "poids": 7},
    "canicule": {"nom": "Canicule", "temp": 35, "pluie": 0.0, "evap": 2.0, "vent": 0.15, "miel": 0.6, "clients": 0.8, "poids": 10},
}

OBJECTIVES = [
    {"id": "recolte", "titre": "Faire une première récolte"},
    {"id": "ventes", "titre": "Vendre pour 1 000 € de produits"},
    {"id": "amelioration", "titre": "Acheter une amélioration"},
    {"id": "ruche", "titre": "Installer une ruche"},
    {"id": "reputation", "titre": "Atteindre 75 de réputation au marché"},
    {"id": "troupeau", "titre": "Atteindre 60 animaux"},
    {"id": "eolienne", "titre": "Installer une éolienne"},
    {"id": "serre", "titre": "Construire une serre"},
    {"id": "fortune", "titre": f"Atteindre {TARGET_MONEY:,} € en caisse".replace(",", " ")},
]


def clamp(v, lo=0.0, hi=100.0):
    return max(lo, min(hi, v))


def quality_label(q: float) -> str:
    return "Excellente" if q >= 85 else "Bonne" if q >= 70 else "Correcte" if q >= 50 else "Médiocre" if q >= 30 else "Mauvaise"


def quality_mult(q: float) -> float:
    """Ce que la qualité change au prix que les clients jugent honnête (0,7 → 1,3)."""
    return 0.7 + 0.6 * q / 100


def bio_mult(bio: float) -> float:
    return 1 + 0.3 * bio


def buy_chance(ratio: float) -> float:
    """Probabilité qu'un client achète, selon prix demandé / prix jugé honnête."""
    return 1 / (1 + math.exp((ratio - 1.1) * 8))


class ActionError(Exception):
    pass


# --- Jeu ------------------------------------------------------------------

class Game:
    def __init__(self, state: dict | None = None, seed: int | None = None):
        self.s = state if state is not None else self.new_state(seed)
        self._migrate()

    # -------- création --------
    @staticmethod
    def new_state(seed: int | None = None) -> dict:
        seed = seed if seed is not None else random.randrange(1, 10**9)
        rng = random.Random(seed)
        animals = {}
        for cat, n in (("vaches", 18), ("poules", 20), ("moutons", 6), ("cochons", 4)):
            animals[cat] = {
                "satiete": 80.0,
                "liste": [{"id": f"{cat[:2]}{i}", "nom": NAMES[cat][i % len(NAMES[cat])],
                           "sante": float(rng.randint(82, 100))} for i in range(n)],
                "prochain_id": n,
            }
        fields = {k: Game.empty_field(hum) for k, hum in zip(FIELDS, (72.0, 64.0, 70.0))}
        st = {
            "version": 3,
            "seed": seed,
            "minute": 5 * 60,          # jour 1 (lundi), 05:00
            "vitesse": 1,
            "menu": False,             # menu principal ouvert (jeu en pause)
            "vitesse_menu": 1,         # vitesse à retrouver en quittant le menu
            "argent": 1500.0,
            "statut": "en_cours",
            "jours_dans_le_rouge": 0,
            "meteo": None,
            "previsions": [],
            "reservoir": {"niveau": 6720.0, "capacite": 8200.0},
            "champs": fields,
            "animaux": animals,
            "repas": {"jour": 1, "faits": []},
            "repas_bio": 0.0,
            "stock": {"foin": 900.0, "foin_bio": 0.0, **{k: 0.0 for k in ITEMS}, "fumier": 80.0},
            "qualite": {k: 80.0 for k in ITEMS},
            "bio": {k: 1.0 for k in ITEMS},
            "prix": {k: v["prix"] for k, v in ITEMS.items()},
            "prix_hier": {k: v["prix"] for k, v in ITEMS.items()},
            "etal": Game.default_stall(),
            "reputation": 50.0,
            "marche": Game.empty_market(0),
            "collecte_lait": True,
            "collecte_jour": 0,
            "dernier_chimique": -10 * MIN_PER_DAY,
            "ameliorations": [],
            "eoliennes": 0,
            "ruches": 0,
            "stats": {"recolte_kg": 0.0, "ventes": 0.0, "ventes_marche": 0.0, "recoltes": 0, "energie": 0.0,
                      "production_jour": {}, "hier": {}},
            "objectifs": [],
            "journal": [],
        }
        g = Game(st)
        g._roll_forecast(initial=True)
        g.log("Bienvenue à la Ferme du Val Vert ! Les parcelles sont libres : choisissez quoi y semer. "
              "Premier marché demain mardi, 7 h.", "info")
        return st

    @staticmethod
    def empty_field(humidite: float = 65.0) -> dict:
        return {"etat": "vide", "culture": None, "serre": False, "croissance": 0.0, "humidite": humidite,
                "sante": 100.0, "qualite": 100.0, "chimique": False, "engrais_jusqua": 0, "boost": 1.0,
                "mur_depuis": None}

    @staticmethod
    def default_stall() -> dict:
        return {k: {"actif": k not in ("mais", "fumier"), "prix": None} for k in ITEMS}

    @staticmethod
    def empty_market(day) -> dict:
        return {"jour": day, "etat": "ferme", "clients": 0, "acheteurs": 0, "recette": 0.0, "ventes": {},
                "dernieres": [], "trop_cher": 0}

    def _migrate(self):
        """Met à niveau une ancienne sauvegarde."""
        s = self.s
        if s.get("version", 1) < 2:   # V1 : champs de tomates / potager / maïs imposés
            old = s.get("champs", {})
            fields = {}
            for new, (prev, crop) in zip(FIELDS, (("tomates", "tomates"), ("legumes", "carottes"), ("mais", "mais"))):
                f = {**self.empty_field(), **old.get(prev, {})}
                f["culture"] = crop if f["etat"] != "vide" else None
                fields[new] = f
            s["champs"] = fields
            s["stock"]["carottes"] = s["stock"].get("carottes", 0.0) + s["stock"].pop("legumes", 0.0)
        s["version"] = 3
        for k, v in {"menu": False, "vitesse_menu": 1, "eoliennes": 0, "ruches": 0, "reputation": 50.0, "collecte_lait": True, "collecte_jour": 0,
                     "dernier_chimique": -10 * MIN_PER_DAY, "repas_bio": 0.0, "etal": self.default_stall(),
                     "marche": self.empty_market(0), "qualite": {}, "bio": {}}.items():
            s.setdefault(k, v)
        for k, v in {"energie": 0.0, "ventes_marche": 0.0}.items():
            s["stats"].setdefault(k, v)
        s["stock"].setdefault("foin_bio", 0.0)
        for k, info in ITEMS.items():
            s["stock"].setdefault(k, 0.0)
            s["qualite"].setdefault(k, 75.0)
            s["bio"].setdefault(k, 1.0)
            s["prix"].setdefault(k, info["prix"])
            s["prix_hier"].setdefault(k, info["prix"])
            s["etal"].setdefault(k, {"actif": k not in ("mais", "fumier"), "prix": None})
        for d in (s["prix"], s["prix_hier"]):
            for k in [k for k in d if k not in ITEMS]:
                del d[k]
        for f in s["champs"].values():
            for k, v in self.empty_field().items():
                f.setdefault(k, v)

    # -------- utilitaires --------
    @property
    def day(self) -> int:
        return int(self.s["minute"] // MIN_PER_DAY + 1)

    @property
    def hour(self) -> float:
        return (self.s["minute"] % MIN_PER_DAY) / 60.0

    @property
    def weekday(self) -> int:
        return (self.day - 1) % 7

    def clock(self) -> str:
        m = int(self.s["minute"] % MIN_PER_DAY)
        return f"{m // 60:02d}:{m % 60:02d}"

    def has(self, up: str) -> bool:
        return up in self.s["ameliorations"]

    def rng(self, salt: str) -> random.Random:
        return random.Random(f"{self.s['seed']}-{self.day}-{salt}")

    def log(self, msg: str, kind: str = "info"):
        self.s["journal"].insert(0, {"jour": self.day, "heure": self.clock(), "msg": msg, "type": kind})
        del self.s["journal"][60:]

    def n_serres(self) -> int:
        return sum(1 for f in self.s["champs"].values() if f["serre"])

    def field_name(self, key: str) -> str:
        nom = FIELDS[key]["nom"]
        return nom.replace("Parcelle", "Serre") if self.s["champs"][key]["serre"] else nom

    def wind_income(self) -> float:
        """Gain journalier des éoliennes avec la météo du jour."""
        vent = WEATHER[self.s["meteo"]["type"]]["vent"]
        return self.s["eoliennes"] * BUILDINGS["eolienne"]["gain_max"] * vent

    def charges(self) -> float:
        return 35 + 1.5 * self.n_animals() + 12 * len(self.s["ameliorations"]) \
            + BUILDINGS["serre"]["entretien"] * self.n_serres()

    def serre_unlocked(self) -> bool:
        return self.s["stats"]["ventes"] >= BUILDINGS["serre"]["ventes_requises"]

    def n_animals(self) -> int:
        return sum(len(a["liste"]) for a in self.s["animaux"].values())

    def temperature(self) -> float:
        base = self.s["meteo"]["temp"]
        return round(base - 6 + 9 * max(0.0, math.sin((self.hour - 6) / 24 * 2 * math.pi)), 1)

    def raining(self) -> bool:
        return WEATHER[self.s["meteo"]["type"]]["pluie"] > 0

    # -------- marché : jours, prix, qualité --------
    def market_day(self, weekday: int | None = None) -> bool:
        return (self.weekday if weekday is None else weekday) in MARKET_DAYS

    def market_open(self) -> bool:
        return self.market_day() and MARKET_HOURS[0] <= self.hour < MARKET_HOURS[1]

    def next_market(self) -> str:
        if self.market_open():
            return f"Ouvert jusqu'à {MARKET_HOURS[1]} h"
        if self.market_day() and self.hour < MARKET_HOURS[0]:
            return f"Aujourd'hui, {MARKET_HOURS[0]} h"
        for d in range(1, 8):
            wd = (self.weekday + d) % 7
            if wd in MARKET_DAYS:
                return f"{'Demain' if d == 1 else JOURS[wd]}, {MARKET_HOURS[0]} h"
        return ""

    def fair_price(self, item: str) -> float:
        """Prix que les clients trouvent honnête : cours du jour × qualité × bio."""
        return self.s["prix"][item] * quality_mult(self.s["qualite"][item]) * bio_mult(self.s["bio"][item])

    def wholesale_price(self, item: str) -> float:
        q, b = self.s["qualite"][item], self.s["bio"][item]
        return self.s["prix"][item] * GROS * (0.85 + 0.3 * q / 100) * (1 + 0.25 * b)

    def stall_price(self, item: str) -> float:
        p = self.s["etal"][item]["prix"]
        return p if p is not None else round(self.fair_price(item), 2)

    def min_unit(self, item: str) -> float:
        return 1.0 if item == "oeufs" else 0.2

    def on_stall(self, item: str) -> bool:
        return self.s["etal"][item]["actif"] and self.s["stock"][item] >= self.min_unit(item)

    def customers_per_hour(self) -> float:
        n = sum(1 for k in ITEMS if self.on_stall(k))
        if not n:
            return 0.0
        variety = min(1.4, 0.55 + 0.1 * n)
        peak = 1.3 if 9 <= self.hour < 11.5 else 1.0
        return 26 * (0.5 + self.s["reputation"] / 100) * WEATHER[self.s["meteo"]["type"]]["clients"] * peak * variety

    # -------- stock --------
    def _add(self, item: str, qty: float, q: float, bio: float):
        """Ajoute un lot au stock : qualité et part bio sont des moyennes pondérées."""
        if qty <= 0:
            return
        st = self.s["stock"]
        old = max(0.0, st[item])
        tot = old + qty
        self.s["qualite"][item] = (self.s["qualite"][item] * old + clamp(q) * qty) / tot
        self.s["bio"][item] = (self.s["bio"][item] * old + bio * qty) / tot
        st[item] = tot

    def flowering(self) -> int:
        return sum(1 for f in self.s["champs"].values() if f["etat"] in ("pousse", "mur"))

    def honey_per_day(self) -> float:
        info = BUILDINGS["ruche"]
        flowers = min(1.0, 0.4 + 0.2 * self.flowering())
        return self.s["ruches"] * info["miel_jour"] * WEATHER[self.s["meteo"]["type"]]["miel"] * flowers

    def honey_quality(self) -> float:
        cultures = {f["culture"] for f in self.s["champs"].values() if f["etat"] in ("pousse", "mur")}
        return clamp(60 + 10 * len(cultures) + (-10 if self.s["meteo"]["type"] == "canicule" else 0))

    def honey_bio(self) -> float:
        return 0.0 if self.s["minute"] - self.s["dernier_chimique"] < 3 * MIN_PER_DAY else 1.0

    def animal_quality(self, cat: str) -> float:
        g = self.s["animaux"][cat]
        if not g["liste"]:
            return 0.0
        health = sum(a["sante"] for a in g["liste"]) / len(g["liste"])
        return clamp(0.55 * health + 0.45 * min(100, g["satiete"] * 1.25))

    def pollination(self) -> float:
        return 1 + 0.05 * min(3, self.s["ruches"])

    # -------- météo / cours --------
    def _pick_weather(self, rng) -> dict:
        keys = list(WEATHER)
        k = rng.choices(keys, weights=[WEATHER[x]["poids"] for x in keys])[0]
        w = WEATHER[k]
        return {"type": k, "nom": w["nom"], "temp": w["temp"] + rng.randint(-3, 3)}

    def _roll_forecast(self, initial=False):
        rng = self.rng("meteo")
        if initial:
            self.s["meteo"] = {"type": "soleil", "nom": "Ensoleillé", "temp": 28}
            self.s["previsions"] = [self._pick_weather(rng) for _ in range(3)]
        else:
            self.s["meteo"] = self.s["previsions"].pop(0)
            self.s["previsions"].append(self._pick_weather(rng))

    def _update_prices(self):
        rng = self.rng("prix")
        self.s["prix_hier"] = dict(self.s["prix"])
        for k, info in ITEMS.items():
            p = self.s["prix"][k]
            base = info["prix"]
            p = p + (base - p) * 0.35 + base * rng.uniform(-0.12, 0.12)
            self.s["prix"][k] = round(clamp(p, base * 0.55, base * 1.6), 3)

    # -------- boucle de simulation --------
    def advance(self, minutes: float):
        if self.s["statut"] != "en_cours":
            return
        while minutes > 0:
            step = min(5.0, minutes)
            before_day = self.day
            self._step(step)
            self.s["minute"] += step
            minutes -= step
            if self.day != before_day:
                self._new_day()
            self._check_meals()
            self._market_tick(step)
            self._milk_collection()
            if self.s["statut"] != "en_cours":
                break

    def _step(self, m: float):
        w = WEATHER[self.s["meteo"]["type"]]
        temp = self.temperature()
        tank = self.s["reservoir"]
        # pluie + pompe
        pump = 1.0 if self.has("reservoir") else 0.5
        tank["niveau"] = min(tank["capacite"], tank["niveau"] + (pump + 14 * w["pluie"]) * m)

        # éoliennes
        if self.s["eoliennes"]:
            gain = self.wind_income() * m / MIN_PER_DAY
            self.s["argent"] += gain
            self.s["stats"]["energie"] += gain

        # cultures
        for key, f in self.s["champs"].items():
            crop = CROPS.get(f["culture"]) or {"soif": 1.0}
            serre = f["serre"]
            evap = 0.025 * w["evap"] * crop["soif"] * (1 + max(0, temp - 22) / 15) * m
            rain = 0.0 if serre else RAIN_WATER * w["pluie"] * m   # la pluie arrose, sauf sous serre
            f["humidite"] = clamp(f["humidite"] - evap * (SERRE_EVAP if serre else 1.0) + rain)
            if self.has("arrosage") and f["etat"] in ("seme", "pousse", "mur") and f["humidite"] < 35 \
                    and (serre or not self.raining()):
                self._water(key, auto=True)
            if f["etat"] in ("seme", "pousse"):
                hum = f["humidite"]
                water_factor = 0.15 if hum < 15 else (0.6 if hum < 35 else (1.0 if hum <= 90 else 0.7))
                hot = temp > 34 and not serre
                heat = 0.6 if hot else 1.0
                boost = f["boost"] if f["engrais_jusqua"] > self.s["minute"] else 1.0
                rate = 100.0 / (crop["jours"] * MIN_PER_DAY) * (SERRE_BOOST if serre else 1.0)
                f["croissance"] = min(100.0, f["croissance"] + rate * water_factor * heat * boost * m)
                if f["croissance"] > 8:
                    f["etat"] = "pousse"
                if hum < 15:
                    f["sante"] = clamp(f["sante"] - 0.02 * m)
                elif hum > 35:
                    f["sante"] = clamp(f["sante"] + 0.004 * m)
                # qualité : sol trop sec ou détrempé, coups de chaleur
                if hum < 25:
                    f["qualite"] = clamp(f["qualite"] - 0.02 * m)
                elif hum > 92:
                    f["qualite"] = clamp(f["qualite"] - 0.01 * m)
                if hot:
                    f["qualite"] = clamp(f["qualite"] - 0.01 * m)
                if f["croissance"] >= 100:
                    f["etat"] = "mur"
                    f["mur_depuis"] = self.s["minute"]
                    self.log(f"{self.field_name(key)} : les {crop['nom'].lower()} sont prêtes à récolter !", "succes")
                if f["sante"] <= 0:
                    f["etat"] = "fletri"
                    self.log(f"{self.field_name(key)} : les {crop['nom'].lower()} ont flétri, faute d'eau.", "alerte")
            elif f["etat"] == "mur":
                waited = self.s["minute"] - (f["mur_depuis"] or 0)
                if waited > 0.5 * MIN_PER_DAY:   # cueillies trop tard, elles perdent en qualité
                    f["qualite"] = clamp(f["qualite"] - 0.01 * m)
                if waited > 1.5 * MIN_PER_DAY:
                    f["sante"] = clamp(f["sante"] - 0.03 * m)
                    if f["sante"] <= 0:
                        f["etat"] = "fletri"
                        self.log(f"{self.field_name(key)} : les {crop['nom'].lower()} ont pourri sur pied.", "alerte")

        # animaux
        prod = self.s["stats"]["production_jour"]
        for cat, grp in self.s["animaux"].items():
            info = ANIMALS[cat]
            grp["satiete"] = clamp(grp["satiete"] - 0.13 * m)
            sat = grp["satiete"]
            for a in grp["liste"]:
                if sat < 20:
                    a["sante"] = clamp(a["sante"] - 0.025 * m)
                elif sat > 50:
                    a["sante"] = clamp(a["sante"] + 0.02 * m)
            if sat > 30 and grp["liste"]:
                eff = sum(a["sante"] for a in grp["liste"]) / 100.0
                qty = info["par_jour"] * eff * (m / MIN_PER_DAY) * (1.0 if sat > 55 else 0.6)
                self._add(info["produit"], qty, self.animal_quality(cat), self.s["repas_bio"])
                prod[info["produit"]] = prod.get(info["produit"], 0) + qty
            # décès
            dead = [a for a in grp["liste"] if a["sante"] <= 0]
            for a in dead:
                grp["liste"].remove(a)
                self.log(f"{a['nom']} ({info['unite']}) n'a pas survécu… Pensez à nourrir et soigner le troupeau.", "alerte")

        # ruches
        if self.s["ruches"]:
            qty = self.honey_per_day() * m / MIN_PER_DAY
            self._add("miel", qty, self.honey_quality(), self.honey_bio())
            prod["miel"] = prod.get("miel", 0) + qty

        # fraîcheur : les produits frais s'abîment
        for item, info in ITEMS.items():
            if info["perime"] and self.s["stock"][item] > 0:
                q = self.s["qualite"][item] - info["perime"] * m / MIN_PER_DAY
                self.s["qualite"][item] = max(0.0, q)
                if q <= 0 and self.s["stock"][item] >= self.min_unit(item):
                    self.log(f"Vos {info['nom'].lower()} n'étaient plus mangeables : "
                             f"{self.s['stock'][item]:.0f} {info['unite']} jetés. Vendez les produits frais plus vite !", "alerte")
                    self.s["stock"][item] = 0.0

    def _check_meals(self):
        rp = self.s["repas"]
        if rp["jour"] != self.day:
            rp["jour"], rp["faits"] = self.day, []
        h = self.hour
        for meal in MEALS:
            if meal in rp["faits"]:
                continue
            if self.has("distributeur") and h >= meal and h < meal + MEAL_WINDOW[1]:
                if self._feed(auto=True):
                    rp["faits"].append(meal)

    # -------- marché : les clients achètent à votre étal --------
    def _market_tick(self, m: float):
        mk = self.s["marche"]
        if mk["jour"] != self.day:
            self.s["marche"] = mk = self.empty_market(self.day)
        if not self.market_day():
            return
        if mk["etat"] == "ferme" and self.market_open():
            mk["etat"] = "ouvert"
            n = sum(1 for k in ITEMS if self.on_stall(k))
            self.log(f"C'est jour de marché ! Votre étal est installé avec {n} produit(s), jusqu'à {MARKET_HOURS[1]} h."
                     if n else "C'est jour de marché… mais votre étal est vide.", "info")
        if mk["etat"] == "ouvert" and not self.market_open():
            mk["etat"] = "termine"
            self.log(f"Fin du marché : {mk['acheteurs']} client(s) sur {mk['clients']} ont acheté, "
                     f"recette {mk['recette']:.0f} €. Réputation {self.s['reputation']:.0f}/100.", "succes")
            self._update_objectives()
            return
        if mk["etat"] != "ouvert":
            return
        rng = random.Random(f"{self.s['seed']}-client-{self.s['minute']:.0f}")
        expected = self.customers_per_hour() * m / 60
        n = int(expected) + (1 if rng.random() < expected - int(expected) else 0)
        for _ in range(n):
            self._customer(rng)

    def _customer(self, rng: random.Random):
        mk = self.s["marche"]
        items = [k for k in ITEMS if self.on_stall(k)]
        if not items:
            return
        mk["clients"] += 1
        wants = set(rng.choices(items, weights=[ITEMS[k]["attrait"] for k in items], k=rng.randint(1, 3)))
        bought, too_expensive = 0.0, False
        for k in wants:
            price, fair = self.stall_price(k), self.fair_price(k)
            if rng.random() > buy_chance(price / fair):
                too_expensive = too_expensive or price > fair
                continue
            lo, hi = ITEMS[k]["panier"]
            qty = rng.randint(1, 2) * 6 if k == "oeufs" else round(rng.uniform(lo, hi), 1)
            qty = min(qty, math.floor(self.s["stock"][k]) if k == "oeufs" else self.s["stock"][k])
            if qty <= 0:
                continue
            gain = qty * price
            q, bio = self.s["qualite"][k], self.s["bio"][k]
            self.s["stock"][k] -= qty
            self.s["argent"] += gain
            self.s["stats"]["ventes"] += gain
            self.s["stats"]["ventes_marche"] += gain
            mk["recette"] += gain
            mk["ventes"][k] = mk["ventes"].get(k, 0) + qty
            mk["dernieres"].insert(0, {"produit": k, "qte": qty, "montant": round(gain, 2), "heure": self.clock()})
            del mk["dernieres"][10:]
            bought += gain
            # la réputation suit la qualité (et le bio) de ce que vous vendez
            self.s["reputation"] = clamp(self.s["reputation"] + 0.004 * (q + 12 * bio - 10 - self.s["reputation"]))
        if bought:
            mk["acheteurs"] += 1
        elif too_expensive:
            mk["trop_cher"] += 1
            self.s["reputation"] = clamp(self.s["reputation"] - 0.05)

    def _milk_collection(self):
        if not self.s["collecte_lait"] or self.hour < COLLECTE_HEURE or self.s["collecte_jour"] == self.day:
            return
        self.s["collecte_jour"] = self.day
        qty = self.s["stock"]["lait"]
        if qty < 1:
            return
        gain = self._sell_wholesale("lait", qty)
        self.log(f"Le camion de la fromagerie a collecté {qty:.0f} L de lait ({gain:.0f} €).", "info")

    def _sell_wholesale(self, item: str, qty: float) -> float:
        gain = qty * self.wholesale_price(item)
        self.s["stock"][item] -= qty
        self.s["argent"] += gain
        self.s["stats"]["ventes"] += gain
        return gain

    def _new_day(self):
        self._roll_forecast()
        self._update_prices()
        st = self.s["stats"]
        st["hier"], st["production_jour"] = st["production_jour"], {}
        # charges
        charges = self.charges()
        self.s["argent"] -= charges
        jour = JOURS[self.weekday]
        marche = " · jour de marché !" if self.market_day() else ""
        self.log(f"{jour} {self.day}{marche} Charges du jour : {charges:.0f} €. Météo : {self.s['meteo']['nom']}.", "info")
        if self.raining():
            self.log("Il pleut : la pluie arrose les parcelles en plein champ (pas les serres).", "info")
        # événements
        rng = self.rng("event")
        w = self.s["meteo"]["type"]
        if w == "orage":
            key = rng.choice(list(self.s["champs"]))
            f = self.s["champs"][key]
            if f["etat"] in ("pousse", "mur"):
                if f["serre"]:
                    self.log(f"Orage : la {self.field_name(key)} a protégé ses cultures.", "info")
                else:
                    f["sante"] = clamp(f["sante"] - 25)
                    f["qualite"] = clamp(f["qualite"] - 15)
                    self.log(f"L'orage a abîmé la {self.field_name(key)} (−25 % de santé, qualité en baisse).", "alerte")
        roll = rng.random()
        if roll < 0.10 and not self.has("cloture") and self.s["animaux"]["poules"]["liste"]:
            lost = self.s["animaux"]["poules"]["liste"].pop(rng.randrange(len(self.s["animaux"]["poules"]["liste"])))
            self.log(f"Le renard est passé cette nuit : {lost['nom']} a disparu. Une clôture renforcée éviterait ça.", "alerte")
        elif roll < 0.18:
            cats = [c for c, g in self.s["animaux"].items() if g["liste"]]
            if cats:
                cat = rng.choice(cats)
                a = rng.choice(self.s["animaux"][cat]["liste"])
                a["sante"] = clamp(a["sante"] - 45)
                self.log(f"{a['nom']} est malade. Appelez le vétérinaire.", "alerte")
        elif roll < 0.24:
            item = rng.choice(list(ITEMS))
            self.s["prix"][item] = round(self.s["prix"][item] * 1.5, 3)
            self.log(f"Forte demande : le cours des {ITEMS[item]['nom'].lower()} s'envole !", "succes")
        # finances
        if self.s["argent"] < 0:
            self.s["jours_dans_le_rouge"] += 1
            left = 3 - self.s["jours_dans_le_rouge"]
            if left <= 0:
                self.s["statut"] = "perdu"
                self.log("Faillite : trois jours de suite dans le rouge. La ferme est saisie.", "alerte")
            else:
                self.log(f"Compte dans le rouge ! Encore {left} jour(s) avant la faillite.", "alerte")
        else:
            self.s["jours_dans_le_rouge"] = 0
        self._update_objectives()

    # -------- actions internes --------
    def _water(self, key: str, auto=False) -> bool:
        tank = self.s["reservoir"]
        need = 600.0
        if tank["niveau"] < need:
            if not auto:
                raise ActionError("Pas assez d'eau dans le réservoir (600 L nécessaires).")
            return False
        tank["niveau"] -= need
        f = self.s["champs"][key]
        f["humidite"] = clamp(f["humidite"] + 45)
        return True

    def feed_needed(self, cats=None) -> float:
        cats = cats or list(self.s["animaux"])
        return sum(ANIMALS[c]["ration"] * len(self.s["animaux"][c]["liste"]) for c in cats)

    def _feed(self, auto=False) -> bool:
        """Sert un repas : foin bio d'abord, puis foin classique, puis le maïs de la ferme."""
        need = self.feed_needed()
        stock = self.s["stock"]
        available = stock["foin_bio"] + stock["foin"] + stock["mais"]
        if available < need:
            if auto:
                self.log("Distributeur : stock de foin insuffisant !", "alerte")
                return False
            raise ActionError(f"Il faut {need:.0f} kg de nourriture (foin + maïs), vous en avez {available:.0f} kg.")
        left, bio = need, 0.0
        for k in ("foin_bio", "foin", "mais"):
            used = min(stock[k], left)
            stock[k] -= used
            left -= used
            bio += used * (1.0 if k == "foin_bio" else self.s["bio"]["mais"] if k == "mais" else 0.0)
        self.s["repas_bio"] = bio / need if need else 0.0
        for grp in self.s["animaux"].values():
            grp["satiete"] = 100.0
        return True

    # -------- actions joueur --------
    def act(self, action: dict) -> str:
        t = action.get("type")
        if self.s["statut"] != "en_cours" and t not in ("nouvelle_partie", "vitesse", "menu"):
            raise ActionError("La partie est terminée. Lancez une nouvelle partie.")
        handler = getattr(self, f"_a_{t}", None)
        if handler is None:
            raise ActionError(f"Action inconnue : {t}")
        msg = handler(action)
        self._update_objectives()
        return msg

    def _field(self, a) -> tuple[str, dict]:
        key = a.get("champ")
        if key not in self.s["champs"]:
            raise ActionError("Parcelle inconnue.")
        return key, self.s["champs"][key]

    def _item(self, a) -> str:
        item = a.get("produit")
        if item not in ITEMS:
            raise ActionError("Produit inconnu.")
        return item

    def _a_semer(self, a):
        key, f = self._field(a)
        if f["etat"] not in ("vide", "fletri"):
            raise ActionError("La parcelle n'est pas libre.")
        c = a.get("culture")
        if c not in CROPS:
            raise ActionError("Choisissez ce que vous voulez semer.")
        crop = CROPS[c]
        if crop.get("serre") and not f["serre"]:
            raise ActionError(f"Les {crop['nom'].lower()} ne poussent que sous serre.")
        self._pay(crop["graines"])
        f.update(etat="seme", culture=c, croissance=0.0, sante=100.0, qualite=100.0, chimique=False,
                 engrais_jusqua=0, boost=1.0, mur_depuis=None)
        self.log(f"{self.field_name(key)} : {crop['nom'].lower()} semées (−{crop['graines']} €).", "info")
        return f"{crop['nom']} semées."

    def _a_arroser(self, a):
        key, f = self._field(a)
        if f["etat"] in ("vide",):
            raise ActionError("Rien à arroser ici.")
        self._water(key)
        return f"{self.field_name(key)} arrosée (−600 L)."

    def _a_fertiliser(self, a):
        key, f = self._field(a)
        if f["etat"] not in ("seme", "pousse"):
            raise ActionError("L'engrais n'est utile que sur une culture en pousse.")
        if a.get("engrais") == "chimique":
            self._pay(CHEM_PRICE)
            f.update(engrais_jusqua=self.s["minute"] + MIN_PER_DAY, boost=1.8, chimique=True,
                     qualite=clamp(f["qualite"] - 12))
            self.s["dernier_chimique"] = self.s["minute"]
            self.log(f"{self.field_name(key)} : engrais chimique (−{CHEM_PRICE} €). La récolte ne sera pas bio.", "info")
            return f"{self.field_name(key)} : croissance ×1,8 pendant 24 h et +20 % de récolte, mais plus de bio."
        if self.s["stock"]["fumier"] < 50:
            raise ActionError("Il faut 50 kg de fumier (produit par les cochons).")
        self.s["stock"]["fumier"] -= 50
        f.update(engrais_jusqua=self.s["minute"] + MIN_PER_DAY, boost=1.5, qualite=clamp(f["qualite"] + 4))
        return f"{self.field_name(key)} fertilisée au fumier : croissance ×1,5 pendant 24 h, qualité en hausse."

    def harvest_quality(self, key: str) -> float:
        f = self.s["champs"][key]
        return clamp(0.4 * f["sante"] + 0.6 * f["qualite"] + (4 if f["serre"] else 0))

    def _a_recolter(self, a):
        key, f = self._field(a)
        if f["etat"] != "mur":
            raise ActionError("La récolte n'est pas encore prête.")
        c = f["culture"]
        qty = round(self.expected_yield(key))
        q = self.harvest_quality(key)
        self._add(c, qty, q, 0.0 if f["chimique"] else 1.0)
        self.s["stats"]["recolte_kg"] += qty
        self.s["stats"]["recoltes"] += 1
        bio = "" if f["chimique"] else ", bio"
        f.update(etat="vide", culture=None, croissance=0.0, mur_depuis=None, engrais_jusqua=0, chimique=False)
        self.log(f"Récolte : {qty} kg de {CROPS[c]['nom'].lower()} (qualité {quality_label(q).lower()}{bio}).", "succes")
        return f"+{qty} kg de {CROPS[c]['nom'].lower()} · qualité {quality_label(q).lower()}{bio}."

    def expected_yield(self, key: str) -> float:
        f = self.s["champs"][key]
        return CROPS[f["culture"]]["rendement"] * FIELDS[key]["taille"] * (0.3 + 0.7 * f["sante"] / 100) \
            * (1.2 if self.has("tracteur") else 1.0) * (1.2 if f["chimique"] else 1.0) * self.pollination()

    def _a_nourrir(self, a):
        self._feed()
        rp = self.s["repas"]
        h = self.hour
        slot = next((m for m in MEALS if m + MEAL_WINDOW[0] <= h < m + MEAL_WINDOW[1]), None)
        if slot is not None and slot not in rp["faits"]:
            rp["faits"].append(slot)
        return "Les animaux ont mangé" + (" (repas bio)." if self.s["repas_bio"] >= 0.99 else ".")

    def _a_soigner(self, a):
        sick = [x for g in self.s["animaux"].values() for x in g["liste"] if x["sante"] < 50]
        if not sick:
            raise ActionError("Aucun animal n'a besoin du vétérinaire.")
        cost = VET_PRICE * len(sick)
        self._pay(cost)
        for x in sick:
            x["sante"] = 100.0
        self.log(f"Le vétérinaire a soigné {len(sick)} animal(aux) (−{cost} €).", "info")
        return f"{len(sick)} animal(aux) soigné(s)."

    def _a_vendre(self, a):
        """Vente en gros à un négociant, moins chère qu'au marché mais immédiate."""
        item = self._item(a)
        buyer = BUYERS[ITEMS[item]["grossiste"]]
        if buyer["marche"] and not self.market_open():
            raise ActionError(f"{buyer['nom'].capitalize()} n'est là que les jours de marché "
                              f"(mardi, jeudi, samedi, {MARKET_HOURS[0]} h – {MARKET_HOURS[1]} h).")
        have = self.s["stock"][item]
        qty = have if a.get("quantite") in (None, "tout") else min(float(a["quantite"]), have)
        if item == "oeufs":
            qty = math.floor(qty)
        if qty <= 0:
            raise ActionError("Rien à vendre.")
        gain = self._sell_wholesale(item, qty)
        self.log(f"Vente en gros à {buyer['nom']} : {qty:.0f} {ITEMS[item]['unite']} de "
                 f"{ITEMS[item]['nom'].lower()} pour {gain:.0f} €.", "succes")
        return f"+{gain:.0f} €"

    def _a_etal(self, a):
        """Règle un produit de votre étal : en vente ou non, et son prix (None = prix conseillé)."""
        item = self._item(a)
        e = self.s["etal"][item]
        if "actif" in a:
            e["actif"] = bool(a["actif"])
        if "prix" in a:
            p = a["prix"]
            if p is None:
                e["prix"] = None
            else:
                p = round(float(p), 2)
                if not 0.01 <= p <= 5 * self.fair_price(item) + 1:
                    raise ActionError("Prix hors limites.")
                e["prix"] = p
        nom = ITEMS[item]["nom"]
        if not e["actif"]:
            return f"{nom} retirés de l'étal."
        return f"{nom} : {self.stall_price(item):.2f} €/{ITEMS[item]['unite']}".replace(".", ",") \
            + (" (prix conseillé)" if e["prix"] is None else "")

    def _a_collecte(self, a):
        self.s["collecte_lait"] = bool(a.get("actif"))
        return "Collecte du lait chaque soir à 20 h." if self.s["collecte_lait"] else "Collecte du lait arrêtée : vendez-le vous-même."

    def _a_acheter(self, a):
        item = a.get("article")
        qty = int(a.get("quantite", 1))
        if qty <= 0:
            raise ActionError("Quantité invalide.")
        if item in ("foin", "foin_bio"):
            self._pay(qty * (FEED_BIO_PRICE if item == "foin_bio" else FEED_PRICE))
            self.s["stock"][item] += qty
            return f"+{qty} kg de foin{' bio' if item == 'foin_bio' else ''}."
        if item in ANIMALS:
            info = ANIMALS[item]
            self._pay(qty * info["prix"])
            grp = self.s["animaux"][item]
            for _ in range(qty):
                i = grp["prochain_id"]
                grp["prochain_id"] += 1
                grp["liste"].append({"id": f"{item[:2]}{i}", "nom": NAMES[item][i % len(NAMES[item])], "sante": 100.0})
            self.log(f"Achat de {qty} {info['unite']}(s).", "info")
            return f"+{qty} {info['unite']}(s)."
        raise ActionError("Article inconnu.")

    def animal_price(self, cat: str, animal: dict) -> float:
        return round(ANIMALS[cat]["prix"] * (0.35 + 0.5 * animal["sante"] / 100))

    def _a_vendre_animal(self, a):
        """Vend un animal au marché aux bestiaux : celui demandé, sinon le moins en forme."""
        cat = a.get("categorie")
        if cat not in ANIMALS:
            raise ActionError("Catégorie inconnue.")
        grp = self.s["animaux"][cat]
        if not grp["liste"]:
            raise ActionError(f"Vous n'avez plus de {ANIMALS[cat]['nom'].lower()}.")
        if a.get("id"):
            animal = next((x for x in grp["liste"] if x["id"] == a["id"]), None)
            if animal is None:
                raise ActionError("Animal introuvable.")
        else:
            animal = min(grp["liste"], key=lambda x: x["sante"])
        price = self.animal_price(cat, animal)
        grp["liste"].remove(animal)
        self.s["argent"] += price
        self.log(f"{animal['nom']} ({ANIMALS[cat]['unite']}) vendu(e) au marché aux bestiaux pour {price:.0f} €.", "info")
        return f"{animal['nom']} vendu(e) : +{price:.0f} €"

    def _a_ameliorer(self, a):
        up = a.get("amelioration")
        if up not in UPGRADES:
            raise ActionError("Amélioration inconnue.")
        if self.has(up):
            raise ActionError("Déjà acheté.")
        self._pay(UPGRADES[up]["prix"])
        self.s["ameliorations"].append(up)
        if up == "reservoir":
            self.s["reservoir"]["capacite"] += 4000
        self.log(f"Nouvelle amélioration : {UPGRADES[up]['nom']} !", "succes")
        return f"{UPGRADES[up]['nom']} installé."

    def _a_construire(self, a):
        b = a.get("batiment")
        if b in ("eolienne", "ruche"):
            info, key = BUILDINGS[b], "eoliennes" if b == "eolienne" else "ruches"
            if self.s[key] >= info["max"]:
                raise ActionError(f"Pas de place pour plus de {info['max']} {info['nom'].lower()}s.")
            self._pay(info["prix"])
            self.s[key] += 1
            where = "près de la maison" if b == "eolienne" else "au bord du jardin"
            self.log(f"{info['nom']} n°{self.s[key]} installée {where} !", "succes")
            return f"{info['nom']} installée."
        if b == "serre":
            info = BUILDINGS["serre"]
            key, f = self._field(a)
            if not self.serre_unlocked():
                raise ActionError(f"Serres débloquées après {info['ventes_requises']} € de ventes "
                                  f"({self.s['stats']['ventes']:.0f} € pour l'instant).")
            if f["serre"]:
                raise ActionError("Cette parcelle est déjà sous serre.")
            if f["etat"] not in ("vide", "fletri"):
                raise ActionError("Récoltez d'abord : la parcelle doit être libre pour construire.")
            self._pay(info["prix"])
            f.update(serre=True, etat="vide", culture=None, croissance=0.0, sante=100.0, mur_depuis=None)
            self.log(f"{self.field_name(key)} construite ! Melons et poivrons y poussent.", "succes")
            return f"{self.field_name(key)} construite."
        raise ActionError("Construction inconnue.")

    def _a_vitesse(self, a):
        v = a.get("valeur")
        if v not in (0, 1, 2, 4, 8):
            raise ActionError("Vitesse invalide.")
        self.s["vitesse"] = v
        return "Pause" if v == 0 else f"Vitesse ×{v}"

    def _a_menu(self, a):
        """Menu principal : le temps s'arrête tant qu'il est ouvert, puis reprend à la même vitesse."""
        if a.get("ouvert"):
            if not self.s["menu"]:
                self.s["vitesse_menu"] = self.s["vitesse"] or 1
            self.s["menu"] = True
            self.s["vitesse"] = 0
            return "Menu principal"
        if self.s["menu"]:
            self.s["menu"] = False
            self.s["vitesse"] = self.s["vitesse_menu"] or 1
        return "C'est reparti !"

    def _a_nouvelle_partie(self, a):
        self.s = self.new_state()
        return "Nouvelle partie !"

    def _pay(self, cost: float):
        if self.s["argent"] < cost:
            raise ActionError(f"Fonds insuffisants ({cost:.0f} € nécessaires).")
        self.s["argent"] -= cost

    # -------- objectifs --------
    def _update_objectives(self):
        done = set(self.s["objectifs"])
        checks = {
            "recolte": self.s["stats"]["recoltes"] >= 1,
            "ventes": self.s["stats"]["ventes"] >= 1000,
            "amelioration": len(self.s["ameliorations"]) >= 1,
            "ruche": self.s["ruches"] >= 1,
            "reputation": self.s["reputation"] >= 75,
            "troupeau": self.n_animals() >= 60,
            "eolienne": self.s["eoliennes"] >= 1,
            "serre": self.n_serres() >= 1,
            "fortune": self.s["argent"] >= TARGET_MONEY,
        }
        for o in OBJECTIVES:
            if o["id"] not in done and checks[o["id"]]:
                self.s["objectifs"].append(o["id"])
                self.log(f"Objectif atteint : {o['titre']} ✓", "succes")
        if "fortune" in self.s["objectifs"] and self.s["statut"] == "en_cours":
            self.s["statut"] = "gagne"
            self.log(f"Victoire ! La ferme vaut plus de {TARGET_MONEY} €.", "succes")

    # -------- vue pour l'interface --------
    def view(self) -> dict:
        s = deepcopy(self.s)
        h = self.hour
        meals = []
        for m in MEALS:
            if m in s["repas"]["faits"]:
                st = "fait"
            elif h >= m + MEAL_WINDOW[1]:
                st = "manque"
            elif h >= m + MEAL_WINDOW[0]:
                st = "maintenant"
            else:
                st = "a_venir"
            meals.append({"heure": f"{m:02d}:00", "statut": st,
                          "menu": {6: "Foin & ensilage", 12: "Céréales", 18: "Foin & maïs"}[m]})
        all_animals = [a for g in s["animaux"].values() for a in g["liste"]]
        animal_health = sum(a["sante"] for a in all_animals) / len(all_animals) if all_animals else 0
        active = [f for f in s["champs"].values() if f["etat"] != "vide"]
        crop_health = sum(f["sante"] for f in active) / len(active) if active else 100
        sat = [g["satiete"] for g in s["animaux"].values() if g["liste"]]
        feed = sum(sat) / len(sat) if sat else 0
        production = 0.0
        for cat, g in s["animaux"].items():
            if g["liste"]:
                production += min(100, g["satiete"] * 1.4) * (sum(a["sante"] for a in g["liste"]) / len(g["liste"]) / 100)
        production /= max(1, sum(1 for g in s["animaux"].values() if g["liste"]))
        produits = {}
        for k in ITEMS:
            price, fair = self.stall_price(k), self.fair_price(k)
            produits[k] = {
                "qualite": round(s["qualite"][k]), "label": quality_label(s["qualite"][k]),
                "bio": round(s["bio"][k], 2), "prix_juste": round(fair, 2), "prix_etal": price,
                "prix_gros": round(self.wholesale_price(k), 3), "chance": round(buy_chance(price / fair), 2),
                "en_vente": self.on_stall(k),
            }
        s["derive"] = {
            "jour": self.day,
            "jour_semaine": JOURS[self.weekday],
            "heure": self.clock(),
            "heure_dec": h,
            "temperature": self.temperature(),
            "n_animaux": self.n_animals(),
            "sante_ferme": round(0.5 * animal_health + 0.5 * crop_health),
            "sante_animaux": round(animal_health),
            "nourriture": round(feed),
            "production": round(production),
            "humidite_moy": round(sum(f["humidite"] for f in s["champs"].values()) / len(s["champs"])),
            "n_cultures": sum(1 for f in s["champs"].values() if f["etat"] in ("seme", "pousse", "mur")),
            "repas": meals,
            "ration": round(self.feed_needed()),
            "malades": sum(1 for a in all_animals if a["sante"] < 50),
            "objectif_argent": TARGET_MONEY,
            "charges": self.charges(),
            "gain_eoliennes": round(self.wind_income()),
            "vent": WEATHER[s["meteo"]["type"]]["vent"],
            "pluie": self.raining(),
            "serre_debloquee": self.serre_unlocked(),
            "n_serres": self.n_serres(),
            "noms_champs": {k: self.field_name(k) for k in s["champs"]},
            "recolte_est": {k: round(self.expected_yield(k)) for k, f in s["champs"].items() if f["culture"]},
            "qualite_champs": {k: round(self.harvest_quality(k)) for k in s["champs"]},
            "produits": produits,
            "marche_ouvert": self.market_open(),
            "jour_de_marche": self.market_day(),
            "prochain_marche": self.next_market(),
            "jours_marche": [JOURS[d] for d in MARKET_DAYS],
            "clients_heure": round(self.customers_per_hour(), 1) if self.market_open() else 0,
            "qualite_animaux": {c: round(self.animal_quality(c)) for c in s["animaux"]},
            "prix_animaux": {c: [self.animal_price(c, x) for x in g["liste"]] for c, g in s["animaux"].items()},
            "miel_jour": round(self.honey_per_day(), 2),
            "qualite_miel": round(self.honey_quality()),
            "miel_bio": self.honey_bio() == 1.0,
            "pollinisation": round((self.pollination() - 1) * 100),
        }
        s["ref"] = {"parcelles": FIELDS, "cultures": CROPS, "animaux": ANIMALS, "produits": ITEMS,
                    "ameliorations": UPGRADES, "batiments": BUILDINGS, "acheteurs": BUYERS, "emoji": EMOJI,
                    "prix_foin": FEED_PRICE, "prix_foin_bio": FEED_BIO_PRICE, "prix_chimique": CHEM_PRICE,
                    "prix_veto": VET_PRICE, "objectifs": OBJECTIVES, "serre_boost": SERRE_BOOST,
                    "tracteur": 1.2, "marche_heures": MARKET_HOURS, "collecte_heure": COLLECTE_HEURE}
        return s

    # -------- persistance --------
    def dumps(self) -> str:
        return json.dumps(self.s, ensure_ascii=False)

    @classmethod
    def loads(cls, txt: str) -> "Game":
        return cls(json.loads(txt))
