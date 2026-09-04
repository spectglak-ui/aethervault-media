//! Commandes du partage par code (Étape 8) — voir `services::share`.
use crate::services::share;
use crate::state::AppState;
use serde::Serialize;
use tauri::Manager;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareOfferDto {
    pub code: String,
    pub port: u16,
    pub file_name: String,
    pub size: u64,
}

/// Démarre l'hébergement d'un média public et renvoie le code à envoyer.
/// `lan_only` = case « LAN uniquement » (jamais d'UPnP).
#[tauri::command]
pub fn share_start(
    app: tauri::AppHandle,
    state: tauri::State<AppState>,
    media_file_id: i64,
    lan_only: bool,
) -> Result<ShareOfferDto, String> {
    let conn = state.get_conn()?;
    let path: String = conn
        .query_row(
            "SELECT path FROM media_files WHERE id = ?1 AND is_available = 1",
            rusqlite::params![media_file_id],
            |row| row.get(0),
        )
        .map_err(|_| "Fichier introuvable ou indisponible.".to_string())?;
    let offer = share::start_share(&app, &path, lan_only)?;
    Ok(ShareOfferDto {
        code: offer.code,
        port: offer.port,
        file_name: offer.file_name,
        size: offer.size,
    })
}

#[tauri::command]
pub fn share_stop() -> Result<(), String> {
    share::stop_share();
    Ok(())
}

/// Télécharge le média pointé par le code vers
/// `Vidéos\AetherVault Partages` (à ajouter comme bibliothèque pour
/// l'intégrer au catalogue).
#[tauri::command]
pub fn share_receive(app: tauri::AppHandle, code: String) -> Result<String, String> {
    let target = app
        .path()
        .video_dir()
        .map_err(|e| e.to_string())?
        .join("AetherVault Partages");
    share::receive(&app, &code, &target)
}