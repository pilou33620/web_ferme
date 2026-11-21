//! Le serveur local de « La Ferme du Val Vert » (porté de server.py) : sert la page (web/) et l'API,
//! fait avancer le temps du jeu, et sauvegarde la partie (sauvegarde.json) après chaque action,
//! toutes les 30 s quand le temps tourne, et à l'arrêt (Ctrl+C, SIGTERM).
//!
//! Lancement :  ferme              (puis ouvrir http://localhost:8799)
//! Options   :  --port 8799  --host 0.0.0.0  --local  --nouvelle  --sans-navigateur  --sans-maj  --sans-pause
//! Sans --local, le jeu est joignable depuis le réseau local : l'appairage des web tools (web_tools_commun)
//! demande une fois un code aux autres appareils ; cet appareil-ci n'en a jamais besoin.

use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use web_tools_commun::appairage::{self, Garde};
use web_tools_commun::serveur::{ErreurCorps, Reponse, Requete, Serveur};

use crate::moteur::{Game, GAME_MIN_PER_SEC, V};

pub const PORT: u16 = 8799;
const NOM: &str = "La Ferme du Val Vert";
const CORPS_MAX: usize = 64 * 1024;
/// Carte SD : la partie qui tourne ne s'écrit qu'au plus toutes les 30 s (plus après chaque action et à l'arrêt).
const SAUVER_TOUTES: Duration = Duration::from_secs(30);

/// La racine du jeu (web/, sauvegarde.json) : le dossier courant s'il contient web/index.html, sinon le premier
/// dossier au-dessus de l'exécutable qui le contient.
pub fn racine() -> &'static Path {
    static R: OnceLock<PathBuf> = OnceLock::new();
    R.get_or_init(|| {
        let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
        let jeu = |d: &Path| d.join("web").join("index.html").is_file();
        if jeu(&cwd) {
            return cwd;
        }
        let exe = std::env::current_exe().ok().and_then(|e| std::fs::canonicalize(e).ok());
        exe.and_then(|e| e.ancestors().find(|d| jeu(d)).map(Path::to_path_buf)).unwrap_or(cwd)
    })
}

/// Le jeu et l'horloge réelle.
pub struct Monde {
    pub jeu: Game,
    fichier: PathBuf,
    dernier: Instant,
    derniere_sauvegarde: Instant,
    pub version: String,
    /// Résumé de la mise à jour qui vient d'être installée.
    pub maj: Option<String>,
    /// Adresse à taper sur les autres appareils (None : accès réseau désactivé).
    pub reseau: Option<String>,
}

impl Monde {
    pub fn new(fichier: PathBuf, neuve: bool) -> Monde {
        let mut jeu = None;
        if !neuve && fichier.exists() {
            match std::fs::read_to_string(&fichier).map_err(|e| e.to_string()).and_then(|t| Game::relire(&t)) {
                Ok(g) => jeu = Some(g),
                Err(e) => {
                    // jamais « illisible donc absente » suivi d'un écrasement : la sauvegarde est mise de côté
                    let ou = mettre_de_cote(&fichier);
                    println!("Sauvegarde illisible ({e}) : mise de côté sous {ou}. Nouvelle partie.");
                }
            }
        }
        let mut jeu = jeu.unwrap_or_else(|| Game::nouvelle(None));
        // le jeu démarre sur le menu principal : le temps ne s'écoule pas avant qu'on choisisse
        let _ = jeu.act(&json!({"type": "menu", "ouvert": true}));
        let maintenant = Instant::now();
        Monde { jeu, fichier, dernier: maintenant, derniere_sauvegarde: maintenant, version: String::new(), maj: None, reseau: None }
    }

    pub fn view(&self) -> Value {
        let mut v = self.jeu.view();
        v["version"] = json!(self.version);
        v["maj"] = json!(self.maj);
        v["reseau"] = json!(self.reseau);
        v
    }

    /// Le temps réel écoulé fait avancer le jeu, à sa vitesse.
    pub fn tick(&mut self) {
        let maintenant = Instant::now();
        let dt = maintenant.duration_since(self.dernier).as_secs_f64();
        self.dernier = maintenant;
        let vitesse = self.jeu.s["vitesse"].f();
        self.jeu.advance(dt * GAME_MIN_PER_SEC * vitesse);
        // en pause rien ne change, et chaque action est déjà sauvegardée
        if vitesse > 0.0 && maintenant.duration_since(self.derniere_sauvegarde) > SAUVER_TOUTES {
            self.sauver();
        }
    }

