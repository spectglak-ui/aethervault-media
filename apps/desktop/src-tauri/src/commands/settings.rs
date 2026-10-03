//! Commandes des paramètres applicatifs (Étape 7) : wrapper autour de
//! `services::metadata::tmdb` pour la section « Métadonnées en ligne ».
use crate::services::metadata::tmdb::{self, MetadataSettings};
use crate::state::AppState;

#[tauri::command]
pub fn get_metadata_settings(state: tauri::State<AppState>) -> Result<MetadataSettings, String> {
    let conn = state.get_conn()?;
    Ok(tmdb::load_settings(&conn))
}

#[tauri::command]
pub fn save_metadata_settings(
    state: tauri::State<AppState>,
    settings: MetadataSettings,
) -> Result<(), String> {
    let conn = state.get_conn()?;
    tmdb::save_settings(&conn, &settings)
}

// ---- Amélioration audio — spatialisation (FONCTIONNALITÉ) ----------
//
// Réglage global, stocké dans `app_settings` comme l'Accès rapide
// ci-dessous. L'application effective au moteur mpv se fait dans
// `commands::playback::player_load` (à chaque nouveau média) et
// `commands::playback::player_set_audio_spatialization` (immédiat, sur
// le média en cours) — voir `services::playback_engine::set_audio_spatialization`.
const AUDIO_SPATIALIZATION_KEY: &str = "audio_spatialization_enabled";

#[tauri::command]
pub fn get_audio_spatialization_enabled(state: tauri::State<AppState>) -> Result<bool, String> {
    let conn = state.get_conn()?;
    Ok(
        crate::db::repositories::settings_repository::get(&conn, AUDIO_SPATIALIZATION_KEY)
            .map_err(|e| e.to_string())?
            .as_deref()
            == Some("1"),
    )
}

#[tauri::command]
pub fn set_audio_spatialization_enabled(
    state: tauri::State<AppState>,
    enabled: bool,
) -> Result<(), String> {
    let conn = state.get_conn()?;
    crate::db::repositories::settings_repository::set(
        &conn,
        AUDIO_SPATIALIZATION_KEY,
        if enabled { "1" } else { "0" },
    )
    .map_err(|e| e.to_string())
}

// ---- Accès rapide (FONCTIONNALITÉ) --------------------------------
//
// Un profil protégé par mot de passe peut, si ce réglage est activé,
// être ouvert d'un simple clic depuis l'écran de connexion (voir
// `commands::auth::quick_login_profile`). Réglage global (pas par
// profil pour l'instant), stocké dans `app_settings` (non sensible :
// c'est un booléen d'activation, jamais un secret).
//
// N'affecte JAMAIS le Coffre privé, qui dérive sa propre clé de
// chiffrement à partir d'une phrase secrète distincte (voir
// `security::vault`/`security::kdf`) — l'Accès rapide contourne
// uniquement la porte de connexion de PROFIL, pas le chiffrement du
// Coffre.
const QUICK_ACCESS_KEY: &str = "quick_access_enabled";

/// Lisible AVANT connexion — l'écran de login en a besoin pour savoir
/// s'il doit proposer un clic direct sur le profil ou exiger le mot de
/// passe. N'expose rien de sensible (un simple booléen).
#[tauri::command]
pub fn get_quick_access_enabled(state: tauri::State<AppState>) -> Result<bool, String> {
    let conn = state.get_conn()?;
    Ok(
        crate::db::repositories::settings_repository::get(&conn, QUICK_ACCESS_KEY)
            .map_err(|e| e.to_string())?
            .as_deref()
            == Some("1"),
    )
}

