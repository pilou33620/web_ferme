//! Moteur de simulation de « La Ferme du Val Vert » (porté de engine.py).
//!
//! Logique pure : le serveur appelle `Game::advance()` régulièrement et `Game::act()` pour les actions
//! du joueur. Le temps est compté en minutes de jeu. L'état est le JSON même de la sauvegarde
//! (`serde_json::Value`, clés dans l'ordre d'insertion) : les sauvegardes de la version Python se relisent
//! telles quelles, et le hasard (`hasard::Random`) rend les mêmes tirages qu'en Python.

use std::f64::consts::PI;
use std::sync::OnceLock;

use serde_json::{json, Map, Value};

use crate::hasard::{graine_hasard, Random};

pub const MIN_PER_DAY: f64 = 1440.0;
pub const MEALS: [i64; 3] = [6, 12, 18]; // heures des repas
const MEAL_WINDOW: (f64, f64) = (-1.0, 3.0); // fenêtre : 1 h avant → 3 h après
pub const GAME_MIN_PER_SEC: f64 = 1.0; // vitesse x1 : 1 s réelle = 1 min de jeu
pub const TARGET_MONEY: i64 = 15000;

pub const JOURS: [&str; 7] = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
const MARKET_DAYS: [i64; 3] = [1, 3, 5]; // mardi, jeudi, samedi (le jour 1 est un lundi)
const MARKET_HOURS: (i64, i64) = (7, 13);
const COLLECTE_HEURE: i64 = 20; // passage du camion de la fromagerie

const EXTRA_FIELD_UPKEEP: i64 = 8; // €/jour par parcelle achetée
const FORECAST_DAYS: i64 = 6; // prévisions : demain + 5 jours
const MAX_BEDS: i64 = 3; // une parcelle se divise en 1 à 3 planches
const ASSOCIATION: f64 = 1.10; // +10 % de récolte quand une parcelle mélange 2 cultures ou plus

const SAISON_JOURS: i64 = 7;
const SAISON_ORDRE: [&str; 4] = ["printemps", "ete", "automne", "hiver"];
const HORS_SAISON: f64 = 1.35; // un légume hors saison se vend plus cher
const GEL_DEGATS: f64 = 0.03; // santé perdue par minute de gel par une culture fragile en plein champ

const ATELIER_QUALITE: f64 = 6.0; // le savoir-faire de l'atelier ajoute un peu de qualité
const COMMANDES_MAX: usize = 3;
const COMMANDE_CHANCE: f64 = 0.6; // chance par jour d'en recevoir une nouvelle
const GROS: f64 = 0.6; // le négociant paie 60 % du cours du jour (avant qualité)

const SATIETE_BAISSE: f64 = 0.07;
const SANTE_BAISSE_FAIM: f64 = 0.015;
const PRE_SATIETE: f64 = 0.4; // au pré, les bêtes ont faim 2,5 fois moins vite
const SALETE: f64 = 0.02;
const ENCLOS_SALE: f64 = 35.0; // sous ce seuil de propreté, les bêtes tombent malades
const SANTE_BAISSE_SALE: f64 = 0.01;
const HUMEUR_BAISSE: f64 = 0.012;
const CALIN: f64 = 25.0;
const CALIN_PAUSE: f64 = 120.0; // minutes entre deux câlins au même animal
const RAMASSAGE_MAX: f64 = 1.0; // la production attend au plus une journée
const FEED_PRICE: f64 = 0.25;
const FEED_BIO_PRICE: f64 = 0.33;
const VET_PRICE: i64 = 25;
const CHEM_PRICE: i64 = 35;

const DRONE_PROTECT: f64 = 0.5;
const DESHERBEUR_BOOST: f64 = 1.15;
const HERBES_POUSSE: f64 = 0.03;
const NUISIBLE_RISQUE: f64 = 0.22;
const NUISIBLE_DEGATS: f64 = 0.03;
const SERRE_BOOST: f64 = 1.25;
const SERRE_EVAP: f64 = 0.4;
const RAIN_WATER: f64 = 0.15; // humidité gagnée par minute de pluie (plein champ seulement)
const EVENEMENT_CHANCE: f64 = 0.32; // chance par jour d'un événement aléatoire (à partir du jour 3)

// ---------------------------------------------------------------------- données de référence

/// Les tables du jeu (cultures, bêtes, produits, météo…), extraites telles quelles de engine.py.
fn donnees() -> &'static Value {
    static D: OnceLock<Value> = OnceLock::new();
    D.get_or_init(|| serde_json::from_str(include_str!("../data/ref.json")).expect("data/ref.json illisible"))
}

fn d(nom: &str) -> &'static Value {
    &donnees()[nom]
}

fn tab(nom: &str) -> &'static Map<String, Value> {
    d(nom).as_object().expect("table attendue")
}

fn crops() -> &'static Map<String, Value> {
    tab("CROPS")
}

fn items() -> &'static Map<String, Value> {
    tab("ITEMS")
}

fn animals() -> &'static Map<String, Value> {
    tab("ANIMALS")
}

fn weather() -> &'static Map<String, Value> {
    tab("WEATHER")
}

// ---------------------------------------------------------------------- outils sur les valeurs JSON

/// Lecture des valeurs de l'état comme Python les lisait.
pub trait V {
    fn f(&self) -> f64;
    fn i(&self) -> i64;
    fn t(&self) -> &str;
    /// La vérité de Python : None, 0, "", [] et {} sont faux.
    fn vrai(&self) -> bool;
    fn l(&self) -> &[Value];
}

impl V for Value {
    fn f(&self) -> f64 {
        match self {
            Value::Number(n) => n.as_f64().unwrap_or(0.0),
            Value::Bool(true) => 1.0,
            _ => 0.0,
        }
    }
    fn i(&self) -> i64 {
        self.as_i64().unwrap_or_else(|| self.f() as i64)
    }
    fn t(&self) -> &str {
        self.as_str().unwrap_or("")
    }
    fn vrai(&self) -> bool {
        match self {
            Value::Null => false,
            Value::Bool(b) => *b,
            Value::Number(n) => n.as_f64() != Some(0.0),
            Value::String(s) => !s.is_empty(),
            Value::Array(a) => !a.is_empty(),
            Value::Object(o) => !o.is_empty(),
        }
    }
    fn l(&self) -> &[Value] {
        self.as_array().map(|a| a.as_slice()).unwrap_or(&[])
    }
}

fn fl(x: f64) -> Value {
    Value::from(x)
}

/// Un nombre que Python gardait entier quand il tombe juste (quantités, minutes).
fn entier_si_rond(x: f64) -> Value {
    if x.fract() == 0.0 && x.abs() < 1e15 {
        json!(x as i64)
    } else {
        fl(x)
    }
}

fn ajouter(v: &mut Value, delta: f64) {
    *v = fl(v.f() + delta);
}

fn ajouter_i(v: &mut Value, delta: i64) {
    *v = json!(v.i() + delta);
}

fn arr(v: &mut Value) -> &mut Vec<Value> {
    v.as_array_mut().expect("liste attendue")
}

fn obj(v: &mut Value) -> &mut Map<String, Value> {
    v.as_object_mut().expect("objet attendu")
}

fn cles(v: &Value) -> Vec<String> {
    v.as_object().map(|o| o.keys().cloned().collect()).unwrap_or_default()
}

fn entrees(v: &Value) -> impl Iterator<Item = (&String, &Value)> {
    v.as_object().into_iter().flat_map(|o| o.iter())
}

/// `dict.update` : les clés existantes gardent leur place, les nouvelles vont à la fin.
fn fusion(v: &mut Value, de: Value) {
    if let (Some(o), Value::Object(de)) = (v.as_object_mut(), de) {
        for (k, x) in de {
            o.insert(k, x);
        }
    }
}

/// `int(x)` de Python ; `None` (clé absente) donne la valeur par défaut, une valeur invalide rien.
fn entier(v: Option<&Value>, defaut: i64) -> Option<i64> {
    match v {
        None => Some(defaut),
        Some(Value::Number(x)) => x.as_i64().or_else(|| x.as_f64().filter(|f| f.is_finite()).map(|f| f.trunc() as i64)),
        Some(Value::String(s)) => s.trim().parse().ok(),
        Some(Value::Bool(b)) => Some(*b as i64),
        _ => None,
    }
}

/// `float(x)` de Python.
fn flottant(v: &Value) -> Option<f64> {
    match v {
        Value::Number(x) => x.as_f64(),
        Value::String(s) => s.trim().parse().ok(),
        Value::Bool(b) => Some(if *b { 1.0 } else { 0.0 }),
        _ => None,
    }
}

/// Deux identifiants égaux au sens de Python (1 == 1.0).
fn meme(a: &Value, b: &Value) -> bool {
    match (a.as_f64(), b.as_f64()) {
        (Some(x), Some(y)) => x == y,
        _ => a == b,
    }
}

// ---------------------------------------------------------------------- arithmétique de Python

/// `round(x)` de Python : l'entier le plus proche, le pair en cas d'égalité.
pub fn rond(x: f64) -> i64 {
    x.round_ties_even() as i64
}

/// `round(x, n)` de Python (n ≥ 0) : arrondi juste de la valeur exacte, comme le formatage.
pub fn rond_n(x: f64, n: usize) -> f64 {
    format!("{:.*}", n, x).parse().unwrap_or(x)
}

/// `round(x, -1)` de Python.
fn rond_dizaine(x: f64) -> f64 {
    (x / 10.0).round_ties_even() * 10.0
}

/// `a // b` de Python sur des flottants.
pub fn fdiv(a: f64, b: f64) -> f64 {
    let m = a % b;
    let mut div = (a - m) / b;
    if m != 0.0 && ((b < 0.0) != (m < 0.0)) {
        div -= 1.0;
    }
    if div != 0.0 {
        let f = div.floor();
        if div - f > 0.5 {
            f + 1.0
        } else {
            f
        }
    } else {
        0.0
    }
}

/// `a % b` de Python sur des flottants.
pub fn fmod(a: f64, b: f64) -> f64 {
    let r = a % b;
    if r != 0.0 && ((r < 0.0) != (b < 0.0)) {
        r + b
    } else {
        r
    }
}

pub fn clamp(v: f64) -> f64 {
    clamp3(v, 0.0, 100.0)
}

fn clamp3(v: f64, lo: f64, hi: f64) -> f64 {
    lo.max(hi.min(v))
}

fn capitaliser(s: &str) -> String {
    let mut c = s.chars();
    match c.next() {
        Some(p) => p.to_uppercase().collect::<String>() + &c.as_str().to_lowercase(),
        None => String::new(),
    }
}

fn minuscule_initiale(s: &str) -> String {
    let mut c = s.chars();
    match c.next() {
        Some(p) => p.to_lowercase().collect::<String>() + c.as_str(),
        None => String::new(),
    }
}

/// 1800 → « 1 800 ».
fn milliers(n: i64) -> String {
    let s = n.abs().to_string();
    let mut out = String::new();
    for (i, c) in s.chars().enumerate() {
        if i > 0 && (s.len() - i) % 3 == 0 {
            out.push(' ');
        }
        out.push(c);
    }
    if n < 0 {
        format!("-{out}")
    } else {
        out
    }
}

// ---------------------------------------------------------------------- fonctions du jeu

pub fn saison_du_jour(day: i64) -> &'static str {
    SAISON_ORDRE[((day - 1).div_euclid(SAISON_JOURS)).rem_euclid(4) as usize]
}

/// ["printemps", "ete"] → « au printemps et en été ».
fn saisons_txt(saisons: &[Value]) -> String {
    let mots: Vec<String> = saisons
        .iter()
        .map(|x| format!("{}{}", if x.t() == "printemps" { "au " } else { "en " }, tab("SAISONS")[x.t()]["nom"].t().to_lowercase()))
        .collect();
    if mots.len() == 1 {
        mots[0].clone()
    } else {
        format!("{} et {}", mots[..mots.len() - 1].join(", "), mots[mots.len() - 1])
    }
}

/// Quantité lisible à la française : 12 · 2,5 · 0,4.
pub fn qf_txt(v: f64) -> String {
    if (v - v.round_ties_even()).abs() < 0.05 {
        format!("{}", rond(v))
    } else {
        format!("{v:.1}").replace('.', ",")
    }
}

pub fn quality_label(q: f64) -> &'static str {
    if q >= 85.0 {
        "Excellente"
    } else if q >= 70.0 {
        "Bonne"
    } else if q >= 50.0 {
        "Correcte"
    } else if q >= 30.0 {
        "Médiocre"
    } else {
        "Mauvaise"
    }
}

/// Ce que la qualité change au prix que les clients jugent honnête (0,7 → 1,3).
fn quality_mult(q: f64) -> f64 {
    0.7 + 0.6 * q / 100.0
}

fn bio_mult(bio: f64) -> f64 {
    1.0 + 0.3 * bio
}

/// Température à une heure donnée : fraîche la nuit, maximum en début d'après-midi.
fn temp_at(base: f64, hour: f64) -> f64 {
    rond_n(base - 6.0 + 9.0 * 0.0f64.max(((hour - 6.0) / 24.0 * 2.0 * PI).sin()), 1)
}

/// « parcelle_d » → « Parcelle D ».
pub fn field_label(key: &str) -> String {
    match tab("FIELDS").get(key) {
        Some(f) => f["nom"].t().to_string(),
        None => format!("Parcelle {}", key.rsplit('_').next().unwrap_or("").to_uppercase()),
    }
}

fn field_size(key: &str) -> f64 {
    tab("FIELDS").get(key).map_or(1.0, |f| f["taille"].f())
}

/// Probabilité qu'un client achète, selon prix demandé / prix jugé honnête.
fn buy_chance(ratio: f64) -> f64 {
    1.0 / (1.0 + ((ratio - 1.1) * 8.0).exp())
}

fn min_unit(item: &str) -> f64 {
    if item == "oeufs" {
        1.0
    } else {
        0.2
    }
}

/// Part de la production assurée selon la satiété : pleine, réduite, ou rien du tout.
pub fn feed_factor(satiete: f64) -> f64 {
    if satiete > 55.0 {
        1.0
    } else if satiete > 30.0 {
        0.6
    } else {
        0.0
    }
}

/// Des bêtes heureuses produisent plus ; des bêtes délaissées, moins.
pub fn mood_factor(humeur: f64) -> f64 {
    if humeur >= 70.0 {
        1.1
    } else if humeur >= 40.0 {
        1.0
    } else {
        0.85
    }
}

fn actif(b: &Value) -> bool {
    matches!(b["etat"].t(), "seme" | "pousse" | "mur")
}

fn animal_price(cat: &str, animal: &Value) -> i64 {
    rond(animals()[cat]["prix"].f() * (0.35 + 0.5 * animal["sante"].f() / 100.0))
}

/// Le temps d'un jour donné : les probabilités et la température dépendent de la saison.
pub fn pick_weather(rng: &mut Random, day: i64) -> Value {
    let sz = &tab("SAISONS")[saison_du_jour(day)];
    let keys: Vec<&String> = weather().keys().collect();
    let poids: Vec<f64> = keys.iter().map(|k| sz["meteo"][k.as_str()].f()).collect();
    let k = keys[rng.choices_w(&poids, 1)[0]].as_str();
    let w = &weather()[k];
    let temp = w["temp"].i() + sz["temp"].i() + rng.randint(-3, 3);
    // l'hiver, il neige : la neige fond et arrose aussi
    let nom = if k == "pluie" && temp <= 3 { "Neige" } else { w["nom"].t() };
    json!({"type": k, "nom": nom, "temp": temp})
}

fn empty_workshop() -> Value {
    json!({"construit": false, "equipements": {}})
}

/// Une planche : ce qui y pousse et dans quel état. `sol_pret` : labourée, prête à semer.
fn empty_bed(pret: bool) -> Value {
    json!({"etat": "vide", "culture": null, "croissance": 0.0, "sante": 100.0, "qualite": 100.0,
           "chimique": false, "engrais_jusqua": 0, "boost": 1.0, "mur_depuis": null,
           "sol_pret": pret, "herbes": 0.0, "nuisible": null, "protege_jusqua": 0})
}

/// Une parcelle : le sol (humidité, serre) est commun, les cultures sont par planche.
fn empty_field(humidite: f64, beds: i64, pret: bool) -> Value {
    let planches: Vec<Value> = (0..beds).map(|_| empty_bed(pret)).collect();
    json!({"serre": false, "humidite": humidite, "planches": planches})
}

/// Un enclos : satiété commune, propreté de la litière, production qui attend d'être ramassée.
fn empty_herd() -> Value {
    json!({"satiete": 80.0, "liste": [], "prochain_id": 0, "proprete": 100.0, "au_pre": false,
           "a_ramasser": 0.0, "q_ramasser": 80.0, "bio_ramasser": 0.0})
}

fn new_animal(cat: &str, i: i64) -> Value {
    let noms = tab("NAMES")[cat].l();
    json!({"id": format!("{}{}", &cat[..2], i), "nom": noms[i.rem_euclid(noms.len() as i64) as usize].t(), "sante": 100.0,
           "humeur": 70.0, "dernier_calin": -CALIN_PAUSE as i64})
}

fn default_stall() -> Value {
    Value::Object(items().keys().map(|k| (k.clone(), json!({"actif": k != "mais" && k != "fumier", "prix": null}))).collect())
}

fn empty_market(day: i64) -> Value {
    json!({"jour": day, "etat": "ferme", "clients": 0, "acheteurs": 0, "recette": 0.0, "ventes": {},
           "dernieres": [], "trop_cher": 0})
}

fn par_item(f: impl Fn(&Value) -> Value) -> Value {
    Value::Object(items().iter().map(|(k, v)| (k.clone(), f(v))).collect())
}

fn moyenne(v: &[f64], vide: f64) -> f64 {
    if v.is_empty() {
        vide
    } else {
        v.iter().sum::<f64>() / v.len() as f64
    }
}

type R<T> = Result<T, String>;

// ---------------------------------------------------------------------- jeu

pub struct Game {
    pub s: Value,
}

impl Game {
    /// Une partie neuve (graine tirée au hasard si aucune n'est donnée).
    pub fn nouvelle(seed: Option<i64>) -> Game {
        Game::depuis(Game::new_state(seed, "classique"))
    }

    /// Une partie depuis un état (sauvegarde), mise à niveau si elle est ancienne.
    pub fn depuis(s: Value) -> Game {
        let mut g = Game { s };
        g.migrate();
        g
    }