    /// Écriture atomique : un temporaire, puis renommage.
    pub fn sauver(&mut self) {
        self.derniere_sauvegarde = Instant::now();
        let tmp = self.fichier.with_extension("tmp");
        let r = std::fs::write(&tmp, self.jeu.dumps()).and_then(|_| std::fs::rename(&tmp, &self.fichier));
        if let Err(e) = r {
            let _ = std::fs::remove_file(&tmp);
            eprintln!("Sauvegarde impossible : {e}");
        }
    }

    /// POST /api/action : 200 si l'action passe, 422 sinon, avec l'état à jour.
    pub fn agir(&mut self, action: &Value) -> (u16, Value) {
        self.tick();
        let (ok, message) = match self.jeu.act(action) {
            Ok(m) => (true, m),
            Err(m) => (false, m),
        };
        self.sauver();
        (if ok { 200 } else { 422 }, json!({"ok": ok, "message": message, "etat": self.view()}))
    }
}

/// `sauvegarde.json` → `sauvegarde.abime.json` (`sauvegarde.abime-2.json`… si déjà pris).
fn mettre_de_cote(fichier: &Path) -> String {
    let dossier = fichier.parent().unwrap_or(Path::new("."));
    let base = fichier.file_stem().and_then(|s| s.to_str()).unwrap_or("sauvegarde");
    let mut n = 1;
    loop {
        let nom = if n == 1 { format!("{base}.abime.json") } else { format!("{base}.abime-{n}.json") };
        let cible = dossier.join(&nom);
        if !cible.exists() {
            return match std::fs::rename(fichier, &cible) {
                Ok(()) => nom,
                Err(e) => format!("(impossible : {e})"),
            };
        }
        n += 1;
    }
}

fn type_mime(ext: &str) -> Option<&'static str> {
    Some(match ext {
        "html" => "text/html; charset=utf-8",
        "js" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" => "application/json; charset=utf-8",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "webp" => "image/webp",
        "ico" => "image/x-icon",
        "woff2" => "font/woff2",
        _ => return None,
    })
}

/// Un fichier de web/ : des composants ordinaires qui ne commencent pas par un point, une extension connue.
/// Tout le reste est 404 (ni .git/, ni Cargo.toml, ni la sauvegarde).
fn fichier(chemin: &str) -> Reponse {
    let rel = if chemin == "/" { "index.html".to_string() } else { web_tools_commun::serveur::decoder_url(chemin.trim_start_matches('/')) };
    let p = Path::new(&rel);
    let sain = p.components().all(|c| matches!(c, Component::Normal(n) if !n.to_string_lossy().starts_with('.')));
    match (sain, p.extension().and_then(|x| x.to_str()).and_then(type_mime)) {
        (true, Some(mime)) => match std::fs::read(racine().join("web").join(p)) {
            Ok(o) => Reponse::new(200, mime, o),
            Err(_) => Reponse::texte(404, "introuvable"),
        },
        _ => Reponse::texte(404, "introuvable"),
    }
}

fn garde() -> &'static Garde {
    GARDE.get().expect("garde non initialisée")
}
static GARDE: OnceLock<Garde> = OnceLock::new();

/// Un appel au moteur sous le verrou : une panique répond 500 sans tuer le serveur.
fn appel(monde: &Arc<Mutex<Monde>>, f: impl FnOnce(&mut Monde) -> (u16, Value)) -> Reponse {
    let mut m = monde.lock().unwrap_or_else(|e| e.into_inner());
    match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| f(&mut *m))) {
        Ok((code, v)) => Reponse::json(code, &v),
        Err(_) => Reponse::json(500, &json!({"erreur": "erreur interne du moteur"})),
    }
}

/// Toutes les réponses : pas d'affichage dans le cadre d'un autre site, pas de type deviné.
fn servir(r: &mut Requete, monde: &Arc<Mutex<Monde>>) -> Reponse {
    traiter(r, monde)
        .entete("X-Frame-Options", "SAMEORIGIN")
        .entete("Content-Security-Policy", "frame-ancestors 'self'")
        .entete("X-Content-Type-Options", "nosniff")
}

