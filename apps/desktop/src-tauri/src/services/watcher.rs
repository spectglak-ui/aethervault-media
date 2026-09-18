//! Filesystem Watcher (Étape 2b) : surveille en continu les dossiers des
//! bibliothèques et répercute les changements sans attendre un scan manuel.
//!
//! ⚠️ Choix technique documenté : la bibliothèque `notify-debouncer-full`
//! (évoquée dans la documentation initiale) propose un regroupement
//! d'événements "prêt à l'emploi", mais son type `Debouncer<Watcher, Cache>`
//! et le nom exact de son cache par défaut n'ont pas pu être vérifiés par
//! compilation dans mon environnement (pas de réseau ni de toolchain Rust
//! ici) — un mauvais paramètre générique aurait bloqué toute la
//! compilation. J'ai donc préféré une implémentation faite à la main, mais
//! reposant uniquement sur l'API historique et stable de `notify`
//! (`Watcher`, `Event`, `RecommendedWatcher`, `RecursiveMode`), sur laquelle
//! j'ai une confiance nettement plus grande. Le regroupement ("debounce")
//! est fait ci-dessous par un simple buffer + fenêtre de silence.
//!
//! ⚠️ Autre limite documentée, héritée de l'Étape 2a et non résolue ici :
//! la distinction "fichier réellement supprimé" vs "dossier devenu
//! inaccessible" repose sur `chemin.exists()`, pas sur un identifiant de
//! volume stable (numéro de série de disque). Un renommage de lettre de
//! lecteur entre deux branchements reste un cas non couvert.

use crate::db::repositories::{folder_repository, media_repository};
use crate::db::DbPool;
use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::mpsc::RecvTimeoutError;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

const VIDEO_EXTENSIONS: &[&str] = &[
    "mp4", "mkv", "avi", "mov", "webm", "m4v", "wmv", "flv", "mpg", "mpeg", "ts",
];

/// Fenêtre de silence à attendre après le dernier événement reçu avant de
/// traiter le lot accumulé — regroupe les rafales d'une copie massive de
/// fichiers en une seule mise à jour plutôt que d'en traiter des centaines
/// une par une.
const DEBOUNCE_WINDOW: Duration = Duration::from_millis(800);
/// Fréquence à laquelle la boucle vérifie "y a-t-il eu assez de silence ?".
const POLL_INTERVAL: Duration = Duration::from_millis(250);

/// Ensemble des identifiants de bibliothèque actuellement en cours de
/// traitement (scan complet OU application d'un lot d'événements du
/// watcher) — empêche deux opérations concurrentes sur la même
/// bibliothèque, quelle que soit leur origine.
pub type ScanningLibraries = Arc<Mutex<HashSet<i64>>>;

fn is_video_file(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| VIDEO_EXTENSIONS.contains(&ext.to_lowercase().as_str()))
        .unwrap_or(false)
}

/// Détient le watcher natif. Conservé dans l'état de l'application pour
/// pouvoir ajouter/retirer des dossiers surveillés au fil de l'eau (voir
/// `commands::library`), sans jamais recréer le watcher lui-même.
pub struct WatcherHandle {
    watcher: Mutex<RecommendedWatcher>,
}

impl WatcherHandle {
    pub fn watch(&self, path: &str) {
        match self.watcher.lock() {
            Ok(mut watcher) => {
                if let Err(err) = watcher.watch(Path::new(path), RecursiveMode::Recursive) {
                    log::warn!("Impossible de surveiller le dossier {path} : {err}");
                }
            }
            Err(err) => log::warn!("Verrou du watcher empoisonné, surveillance ignorée : {err}"),
        }
    }

    pub fn unwatch(&self, path: &str) {
        if let Ok(mut watcher) = self.watcher.lock() {
            // Erreur ignorée : le dossier a pu devenir inaccessible avant
            // qu'on ait pu le retirer proprement, ce qui n'est pas un
            // problème en soi (il n'y a simplement plus rien à retirer).
            let _ = watcher.unwatch(Path::new(path));
        }
    }
}

/// Réserve une bibliothèque pour un traitement exclusif (scan complet ou
/// application d'un lot d'événements). Renvoie `false` si elle est déjà
/// réservée par une autre opération en cours — c'est la garantie "pas deux
/// scans simultanés sur la même bibliothèque" demandée pour cette étape.
pub fn try_start(scanning_libraries: &ScanningLibraries, library_id: i64) -> bool {
    let mut guard = scanning_libraries
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if guard.contains(&library_id) {
        false
    } else {
        guard.insert(library_id);
        true
    }
}

/// Libère la réservation posée par `try_start`.
pub fn finish(scanning_libraries: &ScanningLibraries, library_id: i64) {
    let mut guard = scanning_libraries
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    guard.remove(&library_id);
}

