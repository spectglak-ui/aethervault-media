//! AetherVault Media — bibliothèque applicative principale.
//!
//! Ce module assemble les différentes couches du socle (base de données,
//! journalisation, commandes exposées au frontend) et démarre l'application
//! Tauri. La logique métier détaillée (bibliothèques, lecteur, profils...)
//! sera ajoutée dans les étapes suivantes, dans des modules dédiés sous
//! `domain/` et `services/`, sans modifier la structure de ce point d'entrée.

mod commands;
mod db;
mod domain;
mod security;
mod services;
mod state;

use state::AppState;
use tauri::Manager;
use tauri_plugin_log::{Target, TargetKind};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .targets([
                    Target::new(TargetKind::Stdout),
                    Target::new(TargetKind::LogDir { file_name: None }),
                ])
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let handle = app.handle().clone();

            // Répertoire de données de l'application (ex. %APPDATA%\com.aethervault.media
            // sous Windows), fourni par Tauri de façon standard par OS.
            let data_dir = handle
                .path()
                .app_data_dir()
                .expect("impossible de résoudre le répertoire de données de l'application");
            std::fs::create_dir_all(&data_dir)
                .expect("impossible de créer le répertoire de données");

            // Privacy/Security Manager (Étape 6a, architecture A2, doc §6.4
            // bis) : nettoie un éventuel fichier de travail resté sur disque
            // après un arrêt brutal pendant un déverrouillage/une
            // persistance du coffre privé — fenêtre de quelques
            // millisecondes en usage normal, jamais nulle en théorie.
            security::vault::cleanup_stale_temp_file(&data_dir);

            let database_path = data_dir.join("aethervault.db");
            let pool = db::init_pool(&database_path)
                .expect("impossible d'initialiser le pool de connexions SQLite");

            // Schéma appliqué de façon versionnée (voir db::migrations), puis
            // données par défaut insérées séparément (voir db::seed).
            db::migrations::apply_migrations(&pool)
                .expect("impossible d'appliquer les migrations de la base de données");
            db::seed::ensure_default_profile(&pool)
                .expect("impossible d'initialiser les données par défaut");
            db::seed::ensure_default_categories(&pool)
                .expect("impossible d'initialiser les catégories par défaut");
            db::seed::backfill_library_categories(&pool)
                .expect("impossible de rattacher les bibliothèques existantes à une catégorie");

            // Profile Manager (Étape 6a, doc §6.5) : le profil actif n'est
            // jamais mémorisé d'un lancement à l'autre — chaque démarrage
            // réactive le premier profil disposant de `can_manage_profiles`,
            // par symétrie avec le coffre privé, toujours relancé verrouillé
            // ci-dessous. `ensure_default_profile` garantit qu'un tel profil
            // existe toujours à ce stade.
            

            let log_dir = handle
                .path()
                .app_log_dir()
                .expect("impossible de résoudre le répertoire de logs");

            log::info!(
                "AetherVault Media démarre — base de données : {:?}",
                database_path
            );

            let scanning_libraries = std::sync::Arc::new(std::sync::Mutex::new(
                std::collections::HashSet::new(),
            ));

            let watcher = services::watcher::start(pool.clone(), handle.clone(), scanning_libraries.clone())
                .expect("impossible de démarrer la surveillance des dossiers (Filesystem Watcher)");

            // Playback Engine Bridge (Étape 3b) : démarré une fois pour
            // toute la durée de vie de l'application, indépendamment de
            // toute fenêtre — voir `services::playback_engine`. Une
            // erreur ici (ex. libmpv pas encore déposée à côté de
            // l'exécutable — l'empaquetage est l'Étape 9, pas encore
            // réalisée) est journalisée mais NE bloque PAS le démarrage :
            // la bibliothèque, le scan et la navigation n'ont aucun besoin
            // du moteur de lecture. Seules les commandes `player_*`
            // échoueront alors, avec un message explicite (voir
            // `PlaybackEngineState`), plutôt qu'un crash global au
            // lancement — même principe de "pas de blocage en cascade"
            // que pour le watcher ci-dessus.
            let playback_engine = match services::playback_engine::PlaybackEngineHandle::start(handle.clone()) {
                Ok(engine) => services::playback_engine::PlaybackEngineState::Ready(engine),
                Err(err) => {
                    log::error!("Playback Engine Bridge indisponible : {err}");
                    services::playback_engine::PlaybackEngineState::Unavailable(err)
                }
            };

            // Metadata Service (Étape 4, doc §3.4/§6.3) : un seul fournisseur
            // pour l'instant (`local_provider`, sans réseau) — voir
            // `services::metadata` pour l'extension future. Construction
            // infaillible (aucune ressource externe à ouvrir), contrairement
            // au Playback Engine Bridge ci-dessus : pas de branche d'erreur à
            // gérer ici.
            let metadata_service = std::sync::Arc::new(services::metadata::MetadataService::new());

            app.manage(AppState {
                db_pool: pool,
                database_path: database_path.to_string_lossy().to_string(),
                log_directory: log_dir.to_string_lossy().to_string(),
                data_dir: data_dir.to_string_lossy().to_string(),
                watcher,
                scanning_libraries,
                playback_engine,
                metadata_service,
                        // Étape 6c-ii : plus d'admin auto-activé au démarrage — le frontend
        // passe par AuthGate (login / onboarding) qui appelle login_profile
        // ou setup_first_admin. `None` = aucun profil actif.
        active_profile_id: std::sync::Mutex::new(None),
                // `Locked` par défaut à chaque lancement — jamais restauré
                // automatiquement (doc §6.4).
                vault: std::sync::Mutex::new(security::vault::VaultState::Locked),
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::status::get_app_status,
            commands::profile::list_profiles,
            commands::profile::get_active_profile,
            commands::profile::switch_active_profile,
            commands::profile::create_profile,
            commands::profile::rename_profile,
            commands::profile::update_profile_permissions,
            commands::profile::delete_profile,
			// Authentification des profils (Étape 6c)
commands::auth::get_login_state,
commands::auth::login_profile,
commands::auth::logout_profile,
commands::auth::setup_first_admin,
commands::auth::change_own_password,
commands::auth::admin_reset_password,
commands::auth::recover_with_code,
            commands::security::get_vault_status,
            commands::security::setup_vault,
            commands::security::unlock_vault,
            commands::security::lock_vault,
            commands::security::change_vault_secret,
            commands::security::list_private_libraries,
            commands::security::create_private_library,
            commands::security::rename_private_library,
            commands::security::delete_private_library,
            commands::private_video::list_private_video_folders,
            commands::private_video::add_private_video_folder,
            commands::private_video::remove_private_video_folder,
            commands::private_video::list_private_video_files,
            commands::private_video::scan_private_video_library,
            commands::private_video::get_private_playback_progress,
            commands::private_video::save_private_playback_progress,
            commands::private_image::list_private_image_folders,
            commands::private_image::add_private_image_folder,
            commands::private_image::remove_private_image_folder,
            commands::private_image::scan_private_image_library,
            commands::private_image::list_private_image_files,
            commands::private_image::get_private_image_thumbnail,
            commands::private_image::get_private_album_cover,
            commands::private_image::set_private_album_cover,
            commands::library::list_libraries,
            commands::library::create_library,
            commands::library::delete_library,
            commands::library::list_library_folders,
            commands::library::pick_folder,
            commands::library::add_library_folder,
            commands::library::remove_library_folder,
            commands::library::list_media_files,
            commands::library::get_media_file,
            commands::library::scan_library,
            commands::library::match_library_metadata_command,
            commands::category::list_categories,
            commands::category::pick_image,
            commands::category::set_category_banner,
            commands::title::list_titles_by_category,
            commands::title::get_title_details,
            commands::title::list_episodes,
            commands::title::set_title_poster,
            commands::title::set_title_banner,
            commands::title::delete_title,
            commands::playback::get_playback_progress,
            commands::playback::save_playback_progress,
            commands::playback::player_load,
            commands::playback::player_set_paused,
            commands::playback::player_seek,
            commands::playback::player_set_volume,
            commands::playback::player_set_muted,
            commands::playback::player_set_rate,
            commands::playback::player_stop,
            commands::playback::player_attach_surface,
            commands::playback::player_resize_surface,
            commands::playback::player_ack_frame,
            commands::playback::player_capture_screenshot,
            commands::playback::player_list_tracks,
            commands::playback::player_set_audio_track,
            commands::playback::player_set_subtitle_track,
			commands::playback::player_redraw,
            commands::player_settings::get_player_settings,
            commands::player_settings::save_player_settings,
            commands::window::open_player_window,
			commands::window::toggle_floating_player,
            commands::window::mark_player_ready,
            commands::window::close_player_window,
            services::playback_engine::player_pull_frame,
        ])
        .run(tauri::generate_context!())
        .expect("erreur lors du lancement d'AetherVault Media");
}
