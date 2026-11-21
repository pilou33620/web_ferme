//! Les bancs d'essai du moteur, repris un pour un de tests/test_engine.py.

use ferme::hasard::Random;
use ferme::moteur::{fmod, mood_factor, pick_weather, rond, Game, MIN_PER_DAY, V};
use serde_json::{json, Value};

fn ok(g: &mut Game, a: Value) {
    if let Err(e) = g.act(&a) {
        panic!("{a} : {e}");
    }
}

fn err(g: &mut Game, a: Value) {
    assert!(g.act(&a).is_err(), "{a} aurait dû être refusée");
}

fn cles(v: &Value) -> Vec<String> {
    v.as_object().unwrap().keys().cloned().collect()
}

/// Laboure toutes les planches des parcelles données (toutes par défaut).
fn prep(g: &mut Game, champs: &[&str]) {
    let champs: Vec<String> = if champs.is_empty() { cles(&g.s["champs"]) } else { champs.iter().map(|c| c.to_string()).collect() };
    for k in champs {
        for i in 0..g.s["champs"][k.as_str()]["planches"].l().len() {
            let b = &g.s["champs"][k.as_str()]["planches"][i];
            let etat = b["etat"].t().to_string();
            if (etat == "vide" || etat == "fletri") && !(etat == "vide" && b["sol_pret"].vrai()) {
                ok(g, json!({"type": "preparer", "champ": k, "planche": i}));
            }
        }
    }
}

/// Achète un petit troupeau (sans toucher à l'argent du test).
fn herd(g: &mut Game, n: &[(&str, i64)]) {
    let money = g.s["argent"].clone();
    g.s["argent"] = json!(14000); // sous l'objectif de 15 000 € (sinon la partie serait gagnée)
    let defaut = [("vaches", 4), ("poules", 8), ("moutons", 2), ("cochons", 2)];
    for (cat, q) in if n.is_empty() { &defaut[..] } else { n } {
        ok(g, json!({"type": "acheter", "article": cat, "quantite": q}));
    }
    g.s["argent"] = money;
}

/// Avance jusqu'au jour et à l'heure donnés (le jour 1 est un lundi).
fn goto(g: &mut Game, day: i64, hour: i64) {
    let cible = ((day - 1) * 24 + hour) as f64 * 60.0;
    g.advance(cible - g.minute());
}

/// La partie de chaque essai : graine 42, toutes les parcelles labourées.
fn base() -> Game {
    let mut g = Game::nouvelle(Some(42));
    prep(&mut g, &[]);
    g
}

fn pl<'a>(g: &'a Game, k: &str, i: usize) -> &'a Value {
    &g.s["champs"][k]["planches"][i]
}

fn contient(v: &Value, x: &str) -> bool {
    v.l().iter().any(|e| e.t() == x)
}

fn proche(a: f64, b: f64) -> bool {
    (a - b).abs() < 1e-7
}

#[test]
fn initial_state() {
    let mut g = Game::nouvelle(Some(1));
    let v = g.view();
    assert_eq!(v["derive"]["jour"], 1);
    assert_eq!(v["derive"]["heure"], "05:00");
    assert_eq!(v["derive"]["n_animaux"], 0); // le fermier démarre sans bêtes
    assert_eq!(v["derive"]["soins_cultures"]["a_preparer"], 3); // parcelles en friche
    err(&mut g, json!({"type": "semer", "champ": "parcelle_a", "culture": "tomates"}));
    err(&mut g, json!({"type": "nourrir"}));
}

#[test]
fn time_and_new_day() {
    let mut g = base();
    g.advance(MIN_PER_DAY);
    assert_eq!(g.day(), 2);
    assert_eq!(g.s["previsions"].l().len(), 6);
    assert_eq!(g.view()["derive"]["semaine"].l().len(), 7);
}

#[test]
fn feed_marks_meal() {
    let mut g = base();
    herd(&mut g, &[]);
    g.advance(60.0); // 06:00
    let stock = g.s["stock"]["foin"].f();
    ok(&mut g, json!({"type": "nourrir"}));
    assert!(g.s["repas"]["faits"].l().iter().any(|x| x.f() == 6.0));
    assert!(g.s["stock"]["foin"].f() < stock);
}

#[test]
fn fields_start_empty() {
    let g = base();
    for k in cles(&g.s["champs"]) {
        assert_eq!(g.s["champs"][k.as_str()]["planches"].l().len(), 1);
        assert_eq!(pl(&g, &k, 0)["etat"], "vide");
        assert!(pl(&g, &k, 0)["culture"].is_null());
    }
}

#[test]
fn crop_cycle() {
    let mut g = base();
    let money = g.s["argent"].f();
    ok(&mut g, json!({"type": "semer", "champ": "parcelle_b", "culture": "carottes"}));
    assert_eq!((pl(&g, "parcelle_b", 0)["etat"].t(), pl(&g, "parcelle_b", 0)["culture"].t()), ("seme", "carottes"));
    assert!(g.s["argent"].f() < money);
    g.s["champs"]["parcelle_b"]["planches"][0]["croissance"] = json!(99.9);
    g.s["champs"]["parcelle_b"]["humidite"] = json!(80);
    g.advance(30.0);
    assert_eq!(pl(&g, "parcelle_b", 0)["etat"], "mur");
    ok(&mut g, json!({"type": "recolter", "champ": "parcelle_b"}));
    assert!(g.s["stock"]["carottes"].f() > 100.0);
    assert_eq!(pl(&g, "parcelle_b", 0)["etat"], "vide");
    assert!(pl(&g, "parcelle_b", 0)["culture"].is_null());
    err(&mut g, json!({"type": "semer", "champ": "parcelle_b", "culture": "fraises"})); // après la récolte, il faut relabourer
    ok(&mut g, json!({"type": "preparer", "champ": "parcelle_b"}));
    ok(&mut g, json!({"type": "semer", "champ": "parcelle_b", "culture": "fraises"}));
    assert_eq!(pl(&g, "parcelle_b", 0)["culture"], "fraises");
}

#[test]
fn sow_requires_choice() {
    let mut g = base();
    err(&mut g, json!({"type": "semer", "champ": "parcelle_a"}));
    err(&mut g, json!({"type": "semer", "champ": "parcelle_a", "culture": "melons"})); // serre uniquement
}

#[test]
fn harvest_not_ready() {
    let mut g = base();
    ok(&mut g, json!({"type": "semer", "champ": "parcelle_c", "culture": "mais"}));
    err(&mut g, json!({"type": "recolter", "champ": "parcelle_c"}));
}

#[test]
fn wind_turbines() {
    let mut g = base();
    assert_eq!(g.s["eoliennes"], 0); // pas d'éolienne au départ
    g.s["argent"] = json!(10000);
    ok(&mut g, json!({"type": "construire", "batiment": "eolienne"}));
    ok(&mut g, json!({"type": "construire", "batiment": "eolienne"}));
    err(&mut g, json!({"type": "construire", "batiment": "eolienne"}));
    assert!(contient(&g.s["objectifs"], "eolienne"));
    let energy = g.s["stats"]["energie"].f();
    g.advance(600.0);
    assert!(g.s["stats"]["energie"].f() > energy);
}

