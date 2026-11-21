//! La Ferme du Val Vert : le moteur du jeu (porté de engine.py) et son serveur local.
//! L'interface est une page web (dossier web/) servie par `serveur`.

// la vue envoyée à l'interface est un gros `json!` (moteur.rs)
#![recursion_limit = "512"]

pub mod hasard;
pub mod moteur;
pub mod serveur;
