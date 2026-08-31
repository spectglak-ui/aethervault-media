//! Commandes liées à la lecture.
//!
//! Depuis l'Étape 3b, ce module porte à la fois la persistance de
//! progression (inchangée) ET le pilotage du moteur natif (Playback Engine
//! Bridge, `services::playback_engine`) : chaque commande de contrôle
//! n'est qu'un mince passe-plat vers `state.playback_engine`, qui reste la
//! seule couche à connaître les détails de libmpv (voir la documentation
//! technique, §4.2).
//!
//! Depuis la migration Étape 3c (abandon du rendu Win32/OpenGL natif au
//! profit du rendu logiciel + `<canvas>`), `player_attach_surface` ne
//! prend plus que `width`/`height` (plus de `window_label`/`x`/`y` : il
//! n'y a plus de fenêtre native à positionner) et
//! `player_update_surface_rect` est devenue `player_resize_surface`.
//! Toutes les autres commandes de ce fichier sont restées strictement
//! inchangées par cette migration.
//!
//! `width`/`height` reçus par `player_attach_surface`/
//! `player_resize_surface` sont déjà en pixels PHYSIQUES : c'est le
//! frontend qui applique `window.devicePixelRatio` avant l'appel (voir
//! `PlayerSurface.tsx`), pour ne pas avoir à résoudre le facteur d'échelle
//! de la fenêtre cible depuis le thread de commande.
use crate::db::repositories::playback_repository::PlaybackProgressRecord;
use crate::domain::playback;
use crate::services::playback_engine::TrackList;
use crate::state::AppState;
use tauri::{AppHandle, Manager};
use crate::domain::title::TitleSummary;

#[tauri::command]
pub fn get_playback_progress(
    state: tauri::State<AppState>,
    media_file_id: i64,
) -> Result<Option<PlaybackProgressRecord>, String> {
    let active_profile_id = state.read_active_profile_id()?;
playback::get_progress(&state.db_pool, active_profile_id, media_file_id)
}

#[tauri::command]
pub fn save_playback_progress(
    state: tauri::State<AppState>,
    media_file_id: i64,
    position_seconds: f64,
    duration_seconds: f64,
) -> Result<(), String> {
    let active_profile_id = state.read_active_profile_id()?;
playback::save_progress(
    &state.db_pool,
    active_profile_id,
    media_file_id,
    position_seconds,
    duration_seconds,
)
}

/// Charge un fichier dans le moteur natif. `path` est un chemin de
/// fichier absolu sur le disque — plus de conversion `convertFileSrc` côté
/// frontend depuis cette étape : mpv lit directement le système de
/// fichiers, comme n'importe quel lecteur natif (simplification bienvenue
/// par rapport à l'Étape 3a).
#[tauri::command]
pub fn player_load(state: tauri::State<AppState>, path: String) -> Result<(), String> {
    state.playback_engine.handle()?.load(&path)
}

#[tauri::command]
pub fn player_set_paused(state: tauri::State<AppState>, paused: bool) -> Result<(), String> {
    state.playback_engine.handle()?.set_paused(paused)
}

#[tauri::command]
pub fn player_seek(state: tauri::State<AppState>, seconds: f64) -> Result<(), String> {
    state.playback_engine.handle()?.seek_absolute(seconds)
}

/// `volume` en 0.0..1.0 (convention déjà utilisée par `PlayerContext` en
/// 3a) — la conversion vers l'échelle 0..100 de mpv se fait dans
/// `PlaybackEngineHandle::set_volume`.
#[tauri::command]
pub fn player_set_volume(state: tauri::State<AppState>, volume: f64) -> Result<(), String> {
    state.playback_engine.handle()?.set_volume(volume)
}

#[tauri::command]
pub fn player_set_muted(state: tauri::State<AppState>, muted: bool) -> Result<(), String> {
    state.playback_engine.handle()?.set_muted(muted)
}

#[tauri::command]
pub fn player_set_rate(state: tauri::State<AppState>, rate: f64) -> Result<(), String> {
    state.playback_engine.handle()?.set_rate(rate)
}