#[test]
fn greenhouse_unlock() {
    let mut g = base();
    g.s["argent"] = json!(9000);
    err(&mut g, json!({"type": "construire", "batiment": "serre", "champ": "parcelle_a"})); // pas encore assez de ventes
    g.s["stats"]["ventes"] = json!(3000);
    ok(&mut g, json!({"type": "construire", "batiment": "serre", "champ": "parcelle_a"}));
    assert_eq!(g.s["champs"]["parcelle_a"]["serre"], true);
    ok(&mut g, json!({"type": "semer", "champ": "parcelle_a", "culture": "melons"}));
    assert_eq!(pl(&g, "parcelle_a", 0)["culture"], "melons");
    assert_eq!(g.view()["derive"]["noms_champs"]["parcelle_a"], "Serre A");
}

#[test]
fn greenhouse_grows_faster() {
    let mut g = base();
    let mut g2 = base();
    for (x, serre) in [(&mut g, false), (&mut g2, true)] {
        x.s["champs"]["parcelle_b"]["serre"] = json!(serre);
        ok(x, json!({"type": "semer", "champ": "parcelle_b", "culture": "tomates"}));
        x.s["champs"]["parcelle_b"]["humidite"] = json!(80);
        x.advance(300.0);
    }
    assert!(pl(&g2, "parcelle_b", 0)["croissance"].f() > pl(&g, "parcelle_b", 0)["croissance"].f());
}

#[test]
fn migrate_v1_save() {
    let mut old = base().s;
    old["version"] = json!(1);
    old.as_object_mut().unwrap().remove("eoliennes");
    let f = |etat: &str| json!({"etat": etat, "croissance": 40.0, "humidite": 60.0, "sante": 90.0, "engrais_jusqua": 0, "mur_depuis": null});
    old["champs"] = json!({"tomates": f("pousse"), "legumes": f("vide"), "mais": f("pousse")});
    old["stock"]["legumes"] = json!(50.0);
    old["prix"]["legumes"] = json!(1.8);
    old["prix_hier"]["legumes"] = json!(1.8);
    let mut g = Game::relire(&old.to_string()).unwrap();
    assert_eq!(pl(&g, "parcelle_a", 0)["culture"], "tomates");
    assert_eq!(pl(&g, "parcelle_a", 0)["croissance"], 40.0);
    assert!(pl(&g, "parcelle_b", 0)["culture"].is_null());
    assert_eq!(g.s["stock"]["carottes"], 50.0);
    assert!(g.s["prix"].get("legumes").is_none());
    g.advance(60.0);
    g.view();
}

#[test]
fn wholesale() {
    let mut g = base();
    g.s["stock"]["lait"] = json!(100);
    let money = g.s["argent"].f();
    ok(&mut g, json!({"type": "vendre", "produit": "lait"})); // la fromagerie achète tous les jours
    assert_eq!(g.s["stock"]["lait"].f(), 0.0);
    assert!(g.s["argent"].f() > money);
    assert!(g.s["argent"].f() - money < 100.0 * g.s["prix"]["lait"].f()); // moins cher qu'au marché
}

#[test]
fn primeur_only_on_market_days() {
    let mut g = base();
    g.s["stock"]["tomates"] = json!(50);
    err(&mut g, json!({"type": "vendre", "produit": "tomates"})); // lundi : pas de marché
    goto(&mut g, 2, 8); // mardi 8 h
    ok(&mut g, json!({"type": "vendre", "produit": "tomates"}));
    assert_eq!(g.s["stock"]["tomates"].f(), 0.0);
}

#[test]
fn market_three_days_a_week() {
    let mut g = base();
    let mut open_days = Vec::new();
    for day in 1..=7 {
        goto(&mut g, day, 9);
        if g.market_open() {
            open_days.push(g.weekday());
        }
    }
    assert_eq!(open_days, vec![1, 3, 5]); // mardi, jeudi, samedi
    goto(&mut g, 9, 14); // mardi, après 13 h
    assert!(!g.market_open());
}

#[test]
fn customers_buy_at_stall() {
    let mut g = base();
    g.s["collecte_lait"] = json!(false);
    g.s["stock"]["tomates"] = json!(200);
    g.s["stock"]["oeufs"] = json!(120);
    goto(&mut g, 2, 6);
    let (money, before) = (g.s["argent"].f(), g.s["stock"]["tomates"].f());
    goto(&mut g, 2, 13);
    let mk = &g.s["marche"];
    assert!(mk["clients"].f() > 20.0);
    assert!(g.s["stock"]["tomates"].f() < before);
    assert!(mk["recette"].f() > 0.0);
    assert_eq!(mk["etat"], "termine");
    assert!(g.s["stats"]["ventes_marche"].f() > 0.0);
    assert!(g.s["argent"].f() + 200.0 > money); // recettes > charges et repas manqués
}

#[test]
fn price_and_quality_drive_sales() {
    let market = |price: Option<f64>| -> f64 {
        let mut g = Game::nouvelle(Some(5));
        g.s["stock"]["tomates"] = json!(500);
        g.s["qualite"]["tomates"] = json!(80);
        for k in cles(&g.s["etal"]) {
            g.s["etal"][k.as_str()]["actif"] = json!(k == "tomates");
        }
        if let Some(p) = price {
            ok(&mut g, json!({"type": "etal", "produit": "tomates", "prix": p}));
        }
        goto(&mut g, 2, 13);
        g.s["marche"]["ventes"]["tomates"].f()
    };
    let fair = market(None);
    assert!(fair > market(Some(9.0))); // trop cher : les clients passent leur chemin
    let mut g = Game::nouvelle(Some(5));
    g.s["qualite"]["tomates"] = json!(95);
    g.s["bio"]["tomates"] = json!(1.0);
    let high = g.fair_price("tomates");
    g.s["qualite"]["tomates"] = json!(30);
    g.s["bio"]["tomates"] = json!(0.0);
    assert!(high > g.fair_price("tomates") * 1.4);
}

#[test]
fn chemical_fertilizer_not_bio() {
    let mut g = base();
    ok(&mut g, json!({"type": "semer", "champ": "parcelle_b", "culture": "carottes"}));
    g.s["champs"]["parcelle_b"]["humidite"] = json!(80);
    ok(&mut g, json!({"type": "fertiliser", "champ": "parcelle_b", "engrais": "chimique"}));
    assert_eq!(pl(&g, "parcelle_b", 0)["chimique"], true);
    g.s["champs"]["parcelle_b"]["planches"][0]["croissance"] = json!(99.9);
    g.advance(10.0);
    ok(&mut g, json!({"type": "recolter", "champ": "parcelle_b"}));
    assert_eq!(g.s["bio"]["carottes"].f(), 0.0);
    assert_eq!(g.honey_bio(), 0.0);
}

#[test]
fn freshness_decays() {
    let mut g = base();
    g.s["collecte_lait"] = json!(false);
    for c in cles(&g.s["animaux"]) {
        g.s["animaux"][c.as_str()]["liste"] = json!([]);
    }
    g.s["stock"]["lait"] = json!(100);
    g.s["qualite"]["lait"] = json!(90);
    g.advance(MIN_PER_DAY);
    assert!(g.s["qualite"]["lait"].f() < 75.0);
    g.advance(4.0 * MIN_PER_DAY);
    assert_eq!(g.s["stock"]["lait"].f(), 0.0); // tourné, jeté
}

