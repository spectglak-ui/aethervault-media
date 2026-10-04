//! Commandes Tauri de la catégorie Lecture (0.7.0). Aucune donnée n'est
//! chiffrée ici (catégorie publique) : base `aethervault.db` classique.
use crate::db::repositories::reading_repository::{
    self, ContinueReadingRecord, ReadingBookRecord, ReadingLibraryRecord, ReadingProgressRecord,
};
use crate::services::reading_scanner::{self, ReadingScanSummary};
use crate::state::AppState;
use std::path::PathBuf;

fn cache_pages_dir(state: &AppState, book_id: i64) -> PathBuf {
    let dir = PathBuf::from(&state.data_dir)
        .join("cache")
        .join("reading")
        .join("pages")
        .join(book_id.to_string());
    let _ = std::fs::create_dir_all(&dir);
    dir
}

/// Macro utilitaire : obtient une connexion depuis le pool, la lie à un
/// nom local (`conn`) et évalue le bloc. Le pool (et donc la connexion)
/// vit jusqu'à la fin du bloc — suffisant pour toutes ces commandes
/// brèves. La macro renvoie directement ce que produit le bloc (un
/// `Result<..., String>` dans tous les cas ci-dessous).
macro_rules! with_conn {
    ($state:expr, $conn:ident, $body:block) => {{
        let pooled = $state.get_conn()?;
        let $conn: &rusqlite::Connection = &pooled;
        $body
    }};
}

#[tauri::command]
pub fn reading_list_libraries(
    state: tauri::State<AppState>,
) -> Result<Vec<ReadingLibraryRecord>, String> {
    with_conn!(state, conn, {
        reading_repository::list_libraries(conn).map_err(|e| e.to_string())
    })
}

#[tauri::command]
pub fn reading_create_library(
    state: tauri::State<AppState>,
    name: String,
    kind: String,
) -> Result<i64, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("Le nom de la bibliothèque ne peut pas être vide.".to_string());
    }
    let allowed = ["manga", "webtoon", "bd", "roman", "custom"];
    if !allowed.contains(&kind.as_str()) {
        return Err("Type de bibliothèque invalide.".to_string());
    }
    with_conn!(state, conn, {
        reading_repository::create_library(conn, trimmed, &kind).map_err(|e| e.to_string())
    })
}

#[tauri::command]
pub fn reading_rename_library(
    state: tauri::State<AppState>,
    library_id: i64,
    name: String,
) -> Result<(), String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("Nom vide.".to_string());
    }
    with_conn!(state, conn, {
        reading_repository::rename_library(conn, library_id, trimmed).map_err(|e| e.to_string())
    })
}

#[tauri::command]
pub fn reading_delete_library(
    state: tauri::State<AppState>,
    library_id: i64,
) -> Result<(), String> {
    with_conn!(state, conn, {
        reading_repository::delete_library(conn, library_id).map_err(|e| e.to_string())
    })
}

#[tauri::command]
pub fn reading_add_folder(
    state: tauri::State<AppState>,
    app: tauri::AppHandle,
    library_id: i64,
    path: String,
) -> Result<ReadingScanSummary, String> {
    if !PathBuf::from(&path).is_dir() {
        return Err("Le chemin choisi n'est pas un dossier accessible.".to_string());
    }
    let data_dir = state.data_dir.clone();
    with_conn!(state, conn, {
        reading_repository::create_folder(conn, library_id, &path).map_err(|e| e.to_string())?;
        reading_scanner::scan_library(conn, library_id, &PathBuf::from(&data_dir), &app)
    })
}

#[tauri::command]
pub fn reading_remove_folder(
    state: tauri::State<AppState>,
    folder_id: i64,
) -> Result<(), String> {
    with_conn!(state, conn, {
        reading_repository::delete_folder(conn, folder_id).map_err(|e| e.to_string())
    })
}

#[tauri::command]
pub fn reading_scan_library(
    state: tauri::State<AppState>,
    app: tauri::AppHandle,
    library_id: i64,
) -> Result<ReadingScanSummary, String> {
    let data_dir = state.data_dir.clone();
    with_conn!(state, conn, {
        reading_scanner::scan_library(conn, library_id, &PathBuf::from(&data_dir), &app)
    })
}

