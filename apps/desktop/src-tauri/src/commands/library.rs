//! Commandes de gestion des bibliothèques : de simples wrappers autour de
//! `domain::library`, `services::scanner`, `services::watcher` et
//! `services::metadata` — aucune règle métier ni SQL direct ici.
use crate::db::repositories::media_repository::{self, MediaFileRecord};
use crate::domain::library::{self, FolderSummary, LibrarySummary};
use crate::services::episode_thumbnails;
use crate::services::metadata::MetadataService;
use crate::services::playback_engine::MpvFunctions;
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
/// faut récupérer leurs chemins avant la suppression en base (la
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
            state.data_dir.clone(),
            state.playback_engine.handle().ok().map(|h| h.mpv_functions()),
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
    let conn = state.get_conn()?;
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
    let conn = state.get_conn()?;
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
        state.data_dir.clone(),
        state.playback_engine.handle().ok().map(|h| h.mpv_functions()),
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
/// Une fois le scan terminé avec succès, enchaîne dans le même thread
/// d'arrière-plan avec le Metadata Service (Étape 4, doc §6.3), puis avec
/// la génération des vignettes d'épisodes (Étape 6d) : les nouveaux
/// fichiers découverts sont aussitôt rattachés à un Titre/Épisode ET
/// illustrés d'une miniature, plutôt que de laisser la bibliothèque
/// affichée avec des fichiers bruts en attendant une action manuelle.
fn trigger_scan(
    app: AppHandle,
    pool: crate::db::DbPool,
    scanning_libraries: watcher::ScanningLibraries,
    metadata_service: Arc<MetadataService>,
    data_dir: String,
    mpv_functions: Option<Arc<MpvFunctions>>,
    library_id: i64,
) {
    std::thread::spawn(move || {
        let result = scanner::scan_library(&pool, library_id, &app);
        watcher::finish(&scanning_libraries, library_id);
        match result {
                        Ok(summary) => {
                let _ = app.emit("library:scan-complete", summary);
                match_library_metadata(
                    &app,
                    &pool,
                    &metadata_service,
                    library_id,
                    data_dir,
                    mpv_functions,
                );
                // Fin de TOUTE la chaîne scan → appariement → vignettes :
                // signal unique pour que le frontend masque sa barre de
                // progression (Étape 6d).
                let _ = app.emit(
                    "library:scan-progress",
                    serde_json::json!({ "library_id": library_id, "phase": "done" }),
                );
            }
            Err(err) => {
                log::error!("Échec du scan de la bibliothèque {library_id} : {err}");
                let _ = app.emit("library:scan-error", err.to_string());
                let _ = app.emit(
                    "library:scan-progress",
                    serde_json::json!({ "library_id": library_id, "phase": "done" }),
                );
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
    data_dir: String,
    mpv_functions: Option<Arc<MpvFunctions>>,
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
    // Phase 2 de la barre de progression (Étape 6d) : l'appariement est
    // rapide mais pas instantané sur les grosses bibliothèques — signalé
    // comme phase indéterminée.
    let _ = app.emit(
        "library:scan-progress",
        serde_json::json!({
            "library_id": library_id,
            "phase": "metadata",
            "processed": 0,
            "total": 0,
            "current": "",
        }),
    );
    match metadata_service.match_library(pool, library_id, category_id) {
                        Ok(summary) => {
            let _ = app.emit("library:metadata-matched", summary);
            // Étape 7 : enrichissement TMDB (Titres sans tmdb_id), si
            // l'option est active et une clé présente — best-effort,
            // avant les vignettes.
            let auto = pool
                .get()
                .ok()
                .map(|conn| crate::services::metadata::tmdb::load_settings(&conn).auto_enrich)
                .unwrap_or(false);
            if auto {
                crate::services::metadata::tmdb::enrich_library(app, pool, &data_dir, library_id);
            }
            // Étape 6d (cadrage produit, choix utilisateur) : vignettes
            // automatiques RÉSERVÉES aux catégories Séries et Anime.
            // Les Films n'ont pas d'épisodes (rien à générer de toute
            // façon) ; les Documentaires à épisodes sont explicitement
            // exclus ; les vidéos privées ont leur propre pipeline
            // chiffré, traité séparément (Étape 6d-privé, à suivre).
            let allowed = pool
                .get()
                .ok()
                .and_then(|conn| {
                    crate::db::repositories::category_repository::get(&conn, category_id)
                        .ok()
                        .flatten()
                })
                .map(|category| matches!(category.key.as_str(), "series" | "anime"))
                .unwrap_or(false);
                        if allowed {
                episode_thumbnails::generate_missing(
                    app,
                    pool,
                    &data_dir,
                    mpv_functions.clone(),
                    library_id,
                );
            }
            // Étape 7 (lot 2) : sonde technique (résolution/codec/langues/
            // sous-titres) des fichiers non sondés — TOUTES les catégories
            // publiques (Films compris), best-effort, avant le signal
            // « done » de la chaîne scan → appariement → vignettes → probe.
            crate::services::media_probe::probe_missing(app, pool, mpv_functions, library_id);
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
    let data_dir = state.data_dir.clone();
    let mpv_functions = state.playback_engine.handle().ok().map(|h| h.mpv_functions());
        match_library_metadata(&app, &pool, &metadata_service, library_id, data_dir, mpv_functions);
    let _ = app.emit(
        "library:scan-progress",
        serde_json::json!({ "library_id": library_id, "phase": "done" }),
    );
    Ok(())
}

/// Étape 6d : relance manuellement la génération des vignettes d'épisodes
/// d'une bibliothèque — rattrapage des fichiers scannés AVANT cette étape
/// (leurs épisodes ont `still_path` NULL) ou des échecs précédents. Même
/// pipeline que le post-scan, dans un thread dédié.
#[tauri::command]
pub fn generate_episode_thumbnails(
    app: AppHandle,
    state: tauri::State<AppState>,
    library_id: i64,
) -> Result<(), String> {
    let pool = state.db_pool.clone();
    let data_dir = state.data_dir.clone();
    let mpv_functions = state.playback_engine.handle().ok().map(|h| h.mpv_functions());
    std::thread::spawn(move || {
        episode_thumbnails::generate_missing(&app, &pool, &data_dir, mpv_functions, library_id);
    });
    Ok(())
}