#[test]
fn milk_collection() {
    let mut g = base();
    herd(&mut g, &[("vaches", 4)]);
    ok(&mut g, json!({"type": "nourrir"}));
    goto(&mut g, 1, 19);
    ok(&mut g, json!({"type": "ramasser", "categorie": "vaches"})); // traite du soir
    assert!(g.s["stock"]["lait"].f() > 10.0);
    goto(&mut g, 1, 21);
    assert!(g.s["stock"]["lait"].f() < 1.0);
    assert!(g.s["journal"].l().iter().any(|j| j["msg"].t().contains("collecté")));
}

#[test]
fn sell_animal() {
    let mut g = base();
    herd(&mut g, &[("poules", 3)]);
    let (n, money) = (g.s["animaux"]["poules"]["liste"].l().len(), g.s["argent"].f());
    ok(&mut g, json!({"type": "vendre_animal", "categorie": "poules"}));
    assert_eq!(g.s["animaux"]["poules"]["liste"].l().len(), n - 1);
    assert!(g.s["argent"].f() > money);
}

#[test]
fn beehives_make_honey() {
    let mut g = base();
    ok(&mut g, json!({"type": "construire", "batiment": "ruche"}));
    ok(&mut g, json!({"type": "construire", "batiment": "ruche"}));
    g.advance(MIN_PER_DAY);
    assert!(g.s["stock"]["miel"].f() > 0.3);
    assert!(contient(&g.s["objectifs"], "ruche"));
    assert!(g.pollination() > 1.0);
}

#[test]
fn rain_waters_fields_not_greenhouses() {
    let mut g = base();
    g.s["meteo"] = json!({"type": "pluie", "nom": "Pluie", "temp": 16});
    for k in ["parcelle_a", "parcelle_b"] {
        g.s["champs"][k]["humidite"] = json!(30);
    }
    g.s["champs"]["parcelle_b"]["serre"] = json!(true);
    g.advance(120.0);
    assert!(g.s["champs"]["parcelle_a"]["humidite"].f() > 45.0);
    assert!(g.s["champs"]["parcelle_b"]["humidite"].f() < 30.0);
}

#[test]
fn menu_pauses_and_resumes() {
    let mut g = base();
    ok(&mut g, json!({"type": "vitesse", "valeur": 4}));
    ok(&mut g, json!({"type": "menu", "ouvert": true}));
    ok(&mut g, json!({"type": "menu", "ouvert": true})); // rouvrir ne perd pas la vitesse
    assert_eq!((g.s["menu"].clone(), g.s["vitesse"].clone()), (json!(true), json!(0)));
    ok(&mut g, json!({"type": "menu", "ouvert": false}));
    assert_eq!((g.s["menu"].clone(), g.s["vitesse"].clone()), (json!(false), json!(4)));
    ok(&mut g, json!({"type": "menu", "ouvert": true}));
    ok(&mut g, json!({"type": "nouvelle_partie"}));
    assert_eq!((g.s["menu"].clone(), g.s["vitesse"].clone(), g.day()), (json!(false), json!(1), 1));
}

#[test]
fn bio_feed() {
    let mut g = base();
    herd(&mut g, &[]);
    g.s["stock"]["foin_bio"] = json!(1000);
    ok(&mut g, json!({"type": "nourrir"}));
    assert_eq!(g.s["repas_bio"], 1.0);
}

#[test]
fn upgrade_and_insufficient_funds() {
    let mut g = base();
    ok(&mut g, json!({"type": "ameliorer", "amelioration": "reservoir"}));
    assert_eq!(g.s["reservoir"]["capacite"].f(), 12200.0);
    err(&mut g, json!({"type": "ameliorer", "amelioration": "tracteur"}));
}

#[test]
fn neglect_hurts() {
    let mut g = base();
    herd(&mut g, &[]);
    g.advance(3.0 * MIN_PER_DAY);
    assert!(g.view()["derive"]["sante_animaux"].f() < 80.0);
}

#[test]
fn save_roundtrip() {
    let mut g = base();
    g.advance(500.0);
    let g2 = Game::relire(&g.dumps()).unwrap();
    assert_eq!(g2.view()["derive"], g.view()["derive"]);
}

#[test]
fn buy_new_fields() {
    let mut g = base();
    g.s["argent"] = json!(100);
    err(&mut g, json!({"type": "acheter_parcelle"}));
    g.s["argent"] = json!(10000);
    let charges = g.charges();
    ok(&mut g, json!({"type": "acheter_parcelle"}));
    assert!(g.s["champs"].get("parcelle_d").is_some());
    assert_eq!(g.s["argent"].f(), 10000.0 - 1800.0);
    assert!(g.charges() > charges);
    assert!(contient(&g.s["objectifs"], "terrain"));
    let v = g.view();
    assert_eq!(v["derive"]["noms_champs"]["parcelle_d"], "Parcelle D");
    assert_eq!(v["derive"]["terrain_a_vendre"]["cle"], "parcelle_e");
    assert!(v["ref"]["parcelles"].get("parcelle_d").is_some());
    prep(&mut g, &["parcelle_d"]); // un terrain acheté est une prairie : à labourer
    // on peut semer, récolter et mettre une serre sur la nouvelle parcelle
    ok(&mut g, json!({"type": "semer", "champ": "parcelle_d", "culture": "salades"}));
    g.s["champs"]["parcelle_d"]["planches"][0]["etat"] = json!("mur");
    g.s["champs"]["parcelle_d"]["planches"][0]["croissance"] = json!(100.0);
    ok(&mut g, json!({"type": "recolter", "champ": "parcelle_d"}));
    assert!(g.s["stock"]["salades"].f() > 0.0);
    for _ in 0..5 {
        g.s["argent"] = json!(10000);
        ok(&mut g, json!({"type": "acheter_parcelle"}));
    }
    assert_eq!(cles(&g.s["champs"]).len(), 9);
    assert!(g.view()["derive"]["terrain_a_vendre"].is_null());
    err(&mut g, json!({"type": "acheter_parcelle"}));
    let g2 = Game::relire(&g.dumps()).unwrap();
    assert_eq!(g2.field_name("parcelle_i"), "Parcelle I");
}

#[test]
fn weather_screen_data() {
    let mut g = base();
    g.advance(7.0 * 60.0); // 12:00
    let d = g.view()["derive"].clone();
    assert_eq!(d["horaire"].l().len(), 8);
    assert_eq!(d["horaire"][0]["temp"].i(), rond(d["temperature"].f()));
    let md = &d["meteo_detail"];
    assert!((0.0..=100.0).contains(&md["humidite_air"].f()));
    assert!(md["vent_kmh"].f() > 0.0);
    assert_eq!(d["semaine"][0]["jour"], "Aujourd'hui");
    g.s["meteo"] = json!({"type": "pluie", "nom": "Pluie", "temp": 16});
    g.advance(MIN_PER_DAY);
    assert_eq!(g.s["meteo_hier"], "pluie");
}