    /// Relit une sauvegarde. Un JSON abîmé ou d'une forme inattendue est une erreur, jamais une panique.
    pub fn relire(txt: &str) -> R<Game> {
        let v: Value = serde_json::from_str(txt).map_err(|e| e.to_string())?;
        if !v.is_object() {
            return Err("ce n'est pas un objet JSON".into());
        }
        std::panic::catch_unwind(move || {
            let g = Game::depuis(v);
            // la partie relue doit pouvoir s'afficher et avancer
            let _ = g.view();
            Game { s: g.s.clone() }.advance(5.0);
            g
        })
        .map_err(|_| "format inattendu".to_string())
    }

    pub fn dumps(&self) -> String {
        serde_json::to_string(&self.s).unwrap_or_default()
    }

    pub fn new_state(seed: Option<i64>, mode: &str) -> Value {
        let seed = seed.unwrap_or_else(|| 1 + graine_hasard().rem_euclid(999_999_999));
        let mode = if tab("MODES").contains_key(mode) { mode } else { "classique" };
        // le fermier démarre sans aucune bête
        let animaux: Map<String, Value> = animals().keys().map(|c| (c.clone(), empty_herd())).collect();
        let champs: Map<String, Value> =
            tab("FIELDS").keys().zip([72.0, 64.0, 70.0]).map(|(k, h)| (k.clone(), empty_field(h, 1, false))).collect();
        let mut stock = Map::new();
        stock.insert("foin".into(), json!(900.0));
        stock.insert("foin_bio".into(), json!(0.0));
        for k in items().keys() {
            stock.insert(k.clone(), json!(0.0));
        }
        stock.insert("fumier".into(), json!(80.0));
        let (qualite, bio) = (par_item(|_| json!(80.0)), par_item(|_| json!(1.0)));
        let prix = par_item(|v| v["prix"].clone());
        let st = json!({
            "version": 5,
            "seed": seed,
            "mode": mode,
            "minute": 5 * 60,
            "vitesse": 1,
            "menu": false,
            "vitesse_menu": 1,
            "argent": 1500.0,
            "statut": "en_cours",
            "jours_dans_le_rouge": 0,
            "meteo": null,
            "meteo_hier": null,
            "previsions": [],
            "reservoir": {"niveau": 6720.0, "capacite": 8200.0},
            "champs": champs,
            "animaux": animaux,
            "repas": {"jour": 1, "faits": []},
            "repas_bio": 0.0,
            "stock": stock,
            "qualite": qualite,
            "bio": bio,
            "prix": prix,
            "prix_hier": prix,
            "etal": default_stall(),
            "reputation": 50.0,
            "marche": empty_market(0),
            "collecte_lait": true,
            "collecte_jour": 0,
            "dernier_chimique": -10 * 1440,
            "ameliorations": [],
            "eoliennes": 0,
            "ruches": 0,
            "technologies": [],
            "stats": {"recolte_kg": 0.0, "ventes": 0.0, "ventes_marche": 0.0, "recoltes": 0, "energie": 0.0,
                      "production_jour": {}, "hier": {}, "transformations": 0, "commandes": 0, "commandes_ratees": 0},
            "atelier": empty_workshop(),
            "commandes": [],
            "prochaine_commande": 1,
            "effets": [],
            "evenements": [],
            "gel_jour": 0,
            "objectifs": [],
            "journal": []
        });
        let mut g = Game::depuis(st);
        g.roll_forecast(true);
        let libre = if mode == "libre" { " Mode libre : pas d'objectif d'argent, prenez votre temps." } else { "" };
        g.log(
            &format!(
                "Bienvenue à la Ferme du Val Vert ! C'est le printemps : préparez le sol, puis semez. \
                 L'élevage est vide : achetez vos premières bêtes quand vous serez prêt. Premier marché demain mardi, 7 h.{libre}"
            ),
            "info",
        );
        g.s
    }

    /// Met à niveau une ancienne sauvegarde.
    fn migrate(&mut self) {
        let version = self.s.get("version").map_or(1, |v| v.i());
        if version < 2 {
            // V1 : champs de tomates / potager / maïs imposés
            let old = self.s["champs"].take();
            let mut fields = Map::new();
            for (new, (prev, crop)) in tab("FIELDS").keys().zip([("tomates", "tomates"), ("legumes", "carottes"), ("mais", "mais")]) {
                let mut f = Map::new();
                f.insert("serre".into(), json!(false));
                f.insert("humidite".into(), json!(65.0));
                for (k, v) in obj(&mut empty_bed(true)).iter() {
                    f.insert(k.clone(), v.clone());
                }
                for (k, v) in entrees(&old[prev]) {
                    f.insert(k.clone(), v.clone());
                }
                let c = if f["etat"] != "vide" { json!(crop) } else { Value::Null };
                f.insert("culture".into(), c);
                fields.insert(new.clone(), Value::Object(f));
            }
            self.s["champs"] = Value::Object(fields);
            let legumes = obj(&mut self.s["stock"]).shift_remove("legumes").map_or(0.0, |v| v.f());
            let c = self.s["stock"]["carottes"].f() + legumes;
            self.s["stock"]["carottes"] = fl(c);
        }
        if version < 4 {
            // V3 : une seule culture par parcelle → planches
            let vide = empty_bed(true);
            for f in obj(&mut self.s["champs"]).values_mut() {
                if f.get("planches").is_none() {
                    let fm = obj(f);
                    let mut b = Map::new();
                    for (k, v) in vide.as_object().unwrap() {
                        b.insert(k.clone(), fm.shift_remove(k).unwrap_or_else(|| v.clone()));
                    }
                    fm.insert("planches".into(), json!([b]));
                }
            }
        }
        self.s["version"] = json!(5);
        let defauts = [
            ("technologies", json!([])),
            ("meteo_hier", Value::Null),
            ("menu", json!(false)),
            ("vitesse_menu", json!(1)),
            ("eoliennes", json!(0)),
            ("ruches", json!(0)),
            ("reputation", json!(50.0)),
            ("collecte_lait", json!(true)),
            ("collecte_jour", json!(0)),
            ("dernier_chimique", json!(-10 * 1440)),
            ("repas_bio", json!(0.0)),
            ("etal", default_stall()),
            ("marche", empty_market(0)),
            ("qualite", json!({})),
            ("bio", json!({})),
            ("mode", json!("classique")),
            ("atelier", empty_workshop()),
            ("commandes", json!([])),
            ("prochaine_commande", json!(1)),
            ("effets", json!([])),
            ("evenements", json!([])),
            ("gel_jour", json!(0)),
        ];
        let o = obj(&mut self.s);
        for (k, v) in defauts {
            o.entry(k).or_insert(v);
        }
        let stats = obj(&mut self.s["stats"]);
        for (k, v) in [("energie", json!(0.0)), ("ventes_marche", json!(0.0)), ("transformations", json!(0)), ("commandes", json!(0)), ("commandes_ratees", json!(0))] {
            stats.entry(k).or_insert(v);
        }
        obj(&mut self.s["stock"]).entry("foin_bio").or_insert(json!(0.0));
        for (k, info) in items() {
            obj(&mut self.s["stock"]).entry(k.clone()).or_insert(json!(0.0));
            obj(&mut self.s["qualite"]).entry(k.clone()).or_insert(json!(75.0));
            obj(&mut self.s["bio"]).entry(k.clone()).or_insert(json!(1.0));
            obj(&mut self.s["prix"]).entry(k.clone()).or_insert(info["prix"].clone());
            obj(&mut self.s["prix_hier"]).entry(k.clone()).or_insert(info["prix"].clone());
            obj(&mut self.s["etal"]).entry(k.clone()).or_insert(json!({"actif": k != "mais" && k != "fumier", "prix": null}));
        }
        for cle in ["prix", "prix_hier"] {
            let o = obj(&mut self.s[cle]);
            let a_retirer: Vec<String> = o.keys().filter(|k| !items().contains_key(k.as_str())).cloned().collect();
            for k in a_retirer {
                o.shift_remove(&k);
            }
        }
        let vide = empty_bed(true);
        for f in obj(&mut self.s["champs"]).values_mut() {
            let fm = obj(f);
            fm.entry("serre").or_insert(json!(false));
            fm.entry("humidite").or_insert(json!(65.0));
            fm.entry("planches").or_insert(json!([vide.clone()]));
            for b in arr(&mut fm["planches"]) {
                let bm = obj(b);
                for (k, v) in vide.as_object().unwrap() {
                    bm.entry(k.clone()).or_insert(v.clone());
                }
            }
        }
        let troupeau = empty_herd();
        for grp in obj(&mut self.s["animaux"]).values_mut() {
            let gm = obj(grp);
            for (k, v) in troupeau.as_object().unwrap() {
                gm.entry(k.clone()).or_insert(v.clone());
            }
            for a in arr(&mut gm["liste"]) {
                let am = obj(a);
                am.entry("humeur").or_insert(json!(70.0));
                am.entry("dernier_calin").or_insert(json!(-CALIN_PAUSE as i64));
            }
        }
        if self.s["meteo"].vrai() {
            // anciennes sauvegardes : 3 jours de prévisions seulement
            let mut rng = Random::new_str(&format!("{}-{:.0}-meteo-ext", self.seed(), self.minute()));
            while (self.s["previsions"].l().len() as i64) < FORECAST_DAYS {
                let jour = self.day() + 1 + self.s["previsions"].l().len() as i64;
                let p = pick_weather(&mut rng, jour);
                arr(&mut self.s["previsions"]).push(p);
            }
        }
    }

    // -------- utilitaires --------
    fn seed(&self) -> i64 {
        self.s["seed"].i()
    }

    pub fn minute(&self) -> f64 {
        self.s["minute"].f()
    }

    pub fn day(&self) -> i64 {
        fdiv(self.minute(), MIN_PER_DAY) as i64 + 1
    }

    pub fn hour(&self) -> f64 {
        fmod(self.minute(), MIN_PER_DAY) / 60.0
    }

    pub fn weekday(&self) -> i64 {
        (self.day() - 1).rem_euclid(7)
    }

    pub fn clock(&self) -> String {
        let m = fmod(self.minute(), MIN_PER_DAY) as i64;
        format!("{:02}:{:02}", m / 60, m % 60)
    }

    pub fn has(&self, up: &str) -> bool {
        self.s["ameliorations"].l().iter().any(|x| x.t() == up)
    }

    fn rng(&self, salt: &str) -> Random {
        Random::new_str(&format!("{}-{}-{}", self.seed(), self.day(), salt))
    }

    pub fn log(&mut self, msg: &str, kind: &str) {
        let e = json!({"jour": self.day(), "heure": self.clock(), "msg": msg, "type": kind});
        let j = arr(&mut self.s["journal"]);
        j.insert(0, e);
        j.truncate(60);
    }

    fn champ(&self, key: &str) -> &Value {
        &self.s["champs"][key]
    }

    fn planche(&self, key: &str, i: usize) -> &Value {
        &self.s["champs"][key]["planches"][i]
    }

    fn planche_mut(&mut self, key: &str, i: usize) -> &mut Value {
        &mut self.s["champs"][key]["planches"][i]
    }

    fn champ_keys(&self) -> Vec<String> {
        cles(&self.s["champs"])
    }

