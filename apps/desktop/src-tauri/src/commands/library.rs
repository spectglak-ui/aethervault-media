//! Commandes de gestion des bibliothèques : de simples wrappers autour de
//! `domain::library`, `services::scanner`, `services::watcher` et
//! `services::metadata` — aucune règle métier ni SQL direct ici.

use crate::db::repositories::media_repository::{self, MediaFileRecord};
use crate::domain::library::{self, FolderSummary, LibrarySummary};
use crate::services::metadata::MetadataService;
use crate::services::{scanner, watcher};
use crate::state::AppState;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};

#[tauri::command]
pub fn list_libraries(state: tauri::State<AppState>) -> Result<Vec<LibrarySummary>, String> {
    library::list_libraries(&state.db_pool)
}

#[tauri::command]
pub fn create_library(
    state: tauri::State<AppState>,
    name: String,
    category_id: i64,
    icon: Option<String>,
    accent_color: Option<String>,
) -> Result<i64, String> {
    library::create_library(
        &state.db_pool,
        &name,
        category_id,
        icon.as_deref(),
        accent_color.as_deref(),
    )
}

/// Supprime la bibliothèque et arrête de surveiller tous ses dossiers — il
/// faut récupérer leurs chemins *avant* la suppression en base (la
/// cascade `ON DELETE CASCADE` les aura sinon déjà effacés).
#[tauri::command]
pub fn delete_library(state: tauri::State<AppState>, library_id: i64) -> Result<(), String> {
    let folders = library::list_folders(&state.db_pool, library_id)?;
    library::delete_library(&state.db_pool, library_id)?;

    for folder in folders {
        state.watcher.unwatch(&folder.path);
    }

    Ok(())
}

#[tauri::command]
pub fn list_library_folders(
    state: tauri::State<AppState>,
    library_id: i64,
) -> Result<Vec<FolderSummary>, String> {
    library::list_folders(&state.db_pool, library_id)
}

/// Ouvre le sélecteur de dossier natif de l'OS et attend la réponse de
/// l'utilisateur. L'API du plugin est basée sur un callback ; on la relie à
/// un canal synchrone pour renvoyer un `Result` classique à l'appelant, en
/// s'appuyant sur le fait que Tauri exécute les commandes non-`async` sur un
/// pool de threads dédié (un `recv()` bloquant ici ne gèle donc pas
/// l'interface).
#[tauri::command]
pub fn pick_folder(app: AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    let (tx, rx) = std::sync::mpsc::channel();
    app.dialog().file().pick_folder(move |result| {
        let _ = tx.send(result);
    });

    let picked = rx.recv().map_err(|e| e.to_string())?;
    Ok(picked.map(|path| path.to_string()))
}

#[tauri::command]
pub fn add_library_folder(
    app: AppHandle,
    state: tauri::State<AppState>,
    library_id: i64,
    path: String,
) -> Result<i64, String> {
    let folder_id = library::add_folder(&state.db_pool, library_id, &path)?;
    state.watcher.watch(&path);

    // Analyse immédiate du dossier qui vient d'être ajouté, pour ne pas
    // laisser la bibliothèque vide en attendant une action manuelle. Si un
    // scan est déjà en cours pour cette bibliothèque (cas rare), on ne
    // bloque pas l'ajout du dossier pour autant : il sera pris en compte au
    // prochain scan ou dès le premier événement du watcher sur ce dossier.
    if watcher::try_start(&state.scanning_libraries, library_id) {
        trigger_scan(
            app,
            state.db_pool.clone(),
            state.scanning_libraries.clone(),
            state.metadata_service.clone(),
            library_id,
        );
    }

    Ok(folder_id)
}

/// Retire le dossier et arrête de le surveiller (le chemin est renvoyé par
/// `remove_folder` avant suppression, voir `folder_repository::delete`).
#[tauri::command]
pub fn remove_library_folder(state: tauri::State<AppState>, folder_id: i64) -> Result<(), String> {
    if let Some(path) = library::remove_folder(&state.db_pool, folder_id)? {
        state.watcher.unwatch(&path);
    }
    Ok(())
}

#[tauri::command]
pub fn list_media_files(
    state: tauri::State<AppState>,
    library_id: i64,
) -> Result<Vec<MediaFileRecord>, String> {
    let conn = state.db_pool.get().map_err(|e| e.to_string())?;
    media_repository::list_by_library(&conn, library_id).map_err(|e| e.to_string())
}