#[test]
fn old_save_gets_longer_forecast() {
    let mut st: Value = serde_json::from_str(&base().dumps()).unwrap();
    st["previsions"].as_array_mut().unwrap().truncate(3);
    st.as_object_mut().unwrap().remove("meteo_hier");
    let g = Game::depuis(st);
    assert_eq!(g.s["previsions"].l().len(), 6);
    assert!(g.s["meteo_hier"].is_null());
}

#[test]
fn beds_mixed_crops() {
    let mut g = base();
    ok(&mut g, json!({"type": "diviser", "champ": "parcelle_a", "planches": 2}));
    assert_eq!(g.s["champs"]["parcelle_a"]["planches"].l().len(), 2);
    assert!(g.s["champs"]["parcelle_a"]["planches"].l().iter().all(|b| b["sol_pret"].vrai())); // découper garde le labour
    err(&mut g, json!({"type": "diviser", "champ": "parcelle_a", "planches": 4}));
    ok(&mut g, json!({"type": "semer", "champ": "parcelle_a", "planche": 0, "culture": "salades"}));
    let alone = g.expected_yield("parcelle_a", 0);
    ok(&mut g, json!({"type": "semer", "champ": "parcelle_a", "planche": 1, "culture": "carottes"}));
    assert!(g.mixed("parcelle_a"));
    assert!(contient(&g.s["objectifs"], "association"));
    assert!(proche(g.expected_yield("parcelle_a", 0), alone * 1.10));
    err(&mut g, json!({"type": "diviser", "champ": "parcelle_a", "planches": 3})); // on ne redécoupe pas une parcelle en culture
    err(&mut g, json!({"type": "semer", "champ": "parcelle_a", "planche": 5, "culture": "salades"}));
    // chaque planche pousse et se récolte séparément ; l'arrosage est commun
    g.s["champs"]["parcelle_a"]["humidite"] = json!(80);
    g.s["champs"]["parcelle_a"]["planches"][0]["croissance"] = json!(99.9);
    g.advance(10.0);
    assert_eq!(pl(&g, "parcelle_a", 0)["etat"], "mur");
    assert_eq!(pl(&g, "parcelle_a", 1)["etat"], "seme");
    ok(&mut g, json!({"type": "recolter", "champ": "parcelle_a", "planche": 0}));
    assert!(g.s["stock"]["salades"].f() > 0.0);
    assert!(g.s["stock"]["salades"].f() < 150.0 * 1.25); // la moitié de la parcelle seulement
    assert_eq!(g.view()["derive"]["recolte_est"]["parcelle_a"].l().len(), 2);
}

#[test]
fn technologies() {
    let mut g = base();
    err(&mut g, json!({"type": "technologie", "tech": "drone"})); // trop cher
    g.s["argent"] = json!(14000);
    let charges = g.charges();
    ok(&mut g, json!({"type": "technologie", "tech": "recolteur"}));
    assert!(g.charges() > charges + 17.0);
    assert!(contient(&g.s["objectifs"], "techno"));
    g.s["argent"] = json!(14000);
    ok(&mut g, json!({"type": "technologie", "tech": "semoir"}));
    err(&mut g, json!({"type": "technologie", "tech": "semoir"}));
    // robot de récolte + semoir : la planche mûre est récoltée puis ressemée toute seule
    ok(&mut g, json!({"type": "semer", "champ": "parcelle_b", "culture": "salades"}));
    g.s["champs"]["parcelle_b"]["humidite"] = json!(80);
    g.s["champs"]["parcelle_b"]["planches"][0]["croissance"] = json!(99.9);
    g.advance(10.0);
    assert!(g.s["stock"]["salades"].f() > 0.0);
    assert_eq!((pl(&g, "parcelle_b", 0)["etat"].t(), pl(&g, "parcelle_b", 0)["culture"].t()), ("seme", "salades"));
}

#[test]
fn drone_and_weeder() {
    let mut results = Vec::new();
    for techs in [json!([]), json!(["drone", "desherbeur"])] {
        let mut g = Game::nouvelle(Some(5));
        prep(&mut g, &[]);
        g.s["meteo"] = json!({"type": "canicule", "nom": "Canicule", "temp": 38});
        g.s["technologies"] = techs;
        ok(&mut g, json!({"type": "semer", "champ": "parcelle_b", "culture": "tomates"}));
        g.s["champs"]["parcelle_b"]["humidite"] = json!(20);
        g.advance(240.0);
        let b = pl(&g, "parcelle_b", 0);
        results.push((b["qualite"].f(), b["croissance"].f()));
    }
    assert!(results[1].0 > results[0].0);
    assert!(results[1].1 > results[0].1);
}

#[test]
fn migrate_v3_fields() {
    let mut st: Value = serde_json::from_str(&base().dumps()).unwrap();
    st["version"] = json!(3);
    st["champs"]["parcelle_a"] = json!({"etat": "pousse", "culture": "mais", "serre": false, "croissance": 50.0,
                                        "humidite": 70.0, "sante": 90.0, "qualite": 80.0, "chimique": false,
                                        "engrais_jusqua": 0, "boost": 1.0, "mur_depuis": null});
    st.as_object_mut().unwrap().remove("technologies");
    let mut g = Game::depuis(st);
    let f = &g.s["champs"]["parcelle_a"];
    assert_eq!(f["humidite"], 70.0);
    assert_eq!(f["planches"][0]["culture"], "mais");
    assert!(f.get("etat").is_none());
    assert_eq!(g.s["technologies"], json!([]));
    g.advance(60.0);
}

/// Les soins d'une parcelle par le joueur appliqué : la première action refusée arrête la suite.
fn bed(g: &Game, k: &str, cle: &str) -> Value {
    g.s["champs"][k]["planches"][0][cle].clone()
}

fn soigner_parcelle(g: &mut Game, k: &str, semis: &str) -> Result<(), String> {
    if bed(g, k, "etat") == "mur" {
        g.act(&json!({"type": "recolter", "champ": k}))?;
    }
    if bed(g, k, "etat") == "fletri" || (bed(g, k, "etat") == "vide" && !bed(g, k, "sol_pret").vrai()) {
        g.act(&json!({"type": "preparer", "champ": k}))?;
    }
    if bed(g, k, "etat") == "vide" {
        g.act(&json!({"type": "semer", "champ": k, "culture": semis}))?;
    }
    if bed(g, k, "nuisible").vrai() {
        g.act(&json!({"type": "traiter", "champ": k, "traitement": "naturel"}))?;
    }
    if bed(g, k, "herbes").f() > 40.0 {
        g.act(&json!({"type": "desherber", "champ": k}))?;
    }
    if g.s["champs"][k]["humidite"].f() < 30.0 {
        g.act(&json!({"type": "arroser", "champ": k}))?;
    }
    Ok(())
}

/// Des actions à la suite : la première refusée arrête les suivantes (un seul `try` en Python).
fn suite(g: &mut Game, actions: &[Value]) {
    for a in actions {
        if g.act(a).is_err() {
            return;
        }
    }
}

