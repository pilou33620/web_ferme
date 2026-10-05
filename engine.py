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

# --- Données de référence -------------------------------------------------

CROPS = {
    "tomates": {"nom": "Champ de tomates", "culture": "Tomates", "jours": 4.0, "rendement": 320,
                 "graines": 60, "produit": "tomates"},
    "legumes": {"nom": "Potager", "culture": "Légumes", "jours": 3.0, "rendement": 230,
                 "graines": 40, "produit": "legumes"},
    "mais":    {"nom": "Champ de maïs", "culture": "Maïs", "jours": 5.0, "rendement": 420,
                 "graines": 70, "produit": "mais"},
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

ITEMS = {  # produits vendables
    "tomates": {"nom": "Tomates", "unite": "kg", "prix": 2.4},
    "legumes": {"nom": "Légumes", "unite": "kg", "prix": 1.8},
    "mais":    {"nom": "Maïs", "unite": "kg", "prix": 0.9},
    "lait":    {"nom": "Lait", "unite": "L", "prix": 0.75},
    "oeufs":   {"nom": "Œufs", "unite": "u", "prix": 0.3},
    "laine":   {"nom": "Laine", "unite": "kg", "prix": 9.0},
    "fumier":  {"nom": "Fumier", "unite": "kg", "prix": 0.08},
}

FEED_PRICE = 0.25
VET_PRICE = 25  # €/kg de foin

UPGRADES = {
    "arrosage":  {"nom": "Arrosage intelligent", "prix": 1200,
                   "desc": "Arrose automatiquement les parcelles quand le sol descend sous 35 %."},
    "distributeur": {"nom": "Distributeur automatique", "prix": 1500,
                   "desc": "Nourrit les animaux à chaque repas (06 h, 12 h, 18 h)."},
    "reservoir": {"nom": "Grand réservoir", "prix": 900,
                   "desc": "+4 000 L de capacité et pompe deux fois plus rapide."},
    "cloture":   {"nom": "Clôture renforcée", "prix": 400,
                   "desc": "Protège le poulailler du renard."},
    "tracteur":  {"nom": "Tracteur", "prix": 2200,
                   "desc": "+20 % de rendement à chaque récolte."},
}

WEATHER = {
    "soleil":   {"nom": "Ensoleillé", "temp": 26, "pluie": 0.0, "evap": 1.0, "poids": 40},
    "nuageux":  {"nom": "Nuageux", "temp": 20, "pluie": 0.0, "evap": 0.7, "poids": 25},
    "pluie":    {"nom": "Pluie", "temp": 16, "pluie": 1.0, "evap": 0.3, "poids": 18},
    "orage":    {"nom": "Orage", "temp": 19, "pluie": 1.6, "evap": 0.4, "poids": 7},
    "canicule": {"nom": "Canicule", "temp": 35, "pluie": 0.0, "evap": 2.0, "poids": 10},
}

OBJECTIVES = [
    {"id": "recolte", "titre": "Faire une première récolte"},
    {"id": "ventes", "titre": "Vendre pour 1 000 € de produits"},
    {"id": "amelioration", "titre": "Acheter une amélioration"},
    {"id": "troupeau", "titre": "Atteindre 60 animaux"},
    {"id": "fortune", "titre": f"Atteindre {TARGET_MONEY:,} € en caisse".replace(",", " ")},
]


def clamp(v, lo=0.0, hi=100.0):
    return max(lo, min(hi, v))


class ActionError(Exception):
    pass


# --- Jeu ------------------------------------------------------------------

class Game:
    def __init__(self, state: dict | None = None, seed: int | None = None):
        self.s = state if state is not None else self.new_state(seed)

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
        fields = {
            "tomates": {"etat": "pousse", "croissance": 58.0, "humidite": 72.0, "sante": 95.0, "engrais_jusqua": 0, "mur_depuis": None},
            "legumes": {"etat": "pousse", "croissance": 30.0, "humidite": 64.0, "sante": 92.0, "engrais_jusqua": 0, "mur_depuis": None},
            "mais":    {"etat": "pousse", "croissance": 12.0, "humidite": 70.0, "sante": 96.0, "engrais_jusqua": 0, "mur_depuis": None},
        }
        st = {
            "version": 1,
            "seed": seed,
            "minute": 5 * 60,          # jour 1, 05:00
            "vitesse": 1,
            "argent": 1500.0,
            "statut": "en_cours",
            "jours_dans_le_rouge": 0,
            "meteo": None,
            "previsions": [],
            "reservoir": {"niveau": 6720.0, "capacite": 8200.0},
            "champs": fields,
            "animaux": animals,
            "repas": {"jour": 1, "faits": []},
            "stock": {"foin": 900.0, "tomates": 0.0, "legumes": 0.0, "mais": 0.0, "lait": 0.0,
                      "oeufs": 0.0, "laine": 0.0, "fumier": 80.0},
            "prix": {k: v["prix"] for k, v in ITEMS.items()},
            "prix_hier": {k: v["prix"] for k, v in ITEMS.items()},
            "ameliorations": [],
            "stats": {"recolte_kg": 0.0, "ventes": 0.0, "recoltes": 0, "production_jour": {}, "hier": {}},
            "objectifs": [],
            "journal": [],
        }
        g = Game(st)
        g._roll_forecast(initial=True)
        g.log("Bienvenue à la Ferme du Val Vert ! Les animaux attendent leur repas de 06 h.", "info")
        return st

    # -------- utilitaires --------
    @property
    def day(self) -> int:
        return self.s["minute"] // MIN_PER_DAY + 1

    @property
    def hour(self) -> float:
        return (self.s["minute"] % MIN_PER_DAY) / 60.0

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

    def n_animals(self) -> int:
        return sum(len(a["liste"]) for a in self.s["animaux"].values())

    def temperature(self) -> float:
        base = self.s["meteo"]["temp"]
        return round(base - 6 + 9 * max(0.0, math.sin((self.hour - 6) / 24 * 2 * math.pi)), 1)

    # -------- météo / marché --------
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
            if self.s["statut"] != "en_cours":
                break

    def _step(self, m: float):
        w = WEATHER[self.s["meteo"]["type"]]
        temp = self.temperature()
        tank = self.s["reservoir"]
        # pluie + pompe
        pump = 1.0 if self.has("reservoir") else 0.5
        tank["niveau"] = min(tank["capacite"], tank["niveau"] + (pump + 14 * w["pluie"]) * m)

        # cultures
        for key, f in self.s["champs"].items():
            crop = CROPS[key]
            evap = 0.025 * w["evap"] * (1 + max(0, temp - 22) / 15) * m
            f["humidite"] = clamp(f["humidite"] - evap + 0.12 * w["pluie"] * m)
            if self.has("arrosage") and f["etat"] in ("seme", "pousse", "mur") and f["humidite"] < 35:
                self._water(key, auto=True)
            if f["etat"] in ("seme", "pousse"):
                hum = f["humidite"]
                water_factor = 0.15 if hum < 15 else (0.6 if hum < 35 else (1.0 if hum <= 90 else 0.7))
                heat = 0.6 if temp > 34 else 1.0
                boost = 1.5 if f["engrais_jusqua"] > self.s["minute"] else 1.0
                rate = 100.0 / (crop["jours"] * MIN_PER_DAY)
                f["croissance"] = min(100.0, f["croissance"] + rate * water_factor * heat * boost * m)
                if f["croissance"] > 8:
                    f["etat"] = "pousse"
                if hum < 15:
                    f["sante"] = clamp(f["sante"] - 0.02 * m)
                elif hum > 35:
                    f["sante"] = clamp(f["sante"] + 0.004 * m)
                if f["croissance"] >= 100:
                    f["etat"] = "mur"
                    f["mur_depuis"] = self.s["minute"]
                    self.log(f"{crop['nom']} : la récolte est prête !", "succes")
                if f["sante"] <= 0:
                    f["etat"] = "fletri"
                    self.log(f"{crop['nom']} : les plants ont flétri, faute d'eau.", "alerte")
            elif f["etat"] == "mur":
                if self.s["minute"] - (f["mur_depuis"] or 0) > 1.5 * MIN_PER_DAY:
                    f["sante"] = clamp(f["sante"] - 0.03 * m)
                    if f["sante"] <= 0:
                        f["etat"] = "fletri"
                        self.log(f"{crop['nom']} : la récolte a pourri sur pied.", "alerte")

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
                self.s["stock"][info["produit"]] += qty
                prod[info["produit"]] = prod.get(info["produit"], 0) + qty
            # décès
            dead = [a for a in grp["liste"] if a["sante"] <= 0]
            for a in dead:
                grp["liste"].remove(a)
                self.log(f"{a['nom']} ({info['unite']}) n'a pas survécu… Pensez à nourrir et soigner le troupeau.", "alerte")

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

    def _new_day(self):
        self._roll_forecast()
        self._update_prices()
        st = self.s["stats"]
        st["hier"], st["production_jour"] = st["production_jour"], {}
        # charges
        charges = 35 + 1.5 * self.n_animals() + 12 * len(self.s["ameliorations"])
        self.s["argent"] -= charges
        self.log(f"Jour {self.day} — charges du jour : {charges:.0f} €. Météo : {self.s['meteo']['nom']}.", "info")
        # événements
        rng = self.rng("event")
        w = self.s["meteo"]["type"]
        if w == "orage":
            key = rng.choice(list(self.s["champs"]))
            f = self.s["champs"][key]
            if f["etat"] in ("pousse", "mur"):
                f["sante"] = clamp(f["sante"] - 25)
                self.log(f"L'orage a abîmé le {CROPS[key]['nom'].lower()} (−25 % de santé).", "alerte")
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
            self.log(f"Forte demande au marché : le prix des {ITEMS[item]['nom'].lower()} s'envole !", "succes")
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
        need = self.feed_needed()
        stock = self.s["stock"]
        available = stock["foin"] + stock["mais"]
        if available < need:
            if auto:
                self.log("Distributeur : stock de foin insuffisant !", "alerte")
                return False
            raise ActionError(f"Il faut {need:.0f} kg de nourriture (foin + maïs), vous en avez {available:.0f} kg.")
        from_hay = min(stock["foin"], need)
        stock["foin"] -= from_hay
        stock["mais"] -= need - from_hay
        for grp in self.s["animaux"].values():
            grp["satiete"] = 100.0
        return True

    # -------- actions joueur --------
    def act(self, action: dict) -> str:
        t = action.get("type")
        if self.s["statut"] != "en_cours" and t not in ("nouvelle_partie", "vitesse"):
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

    def _a_semer(self, a):
        key, f = self._field(a)
        if f["etat"] not in ("vide", "fletri"):
            raise ActionError("La parcelle n'est pas libre.")
        cost = CROPS[key]["graines"]
        self._pay(cost)
        f.update(etat="seme", croissance=0.0, sante=100.0, mur_depuis=None)
        self.log(f"{CROPS[key]['nom']} semé (−{cost} €).", "info")
        return f"{CROPS[key]['culture']} semées."

    def _a_arroser(self, a):
        key, f = self._field(a)
        if f["etat"] in ("vide",):
            raise ActionError("Rien à arroser ici.")
        self._water(key)
        return f"{CROPS[key]['nom']} arrosé (−600 L)."

    def _a_fertiliser(self, a):
        key, f = self._field(a)
        if f["etat"] not in ("seme", "pousse"):
            raise ActionError("Le fumier n'est utile que sur une culture en pousse.")
        if self.s["stock"]["fumier"] < 50:
            raise ActionError("Il faut 50 kg de fumier (produit par les cochons).")
        self.s["stock"]["fumier"] -= 50
        f["engrais_jusqua"] = self.s["minute"] + MIN_PER_DAY
        return f"{CROPS[key]['nom']} fertilisé : croissance ×1,5 pendant 24 h."

    def _a_recolter(self, a):
        key, f = self._field(a)
        if f["etat"] != "mur":
            raise ActionError("La récolte n'est pas encore prête.")
        crop = CROPS[key]
        qty = crop["rendement"] * (0.3 + 0.7 * f["sante"] / 100) * (1.2 if self.has("tracteur") else 1.0)
        qty = round(qty)
        self.s["stock"][crop["produit"]] += qty
        self.s["stats"]["recolte_kg"] += qty
        self.s["stats"]["recoltes"] += 1
        f.update(etat="vide", croissance=0.0, mur_depuis=None, engrais_jusqua=0)
        self.log(f"Récolte : {qty} kg de {crop['culture'].lower()} rentrés au stock.", "succes")
        return f"+{qty} kg de {crop['culture'].lower()}."

    def _a_nourrir(self, a):
        self._feed()
        rp = self.s["repas"]
        h = self.hour
        slot = next((m for m in MEALS if m + MEAL_WINDOW[0] <= h < m + MEAL_WINDOW[1]), None)
        if slot is not None and slot not in rp["faits"]:
            rp["faits"].append(slot)
        return "Les animaux ont mangé."

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
        item = a.get("produit")
        if item not in ITEMS:
            raise ActionError("Produit inconnu.")
        have = self.s["stock"][item]
        qty = have if a.get("quantite") in (None, "tout") else min(float(a["quantite"]), have)
        if item == "oeufs":
            qty = math.floor(qty)
        if qty <= 0:
            raise ActionError("Rien à vendre.")
        gain = qty * self.s["prix"][item]
        self.s["stock"][item] -= qty
        self.s["argent"] += gain
        self.s["stats"]["ventes"] += gain
        self.log(f"Vente : {qty:.0f} {ITEMS[item]['unite']} de {ITEMS[item]['nom'].lower()} pour {gain:.0f} €.", "succes")
        return f"+{gain:.0f} €"

    def _a_acheter(self, a):
        item = a.get("article")
        qty = int(a.get("quantite", 1))
        if qty <= 0:
            raise ActionError("Quantité invalide.")
        if item == "foin":
            self._pay(qty * FEED_PRICE)
            self.s["stock"]["foin"] += qty
            return f"+{qty} kg de foin."
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

    def _a_vitesse(self, a):
        v = a.get("valeur")
        if v not in (0, 1, 2, 4, 8):
            raise ActionError("Vitesse invalide.")
        self.s["vitesse"] = v
        return "Pause" if v == 0 else f"Vitesse ×{v}"

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
            "troupeau": self.n_animals() >= 60,
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
        s["derive"] = {
            "jour": self.day,
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
        }
        s["ref"] = {"cultures": CROPS, "animaux": ANIMALS, "produits": ITEMS, "ameliorations": UPGRADES,
                    "prix_foin": FEED_PRICE, "prix_veto": VET_PRICE, "objectifs": OBJECTIVES}
        return s

    # -------- persistance --------
    def dumps(self) -> str:
        return json.dumps(self.s, ensure_ascii=False)

    @classmethod
    def loads(cls, txt: str) -> "Game":
        return cls(json.loads(txt))
