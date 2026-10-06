import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from engine import BUILDINGS, MIN_PER_DAY, ActionError, Game  # noqa: E402


class EngineTest(unittest.TestCase):
    def setUp(self):
        self.g = Game(seed=42)

    def test_initial_state(self):
        v = self.g.view()
        self.assertEqual(v["derive"]["jour"], 1)
        self.assertEqual(v["derive"]["heure"], "05:00")
        self.assertEqual(v["derive"]["n_animaux"], 48)

    def test_time_and_new_day(self):
        self.g.advance(MIN_PER_DAY)
        self.assertEqual(self.g.day, 2)
        self.assertEqual(len(self.g.s["previsions"]), 6)
        self.assertEqual(len(self.g.view()["derive"]["semaine"]), 7)

    def test_feed_marks_meal(self):
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
        self.goto(self.g, 1, 21)
        self.assertLess(self.g.s["stock"]["lait"], 1)
        self.assertTrue(any("collecté" in j["msg"] for j in self.g.s["journal"]))

    def test_sell_animal(self):
        g = self.g
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
        g.s["stock"]["foin_bio"] = 1000
        g.act({"type": "nourrir"})
        self.assertEqual(g.s["repas_bio"], 1.0)

    def test_upgrade_and_insufficient_funds(self):
        self.g.act({"type": "ameliorer", "amelioration": "reservoir"})
        self.assertEqual(self.g.s["reservoir"]["capacite"], 12200)
        with self.assertRaises(ActionError):
            self.g.act({"type": "ameliorer", "amelioration": "tracteur"})

    def test_neglect_hurts(self):
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
        for _ in range(15 * 24 * 6):
            g.advance(10)
            if g.s["statut"] != "en_cours":
                break
            if g.hour % 6 < 0.2 and g.hour >= 5.9:
                try:
                    if g.s["stock"]["foin"] + g.s["stock"]["mais"] < g.feed_needed() * 3:
                        g.act({"type": "acheter", "article": "foin", "quantite": 600})
                    g.act({"type": "nourrir"})
                except ActionError:
                    pass
            for k, field in g.s["champs"].items():
                f = field["planches"][0]
                try:
                    if f["etat"] == "mur":
                        g.act({"type": "recolter", "champ": k})
                    if f["etat"] in ("vide", "fletri"):
                        g.act({"type": "semer", "champ": k, "culture": "tomates" if k == "parcelle_a" else "carottes"})
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


if __name__ == "__main__":
    unittest.main()