fn traiter(r: &mut Requete, monde: &Arc<Mutex<Monde>>) -> Reponse {
    // Host, Internet, TLS, jeton : avant tout traitement de la requête
    if let Some(rep) = garde().filtrer(r) {
        return rep;
    }
    let chemin = r.chemin().to_string();
    if r.lecture() {
        if chemin == "/api/etat" {
            return appel(monde, |m| {
                m.tick();
                (200, m.view())
            });
        }
        return fichier(&chemin);
    }
    if r.methode != "POST" {
        return Reponse::texte(405, "méthode refusée");
    }
    if chemin != "/api/action" {
        return Reponse::json(404, &json!({"erreur": "introuvable"}));
    }
    // CSRF : la page envoie du JSON ; une page d'un autre site ne peut pas poser ce Content-Type sans
    // pré-vol CORS, que ce serveur ne valide jamais
    let json_annonce = r.entete("Content-Type").is_some_and(|t| t.trim().to_ascii_lowercase().starts_with("application/json"));
    if !json_annonce {
        return Reponse::json(403, &json!({"erreur": "Requête refusée"}));
    }
    let corps = match r.lire_corps(CORPS_MAX) {
        Ok(c) => c,
        Err(ErreurCorps::TropGrand) => return Reponse::json(413, &json!({"erreur": "Requête trop grande"})),
        Err(_) => return Reponse::json(400, &json!({"erreur": "JSON invalide"})),
    };
    let octets: &[u8] = if corps.is_empty() { b"{}" } else { &corps };
    let action: Value = match serde_json::from_slice(octets) {
        Ok(v @ Value::Object(_)) => v,
        _ => return Reponse::json(400, &json!({"erreur": "JSON invalide"})),
    };
    appel(monde, |m| m.agir(&action))
}

// ---------------------------------------------------------------------- lancement

#[derive(Debug, PartialEq)]
pub struct Args {
    pub port: u16,
    pub host: String,
    pub nouvelle: bool,
    pub sans_navigateur: bool,
    pub sans_maj: bool,
    pub aide: bool,
}

pub const USAGE: &str =
    "usage: ferme [--port 8799] [--host ADRESSE | --local] [--nouvelle] [--sans-navigateur] [--sans-maj] [--sans-pause]";

fn valeur(argv: &[String], i: &mut usize, cle: &str, val: &Option<String>) -> Result<String, String> {
    match val {
        Some(v) => Ok(v.clone()),
        None => {
            *i += 1;
            argv.get(*i).cloned().ok_or_else(|| format!("{cle} attend une valeur"))
        }
    }
}

/// Les options de server.py, plus --sans-pause (standard des web tools, sans effet ici).
/// `PORT` et `HOST` de l'environnement donnent les valeurs par défaut, comme avant.
pub fn lire_args(argv: &[String], env_port: Option<&str>, env_host: Option<&str>) -> Result<Args, String> {
    let port = match env_port {
        Some(p) => p.trim().parse().map_err(|_| format!("PORT invalide : {p}"))?,
        None => PORT,
    };
    let mut a = Args { port, host: env_host.unwrap_or("0.0.0.0").to_string(), nouvelle: false, sans_navigateur: false, sans_maj: false, aide: false };
    let mut i = 0;
    while i < argv.len() {
        let x = argv[i].as_str();
        let (cle, val) = match x.split_once('=') {
            Some((k, v)) => (k, Some(v.to_string())),
            None => (x, None),
        };
        match cle {
            "--port" => {
                let v = valeur(argv, &mut i, cle, &val)?;
                a.port = v.parse().map_err(|_| format!("port invalide : {v}"))?;
            }
            "--host" => a.host = valeur(argv, &mut i, cle, &val)?,
            "--local" if val.is_none() => a.host = "127.0.0.1".into(),
            "--nouvelle" if val.is_none() => a.nouvelle = true,
            "--sans-navigateur" if val.is_none() => a.sans_navigateur = true,
            "--sans-maj" if val.is_none() => a.sans_maj = true,
            "--sans-pause" if val.is_none() => {}
            "-h" | "--help" if val.is_none() => a.aide = true,
            _ => return Err(format!("option inconnue : {x}")),
        }
        i += 1;
    }
    Ok(a)
}

fn sans_ecran() -> bool {
    cfg!(target_os = "linux") && std::env::var_os("DISPLAY").is_none() && std::env::var_os("WAYLAND_DISPLAY").is_none()
}

