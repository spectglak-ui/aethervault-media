//! Commandes des paramètres applicatifs (Étape 7) : wrapper autour de
//! `services::metadata::tmdb` pour la section « Métadonnées en ligne ».
use crate::services::metadata::tmdb::{self, MetadataSettings};
use crate::state::AppState;

#[tauri::command]
pub fn get_metadata_settings(state: tauri::State<AppState>) -> Result<MetadataSettings, String> {
    let conn = state.db_pool.get().map_err(|e| e.to_string())?;
    Ok(tmdb::load_settings(&conn))
}

#[tauri::command]
pub fn save_metadata_settings(
    state: tauri::State<AppState>,
    settings: MetadataSettings,
) -> Result<(), String> {
    let conn = state.db_pool.get().map_err(|e| e.to_string())?;
    tmdb::save_settings(&conn, &settings)
}

// ---- Fond d'Accueil personnalisé (0.3.0) -------------------------
/// Fond d'Accueil (0.3.0) : même pattern que l'avatar de profil —
/// image envoyée en bytes, copiée dans app_data/backdrops/, référence
/// dans app_settings (clé "home_backdrop").
#[tauri::command]
pub fn set_home_backdrop(
    app: tauri::AppHandle,
    state: tauri::State<crate::state::AppState>,
    file_name: String,
    bytes: Vec<u8>,
) -> Result<(), String> {
    use tauri::Manager;
    if bytes.is_empty() || bytes.len() > 25 * 1024 * 1024 {
        return Err("Image invalide (taille attendue : entre 1 o et 25 Mo).".to_string());
    }
    let ext = std::path::Path::new(&file_name)
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .filter(|e| matches!(e.as_str(), "png" | "jpg" | "jpeg" | "webp"))
        .unwrap_or_else(|| "jpg".to_string());
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("backdrops");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let target = dir.join(format!("home_backdrop.{ext}"));
    std::fs::write(&target, bytes).map_err(|e| e.to_string())?;
    let conn = state.db_pool.get().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO app_settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        rusqlite::params!["home_backdrop", target.to_string_lossy()],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Fond d'Accueil (0.3.0) : lit le chemin du fond personnalisé.
#[tauri::command]
pub fn get_home_backdrop(state: tauri::State<crate::state::AppState>) -> Result<Option<String>, String> {
    use rusqlite::OptionalExtension;
    let conn = state.db_pool.get().map_err(|e| e.to_string())?;
    conn.query_row(
        "SELECT value FROM app_settings WHERE key = ?1",
        rusqlite::params!["home_backdrop"],
        |row| row.get(0),
    )
    .optional()
    .map_err(|e| e.to_string())
}

/// Fond d'Accueil (0.3.0) : retire le fond personnalisé (fichier + référence).
#[tauri::command]
pub fn clear_home_backdrop(state: tauri::State<crate::state::AppState>) -> Result<(), String> {
    use rusqlite::OptionalExtension;
    let conn = state.db_pool.get().map_err(|e| e.to_string())?;
    let existing: Option<String> = conn
        .query_row(
            "SELECT value FROM app_settings WHERE key = ?1",
            rusqlite::params!["home_backdrop"],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    if let Some(path) = existing {
        let _ = std::fs::remove_file(path);
    }
    conn.execute(
        "DELETE FROM app_settings WHERE key = ?1",
        rusqlite::params!["home_backdrop"],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Bande-annonce d'un Titre (0.3.0) : liste de clés YouTube des trailers
/// officiels via TMDB (triés par priorité) — le frontend essaiera la
/// première, puis la suivante en cas d'erreur (fallback automatique).
/// Liste vide si pas de clé TMDB, pas de tmdb_id, pas de trailer
/// ou pas de réseau.
#[tauri::command]
pub fn get_title_trailer(
    state: tauri::State<crate::state::AppState>,
    title_id: i64,
) -> Result<Vec<String>, String> {
    use rusqlite::OptionalExtension;
    let conn = state.db_pool.get().map_err(|e| e.to_string())?;
    
    let (kind, tmdb_id): (String, Option<i64>) = conn
        .query_row(
            "SELECT kind, tmdb_id FROM titles WHERE id = ?1",
            rusqlite::params![title_id],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, Option<i64>>(1)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Titre introuvable.".to_string())?;
        
    log::info!("[trailer] title {title_id} kind={kind} tmdb_id={tmdb_id:?}");
    
    let Some(tmdb_id) = tmdb_id else { 
        log::info!("[trailer] pas de tmdb_id — liste vide");
        return Ok(Vec::new()) 
    };
    let settings = crate::services::metadata::tmdb::load_settings(&conn);
    if settings.api_key.is_empty() {
        log::info!("[trailer] clé TMDB absente — liste vide");
        return Ok(Vec::new());
    }
    let client = crate::services::metadata::tmdb::TmdbClient {
        api_key: settings.api_key,
        lang: settings.language,
    };
    let keys = client.fetch_trailer_keys(&kind, tmdb_id);
    log::info!("[trailer] {} clé(s) YouTube reçue(s)", keys.len());
    Ok(keys)
}