/// Un seul fichier par id — utilisé par les pages Titre/Épisode (Étape 4)
/// pour retrouver le chemin à lire à partir de `media_file_id`, sans que
/// `domain::title` ait à porter cette responsabilité (séparation entre
/// métadonnées de contenu et accès au fichier physique).
#[tauri::command]
pub fn get_media_file(
    state: tauri::State<AppState>,
    media_file_id: i64,
) -> Result<MediaFileRecord, String> {
    let conn = state.db_pool.get().map_err(|e| e.to_string())?;
    media_repository::get(&conn, media_file_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Fichier média {media_file_id} introuvable"))
}

/// Déclenche un scan complet. Renvoie une erreur explicite plutôt que de
/// démarrer un second scan si un traitement est déjà en cours pour cette
/// bibliothèque (scan manuel précédent, ou lot d'événements du watcher) —
/// c'est une action utilisateur délibérée, elle mérite un retour clair
/// plutôt qu'un échec silencieux.
#[tauri::command]
pub fn scan_library(app: AppHandle, state: tauri::State<AppState>, library_id: i64) -> Result<(), String> {
    if !watcher::try_start(&state.scanning_libraries, library_id) {
        return Err("Un scan est déjà en cours pour cette bibliothèque.".to_string());
    }

    trigger_scan(
        app,
        state.db_pool.clone(),
        state.scanning_libraries.clone(),
        state.metadata_service.clone(),
        library_id,
    );
    Ok(())
}

/// Lance un scan dans un thread dédié et notifie le frontend par événement
/// une fois terminé — jamais sur le thread de la commande elle-même, pour
/// ne jamais bloquer l'interface le temps d'un parcours de disque.
///
/// Suppose que la bibliothèque a déjà été réservée via `watcher::try_start`
/// par l'appelant ; libère systématiquement la réservation à la fin, succès
/// ou échec.
///
/// Une fois le scan terminé avec succès, enchaîne dans le **même** thread
/// d'arrière-plan avec le Metadata Service (Étape 4, doc §6.3) : les
/// nouveaux fichiers découverts sont aussitôt rattachés à un Titre/Épisode,
/// plutôt que de laisser la bibliothèque affichée avec des fichiers bruts
/// en attendant une action manuelle distincte — même philosophie que
/// l'analyse immédiate d'un dossier fraîchement ajouté (voir
/// `add_library_folder`). Un événement séparé (`library:metadata-matched`)
/// signale cette seconde étape : elle reste conceptuellement distincte du
/// scan (File Scanner ↔ Metadata Service, doc §4.2), même si elle
/// s'enchaîne automatiquement ici.
fn trigger_scan(
    app: AppHandle,
    pool: crate::db::DbPool,
    scanning_libraries: watcher::ScanningLibraries,
    metadata_service: Arc<MetadataService>,
    library_id: i64,
) {
    std::thread::spawn(move || {
        let result = scanner::scan_library(&pool, library_id, &app);
        watcher::finish(&scanning_libraries, library_id);

        match result {
            Ok(summary) => {
                let _ = app.emit("library:scan-complete", summary);
                match_library_metadata(&app, &pool, &metadata_service, library_id);
            }
            Err(err) => {
                log::error!("Échec du scan de la bibliothèque {library_id} : {err}");
                let _ = app.emit("library:scan-error", err.to_string());
            }
        }
    });
}

/// Voir `trigger_scan` — appelée après chaque scan réussi, mais aussi
/// exposée telle quelle via la commande `match_library_metadata` pour
/// permettre de relancer l'appariement sans repasser par un scan complet
/// (ex. après l'ajout d'un futur fournisseur en ligne).
fn match_library_metadata(
    app: &AppHandle,
    pool: &crate::db::DbPool,
    metadata_service: &MetadataService,
    library_id: i64,
) {
    let conn = match pool.get() {
        Ok(conn) => conn,
        Err(err) => {
            log::error!(
                "Connexion base de données indisponible pour l'appariement de métadonnées : {err}"
            );
            return;
        }
    };

    let library = match crate::db::repositories::library_repository::get(&conn, library_id) {
        Ok(Some(library)) => library,
        Ok(None) => {
            log::warn!("Bibliothèque {library_id} introuvable, appariement de métadonnées ignoré.");
            return;
        }
        Err(err) => {
            log::error!("Impossible de lire la bibliothèque {library_id} : {err}");
            return;
        }
    };

    // Libère explicitement cette connexion avant d'en reprendre une via
    // `metadata_service.match_library` (qui repioche dans le même pool) —
    // ne coûte rien et évite toute dépendance à la taille du pool.
    drop(conn);

    let Some(category_id) = library.category_id else {
        log::warn!("Bibliothèque {library_id} sans catégorie, appariement de métadonnées ignoré.");
        return;
    };

    match metadata_service.match_library(pool, library_id, category_id) {
        Ok(summary) => {
            let _ = app.emit("library:metadata-matched", summary);
        }
        Err(err) => {
            log::error!(
                "Échec de l'appariement de métadonnées pour la bibliothèque {library_id} : {err}"
            );
        }
    }
}

/// Relance explicitement l'appariement de métadonnées d'une bibliothèque,
/// sans repasser par un scan complet — utile après l'ajout d'un futur
/// fournisseur en ligne, ou pour retenter les fichiers restés orphelins.
#[tauri::command]
pub fn match_library_metadata_command(
    app: AppHandle,
    state: tauri::State<AppState>,
    library_id: i64,
) -> Result<(), String> {
    let metadata_service = state.metadata_service.clone();
    let pool = state.db_pool.clone();
    match_library_metadata(&app, &pool, &metadata_service, library_id);
    Ok(())
}
