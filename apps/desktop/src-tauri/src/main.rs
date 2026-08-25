// Point d'entrée du binaire natif.
//
// Toute la logique applicative vit dans `lib.rs` (fonction `run`) afin de
// rester compatible avec les futures cibles mobiles de Tauri, qui partagent
// le même point d'entrée de bibliothèque. Ne pas ajouter de logique ici :
// ce fichier doit rester un simple lanceur.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    aethervault_media_lib::run();
}