#[test]
fn diligent_player_progresses() {
    // Un joueur appliqué doit gagner de l'argent sur 15 jours.
    let mut g = base();
    let mut bought = false;
    for _ in 0..15 * 24 * 6 {
        g.advance(10.0);
        if g.s["statut"] != "en_cours" {
            break;
        }
        if !bought && g.day() == 3 {
            // les premières bêtes, une fois les cultures lancées
            ok(&mut g, json!({"type": "acheter", "article": "poules", "quantite": 10}));
            ok(&mut g, json!({"type": "acheter", "article": "cochons", "quantite": 1}));
            bought = true;
        }
        let h = g.hour();
        if bought && fmod(h, 6.0) < 0.2 && h >= 5.9 {
            let mut acts = Vec::new();
            if g.s["stock"]["foin"].f() + g.s["stock"]["mais"].f() < g.feed_needed() * 3.0 {
                acts.push(json!({"type": "acheter", "article": "foin", "quantite": 600}));
            }
            acts.extend([json!({"type": "nourrir"}), json!({"type": "ramasser"}), json!({"type": "caliner", "categorie": "poules"})]);
            suite(&mut g, &acts);
            let dehors = (8.0..18.0).contains(&g.hour());
            for a in [json!({"type": "nettoyer"}), json!({"type": "sortir", "dehors": dehors})] {
                let _ = g.act(&a);
            }
        }
        for k in cles(&g.s["champs"]) {
            let semis = if k == "parcelle_a" { "tomates" } else { "carottes" };
            let _ = soigner_parcelle(&mut g, &k, semis);
        }
        if g.market_day(None) && (12.8..12.97).contains(&g.hour()) {
            // fin de marché : le surplus part en gros
            for p in ["oeufs", "laine", "tomates", "carottes"] {
                let _ = g.act(&json!({"type": "vendre", "produit": p}));
            }
        }
    }
    println!(
        "  → après 15 jours : {:.0} €, statut {}, {} animaux, santé {} %",
        g.s["argent"].f(),
        g.s["statut"].t(),
        g.n_animals(),
        g.view()["derive"]["sante_ferme"]
    );
    assert_eq!(g.s["statut"], "en_cours");
    assert!(g.s["argent"].f() > 1500.0);
    // la même partie qu'en Python (engine.py, ordre des achats au marché fixé) : 4556.96328505337 €
    assert_eq!(rond(g.s["argent"].f()), 4557, "argent exact : {}", g.s["argent"]);
}

#[test]
fn weeds_slow_growth() {
    let mut g = base();
    let mut g2 = base();
    for x in [&mut g, &mut g2] {
        ok(x, json!({"type": "semer", "champ": "parcelle_b", "culture": "pommes_de_terre"}));
        x.s["champs"]["parcelle_b"]["humidite"] = json!(80);
    }
    g2.s["champs"]["parcelle_b"]["planches"][0]["herbes"] = json!(100); // planche envahie
    g.advance(300.0);
    g2.advance(300.0);
    assert!(pl(&g, "parcelle_b", 0)["herbes"].f() > 0.0); // elles repoussent
    assert!(pl(&g, "parcelle_b", 0)["croissance"].f() > pl(&g2, "parcelle_b", 0)["croissance"].f() * 1.3);
    ok(&mut g2, json!({"type": "desherber", "champ": "parcelle_b"}));
    assert_eq!(pl(&g2, "parcelle_b", 0)["herbes"].f(), 0.0);
    g.s["technologies"] = json!(["desherbeur"]); // le robot s'en charge
    g.advance(60.0);
    assert_eq!(pl(&g, "parcelle_b", 0)["herbes"].f(), 0.0);
}

#[test]
fn pests_and_treatments() {
    let mut g = base();
    ok(&mut g, json!({"type": "semer", "champ": "parcelle_a", "culture": "tomates"}));
    err(&mut g, json!({"type": "traiter", "champ": "parcelle_a"}));
    g.s["champs"]["parcelle_a"]["planches"][0]["nuisible"] = json!("pucerons");
    g.s["champs"]["parcelle_a"]["humidite"] = json!(80);
    g.advance(120.0);
    assert!(pl(&g, "parcelle_a", 0)["sante"].f() < 100.0);
    let money = g.s["argent"].f();
    ok(&mut g, json!({"type": "traiter", "champ": "parcelle_a", "traitement": "naturel"}));
    assert!(pl(&g, "parcelle_a", 0)["nuisible"].is_null());
    assert_eq!(pl(&g, "parcelle_a", 0)["chimique"], false);
    assert!(g.s["argent"].f() < money);
    g.s["champs"]["parcelle_a"]["planches"][0]["nuisible"] = json!("pucerons");
    ok(&mut g, json!({"type": "traiter", "champ": "parcelle_a", "traitement": "chimique"}));
    assert_eq!(pl(&g, "parcelle_a", 0)["chimique"], true);
    assert!(pl(&g, "parcelle_a", 0)["protege_jusqua"].f() > g.minute());
    // les nuisibles finissent par arriver tout seuls sur une planche non protégée
    g.s["champs"]["parcelle_a"]["planches"][0]["protege_jusqua"] = json!(0);
    g.s["champs"]["parcelle_a"]["humidite"] = json!(80);
    for _ in 0..20 {
        g.advance(MIN_PER_DAY);
        if pl(&g, "parcelle_a", 0)["nuisible"].vrai() || pl(&g, "parcelle_a", 0)["etat"] == "fletri" {
            break;
        }
        g.s["champs"]["parcelle_a"]["planches"][0]["herbes"] = json!(0);
    }
    assert!(pl(&g, "parcelle_a", 0)["nuisible"].vrai() || pl(&g, "parcelle_a", 0)["etat"] == "fletri");
}

#[test]
fn tractor_prepares_whole_field() {
    let mut g = Game::nouvelle(Some(3));
    ok(&mut g, json!({"type": "diviser", "champ": "parcelle_a", "planches": 3}));
    ok(&mut g, json!({"type": "preparer", "champ": "parcelle_a", "planche": 1}));
    let pret = |g: &Game| g.s["champs"]["parcelle_a"]["planches"].l().iter().map(|b| b["sol_pret"].vrai()).collect::<Vec<_>>();
    assert_eq!(pret(&g), vec![false, true, false]);
    g.s["argent"] = json!(5000);
    ok(&mut g, json!({"type": "ameliorer", "amelioration": "tracteur"}));
    ok(&mut g, json!({"type": "preparer", "champ": "parcelle_a", "planche": 0}));
    assert!(pret(&g).iter().all(|x| *x));
    err(&mut g, json!({"type": "preparer", "champ": "parcelle_a"}));
}

#[test]
fn collect_by_hand() {
    let mut g = base();
    herd(&mut g, &[("vaches", 2), ("poules", 6)]);
    ok(&mut g, json!({"type": "nourrir"}));
    err(&mut g, json!({"type": "ramasser"}));
    g.advance(6.0 * 60.0);
    assert_eq!(g.s["stock"]["lait"].f(), 0.0); // le lait attend la traite
    assert!(g.s["animaux"]["vaches"]["a_ramasser"].f() > 5.0);
    ok(&mut g, json!({"type": "ramasser", "categorie": "vaches"}));
    assert!(g.s["stock"]["lait"].f() > 5.0);
    assert_eq!(g.s["animaux"]["vaches"]["a_ramasser"].f(), 0.0);
    // sans traite, la production plafonne à une journée
    for _ in 0..3 {
        ok(&mut g, json!({"type": "nourrir"}));
        g.advance(8.0 * 60.0);
    }
    assert!(g.s["animaux"]["vaches"]["a_ramasser"].f() <= 2.0 * 22.0 + 1e-6);
    // le robot de traite ramasse tout seul
    g.s["technologies"] = json!(["robot_traite"]);
    let lait = g.s["stock"]["lait"].f();
    ok(&mut g, json!({"type": "nourrir"}));
    g.advance(60.0);
    assert!(g.s["stock"]["lait"].f() > lait);
}

