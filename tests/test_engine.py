import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from engine import BUILDINGS, MIN_PER_DAY, ActionError, Game  # noqa: E402


def prep(g, *fields):
    """Laboure toutes les planches des parcelles données (toutes par défaut)."""
    for k in fields or list(g.s["champs"]):
        for b in g.s["champs"][k]["planches"]:
            if b["etat"] in ("vide", "fletri") and not (b["etat"] == "vide" and b["sol_pret"]):
                g.act({"type": "preparer", "champ": k, "planche": g.s["champs"][k]["planches"].index(b)})


def herd(g, **n):
    """Achète un petit troupeau (sans toucher à l'argent du test)."""
    money = g.s["argent"]
    g.s["argent"] = 14000   # sous l'objectif de 15 000 € (sinon la partie serait gagnée)
    for cat, q in (n or {"vaches": 4, "poules": 8, "moutons": 2, "cochons": 2}).items():
        g.act({"type": "acheter", "article": cat, "quantite": q})
    g.s["argent"] = money


class EngineTest(unittest.TestCase):
    def setUp(self):
        self.g = Game(seed=42)
        prep(self.g)

    def test_initial_state(self):
        g = Game(seed=1)
        v = g.view()
        self.assertEqual(v["derive"]["jour"], 1)
        self.assertEqual(v["derive"]["heure"], "05:00")
        self.assertEqual(v["derive"]["n_animaux"], 0)                     # le fermier démarre sans bêtes
        self.assertEqual(v["derive"]["soins_cultures"]["a_preparer"], 3)  # parcelles en friche
        with self.assertRaises(ActionError):
            g.act({"type": "semer", "champ": "parcelle_a", "culture": "tomates"})
        with self.assertRaises(ActionError):
            g.act({"type": "nourrir"})

    def test_time_and_new_day(self):
        self.g.advance(MIN_PER_DAY)
        self.assertEqual(self.g.day, 2)
        self.assertEqual(len(self.g.s["previsions"]), 6)
        self.assertEqual(len(self.g.view()["derive"]["semaine"]), 7)

    def test_feed_marks_meal(self):
        herd(self.g)
        self.g.advance(60)  # 06:00
        stock = self.g.s["stock"]["foin"]
        self.g.act({"type": "nourrir"})
        self.assertIn(6, self.g.s["repas"]["faits"])
        self.assertLess(self.g.s["stock"]["foin"], stock)

    def test_fields_start_empty(self):
        for f in self.g.s["champs"].values():
            self.assertEqual(len(f["planches"]), 1)
            self.assertEqual(f["planches"][0]["etat"], "vide")
            self.assertIsNone(f["planches"][0]["culture"])

    def test_crop_cycle(self):
        field = self.g.s["champs"]["parcelle_b"]
        f = field["planches"][0]
        money = self.g.s["argent"]
        self.g.act({"type": "semer", "champ": "parcelle_b", "culture": "carottes"})
        self.assertEqual((f["etat"], f["culture"]), ("seme", "carottes"))
        self.assertLess(self.g.s["argent"], money)
        f["croissance"], field["humidite"] = 99.9, 80
        self.g.advance(30)
        self.assertEqual(f["etat"], "mur")
        self.g.act({"type": "recolter", "champ": "parcelle_b"})
        self.assertGreater(self.g.s["stock"]["carottes"], 100)
        self.assertEqual((f["etat"], f["culture"]), ("vide", None))
        with self.assertRaises(ActionError):   # après la récolte, il faut relabourer
            self.g.act({"type": "semer", "champ": "parcelle_b", "culture": "fraises"})
        self.g.act({"type": "preparer", "champ": "parcelle_b"})
        self.g.act({"type": "semer", "champ": "parcelle_b", "culture": "fraises"})
        self.assertEqual(f["culture"], "fraises")

    def test_sow_requires_choice(self):
        with self.assertRaises(ActionError):
            self.g.act({"type": "semer", "champ": "parcelle_a"})
        with self.assertRaises(ActionError):
            self.g.act({"type": "semer", "champ": "parcelle_a", "culture": "melons"})  # serre uniquement

    def test_harvest_not_ready(self):
        self.g.act({"type": "semer", "champ": "parcelle_c", "culture": "mais"})
        with self.assertRaises(ActionError):
            self.g.act({"type": "recolter", "champ": "parcelle_c"})

    def test_wind_turbines(self):
        self.assertEqual(self.g.s["eoliennes"], 0)  # pas d'éolienne au départ
        self.g.s["argent"] = 10000
        self.g.act({"type": "construire", "batiment": "eolienne"})
        self.g.act({"type": "construire", "batiment": "eolienne"})
        with self.assertRaises(ActionError):
            self.g.act({"type": "construire", "batiment": "eolienne"})
        self.assertIn("eolienne", self.g.s["objectifs"])
        energy = self.g.s["stats"]["energie"]
        self.g.advance(600)
        self.assertGreater(self.g.s["stats"]["energie"], energy)

    def test_greenhouse_unlock(self):
        self.g.s["argent"] = 9000
        with self.assertRaises(ActionError):  # pas encore assez de ventes
            self.g.act({"type": "construire", "batiment": "serre", "champ": "parcelle_a"})
        self.g.s["stats"]["ventes"] = BUILDINGS["serre"]["ventes_requises"]
        self.g.act({"type": "construire", "batiment": "serre", "champ": "parcelle_a"})
        f = self.g.s["champs"]["parcelle_a"]
        self.assertTrue(f["serre"])
        self.g.act({"type": "semer", "champ": "parcelle_a", "culture": "melons"})
        self.assertEqual(f["planches"][0]["culture"], "melons")
        self.assertEqual(self.g.view()["derive"]["noms_champs"]["parcelle_a"], "Serre A")

    def test_greenhouse_grows_faster(self):
        g2 = Game(seed=42)
        prep(g2)
        for g, serre in ((self.g, False), (g2, True)):
            g.s["champs"]["parcelle_b"]["serre"] = serre
            g.act({"type": "semer", "champ": "parcelle_b", "culture": "tomates"})
            g.s["champs"]["parcelle_b"]["humidite"] = 80
            g.advance(300)
        self.assertGreater(g2.s["champs"]["parcelle_b"]["planches"][0]["croissance"],
                           self.g.s["champs"]["parcelle_b"]["planches"][0]["croissance"])

    def test_migrate_v1_save(self):
        old = self.g.s
        old["version"] = 1
        del old["eoliennes"]
        f = lambda etat: {"etat": etat, "croissance": 40.0, "humidite": 60.0, "sante": 90.0,
                          "engrais_jusqua": 0, "mur_depuis": None}
        old["champs"] = {"tomates": f("pousse"), "legumes": f("vide"), "mais": f("pousse")}
        old["stock"]["legumes"] = 50.0
        old["prix"]["legumes"] = old["prix_hier"]["legumes"] = 1.8
        g = Game.loads(json.dumps(old))
        self.assertEqual(g.s["champs"]["parcelle_a"]["planches"][0]["culture"], "tomates")
        self.assertEqual(g.s["champs"]["parcelle_a"]["planches"][0]["croissance"], 40.0)
        self.assertIsNone(g.s["champs"]["parcelle_b"]["planches"][0]["culture"])
        self.assertEqual(g.s["stock"]["carottes"], 50.0)
        self.assertNotIn("legumes", g.s["prix"])
        g.advance(60)
        g.view()

    def goto(self, g, day, hour):
        """Avance jusqu'au jour et à l'heure donnés (le jour 1 est un lundi)."""
        g.advance(((day - 1) * 24 + hour) * 60 - g.s["minute"])

    def test_wholesale(self):
        self.g.s["stock"]["lait"] = 100
        money = self.g.s["argent"]
        self.g.act({"type": "vendre", "produit": "lait"})   # la fromagerie achète tous les jours
        self.assertEqual(self.g.s["stock"]["lait"], 0)
        self.assertGreater(self.g.s["argent"], money)
        self.assertLess(self.g.s["argent"] - money, 100 * self.g.s["prix"]["lait"])  # moins cher qu'au marché

    def test_primeur_only_on_market_days(self):
        self.g.s["stock"]["tomates"] = 50
        with self.assertRaises(ActionError):                 # lundi : pas de marché
            self.g.act({"type": "vendre", "produit": "tomates"})
        self.goto(self.g, 2, 8)                              # mardi 8 h
        self.g.act({"type": "vendre", "produit": "tomates"})
        self.assertEqual(self.g.s["stock"]["tomates"], 0)

    def test_market_three_days_a_week(self):
        g = self.g
        open_days = []
        for day in range(1, 8):
            self.goto(g, day, 9)
            if g.market_open():
                open_days.append(g.weekday)
        self.assertEqual(open_days, [1, 3, 5])               # mardi, jeudi, samedi
        self.goto(g, 9, 14)                                  # mardi, après 13 h
        self.assertFalse(g.market_open())

    def test_customers_buy_at_stall(self):
        g = self.g
        g.s["collecte_lait"] = False
        g.s["stock"].update(tomates=200, oeufs=120)
        self.goto(g, 2, 6)
        money, before = g.s["argent"], g.s["stock"]["tomates"]
        self.goto(g, 2, 13)
        mk = g.s["marche"]
        self.assertGreater(mk["clients"], 20)
        self.assertLess(g.s["stock"]["tomates"], before)
        self.assertGreater(mk["recette"], 0)
        self.assertEqual(mk["etat"], "termine")
        self.assertGreater(g.s["stats"]["ventes_marche"], 0)
        self.assertGreater(g.s["argent"] + 200, money)       # recettes > charges et repas manqués

    def test_price_and_quality_drive_sales(self):
        def market(price=None, quality=80):
            g = Game(seed=5)
            g.s["stock"]["tomates"] = 500
            g.s["qualite"]["tomates"] = quality
            for k in g.s["etal"]:
                g.s["etal"][k]["actif"] = k == "tomates"
            if price is not None:
                g.act({"type": "etal", "produit": "tomates", "prix": price})
            self.goto(g, 2, 13)
            return g.s["marche"]["ventes"].get("tomates", 0)
        fair = market()
        self.assertGreater(fair, market(price=9.0))          # trop cher : les clients passent leur chemin
        g = Game(seed=5)
        g.s["qualite"]["tomates"], g.s["bio"]["tomates"] = 95, 1.0
        high = g.fair_price("tomates")
        g.s["qualite"]["tomates"], g.s["bio"]["tomates"] = 30, 0.0
        self.assertGreater(high, g.fair_price("tomates") * 1.4)

    def test_chemical_fertilizer_not_bio(self):
        g = self.g
        g.act({"type": "semer", "champ": "parcelle_b", "culture": "carottes"})
        g.s["champs"]["parcelle_b"]["humidite"] = 80
        f = g.s["champs"]["parcelle_b"]["planches"][0]
        g.act({"type": "fertiliser", "champ": "parcelle_b", "engrais": "chimique"})
        self.assertTrue(f["chimique"])
        f["croissance"] = 99.9
        g.advance(10)
        g.act({"type": "recolter", "champ": "parcelle_b"})
        self.assertEqual(g.s["bio"]["carottes"], 0.0)
        self.assertFalse(g.honey_bio())

    def test_freshness_decays(self):
        g = self.g
        g.s["collecte_lait"] = False
        for grp in g.s["animaux"].values():
            grp["liste"] = []
        g.s["stock"]["lait"], g.s["qualite"]["lait"] = 100, 90
        g.advance(MIN_PER_DAY)
        self.assertLess(g.s["qualite"]["lait"], 75)
        g.advance(4 * MIN_PER_DAY)
        self.assertEqual(g.s["stock"]["lait"], 0)            # tourné, jeté

    def test_milk_collection(self):
        herd(self.g, vaches=4)
        self.g.act({"type": "nourrir"})
        self.goto(self.g, 1, 19)
        self.g.act({"type": "ramasser", "categorie": "vaches"})   # traite du soir
        self.assertGreater(self.g.s["stock"]["lait"], 10)
        self.goto(self.g, 1, 21)
        self.assertLess(self.g.s["stock"]["lait"], 1)
        self.assertTrue(any("collecté" in j["msg"] for j in self.g.s["journal"]))

    def test_sell_animal(self):
        g = self.g
        herd(g, poules=3)
        n, money = len(g.s["animaux"]["poules"]["liste"]), g.s["argent"]
        g.act({"type": "vendre_animal", "categorie": "poules"})
        self.assertEqual(len(g.s["animaux"]["poules"]["liste"]), n - 1)
        self.assertGreater(g.s["argent"], money)

    def test_beehives_make_honey(self):
        g = self.g
        g.act({"type": "construire", "batiment": "ruche"})
        g.act({"type": "construire", "batiment": "ruche"})
        g.advance(MIN_PER_DAY)
        self.assertGreater(g.s["stock"]["miel"], 0.3)
        self.assertIn("ruche", g.s["objectifs"])
        self.assertGreater(g.pollination(), 1.0)

    def test_rain_waters_fields_not_greenhouses(self):
        g = self.g
        g.s["meteo"] = {"type": "pluie", "nom": "Pluie", "temp": 16}
        for k in ("parcelle_a", "parcelle_b"):
            g.s["champs"][k]["humidite"] = 30
        g.s["champs"]["parcelle_b"]["serre"] = True
        g.advance(120)
        self.assertGreater(g.s["champs"]["parcelle_a"]["humidite"], 45)
        self.assertLess(g.s["champs"]["parcelle_b"]["humidite"], 30)

    def test_menu_pauses_and_resumes(self):
        g = self.g
        g.act({"type": "vitesse", "valeur": 4})
        g.act({"type": "menu", "ouvert": True})
        g.act({"type": "menu", "ouvert": True})        # rouvrir ne perd pas la vitesse
        self.assertEqual((g.s["menu"], g.s["vitesse"]), (True, 0))
        g.act({"type": "menu", "ouvert": False})
        self.assertEqual((g.s["menu"], g.s["vitesse"]), (False, 4))
        g.act({"type": "menu", "ouvert": True})
        g.act({"type": "nouvelle_partie"})
        self.assertEqual((g.s["menu"], g.s["vitesse"], g.day), (False, 1, 1))

    def test_bio_feed(self):
        g = self.g
        herd(g)
        g.s["stock"]["foin_bio"] = 1000
        g.act({"type": "nourrir"})
        self.assertEqual(g.s["repas_bio"], 1.0)

    def test_upgrade_and_insufficient_funds(self):
        self.g.act({"type": "ameliorer", "amelioration": "reservoir"})
        self.assertEqual(self.g.s["reservoir"]["capacite"], 12200)
        with self.assertRaises(ActionError):
            self.g.act({"type": "ameliorer", "amelioration": "tracteur"})

    def test_neglect_hurts(self):
        herd(self.g)
        self.g.advance(3 * MIN_PER_DAY)
        self.assertLess(self.g.view()["derive"]["sante_animaux"], 80)

    def test_save_roundtrip(self):
        self.g.advance(500)
        g2 = Game.loads(self.g.dumps())
        self.assertEqual(g2.view()["derive"], self.g.view()["derive"])

    def test_buy_new_fields(self):
        g = self.g
        g.s["argent"] = 100
        with self.assertRaises(ActionError):
            g.act({"type": "acheter_parcelle"})
        g.s["argent"] = 10000
        charges = g.charges()
        g.act({"type": "acheter_parcelle"})
        self.assertIn("parcelle_d", g.s["champs"])
        self.assertEqual(g.s["argent"], 10000 - 1800)
        self.assertGreater(g.charges(), charges)
        self.assertIn("terrain", g.s["objectifs"])
        v = g.view()
        self.assertEqual(v["derive"]["noms_champs"]["parcelle_d"], "Parcelle D")
        self.assertEqual(v["derive"]["terrain_a_vendre"]["cle"], "parcelle_e")
        self.assertIn("parcelle_d", v["ref"]["parcelles"])
        prep(g, "parcelle_d")   # un terrain acheté est une prairie : à labourer
        # on peut semer, récolter et mettre une serre sur la nouvelle parcelle
        g.act({"type": "semer", "champ": "parcelle_d", "culture": "salades"})
        g.s["champs"]["parcelle_d"]["planches"][0].update(etat="mur", croissance=100.0)
        g.act({"type": "recolter", "champ": "parcelle_d"})
        self.assertGreater(g.s["stock"]["salades"], 0)
        for _ in range(5):
            g.s["argent"] = 10000
            g.act({"type": "acheter_parcelle"})
        self.assertEqual(len(g.s["champs"]), 9)
        self.assertIsNone(g.view()["derive"]["terrain_a_vendre"])
        with self.assertRaises(ActionError):
            g.act({"type": "acheter_parcelle"})
        g2 = Game.loads(g.dumps())
        self.assertEqual(g2.field_name("parcelle_i"), "Parcelle I")

    def test_weather_screen_data(self):
        g = self.g
        g.advance(7 * 60)   # 12:00
        d = g.view()["derive"]
        self.assertEqual(len(d["horaire"]), 8)
        self.assertEqual(d["horaire"][0]["temp"], round(d["temperature"]))
        md = d["meteo_detail"]
        self.assertTrue(0 <= md["humidite_air"] <= 100)
        self.assertGreater(md["vent_kmh"], 0)
        self.assertEqual(d["semaine"][0]["jour"], "Aujourd'hui")
        g.s["meteo"] = {"type": "pluie", "nom": "Pluie", "temp": 16}
        g.advance(MIN_PER_DAY)
        self.assertEqual(g.s["meteo_hier"], "pluie")

    def test_old_save_gets_longer_forecast(self):
        st = json.loads(self.g.dumps())
        st["previsions"] = st["previsions"][:3]
        del st["meteo_hier"]
        g = Game(st)
        self.assertEqual(len(g.s["previsions"]), 6)
        self.assertIsNone(g.s["meteo_hier"])

    def test_beds_mixed_crops(self):
        g = self.g
        f = g.s["champs"]["parcelle_a"]
        g.act({"type": "diviser", "champ": "parcelle_a", "planches": 2})
        self.assertEqual(len(f["planches"]), 2)
        self.assertTrue(all(b["sol_pret"] for b in f["planches"]))   # découper garde le labour
        with self.assertRaises(ActionError):
            g.act({"type": "diviser", "champ": "parcelle_a", "planches": 4})
        g.act({"type": "semer", "champ": "parcelle_a", "planche": 0, "culture": "salades"})
        alone = g.expected_yield("parcelle_a", 0)
        g.act({"type": "semer", "champ": "parcelle_a", "planche": 1, "culture": "carottes"})
        self.assertTrue(g.mixed("parcelle_a"))
        self.assertIn("association", g.s["objectifs"])
        self.assertAlmostEqual(g.expected_yield("parcelle_a", 0), alone * 1.10)
        with self.assertRaises(ActionError):   # on ne redécoupe pas une parcelle en culture
            g.act({"type": "diviser", "champ": "parcelle_a", "planches": 3})
        with self.assertRaises(ActionError):
            g.act({"type": "semer", "champ": "parcelle_a", "planche": 5, "culture": "salades"})
        # chaque planche pousse et se récolte séparément ; l'arrosage est commun
        f["humidite"] = 80
        f["planches"][0]["croissance"] = 99.9
        g.advance(10)
        self.assertEqual(f["planches"][0]["etat"], "mur")
        self.assertEqual(f["planches"][1]["etat"], "seme")
        g.act({"type": "recolter", "champ": "parcelle_a", "planche": 0})
        self.assertGreater(g.s["stock"]["salades"], 0)
        self.assertLess(g.s["stock"]["salades"], 150 * 1.25)   # la moitié de la parcelle seulement
        v = g.view()["derive"]
        self.assertEqual(len(v["recolte_est"]["parcelle_a"]), 2)

    def test_technologies(self):
        g = self.g
        with self.assertRaises(ActionError):
            g.act({"type": "technologie", "tech": "drone"})   # trop cher
        g.s["argent"] = 14000
        charges = g.charges()
        g.act({"type": "technologie", "tech": "recolteur"})
        self.assertGreater(g.charges(), charges + 17)
        self.assertIn("techno", g.s["objectifs"])
        g.s["argent"] = 14000
        g.act({"type": "technologie", "tech": "semoir"})
        with self.assertRaises(ActionError):
            g.act({"type": "technologie", "tech": "semoir"})
        # robot de récolte + semoir : la planche mûre est récoltée puis ressemée toute seule
        g.act({"type": "semer", "champ": "parcelle_b", "culture": "salades"})
        b = g.s["champs"]["parcelle_b"]["planches"][0]
        g.s["champs"]["parcelle_b"]["humidite"] = 80
        b["croissance"] = 99.9
        g.advance(10)
        self.assertGreater(g.s["stock"]["salades"], 0)
        self.assertEqual((b["etat"], b["culture"]), ("seme", "salades"))

    def test_drone_and_weeder(self):
        results = {}
        for techs in ((), ("drone", "desherbeur")):
            g = Game(seed=5)
            prep(g)
            g.s["meteo"] = {"type": "canicule", "nom": "Canicule", "temp": 38}
            g.s["technologies"] = list(techs)
            g.act({"type": "semer", "champ": "parcelle_b", "culture": "tomates"})
            g.s["champs"]["parcelle_b"]["humidite"] = 20
            g.advance(240)
            b = g.s["champs"]["parcelle_b"]["planches"][0]
            results[techs] = (b["qualite"], b["croissance"])
        self.assertGreater(results[("drone", "desherbeur")][0], results[()][0])
        self.assertGreater(results[("drone", "desherbeur")][1], results[()][1])

    def test_migrate_v3_fields(self):
        st = json.loads(self.g.dumps())
        st["version"] = 3
        st["champs"]["parcelle_a"] = {"etat": "pousse", "culture": "mais", "serre": False, "croissance": 50.0,
                                      "humidite": 70.0, "sante": 90.0, "qualite": 80.0, "chimique": False,
                                      "engrais_jusqua": 0, "boost": 1.0, "mur_depuis": None}
        del st["technologies"]
        g = Game(st)
        f = g.s["champs"]["parcelle_a"]
        self.assertEqual(f["humidite"], 70.0)
        self.assertEqual(f["planches"][0]["culture"], "mais")
        self.assertNotIn("etat", f)
        self.assertEqual(g.s["technologies"], [])
        g.advance(60)

    def test_diligent_player_progresses(self):
        """Un joueur appliqué doit gagner de l'argent sur 15 jours."""
        g = self.g
        bought = False
        for _ in range(15 * 24 * 6):
            g.advance(10)
            if g.s["statut"] != "en_cours":
                break
            if not bought and g.day == 3:   # les premières bêtes, une fois les cultures lancées
                g.act({"type": "acheter", "article": "poules", "quantite": 10})
                g.act({"type": "acheter", "article": "cochons", "quantite": 1})
                bought = True
            if bought and g.hour % 6 < 0.2 and g.hour >= 5.9:
                try:
                    if g.s["stock"]["foin"] + g.s["stock"]["mais"] < g.feed_needed() * 3:
                        g.act({"type": "acheter", "article": "foin", "quantite": 600})
                    g.act({"type": "nourrir"})
                    g.act({"type": "ramasser"})
                    g.act({"type": "caliner", "categorie": "poules"})
                except ActionError:
                    pass
                for act in ({"type": "nettoyer"}, {"type": "sortir", "dehors": 8 <= g.hour < 18}):
                    try:
                        g.act(act)
                    except ActionError:
                        pass
            for k, field in g.s["champs"].items():
                f = field["planches"][0]
                try:
                    if f["etat"] == "mur":
                        g.act({"type": "recolter", "champ": k})
                    if f["etat"] == "fletri" or (f["etat"] == "vide" and not f["sol_pret"]):
                        g.act({"type": "preparer", "champ": k})
                    if f["etat"] == "vide":
                        g.act({"type": "semer", "champ": k, "culture": "tomates" if k == "parcelle_a" else "carottes"})
                    if f["nuisible"]:
                        g.act({"type": "traiter", "champ": k, "traitement": "naturel"})
                    if f["herbes"] > 40:
                        g.act({"type": "desherber", "champ": k})
                    if field["humidite"] < 30:
                        g.act({"type": "arroser", "champ": k})
                except ActionError:
                    pass
            if g.market_day() and 12.8 <= g.hour < 12.97:   # fin de marché : le surplus part en gros
                for p in ("oeufs", "laine", "tomates", "carottes"):
                    try:
                        g.act({"type": "vendre", "produit": p})
                    except ActionError:
                        pass
        print(f"\n  → après 15 jours : {g.s['argent']:.0f} €, statut {g.s['statut']}, "
              f"{g.n_animals()} animaux, santé {g.view()['derive']['sante_ferme']} %")
        self.assertEqual(g.s["statut"], "en_cours")
        self.assertGreater(g.s["argent"], 1500)

    def test_weeds_slow_growth(self):
        g, g2 = self.g, Game(seed=42)
        prep(g2)
        for x in (g, g2):
            x.act({"type": "semer", "champ": "parcelle_b", "culture": "pommes_de_terre"})
            x.s["champs"]["parcelle_b"]["humidite"] = 80
        g2.s["champs"]["parcelle_b"]["planches"][0]["herbes"] = 100   # planche envahie
        g.advance(300)
        g2.advance(300)
        b, b2 = g.s["champs"]["parcelle_b"]["planches"][0], g2.s["champs"]["parcelle_b"]["planches"][0]
        self.assertGreater(b["herbes"], 0)                              # elles repoussent
        self.assertGreater(b["croissance"], b2["croissance"] * 1.3)
        g2.act({"type": "desherber", "champ": "parcelle_b"})
        self.assertEqual(b2["herbes"], 0)
        g.s["technologies"] = ["desherbeur"]                           # le robot s'en charge
        g.advance(60)
        self.assertEqual(b["herbes"], 0)

    def test_pests_and_treatments(self):
        g = self.g
        g.act({"type": "semer", "champ": "parcelle_a", "culture": "tomates"})
        b = g.s["champs"]["parcelle_a"]["planches"][0]
        with self.assertRaises(ActionError):
            g.act({"type": "traiter", "champ": "parcelle_a"})
        b["nuisible"] = "pucerons"
        g.s["champs"]["parcelle_a"]["humidite"] = 80
        g.advance(120)
        self.assertLess(b["sante"], 100)
        money = g.s["argent"]
        g.act({"type": "traiter", "champ": "parcelle_a", "traitement": "naturel"})
        self.assertIsNone(b["nuisible"])
        self.assertFalse(b["chimique"])
        self.assertLess(g.s["argent"], money)
        b["nuisible"] = "pucerons"
        g.act({"type": "traiter", "champ": "parcelle_a", "traitement": "chimique"})
        self.assertTrue(b["chimique"])
        self.assertGreater(b["protege_jusqua"], g.s["minute"])
        # les nuisibles finissent par arriver tout seuls sur une planche non protégée
        b["protege_jusqua"] = 0
        g.s["champs"]["parcelle_a"]["humidite"] = 80
        for _ in range(20):
            g.advance(MIN_PER_DAY)
            if b["nuisible"] or b["etat"] == "fletri":
                break
            b["herbes"] = 0
        self.assertTrue(b["nuisible"] or b["etat"] == "fletri")

    def test_tractor_prepares_whole_field(self):
        g = Game(seed=3)
        g.act({"type": "diviser", "champ": "parcelle_a", "planches": 3})
        g.act({"type": "preparer", "champ": "parcelle_a", "planche": 1})
        self.assertEqual([b["sol_pret"] for b in g.s["champs"]["parcelle_a"]["planches"]], [False, True, False])
        g.s["argent"] = 5000
        g.act({"type": "ameliorer", "amelioration": "tracteur"})
        g.act({"type": "preparer", "champ": "parcelle_a", "planche": 0})
        self.assertTrue(all(b["sol_pret"] for b in g.s["champs"]["parcelle_a"]["planches"]))
        with self.assertRaises(ActionError):
            g.act({"type": "preparer", "champ": "parcelle_a"})

    def test_collect_by_hand(self):
        g = self.g
        herd(g, vaches=2, poules=6)
        g.act({"type": "nourrir"})
        with self.assertRaises(ActionError):
            g.act({"type": "ramasser"})
        g.advance(6 * 60)
        self.assertEqual(g.s["stock"]["lait"], 0)                # le lait attend la traite
        self.assertGreater(g.s["animaux"]["vaches"]["a_ramasser"], 5)
        g.act({"type": "ramasser", "categorie": "vaches"})
        self.assertGreater(g.s["stock"]["lait"], 5)
        self.assertEqual(g.s["animaux"]["vaches"]["a_ramasser"], 0)
        # sans traite, la production plafonne à une journée
        for _ in range(3):
            g.act({"type": "nourrir"})
            g.advance(8 * 60)
        self.assertLessEqual(g.s["animaux"]["vaches"]["a_ramasser"], 2 * 22.0 + 1e-6)
        # le robot de traite ramasse tout seul
        g.s["technologies"] = ["robot_traite"]
        lait = g.s["stock"]["lait"]
        g.act({"type": "nourrir"})
        g.advance(60)
        self.assertGreater(g.s["stock"]["lait"], lait)

    def test_clean_pen(self):
        g = self.g
        herd(g, cochons=2)
        grp = g.s["animaux"]["cochons"]
        for _ in range(12):
            g.act({"type": "nourrir"})
            g.advance(6 * 60)
        self.assertLess(grp["proprete"], 35)
        self.assertLess(grp["liste"][0]["sante"], 100)            # enclos sale : les bêtes tombent malades
        fumier = g.s["stock"]["fumier"]
        g.act({"type": "nettoyer", "categorie": "cochons"})
        self.assertEqual(grp["proprete"], 100)
        self.assertGreater(g.s["stock"]["fumier"], fumier + 4)
        with self.assertRaises(ActionError):
            g.act({"type": "nettoyer", "categorie": "cochons"})

    def test_cuddles_and_mood(self):
        g = self.g
        herd(g, moutons=2)
        a, b = g.s["animaux"]["moutons"]["liste"]
        a["humeur"] = b["humeur"] = 30
        g.act({"type": "caliner", "categorie": "moutons", "id": a["id"]})
        self.assertEqual((a["humeur"], b["humeur"]), (55, 30))
        with self.assertRaises(ActionError):                      # pas deux câlins d'affilée
            g.act({"type": "caliner", "categorie": "moutons", "id": a["id"]})
        g.act({"type": "caliner", "categorie": "moutons"})        # tout l'enclos : seulement ceux qui attendent
        self.assertEqual((a["humeur"], b["humeur"]), (55, 55))
        self.assertGreater(g.mood_factor(80), g.mood_factor(20))

    def test_pasture(self):
        g = self.g
        g.s["meteo"] = {"type": "soleil", "nom": "Ensoleillé", "temp": 25}
        herd(g, vaches=2, poules=4)
        g.advance(3 * 60)   # 08:00
        g.act({"type": "nourrir"})
        g.act({"type": "sortir", "categorie": "vaches", "dehors": True})
        g.advance(6 * 60)
        v, p = g.s["animaux"]["vaches"], g.s["animaux"]["poules"]
        self.assertGreater(v["satiete"], p["satiete"] + 15)      # au pré, elles broutent
        self.assertGreater(g.mood("vaches"), g.mood("poules"))
        with self.assertRaises(ActionError):
            g.act({"type": "sortir", "categorie": "vaches", "dehors": True})
        g.act({"type": "sortir", "dehors": False})
        self.assertFalse(v["au_pre"])
        # des poules laissées dehors la nuit attirent le renard
        g.act({"type": "sortir", "categorie": "poules", "dehors": True})
        n = len(p["liste"])
        for _ in range(6):
            g.advance(MIN_PER_DAY)
        self.assertLess(len(p["liste"]), n)

    def test_migrate_old_herd(self):
        st = json.loads(self.g.dumps())
        st["animaux"]["vaches"] = {"satiete": 80.0, "prochain_id": 1,
                                   "liste": [{"id": "va0", "nom": "Marguerite", "sante": 90.0}]}
        for b in st["champs"]["parcelle_a"]["planches"]:
            for k in ("sol_pret", "herbes", "nuisible", "protege_jusqua"):
                del b[k]
        g = Game(st)
        self.assertEqual(g.s["animaux"]["vaches"]["proprete"], 100.0)
        self.assertEqual(g.s["animaux"]["vaches"]["liste"][0]["humeur"], 70.0)
        self.assertTrue(g.s["champs"]["parcelle_a"]["planches"][0]["sol_pret"])
        g.advance(120)
        g.view()

    # ---- saisons ----
    def test_seasons_cycle(self):
        g = self.g
        self.assertEqual(g.saison, "printemps")
        for day, sz in ((8, "ete"), (15, "automne"), (22, "hiver"), (29, "printemps")):
            self.goto(g, day, 1)
            self.assertEqual(g.saison, sz)
        self.assertEqual(g.year, 2)
        self.assertIn("hiver", g.s["objectifs"])          # premier hiver passé
        info = g.view()["derive"]["saison"]
        self.assertEqual((info["annee"], info["jour"], info["prochaine"]), (2, 1, "Été"))

    def test_sowing_out_of_season(self):
        g = self.g
        g.s["minute"] = 21 * MIN_PER_DAY + 8 * 60           # jour 22 : l'hiver
        with self.assertRaises(ActionError):
            g.act({"type": "semer", "champ": "parcelle_a", "culture": "tomates"})
        g.act({"type": "semer", "champ": "parcelle_a", "culture": "carottes"})   # rustique
        g.s["argent"], g.s["stats"]["ventes"] = 9000, 5000
        g.act({"type": "construire", "batiment": "serre", "champ": "parcelle_b"})
        g.act({"type": "semer", "champ": "parcelle_b", "culture": "tomates"})    # sous serre, toute l'année
        self.assertFalse(g.view()["derive"]["en_saison"]["tomates"])

    def test_frost_hurts_fragile_crops(self):
        g = self.g
        g.act({"type": "semer", "champ": "parcelle_a", "culture": "tomates"})
        g.act({"type": "semer", "champ": "parcelle_b", "culture": "carottes"})
        g.s["meteo"] = {"type": "nuageux", "nom": "Nuageux", "temp": -4}
        for k in ("parcelle_a", "parcelle_b"):
            g.s["champs"][k]["humidite"] = 70
        g.advance(240)
        tomates, carottes = (g.s["champs"][k]["planches"][0] for k in ("parcelle_a", "parcelle_b"))
        self.assertLess(tomates["sante"], 100)
        self.assertEqual(carottes["sante"], 100)
        self.assertTrue(any("gèle" in j["msg"] for j in g.s["journal"]))

    def test_winter_weather_and_appetite(self):
        g = self.g
        herd(g, vaches=2)
        summer = g.feed_needed()
        g.s["minute"] = 21 * MIN_PER_DAY + 60
        self.assertGreater(g.feed_needed(), summer)
        rng = __import__("random").Random(1)
        temps = [g._pick_weather(rng, 23) for _ in range(200)]
        self.assertFalse(any(w["type"] == "canicule" for w in temps))
        self.assertLess(sum(w["temp"] for w in temps) / 200, 12)

    def test_off_season_prices(self):
        g = self.g
        self.assertEqual(g.season_price("tomates"), 2.4)
        g.s["minute"] = 21 * MIN_PER_DAY + 60
        self.assertGreater(g.season_price("tomates"), 2.4)
        self.assertEqual(g.season_price("carottes"), 1.7)

    # ---- atelier ----
    def test_workshop(self):
        g = self.g
        g.s["argent"] = 9000
        with self.assertRaises(ActionError):                # pas de matériel sans bâtiment
            g.act({"type": "equiper", "equipement": "cuve_fromage"})
        g.act({"type": "construire", "batiment": "atelier"})
        g.act({"type": "equiper", "equipement": "cuve_fromage"})
        charges = g.charges()
        self.assertGreaterEqual(charges, 35 + 8 + 4)
        with self.assertRaises(ActionError):                # pas de lait
            g.act({"type": "transformer", "recette": "fromage"})
        with self.assertRaises(ActionError):                # pas de chaudron
            g.act({"type": "transformer", "recette": "confiture"})
        g._add("lait", 100, 80, 1.0)
        g.act({"type": "transformer", "recette": "fromage"})
        self.assertAlmostEqual(g.s["stock"]["lait"], 20)    # capacité : 8 lots de 10 L
        with self.assertRaises(ActionError):                # une fournée à la fois
            g.act({"type": "transformer", "recette": "fromage", "lots": 1})
        g.advance(8 * 60 + 5)
        self.assertAlmostEqual(g.s["stock"]["fromage"], 8)
        self.assertGreater(g.s["qualite"]["fromage"], 80)
        self.assertGreater(g.s["bio"]["fromage"], 0.95)
        self.assertIn("transformation", g.s["objectifs"])
        self.assertTrue(g.view()["derive"]["produits"]["fromage"]["en_vente"])

    def test_workshop_auto_restart_and_multi_inputs(self):
        g = self.g
        g.s["argent"] = 9000
        g.act({"type": "construire", "batiment": "atelier"})
        g.act({"type": "equiper", "equipement": "autoclave"})
        g._add("potirons", 10, 70, 1.0)
        g._add("carottes", 1, 90, 0.0)
        self.assertEqual(g.max_lots("veloute"), 2)          # limité par les carottes
        g.act({"type": "atelier_auto", "equipement": "autoclave", "actif": True})
        g.act({"type": "transformer", "recette": "veloute"})
        self.assertAlmostEqual(g.s["stock"]["potirons"], 6)
        g.advance(5 * 60 + 5)
        self.assertAlmostEqual(g.s["stock"]["veloute"], 2)
        self.assertLess(g.s["bio"]["veloute"], 1)            # une partie des ingrédients n'était pas bio
        self.assertIsNone(g.s["atelier"]["equipements"]["autoclave"]["lot"])   # plus de carottes : pas de relance

    # ---- commandes ----
    def test_orders(self):
        g = self.g
        g._new_order(__import__("random").Random(5))
        o = g.s["commandes"][0]
        with self.assertRaises(ActionError):
            g.act({"type": "livrer", "id": o["id"]})
        g._add(o["produit"], o["qte"] + 1, 95, 1.0)
        money, rep = g.s["argent"], g.s["reputation"]
        g.act({"type": "livrer", "id": o["id"]})
        self.assertEqual(g.s["argent"], money + o["prix"])
        self.assertGreater(g.s["reputation"], rep)
        self.assertEqual(g.s["commandes"], [])
        self.assertIn("commande", g.s["objectifs"])

    def test_orders_expire_and_refuse(self):
        g = self.g
        rng = __import__("random").Random(9)
        g._new_order(rng)
        g._new_order(rng)
        a, b = g.s["commandes"]
        rep = g.s["reputation"]
        g.act({"type": "refuser", "id": a["id"]})
        self.assertEqual(g.s["reputation"], rep - 1)
        g.advance(b["echeance"] - g.s["minute"] + 10)
        self.assertNotIn(b["id"], [x["id"] for x in g.s["commandes"]])
        self.assertEqual(g.s["stats"]["commandes_ratees"], 1)

    def test_orders_arrive_over_time(self):
        g = self.g
        self.goto(g, 12, 8)
        self.assertGreater(g.s["prochaine_commande"], 1)
        self.assertLessEqual(len(g.s["commandes"]), 3)
        for o in g.view()["derive"]["commandes"]:
            self.assertIn(o["produit"], g._order_candidates())

    # ---- événements ----
    def test_random_events(self):
        g = self.g
        herd(g, vaches=2, poules=6)
        g.act({"type": "semer", "champ": "parcelle_a", "culture": "tomates"})
        rng = __import__("random").Random(0)
        for _ in range(60):
            g._random_event(rng)
        self.assertGreater(len(g.s["evenements"]), 10)
        self.assertLessEqual(len(g.s["evenements"]), 12)
        self.assertTrue({"bon", "mauvais"} <= {e["type"] for e in g.s["evenements"]})

    def test_market_effects(self):
        g = self.g
        self.goto(g, 2, 9)                                   # mardi, marché ouvert
        base_c, base_p = g.customers_per_hour() or 1, g.fair_price("tomates")
        g.s["effets"].append({"id": "foire", "nom": "Foire", "emoji": "🎪", "clients": 1.3, "prix": 1.15,
                              "fin": g.next_market_end()})
        self.assertAlmostEqual(g.fair_price("tomates"), base_p * 1.15)
        self.goto(g, 2, 14)
        self.assertEqual(g.active_effects(), [])

    def test_breakdown_stops_tech(self):
        g = self.g
        g.s["technologies"] = ["desherbeur"]
        g.s["effets"].append({"id": "panne", "tech": "desherbeur", "nom": "Panne", "emoji": "🔧", "fin": g.s["minute"] + 60})
        self.assertFalse(g.has_tech("desherbeur"))
        with self.assertRaises(ActionError):                 # on ne le rachète pas pour autant
            g.act({"type": "technologie", "tech": "desherbeur"})
        g.advance(61)
        self.assertTrue(g.has_tech("desherbeur"))

    # ---- mode libre ----
    def test_free_mode_after_victory(self):
        g = self.g
        g.s["argent"] = 15500
        g.act({"type": "vitesse", "valeur": 1})            # les objectifs sont vérifiés à chaque action
        self.assertEqual(g.s["statut"], "gagne")
        g.act({"type": "continuer"})
        self.assertEqual((g.s["statut"], g.s["mode"]), ("en_cours", "libre"))
        g.advance(MIN_PER_DAY)
        self.assertEqual(g.s["statut"], "en_cours")
        self.assertIsNone(g.view()["derive"]["objectif_argent"])

    def test_new_free_game(self):
        g = self.g
        g.act({"type": "nouvelle_partie", "mode": "libre"})
        self.assertEqual(g.s["mode"], "libre")
        g.s["argent"] = 20000
        g.act({"type": "vitesse", "valeur": 1})
        self.assertEqual(g.s["statut"], "en_cours")
        g.s["argent"] = -100
        g.advance(3 * MIN_PER_DAY)
        self.assertEqual(g.s["statut"], "perdu")             # la faillite reste possible
        with self.assertRaises(ActionError):
            g.act({"type": "nouvelle_partie", "mode": "facile"})

    def test_migrate_v4_save(self):
        st = json.loads(self.g.dumps())
        for k in ("mode", "atelier", "commandes", "prochaine_commande", "effets", "evenements", "gel_jour"):
            del st[k]
        st["version"] = 4
        g = Game(st)
        self.assertEqual(g.s["mode"], "classique")
        self.assertFalse(g.s["atelier"]["construit"])
        g.advance(2 * MIN_PER_DAY)
        json.dumps(g.view())

    def test_long_game_through_winter(self):
        """Un joueur appliqué traverse une année entière (atelier, commandes, serres) sans faire faillite."""
        g = self.g
        g.s["argent"] = 6000
        herd(g, vaches=2, poules=12, moutons=2, cochons=1)
        g.act({"type": "construire", "batiment": "atelier"})
        g.act({"type": "equiper", "equipement": "cuve_fromage"})
        g.act({"type": "atelier_auto", "equipement": "cuve_fromage", "actif": True})
        g.s["collecte_lait"] = False
        for _ in range(28 * 24 * 6):
            g.advance(10)
            if g.s["statut"] != "en_cours":
                break
            if g.hour % 6 < 0.2 and g.hour >= 5.9:
                for act in ({"type": "acheter", "article": "foin", "quantite": 400} if g.s["stock"]["foin"] < g.feed_needed() * 4 else None,
                            {"type": "nourrir"}, {"type": "ramasser"}, {"type": "nettoyer"},
                            {"type": "caliner", "categorie": "vaches"}, {"type": "soigner"},
                            {"type": "transformer", "recette": "fromage"}):
                    try:
                        if act:
                            g.act(act)
                    except ActionError:
                        pass
                for o in list(g.s["commandes"]):
                    try:
                        g.act({"type": "livrer", "id": o["id"]})
                    except ActionError:
                        pass
            for k, field in g.s["champs"].items():
                f = field["planches"][0]
                crop = next(c for c in ("tomates", "carottes", "salades") if g.in_season(c))
                for act in ({"type": "recolter", "champ": k} if f["etat"] == "mur" else None,
                            {"type": "preparer", "champ": k} if f["etat"] == "fletri" or (f["etat"] == "vide" and not f["sol_pret"]) else None,
                            {"type": "semer", "champ": k, "culture": crop} if f["etat"] == "vide" else None,
                            {"type": "traiter", "champ": k, "traitement": "naturel"} if f["nuisible"] else None,
                            {"type": "desherber", "champ": k} if f["herbes"] > 40 else None,
                            {"type": "arroser", "champ": k} if field["humidite"] < 30 else None):
                    try:
                        if act:
                            g.act(act)
                    except ActionError:
                        pass
            if g.market_day() and 12.8 <= g.hour < 12.97:
                for p in ("oeufs", "laine", "tomates", "carottes", "salades", "fromage", "lait"):
                    try:
                        g.act({"type": "vendre", "produit": p})
                    except ActionError:
                        pass
        print(f"\n  → après un an : {g.s['argent']:.0f} €, statut {g.s['statut']}, {g.s['stats']['transformations']} fournées, "
              f"{g.s['stats']['commandes']} commandes livrées / {g.s['stats']['commandes_ratees']} ratées, "
              f"{len(g.s['evenements'])} événements récents")
        self.assertEqual(g.s["statut"], "en_cours")
        self.assertGreater(g.s["stats"]["transformations"], 5)
        self.assertIn("hiver", g.s["objectifs"])


if __name__ == "__main__":
    unittest.main()