/// Liste les pistes audio et sous-titres du fichier actuellement chargé
/// (Étape 3e). Interrogée à la demande par le frontend, juste avant
/// d'afficher le menu contextuel Piste audio / Sous-titres — voir
/// `PlaybackEngineHandle::list_tracks` pour le choix de ne pas observer
/// `track-list` en continu.
#[tauri::command]
pub fn player_list_tracks(state: tauri::State<AppState>) -> Result<TrackList, String> {
    state.playback_engine.handle()?.list_tracks()
}

#[tauri::command]
pub fn player_set_audio_track(state: tauri::State<AppState>, track_id: i64) -> Result<(), String> {
    state.playback_engine.handle()?.set_audio_track(track_id)
}

/// `track_id` à `None` désactive les sous-titres (entrée "Aucun" du menu
/// contextuel) — voir `PlaybackEngineHandle::set_subtitle_track`.
#[tauri::command]
pub fn player_set_subtitle_track(
    state: tauri::State<AppState>,
    track_id: Option<i64>,
) -> Result<(), String> {
    state.playback_engine.handle()?.set_subtitle_track(track_id)
}

/// Arrête la lecture et libère la surface de rendu native (voir
/// `PlaybackEngineHandle::stop`).
#[tauri::command]
pub fn player_stop(state: tauri::State<AppState>) -> Result<(), String> {
    state.playback_engine.handle()?.stop()
}

/// Attache (ou réattache) le rendu logiciel au `<canvas>` qui vient de se
/// monter, en lui envoyant ses images via `channel`. Remplace l'ancienne
/// commande basée sur `window_label`/`x`/`y` (fenêtre Win32 native,
/// abandonnée — voir le rapport de transmission "écran noir" et la
/// migration qui a suivi) : il n'y a plus de position à transmettre,
/// seulement une taille cible, puisqu'il n'y a plus de fenêtre à
/// positionner. C'est toujours ce qui implémente concrètement le mode
/// détaché : le `<canvas>` de la fenêtre qui appelle cette commande devient
/// le destinataire des images, sans jamais interrompre la lecture.
///
/// `width`/`height` sont déjà en pixels PHYSIQUES (le frontend applique
/// `window.devicePixelRatio` avant l'appel — voir `PlayerSurface.tsx`),
/// exactement comme avant la migration.
#[tauri::command]
pub fn player_attach_surface(
    state: tauri::State<AppState>,
    channel: tauri::ipc::Channel<tauri::ipc::InvokeResponseBody>,
    width: f64,
    height: f64,
) -> Result<(), String> {
    state.playback_engine.handle()?.attach_surface(
        channel,
        width.round() as i32,
        height.round() as i32,
    )
}

/// Redimensionnement léger, appelé à chaque redimensionnement/scroll de la
/// zone vidéo — ne recrée rien côté moteur, met seulement à jour la taille
/// cible du buffer de rendu logiciel (voir
/// `PlaybackEngineHandle::resize_surface`).
#[tauri::command]
pub fn player_resize_surface(
    state: tauri::State<AppState>,
    width: f64,
    height: f64,
) -> Result<(), String> {
    state
        .playback_engine
        .handle()?
        .resize_surface(width.round() as i32, height.round() as i32);
    Ok(())
}

/// ⚠️ Correctif (désynchronisation A/V croissante — contre-pression, voir
/// `SurfaceState::in_flight_frames` dans `playback_engine/mod.rs`) :
/// appelée par `PlayerSurface.tsx` juste après avoir réellement dessiné
/// chaque image reçue sur le canal vidéo — jamais une commande liée au
/// décodage ou à la synchronisation elle-même, uniquement un compteur
/// permettant au thread de rendu de savoir s'il peut envoyer la
/// prochaine image sans accumuler de retard.
#[tauri::command]
pub fn player_ack_frame(state: tauri::State<AppState>) -> Result<(), String> {
    state.playback_engine.handle()?.ack_frame();
    Ok(())
}