/// Modifiable UNIQUEMENT depuis un profil déjà connecté
/// (`read_active_profile_id` échoue sinon) : jamais depuis l'écran de
/// login lui-même, pour qu'un simple accès physique à l'écran de
/// verrouillage ne suffise pas à l'activer soi-même — conformément à la
/// demande (« activable/désactivable uniquement depuis les paramètres
/// utilisateur »).
#[tauri::command]
pub fn set_quick_access_enabled(
    state: tauri::State<AppState>,
    enabled: bool,
) -> Result<(), String> {
    state.read_active_profile_id()?;
    let conn = state.get_conn()?;
    crate::db::repositories::settings_repository::set(
        &conn,
        QUICK_ACCESS_KEY,
        if enabled { "1" } else { "0" },
    )
    .map_err(|e| e.to_string())
}

// ---- Fond d'Accueil personnalisé (0.3.0) -------------------------

/// Fond d'Accueil (0.3.0) : même pattern que l'avatar de profil —
/// image envoyée en bytes, copiée dans app_data/backdrops/, référence
/// dans app_settings (clé "home_backdrop").
#[tauri::command]
pub fn set_home_backdrop(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::state::AppState>,
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
    let conn = state.get_conn()?;
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
pub fn get_home_backdrop(
    state: tauri::State<'_, crate::state::AppState>,
) -> Result<Option<String>, String> {
    use rusqlite::OptionalExtension;
    let conn = state.get_conn()?;
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
pub fn clear_home_backdrop(
    state: tauri::State<'_, crate::state::AppState>,
) -> Result<(), String> {
    use rusqlite::OptionalExtension;
    let conn = state.get_conn()?;
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

// ---- Fond animé (FONCTIONNALITÉ) -----------------------------------
//
// Même principe que le fond d'Accueil ci-dessus (fichier copié dans
// `<données app>/backdrops/`, chemin retenu dans `app_settings`), mais
// pour une VIDÉO qui remplace le fond image partout où `AppBackdrop`
// est affiché (voir components/AppBackdrop.tsx — déjà une couche
// globale, derrière toute l'appli) quand le réglage
// `backdrop_video_enabled` est actif. Vidéo choisie via le sélecteur de
// fichier NATIF (`@tauri-apps/plugin-dialog`, déjà utilisé ailleurs
// dans l'app) plutôt qu'un `<input type="file">` + lecture en octets :
// une vidéo peut peser plusieurs dizaines de Mo, la transférer via l'IPC
// Tauri (JSON) serait lent et gonflerait sa taille en mémoire pour rien
// — le chemin choisi est copié directement sur disque côté Rust.
#[tauri::command]
pub fn set_home_backdrop_video(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::state::AppState>,
    source_path: String,
) -> Result<(), String> {
    use tauri::Manager;
    let src = std::path::Path::new(&source_path);
    let ext = src
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .filter(|e| matches!(e.as_str(), "mp4" | "webm"))
        .ok_or_else(|| "Format vidéo non pris en charge (utilisez .mp4 ou .webm).".to_string())?;
    let metadata = std::fs::metadata(src).map_err(|e| e.to_string())?;
    // 300 Mo : un fond en boucle, pas un film — si votre fichier dépasse
    // cette limite, dites-le, c'est un chiffre choisi arbitrairement et
    // facilement ajustable.
    const MAX_VIDEO_BYTES: u64 = 300 * 1024 * 1024;
    if metadata.len() == 0 || metadata.len() > MAX_VIDEO_BYTES {
        return Err("Vidéo invalide (taille attendue : entre 1 o et 300 Mo).".to_string());
    }
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("backdrops");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let target = dir.join(format!("home_backdrop_video.{ext}"));
    std::fs::copy(src, &target).map_err(|e| e.to_string())?;
    let conn = state.get_conn()?;
    conn.execute(
        "INSERT INTO app_settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        rusqlite::params!["home_backdrop_video", target.to_string_lossy().to_string()],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_home_backdrop_video(
    state: tauri::State<'_, crate::state::AppState>,
) -> Result<Option<String>, String> {
    use rusqlite::OptionalExtension;
    let conn = state.get_conn()?;
    conn.query_row(
        "SELECT value FROM app_settings WHERE key = ?1",
        rusqlite::params!["home_backdrop_video"],
        |row| row.get(0),
    )
    .optional()
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn clear_home_backdrop_video(
    state: tauri::State<'_, crate::state::AppState>,
) -> Result<(), String> {
    use rusqlite::OptionalExtension;
    let conn = state.get_conn()?;
    let existing: Option<String> = conn
        .query_row(
            "SELECT value FROM app_settings WHERE key = ?1",
            rusqlite::params!["home_backdrop_video"],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    if let Some(path) = existing {
        let _ = std::fs::remove_file(path);
    }
    conn.execute(
        "DELETE FROM app_settings WHERE key = ?1",
        rusqlite::params!["home_backdrop_video"],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Réglage global : quand actif, `AppBackdrop` affiche la vidéo au lieu
/// de l'image (le fond vidéo remplace le fond image partout — c'est LE
/// fond par défaut du logiciel tant qu'il est activé). Un futur réglage
/// pourra affiner, page par page, lequel des deux s'applique — pas
/// nécessaire pour cette première version.
#[tauri::command]
pub fn get_backdrop_video_enabled(state: tauri::State<AppState>) -> Result<bool, String> {
    let conn = state.get_conn()?;
    Ok(
        crate::db::repositories::settings_repository::get(&conn, "backdrop_video_enabled")
            .map_err(|e| e.to_string())?
            .as_deref()
            == Some("1"),
    )
}

#[tauri::command]
pub fn set_backdrop_video_enabled(
    state: tauri::State<AppState>,
    enabled: bool,
) -> Result<(), String> {
    let conn = state.get_conn()?;
    crate::db::repositories::settings_repository::set(
        &conn,
        "backdrop_video_enabled",
        if enabled { "1" } else { "0" },
    )
    .map_err(|e| e.to_string())
}

/// Bande-annonce d'un Titre (0.3.0) : liste de clés YouTube des trailers
/// officiels via TMDB (triés par priorité) — le frontend essaiera la
/// première, puis la suivante en cas d'erreur (fallback automatique).
/// Liste vide si pas de clé TMDB, pas de tmdb_id, pas de trailer
/// ou pas de réseau.
#[tauri::command]
pub fn get_title_trailer(
    state: tauri::State<'_, crate::state::AppState>,
    title_id: i64,
) -> Result<Vec<String>, String> {
    use rusqlite::OptionalExtension;
    let conn = state.get_conn()?;
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
        return Ok(Vec::new());
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

// ---- Typographie personnalisée (0.5.4) ---------------------------

/// 0.5.4 — typographie personnalisée (4 familles remplaçables :
/// display / ui / body / mono), persistée dans app_settings.
/// ⚠️ UNE SEULE définition de chaque commande : le doublon précédent
/// (copie collée deux fois) provoquait E0428 + E0433.
#[tauri::command]
pub fn get_typography_settings(
    state: tauri::State<'_, crate::state::AppState>,
) -> Result<serde_json::Value, String> {
    let conn = state.db_pool.get().map_err(|e| e.to_string())?;
    let get = |key: &str, default: &str| -> String {
        crate::db::repositories::settings_repository::get(&conn, key)
            .ok()
            .flatten()
            .unwrap_or_else(|| default.to_string())
    };
    Ok(serde_json::json!({
        "display": get("typography_display", "Panchang"),
        "ui": get("typography_ui", "Panchang"),
        "body": get("typography_body", "Space Grotesk"),
        "mono": get("typography_mono", "Space Grotesk"),
    }))
}

#[tauri::command]
pub fn save_typography_settings(
    state: tauri::State<'_, crate::state::AppState>,
    display: String,
    ui: String,
    body: String,
    mono: String,
) -> Result<(), String> {
    let conn = state.db_pool.get().map_err(|e| e.to_string())?;
    let set = |key: &str, value: &str| -> Result<(), String> {
        crate::db::repositories::settings_repository::set(&conn, key, value)
            .map_err(|e| e.to_string())
    };
    set("typography_display", &display)?;
    set("typography_ui", &ui)?;
    set("typography_body", &body)?;
    set("typography_mono", &mono)
}