fn ouvrir_navigateur(url: &str) {
    let r = if cfg!(target_os = "windows") {
        Command::new("cmd").args(["/C", "start", "", url]).stdout(Stdio::null()).stderr(Stdio::null()).spawn()
    } else if cfg!(target_os = "macos") {
        Command::new("open").arg(url).spawn()
    } else {
        Command::new("xdg-open").arg(url).stdout(Stdio::null()).stderr(Stdio::null()).spawn()
    };
    if r.is_err() {
        println!("Ouvrez {url} dans votre navigateur.");
    }
}

/// Une commande git dans le dossier du jeu, avec un délai : jamais d'attente sans fin du réseau.
fn git(args: &[&str], delai: u64) -> Result<String, String> {
    let mut enfant = Command::new("git")
        .args(args)
        .current_dir(racine())
        .env("GIT_TERMINAL_PROMPT", "0") // jamais de demande de mot de passe bloquante
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;
    let fin = Instant::now() + Duration::from_secs(delai);
    loop {
        match enfant.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if Instant::now() < fin => std::thread::sleep(Duration::from_millis(50)),
            _ => {
                let _ = enfant.kill();
                let _ = enfant.wait();
                return Err("délai dépassé".into());
            }
        }
    }
    let o = enfant.wait_with_output().map_err(|e| e.to_string())?;
    if o.status.success() {
        Ok(String::from_utf8_lossy(&o.stdout).trim().to_string())
    } else {
        Err(String::from_utf8_lossy(&o.stderr).trim().to_string())
    }
}

/// La ligne utile d'un message d'erreur git (« fatal: … »), sans son préfixe.
fn raison(err: &str) -> String {
    let lignes: Vec<&str> = err.lines().map(str::trim).filter(|l| !l.is_empty()).collect();
    match lignes.iter().find(|l| l.starts_with("fatal:") || l.starts_with("error:")) {
        Some(l) => l.split_once(':').map_or("", |x| x.1).trim().to_string(),
        None => lignes.first().map_or("erreur inconnue".to_string(), |l| l.to_string()),
    }
}

/// Identifiant court de la version installée (commit), ou "" hors git.
fn version() -> String {
    git(&["rev-parse", "--short", "HEAD"], 5).unwrap_or_default()
}

