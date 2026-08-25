//! Persistance des réglages globaux du lecteur (volume, muet, vitesse de
//! lecture) entre les sessions.
//!
//! ⚠️ Fichier volontairement isolé de `commands::playback` (qui parle au
//! moteur mpv via `PlaybackEngineHandle`) et de `commands::window` (qui
//! gère les fenêtres Tauri) : ces deux commandes ne font que lire/écrire
//! une ligne SQLite, sans jamais toucher `state.playback_engine` ni
//! aucune fenêtre. Aucun lien avec le pipeline vidéo, le décodage, l'IPC
//! des images ou les threads de rendu.

use crate::db::repositories::player_settings_repository::{self, PlayerSettingsRecord};
use crate::state::AppState;
use serde::Serialize;
use tauri::{AppHandle, Manager};

/// Miroir de `PlayerSettingsChangedPayload` (TypeScript, `shared-types`) —
/// même forme, pour que le frontend puisse désérialiser directement la
/// réponse sans conversion.
#[derive(Serialize)]
pub struct PlayerSettingsPayload {
    pub volume: f64,
    pub muted: bool,
    pub rate: f64,
}

/// Renvoie les réglages sauvegardés lors de la session précédente, ou
/// `None` si aucun n'a encore été enregistré (premier lancement).
#[tauri::command]
pub fn get_player_settings(app: AppHandle) -> Result<Option<PlayerSettingsPayload>, String> {
    let state = app.state::<AppState>();
    let conn = state.db_pool.get().map_err(|e| e.to_string())?;
    let record = player_settings_repository::get(&conn).map_err(|e| e.to_string())?;
    Ok(record.map(|r| PlayerSettingsPayload {
        volume: r.volume,
        muted: r.muted,
        rate: r.rate,
    }))
}

/// Enregistre les réglages courants — appelée par le frontend à chaque
/// changement de volume/muet/vitesse (voir `PlayerContext.tsx`). Écriture
/// peu fréquente (actions discrètes de l'utilisateur, pas un flux continu
/// comme la position de lecture) : aucun besoin de limiter la fréquence.
#[tauri::command]
pub fn save_player_settings(app: AppHandle, volume: f64, muted: bool, rate: f64) -> Result<(), String> {
    let state = app.state::<AppState>();
    let conn = state.db_pool.get().map_err(|e| e.to_string())?;
    player_settings_repository::save(&conn, &PlayerSettingsRecord { volume, muted, rate })
        .map_err(|e| e.to_string())
}
