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
    /// Profil actif (Profile Manager, Étape 6a, doc §6.5 ; Étape 6c :
    /// devient `Option<i64>`) : autorité exclusivement côté Rust — jamais
    /// un identifiant transmis librement par le frontend à chaque appel.
    /// `None` = aucun profil connecté (login requis) ; au démarrage actuel
    /// (6c-i), initialisé à `Some(premier admin)` pour conserver le
    /// comportement existant — le basculement vers l'écran de login
    /// arrivera avec l'intro animée (6c-ii/iv). `domain::profile` est seul
    /// responsable d'y écrire.
	/// GARDE : Ce Mutex n'a pas de timeout. Les sections protégées ne
    /// doivent JAMAIS contenir d'opérations bloquantes longues (I/O réseau,
    /// attente utilisateur). En cas de panic d'un thread détenteur, utiliser
    /// `unwrap_or_else(|p| p.into_inner())` pour récupérer le verrou.
    pub active_profile_id: Mutex<Option<i64>>,
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
    /// Étape 6c : renvoie une erreur explicite si aucun profil n'est
    /// actif (login requis), au lieu de lire un `i64` direct.
    pub fn read_active_profile_id(&self) -> Result<i64, String> {
        let guard = self
            .active_profile_id
            .lock()
            .map_err(|_| "État du profil actif inaccessible.".to_string())?;
        guard.ok_or_else(|| "Aucun profil actif — login requis.".to_string())
    }
}

impl AppState {
    /// Raccourci pour obtenir une connexion DB avec gestion d'erreur uniforme.
    pub fn get_conn(
        &self,
    ) -> Result<r2d2::PooledConnection<r2d2_sqlite::SqliteConnectionManager>, String> {
        self.db_pool.get().map_err(|e| format!("DB pool error: {e}"))
    }
}