#[test]
fn clean_pen() {
    let mut g = base();
    herd(&mut g, &[("cochons", 2)]);
    for _ in 0..12 {
        ok(&mut g, json!({"type": "nourrir"}));
        g.advance(6.0 * 60.0);
    }
    assert!(g.s["animaux"]["cochons"]["proprete"].f() < 35.0);
    assert!(g.s["animaux"]["cochons"]["liste"][0]["sante"].f() < 100.0); // enclos sale : les bêtes tombent malades
    let fumier = g.s["stock"]["fumier"].f();
    ok(&mut g, json!({"type": "nettoyer", "categorie": "cochons"}));
    assert_eq!(g.s["animaux"]["cochons"]["proprete"].f(), 100.0);
    assert!(g.s["stock"]["fumier"].f() > fumier + 4.0);
    err(&mut g, json!({"type": "nettoyer", "categorie": "cochons"}));
}

#[test]
fn cuddles_and_mood() {
    let mut g = base();
    herd(&mut g, &[("moutons", 2)]);
    let ids: Vec<String> = g.s["animaux"]["moutons"]["liste"].l().iter().map(|a| a["id"].t().to_string()).collect();
    for i in 0..2 {
        g.s["animaux"]["moutons"]["liste"][i]["humeur"] = json!(30);
    }
    let humeurs = |g: &Game| (g.s["animaux"]["moutons"]["liste"][0]["humeur"].f(), g.s["animaux"]["moutons"]["liste"][1]["humeur"].f());
    ok(&mut g, json!({"type": "caliner", "categorie": "moutons", "id": ids[0]}));
    assert_eq!(humeurs(&g), (55.0, 30.0));
    err(&mut g, json!({"type": "caliner", "categorie": "moutons", "id": ids[0]})); // pas deux câlins d'affilée
    ok(&mut g, json!({"type": "caliner", "categorie": "moutons"})); // tout l'enclos : seulement ceux qui attendent
    assert_eq!(humeurs(&g), (55.0, 55.0));
    assert!(mood_factor(80.0) > mood_factor(20.0));
}

#[test]
fn pasture() {
    let mut g = base();
    g.s["meteo"] = json!({"type": "soleil", "nom": "Ensoleillé", "temp": 25});
    herd(&mut g, &[("vaches", 2), ("poules", 4)]);
    g.advance(3.0 * 60.0); // 08:00
    ok(&mut g, json!({"type": "nourrir"}));
    ok(&mut g, json!({"type": "sortir", "categorie": "vaches", "dehors": true}));
    g.advance(6.0 * 60.0);
    assert!(g.s["animaux"]["vaches"]["satiete"].f() > g.s["animaux"]["poules"]["satiete"].f() + 15.0); // au pré, elles broutent
    assert!(g.mood("vaches") > g.mood("poules"));
    err(&mut g, json!({"type": "sortir", "categorie": "vaches", "dehors": true}));
    ok(&mut g, json!({"type": "sortir", "dehors": false}));
    assert_eq!(g.s["animaux"]["vaches"]["au_pre"], false);
    // des poules laissées dehors la nuit attirent le renard
    ok(&mut g, json!({"type": "sortir", "categorie": "poules", "dehors": true}));
    let n = g.s["animaux"]["poules"]["liste"].l().len();
    for _ in 0..6 {
        g.advance(MIN_PER_DAY);
    }
    assert!(g.s["animaux"]["poules"]["liste"].l().len() < n);
}

#[test]
fn migrate_old_herd() {
    let mut st: Value = serde_json::from_str(&base().dumps()).unwrap();
    st["animaux"]["vaches"] = json!({"satiete": 80.0, "prochain_id": 1, "liste": [{"id": "va0", "nom": "Marguerite", "sante": 90.0}]});
    for b in st["champs"]["parcelle_a"]["planches"].as_array_mut().unwrap() {
        for k in ["sol_pret", "herbes", "nuisible", "protege_jusqua"] {
            b.as_object_mut().unwrap().remove(k);
        }
    }
    let mut g = Game::depuis(st);
    assert_eq!(g.s["animaux"]["vaches"]["proprete"], 100.0);
    assert_eq!(g.s["animaux"]["vaches"]["liste"][0]["humeur"], 70.0);
    assert_eq!(pl(&g, "parcelle_a", 0)["sol_pret"], true);
    g.advance(120.0);
    g.view();
}

// ---- saisons ----
#[test]
fn seasons_cycle() {
    let mut g = base();
    assert_eq!(g.saison(), "printemps");
    for (day, sz) in [(8, "ete"), (15, "automne"), (22, "hiver"), (29, "printemps")] {
        goto(&mut g, day, 1);
        assert_eq!(g.saison(), sz);
    }
    assert_eq!(g.year(), 2);
    assert!(contient(&g.s["objectifs"], "hiver")); // premier hiver passé
    let info = g.view()["derive"]["saison"].clone();
    assert_eq!((info["annee"].i(), info["jour"].i(), info["prochaine"].t()), (2, 1, "Été"));
}

#[test]
fn sowing_out_of_season() {
    let mut g = base();
    g.s["minute"] = json!(21.0 * MIN_PER_DAY + 8.0 * 60.0); // jour 22 : l'hiver
    err(&mut g, json!({"type": "semer", "champ": "parcelle_a", "culture": "tomates"}));
    ok(&mut g, json!({"type": "semer", "champ": "parcelle_a", "culture": "carottes"})); // rustique
    g.s["argent"] = json!(9000);
    g.s["stats"]["ventes"] = json!(5000);
    ok(&mut g, json!({"type": "construire", "batiment": "serre", "champ": "parcelle_b"}));
    ok(&mut g, json!({"type": "semer", "champ": "parcelle_b", "culture": "tomates"})); // sous serre, toute l'année
    assert_eq!(g.view()["derive"]["en_saison"]["tomates"], false);
}

#[test]
fn frost_hurts_fragile_crops() {
    let mut g = base();
    ok(&mut g, json!({"type": "semer", "champ": "parcelle_a", "culture": "tomates"}));
    ok(&mut g, json!({"type": "semer", "champ": "parcelle_b", "culture": "carottes"}));
    g.s["meteo"] = json!({"type": "nuageux", "nom": "Nuageux", "temp": -4});
    for k in ["parcelle_a", "parcelle_b"] {
        g.s["champs"][k]["humidite"] = json!(70);
    }
    g.advance(240.0);
    assert!(pl(&g, "parcelle_a", 0)["sante"].f() < 100.0);
    assert_eq!(pl(&g, "parcelle_b", 0)["sante"].f(), 100.0);
    assert!(g.s["journal"].l().iter().any(|j| j["msg"].t().contains("gèle")));
}

