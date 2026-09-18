//! Commandes liées aux fenêtres.
//!
//! PiP (Étape 3b) MIS EN QUARANTAINE : les commandes `open_player_window` /
//! `close_player_window` / `mark_player_ready` restent disponibles (la
//! fenêtre "player" pré-créée et le code Rust sont conservés), mais le
//! bouton frontend est masqué — plus rien ne les appelle.
//!
//! Mode flottant (bouton épingle) : bascule la fenêtre PRINCIPALE en
//! "toujours au-dessus" + SANS BORDURE + taille compacte. Le déplacement
//! et le redimensionnement se font côté frontend via
//! `data-tauri-drag-region` et `plugin:window|start_resize_dragging`
//! (permissions `core:window:allow-start-dragging` /
//! `allow-start-resize-dragging`), puisque une fenêtre sans bordure n'a
//! plus ni barre de titre ni poignées natives.
use crate::db::repositories::window_state_repository::{self, WindowStateRecord};
use crate::state::AppState;
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

const DEFAULT_WIDTH: f64 = 420.0;
const DEFAULT_HEIGHT: f64 = 280.0;
const MIN_WIDTH: f64 = 280.0;
const MIN_HEIGHT: f64 = 180.0;
const SCREEN_MARGIN: f64 = 24.0;

// ---------------------------------------------------------------------
// PiP — EN QUARANTAINE (bouton frontend masqué, commandes conservées)
// ---------------------------------------------------------------------

#[tauri::command]
pub async fn open_player_window(app: AppHandle) -> Result<(), String> {
    let window = app.get_webview_window("player").ok_or_else(|| {
        log::error!("[PiP] Fenêtre \"player\" introuvable — est-elle bien déclarée dans tauri.conf.json ?");
        "Fenêtre \"player\" introuvable (déclaration manquante dans tauri.conf.json ?)".to_string()
    })?;
    log::info!("[PiP] Ouverture de la fenêtre \"player\" pré-créée (show + focus).");
    if let Ok((x, y, width, height)) = resolve_geometry(&app) {
        let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize { width, height }));
        let _ = window.set_position(tauri::Position::Logical(tauri::LogicalPosition { x, y }));
    }
    window.show().map_err(|e| {
        log::error!("[PiP] Échec de l'affichage de la fenêtre \"player\" : {e}");
        e.to_string()
    })?;
    window.set_focus().map_err(|e| {
        log::error!("[PiP] Échec de la mise au premier plan de la fenêtre \"player\" : {e}");
        e.to_string()
    })?;
    let _ = app.emit_to("player", "pip-activate", ());
    Ok(())
}

#[tauri::command]
pub fn close_player_window(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("player") {
        log::info!("[PiP] Masquage de la fenêtre \"player\" (redock).");
        let _ = app.emit_to("player", "pip-deactivate", ());
        persist_geometry(&app, &window);
        window.hide().map_err(|e| {
            log::error!("[PiP] Échec du masquage de la fenêtre \"player\" : {e}");
            e.to_string()
        })?;
        let _ = app.emit_to("main", "player-window-closed", ());
    } else {
        log::info!("[PiP] close_player_window appelée mais aucune fenêtre \"player\" n'existe.");
    }
    Ok(())
}

#[tauri::command]
pub fn mark_player_ready(_app: AppHandle) -> Result<(), String> {
    Ok(())
}

// ---------------------------------------------------------------------
// Mode flottant (fenêtre principale toujours au-dessus, sans bordure)
// ---------------------------------------------------------------------