/// ⚠️ Repli PiP (image FIGÉE dans la fenêtre détachée — prouvé en test
/// réel) : force mpv à re-présenter la frame courante après le transfert
/// de surface. Sans ce seek relatif de 0 seconde (imperceptible), mpv
/// considère la frame courante comme déjà « consommée » et ne réveille
/// plus le wake callback du nouveau contexte de rendu — la fenêtre PiP
/// afficherait une vidéo figée pendant que le son continue.
#[tauri::command]
pub fn player_redraw(state: tauri::State<AppState>) -> Result<(), String> {
    state.playback_engine.handle()?.redraw()
}

/// Capture d'écran native (remplace la capture par `canvas.drawImage`
/// devenue impossible sans balise `<video>`) : mpv écrit directement
/// l'image décodée courante, ce qui donne d'ailleurs un meilleur résultat
/// qu'une capture du compositeur.
#[tauri::command]
pub fn player_capture_screenshot(
    app: AppHandle,
    state: tauri::State<AppState>,
) -> Result<String, String> {
    let pictures_dir = app
        .path()
        .picture_dir()
        .map_err(|e| format!("Dossier Images introuvable : {e}"))?;
    let target_dir = pictures_dir.join("AetherVault Media");
    std::fs::create_dir_all(&target_dir).map_err(|e| e.to_string())?;
    let file_name = format!(
        "aethervault-{}.png",
        chrono::Utc::now().format("%Y%m%d-%H%M%S%3f")
    );
    let target_path = target_dir.join(file_name);
    state
        .playback_engine
        .handle()?
        .capture_screenshot(&target_path.to_string_lossy())?;
    Ok(target_path.to_string_lossy().to_string())
}

// ---- Rangée « Continuer à regarder » (Étape 8) -----------------------

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContinueWatchingItem {
    pub media_file_id: i64,
    pub path: String,
    pub library_id: i64,
    pub title_id: i64,
    pub title_name: String,
    pub kind: String,
    pub category_key: String,
    pub poster: Option<String>,
    pub label: String,
    pub position_seconds: f64,
    pub duration_seconds: f64,
}

/// Accueil : médias publics en cours (1 %–95 %), du plus récent au plus
/// ancien ; le clic frontend relance directement la lecture (la reprise
/// de position est déjà gérée par `loadAndBroadcast`).
#[tauri::command]
pub fn list_continue_watching(
    state: tauri::State<AppState>,
) -> Result<Vec<ContinueWatchingItem>, String> {
    let active_profile_id = state.read_active_profile_id()?;
    let conn = state.db_pool.get().map_err(|e| e.to_string())?;
    let rows =
        crate::db::repositories::playback_repository::list_continue_watching(&conn, active_profile_id)
            .map_err(|e| e.to_string())?;
    let mut items = Vec::with_capacity(rows.len());
    for row in rows {
        let custom_poster =
            crate::db::repositories::custom_image_repository::get(&conn, "title", row.title_id, "poster")
                .map_err(|e| e.to_string())?;
        let label = match (row.season_number, row.episode_number) {
            (Some(season), Some(episode)) => {
                format!("{} S{:02}E{:02}", row.title_name, season, episode)
            }
            _ => row.title_name.clone(),
        };
        items.push(ContinueWatchingItem {
            media_file_id: row.media_file_id,
            path: row.path,
            library_id: row.library_id,
            title_id: row.title_id,
            title_name: row.title_name,
            kind: row.kind,
            category_key: row.category_key,
            poster: custom_poster.or(row.poster_path),
            label,
            position_seconds: row.position_seconds,
            duration_seconds: row.duration_seconds,
        });
    }
    Ok(items)
}

// ---- Time Capsule & Similaires (Étape 8) -------------------------------

/// Enregistre une session dans `watch_history` (appelé par le frontend
/// à la fin d'un média ≥ 30 s vus — évite les faux positifs).
#[tauri::command]
pub fn record_watch(
    state: tauri::State<AppState>,
    media_file_id: i64,
    position_seconds: f64,
    duration_seconds: f64,
) -> Result<(), String> {
    let active_profile_id = state.read_active_profile_id()?;
    crate::domain::playback::record_watch_session(
        &state.db_pool,
        active_profile_id,
        media_file_id,
        position_seconds,
        duration_seconds,
    )
}