#[test]
fn winter_weather_and_appetite() {
    let mut g = base();
    herd(&mut g, &[("vaches", 2)]);
    let summer = g.feed_needed();
    g.s["minute"] = json!(21.0 * MIN_PER_DAY + 60.0);
    assert!(g.feed_needed() > summer);
    let mut rng = Random::new(1);
    let temps: Vec<Value> = (0..200).map(|_| pick_weather(&mut rng, 23)).collect();
    assert!(!temps.iter().any(|w| w["type"] == "canicule"));
    assert!(temps.iter().map(|w| w["temp"].f()).sum::<f64>() / 200.0 < 12.0);
}

#[test]
fn off_season_prices() {
    let mut g = base();
    assert_eq!(g.season_price("tomates"), 2.4);
    g.s["minute"] = json!(21.0 * MIN_PER_DAY + 60.0);
    assert!(g.season_price("tomates") > 2.4);
    assert_eq!(g.season_price("carottes"), 1.7);
}

// ---- atelier ----
#[test]
fn workshop() {
    let mut g = base();
    g.s["argent"] = json!(9000);
    err(&mut g, json!({"type": "equiper", "equipement": "cuve_fromage"})); // pas de matériel sans bâtiment
    ok(&mut g, json!({"type": "construire", "batiment": "atelier"}));
    ok(&mut g, json!({"type": "equiper", "equipement": "cuve_fromage"}));
    assert!(g.charges() >= 35.0 + 8.0 + 4.0);
    err(&mut g, json!({"type": "transformer", "recette": "fromage"})); // pas de lait
    err(&mut g, json!({"type": "transformer", "recette": "confiture"})); // pas de chaudron
    g.add("lait", 100.0, 80.0, 1.0);
    ok(&mut g, json!({"type": "transformer", "recette": "fromage"}));
    assert!(proche(g.s["stock"]["lait"].f(), 20.0)); // capacité : 8 lots de 10 L
    err(&mut g, json!({"type": "transformer", "recette": "fromage", "lots": 1})); // une fournée à la fois
    g.advance(8.0 * 60.0 + 5.0);
    assert!(proche(g.s["stock"]["fromage"].f(), 8.0));
    assert!(g.s["qualite"]["fromage"].f() > 80.0);
    assert!(g.s["bio"]["fromage"].f() > 0.95);
    assert!(contient(&g.s["objectifs"], "transformation"));
    assert_eq!(g.view()["derive"]["produits"]["fromage"]["en_vente"], true);
}

#[test]
fn workshop_auto_restart_and_multi_inputs() {
    let mut g = base();
    g.s["argent"] = json!(9000);
    ok(&mut g, json!({"type": "construire", "batiment": "atelier"}));
    ok(&mut g, json!({"type": "equiper", "equipement": "autoclave"}));
    g.add("potirons", 10.0, 70.0, 1.0);
    g.add("carottes", 1.0, 90.0, 0.0);
    assert_eq!(g.max_lots("veloute"), 2); // limité par les carottes
    ok(&mut g, json!({"type": "atelier_auto", "equipement": "autoclave", "actif": true}));
    ok(&mut g, json!({"type": "transformer", "recette": "veloute"}));
    assert!(proche(g.s["stock"]["potirons"].f(), 6.0));
    g.advance(5.0 * 60.0 + 5.0);
    assert!(proche(g.s["stock"]["veloute"].f(), 2.0));
    assert!(g.s["bio"]["veloute"].f() < 1.0); // une partie des ingrédients n'était pas bio
    assert!(g.s["atelier"]["equipements"]["autoclave"]["lot"].is_null()); // plus de carottes : pas de relance
}

// ---- commandes ----
#[test]
fn orders() {
    let mut g = base();
    g.new_order(&mut Random::new(5));
    let o = g.s["commandes"][0].clone();
    err(&mut g, json!({"type": "livrer", "id": o["id"]}));
    g.add(o["produit"].t(), o["qte"].f() + 1.0, 95.0, 1.0);
    let (money, rep) = (g.s["argent"].f(), g.s["reputation"].f());
    ok(&mut g, json!({"type": "livrer", "id": o["id"]}));
    assert_eq!(g.s["argent"].f(), money + o["prix"].f());
    assert!(g.s["reputation"].f() > rep);
    assert_eq!(g.s["commandes"], json!([]));
    assert!(contient(&g.s["objectifs"], "commande"));
}

#[test]
fn orders_expire_and_refuse() {
    let mut g = base();
    let mut rng = Random::new(9);
    g.new_order(&mut rng);
    g.new_order(&mut rng);
    let (a, b) = (g.s["commandes"][0].clone(), g.s["commandes"][1].clone());
    let rep = g.s["reputation"].f();
    ok(&mut g, json!({"type": "refuser", "id": a["id"]}));
    assert_eq!(g.s["reputation"].f(), rep - 1.0);
    let duree = b["echeance"].f() - g.minute() + 10.0;
    g.advance(duree);
    assert!(!g.s["commandes"].l().iter().any(|x| x["id"] == b["id"]));
    assert_eq!(g.s["stats"]["commandes_ratees"], 1);
}

#[test]
fn orders_arrive_over_time() {
    let mut g = base();
    goto(&mut g, 12, 8);
    assert!(g.s["prochaine_commande"].i() > 1);
    assert!(g.s["commandes"].l().len() <= 3);
    let candidats = g.order_candidates();
    for o in g.view()["derive"]["commandes"].l() {
        assert!(candidats.iter().any(|c| c == o["produit"].t()));
    }
}

// ---- événements ----
#[test]
fn random_events() {
    let mut g = base();
    herd(&mut g, &[("vaches", 2), ("poules", 6)]);
    ok(&mut g, json!({"type": "semer", "champ": "parcelle_a", "culture": "tomates"}));
    let mut rng = Random::new(0);
    for _ in 0..60 {
        g.random_event(&mut rng);
    }
    let ev = g.s["evenements"].l();
    assert!(ev.len() > 10);
    assert!(ev.len() <= 12);
    assert!(ev.iter().any(|e| e["type"] == "bon") && ev.iter().any(|e| e["type"] == "mauvais"));
}

#[test]
fn market_effects() {
    let mut g = base();
    goto(&mut g, 2, 9); // mardi, marché ouvert
    let base_p = g.fair_price("tomates");
    let fin = g.next_market_end();
    g.s["effets"].as_array_mut().unwrap().push(json!({"id": "foire", "nom": "Foire", "emoji": "🎪", "clients": 1.3, "prix": 1.15, "fin": fin}));
    assert!(proche(g.fair_price("tomates"), base_p * 1.15));
    goto(&mut g, 2, 14);
    assert!(g.active_effects().is_empty());
}

#[test]
fn breakdown_stops_tech() {
    let mut g = base();
    g.s["technologies"] = json!(["desherbeur"]);
    let fin = g.minute() + 60.0;
    g.s["effets"].as_array_mut().unwrap().push(json!({"id": "panne", "tech": "desherbeur", "nom": "Panne", "emoji": "🔧", "fin": fin}));
    assert!(!g.has_tech("desherbeur"));
    err(&mut g, json!({"type": "technologie", "tech": "desherbeur"})); // on ne le rachète pas pour autant
    g.advance(61.0);
    assert!(g.has_tech("desherbeur"));
}