/// Cherche et installe une mise à jour, en avance rapide seulement, et jamais par-dessus des fichiers modifiés
/// ou des commits locaux. Rend un résumé si le code a changé ; au pire, le jeu démarre avec la version actuelle.
fn mise_a_jour() -> Option<String> {
    if git(&["rev-parse", "--is-inside-work-tree"], 5).as_deref() != Ok("true") {
        println!("Mises à jour : le jeu n'est pas dans un dépôt git, vérification ignorée.");
        return None;
    }
    let Ok(upstream) = git(&["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], 5) else {
        println!("Mises à jour : aucune branche distante suivie, vérification ignorée.");
        return None;
    };
    println!("Recherche de mises à jour…");
    if let Err(e) = git(&["fetch", "--quiet"], 10) {
        println!("Mises à jour : dépôt injoignable ({}). On joue avec la version actuelle.", raison(&e));
        return None;
    }
    let compte = git(&["rev-list", "--left-right", "--count", &format!("HEAD...{upstream}")], 10).unwrap_or_default();
    let mut nombres = compte.split_whitespace().map(|x| x.parse::<u64>().unwrap_or(0));
    let (ahead, behind) = (nombres.next().unwrap_or(0), nombres.next().unwrap_or(0));
    if behind == 0 {
        println!("Le jeu est à jour (version {}).", version());
        return None;
    }
    if ahead > 0 {
        println!(
            "Mises à jour : {behind} disponible(s), mais {ahead} commit(s) local(aux) non publié(s). Fusionnez à la main (git pull) : rien n'a été modifié."
        );
        return None;
    }
    if git(&["status", "--porcelain", "--untracked-files=no"], 10).map_or(true, |s| !s.is_empty()) {
        println!(
            "Mises à jour : {behind} disponible(s), mais des fichiers du jeu ont été modifiés sur ce poste. Mise à jour ignorée pour ne rien écraser."
        );
        return None;
    }
    let titres = git(&["log", "-n", "5", "--format=%s", &format!("HEAD..{upstream}")], 10).unwrap_or_default();
    let avant = version();
    if let Err(e) = git(&["merge", "--ff-only", &upstream], 120) {
        println!("Mises à jour : installation impossible ({}). On joue avec la version actuelle.", raison(&e));
        return None;
    }
    let titres: Vec<&str> = titres.lines().filter(|t| !t.trim().is_empty()).collect();
    let mut resume = titres.iter().take(3).copied().collect::<Vec<_>>().join(" · ");
    if behind > 3 && !resume.is_empty() {
        resume += &format!(" (et {} autre(s))", behind - 3);
    }
    println!("Mise à jour installée : {avant} → {} ({behind} nouveauté(s)).", version());
    for t in &titres {
        println!("  • {t}");
    }
    Some(if resume.is_empty() { format!("{behind} nouveauté(s)") } else { resume })
}

/// Le résumé laissé par la version précédente juste avant sa relance (code 75), lu une seule fois.
fn fichier_maj() -> PathBuf {
    racine().join("bin").join("maj.txt")
}

fn lire_maj() -> Option<String> {
    let texte = std::fs::read_to_string(fichier_maj()).ok()?;
    let _ = std::fs::remove_file(fichier_maj());
    Some(texte.trim().to_string()).filter(|t| !t.is_empty())
}

pub fn main() {
    let argv: Vec<String> = std::env::args().skip(1).collect();
    let (env_port, env_host) = (std::env::var("PORT").ok(), std::env::var("HOST").ok());
    let args = match lire_args(&argv, env_port.as_deref(), env_host.as_deref()) {
        Ok(a) => a,
        Err(e) => {
            eprintln!("{USAGE}\nferme: {e}");
            std::process::exit(2);
        }
    };
    if args.aide {
        println!("{USAGE}");
        return;
    }
    let _ = std::env::set_current_dir(racine());

    // mise à jour automatique depuis git : lancé par lancer.sh, le jeu sort avec le code 75 et repart sur la nouvelle version
    if !args.sans_maj {
        if let Some(resume) = mise_a_jour() {
            if std::env::var_os("FERME_RELANCEUR").is_some() {
                let _ = std::fs::write(fichier_maj(), &resume);
                println!("Redémarrage du jeu sur la nouvelle version…");
                std::process::exit(75);
            }
            println!("Relancez le jeu pour profiter de la mise à jour.");
        }
    }

    let reseau = !matches!(args.host.as_str(), "127.0.0.1" | "localhost" | "::1");
    let srv = match Serveur::ouvrir(args.port, reseau, 10) {
        Ok(s) => s,
        Err(e) => {
            println!("Aucun port libre à partir de {} ({e}). Essayez --port <numéro>.", args.port);
            std::process::exit(1);
        }
    };
    if srv.port() != args.port {
        println!("(le port {} était occupé)", args.port);
    }
    let _ = GARDE.set(Garde::new(NOM, reseau, None, None));
    garde().brancher(&srv); // en mode réseau : HTTPS sur le même port (le jeton ne passe plus en clair)
    let port = srv.port();

    let mut monde = Monde::new(racine().join("sauvegarde.json"), args.nouvelle);
    monde.version = version();
    if let Some(m) = lire_maj() {
        monde.jeu.log(&format!("Jeu mis à jour : {m}"), "succes");
        monde.maj = Some(m);
    }
    let url = format!("http://localhost:{port}");
    println!("🌾 {NOM} tourne sur {url}  (Ctrl+C pour quitter)");
    if reseau {
        let ip = if matches!(args.host.as_str(), "0.0.0.0" | "" | "::") {
            appairage::adresse_reseau().map(|i| i.to_string())
        } else {
            Some(args.host.clone())
        };
        let adresse = match ip {
            Some(ip) => garde().adresse(&ip, port),
            None => format!("{}://<adresse IP de ce PC>:{port}", garde().schema()),
        };
        println!("   depuis un autre appareil du réseau : {adresse}");
        println!("   (si ça ne répond pas : autorisez le jeu dans le pare-feu, sur les réseaux privés)");
        println!("   l'autre appareil demande une fois le code d'appairage ci-dessous :");
        monde.reseau = Some(adresse);
        garde().annoncer();
    }
    let _ = std::io::stdout().flush();

    let monde = Arc::new(Mutex::new(monde));
    // le temps du jeu avance tout seul, deux fois par seconde
    let m = monde.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_millis(500));
        let mut w = m.lock().unwrap_or_else(|e| e.into_inner());
        if std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| w.tick())).is_err() {
            eprintln!("Le temps du jeu est arrêté : erreur du moteur.");
            break;
        }
    });
    // arrêt demandé (Ctrl+C, launcher, kill) : la partie est écrite avant de sortir
    let m = monde.clone();
    let _ = ctrlc::set_handler(move || {
        m.lock().unwrap_or_else(|e| e.into_inner()).sauver();
        println!("\nPartie sauvegardée.");
        let _ = std::io::stdout().flush();
        std::process::exit(0);
    });
    if !args.sans_navigateur && !sans_ecran() {
        let u = url.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(600));
            ouvrir_navigateur(&u);
        });
    }
    srv.servir(Arc::new(move |r: &mut Requete| servir(r, &monde)));
}

