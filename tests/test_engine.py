import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from engine import MIN_PER_DAY, ActionError, Game  # noqa: E402


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
        self.assertEqual(len(self.g.s["previsions"]), 3)

    def test_feed_marks_meal(self):
        self.g.advance(60)  # 06:00
        stock = self.g.s["stock"]["foin"]
        self.g.act({"type": "nourrir"})
        self.assertIn(6, self.g.s["repas"]["faits"])
        self.assertLess(self.g.s["stock"]["foin"], stock)

    def test_crop_cycle(self):
        f = self.g.s["champs"]["legumes"]
        f["croissance"], f["humidite"] = 99.9, 80
        self.g.advance(30)
        self.assertEqual(f["etat"], "mur")
        self.g.act({"type": "recolter", "champ": "legumes"})
        self.assertGreater(self.g.s["stock"]["legumes"], 100)
        self.assertEqual(f["etat"], "vide")
        money = self.g.s["argent"]
        self.g.act({"type": "semer", "champ": "legumes"})
        self.assertEqual(f["etat"], "seme")
        self.assertLess(self.g.s["argent"], money)

    def test_harvest_not_ready(self):
        with self.assertRaises(ActionError):
            self.g.act({"type": "recolter", "champ": "mais"})

    def test_sell(self):
        self.g.s["stock"]["lait"] = 100
        money = self.g.s["argent"]
        self.g.act({"type": "vendre", "produit": "lait"})
        self.assertEqual(self.g.s["stock"]["lait"], 0)
        self.assertGreater(self.g.s["argent"], money)

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
            for k, f in g.s["champs"].items():
                try:
                    if f["etat"] == "mur":
                        g.act({"type": "recolter", "champ": k})
                    if f["etat"] in ("vide", "fletri"):
                        g.act({"type": "semer", "champ": k})
                    if f["humidite"] < 30:
                        g.act({"type": "arroser", "champ": k})
                except ActionError:
                    pass
            if g.hour < 0.2:
                for p in ("lait", "oeufs", "laine", "tomates", "legumes"):
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