// ---- mode libre ----
#[test]
fn free_mode_after_victory() {
    let mut g = base();
    g.s["argent"] = json!(15500);
    ok(&mut g, json!({"type": "vitesse", "valeur": 1})); // les objectifs sont vérifiés à chaque action
    assert_eq!(g.s["statut"], "gagne");
    ok(&mut g, json!({"type": "continuer"}));
    assert_eq!((g.s["statut"].t(), g.s["mode"].t()), ("en_cours", "libre"));
    g.advance(MIN_PER_DAY);
    assert_eq!(g.s["statut"], "en_cours");
    assert!(g.view()["derive"]["objectif_argent"].is_null());
}

#[test]
fn new_free_game() {
    let mut g = base();
    ok(&mut g, json!({"type": "nouvelle_partie", "mode": "libre"}));
    assert_eq!(g.s["mode"], "libre");
    g.s["argent"] = json!(20000);
    ok(&mut g, json!({"type": "vitesse", "valeur": 1}));
    assert_eq!(g.s["statut"], "en_cours");
    g.s["argent"] = json!(-100);
    g.advance(3.0 * MIN_PER_DAY);
    assert_eq!(g.s["statut"], "perdu"); // la faillite reste possible
    err(&mut g, json!({"type": "nouvelle_partie", "mode": "facile"}));
}

#[test]
fn migrate_v4_save() {
    let mut st: Value = serde_json::from_str(&base().dumps()).unwrap();
    for k in ["mode", "atelier", "commandes", "prochaine_commande", "effets", "evenements", "gel_jour"] {
        st.as_object_mut().unwrap().remove(k);
    }
    st["version"] = json!(4);
    let mut g = Game::depuis(st);
    assert_eq!(g.s["mode"], "classique");
    assert_eq!(g.s["atelier"]["construit"], false);
    g.advance(2.0 * MIN_PER_DAY);
    assert!(serde_json::to_string(&g.view()).is_ok());
}

#[test]
fn long_game_through_winter() {
    // Un joueur appliqué traverse une année entière (atelier, commandes, serres) sans faire faillite.
    let mut g = base();
    g.s["argent"] = json!(6000);
    herd(&mut g, &[("vaches", 2), ("poules", 12), ("moutons", 2), ("cochons", 1)]);
    ok(&mut g, json!({"type": "construire", "batiment": "atelier"}));
    ok(&mut g, json!({"type": "equiper", "equipement": "cuve_fromage"}));
    ok(&mut g, json!({"type": "atelier_auto", "equipement": "cuve_fromage", "actif": true}));
    g.s["collecte_lait"] = json!(false);
    for _ in 0..28 * 24 * 6 {
        g.advance(10.0);
        if g.s["statut"] != "en_cours" {
            break;
        }
        let h = g.hour();
        if fmod(h, 6.0) < 0.2 && h >= 5.9 {
            // (comme en Python, la liste est faite avant d'agir, et chaque action est tentée)
            let mut acts = Vec::new();
            if g.s["stock"]["foin"].f() < g.feed_needed() * 4.0 {
                acts.push(json!({"type": "acheter", "article": "foin", "quantite": 400}));
            }
            acts.extend([
                json!({"type": "nourrir"}),
                json!({"type": "ramasser"}),
                json!({"type": "nettoyer"}),
                json!({"type": "caliner", "categorie": "vaches"}),
                json!({"type": "soigner"}),
                json!({"type": "transformer", "recette": "fromage"}),
            ]);
            for a in &acts {
                let _ = g.act(a);
            }
            let ids: Vec<Value> = g.s["commandes"].l().iter().map(|o| o["id"].clone()).collect();
            for id in ids {
                let _ = g.act(&json!({"type": "livrer", "id": id}));
            }
        }
        for k in cles(&g.s["champs"]) {
            let crop = ["tomates", "carottes", "salades"].into_iter().find(|c| g.in_season(c, None)).unwrap();
            let f = bed(&g, &k, "etat");
            let mut acts = Vec::new();
            if f == "mur" {
                acts.push(json!({"type": "recolter", "champ": k}));
            }
            if f == "fletri" || (f == "vide" && !bed(&g, &k, "sol_pret").vrai()) {
                acts.push(json!({"type": "preparer", "champ": k}));
            }
            if f == "vide" {
                acts.push(json!({"type": "semer", "champ": k, "culture": crop}));
            }
            if bed(&g, &k, "nuisible").vrai() {
                acts.push(json!({"type": "traiter", "champ": k, "traitement": "naturel"}));
            }
            if bed(&g, &k, "herbes").f() > 40.0 {
                acts.push(json!({"type": "desherber", "champ": k}));
            }
            if g.s["champs"][k.as_str()]["humidite"].f() < 30.0 {
                acts.push(json!({"type": "arroser", "champ": k}));
            }
            for a in &acts {
                let _ = g.act(a);
            }
        }
        if g.market_day(None) && (12.8..12.97).contains(&g.hour()) {
            for p in ["oeufs", "laine", "tomates", "carottes", "salades", "fromage", "lait"] {
                let _ = g.act(&json!({"type": "vendre", "produit": p}));
            }
        }
    }
    println!(
        "  → après un an : {:.0} €, statut {}, {} fournées, {} commandes livrées / {} ratées, {} événements récents",
        g.s["argent"].f(),
        g.s["statut"].t(),
        g.s["stats"]["transformations"],
        g.s["stats"]["commandes"],
        g.s["stats"]["commandes_ratees"],
        g.s["evenements"].l().len()
    );
    assert_eq!(g.s["statut"], "en_cours");
    assert!(g.s["stats"]["transformations"].f() > 5.0);
    assert!(contient(&g.s["objectifs"], "hiver"));
    // la même partie qu'en Python (engine.py, ordre des achats au marché fixé) : 8653.546798797663 €
    assert_eq!(rond(g.s["argent"].f()), 8654, "argent exact : {}", g.s["argent"]);
    assert_eq!(
        (g.s["stats"]["transformations"].i(), g.s["stats"]["commandes"].i(), g.s["stats"]["commandes_ratees"].i(), g.s["evenements"].l().len()),
        (70, 3, 11, 12)
    );
}

// ---- format des sauvegardes (portage) ----
#[test]
fn ancienne_sauvegarde_python() {
    let txt = include_str!("donnees/sauvegarde_python.json");
    let avant: Value = serde_json::from_str(txt).unwrap();
    let mut g = Game::relire(txt).expect("une sauvegarde de la version Python doit se relire");
    // déjà au dernier format : la relecture ne change rien, clés et ordre compris
    assert_eq!(g.s, avant);
    assert_eq!(serde_json::to_string(&g.s).unwrap(), serde_json::to_string(&avant).unwrap());
    g.advance(60.0);
    let v = g.view();
    assert!(v["derive"]["jour"].i() >= 1);
    assert!(Game::relire(&g.dumps()).is_ok());
}