#[cfg(test)]
mod essais {
    use super::*;
    use std::io::Read;
    use std::net::TcpStream;

    fn a(l: &[&str]) -> Vec<String> {
        l.iter().map(|x| x.to_string()).collect()
    }

    #[test]
    fn ligne_de_commande() {
        // la commande du catalogue web_launcher
        let x = lire_args(&a(&["--port", "8799", "--sans-navigateur", "--sans-maj"]), None, None).unwrap();
        assert_eq!((x.port, x.sans_navigateur, x.sans_maj, x.host.as_str()), (8799, true, true, "0.0.0.0"));
        let x = lire_args(&a(&["--port=9000", "--local", "--nouvelle", "--sans-pause"]), None, None).unwrap();
        assert_eq!((x.port, x.host.as_str(), x.nouvelle), (9000, "127.0.0.1", true));
        assert_eq!(lire_args(&a(&["--host", "192.168.1.5"]), None, None).unwrap().host, "192.168.1.5");
        assert_eq!(lire_args(&a(&["--host=localhost"]), None, None).unwrap().host, "localhost");
        let x = lire_args(&[], Some("8100"), Some("127.0.0.1")).unwrap();
        assert_eq!((x.port, x.host.as_str()), (8100, "127.0.0.1"));
        assert_eq!(lire_args(&[], None, None).unwrap().port, PORT);
        assert!(lire_args(&a(&["-h"]), None, None).unwrap().aide);
        assert!(lire_args(&a(&["--port"]), None, None).is_err());
        assert!(lire_args(&a(&["--port", "x"]), None, None).is_err());
        assert!(lire_args(&a(&["--inconnu"]), None, None).is_err());
        assert!(lire_args(&a(&["--local=1"]), None, None).is_err());
        assert!(lire_args(&[], Some("abc"), None).is_err());
    }

    #[test]
    fn raison_git() {
        assert_eq!(raison("warning: x\nfatal: unable to access 'https://…'\n"), "unable to access 'https://…'");
        assert_eq!(raison(""), "erreur inconnue");
    }

