//! État partagé de l'application (`tauri::State`).

use crate::db::DbPool;
use crate::security::vault::VaultState;
use crate::services::metadata::MetadataService;
use crate::services::playback_engine::PlaybackEngineState;
use crate::services::watcher::{ScanningLibraries, WatcherHandle};
use std::sync::{Arc, Mutex};

/// Injecté dans les commandes Tauri.
pub struct AppState {
    pub db_pool: DbPool,
    pub database_path: String,
    pub log_directory: String,
    /// Répertoire de données de l'application (ex. `%APPDATA%\com.aethervault.media`
    /// sous Windows) — utilisé par `services::image_store` pour les images
    /// personnalisées (Étape 4, doc §6.6), et par `security::vault` pour
    /// localiser `vault.db` à côté de `aethervault.db` (Étape 6a).
    pub data_dir: String,
    /// Filesystem Watcher (Étape 2b) : permet d'ajouter/retirer des
    /// dossiers surveillés au fil de l'eau depuis les commandes.
    pub watcher: Arc<WatcherHandle>,
    /// Bibliothèques actuellement en cours de traitement (scan complet ou
    /// lot d'événements du watcher) — empêche deux opérations concurrentes
    /// sur la même bibliothèque.
    pub scanning_libraries: ScanningLibraries,
    /// Playback Engine Bridge (Étape 3b) : moteur mpv unique de
    /// l'application, partagé entre la fenêtre principale et la future
    /// fenêtre détachée (voir doc §4.2). `Unavailable` si libmpv n'a pas
    /// pu être chargée — ne bloque pas le reste de l'application.
    pub playback_engine: PlaybackEngineState,
    /// Metadata Service (Étape 4, doc §3.4/§6.3) : orchestrateur de
    /// fournisseurs, partagé plutôt que reconstruit à chaque commande —
    /// un futur fournisseur en ligne y maintiendra probablement un état
    /// (client HTTP, cache de clé d'API) qu'il serait coûteux de recréer
    /// à chaque appel.
    pub metadata_service: Arc<MetadataService>,
    /// Profil actif (Profile Manager, Étape 6a, doc §6.5) : autorité
    /// exclusivement côté Rust — jamais un identifiant transmis librement
    /// par le frontend à chaque appel. Réinitialisé au premier profil
    /// disposant de `can_manage_profiles` à chaque lancement (jamais
    /// mémorisé d'une session à l'autre, par symétrie avec le
    /// verrouillage systématique du coffre ci-dessous). `domain::profile`
    /// est seul responsable d'y écrire.
    pub active_profile_id: Mutex<i64>,
    /// État du coffre privé (Privacy/Security Manager, Étape 6a, doc
    /// §6.4/§6.4 bis) : `Locked` par défaut à chaque lancement, jamais
    /// persisté sur disque. `domain::privacy` est seul responsable d'y
    /// écrire.
    pub vault: Mutex<VaultState>,
}

impl AppState {
    /// Lit le profil actif — factorisé ici (Étape 6b-i) plutôt que dupliqué
    /// dans chaque module de `commands/` (`profile.rs`, `security.rs`,
    /// `private_video.rs` en avaient chacun une copie identique).
    pub fn read_active_profile_id(&self) -> Result<i64, String> {
        self.active_profile_id
            .lock()
            .map(|guard| *guard)
            .map_err(|_| "État du profil actif inaccessible.".to_string())
    }
}