#[tauri::command]
pub fn reading_list_books(
    state: tauri::State<AppState>,
    library_id: i64,
) -> Result<Vec<ReadingBookRecord>, String> {
    with_conn!(state, conn, {
        reading_repository::list_books_by_library(conn, library_id).map_err(|e| e.to_string())
    })
}

#[tauri::command]
pub fn reading_get_book(
    state: tauri::State<AppState>,
    book_id: i64,
) -> Result<ReadingBookRecord, String> {
    with_conn!(state, conn, {
        reading_repository::get_book(conn, book_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Livre introuvable.".to_string())
    })
}

/// Renvoie le chemin CACHE d'une page (extraction paresseuse) — le
/// frontend le convertit en URL asset via convertFileSrc. Résolution
/// native conservée (haute résolution par défaut).
#[tauri::command]
pub fn reading_get_page(
    state: tauri::State<AppState>,
    book_id: i64,
    page_index: i64,
) -> Result<String, String> {
    let book = with_conn!(state, conn, {
        reading_repository::get_book(conn, book_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Livre introuvable.".to_string())
    })?;
    let book_path = PathBuf::from(&book.path);
    let dir = cache_pages_dir(&state, book_id);
    match book.format.as_str() {
        "folder" => {
            let pages = reading_scanner::folder_images(&book_path)?;
            let src = pages
                .get(page_index as usize)
                .ok_or_else(|| "Page hors limites.".to_string())?;
            let ext = src
                .extension()
                .map(|e| e.to_string_lossy().to_string())
                .unwrap_or_else(|| "jpg".into());
            let dest = dir.join(format!("{page_index}.{ext}"));
            if !dest.exists() {
                std::fs::copy(src, &dest).map_err(|e| e.to_string())?;
            }
            Ok(dest.to_string_lossy().to_string())
        }
        _ => {
            let names = reading_scanner::zip_image_entries(&book_path)?;
            let name = names
                .get(page_index as usize)
                .ok_or_else(|| "Page hors limites.".to_string())?;
            let ext = name.rsplit('.').next().unwrap_or("jpg").to_lowercase();
            let dest = dir.join(format!("{page_index}.{ext}"));
            if !dest.exists() {
                let bytes = reading_scanner::read_zip_entry(&book_path, name)?;
                std::fs::write(&dest, bytes).map_err(|e| e.to_string())?;
            }
            Ok(dest.to_string_lossy().to_string())
        }
    }
}

#[tauri::command]
pub fn reading_get_progress(
    state: tauri::State<AppState>,
    book_id: i64,
) -> Result<Option<ReadingProgressRecord>, String> {
    let profile_id = state.read_active_profile_id()?;
    with_conn!(state, conn, {
        reading_repository::get_progress(conn, profile_id, book_id).map_err(|e| e.to_string())
    })
}

#[tauri::command]
pub fn reading_save_progress(
    state: tauri::State<AppState>,
    book_id: i64,
    current_page: i64,
    total_pages: i64,
    completed: bool,
) -> Result<(), String> {
    let profile_id = state.read_active_profile_id()?;
    with_conn!(state, conn, {
        reading_repository::upsert_progress(
            conn,
            profile_id,
            book_id,
            current_page,
            total_pages,
            completed,
        )
        .map_err(|e| e.to_string())
    })
}

#[tauri::command]
pub fn reading_list_continue(
    state: tauri::State<AppState>,
    limit: i64,
) -> Result<Vec<ContinueReadingRecord>, String> {
    let profile_id = state.read_active_profile_id()?;
    with_conn!(state, conn, {
        reading_repository::list_continue(conn, profile_id, limit).map_err(|e| e.to_string())
    })
}

#[tauri::command]
pub fn reading_get_settings(state: tauri::State<AppState>) -> Result<Option<String>, String> {
    let profile_id = state.read_active_profile_id()?;
    with_conn!(state, conn, {
        reading_repository::get_settings(conn, profile_id).map_err(|e| e.to_string())
    })
}

#[tauri::command]
pub fn reading_save_settings(
    state: tauri::State<AppState>,
    settings_json: String,
) -> Result<(), String> {
    let profile_id = state.read_active_profile_id()?;
    with_conn!(state, conn, {
        reading_repository::save_settings(conn, profile_id, &settings_json)
            .map_err(|e| e.to_string())
    })
}