    fn dossier(nom: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("ferme-essai-{}-{nom}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    fn demarrer(fichier: PathBuf) -> u16 {
        let _ = GARDE.set(Garde::new("essai", false, None, None));
        let monde = Arc::new(Mutex::new(Monde::new(fichier, false)));
        let srv = Serveur::ouvrir(0, false, 1).unwrap();
        let port = srv.port();
        srv.servir_en_fond(Arc::new(move |r: &mut Requete| servir(r, &monde)));
        port
    }

    fn requete(port: u16, brut: &str) -> (u16, String) {
        let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
        s.write_all(brut.as_bytes()).unwrap();
        let mut rep = Vec::new();
        let _ = s.read_to_end(&mut rep);
        let texte = String::from_utf8_lossy(&rep).to_string();
        let code = texte.split(' ').nth(1).and_then(|c| c.parse().ok()).unwrap_or(0);
        let corps = texte.split_once("\r\n\r\n").map(|x| x.1.to_string()).unwrap_or_default();
        (code, corps)
    }

    fn get(port: u16, chemin: &str) -> u16 {
        requete(port, &format!("GET {chemin} HTTP/1.0\r\nHost: 127.0.0.1\r\n\r\n")).0
    }

    fn post(port: u16, chemin: &str, corps: &str, entetes: &str) -> (u16, String) {
        requete(port, &format!("POST {chemin} HTTP/1.0\r\nHost: 127.0.0.1\r\n{entetes}Content-Length: {}\r\n\r\n{corps}", corps.len()))
    }

    #[test]
    fn serveur_local() {
        let fichier = dossier("local").join("sauvegarde.json");
        let port = demarrer(fichier.clone());
        for c in ["/", "/index.html", "/style.css", "/js/app.js", "/style.css?v=2"] {
            assert_eq!(get(port, c), 200, "{c}");
        }
        for c in ["/.git/config", "/../Cargo.toml", "/Cargo.toml", "/%2e%2e/Cargo.toml", "/.env", "/js/", "/README.md", "/sauvegarde.json"] {
            assert_eq!(get(port, c), 404, "{c}");
        }
        assert_eq!(requete(port, "GET / HTTP/1.0\r\nHost: piege.example\r\n\r\n").0, 403);
        let (code, corps) = requete(port, "GET / HTTP/1.0\r\nHost: 127.0.0.1\r\n\r\n");
        assert_eq!(code, 200);
        assert!(corps.contains("<html"), "la page");

        let (code, corps) = requete(port, "GET /api/etat HTTP/1.0\r\nHost: 127.0.0.1\r\n\r\n");
        assert_eq!(code, 200);
        let v: Value = serde_json::from_str(&corps).unwrap();
        assert_eq!(v["menu"], true); // le jeu démarre sur le menu, en pause
        assert_eq!(v["derive"]["jour"], 1);
        assert!(v["ref"]["cultures"]["tomates"].is_object());
        assert!(v.get("reseau").is_some() && v.get("version").is_some());

        let jt = "Content-Type: application/json\r\n";
        assert_eq!(post(port, "/api/action", r#"{"type":"vitesse","valeur":2}"#, "").0, 403); // sans JSON annoncé
        assert_eq!(post(port, "/api/action", r#"{"type":"vitesse","valeur":2}"#, "Content-Type: text/plain\r\n").0, 403);
        assert_eq!(post(port, "/api/action", "pas du json", jt).0, 400);
        assert_eq!(post(port, "/api/action", "[1]", jt).0, 400);
        assert_eq!(post(port, "/api/autre", "{}", jt).0, 404);
        let gros = format!("POST /api/action HTTP/1.0\r\nHost: 127.0.0.1\r\n{jt}Content-Length: 99999999\r\n\r\n");
        assert_eq!(requete(port, &gros).0, 413);
        assert!(!fichier.exists());

        let (code, corps) = post(port, "/api/action", r#"{"type":"vitesse","valeur":2}"#, jt);
        assert_eq!(code, 200);
        let v: Value = serde_json::from_str(&corps).unwrap();
        assert_eq!(v["ok"], true);
        assert_eq!(v["message"], "Vitesse ×2");
        assert_eq!(v["etat"]["vitesse"], 2);
        assert!(fichier.exists()); // chaque action est sauvegardée
        let (code, corps) = post(port, "/api/action", r#"{"type":"nourrir"}"#, jt);
        assert_eq!(code, 422);
        let v: Value = serde_json::from_str(&corps).unwrap();
        assert_eq!(v["ok"], false);
        assert!(v["etat"].is_object());
        assert_eq!(post(port, "/api/action", r#"{"type":"inconnue"}"#, jt).0, 422);
    }

    #[test]
    fn sauvegarde_relue_ou_mise_de_cote() {
        let d = dossier("abime");
        let f = d.join("sauvegarde.json");
        std::fs::write(&f, "{abîmé").unwrap();
        let mut m = Monde::new(f.clone(), false);
        assert_eq!(std::fs::read_to_string(d.join("sauvegarde.abime.json")).unwrap(), "{abîmé");
        m.jeu.s["argent"] = json!(1234.5);
        m.sauver();
        assert!(!d.join("sauvegarde.tmp").exists());
        // la partie écrite se relit au lancement suivant
        let m2 = Monde::new(f.clone(), false);
        assert_eq!(m2.jeu.s["argent"], 1234.5);
        // une seconde sauvegarde abîmée ne remplace pas la première mise de côté
        std::fs::write(&f, "[]").unwrap();
        let _ = Monde::new(f.clone(), false);
        assert!(d.join("sauvegarde.abime-2.json").exists());
        // --nouvelle ignore la sauvegarde sans la toucher
        std::fs::write(&f, "{\"x\": 1}").unwrap();
        let m3 = Monde::new(f.clone(), true);
        assert_eq!(m3.jeu.s["argent"], 1500.0);
        assert_eq!(std::fs::read_to_string(&f).unwrap(), "{\"x\": 1}");
    }
}