/// Statistiques agrégées pour la page Time Capsule.
#[tauri::command]
pub fn get_watch_stats(
    state: tauri::State<AppState>,
) -> Result<crate::db::repositories::playback_repository::WatchStats, String> {
    let active_profile_id = state.read_active_profile_id()?;
    let conn = state.db_pool.get().map_err(|e| e.to_string())?;
    crate::db::repositories::playback_repository::watch_stats(&conn, active_profile_id)
        .map_err(|e| e.to_string())
}

/// Top genres de la page Time Capsule.
#[tauri::command]
pub fn get_top_genres(
    state: tauri::State<AppState>,
    limit: Option<i64>,
) -> Result<Vec<(String, i64)>, String> {
    let active_profile_id = state.read_active_profile_id()?;
    let conn = state.db_pool.get().map_err(|e| e.to_string())?;
    crate::db::repositories::playback_repository::top_genres(&conn, active_profile_id, limit.unwrap_or(6))
        .map_err(|e| e.to_string())
}

/// Top titres (Time Capsule + "Parce que vous avez regardé…").
#[tauri::command]
pub fn get_top_titles(
    state: tauri::State<AppState>,
    limit: Option<i64>,
) -> Result<Vec<TitleSummary>, String> {
    let active_profile_id = state.read_active_profile_id()?;
    let conn = state.db_pool.get().map_err(|e| e.to_string())?;
    let rows = crate::db::repositories::playback_repository::top_titles(&conn, active_profile_id, limit.unwrap_or(12))
        .map_err(|e| e.to_string())?;
    let mut summaries = Vec::with_capacity(rows.len());
    for (id, category_key, kind, name, poster_path, year, _count) in rows {
        let custom_poster =
            crate::db::repositories::custom_image_repository::get(&conn, "title", id, "poster")
                .map_err(|e| e.to_string())?;
        let category = crate::db::repositories::category_repository::get_by_key(&conn, &category_key)
    .map_err(|e| e.to_string())?
    .ok_or_else(|| format!("Catégorie {} introuvable", category_key))?;
summaries.push(TitleSummary {
    id,
    category_id: category.id,
    kind,
    name,
    year,
    poster: custom_poster.or(poster_path),
});
    }
    Ok(summaries)
}

/// Sessions de la période [from, to) — "il y a 1 an" + top annuel.
#[tauri::command]
pub fn get_watch_sessions(
    state: tauri::State<AppState>,
    from: String,
    to: String,
) -> Result<Vec<crate::db::repositories::playback_repository::WatchSession>, String> {
    let active_profile_id = state.read_active_profile_id()?;
    let conn = state.db_pool.get().map_err(|e| e.to_string())?;
    crate::db::repositories::playback_repository::watch_sessions_in(&conn, active_profile_id, &from, &to)
        .map_err(|e| e.to_string())
}
/// Bouton reset Time Capsule (0.3.0) : efface tout l'historique de
/// visionnage du profil actif — les compteurs repartent de zéro.
#[tauri::command]
pub fn reset_watch_stats(state: tauri::State<AppState>) -> Result<(), String> {
    let active_profile_id = state.read_active_profile_id()?;
    let conn = state.db_pool.get().map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM watch_history WHERE profile_id = ?1",
        rusqlite::params![active_profile_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
/// Titres similaires (page Titre).
#[tauri::command]
pub fn list_similar_titles(
    state: tauri::State<AppState>,
    title_id: i64,
    limit: Option<i64>,
) -> Result<Vec<TitleSummary>, String> {
    let conn = state.db_pool.get().map_err(|e| e.to_string())?;
    let rows = crate::db::repositories::playback_repository::similar_titles(&conn, title_id, limit.unwrap_or(12))
        .map_err(|e| e.to_string())?;
    let mut summaries = Vec::with_capacity(rows.len());
    for (id, category_id, kind, name, poster_path, year, _score) in rows {
        let custom_poster =
            crate::db::repositories::custom_image_repository::get(&conn, "title", id, "poster")
                .map_err(|e| e.to_string())?;
        summaries.push(TitleSummary {
            id,
            category_id,
            kind,
            name,
            year,
            poster: custom_poster.or(poster_path),
        });
    }
    Ok(summaries)
}