    /// Toutes les planches de la ferme.
    fn toutes_planches(&self) -> impl Iterator<Item = &Value> + '_ {
        entrees(&self.s["champs"]).flat_map(|(_, f)| f["planches"].l().iter())
    }

    pub fn n_serres(&self) -> usize {
        entrees(&self.s["champs"]).filter(|(_, f)| f["serre"].vrai()).count()
    }

    pub fn field_name(&self, key: &str) -> String {
        let nom = field_label(key);
        if self.champ(key)["serre"].vrai() {
            nom.replace("Parcelle", "Serre")
        } else {
            nom
        }
    }

    pub fn bed_name(&self, key: &str, i: usize) -> String {
        if self.champ(key)["planches"].l().len() == 1 {
            self.field_name(key)
        } else {
            format!("{} (planche {})", self.field_name(key), i + 1)
        }
    }

    /// Association de cultures : au moins deux cultures différentes en terre sur la parcelle.
    pub fn mixed(&self, key: &str) -> bool {
        let mut c: Vec<&str> = Vec::new();
        for b in self.champ(key)["planches"].l() {
            if actif(b) && !c.contains(&b["culture"].t()) {
                c.push(b["culture"].t());
            }
        }
        c.len() >= 2
    }

    /// La technologie est achetée et en état de marche (pas en panne).
    pub fn has_tech(&self, t: &str) -> bool {
        self.s["technologies"].l().iter().any(|x| x.t() == t) && !self.broken().iter().any(|x| x == t)
    }

    pub fn broken(&self) -> Vec<String> {
        self.active_effects().iter().filter(|e| e["id"] == "panne").map(|e| e["tech"].t().to_string()).collect()
    }

    // -------- saisons --------
    pub fn saison(&self) -> &'static str {
        saison_du_jour(self.day())
    }

    fn sz(&self) -> &'static Value {
        &tab("SAISONS")[self.saison()]
    }

    pub fn year(&self) -> i64 {
        (self.day() - 1).div_euclid(4 * SAISON_JOURS) + 1
    }

    pub fn in_season(&self, c: &str, saison: Option<&str>) -> bool {
        let s = saison.unwrap_or(self.saison());
        crops()[c]["saisons"].l().iter().any(|x| x.t() == s)
    }

    fn season_info(&self) -> Value {
        let sa = self.saison();
        let i = SAISON_ORDRE.iter().position(|x| *x == sa).unwrap_or(0);
        let jour = (self.day() - 1).rem_euclid(SAISON_JOURS) + 1;
        let nxt = SAISON_ORDRE[(i + 1) % 4];
        let sz = self.sz();
        json!({"id": sa, "nom": sz["nom"], "emoji": sz["emoji"], "desc": sz["desc"],
               "jour": jour, "jours": SAISON_JOURS, "annee": self.year(), "reste": SAISON_JOURS - jour + 1,
               "prochaine": tab("SAISONS")[nxt]["nom"], "prochaine_id": nxt})
    }

    // -------- effets temporaires (événements) --------
    pub fn active_effects(&self) -> Vec<Value> {
        let m = self.minute();
        self.s["effets"].l().iter().filter(|e| e["fin"].f() > m).cloned().collect()
    }

    fn effect_mult(&self, key: &str) -> f64 {
        let mut m = 1.0;
        for e in self.active_effects() {
            m *= e.get(key).map_or(1.0, |v| v.f());
        }
        m
    }

    pub fn drone_active(&self) -> bool {
        self.has_tech("drone") && self.s["meteo"]["type"] != "orage"
    }

    fn n_extra_fields(&self) -> usize {
        entrees(&self.s["champs"]).filter(|(k, _)| !tab("FIELDS").contains_key(k.as_str())).count()
    }

    /// Prochain terrain à vendre (clé, prix), ou None quand tout est acheté.
    fn next_field(&self) -> Option<(String, i64)> {
        d("EXTRA_FIELDS")
            .l()
            .iter()
            .map(|x| (x[0].t().to_string(), x[1].i()))
            .find(|(k, _)| self.s["champs"].get(k.as_str()).is_none())
    }

    /// Gain journalier des éoliennes avec la météo du jour.
    fn wind_income(&self) -> f64 {
        let vent = weather()[self.s["meteo"]["type"].t()]["vent"].f();
        self.s["eoliennes"].f() * tab("BUILDINGS")["eolienne"]["gain_max"].f() * vent
    }

    pub fn charges(&self) -> f64 {
        35.0 + 1.5 * self.n_animals() as f64
            + 12.0 * self.s["ameliorations"].l().len() as f64
            + tab("BUILDINGS")["serre"]["entretien"].f() * self.n_serres() as f64
            + EXTRA_FIELD_UPKEEP as f64 * self.n_extra_fields() as f64
            + self.s["technologies"].l().iter().map(|t| tab("TECH")[t.t()]["entretien"].f()).sum::<f64>()
            + self.workshop_upkeep()
    }

    fn workshop_upkeep(&self) -> f64 {
        let at = &self.s["atelier"];
        if !at["construit"].vrai() {
            return 0.0;
        }
        tab("ATELIER")["entretien"].f() + entrees(&at["equipements"]).map(|(e, _)| tab("EQUIPEMENTS")[e.as_str()]["entretien"].f()).sum::<f64>()
    }

    fn serre_unlocked(&self) -> bool {
        self.s["stats"]["ventes"].f() >= tab("BUILDINGS")["serre"]["ventes_requises"].f()
    }

    pub fn n_animals(&self) -> usize {
        entrees(&self.s["animaux"]).map(|(_, a)| a["liste"].l().len()).sum()
    }

    pub fn temperature(&self) -> f64 {
        temp_at(self.s["meteo"]["temp"].f(), self.hour())
    }

    /// Ce qu'affiche l'écran Météo : humidité de l'air, ressenti, vent, UV, risque de pluie.
    fn weather_details(&self) -> Value {
        let w = &weather()[self.s["meteo"]["type"].t()];
        let t = self.temperature();
        let day = 0.0f64.max(((self.hour() - 6.0) / 24.0 * 2.0 * PI).sin()); // 0 la nuit, 1 vers 12 h
        let hum = clamp3(w["humidite"].f() + 12.0 * (1.0 - day) - 4.0 * day, 10.0, 100.0);
        let vent = w["vent"].f() * WIND_KMH_F * (0.75 + 0.35 * day);
        let ressenti = t + (if t > 22.0 { 0.08 * (hum - 55.0) } else { 0.0 }) - (if t < 20.0 { vent / 12.0 } else { 0.0 });
        let rosee = t - (100.0 - hum) / 5.0;
        json!({"humidite_air": rond(hum), "ressenti": rond(ressenti), "vent_kmh": rond(vent),
               "uv": rond(w["uv"].f() * day), "uv_max": w["uv"], "risque_pluie": w["risque"], "rosee": rond(rosee)})
    }

    /// Les prochaines heures : température et temps (le lendemain prend la première prévision).
    fn hourly(&self, n: i64) -> Vec<Value> {
        let base_h = self.hour() as i64;
        (0..n)
            .map(|i| {
                let h = base_h + i;
                let mm = if h < 24 { &self.s["meteo"] } else { &self.s["previsions"][0] };
                let t = mm["type"].t();
                let heure = if i == 0 { "Maint.".to_string() } else { format!("{:02} h", h % 24) };
                json!({"heure": heure, "h": h % 24, "type": t,
                       "temp": rond(temp_at(mm["temp"].f(), (h % 24) as f64)), "risque": weather()[t]["risque"]})
            })
            .collect()
    }

    /// Aujourd'hui + les prévisions : nom du jour, temps, températures mini / maxi.
    fn week(&self) -> Vec<Value> {
        let mut jours = vec![&self.s["meteo"]];
        jours.extend(self.s["previsions"].l().iter());
        jours
            .iter()
            .enumerate()
            .map(|(i, dj)| {
                let i = i as i64;
                let wd = (self.weekday() + i) % 7;
                let jour = if i == 0 { "Aujourd'hui" } else if i == 1 { "Demain" } else { JOURS[wd as usize] };
                json!({"jour": jour, "type": dj["type"], "nom": dj["nom"], "min": rond(dj["temp"].f() - 6.0),
                       "max": rond(dj["temp"].f() + 3.0), "risque": weather()[dj["type"].t()]["risque"],
                       "marche": self.market_day(Some(wd))})
            })
            .collect()
    }

    fn raining(&self) -> bool {
        weather()[self.s["meteo"]["type"].t()]["pluie"].f() > 0.0
    }

    // -------- marché : jours, prix, qualité --------
    pub fn market_day(&self, weekday: Option<i64>) -> bool {
        MARKET_DAYS.contains(&weekday.unwrap_or_else(|| self.weekday()))
    }

    pub fn market_open(&self) -> bool {
        let h = self.hour();
        self.market_day(None) && MARKET_HOURS.0 as f64 <= h && h < MARKET_HOURS.1 as f64
    }

    fn next_market(&self) -> String {
        if self.market_open() {
            return format!("Ouvert jusqu'à {} h", MARKET_HOURS.1);
        }
        if self.market_day(None) && self.hour() < MARKET_HOURS.0 as f64 {
            return format!("Aujourd'hui, {} h", MARKET_HOURS.0);
        }
        for dd in 1..8 {
            let wd = (self.weekday() + dd) % 7;
            if MARKET_DAYS.contains(&wd) {
                return format!("{}, {} h", if dd == 1 { "Demain" } else { JOURS[wd as usize] }, MARKET_HOURS.0);
            }
        }
        String::new()
    }

    /// Prix que les clients trouvent honnête : cours du jour × qualité × bio.
    pub fn fair_price(&self, item: &str) -> f64 {
        self.s["prix"][item].f() * quality_mult(self.s["qualite"][item].f()) * bio_mult(self.s["bio"][item].f())
            * (if self.market_open() { self.effect_mult("prix") } else { 1.0 })
    }

    fn wholesale_price(&self, item: &str) -> f64 {
        let (q, b) = (self.s["qualite"][item].f(), self.s["bio"][item].f());
        self.s["prix"][item].f() * GROS * (0.85 + 0.3 * q / 100.0) * (1.0 + 0.25 * b)
    }

    fn stall_price(&self, item: &str) -> f64 {
        let p = &self.s["etal"][item]["prix"];
        if p.is_null() {
            rond_n(self.fair_price(item), 2)
        } else {
            p.f()
        }
    }

    fn on_stall(&self, item: &str) -> bool {
        self.s["etal"][item]["actif"].vrai() && self.s["stock"][item].f() >= min_unit(item)
    }

    pub fn customers_per_hour(&self) -> f64 {
        let n = items().keys().filter(|k| self.on_stall(k.as_str())).count();
        if n == 0 {
            return 0.0;
        }
        let variety = 1.4f64.min(0.55 + 0.1 * n as f64);
        let h = self.hour();
        let peak = if (9.0..11.5).contains(&h) { 1.3 } else { 1.0 };
        26.0 * (0.5 + self.s["reputation"].f() / 100.0) * weather()[self.s["meteo"]["type"].t()]["clients"].f() * peak * variety
            * self.effect_mult("clients")
    }

    // -------- stock --------
    /// Ajoute un lot au stock : qualité et part bio sont des moyennes pondérées.
    pub fn add(&mut self, item: &str, qty: f64, q: f64, bio: f64) {
        if qty <= 0.0 {
            return;
        }
        let old = 0.0f64.max(self.s["stock"][item].f());
        let tot = old + qty;
        let nq = (self.s["qualite"][item].f() * old + clamp(q) * qty) / tot;
        let nb = (self.s["bio"][item].f() * old + bio * qty) / tot;
        self.s["qualite"][item] = fl(nq);
        self.s["bio"][item] = fl(nb);
        self.s["stock"][item] = fl(tot);
    }

    fn flowering(&self) -> usize {
        self.toutes_planches().filter(|b| matches!(b["etat"].t(), "pousse" | "mur")).count()
    }

    fn honey_per_day(&self) -> f64 {
        let flowers = 1.0f64.min(0.4 + 0.2 * self.flowering() as f64);
        self.s["ruches"].f() * tab("BUILDINGS")["ruche"]["miel_jour"].f() * weather()[self.s["meteo"]["type"].t()]["miel"].f() * flowers
            * self.sz()["miel"].f()
    }

    fn honey_quality(&self) -> f64 {
        let mut cultures: Vec<&Value> = Vec::new();
        for b in self.toutes_planches() {
            if matches!(b["etat"].t(), "pousse" | "mur") && !cultures.contains(&&b["culture"]) {
                cultures.push(&b["culture"]);
            }
        }
        clamp(60.0 + 10.0 * cultures.len() as f64 + (if self.s["meteo"]["type"] == "canicule" { -10.0 } else { 0.0 }))
    }

    pub fn honey_bio(&self) -> f64 {
        if self.minute() - self.s["dernier_chimique"].f() < 3.0 * MIN_PER_DAY {
            0.0
        } else {
            1.0
        }
    }

    fn animal_quality(&self, cat: &str) -> f64 {
        let g = &self.s["animaux"][cat];
        let l = g["liste"].l();
        if l.is_empty() {
            return 0.0;
        }
        let health = l.iter().map(|a| a["sante"].f()).sum::<f64>() / l.len() as f64;
        clamp(0.45 * health + 0.35 * 100.0f64.min(g["satiete"].f() * 1.25) + 0.2 * self.mood(cat))
    }

    /// Humeur moyenne d'un enclos (0 à 100).
    pub fn mood(&self, cat: &str) -> f64 {
        let l = self.s["animaux"][cat]["liste"].l();
        if l.is_empty() {
            0.0
        } else {
            l.iter().map(|a| a["humeur"].f()).sum::<f64>() / l.len() as f64
        }
    }

    fn night(&self) -> bool {
        let h = self.hour();
        h < 6.0 || h >= 21.0
    }

    pub fn pollination(&self) -> f64 {
        1.0 + 0.05 * 3.0f64.min(self.s["ruches"].f())
    }

    // -------- météo / cours --------
    fn roll_forecast(&mut self, initial: bool) {
        let mut rng = self.rng("meteo");
        let day = self.day();
        if initial {
            self.s["meteo"] = json!({"type": "soleil", "nom": "Ensoleillé", "temp": 23});
            self.s["previsions"] = Value::Array((0..FORECAST_DAYS).map(|i| pick_weather(&mut rng, day + 1 + i)).collect());
        } else {
            self.s["meteo_hier"] = self.s["meteo"]["type"].clone();
            let premier = arr(&mut self.s["previsions"]).remove(0);
            self.s["meteo"] = premier;
            let p = pick_weather(&mut rng, day + FORECAST_DAYS);
            arr(&mut self.s["previsions"]).push(p);
        }
    }

    /// Cours de référence selon la saison : primeurs hors saison plus chers, bocaux et fromages recherchés l'hiver.
    pub fn season_price(&self, item: &str) -> f64 {
        let base = items()[item]["prix"].f();
        if crops().contains_key(item) && !self.in_season(item, None) {
            return base * HORS_SAISON;
        }
        if self.saison() == "hiver" && (items()[item]["transforme"].vrai() || item == "lait" || item == "oeufs") {
            return base * 1.15;
        }
        base
    }

    fn update_prices(&mut self) {
        let mut rng = self.rng("prix");
        self.s["prix_hier"] = self.s["prix"].clone();
        for (k, info) in items() {
            let p = self.s["prix"][k.as_str()].f();
            let (base, target) = (info["prix"].f(), self.season_price(k));
            let p = p + (target - p) * 0.35 + base * rng.uniform(-0.12, 0.12);
            self.s["prix"][k.as_str()] = fl(rond_n(clamp3(p, base * 0.55, base * 1.6), 3));
        }
    }

    // -------- boucle de simulation --------
    pub fn advance(&mut self, mut minutes: f64) {
        if self.s["statut"] != "en_cours" {
            return;
        }
        while minutes > 0.0 {
            let step = minutes.min(5.0);
            let before_day = self.day();
            self.step(step);
            let m = self.minute() + step;
            self.s["minute"] = fl(m);
            minutes -= step;
            if self.day() != before_day {
                self.new_day();
            }
            self.check_meals();
            self.market_tick(step);
            self.milk_collection();
            self.check_orders();
            if self.s["statut"] != "en_cours" {
                break;
            }
        }
    }

    fn step(&mut self, m: f64) {
        let wtype = self.s["meteo"]["type"].t().to_string();
        let w = &weather()[wtype.as_str()];
        let temp = self.temperature();
        // pluie + pompe
        let pump = if self.has("reservoir") { 1.0 } else { 0.5 };
        let niveau = self.s["reservoir"]["capacite"].f().min(self.s["reservoir"]["niveau"].f() + (pump + 14.0 * w["pluie"].f()) * m);
        self.s["reservoir"]["niveau"] = fl(niveau);

        // éoliennes
        if self.s["eoliennes"].vrai() {
            let gain = self.wind_income() * m / MIN_PER_DAY;
            ajouter(&mut self.s["argent"], gain);
            ajouter(&mut self.s["stats"]["energie"], gain);
        }

        // cultures : le sol (humidité) est commun à la parcelle, chaque planche pousse à son rythme
        let protect = if self.drone_active() { DRONE_PROTECT } else { 1.0 };
        let robot_herbes = self.has_tech("desherbeur");
        let weed = if robot_herbes { DESHERBEUR_BOOST } else { 1.0 };
        let mut pest_rng = Random::new_str(&format!("{}-nuisibles-{:.0}", self.seed(), self.minute()));
        let sz = self.sz();
        let gel = temp < 0.0;
        let raining = self.raining();
        let arrosage = self.has("arrosage");
        let recolteur = self.has_tech("recolteur");
        let minute = self.minute();
        let day = self.day();
        for key in self.champ_keys() {
            let k = key.as_str();
            let serre = self.champ(k)["serre"].vrai();
            let (soif, a_cultures) = {
                let active: Vec<&Value> = self.champ(k)["planches"].l().iter().filter(|b| actif(b)).collect();
                if active.is_empty() {
                    (1.0, false)
                } else {
                    (active.iter().map(|b| crops()[b["culture"].t()]["soif"].f()).sum::<f64>() / active.len() as f64, true)
                }
            };
            let evap = 0.025 * w["evap"].f() * soif * (1.0 + 0.0f64.max(temp - 22.0) / 15.0) * m;
            let rain = if serre { 0.0 } else { RAIN_WATER * w["pluie"].f() * m }; // la pluie arrose, sauf sous serre
            let h = clamp(self.champ(k)["humidite"].f() - evap * (if serre { SERRE_EVAP } else { 1.0 }) + rain);
            self.s["champs"][k]["humidite"] = fl(h);
            if arrosage && a_cultures && h < 35.0 && (serre || !raining) {
                let _ = self.water(k, true);
            }
            let hum = self.champ(k)["humidite"].f();
            let nb = self.champ(k)["planches"].l().len();
            for i in 0..nb {
                let mut b = self.planche(k, i).clone();
                let mut recolte = false;
                'p: {
                    if !actif(&b) {
                        break 'p;
                    }
                    let culture = b["culture"].t().to_string();
                    let crop = &crops()[culture.as_str()];
                    let nom_c = crop["nom"].t().to_lowercase();
                    // gel : les cultures fragiles en plein champ souffrent quand il gèle
                    if gel && !serre && !crop["rustique"].vrai() {
                        b["sante"] = fl(clamp(b["sante"].f() - GEL_DEGATS * m * protect));
                        b["qualite"] = fl(clamp(b["qualite"].f() - 0.01 * m));
                        if self.s["gel_jour"].i() != day {
                            self.s["gel_jour"] = json!(day);
                            self.log(
                                &format!("Il gèle ({temp:.0} °C) : les cultures fragiles en plein champ souffrent. Seules les carottes et les salades résistent dehors."),
                                "alerte",
                            );
                        }
                        if b["sante"].f() <= 0.0 {
                            b["etat"] = json!("fletri");
                            let msg = format!("{} : les {nom_c} ont gelé.", self.bed_name(k, i));
                            self.log(&msg, "alerte");
                            break 'p;
                        }
                    }
                    // mauvaises herbes : elles aiment les sols humides ; le robot désherbeur les arrache au fur et à mesure
                    if robot_herbes {
                        b["herbes"] = json!(0.0);
                    } else {
                        b["herbes"] = fl(clamp(b["herbes"].f() + HERBES_POUSSE * (if hum > 60.0 { 1.3 } else { 1.0 }) * (if serre { 0.6 } else { 1.0 }) * m));
                    }
                    // nuisibles : ils arrivent au hasard (moins sous serre) et rongent les plants tant qu'on ne traite pas
                    if b["nuisible"].is_null()
                        && b["protege_jusqua"].f() <= minute
                        && pest_rng.random() < NUISIBLE_RISQUE * (if serre { 0.4 } else { 1.0 }) * m / MIN_PER_DAY
                    {
                        b["nuisible"] = d("NUISIBLES")[culture.as_str()].clone();
                        let msg = format!("{} : des {} attaquent les {nom_c} ! Traitez vite.", self.bed_name(k, i), b["nuisible"].t());
                        self.log(&msg, "alerte");
                    }
                    if b["nuisible"].vrai() {
                        b["sante"] = fl(clamp(b["sante"].f() - NUISIBLE_DEGATS * m * protect));
                        b["qualite"] = fl(clamp(b["qualite"].f() - 0.01 * m * protect));
                        if b["sante"].f() <= 0.0 {
                            b["etat"] = json!("fletri");
                            let msg = format!("{} : les {} ont eu raison des {nom_c}.", self.bed_name(k, i), b["nuisible"].t());
                            self.log(&msg, "alerte");
                            break 'p;
                        }
                    }
                    if matches!(b["etat"].t(), "seme" | "pousse") {
                        let water_factor = if hum < 15.0 {
                            0.15
                        } else if hum < 35.0 {
                            0.6
                        } else if hum <= 90.0 {
                            1.0
                        } else {
                            0.7
                        };
                        let hot = temp > 34.0 && !serre;
                        let heat = if hot { 0.6 } else { 1.0 };
                        let boost = if b["engrais_jusqua"].f() > minute { b["boost"].f() } else { 1.0 };
                        let rate = 100.0 / (crop["jours"].f() * MIN_PER_DAY) * (if serre { SERRE_BOOST * sz["serre"].f() } else { sz["pousse"].f() }) * weed;
                        let herbes = 1.0 - 0.5 * b["herbes"].f() / 100.0; // envahie, une planche pousse deux fois moins vite
                        let c = 100.0f64.min(b["croissance"].f() + rate * water_factor * heat * boost * herbes * m);
                        b["croissance"] = fl(c);
                        if c > 8.0 {
                            b["etat"] = json!("pousse");
                        }
                        if hum < 15.0 {
                            b["sante"] = fl(clamp(b["sante"].f() - 0.02 * m * protect));
                        } else if hum > 35.0 {
                            b["sante"] = fl(clamp(b["sante"].f() + 0.004 * m / protect));
                        }
                        // qualité : sol trop sec ou détrempé, coups de chaleur (le drone limite les dégâts)
                        if hum < 25.0 {
                            b["qualite"] = fl(clamp(b["qualite"].f() - 0.02 * m * protect));
                        } else if hum > 92.0 {
                            b["qualite"] = fl(clamp(b["qualite"].f() - 0.01 * m * protect));
                        }
                        if hot {
                            b["qualite"] = fl(clamp(b["qualite"].f() - 0.01 * m * protect));
                        }
                        if b["herbes"].f() > 60.0 {
                            b["qualite"] = fl(clamp(b["qualite"].f() - 0.008 * m));
                        }
                        if c >= 100.0 {
                            b["etat"] = json!("mur");
                            b["mur_depuis"] = self.s["minute"].clone();
                            if recolteur {
                                recolte = true;
                                break 'p;
                            }
                            let msg = format!("{} : les {nom_c} sont prêtes à récolter !", self.bed_name(k, i));
                            self.log(&msg, "succes");
                        }
                        if b["sante"].f() <= 0.0 {
                            b["etat"] = json!("fletri");
                            let msg = format!("{} : les {nom_c} ont flétri, faute d'eau.", self.bed_name(k, i));
                            self.log(&msg, "alerte");
                        }
                    } else {
                        // mûres
                        if recolteur {
                            recolte = true;
                            break 'p;
                        }
                        let waited = minute - b["mur_depuis"].f();
                        if waited > 0.5 * MIN_PER_DAY {
                            // cueillies trop tard, elles perdent en qualité
                            b["qualite"] = fl(clamp(b["qualite"].f() - 0.01 * m));
                        }
                        if waited > 1.5 * MIN_PER_DAY {
                            b["sante"] = fl(clamp(b["sante"].f() - 0.03 * m));
                            if b["sante"].f() <= 0.0 {
                                b["etat"] = json!("fletri");
                                let msg = format!("{} : les {nom_c} ont pourri sur pied.", self.bed_name(k, i));
                                self.log(&msg, "alerte");
                            }
                        }
                    }
                }
                *self.planche_mut(k, i) = b;
                if recolte {
                    self.harvest(k, i, true);
                }
            }
        }

        // animaux
        let mauvais_temps = wtype == "pluie" || wtype == "orage";
        let robot_traite = self.has_tech("robot_traite");
        let night = self.night();
        let repas_bio = self.s["repas_bio"].f();
        for cat in cles(&self.s["animaux"]) {
            let c = cat.as_str();
            let info = &animals()[c];
            if self.s["animaux"][c]["liste"].l().is_empty() {
                continue;
            }
            let dehors = self.s["animaux"][c]["au_pre"].vrai();
            let broute = dehors && !night && wtype != "orage" && sz["pre"].vrai();
            let grp = &mut self.s["animaux"][c];
            let sat = clamp(grp["satiete"].f() - SATIETE_BAISSE * (if broute { PRE_SATIETE } else { 1.0 }) * m);
            grp["satiete"] = fl(sat);
            let proprete = clamp(grp["proprete"].f() - SALETE * (if dehors { 0.4 } else { 1.0 }) * m);
            grp["proprete"] = fl(proprete);
            let sale = proprete < ENCLOS_SALE;
            // humeur : elle baisse sans attention ; le pré la remonte, la pluie dehors ou la nuit dehors la plombent
            let mut humeur = -HUMEUR_BAISSE - (if sale { 0.01 } else { 0.0 });
            if dehors {
                humeur += if mauvais_temps || night { -0.03 } else { 0.025 };
            }
            for a in arr(&mut grp["liste"]) {
                if sat < 20.0 {
                    a["sante"] = fl(clamp(a["sante"].f() - SANTE_BAISSE_FAIM * m));
                } else if sat > 50.0 && !sale {
                    a["sante"] = fl(clamp(a["sante"].f() + 0.02 * m));
                }
                if sale {
                    a["sante"] = fl(clamp(a["sante"].f() - SANTE_BAISSE_SALE * m));
                }
                a["humeur"] = fl(clamp(a["humeur"].f() + humeur * m));
            }
            let ff = feed_factor(sat);
            if ff != 0.0 {
                let produit = info["produit"].t();
                let eff = self.s["animaux"][c]["liste"].l().iter().map(|a| a["sante"].f()).sum::<f64>() / 100.0;
                let mut qty = info["par_jour"].f() * eff * (m / MIN_PER_DAY) * ff * mood_factor(self.mood(c))
                    * sz["prod"].get(produit).map_or(1.0, |v| v.f());
                let q = self.animal_quality(c);
                if robot_traite {
                    self.add(produit, qty, q, repas_bio);
                } else {
                    // la production attend dans l'enclos qu'on vienne la chercher (au plus une journée)
                    let grp = &mut self.s["animaux"][c];
                    let ar = grp["a_ramasser"].f();
                    let room = info["par_jour"].f() * grp["liste"].l().len() as f64 * RAMASSAGE_MAX - ar;
                    qty = 0.0f64.max(qty.min(room));
                    if qty != 0.0 {
                        let tot = ar + qty;
                        grp["q_ramasser"] = fl((grp["q_ramasser"].f() * ar + q * qty) / tot);
                        grp["bio_ramasser"] = fl((grp["bio_ramasser"].f() * ar + repas_bio * qty) / tot);
                        grp["a_ramasser"] = fl(tot);
                    }
                }
                ajouter(&mut self.s["stats"]["production_jour"][produit], qty);
            }
            // décès
            let morts: Vec<String> =
                self.s["animaux"][c]["liste"].l().iter().filter(|a| a["sante"].f() <= 0.0).map(|a| a["nom"].t().to_string()).collect();
            if !morts.is_empty() {
                arr(&mut self.s["animaux"][c]["liste"]).retain(|a| !(a["sante"].f() <= 0.0));
                for nom in morts {
                    self.log(&format!("{nom} ({}) n'a pas survécu… Pensez à nourrir et soigner le troupeau.", info["unite"].t()), "alerte");
                }
            }
        }

        // ruches
        if self.s["ruches"].vrai() {
            let qty = self.honey_per_day() * m / MIN_PER_DAY;
            let (q, bio) = (self.honey_quality(), self.honey_bio());
            self.add("miel", qty, q, bio);
            ajouter(&mut self.s["stats"]["production_jour"]["miel"], qty);
        }

        // atelier : les fournées terminées passent au stock
        self.workshop_tick();

        // fraîcheur : les produits frais s'abîment
        for (item, info) in items() {
            let it = item.as_str();
            if info["perime"].vrai() && self.s["stock"][it].f() > 0.0 {
                let q = self.s["qualite"][it].f() - info["perime"].f() * m / MIN_PER_DAY;
                self.s["qualite"][it] = fl(0.0f64.max(q));
                if q <= 0.0 && self.s["stock"][it].f() >= min_unit(it) {
                    let msg = format!(
                        "Vos {} n'étaient plus mangeables : {:.0} {} jetés. Vendez les produits frais plus vite !",
                        info["nom"].t().to_lowercase(),
                        self.s["stock"][it].f(),
                        info["unite"].t()
                    );
                    self.log(&msg, "alerte");
                    self.s["stock"][it] = json!(0.0);
                }
            }
        }
    }

    fn repas_fait(&self, meal: i64) -> bool {
        self.s["repas"]["faits"].l().iter().any(|x| x.f() == meal as f64)
    }

    fn check_meals(&mut self) {
        let day = self.day();
        if self.s["repas"]["jour"].i() != day {
            self.s["repas"]["jour"] = json!(day);
            self.s["repas"]["faits"] = json!([]);
        }
        let h = self.hour();
        for meal in MEALS {
            if self.repas_fait(meal) {
                continue;
            }
            if self.has("distributeur") && h >= meal as f64 && h < meal as f64 + MEAL_WINDOW.1 {
                if let Ok(true) = self.feed(true) {
                    arr(&mut self.s["repas"]["faits"]).push(json!(meal));
                }
            }
        }
    }

    // -------- marché : les clients achètent à votre étal --------
    fn market_tick(&mut self, m: f64) {
        let day = self.day();
        if self.s["marche"]["jour"].i() != day {
            self.s["marche"] = empty_market(day);
        }
        if !self.market_day(None) {
            return;
        }
        let open = self.market_open();
        if self.s["marche"]["etat"] == "ferme" && open {
            self.s["marche"]["etat"] = json!("ouvert");
            let n = items().keys().filter(|k| self.on_stall(k.as_str())).count();
            let msg = if n > 0 {
                format!("C'est jour de marché ! Votre étal est installé avec {n} produit(s), jusqu'à {} h.", MARKET_HOURS.1)
            } else {
                "C'est jour de marché… mais votre étal est vide.".to_string()
            };
            self.log(&msg, "info");
        }
        if self.s["marche"]["etat"] == "ouvert" && !open {
            self.s["marche"]["etat"] = json!("termine");
            let mk = &self.s["marche"];
            let msg = format!(
                "Fin du marché : {} client(s) sur {} ont acheté, recette {:.0} €. Réputation {:.0}/100.",
                mk["acheteurs"].i(),
                mk["clients"].i(),
                mk["recette"].f(),
                self.s["reputation"].f()
            );
            self.log(&msg, "succes");
            self.update_objectives();
            return;
        }
        if self.s["marche"]["etat"] != "ouvert" {
            return;
        }
        let mut rng = Random::new_str(&format!("{}-client-{:.0}", self.seed(), self.minute()));
        let expected = self.customers_per_hour() * m / 60.0;
        let n = expected as i64 + (if rng.random() < expected - (expected as i64) as f64 { 1 } else { 0 });
        for _ in 0..n {
            self.customer(&mut rng);
        }
    }

    fn customer(&mut self, rng: &mut Random) {
        let its: Vec<&'static String> = items().keys().filter(|k| self.on_stall(k.as_str())).collect();
        if its.is_empty() {
            return;
        }
        ajouter_i(&mut self.s["marche"]["clients"], 1);
        let k_n = rng.randint(1, 3) as usize;
        let poids: Vec<f64> = its.iter().map(|k| items()[k.as_str()]["attrait"].f()).collect();
        // (un ensemble en Python, dont l'ordre changeait d'un lancement à l'autre)
        let mut wants: Vec<&'static String> = Vec::new();
        for j in rng.choices_w(&poids, k_n) {
            if !wants.contains(&its[j]) {
                wants.push(its[j]);
            }
        }
        let (mut bought, mut too_expensive) = (0.0, false);
        for k in wants {
            let k = k.as_str();
            let (price, fair) = (self.stall_price(k), self.fair_price(k));
            if rng.random() > buy_chance(price / fair) {
                too_expensive = too_expensive || price > fair;
                continue;
            }
            let panier = items()[k]["panier"].l();
            let (lo, hi) = (panier[0].f(), panier[1].f());
            let qty = if k == "oeufs" { (rng.randint(1, 2) * 6) as f64 } else { rond_n(rng.uniform(lo, hi), 1) };
            let st = self.s["stock"][k].f();
            let qty = qty.min(if k == "oeufs" { st.floor() } else { st });
            if qty <= 0.0 {
                continue;
            }
            let gain = qty * price;
            let (q, bio) = (self.s["qualite"][k].f(), self.s["bio"][k].f());
            self.s["stock"][k] = fl(st - qty);
            ajouter(&mut self.s["argent"], gain);
            ajouter(&mut self.s["stats"]["ventes"], gain);
            ajouter(&mut self.s["stats"]["ventes_marche"], gain);
            ajouter(&mut self.s["marche"]["recette"], gain);
            ajouter(&mut self.s["marche"]["ventes"][k], qty);
            let ligne = json!({"produit": k, "qte": qty, "montant": rond_n(gain, 2), "heure": self.clock()});
            let dl = arr(&mut self.s["marche"]["dernieres"]);
            dl.insert(0, ligne);
            dl.truncate(10);
            bought += gain;
            // la réputation suit la qualité (et le bio) de ce que vous vendez
            let r = self.s["reputation"].f();
            self.s["reputation"] = fl(clamp(r + 0.004 * (q + 12.0 * bio - 10.0 - r)));
        }
        if bought != 0.0 {
            ajouter_i(&mut self.s["marche"]["acheteurs"], 1);
        } else if too_expensive {
            ajouter_i(&mut self.s["marche"]["trop_cher"], 1);
            let r = clamp(self.s["reputation"].f() - 0.05);
            self.s["reputation"] = fl(r);
        }
    }

    fn milk_collection(&mut self) {
        let day = self.day();
        if !self.s["collecte_lait"].vrai() || self.hour() < COLLECTE_HEURE as f64 || self.s["collecte_jour"].i() == day {
            return;
        }
        self.s["collecte_jour"] = json!(day);
        let qty = self.s["stock"]["lait"].f();
        if qty < 1.0 {
            return;
        }
        let gain = self.sell_wholesale("lait", qty);
        self.log(&format!("Le camion de la fromagerie a collecté {qty:.0} L de lait ({gain:.0} €)."), "info");
    }

    fn sell_wholesale(&mut self, item: &str, qty: f64) -> f64 {
        let gain = qty * self.wholesale_price(item);
        ajouter(&mut self.s["stock"][item], -qty);
        ajouter(&mut self.s["argent"], gain);
        ajouter(&mut self.s["stats"]["ventes"], gain);
        gain
    }

    fn new_day(&mut self) {
        self.roll_forecast(false);
        self.update_prices();
        let hier = self.s["stats"]["production_jour"].take();
        self.s["stats"]["hier"] = hier;
        self.s["stats"]["production_jour"] = json!({});
        // charges
        let charges = self.charges();
        ajouter(&mut self.s["argent"], -charges);
        let jour = JOURS[self.weekday() as usize];
        let marche = if self.market_day(None) { " · jour de marché !" } else { "" };
        let msg = format!("{jour} {}{marche} Charges du jour : {charges:.0} €. Météo : {}.", self.day(), self.s["meteo"]["nom"].t());
        self.log(&msg, "info");
        if (self.day() - 1).rem_euclid(SAISON_JOURS) == 0 {
            let sz = self.sz();
            let an = if self.saison() == "printemps" { format!(" · année {}", self.year()) } else { String::new() };
            self.event(sz["emoji"].t(), &format!("{}{an}", sz["nom"].t()), &minuscule_initiale(sz["desc"].t()), None);
        }
        self.s["effets"] = Value::Array(self.active_effects());
        if self.raining() {
            self.log("Il pleut : la pluie arrose les parcelles en plein champ (pas les serres).", "info");
        }
        // événements
        let mut rng = self.rng("event");
        if self.s["meteo"]["type"] == "orage" {
            let keys = self.champ_keys();
            let key = keys[rng.choice_i(keys.len())].clone();
            let hit: Vec<usize> = self.champ(&key)["planches"]
                .l()
                .iter()
                .enumerate()
                .filter(|(_, b)| matches!(b["etat"].t(), "pousse" | "mur"))
                .map(|(i, _)| i)
                .collect();
            if !hit.is_empty() {
                let nom = self.field_name(&key);
                if self.champ(&key)["serre"].vrai() {
                    self.log(&format!("Orage : la {nom} a protégé ses cultures."), "info");
                } else {
                    for i in hit {
                        let b = self.planche_mut(&key, i);
                        b["sante"] = fl(clamp(b["sante"].f() - 25.0));
                        b["qualite"] = fl(clamp(b["qualite"].f() - 15.0));
                    }
                    self.log(&format!("L'orage a abîmé la {nom} (−25 % de santé, qualité en baisse)."), "alerte");
                }
            }
        }
        let poules = &self.s["animaux"]["poules"];
        if poules["au_pre"].vrai() && !poules["liste"].l().is_empty() && rng.random() < 0.45 {
            let n = self.s["animaux"]["poules"]["liste"].l().len() as i64;
            let j = rng.randrange(n) as usize;
            let lost = arr(&mut self.s["animaux"]["poules"]["liste"]).remove(j);
            self.log(
                &format!("Les poules sont restées dehors cette nuit : le renard a emporté {}. Rentrez-les le soir !", lost["nom"].t()),
                "alerte",
            );
        }
        let dehors: Vec<String> = entrees(&self.s["animaux"])
            .filter(|(c, g)| g["au_pre"].vrai() && !g["liste"].l().is_empty() && c.as_str() != "poules")
            .map(|(c, _)| animals()[c.as_str()]["nom"].t().to_lowercase())
            .collect();
        if !dehors.is_empty() {
            self.log(&format!("Les {} ont passé la nuit dehors : ils sont de mauvaise humeur.", dehors.join(" et les ")), "alerte");
        }
        // commandes de clients et événements aléatoires
        let mut orng = self.rng("commande");
        if self.s["commandes"].l().len() < COMMANDES_MAX && self.day() >= 2 && orng.random() < COMMANDE_CHANCE {
            self.new_order(&mut orng);
        }
        let mut erng = self.rng("evenement");
        if self.day() >= 3 && erng.random() < EVENEMENT_CHANCE {
            self.random_event(&mut erng);
        }
        let roll = rng.random();
        let n_poules = self.s["animaux"]["poules"]["liste"].l().len();
        if roll < 0.10 && !self.has("cloture") && n_poules > 0 {
            let j = rng.randrange(n_poules as i64) as usize;
            let lost = arr(&mut self.s["animaux"]["poules"]["liste"]).remove(j);
            self.log(&format!("Le renard est passé cette nuit : {} a disparu. Une clôture renforcée éviterait ça.", lost["nom"].t()), "alerte");
        } else if roll < 0.18 {
            let cats: Vec<String> = entrees(&self.s["animaux"]).filter(|(_, g)| !g["liste"].l().is_empty()).map(|(c, _)| c.clone()).collect();
            if !cats.is_empty() {
                let cat = cats[rng.choice_i(cats.len())].clone();
                let nl = self.s["animaux"][cat.as_str()]["liste"].l().len();
                let j = rng.choice_i(nl);
                let a = &mut self.s["animaux"][cat.as_str()]["liste"][j];
                a["sante"] = fl(clamp(a["sante"].f() - 45.0));
                let nom = a["nom"].t().to_string();
                self.log(&format!("{nom} est malade. Appelez le vétérinaire."), "alerte");
            }
        } else if roll < 0.24 {
            let keys: Vec<&'static String> = items().keys().collect();
            let item = keys[rng.choice_i(keys.len())].as_str();
            let p = rond_n(self.s["prix"][item].f() * 1.5, 3);
            self.s["prix"][item] = fl(p);
            self.log(&format!("Forte demande : le cours des {} s'envole !", items()[item]["nom"].t().to_lowercase()), "succes");
        }
        // finances
        if self.s["argent"].f() < 0.0 {
            ajouter_i(&mut self.s["jours_dans_le_rouge"], 1);
            let left = 3 - self.s["jours_dans_le_rouge"].i();
            if left <= 0 {
                self.s["statut"] = json!("perdu");
                self.log("Faillite : trois jours de suite dans le rouge. La ferme est saisie.", "alerte");
            } else {
                self.log(&format!("Compte dans le rouge ! Encore {left} jour(s) avant la faillite."), "alerte");
            }
        } else {
            self.s["jours_dans_le_rouge"] = json!(0);
        }
        self.update_objectives();
    }

    // -------- actions internes --------
    fn water(&mut self, key: &str, auto: bool) -> R<bool> {
        let need = 600.0;
        let niveau = self.s["reservoir"]["niveau"].f();
        if niveau < need {
            if !auto {
                return Err("Pas assez d'eau dans le réservoir (600 L nécessaires).".into());
            }
            return Ok(false);
        }
        self.s["reservoir"]["niveau"] = fl(niveau - need);
        let h = clamp(self.champ(key)["humidite"].f() + 45.0);
        self.s["champs"][key]["humidite"] = fl(h);
        Ok(true)
    }

    /// Foin nécessaire pour un repas : les bêtes mangent plus en automne et en hiver.
    pub fn feed_needed(&self) -> f64 {
        entrees(&self.s["animaux"]).map(|(c, g)| animals()[c.as_str()]["ration"].f() * g["liste"].l().len() as f64).sum::<f64>()
            * self.sz()["ration"].f()
    }

    /// Sert un repas : foin bio d'abord, puis foin classique, puis le maïs de la ferme.
    fn feed(&mut self, auto: bool) -> R<bool> {
        let need = self.feed_needed();
        let st = &self.s["stock"];
        let available = st["foin_bio"].f() + st["foin"].f() + st["mais"].f();
        if available < need {
            if auto {
                self.log("Distributeur : stock de foin insuffisant !", "alerte");
                return Ok(false);
            }
            return Err(format!("Il faut {need:.0} kg de nourriture (foin + maïs), vous en avez {available:.0} kg."));
        }
        let (mut left, mut bio) = (need, 0.0);
        let bio_mais = self.s["bio"]["mais"].f();
        for k in ["foin_bio", "foin", "mais"] {
            let have = self.s["stock"][k].f();
            let used = have.min(left);
            self.s["stock"][k] = fl(have - used);
            left -= used;
            bio += used * (match k {
                "foin_bio" => 1.0,
                "mais" => bio_mais,
                _ => 0.0,
            });
        }
        self.s["repas_bio"] = fl(if need != 0.0 { bio / need } else { 0.0 });
        for g in obj(&mut self.s["animaux"]).values_mut() {
            g["satiete"] = json!(100.0);
        }
        Ok(true)
    }

    // -------- actions joueur --------
    pub fn act(&mut self, a: &Value) -> R<String> {
        let t = match &a["type"] {
            Value::String(s) => s.clone(),
            Value::Null => "None".to_string(),
            x => x.to_string(),
        };
        if self.s["statut"] != "en_cours" && !["nouvelle_partie", "vitesse", "menu", "continuer"].contains(&t.as_str()) {
            return Err("La partie est terminée. Lancez une nouvelle partie.".into());
        }
        let msg = match t.as_str() {
            "semer" => self.a_semer(a),
            "diviser" => self.a_diviser(a),
            "preparer" => self.a_preparer(a),
            "desherber" => self.a_desherber(a),
            "traiter" => self.a_traiter(a),
            "arroser" => self.a_arroser(a),
            "fertiliser" => self.a_fertiliser(a),
            "recolter" => self.a_recolter(a),
            "nourrir" => self.a_nourrir(a),
            "ramasser" => self.a_ramasser(a),
            "nettoyer" => self.a_nettoyer(a),
            "caliner" => self.a_caliner(a),
            "sortir" => self.a_sortir(a),
            "soigner" => self.a_soigner(a),
            "vendre" => self.a_vendre(a),
            "etal" => self.a_etal(a),
            "collecte" => self.a_collecte(a),
            "acheter" => self.a_acheter(a),
            "vendre_animal" => self.a_vendre_animal(a),
            "ameliorer" => self.a_ameliorer(a),
            "construire" => self.a_construire(a),
            "acheter_parcelle" => self.a_acheter_parcelle(a),
            "technologie" => self.a_technologie(a),
            "vitesse" => self.a_vitesse(a),
            "menu" => self.a_menu(a),
            "nouvelle_partie" => self.a_nouvelle_partie(a),
            "equiper" => self.a_equiper(a),
            "transformer" => self.a_transformer(a),
            "atelier_auto" => self.a_atelier_auto(a),
            "livrer" => self.a_livrer(a),
            "refuser" => self.a_refuser(a),
            "continuer" => self.a_continuer(a),
            _ => Err(format!("Action inconnue : {t}")),
        }?;
        self.update_objectives();
        Ok(msg)
    }

    fn field_of(&self, a: &Value) -> R<String> {
        match a["champ"].as_str() {
            Some(k) if self.s["champs"].get(k).is_some() => Ok(k.to_string()),
            _ => Err("Parcelle inconnue.".into()),
        }
    }

    fn bed_of(&self, a: &Value) -> R<(String, usize)> {
        let key = self.field_of(a)?;
        let i = entier(a.get("planche"), 0).ok_or("Planche inconnue.")?;
        let n = self.champ(&key)["planches"].l().len() as i64;
        if !(0..n).contains(&i) {
            return Err("Planche inconnue.".into());
        }
        Ok((key, i as usize))
    }

    fn item_of(&self, a: &Value) -> R<String> {
        match a["produit"].as_str() {
            Some(k) if items().contains_key(k) => Ok(k.to_string()),
            _ => Err("Produit inconnu.".into()),
        }
    }

    fn cat_of(&self, a: &Value) -> R<String> {
        match a["categorie"].as_str() {
            Some(c) if animals().contains_key(c) => Ok(c.to_string()),
            _ => Err("Catégorie inconnue.".into()),
        }
    }

    fn sow(&mut self, key: &str, i: usize, c: &str) -> R<()> {
        let crop = &crops()[c];
        let serre = self.champ(key)["serre"].vrai();
        let nom = crop["nom"].t().to_lowercase();
        if crop["serre"].vrai() && !serre {
            return Err(format!("Les {nom} ne poussent que sous serre."));
        }
        if !serre && !self.in_season(c, None) {
            return Err(format!(
                "Hors saison : en plein champ, les {nom} se sèment {}. Sous serre, tout pousse toute l'année.",
                saisons_txt(crop["saisons"].l())
            ));
        }
        self.pay(crop["graines"].f())?;
        fusion(
            self.planche_mut(key, i),
            json!({"etat": "seme", "culture": c, "croissance": 0.0, "sante": 100.0, "qualite": 100.0, "chimique": false,
                   "engrais_jusqua": 0, "boost": 1.0, "mur_depuis": null, "sol_pret": false, "herbes": 0.0, "nuisible": null}),
        );
        Ok(())
    }

    fn a_semer(&mut self, a: &Value) -> R<String> {
        let (key, i) = self.bed_of(a)?;
        let b = self.planche(&key, i);
        if !matches!(b["etat"].t(), "vide" | "fletri") {
            return Err("La planche n'est pas libre.".into());
        }
        if b["etat"] == "fletri" || !b["sol_pret"].vrai() {
            return Err("Préparez d'abord le sol de cette planche.".into());
        }
        let c = match a["culture"].as_str() {
            Some(c) if crops().contains_key(c) => c.to_string(),
            _ => return Err("Choisissez ce que vous voulez semer.".into()),
        };
        self.sow(&key, i, &c)?;
        let crop = &crops()[c.as_str()];
        let nom = crop["nom"].t();
        let msg = format!("{} : {} semées (−{} €).", self.bed_name(&key, i), nom.to_lowercase(), crop["graines"].i());
        self.log(&msg, "info");
        if self.mixed(&key) {
            return Ok(format!("{nom} semées · association de cultures : +{} % de récolte !", rond((ASSOCIATION - 1.0) * 100.0)));
        }
        Ok(format!("{nom} semées."))
    }

    /// Découpe une parcelle en 1, 2 ou 3 planches (toutes doivent être libres).
    fn a_diviser(&mut self, a: &Value) -> R<String> {
        let key = self.field_of(a)?;
        let n = entier(a.get("planches"), 1).unwrap_or(0);
        if !(1..=MAX_BEDS).contains(&n) {
            return Err(format!("Une parcelle se divise en 1 à {MAX_BEDS} planches."));
        }
        let pl = self.champ(&key)["planches"].l();
        if pl.iter().any(|b| !matches!(b["etat"].t(), "vide" | "fletri")) {
            return Err("Récoltez d'abord : toutes les planches doivent être libres pour redécouper la parcelle.".into());
        }
        let pret = pl.iter().all(|b| b["etat"] == "vide" && b["sol_pret"].vrai());
        self.s["champs"][key.as_str()]["planches"] = Value::Array((0..n).map(|_| empty_bed(pret)).collect());
        Ok(format!("{} : {n} planche{}.", self.field_name(&key), if n > 1 { "s" } else { "" }))
    }

    /// Laboure une planche libre (ou arrache les plants flétris) : elle est prête à semer.
    /// Avec le tracteur, toute la parcelle est labourée d'un coup.
    fn a_preparer(&mut self, a: &Value) -> R<String> {
        let (key, i) = self.bed_of(a)?;
        let tracteur = self.has("tracteur");
        let pl = self.champ(&key)["planches"].l();
        let n_pl = pl.len();
        let candidats: Vec<usize> = if tracteur { (0..n_pl).collect() } else { vec![i] };
        let todo: Vec<usize> = candidats
            .into_iter()
            .filter(|&j| pl[j]["etat"] == "fletri" || (pl[j]["etat"] == "vide" && !pl[j]["sol_pret"].vrai()))
            .collect();
        if todo.is_empty() {
            return Err((if pl[i]["etat"] == "vide" { "Le sol est déjà prêt." } else { "La planche est occupée." }).to_string());
        }
        for &j in &todo {
            fusion(self.planche_mut(&key, j), empty_bed(true));
        }
        if tracteur && n_pl > 1 {
            return Ok(format!("Le tracteur a labouré {} : {} planche(s) prête(s) à semer.", self.field_name(&key), todo.len()));
        }
        Ok(format!("{} : sol labouré, prêt à semer.", self.bed_name(&key, i)))
    }

    fn a_desherber(&mut self, a: &Value) -> R<String> {
        let (key, i) = self.bed_of(a)?;
        let b = self.planche(&key, i);
        if !actif(b) || b["herbes"].f() < 1.0 {
            return Err("Pas de mauvaises herbes ici.".into());
        }
        self.planche_mut(&key, i)["herbes"] = json!(0.0);
        Ok(format!("{} désherbée : les plants respirent !", self.bed_name(&key, i)))
    }

    /// Traite une planche contre les nuisibles : au naturel (reste bio) ou à l'insecticide (protège 3 jours).
    fn a_traiter(&mut self, a: &Value) -> R<String> {
        let (key, i) = self.bed_of(a)?;
        let mode = match a.get("traitement") {
            None => "naturel",
            Some(v) => v.as_str().unwrap_or(""),
        };
        let Some(t) = tab("TRAITEMENT").get(mode) else { return Err("Traitement inconnu.".into()) };
        if !self.planche(&key, i)["nuisible"].vrai() {
            return Err("Aucun nuisible sur cette planche.".into());
        }
        self.pay(t["prix"].f())?;
        let pest = self.planche(&key, i)["nuisible"].t().to_string();
        self.planche_mut(&key, i)["nuisible"] = Value::Null;
        let bn = self.bed_name(&key, i);
        if mode == "chimique" {
            let fin = self.minute() + t["protege"].f();
            fusion(self.planche_mut(&key, i), json!({"chimique": true, "protege_jusqua": entier_si_rond(fin)}));
            self.s["dernier_chimique"] = self.s["minute"].clone();
            self.log(&format!("{bn} : insecticide contre les {pest} (−{} €). La récolte ne sera pas bio.", t["prix"].i()), "info");
            return Ok(format!("Plus de {pest} · planche protégée 3 jours, mais plus bio."));
        }
        self.log(&format!("{bn} : {} contre les {pest} (−{} €).", t["nom"].t().to_lowercase(), t["prix"].i()), "info");
        Ok(format!("Plus de {pest} · traitement naturel, la culture reste bio."))
    }

    fn a_arroser(&mut self, a: &Value) -> R<String> {
        let key = self.field_of(a)?;
        if self.champ(&key)["planches"].l().iter().all(|b| b["etat"] == "vide") {
            return Err("Rien à arroser ici.".into());
        }
        self.water(&key, false)?;
        Ok(format!("{} arrosée (−600 L).", self.field_name(&key)))
    }

    fn a_fertiliser(&mut self, a: &Value) -> R<String> {
        let (key, i) = self.bed_of(a)?;
        if !matches!(self.planche(&key, i)["etat"].t(), "seme" | "pousse") {
            return Err("L'engrais n'est utile que sur une culture en pousse.".into());
        }
        let nom = self.bed_name(&key, i);
        let fin = entier_si_rond(self.minute() + MIN_PER_DAY);
        if a["engrais"] == "chimique" {
            self.pay(CHEM_PRICE as f64)?;
            let q = clamp(self.planche(&key, i)["qualite"].f() - 12.0);
            fusion(self.planche_mut(&key, i), json!({"engrais_jusqua": fin, "boost": 1.8, "chimique": true, "qualite": q}));
            self.s["dernier_chimique"] = self.s["minute"].clone();
            self.log(&format!("{nom} : engrais chimique (−{CHEM_PRICE} €). La récolte ne sera pas bio."), "info");
            return Ok(format!("{nom} : croissance ×1,8 pendant 24 h et +20 % de récolte, mais plus de bio."));
        }
        if self.s["stock"]["fumier"].f() < 50.0 {
            return Err("Il faut 50 kg de fumier (produit par les cochons).".into());
        }
        ajouter(&mut self.s["stock"]["fumier"], -50.0);
        let q = clamp(self.planche(&key, i)["qualite"].f() + 4.0);
        fusion(self.planche_mut(&key, i), json!({"engrais_jusqua": fin, "boost": 1.5, "qualite": q}));
        Ok(format!("{nom} fertilisée au fumier : croissance ×1,5 pendant 24 h, qualité en hausse."))
    }

    fn harvest_quality(&self, key: &str, i: usize) -> f64 {
        let f = self.champ(key);
        let b = &f["planches"][i];
        let robot = if self.has_tech("recolteur") { 3.0 } else { 0.0 };
        clamp(0.4 * b["sante"].f() + 0.6 * b["qualite"].f() + (if f["serre"].vrai() { 4.0 } else { 0.0 }) + robot)
    }

    fn harvest(&mut self, key: &str, i: usize, robot: bool) -> String {
        let c = self.planche(key, i)["culture"].t().to_string();
        let qty = rond(self.expected_yield(key, i));
        let q = self.harvest_quality(key, i);
        let chimique = self.planche(key, i)["chimique"].vrai();
        self.add(&c, qty as f64, q, if chimique { 0.0 } else { 1.0 });
        ajouter(&mut self.s["stats"]["recolte_kg"], qty as f64);
        ajouter_i(&mut self.s["stats"]["recoltes"], 1);
        let bio = if chimique { "" } else { ", bio" };
        fusion(self.planche_mut(key, i), empty_bed(false));
        let who = if robot { "Le robot a récolté" } else { "Récolte :" };
        let crop = &crops()[c.as_str()];
        let msg = format!("{qty} kg de {} (qualité {}{bio})", crop["nom"].t().to_lowercase(), quality_label(q).to_lowercase());
        let mut replant = String::new();
        if self.has_tech("semoir") {
            // le semoir autonome prépare le sol et ressème la même culture
            self.planche_mut(key, i)["sol_pret"] = json!(true);
            replant = match self.sow(key, i, &c) {
                Ok(()) => format!(" Le semoir a ressemé (−{} €).", crop["graines"].i()),
                Err(e) => format!(" Le semoir n'a pas pu ressemer : {}.", e.split(" :").next().unwrap_or("").to_lowercase()),
            };
        }
        let texte = format!("{who} {msg} sur la {}.{replant}", self.bed_name(key, i));
        self.log(&texte, "succes");
        format!("+{msg}.{replant}")
    }

    fn a_recolter(&mut self, a: &Value) -> R<String> {
        let (key, i) = self.bed_of(a)?;
        if self.planche(&key, i)["etat"] != "mur" {
            return Err("La récolte n'est pas encore prête.".into());
        }
        Ok(self.harvest(&key, i, false))
    }

    pub fn expected_yield(&self, key: &str, i: usize) -> f64 {
        let f = self.champ(key);
        let b = &f["planches"][i];
        let share = field_size(key) / f["planches"].l().len() as f64;
        crops()[b["culture"].t()]["rendement"].f() * share * (0.3 + 0.7 * b["sante"].f() / 100.0)
            * (if self.has("tracteur") { 1.2 } else { 1.0 })
            * (if b["chimique"].vrai() { 1.2 } else { 1.0 })
            * self.pollination()
            * (if self.mixed(key) { ASSOCIATION } else { 1.0 })
    }

    fn a_nourrir(&mut self, _a: &Value) -> R<String> {
        if self.n_animals() == 0 {
            return Err("Vous n'avez pas encore d'animaux : achetez vos premières bêtes dans l'élevage.".into());
        }
        self.feed(false)?;
        let h = self.hour();
        let slot = MEALS.iter().copied().find(|&m| m as f64 + MEAL_WINDOW.0 <= h && h < m as f64 + MEAL_WINDOW.1);
        if let Some(s) = slot {
            if !self.repas_fait(s) {
                arr(&mut self.s["repas"]["faits"]).push(json!(s));
            }
        }
        Ok(format!("Les animaux ont mangé{}", if self.s["repas_bio"].f() >= 0.99 { " (repas bio)." } else { "." }))
    }

    /// Les enclos visés par une action : une catégorie, ou tous ceux qui ont des bêtes.
    fn herds(&self, a: &Value) -> R<Vec<String>> {
        match a.get("categorie") {
            None | Some(Value::Null) => {
                let cats: Vec<String> =
                    entrees(&self.s["animaux"]).filter(|(_, g)| !g["liste"].l().is_empty()).map(|(c, _)| c.clone()).collect();
                if cats.is_empty() {
                    return Err("Vous n'avez pas encore d'animaux.".into());
                }
                Ok(cats)
            }
            Some(_) => {
                let cat = self.cat_of(a)?;
                if self.s["animaux"][cat.as_str()]["liste"].l().is_empty() {
                    return Err(format!("Vous n'avez pas de {}.", animals()[cat.as_str()]["nom"].t().to_lowercase()));
                }
                Ok(vec![cat])
            }
        }
    }

    /// Traire, ramasser les œufs, tondre… : ce qui attend dans l'enclos passe au stock.
    fn a_ramasser(&mut self, a: &Value) -> R<String> {
        let mut done = Vec::new();
        for cat in self.herds(a)? {
            let c = cat.as_str();
            let produit = animals()[c]["produit"].t();
            let g = &self.s["animaux"][c];
            let mut qty = g["a_ramasser"].f();
            if produit == "oeufs" {
                qty = qty.floor();
            }
            if qty <= 0.0 || (produit != "oeufs" && qty < 0.05) {
                continue;
            }
            let (q, bio) = (g["q_ramasser"].f(), g["bio_ramasser"].f());
            self.add(produit, qty, q, bio);
            ajouter(&mut self.s["animaux"][c]["a_ramasser"], -qty);
            let it = &items()[produit];
            let (unite, nom) = (it["unite"].t(), it["nom"].t().to_lowercase());
            done.push(if qty >= 10.0 || unite == "u" {
                format!("{qty:.0} {unite} de {nom}")
            } else {
                format!("{qty:.1} {unite} de {nom}").replace('.', ",")
            });
        }
        if done.is_empty() {
            return Err("Rien à ramasser pour l'instant : repassez un peu plus tard.".into());
        }
        Ok(format!("Ramassé : {}.", done.join(", ")))
    }

    /// Change la litière : l'enclos redevient propre, et le fumier part au tas.
    fn a_nettoyer(&mut self, a: &Value) -> R<String> {
        let (mut fumier, mut noms) = (0.0, Vec::new());
        for cat in self.herds(a)? {
            let c = cat.as_str();
            let g = &self.s["animaux"][c];
            let p = g["proprete"].f();
            if p > 95.0 {
                continue;
            }
            fumier += tab("FUMIER_NETTOYAGE")[c].f() * g["liste"].l().len() as f64 * (100.0 - p) / 100.0;
            self.s["animaux"][c]["proprete"] = json!(100.0);
            noms.push(tab("SOINS")[c]["enclos"].t());
        }
        if noms.is_empty() {
            return Err("C'est déjà tout propre.".into());
        }
        self.add("fumier", fumier, 70.0, 1.0);
        Ok(format!("{} : litière changée · +{fumier:.0} kg de fumier.", capitaliser(&noms.join(", "))))
    }

    /// Un câlin, un coup de brosse : l'animal (ou tout l'enclos) retrouve le moral.
    fn a_caliner(&mut self, a: &Value) -> R<String> {
        let cat = self.cat_of(a)?;
        let c = cat.as_str();
        let now = self.s["minute"].clone();
        let id = &a["id"];
        let par_id = id.vrai();
        let liste = self.s["animaux"][c]["liste"].l();
        let targets: Vec<usize> = (0..liste.len()).filter(|&j| !par_id || liste[j]["id"] == *id).collect();
        if targets.is_empty() {
            return Err(if par_id {
                "Animal introuvable.".to_string()
            } else {
                format!("Vous n'avez pas de {}.", animals()[c]["nom"].t().to_lowercase())
            });
        }
        let ready: Vec<usize> = targets.iter().copied().filter(|&j| now.f() - liste[j]["dernier_calin"].f() >= CALIN_PAUSE).collect();
        if ready.is_empty() {
            return Err(if targets.len() == 1 {
                format!("{} a eu sa dose de câlins, repassez dans un moment.", liste[targets[0]]["nom"].t())
            } else {
                "Ils ont tous eu leur dose de câlins, repassez dans un moment.".to_string()
            });
        }
        let premier = liste[ready[0]]["nom"].t().to_string();
        for &j in &ready {
            let x = &mut self.s["animaux"][c]["liste"][j];
            x["humeur"] = fl(clamp(x["humeur"].f() + CALIN));
            x["dernier_calin"] = now.clone();
        }
        let cri = match c {
            "vaches" => "meugle de plaisir 🐮",
            "poules" => "glousse de joie 🐔",
            "moutons" => "bêle tout content 🐑",
            _ => "grogne de bonheur 🐷",
        };
        if ready.len() == 1 {
            return Ok(format!("{premier} {cri}"));
        }
        Ok(format!("{} {} câlinés : tout le monde est ravi !", ready.len(), animals()[c]["nom"].t().to_lowercase()))
    }

    /// Sort le troupeau au pré (ou les poules dans la cour), ou le rentre.
    fn a_sortir(&mut self, a: &Value) -> R<String> {
        let dehors = a["dehors"].vrai();
        let cats: Vec<String> = self.herds(a)?.into_iter().filter(|c| self.s["animaux"][c.as_str()]["au_pre"].vrai() != dehors).collect();
        if cats.is_empty() {
            return Err((if dehors { "Ils sont déjà dehors." } else { "Ils sont déjà rentrés." }).to_string());
        }
        if dehors && self.s["meteo"]["type"] == "orage" {
            return Err("Il y a de l'orage : mieux vaut les garder à l'abri.".into());
        }
        for c in &cats {
            self.s["animaux"][c.as_str()]["au_pre"] = json!(dehors);
        }
        let noms = cats.iter().map(|c| animals()[c.as_str()]["nom"].t().to_lowercase()).collect::<Vec<_>>().join(" et ");
        if dehors {
            return Ok(format!("Les {noms} sont sortis : ils broutent et prennent l'air. Pensez à les rentrer le soir !"));
        }
        Ok(format!("Les {noms} sont rentrés pour la nuit."))
    }

    fn a_soigner(&mut self, _a: &Value) -> R<String> {
        let n = entrees(&self.s["animaux"]).flat_map(|(_, g)| g["liste"].l().iter()).filter(|x| x["sante"].f() < 50.0).count() as i64;
        if n == 0 {
            return Err("Aucun animal n'a besoin du vétérinaire.".into());
        }
        let cost = VET_PRICE * n;
        self.pay(cost as f64)?;
        for g in obj(&mut self.s["animaux"]).values_mut() {
            for x in arr(&mut g["liste"]) {
                if x["sante"].f() < 50.0 {
                    x["sante"] = json!(100.0);
                }
            }
        }
        self.log(&format!("Le vétérinaire a soigné {n} animal(aux) (−{cost} €)."), "info");
        Ok(format!("{n} animal(aux) soigné(s)."))
    }

    /// Vente en gros à un négociant, moins chère qu'au marché mais immédiate.
    fn a_vendre(&mut self, a: &Value) -> R<String> {
        let item = self.item_of(a)?;
        let it = &items()[item.as_str()];
        let buyer = &tab("BUYERS")[it["grossiste"].t()];
        if buyer["marche"].vrai() && !self.market_open() {
            return Err(format!(
                "{} n'est là que les jours de marché (mardi, jeudi, samedi, {} h – {} h).",
                capitaliser(buyer["nom"].t()),
                MARKET_HOURS.0,
                MARKET_HOURS.1
            ));
        }
        let have = self.s["stock"][item.as_str()].f();
        let mut qty = match a.get("quantite") {
            None | Some(Value::Null) => have,
            Some(Value::String(s)) if s == "tout" => have,
            Some(v) => flottant(v).ok_or("Quantité invalide.")?.min(have),
        };
        if item == "oeufs" {
            qty = qty.floor();
        }
        if !(qty > 0.0) {
            return Err("Rien à vendre.".into());
        }
        let gain = self.sell_wholesale(&item, qty);
        self.log(
            &format!("Vente en gros à {} : {qty:.0} {} de {} pour {gain:.0} €.", buyer["nom"].t(), it["unite"].t(), it["nom"].t().to_lowercase()),
            "succes",
        );
        Ok(format!("+{gain:.0} €"))
    }

    /// Règle un produit de votre étal : en vente ou non, et son prix (None = prix conseillé).
    fn a_etal(&mut self, a: &Value) -> R<String> {
        let item = self.item_of(a)?;
        let k = item.as_str();
        if let Some(v) = a.get("actif") {
            self.s["etal"][k]["actif"] = json!(v.vrai());
        }
        if let Some(p) = a.get("prix") {
            if p.is_null() {
                self.s["etal"][k]["prix"] = Value::Null;
            } else {
                let p = rond_n(flottant(p).ok_or("Prix hors limites.")?, 2);
                if !(0.01 <= p && p <= 5.0 * self.fair_price(k) + 1.0) {
                    return Err("Prix hors limites.".into());
                }
                self.s["etal"][k]["prix"] = fl(p);
            }
        }
        let it = &items()[k];
        let nom = it["nom"].t();
        if !self.s["etal"][k]["actif"].vrai() {
            return Ok(format!("{nom} retirés de l'étal."));
        }
        let conseille = if self.s["etal"][k]["prix"].is_null() { " (prix conseillé)" } else { "" };
        Ok(format!("{nom} : {:.2} €/{}", self.stall_price(k), it["unite"].t()).replace('.', ",") + conseille)
    }

    fn a_collecte(&mut self, a: &Value) -> R<String> {
        let actif = a["actif"].vrai();
        self.s["collecte_lait"] = json!(actif);
        Ok((if actif { "Collecte du lait chaque soir à 20 h." } else { "Collecte du lait arrêtée : vendez-le vous-même." }).to_string())
    }

    fn a_acheter(&mut self, a: &Value) -> R<String> {
        let item = a["article"].as_str().unwrap_or("").to_string();
        let qty = entier(a.get("quantite"), 1).ok_or("Quantité invalide.")?;
        if qty <= 0 {
            return Err("Quantité invalide.".into());
        }
        if item == "foin" || item == "foin_bio" {
            let bio = item == "foin_bio";
            self.pay(qty as f64 * (if bio { FEED_BIO_PRICE } else { FEED_PRICE }))?;
            ajouter(&mut self.s["stock"][item.as_str()], qty as f64);
            return Ok(format!("+{qty} kg de foin{}.", if bio { " bio" } else { "" }));
        }
        if let Some(info) = animals().get(item.as_str()) {
            self.pay(qty as f64 * info["prix"].f())?;
            for _ in 0..qty {
                let grp = &mut self.s["animaux"][item.as_str()];
                let i = grp["prochain_id"].i();
                grp["prochain_id"] = json!(i + 1);
                arr(&mut grp["liste"]).push(new_animal(&item, i));
            }
            self.log(&format!("Achat de {qty} {}(s).", info["unite"].t()), "info");
            return Ok(format!("+{qty} {}(s).", info["unite"].t()));
        }
        Err("Article inconnu.".into())
    }

    /// Vend un animal au marché aux bestiaux : celui demandé, sinon le moins en forme.
    fn a_vendre_animal(&mut self, a: &Value) -> R<String> {
        let cat = self.cat_of(a)?;
        let c = cat.as_str();
        let info = &animals()[c];
        let liste = self.s["animaux"][c]["liste"].l();
        if liste.is_empty() {
            return Err(format!("Vous n'avez plus de {}.", info["nom"].t().to_lowercase()));
        }
        let j = if a["id"].vrai() {
            liste.iter().position(|x| x["id"] == a["id"]).ok_or("Animal introuvable.")?
        } else {
            let mut k = 0;
            for (j, x) in liste.iter().enumerate() {
                if x["sante"].f() < liste[k]["sante"].f() {
                    k = j;
                }
            }
            k
        };
        let price = animal_price(c, &liste[j]);
        let animal = arr(&mut self.s["animaux"][c]["liste"]).remove(j);
        ajouter(&mut self.s["argent"], price as f64);
        self.log(&format!("{} ({}) vendu(e) au marché aux bestiaux pour {price} €.", animal["nom"].t(), info["unite"].t()), "info");
        Ok(format!("{} vendu(e) : +{price} €", animal["nom"].t()))
    }

    fn a_ameliorer(&mut self, a: &Value) -> R<String> {
        let up = match a["amelioration"].as_str() {
            Some(u) if tab("UPGRADES").contains_key(u) => u.to_string(),
            _ => return Err("Amélioration inconnue.".into()),
        };
        if self.has(&up) {
            return Err("Déjà acheté.".into());
        }
        let info = &tab("UPGRADES")[up.as_str()];
        self.pay(info["prix"].f())?;
        arr(&mut self.s["ameliorations"]).push(json!(up));
        if up == "reservoir" {
            ajouter(&mut self.s["reservoir"]["capacite"], 4000.0);
        }
        self.log(&format!("Nouvelle amélioration : {} !", info["nom"].t()), "succes");
        Ok(format!("{} installé.", info["nom"].t()))
    }

    fn a_construire(&mut self, a: &Value) -> R<String> {
        let b = a["batiment"].as_str().unwrap_or("");
        if b == "eolienne" || b == "ruche" {
            let info = &tab("BUILDINGS")[b];
            let key = if b == "eolienne" { "eoliennes" } else { "ruches" };
            if self.s[key].i() >= info["max"].i() {
                return Err(format!("Pas de place pour plus de {} {}s.", info["max"].i(), info["nom"].t().to_lowercase()));
            }
            self.pay(info["prix"].f())?;
            ajouter_i(&mut self.s[key], 1);
            let ou = if b == "eolienne" { "près de la maison" } else { "au bord du jardin" };
            let msg = format!("{} n°{} installée {ou} !", info["nom"].t(), self.s[key].i());
            self.log(&msg, "succes");
            return Ok(format!("{} installée.", info["nom"].t()));
        }
        if b == "atelier" {
            if self.s["atelier"]["construit"].vrai() {
                return Err("L'atelier est déjà construit.".into());
            }
            let at = tab("ATELIER");
            self.pay(at["prix"].f())?;
            self.s["atelier"]["construit"] = json!(true);
            self.log(
                &format!(
                    "L'atelier de transformation est construit à côté du réservoir ! Installez-y du matériel (entretien {} €/jour).",
                    at["entretien"].i()
                ),
                "succes",
            );
            return Ok("Atelier construit.".into());
        }
        if b == "serre" {
            let info = &tab("BUILDINGS")["serre"];
            let key = self.field_of(a)?;
            if !self.serre_unlocked() {
                return Err(format!(
                    "Serres débloquées après {} € de ventes ({:.0} € pour l'instant).",
                    info["ventes_requises"].i(),
                    self.s["stats"]["ventes"].f()
                ));
            }
            if self.champ(&key)["serre"].vrai() {
                return Err("Cette parcelle est déjà sous serre.".into());
            }
            if self.champ(&key)["planches"].l().iter().any(|p| !matches!(p["etat"].t(), "vide" | "fletri")) {
                return Err("Récoltez d'abord : la parcelle doit être libre pour construire.".into());
            }
            self.pay(info["prix"].f())?;
            let nbp = self.champ(&key)["planches"].l().len();
            self.s["champs"][key.as_str()]["serre"] = json!(true);
            self.s["champs"][key.as_str()]["planches"] = Value::Array((0..nbp).map(|_| empty_bed(true)).collect());
            let nom = self.field_name(&key);
            self.log(&format!("{nom} construite ! Melons et poivrons y poussent."), "succes");
            return Ok(format!("{nom} construite."));
        }
        Err("Construction inconnue.".into())
    }

    /// Agrandit la ferme : le prochain terrain à vendre devient une parcelle libre.
    fn a_acheter_parcelle(&mut self, _a: &Value) -> R<String> {
        let (key, prix) = self.next_field().ok_or("Il n'y a plus de terrain à vendre autour de la ferme.")?;
        self.pay(prix as f64)?;
        self.s["champs"][key.as_str()] = empty_field(60.0, 1, false);
        self.log(
            &format!(
                "Nouveau terrain acheté : la {} est prête à être semée (−{} €, {EXTRA_FIELD_UPKEEP} €/jour d'entretien).",
                field_label(&key),
                milliers(prix)
            ),
            "succes",
        );
        Ok(format!("{} achetée !", field_label(&key)))
    }

    fn a_technologie(&mut self, a: &Value) -> R<String> {
        let t = match a["tech"].as_str() {
            Some(t) if tab("TECH").contains_key(t) => t.to_string(),
            _ => return Err("Technologie inconnue.".into()),
        };
        if self.s["technologies"].l().iter().any(|x| x.t() == t) {
            return Err("Déjà acheté.".into());
        }
        let info = &tab("TECH")[t.as_str()];
        self.pay(info["prix"].f())?;
        arr(&mut self.s["technologies"]).push(json!(t));
        self.log(&format!("Nouvelle technologie : {} ! Entretien {} €/jour.", info["nom"].t(), info["entretien"].i()), "succes");
        Ok(format!("{} en service.", info["nom"].t()))
    }

    fn a_vitesse(&mut self, a: &Value) -> R<String> {
        let v = &a["valeur"];
        if !(v.is_number() && [0.0, 1.0, 2.0, 4.0, 8.0].contains(&v.f())) {
            return Err("Vitesse invalide.".into());
        }
        let v = v.f() as i64;
        self.s["vitesse"] = json!(v);
        Ok(if v == 0 { "Pause".to_string() } else { format!("Vitesse ×{v}") })
    }

    /// Menu principal : le temps s'arrête tant qu'il est ouvert, puis reprend à la même vitesse.
    fn a_menu(&mut self, a: &Value) -> R<String> {
        if a["ouvert"].vrai() {
            if !self.s["menu"].vrai() {
                let v = self.s["vitesse"].clone();
                self.s["vitesse_menu"] = if v.vrai() { v } else { json!(1) };
            }
            self.s["menu"] = json!(true);
            self.s["vitesse"] = json!(0);
            return Ok("Menu principal".into());
        }
        if self.s["menu"].vrai() {
            self.s["menu"] = json!(false);
            let v = self.s["vitesse_menu"].clone();
            self.s["vitesse"] = if v.vrai() { v } else { json!(1) };
        }
        Ok("C'est reparti !".into())
    }

    fn a_nouvelle_partie(&mut self, a: &Value) -> R<String> {
        let mode = match a.get("mode") {
            None => "classique",
            Some(v) => v.as_str().unwrap_or(""),
        };
        if !tab("MODES").contains_key(mode) {
            return Err("Mode de jeu inconnu.".into());
        }
        self.s = Game::new_state(None, mode);
        Ok((if mode == "libre" { "Nouvelle partie en mode libre !" } else { "Nouvelle partie !" }).to_string())
    }

    fn pay(&mut self, cost: f64) -> R<()> {
        if self.s["argent"].f() < cost {
            return Err(format!("Fonds insuffisants ({cost:.0} € nécessaires)."));
        }
        ajouter(&mut self.s["argent"], -cost);
        Ok(())
    }

    // -------- atelier de transformation --------
    /// Nombre de lots qu'on peut lancer maintenant avec le stock (sans dépasser la capacité de la machine).
    pub fn max_lots(&self, r: &str) -> i64 {
        let rec = &tab("RECETTES")[r];
        let mut n = tab("EQUIPEMENTS")[rec["equipement"].t()]["capacite"].i();
        for (item, q) in entrees(&rec["entrees"]) {
            n = n.min((fdiv(self.s["stock"][item.as_str()].f(), q.f()) + 1e-9) as i64);
        }
        n.max(0)
    }

    fn start_batch(&mut self, eq: &str, r: &str, lots: i64) -> R<String> {
        let rec = &tab("RECETTES")[r];
        let eqi = &tab("EQUIPEMENTS")[eq];
        if self.s["atelier"]["equipements"][eq]["lot"].vrai() {
            return Err(format!("{} : une fournée est déjà en cours.", eqi["nom"].t()));
        }
        let ent = rec["entrees"].as_object().expect("entrées de recette");
        if lots < 1 {
            let manque: Vec<String> = ent
                .iter()
                .filter(|(i, q)| self.s["stock"][i.as_str()].f() < q.f())
                .map(|(i, _)| items()[i.as_str()]["nom"].t().to_lowercase())
                .collect();
            let manque = manque.join(" ni de ");
            return Err(format!(
                "Pas assez de {} pour une fournée de {}.",
                if manque.is_empty() { "matière première" } else { manque.as_str() },
                rec["nom"].t().to_lowercase()
            ));
        }
        // qualité et part bio : moyenne des ingrédients, pondérée par leur valeur
        let poids: Vec<(&String, f64)> = ent.iter().map(|(i, q)| (i, q.f() * lots as f64 * items()[i.as_str()]["prix"].f())).collect();
        let somme: f64 = poids.iter().map(|(_, w)| w).sum();
        let tot = if somme != 0.0 { somme } else { 1.0 };
        let q_in = poids.iter().map(|(i, w)| self.s["qualite"][i.as_str()].f() * w).sum::<f64>() / tot;
        let bio = poids.iter().map(|(i, w)| self.s["bio"][i.as_str()].f() * w).sum::<f64>() / tot;
        for (i, q) in ent {
            let v = 0.0f64.max(self.s["stock"][i.as_str()].f() - q.f() * lots as f64);
            self.s["stock"][i.as_str()] = fl(v);
        }
        let qty = rec["sortie"].f() * lots as f64;
        let lot = json!({"recette": r, "qte": qty, "q": clamp(q_in + ATELIER_QUALITE), "bio": bio,
                         "debut": self.s["minute"], "fin": entier_si_rond(self.minute() + rec["duree"].f())});
        fusion(&mut self.s["atelier"]["equipements"][eq], json!({"recette": r, "lot": lot}));
        Ok(format!(
            "{} : {} kg de {} en préparation ({} h).",
            eqi["nom"].t(),
            qf_txt(qty),
            rec["nom"].t().to_lowercase(),
            rec["duree"].i() / 60
        ))
    }

    fn workshop_tick(&mut self) {
        for eq in cles(&self.s["atelier"]["equipements"]) {
            let e = eq.as_str();
            let lot = self.s["atelier"]["equipements"][e]["lot"].clone();
            if !lot.vrai() || lot["fin"].f() > self.minute() {
                continue;
            }
            let r = lot["recette"].t().to_string();
            self.add(&r, lot["qte"].f(), lot["q"].f(), lot["bio"].f());
            self.s["atelier"]["equipements"][e]["lot"] = Value::Null;
            ajouter_i(&mut self.s["stats"]["transformations"], 1);
            ajouter(&mut self.s["stats"]["production_jour"][r.as_str()], lot["qte"].f());
            let mut again = "";
            if self.s["atelier"]["equipements"][e]["auto"].vrai() {
                let lots = self.max_lots(&r);
                again = match self.start_batch(e, &r, lots) {
                    Ok(_) => " Nouvelle fournée lancée.",
                    Err(_) => " Plus assez d'ingrédients pour relancer.",
                };
            }
            let msg = format!(
                "Atelier : {} kg de {} prêts (qualité {}{}).{again}",
                qf_txt(lot["qte"].f()),
                tab("RECETTES")[r.as_str()]["nom"].t().to_lowercase(),
                quality_label(lot["q"].f()).to_lowercase(),
                if lot["bio"].f() >= 0.95 { ", bio" } else { "" }
            );
            self.log(&msg, "succes");
            self.update_objectives();
        }
    }

    /// Achète une machine pour l'atelier (le bâtiment doit être construit).
    fn a_equiper(&mut self, a: &Value) -> R<String> {
        let eq = match a["equipement"].as_str() {
            Some(e) if tab("EQUIPEMENTS").contains_key(e) => e.to_string(),
            _ => return Err("Matériel inconnu.".into()),
        };
        if !self.s["atelier"]["construit"].vrai() {
            return Err("Construisez d'abord l'atelier de transformation.".into());
        }
        if self.s["atelier"]["equipements"].get(eq.as_str()).is_some() {
            return Err("Déjà installé.".into());
        }
        let info = &tab("EQUIPEMENTS")[eq.as_str()];
        self.pay(info["prix"].f())?;
        self.s["atelier"]["equipements"][eq.as_str()] = json!({"lot": null, "auto": false, "recette": null});
        let recettes =
            entrees(d("RECETTES")).filter(|(_, r)| r["equipement"] == eq.as_str()).map(|(_, r)| r["nom"].t().to_lowercase()).collect::<Vec<_>>().join(", ");
        self.log(&format!("Atelier : {} installé ({recettes}). Entretien {} €/jour.", info["nom"].t().to_lowercase(), info["entretien"].i()), "succes");
        Ok(format!("{} installé.", info["nom"].t()))
    }

    /// Lance une fournée : `lots` (nombre) ou « max » pour tout ce que la machine peut prendre.
    fn a_transformer(&mut self, a: &Value) -> R<String> {
        let r = match a["recette"].as_str() {
            Some(r) if tab("RECETTES").contains_key(r) => r.to_string(),
            _ => return Err("Recette inconnue.".into()),
        };
        let eq = tab("RECETTES")[r.as_str()]["equipement"].t();
        let eqi = &tab("EQUIPEMENTS")[eq];
        if self.s["atelier"]["equipements"].get(eq).is_none() {
            return Err(format!("Il faut d'abord installer : {}.", eqi["nom"].t().to_lowercase()));
        }
        let cap = eqi["capacite"].i();
        let lots = match a.get("lots") {
            None => self.max_lots(&r),
            Some(Value::String(s)) if s == "max" => self.max_lots(&r),
            Some(v) => {
                let lots = entier(Some(v), 0).ok_or("Nombre de lots invalide.")?;
                if lots > cap {
                    return Err(format!("La machine prend au plus {cap} lots."));
                }
                let ml = self.max_lots(&r);
                if lots > ml {
                    if ml != 0 {
                        return Err("Pas assez d'ingrédients pour autant de lots.".into());
                    }
                    0
                } else {
                    lots
                }
            }
        };
        self.start_batch(eq, &r, lots)
    }

    /// Relance automatiquement la même recette à la fin de chaque fournée.
    fn a_atelier_auto(&mut self, a: &Value) -> R<String> {
        let eq = a["equipement"].as_str().unwrap_or("");
        if self.s["atelier"]["equipements"].get(eq).is_none() {
            return Err("Matériel non installé.".into());
        }
        let auto = a["actif"].vrai();
        self.s["atelier"]["equipements"][eq]["auto"] = json!(auto);
        let nom = tab("EQUIPEMENTS")[eq]["nom"].t();
        Ok(if auto { format!("{nom} : relance automatique.") } else { format!("{nom} : relance manuelle.") })
    }

    // -------- commandes de clients --------
    /// Ce que la ferme peut raisonnablement fournir en ce moment.
    pub fn order_candidates(&self) -> Vec<String> {
        let mut out = Vec::new();
        let serre = self.n_serres() > 0;
        for (c, crop) in crops() {
            let s = crop["serre"].vrai();
            if (s && serre) || (!s && (self.in_season(c, None) || serre)) {
                out.push(c.clone());
            }
        }
        for (cat, g) in entrees(&self.s["animaux"]) {
            if !g["liste"].l().is_empty() {
                let p = animals()[cat.as_str()]["produit"].t();
                if p != "fumier" {
                    out.push(p.to_string());
                }
            }
        }
        if self.s["ruches"].vrai() {
            out.push("miel".into());
        }
        for (r, rec) in tab("RECETTES") {
            if self.s["atelier"]["equipements"].get(rec["equipement"].t()).is_some() {
                out.push(r.clone());
            }
        }
        out
    }

    pub fn new_order(&mut self, rng: &mut Random) {
        let cands = self.order_candidates();
        if cands.is_empty() {
            return;
        }
        let item = cands[rng.choice_i(cands.len())].clone();
        let (lo, hi, step) = if let Some(c) = crops().get(item.as_str()) {
            let y = c["rendement"].f();
            let lo = rond_dizaine(y * 0.15);
            (if lo != 0.0 { lo } else { 10.0 }, rond_dizaine(y * 0.45), 10.0)
        } else {
            let t = if items()[item.as_str()]["transforme"].vrai() { d("COMMANDE_QTE_TRANSFO").l() } else { d("COMMANDE_QTE")[item.as_str()].l() };
            (t[0].f(), t[1].f(), t[2].f())
        };
        let qty = (rng.uniform(lo, hi) / step).round_ties_even() * step;
        let qty = step.max(qty);
        let qmin = [0, 0, 50, 70][rng.choice_i(4)];
        let bio = rng.random() < 0.3;
        let mult = 1.3 + (if qmin >= 50 { 0.15 } else { 0.0 }) + (if qmin >= 70 { 0.15 } else { 0.0 }) + (if bio { 0.25 } else { 0.0 });
        let prix = 5i64.max(rond(qty * self.season_price(&item) * mult / 5.0) * 5);
        let delai = rng.randint(2, 5);
        let clients = d("CLIENTS").l();
        let cl = clients[rng.choice_i(clients.len())].l();
        let (client, emo) = (cl[0].t(), cl[1].t());
        let day = self.day();
        let o = json!({"id": self.s["prochaine_commande"], "client": client, "emoji": emo, "produit": item, "qte": entier_si_rond(qty),
                       "qmin": qmin, "bio": bio, "prix": prix, "recue": day,
                       "echeance": (day - 1 + delai) * 1440 + 20 * 60});
        ajouter_i(&mut self.s["prochaine_commande"], 1);
        arr(&mut self.s["commandes"]).push(o);
        let jour = JOURS[(self.weekday() + delai).rem_euclid(7) as usize].to_lowercase();
        let it = &items()[item.as_str()];
        let msg = format!(
            "Nouvelle commande de {client} : {} {} de {}{} pour {prix} €, à livrer avant {jour} 20 h.",
            qf_txt(qty),
            it["unite"].t(),
            it["nom"].t().to_lowercase(),
            if bio { " bio" } else { "" }
        );
        self.log(&msg, "succes");
    }

    /// Pourquoi on ne peut pas (encore) livrer cette commande, ou None si c'est possible.
    fn order_problem(&self, o: &Value) -> Option<String> {
        let item = o["produit"].t();
        let have = self.s["stock"][item].f();
        if have + 1e-9 < o["qte"].f() {
            return Some(format!("Il manque {} {}", qf_txt(o["qte"].f() - have), items()[item]["unite"].t()));
        }
        if self.s["qualite"][item].f() < o["qmin"].f() {
            return Some(format!("Qualité insuffisante ({}/100, il faut {})", rond(self.s["qualite"][item].f()), o["qmin"].i()));
        }
        if o["bio"].vrai() && self.s["bio"][item].f() < 0.95 {
            return Some("Le client veut du bio".into());
        }
        None
    }

    fn order_index(&self, a: &Value) -> R<usize> {
        self.s["commandes"].l().iter().position(|x| meme(&x["id"], &a["id"])).ok_or_else(|| "Commande introuvable.".to_string())
    }

    fn a_livrer(&mut self, a: &Value) -> R<String> {
        let j = self.order_index(a)?;
        let o = self.s["commandes"][j].clone();
        if let Some(pb) = self.order_problem(&o) {
            return Err(format!("Impossible de livrer {} : {}.", o["client"].t(), minuscule_initiale(&pb)));
        }
        let item = o["produit"].t();
        let q = self.s["qualite"][item].f();
        ajouter(&mut self.s["stock"][item], -o["qte"].f());
        ajouter(&mut self.s["argent"], o["prix"].f());
        ajouter(&mut self.s["stats"]["ventes"], o["prix"].f());
        ajouter_i(&mut self.s["stats"]["commandes"], 1);
        arr(&mut self.s["commandes"]).remove(j);
        let bonus = if q >= 85.0 { 4 } else { 3 };
        let r = clamp(self.s["reputation"].f() + bonus as f64);
        self.s["reputation"] = fl(r);
        self.log(&format!("Commande livrée à {} : +{} €. Le client est ravi (réputation +{bonus}).", o["client"].t(), o["prix"].i()), "succes");
        Ok(format!("Livré ! +{} €", o["prix"].i()))
    }

    fn a_refuser(&mut self, a: &Value) -> R<String> {
        let j = self.order_index(a)?;
        let o = arr(&mut self.s["commandes"]).remove(j);
        let r = clamp(self.s["reputation"].f() - 1.0);
        self.s["reputation"] = fl(r);
        Ok(format!("Commande de {} refusée (réputation −1).", o["client"].t()))
    }

    fn check_orders(&mut self) {
        let minute = self.minute();
        let (expirees, restantes): (Vec<Value>, Vec<Value>) = self.s["commandes"].l().iter().cloned().partition(|o| o["echeance"].f() <= minute);
        if expirees.is_empty() {
            return;
        }
        self.s["commandes"] = Value::Array(restantes);
        for o in expirees {
            ajouter_i(&mut self.s["stats"]["commandes_ratees"], 1);
            let r = clamp(self.s["reputation"].f() - 5.0);
            self.s["reputation"] = fl(r);
            let it = &items()[o["produit"].t()];
            self.log(
                &format!(
                    "Commande non livrée : {} attendait {} {} de {}. Réputation −5.",
                    o["client"].t(),
                    qf_txt(o["qte"].f()),
                    it["unite"].t(),
                    it["nom"].t().to_lowercase()
                ),
                "alerte",
            );
        }
    }

    // -------- événements aléatoires --------
    fn event(&mut self, emoji: &str, titre: &str, texte: &str, bon: Option<bool>) {
        let genre = match bon {
            Some(true) => "bon",
            Some(false) => "mauvais",
            None => "info",
        };
        let e = json!({"jour": self.day(), "emoji": emoji, "titre": titre, "texte": texte, "type": genre});
        let ev = arr(&mut self.s["evenements"]);
        ev.insert(0, e);
        ev.truncate(12);
        let kind = match bon {
            Some(true) => "succes",
            Some(false) => "alerte",
            None => "info",
        };
        self.log(&format!("{emoji} {titre} : {texte}"), kind);
    }

    /// Minute de fin du prochain marché (aujourd'hui s'il n'est pas encore fini).
    pub fn next_market_end(&self) -> f64 {
        for dd in 0..8 {
            let wd = (self.weekday() + dd) % 7;
            if MARKET_DAYS.contains(&wd) && (dd > 0 || self.hour() < MARKET_HOURS.1 as f64) {
                return ((self.day() - 1 + dd) * 1440 + MARKET_HOURS.1 * 60) as f64;
            }
        }
        self.minute() + MIN_PER_DAY
    }

    pub fn random_event(&mut self, rng: &mut Random) {
        let mut open_beds: Vec<(String, usize)> = Vec::new();
        for (k, f) in entrees(&self.s["champs"]) {
            if f["serre"].vrai() {
                continue;
            }
            for (i, b) in f["planches"].l().iter().enumerate() {
                if actif(b) {
                    open_beds.push((k.clone(), i));
                }
            }
        }
        let fragile: Vec<(String, usize)> =
            open_beds.iter().filter(|(k, i)| !crops()[self.planche(k, *i)["culture"].t()]["rustique"].vrai()).cloned().collect();
        let n_animaux = self.n_animals();
        let stock_ok: Vec<&'static String> =
            items().keys().filter(|k| k.as_str() != "fumier" && self.s["stock"][k.as_str()].f() >= min_unit(k)).collect();
        let saison = self.saison();
        let ruches = self.s["ruches"].i();
        let pannes = self.broken();
        let panne_possible = self.s["technologies"].l().iter().any(|t| !pannes.iter().any(|p| p == t.t()));
        let choix = [
            ("subvention", 5.0, true),
            ("voisin", 5.0, n_animaux > 0),
            ("essaim", 3.0, 1 <= ruches && ruches < tab("BUILDINGS")["ruche"]["max"].i() && (saison == "printemps" || saison == "ete")),
            ("grele", 5.0, !open_beds.is_empty() && (saison == "printemps" || saison == "ete")),
            ("sangliers", 5.0, !open_beds.is_empty() && (saison == "ete" || saison == "automne")),
            ("gelee", 6.0, !fragile.is_empty() && (saison == "printemps" || saison == "automne")),
            ("fuite", 3.0, self.s["reservoir"]["niveau"].f() > 2000.0),
            ("panne", 4.0, panne_possible),
            ("controle", 3.0, self.day() >= 5),
            ("blogueuse", 5.0, true),
            ("foire", 4.0, true),
            ("concours", 4.0, !stock_ok.is_empty()),
            ("ecole", 4.0, n_animaux >= 4),
            ("vaccins", 3.0, n_animaux >= 3),
            ("abondance", 4.0, true),
        ];
        let ok: Vec<(&str, f64)> = choix.iter().filter(|c| c.2).map(|c| (c.0, c.1)).collect();
        let poids: Vec<f64> = ok.iter().map(|c| c.1).collect();
        let quoi = ok[rng.choices_w(&poids, 1)[0]].0;
        let minute = self.minute();
        match quoi {
            "subvention" => {
                let gain = rng.randrange_pas(300, 750, 50);
                ajouter(&mut self.s["argent"], gain as f64);
                self.event("🏛️", "Subvention", &format!("la région soutient les petites fermes : +{gain} € sur votre compte."), Some(true));
            }
            "voisin" => {
                ajouter(&mut self.s["stock"]["foin"], 300.0);
                self.event("🤝", "Coup de main", "Henri, le voisin, vous dépose 300 kg de foin pour vous remercier.", Some(true));
            }
            "essaim" => {
                ajouter_i(&mut self.s["ruches"], 1);
                let n = self.s["ruches"].i();
                self.event(
                    "🐝",
                    "Essaim sauvage",
                    &format!("un essaim s'est posé près du jardin : vous l'installez dans une ruche (ruche n°{n}, gratuite)."),
                    Some(true),
                );
            }
            "grele" => {
                let mut ks: Vec<&String> = open_beds.iter().map(|(k, _)| k).collect();
                ks.sort();
                ks.dedup();
                let k = ks[rng.choice_i(ks.len())].clone();
                for (kk, i) in &open_beds {
                    if *kk == k {
                        let b = self.planche_mut(kk, *i);
                        b["sante"] = fl(clamp(b["sante"].f() - 20.0));
                        b["qualite"] = fl(clamp(b["qualite"].f() - 10.0));
                    }
                }
                let texte = format!("une averse de grêle hache les plants de la {} (−20 % de santé).", self.field_name(&k));
                self.event("🧊", "Grêle", &texte, Some(false));
            }
            "sangliers" => {
                let (k, i) = open_beds[rng.choice_i(open_beds.len())].clone();
                if self.has("cloture") {
                    self.event("🐗", "Sangliers", "une harde rôde autour de la ferme, mais la clôture renforcée les arrête.", None);
                    return;
                }
                let b = self.planche_mut(&k, i);
                b["sante"] = fl(clamp(b["sante"].f() - 45.0));
                let texte = format!(
                    "ils ont retourné la {} cette nuit (−45 % de santé). Une clôture renforcée les tiendrait à distance.",
                    self.bed_name(&k, i)
                );
                self.event("🐗", "Sangliers", &texte, Some(false));
            }
            "gelee" => {
                for (k, i) in &fragile {
                    let b = self.planche_mut(k, *i);
                    b["sante"] = fl(clamp(b["sante"].f() - 15.0));
                    b["qualite"] = fl(clamp(b["qualite"].f() - 8.0));
                }
                self.event("🥶", "Gelée blanche", "une nuit glaciale a abîmé les cultures fragiles en plein champ (−15 % de santé).", Some(false));
            }
            "fuite" => {
                let perte = rond(self.s["reservoir"]["niveau"].f() * 0.3);
                ajouter(&mut self.s["reservoir"]["niveau"], -(perte as f64));
                self.event("💧", "Fuite au réservoir", &format!("{perte} L perdus avant que le plombier ne répare."), Some(false));
            }
            "panne" => {
                let techs = self.s["technologies"].l();
                let t = techs[rng.choice_i(techs.len())].t().to_string();
                let nom = tab("TECH")[t.as_str()]["nom"].t();
                let e = json!({"id": "panne", "tech": t, "nom": format!("{nom} en panne"), "emoji": "🔧", "fin": entier_si_rond(minute + MIN_PER_DAY)});
                arr(&mut self.s["effets"]).push(e);
                self.event(
                    "🔧",
                    "Panne",
                    &format!("{} est en panne : il reste à l'arrêt 24 h, le temps de la réparation.", nom.to_lowercase()),
                    Some(false),
                );
            }
            "controle" => {
                if minute - self.s["dernier_chimique"].f() < 7.0 * MIN_PER_DAY {
                    ajouter(&mut self.s["argent"], -150.0);
                    let r = clamp(self.s["reputation"].f() - 6.0);
                    self.s["reputation"] = fl(r);
                    self.event(
                        "📋",
                        "Contrôle bio",
                        "l'inspecteur a trouvé des traces de produits chimiques récents : 150 € d'amende et réputation −6.",
                        Some(false),
                    );
                } else {
                    let r = clamp(self.s["reputation"].f() + 5.0);
                    self.s["reputation"] = fl(r);
                    self.event("📋", "Contrôle bio", "aucun produit chimique depuis une semaine : votre label est confirmé (réputation +5).", Some(true));
                }
            }
            "blogueuse" => {
                let e = json!({"id": "affluence", "nom": "Une blogueuse parle de vous", "emoji": "📸", "clients": 1.5,
                               "fin": entier_si_rond(self.next_market_end())});
                arr(&mut self.s["effets"]).push(e);
                self.event("📸", "Blogueuse culinaire", "elle a vanté votre étal : beaucoup plus de clients au prochain marché.", Some(true));
            }
            "foire" => {
                let e = json!({"id": "foire", "nom": "Foire agricole", "emoji": "🎪", "clients": 1.3, "prix": 1.15,
                               "fin": entier_si_rond(self.next_market_end())});
                arr(&mut self.s["effets"]).push(e);
                self.event(
                    "🎪",
                    "Foire agricole",
                    "elle se tient au prochain marché : plus de monde, et les clients acceptent de payer 15 % plus cher.",
                    Some(true),
                );
            }
            "concours" => {
                let mut best = stock_ok[0].as_str();
                for k in &stock_ok {
                    if self.s["qualite"][k.as_str()].f() > self.s["qualite"][best].f() {
                        best = k.as_str();
                    }
                }
                let nom = items()[best]["nom"].t().to_lowercase();
                if self.s["qualite"][best].f() >= 85.0 {
                    let prix = rng.randrange_pas(200, 450, 50);
                    ajouter(&mut self.s["argent"], prix as f64);
                    let r = clamp(self.s["reputation"].f() + 4.0);
                    self.s["reputation"] = fl(r);
                    self.event("🏅", "Concours agricole", &format!("vos {nom} remportent le premier prix : +{prix} € et réputation +4."), Some(true));
                } else {
                    self.event(
                        "🏅",
                        "Concours agricole",
                        &format!("vos {nom} sont jugés honnêtes, mais pas de prix cette fois (il faut une qualité excellente)."),
                        None,
                    );
                }
            }
            "ecole" => {
                for g in obj(&mut self.s["animaux"]).values_mut() {
                    for x in arr(&mut g["liste"]) {
                        x["humeur"] = fl(clamp(x["humeur"].f() + 15.0));
                    }
                }
                let r = clamp(self.s["reputation"].f() + 3.0);
                self.s["reputation"] = fl(r);
                self.event(
                    "🏫",
                    "Visite d'école",
                    "une classe vient voir les animaux : les bêtes adorent les caresses (humeur +15) et on parle de vous au village (réputation +3).",
                    Some(true),
                );
            }
            "vaccins" => {
                for g in obj(&mut self.s["animaux"]).values_mut() {
                    for x in arr(&mut g["liste"]) {
                        x["sante"] = json!(100.0);
                    }
                }
                self.event("💉", "Campagne de vaccination", "le vétérinaire passe gratuitement : tout le troupeau est en pleine forme.", Some(true));
            }
            _ => {
                // abondance
                let cs: Vec<&'static String> = crops().keys().filter(|c| self.in_season(c, None)).collect();
                let c = cs[rng.choice_i(cs.len())].as_str();
                let p = rond_n(self.s["prix"][c].f() * 0.65, 3);
                self.s["prix"][c] = fl(p);
                self.event(
                    "📉",
                    "Récolte record chez les voisins",
                    &format!("le cours des {} chute de 35 %.", crops()[c]["nom"].t().to_lowercase()),
                    Some(false),
                );
            }
        }
    }

    /// Après la victoire : on garde la ferme et on continue en mode libre.
    fn a_continuer(&mut self, _a: &Value) -> R<String> {
        if self.s["statut"] != "gagne" {
            return Err("La partie n'est pas gagnée.".into());
        }
        self.s["statut"] = json!("en_cours");
        self.s["mode"] = json!("libre");
        self.log("La ferme continue en mode libre : plus d'objectif d'argent, faites-la grandir comme vous voulez !", "succes");
        self.a_menu(&json!({"ouvert": false}))
    }

    // -------- objectifs --------
    fn objectif_atteint(&self, id: &str) -> bool {
        let st = &self.s["stats"];
        match id {
            "recolte" => st["recoltes"].f() >= 1.0,
            "ventes" => st["ventes"].f() >= 1000.0,
            "amelioration" => !self.s["ameliorations"].l().is_empty(),
            "ruche" => self.s["ruches"].f() >= 1.0,
            "reputation" => self.s["reputation"].f() >= 75.0,
            "troupeau" => self.n_animals() >= 60,
            "eolienne" => self.s["eoliennes"].f() >= 1.0,
            "serre" => self.n_serres() >= 1,
            "terrain" => self.n_extra_fields() >= 1,
            "association" => self.champ_keys().iter().any(|k| self.mixed(k)),
            "techno" => !self.s["technologies"].l().is_empty(),
            "transformation" => st["transformations"].f() >= 1.0,
            "commande" => st["commandes"].f() >= 1.0,
            "hiver" => self.day() > 4 * SAISON_JOURS,
            "fortune" => self.s["argent"].f() >= TARGET_MONEY as f64,
            _ => false,
        }
    }

    fn update_objectives(&mut self) {
        let done: Vec<String> = self.s["objectifs"].l().iter().map(|x| x.t().to_string()).collect();
        let objectifs = d("OBJECTIVES").l();
        let atteints: Vec<bool> = objectifs.iter().map(|o| self.objectif_atteint(o["id"].t())).collect();
        for (o, atteint) in objectifs.iter().zip(atteints) {
            let id = o["id"].t();
            if atteint && !done.iter().any(|x| x == id) {
                arr(&mut self.s["objectifs"]).push(json!(id));
                self.log(&format!("Objectif atteint : {} ✓", o["titre"].t()), "succes");
            }
        }
        if self.s["objectifs"].l().iter().any(|x| x.t() == "fortune") && self.s["statut"] == "en_cours" && self.s["mode"] == "classique" {
            self.s["statut"] = json!("gagne");
            self.log(&format!("Victoire ! La ferme vaut plus de {TARGET_MONEY} €."), "succes");
        }
    }

    // -------- vue pour l'interface --------
    pub fn view(&self) -> Value {
        let mut s = self.s.clone();
        let h = self.hour();
        let minute = self.minute();
        let meals: Vec<Value> = MEALS
            .iter()
            .map(|&m| {
                let st = if self.repas_fait(m) {
                    "fait"
                } else if h >= m as f64 + MEAL_WINDOW.1 {
                    "manque"
                } else if h >= m as f64 + MEAL_WINDOW.0 {
                    "maintenant"
                } else {
                    "a_venir"
                };
                let menu = match m {
                    6 => "Foin & ensilage",
                    12 => "Céréales",
                    _ => "Foin & maïs",
                };
                json!({"heure": format!("{m:02}:00"), "statut": st, "menu": menu})
            })
            .collect();
        let animaux = &self.s["animaux"];
        let all_animals: Vec<&Value> = entrees(animaux).flat_map(|(_, g)| g["liste"].l().iter()).collect();
        let animal_health = moyenne(&all_animals.iter().map(|a| a["sante"].f()).collect::<Vec<_>>(), 0.0);
        let crop_health = moyenne(&self.toutes_planches().filter(|b| b["etat"] != "vide").map(|b| b["sante"].f()).collect::<Vec<_>>(), 100.0);
        let herds: Vec<&String> = entrees(animaux).filter(|(_, g)| !g["liste"].l().is_empty()).map(|(c, _)| c).collect();
        let feed = moyenne(&herds.iter().map(|c| animaux[c.as_str()]["satiete"].f()).collect::<Vec<_>>(), 0.0);
        let mut production = 0.0;
        for c in &herds {
            let g = &animaux[c.as_str()];
            let l = g["liste"].l();
            production += 100.0 * feed_factor(g["satiete"].f()) * mood_factor(self.mood(c)) / 1.1
                * (l.iter().map(|a| a["sante"].f()).sum::<f64>() / l.len() as f64 / 100.0);
        }
        production /= herds.len().max(1) as f64;
        let humeur = moyenne(&herds.iter().map(|c| self.mood(c)).collect::<Vec<_>>(), 0.0);
        let proprete = moyenne(&herds.iter().map(|c| animaux[c.as_str()]["proprete"].f()).collect::<Vec<_>>(), 100.0);
        let mut produits = Map::new();
        for k in items().keys() {
            let (price, fair) = (self.stall_price(k), self.fair_price(k));
            let (q, bio) = (self.s["qualite"][k.as_str()].f(), self.s["bio"][k.as_str()].f());
            produits.insert(
                k.clone(),
                json!({"qualite": rond(q), "label": quality_label(q), "bio": rond_n(bio, 2), "prix_juste": rond_n(fair, 2),
                       "prix_etal": price, "prix_gros": rond_n(self.wholesale_price(k), 3),
                       "chance": rond_n(buy_chance(price / fair), 2), "en_vente": self.on_stall(k)}),
            );
        }
        let par_cat = |f: &dyn Fn(&String, &Value) -> Value| -> Value { Value::Object(entrees(animaux).map(|(c, g)| (c.clone(), f(c, g))).collect()) };
        let par_champ = |f: &dyn Fn(&String, &Value) -> Value| -> Value { Value::Object(entrees(&self.s["champs"]).map(|(k, x)| (k.clone(), f(k, x))).collect()) };
        let humeur_animaux = par_cat(&|c, _| json!(rond(self.mood(c))));
        let a_ramasser = par_cat(&|c, g| {
            if c == "poules" {
                json!(g["a_ramasser"].f().floor() as i64)
            } else {
                fl(rond_n(g["a_ramasser"].f(), 1))
            }
        });
        let ramassage_max = par_cat(&|c, g| fl(rond_n(animals()[c.as_str()]["par_jour"].f() * g["liste"].l().len() as f64 * RAMASSAGE_MAX, 1)));
        let calin_pret: Map<String, Value> =
            all_animals.iter().map(|a| (a["id"].t().to_string(), json!(minute - a["dernier_calin"].f() >= CALIN_PAUSE))).collect();
        let n_herbes = self.toutes_planches().filter(|b| b["herbes"].f() >= 30.0).count();
        let n_nuisibles = self.toutes_planches().filter(|b| b["nuisible"].vrai()).count();
        let a_preparer = self.toutes_planches().filter(|b| b["etat"] == "fletri" || (b["etat"] == "vide" && !b["sol_pret"].vrai())).count();
        let soins = json!({"herbes": n_herbes, "nuisibles": n_nuisibles, "a_preparer": a_preparer});
        let noms_champs = par_champ(&|k, _| json!(self.field_name(k)));
        let recolte_est = par_champ(&|k, f| {
            json!(f["planches"].l().iter().enumerate().map(|(i, b)| if b["culture"].vrai() { rond(self.expected_yield(k, i)) } else { 0 }).collect::<Vec<_>>())
        });
        let qualite_champs = par_champ(&|k, f| json!((0..f["planches"].l().len()).map(|i| rond(self.harvest_quality(k, i))).collect::<Vec<_>>()));
        let association = par_champ(&|k, _| json!(self.mixed(k)));
        let qualite_animaux = par_cat(&|c, _| json!(rond(self.animal_quality(c))));
        let prix_animaux = par_cat(&|c, g| json!(g["liste"].l().iter().map(|x| animal_price(c, x)).collect::<Vec<_>>()));
        let terrain = match self.next_field() {
            Some((k, p)) => json!({"cle": k, "nom": field_label(&k), "prix": p}),
            None => Value::Null,
        };
        let en_saison: Map<String, Value> = crops().keys().map(|c| (c.clone(), json!(self.in_season(c, None)))).collect();
        let atelier: Map<String, Value> = entrees(&self.s["atelier"]["equipements"])
            .map(|(eq, m)| {
                let lot = &m["lot"];
                let (progression, reste) = if lot.vrai() {
                    let (debut, fin) = (lot["debut"].f(), lot["fin"].f());
                    (rond(100.0 * (minute - debut) / 1.0f64.max(fin - debut)), rond(fin - minute))
                } else {
                    (0, 0)
                };
                (eq.clone(), json!({"progression": progression, "reste_min": reste}))
            })
            .collect();
        let lots_possibles: Map<String, Value> = tab("RECETTES").keys().map(|r| (r.clone(), json!(self.max_lots(r)))).collect();
        let commandes: Vec<Value> = self.s["commandes"]
            .l()
            .iter()
            .map(|o| {
                let mut x = o.clone();
                let ech = o["echeance"].f();
                x["probleme"] = json!(self.order_problem(o));
                x["reste_h"] = fl(rond_n((ech - minute) / 60.0, 1));
                x["jour_limite"] = json!(JOURS[(fdiv(ech, MIN_PER_DAY) as i64).rem_euclid(7) as usize]);
                x
            })
            .collect();
        let effets: Vec<Value> = self
            .active_effects()
            .iter()
            .map(|e| json!({"nom": e["nom"], "emoji": e["emoji"], "reste_h": rond((e["fin"].f() - minute) / 60.0)}))
            .collect();
        let open = self.market_open();
        let temperature = self.temperature();
        let humidite_moy = rond(entrees(&self.s["champs"]).map(|(_, f)| f["humidite"].f()).sum::<f64>() / self.champ_keys().len().max(1) as f64);
        let n_cultures = self.toutes_planches().filter(|b| actif(b)).count();
        let malades = all_animals.iter().filter(|a| a["sante"].f() < 50.0).count();
        let objectif_argent = if self.s["mode"] == "libre" { Value::Null } else { json!(TARGET_MONEY) };
        let jours_marche: Vec<&str> = MARKET_DAYS.iter().map(|&j| JOURS[j as usize]).collect();
        let clients_heure = if open { fl(rond_n(self.customers_per_hour(), 1)) } else { json!(0) };
        let vent = weather()[self.s["meteo"]["type"].t()]["vent"].clone();
        let terrains_max = tab("FIELDS").len() + d("EXTRA_FIELDS").l().len();
        let derive = json!({
            "jour": self.day(),
            "jour_semaine": JOURS[self.weekday() as usize],
            "heure": self.clock(),
            "heure_dec": h,
            "temperature": temperature,
            "n_animaux": self.n_animals(),
            "sante_ferme": rond(0.5 * animal_health + 0.5 * crop_health),
            "sante_animaux": rond(animal_health),
            "nourriture": rond(feed),
            "production": rond(production),
            "humidite_moy": humidite_moy,
            "n_cultures": n_cultures,
            "repas": meals,
            "ration": rond(self.feed_needed()),
            "malades": malades,
            "humeur": rond(humeur),
            "proprete": rond(proprete),
            "humeur_animaux": humeur_animaux,
            "a_ramasser": a_ramasser,
            "ramassage_max": ramassage_max,
            "calin_pret": calin_pret,
            "nuit": self.night(),
            "soins_cultures": soins,
            "objectif_argent": objectif_argent,
            "charges": self.charges(),
            "gain_eoliennes": rond(self.wind_income()),
            "vent": vent,
            "pluie": self.raining(),
            "serre_debloquee": self.serre_unlocked(),
            "n_serres": self.n_serres(),
            "noms_champs": noms_champs,
            "recolte_est": recolte_est,
            "qualite_champs": qualite_champs,
            "association": association,
            "drone_actif": self.drone_active(),
            "produits": produits,
            "marche_ouvert": open,
            "jour_de_marche": self.market_day(None),
            "prochain_marche": self.next_market(),
            "jours_marche": jours_marche,
            "clients_heure": clients_heure,
            "qualite_animaux": qualite_animaux,
            "prix_animaux": prix_animaux,
            "miel_jour": rond_n(self.honey_per_day(), 2),
            "qualite_miel": rond(self.honey_quality()),
            "miel_bio": self.honey_bio() == 1.0,
            "pollinisation": rond((self.pollination() - 1.0) * 100.0),
            "meteo_detail": self.weather_details(),
            "horaire": self.hourly(8),
            "semaine": self.week(),
            "terrain_a_vendre": terrain,
            "mode": s["mode"],
            "saison": self.season_info(),
            "en_saison": en_saison,
            "gel": temperature < 0.0,
            "atelier": atelier,
            "lots_possibles": lots_possibles,
            "charges_atelier": self.workshop_upkeep(),
            "commandes": commandes,
            "effets": effets,
            "pannes": self.broken()
        });
        let parcelles: Map<String, Value> =
            entrees(&self.s["champs"]).map(|(k, _)| (k.clone(), json!({"nom": field_label(k), "taille": field_size(k)}))).collect();
        s["derive"] = derive;
        s["ref"] = json!({
            "parcelles": parcelles, "meteo": d("WEATHER"), "vent_kmh": WIND_KMH, "technologies": d("TECH"), "max_planches": MAX_BEDS,
            "association": ASSOCIATION, "drone_protection": DRONE_PROTECT, "desherbeur": DESHERBEUR_BOOST,
            "terrain_entretien": EXTRA_FIELD_UPKEEP,
            "terrains_max": terrains_max, "cultures": d("CROPS"), "animaux": d("ANIMALS"),
            "produits": d("ITEMS"), "ameliorations": d("UPGRADES"), "batiments": d("BUILDINGS"), "acheteurs": d("BUYERS"),
            "emoji": d("EMOJI"), "prix_foin": FEED_PRICE, "prix_foin_bio": FEED_BIO_PRICE, "prix_chimique": CHEM_PRICE,
            "prix_veto": VET_PRICE, "objectifs": d("OBJECTIVES"), "serre_boost": SERRE_BOOST,
            "tracteur": 1.2, "marche_heures": [MARKET_HOURS.0, MARKET_HOURS.1], "collecte_heure": COLLECTE_HEURE,
            "soins": d("SOINS"), "traitements": d("TRAITEMENT"), "enclos_sale": ENCLOS_SALE as i64,
            "saisons": d("SAISONS"), "saison_ordre": SAISON_ORDRE, "atelier": d("ATELIER"), "equipements": d("EQUIPEMENTS"),
            "recettes": d("RECETTES"), "modes": d("MODES"), "commandes_max": COMMANDES_MAX
        });
        s
    }
}

const WIND_KMH: i64 = 45; // vent à 1,0 = 45 km/h
const WIND_KMH_F: f64 = WIND_KMH as f64;