/// Démarre la surveillance de tous les dossiers actuellement connus et
/// renvoie un `WatcherHandle` à conserver dans l'état de l'application.
pub fn start(
    pool: DbPool,
    app_handle: AppHandle,
    scanning_libraries: ScanningLibraries,
) -> notify::Result<Arc<WatcherHandle>> {
    let (tx, rx) = std::sync::mpsc::channel::<notify::Result<Event>>();

    let watcher = notify::recommended_watcher(move |res| {
        // L'envoi ne peut échouer que si la boucle de traitement s'est
        // arrêtée (fin de vie de l'application) : sans conséquence.
        let _ = tx.send(res);
    })?;

    let handle = Arc::new(WatcherHandle {
        watcher: Mutex::new(watcher),
    });

    match pool.get() {
        Ok(conn) => match folder_repository::list_all(&conn) {
            Ok(folders) => {
                for folder in &folders {
                    handle.watch(&folder.path);
                }
                log::info!("Surveillance démarrée pour {} dossier(s).", folders.len());
            }
            Err(err) => {
                log::warn!("Impossible de charger les dossiers à surveiller au démarrage : {err}")
            }
        },
        Err(err) => {
            log::warn!("Connexion base de données indisponible au démarrage du watcher : {err}")
        }
    }

    let processing_handle = app_handle.clone();
    std::thread::spawn(move || {
        run_debounce_loop(rx, pool, processing_handle, scanning_libraries);
    });

    Ok(handle)
}

/// Boucle de fond : accumule les chemins touchés, attend une fenêtre de
/// silence (`DEBOUNCE_WINDOW`), puis applique le lot en une fois. Tourne
/// jusqu'à ce que le canal soit fermé (fin de l'application).
fn run_debounce_loop(
    rx: std::sync::mpsc::Receiver<notify::Result<Event>>,
    pool: DbPool,
    app_handle: AppHandle,
    scanning_libraries: ScanningLibraries,
) {
    let mut pending: HashMap<PathBuf, EventKind> = HashMap::new();
    let mut last_event_at = Instant::now();

    loop {
        match rx.recv_timeout(POLL_INTERVAL) {
            Ok(Ok(event)) => {
                for path in event.paths {
                    pending.insert(path, event.kind.clone());
                }
                last_event_at = Instant::now();
            }
            Ok(Err(err)) => {
                log::warn!("Erreur de surveillance de fichiers : {err}");
            }
            Err(RecvTimeoutError::Timeout) => {
                if !pending.is_empty() && last_event_at.elapsed() >= DEBOUNCE_WINDOW {
                    let batch = std::mem::take(&mut pending);
                    apply_batch(&pool, &app_handle, &scanning_libraries, batch);
                }
            }
            Err(RecvTimeoutError::Disconnected) => break,
        }
    }
}

/// Applique un lot d'événements déjà regroupé : un seul fichier ajouté,
/// modifié ou supprimé ne déclenche la mise à jour que de CE fichier —
/// jamais un nouveau parcours complet de la bibliothèque (contrairement à
/// `services::scanner::scan_library`, réservé au scan manuel/initial).
fn apply_batch(
    pool: &DbPool,
    app_handle: &AppHandle,
    scanning_libraries: &ScanningLibraries,
    events: HashMap<PathBuf, EventKind>,
) {
    let conn = match pool.get() {
        Ok(conn) => conn,
        Err(err) => {
            log::warn!("Connexion base de données indisponible pour le watcher : {err}");
            return;
        }
    };

    let folders = match folder_repository::list_all(&conn) {
        Ok(folders) => folders,
        Err(err) => {
            log::warn!("Impossible de lister les dossiers surveillés : {err}");
            return;
        }
    };

    let mut affected_libraries: HashSet<i64> = HashSet::new();

    for (path, _kind) in events {
        let Some(folder) = folders.iter().find(|f| path.starts_with(&f.path)) else {
            // Événement hors de tout dossier connu (ex. dossier retiré
            // entre-temps) : rien à faire.
            continue;
        };

        // Empêche ce traitement de chevaucher un scan complet de la même
        // bibliothèque. Si un scan tourne déjà, on laisse tomber cet
        // événement pour ce lot : il se corrigera au prochain événement ou
        // au prochain scan manuel — préférable à un blocage ou une
        // écriture concurrente mal maîtrisée.
        if !try_start(scanning_libraries, folder.library_id) {
            log::debug!(
                "Bibliothèque {} déjà en cours de traitement, événement ignoré pour ce lot.",
                folder.library_id
            );
            continue;
        }

        if !Path::new(&folder.path).exists() {
            // Le dossier entier a disparu (débranchement) : on marque tout
            // indisponible en une fois plutôt que de traiter les fichiers
            // un par un.
            let _ = media_repository::mark_folder_unavailable(&conn, folder.id);
        } else if path.exists() && is_video_file(&path) {
            if let Ok(metadata) = std::fs::metadata(&path) {
                let size_bytes = metadata.len() as i64;
                let modified_at = metadata
                    .modified()
                    .map(|time| chrono::DateTime::<chrono::Utc>::from(time).to_rfc3339())
                    .unwrap_or_else(|_| chrono::Utc::now().to_rfc3339());
                let file_name = path
                    .file_name()
                    .map(|name| name.to_string_lossy().to_string())
                    .unwrap_or_default();
                let path_string = path.to_string_lossy().to_string();

                let _ = media_repository::upsert(
                    &conn,
                    folder.library_id,
                    folder.id,
                    &path_string,
                    &file_name,
                    size_bytes,
                    &modified_at,
                );
            }
        } else {
            // Le dossier existe toujours, mais ce chemin précis n'existe
            // plus : suppression réelle et ciblée (pas juste indisponible,
            // et pas un nouveau parcours complet du dossier).
            let path_string = path.to_string_lossy().to_string();
            let _ = media_repository::remove_by_path(&conn, &path_string);
        }

        finish(scanning_libraries, folder.library_id);
        affected_libraries.insert(folder.library_id);
    }

    for library_id in affected_libraries {
        let _ = app_handle.emit("library:updated", library_id);
    }
}
