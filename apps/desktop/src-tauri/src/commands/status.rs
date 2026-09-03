//! Commande `get_app_status`.
//!
//! Seule commande exposée au frontend à ce stade (Étape 0). Elle sert
//! uniquement à prouver que le socle fonctionne de bout en bout : la fenêtre
//! principale l'appelle au démarrage et affiche le résultat. Les commandes
//! liées aux bibliothèques, au lecteur, etc. seront ajoutées progressivement
//! dans ce même dossier, une par domaine, à partir de l'Étape 2.

use crate::state::AppState;
use serde::Serialize;

/// Informations affichées dans la fenêtre principale pour confirmer que le
/// socle applicatif (base de données, journalisation, IPC) fonctionne
/// correctement.
#[derive(Debug, Clone, Serialize)]
pub struct AppStatus {
    pub app_name: String,
    pub version: String,
    pub database_path: String,
    pub log_directory: String,
    pub profile_count: i64,
}

#[tauri::command]
pub fn get_app_status(state: tauri::State<AppState>) -> Result<AppStatus, String> {
    let conn = state.db_pool.get().map_err(|e| e.to_string())?;

    let profile_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM profiles", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;

    Ok(AppStatus {
        app_name: "AetherVault Media".to_string(),
        version: format!("{} Alpha", env!("CARGO_PKG_VERSION")),
        database_path: state.database_path.clone(),
        log_directory: state.log_directory.clone(),
        profile_count,
    })
}