/// Bascule la fenêtre principale en mode flottant : toujours au-dessus,
/// sans bordure, taille compacte en bas à droite. Un second clic rend la
/// bordure, la taille et la position normales. Le frontend (événement
/// `floating-changed`) affiche alors les poignées de redimensionnement
/// et la zone de déplacement.
#[tauri::command]
pub fn toggle_floating_player(app: AppHandle) -> Result<(), String> {
    let window = app.get_webview_window("main")
        .ok_or_else(|| "Fenêtre principale introuvable.".to_string())?;

    let currently_on_top = window.is_always_on_top().unwrap_or(false);
    let should_enable = !currently_on_top;

    window.set_always_on_top(should_enable).map_err(|e| e.to_string())?;
    // Mode flottant = sans bordure ; mode normal = avec bordure.
    let _ = window.set_decorations(!should_enable);

        if should_enable {
        // ⚠️ Correctif redimensionnement libre : tauri.conf.json impose un
        // minimum de 900×600 à la fenêtre principale — le redimensionnement
        // à la souris le respecte strictement (contrairement à set_size),
        // ce qui bloquait toute réduction et provoquait des « sauts ».
        // En mode flottant, on abaisse ce minimum.
        let _ = window.set_min_size(Some(tauri::Size::Logical(tauri::LogicalSize {
            width: 280.0,
            height: 180.0,
        })));
        window.set_size(tauri::Size::Logical(tauri::LogicalSize {
            width: 560.0,
            height: 360.0,
        })).map_err(|e| e.to_string())?;
        if let Some(monitor) = app.primary_monitor().ok().flatten() {
            let scale = monitor.scale_factor();
            let size = monitor.size();
            let width_logical = size.width as f64 / scale;
            let height_logical = size.height as f64 / scale;
            window.set_position(tauri::Position::Logical(tauri::LogicalPosition {
                x: width_logical - 580.0,
                y: height_logical - 400.0,
            })).map_err(|e| e.to_string())?;
        }
        } else {
        // Restaure le minimum du mode normal (valeur de tauri.conf.json).
        let _ = window.set_min_size(Some(tauri::Size::Logical(tauri::LogicalSize {
            width: 900.0,
            height: 600.0,
        })));
        window.set_size(tauri::Size::Logical(tauri::LogicalSize {
            width: 1100.0,
            height: 720.0,
        })).map_err(|e| e.to_string())?;
        window.center().map_err(|e| e.to_string())?;
    }

    // Préviens le frontend pour qu'il affiche/masque les poignées de
    // redimensionnement et la zone de déplacement.
    let _ = app.emit_to("main", "floating-changed", should_enable);
    log::info!("[Floating] Mode toujours au-dessus : {}", should_enable);
    Ok(())
}

// ---------------------------------------------------------------------
// Aides (géométrie PiP — quarantaine)
// ---------------------------------------------------------------------

fn resolve_geometry(app: &AppHandle) -> Result<(f64, f64, f64, f64), String> {
    let (screen_width, screen_height) = primary_monitor_logical_size(app)?;
    let saved = {
        let state = app.state::<AppState>();
        let conn = state.get_conn()?;
        window_state_repository::get(&conn).map_err(|e| e.to_string())?
    };
    if let Some(saved) = saved {
        let fits = saved.x >= 0.0
            && saved.y >= 0.0
            && saved.width >= MIN_WIDTH
            && saved.height >= MIN_HEIGHT
            && saved.x + saved.width <= screen_width
            && saved.y + saved.height <= screen_height;
        if fits {
            return Ok((saved.x, saved.y, saved.width, saved.height));
        }
    }
    let x = (screen_width - DEFAULT_WIDTH - SCREEN_MARGIN).max(0.0);
    let y = (screen_height - DEFAULT_HEIGHT - SCREEN_MARGIN).max(0.0);
    Ok((x, y, DEFAULT_WIDTH, DEFAULT_HEIGHT))
}

fn primary_monitor_logical_size(app: &AppHandle) -> Result<(f64, f64), String> {
    let monitor = app
        .primary_monitor()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Aucun écran détecté.".to_string())?;
    let scale_factor = monitor.scale_factor();
    let size = monitor.size();
    Ok((size.width as f64 / scale_factor, size.height as f64 / scale_factor))
}

fn persist_geometry(app: &AppHandle, window: &WebviewWindow) {
    let (Ok(position), Ok(size)) = (window.outer_position(), window.inner_size()) else {
        return;
    };
    let scale_factor = window.scale_factor().unwrap_or(1.0);
    let record = WindowStateRecord {
        x: position.x as f64 / scale_factor,
        y: position.y as f64 / scale_factor,
        width: size.width as f64 / scale_factor,
        height: size.height as f64 / scale_factor,
    };
    let state = app.state::<AppState>();
    if let Ok(conn) = state.db_pool.get() {
        let _ = window_state_repository::save(&conn, &record);
    }
}