//! Sonde technique des fichiers média (Étape 7, lot 2) : résolution,
//! codec vidéo, langues audio et sous-titres — lus via les propriétés
//! mpv (`video-params/w/h`, `video-codec`, `track-list/N/...`) sur un
//! handle dédié en `vo=null` (aucun rendu : beaucoup plus léger que
//! l'extraction de vignettes). Alimente les critères techniques de
//! l'Explorateur et la future section « Technique » des pages.
//!
//! Même philosophie de robustesse que le reste de la chaîne de scan :
//! thread dédié + délai absolu par fichier (un fichier pathologique ne
//! bloque jamais la file), best-effort (échec = ligne de sonde vide,
//! jamais d'interruption), progression `library:scan-progress` phase
//! "probe".
use super::playback_engine::mpv_ffi::{self, MpvFunctions};
use crate::db::repositories::media_probe_repository;
use crate::db::DbPool;
use std::ffi::{c_void, CStr, CString};
use std::os::raw::{c_char, c_int};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

/// Délai maximal de chargement d'un fichier PAR sonde.
const PROBE_TIMEOUT: Duration = Duration::from_secs(10);
/// Intervalle minimal entre deux émissions de progression.
const PROGRESS_INTERVAL: Duration = Duration::from_millis(150);

struct HandleGuard<'a>(&'a MpvFunctions, *mut c_void);
impl Drop for HandleGuard<'_> {
    fn drop(&mut self) {
        unsafe { (self.0.terminate_destroy)(self.1) }
    }
}

fn set_option(
    functions: &MpvFunctions,
    mpv: *mut c_void,
    name: &str,
    value: &str,
) -> Result<(), String> {
    let cname = CString::new(name).unwrap_or_default();
    let cvalue = CString::new(value).unwrap_or_default();
    let rc = unsafe { (functions.set_option_string)(mpv, cname.as_ptr(), cvalue.as_ptr()) };
    if rc < 0 {
        Err(format!("option mpv « {name} » refusée (code {rc})"))
    } else {
        Ok(())
    }
}

fn command(functions: &MpvFunctions, mpv: *mut c_void, args: &[&str]) -> Result<(), String> {
    let c_args: Vec<CString> = args
        .iter()
        .map(|arg| CString::new(*arg).unwrap_or_default())
        .collect();
    let mut ptrs: Vec<*const c_char> = c_args.iter().map(|a| a.as_ptr()).collect();
    ptrs.push(std::ptr::null());
    let rc = unsafe { (functions.command)(mpv, ptrs.as_ptr()) };
    if rc < 0 {
        Err(format!("commande mpv échouée (code {rc})"))
    } else {
        Ok(())
    }
}

fn get_property_string(functions: &MpvFunctions, mpv: *mut c_void, name: &str) -> Option<String> {
    let cname = CString::new(name).ok()?;
    let mut ptr: *mut c_char = std::ptr::null_mut();
    let rc = unsafe {
        (functions.get_property)(
            mpv,
            cname.as_ptr(),
            mpv_ffi::MpvFormat::String as c_int,
            &mut ptr as *mut _ as *mut c_void,
        )
    };
    if rc < 0 || ptr.is_null() {
        return None;
    }
    let value = unsafe { CStr::from_ptr(ptr) }.to_string_lossy().to_string();
    unsafe { (functions.free)(ptr as *mut c_void) };
    Some(value)
}

fn get_property_int64(functions: &MpvFunctions, mpv: *mut c_void, name: &str) -> Option<i64> {
    let cname = CString::new(name).ok()?;
    let mut value: i64 = 0;
    let rc = unsafe {
        (functions.get_property)(
            mpv,
            cname.as_ptr(),
            mpv_ffi::MpvFormat::Int64 as c_int,
            &mut value as *mut _ as *mut c_void,
        )
    };
    if rc < 0 {
        None
    } else {
        Some(value)
    }
}

/// Étiquette de résolution depuis la hauteur — bornes volontairement
/// simples (le catalogue personnel ne contient pas de cas exotiques).
fn resolution_label(height: i64) -> &'static str {
    match height {
        h if h >= 2000 => "2160p",
        h if h >= 1300 => "1440p",
        h if h >= 900 => "1080p",
        h if h >= 600 => "720p",
        _ => "SD",
    }
}

/// Normalisation minimale des noms de codec mpv vers les étiquettes
/// courantes de l'Explorateur (h264/h265/av1/vp9…).
fn normalize_codec(codec: &str) -> String {
    match codec {
        "hevc" => "h265".to_string(),
        other => other.to_string(),
    }
}

/// Sonde UN fichier : charge en `vo=null` (aucun rendu), attend
/// FILE_LOADED, lit dimensions/codec/pistes. `wait_event(0.2)` est
/// borné et FILE_LOADED arrive toujours (succès ou échec) : aucun
/// risque de gel, contrairement aux anciens pompages à timeout 0.
fn probe_one(
    functions: &MpvFunctions,
    path: &str,
) -> Result<
    (
        Option<i64>,
        Option<i64>,
        Option<String>,
        Option<String>,
        Vec<String>,
        Vec<String>,
    ),
    String,
> {
    unsafe {
        let mpv = (functions.create)();
        if mpv.is_null() {
            return Err("mpv_create a échoué".to_string());
        }
        let _handle = HandleGuard(functions, mpv);

        set_option(functions, mpv, "vo", "null")?;
        set_option(functions, mpv, "ao", "null")?;
        set_option(functions, mpv, "hwdec", "no")?;
        set_option(functions, mpv, "pause", "yes")?;

        let rc = (functions.initialize)(mpv);
        if rc < 0 {
            return Err(format!("mpv_initialize a échoué (code {rc})"));
        }

        command(functions, mpv, &["loadfile", path, "replace"])?;

        let deadline = Instant::now() + PROBE_TIMEOUT;
        let mut loaded = false;
        while Instant::now() < deadline {
            let event_ptr = (functions.wait_event)(mpv, 0.2);
            if event_ptr.is_null() {
                continue;
            }
            let event = &*event_ptr;
            if event.event_id == mpv_ffi::event_id::FILE_LOADED {
                loaded = true;
                break;
            }
            if event.event_id == mpv_ffi::event_id::END_FILE {
                break;
            }
        }
        if !loaded {
            return Err("fichier non chargé avant le délai imparti".to_string());
        }

        let width = get_property_int64(functions, mpv, "video-params/w");
        let height = get_property_int64(functions, mpv, "video-params/h");
        let resolution = height.map(|h| resolution_label(h).to_string());
        let video_codec =
            get_property_string(functions, mpv, "video-codec").map(|c| normalize_codec(&c));

        let mut audio_langs: Vec<String> = Vec::new();
        let mut subtitle_langs: Vec<String> = Vec::new();
        let count = get_property_int64(functions, mpv, "track-list/count")
            .unwrap_or(0)
            .max(0);
        for index in 0..count {
            let Some(track_type) =
                get_property_string(functions, mpv, &format!("track-list/{index}/type"))
            else {
                continue;
            };
            let Some(lang) =
                get_property_string(functions, mpv, &format!("track-list/{index}/lang"))
            else {
                continue;
            };
            match track_type.as_str() {
                "audio" => {
                    if !audio_langs.contains(&lang) {
                        audio_langs.push(lang);
                    }
                }
                "sub" => {
                    if !subtitle_langs.contains(&lang) {
                        subtitle_langs.push(lang);
                    }
                }
                _ => {}
            }
        }

        Ok((
            width,
            height,
            resolution,
            video_codec,
            audio_langs,
            subtitle_langs,
        ))
    }
}

/// Filet de sécurité : thread dédié + délai absolu, même pattern que
/// `episode_thumbnails::grab_one_frame_guarded`.
fn probe_one_guarded(
    functions: Arc<MpvFunctions>,
    path: String,
) -> Result<
    (
        Option<i64>,
        Option<i64>,
        Option<String>,
        Option<String>,
        Vec<String>,
        Vec<String>,
    ),
    String,
> {
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let _ = tx.send(probe_one(&functions, &path));
    });
    rx.recv_timeout(PROBE_TIMEOUT + Duration::from_secs(5))
        .map_err(|_| "gel mpv : sonde abandonnée (délai absolu dépassé)".to_string())?
}

/// Sonde les fichiers non sondés d'une bibliothèque (phase "probe" de la
/// barre de progression). Best-effort : un échec enregistre une ligne de
/// sonde vide (marqué « sondé », pas de nouvel essai coûteux à chaque
/// scan), jamais d'interruption de la chaîne.
pub fn probe_missing(
    app: &AppHandle,
    pool: &DbPool,
    functions: Option<Arc<MpvFunctions>>,
    library_id: i64,
) {
    let Some(functions) = functions else {
        log::info!("[probe] libmpv indisponible — sonde sautée (bibliothèque {library_id}).");
        return;
    };
    let Ok(conn) = pool.get() else {
        log::error!("[probe] connexion base indisponible (bibliothèque {library_id}).");
        return;
    };
    let targets = match media_probe_repository::unprobed_files(&conn, library_id) {
        Ok(targets) => targets,
        Err(e) => {
            log::error!("[probe] lecture des fichiers à sonder impossible : {e}");
            return;
        }
    };
    if targets.is_empty() {
        return;
    }
    log::info!(
        "[probe] bibliothèque {library_id} : {} fichier(s) à sonder.",
        targets.len()
    );
    let total = targets.len() as u64;
    let mut processed: u64 = 0;
    let mut ok_count = 0u32;
    let mut failed = 0u32;
    let mut last_emit: Option<Instant> = None;
    let _ = app.emit(
        "library:scan-progress",
        serde_json::json!({
            "library_id": library_id,
            "phase": "probe",
            "processed": 0u64,
            "total": total,
            "current": "",
        }),
    );
    for (file_id, path) in targets {
        let now = Instant::now();
        if last_emit
            .map(|previous| now.duration_since(previous) >= PROGRESS_INTERVAL)
            .unwrap_or(true)
        {
            last_emit = Some(now);
            let current = std::path::Path::new(&path)
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or_default();
            let _ = app.emit(
                "library:scan-progress",
                serde_json::json!({
                    "library_id": library_id,
                    "phase": "probe",
                    "processed": processed,
                    "total": total,
                    "current": current,
                }),
            );
        }
        match probe_one_guarded(functions.clone(), path.clone()) {
            Ok((width, height, resolution, video_codec, audio_langs, subtitle_langs)) => {
                if let Err(e) = media_probe_repository::upsert(
                    &conn,
                    file_id,
                    width,
                    height,
                    resolution.as_deref(),
                    video_codec.as_deref(),
                    &audio_langs,
                    &subtitle_langs,
                ) {
                    log::warn!("[probe] fichier {file_id} : sonde lue mais base non mise à jour : {e}");
                    failed += 1;
                } else {
                    ok_count += 1;
                }
            }
            Err(e) => {
                log::warn!("[probe] fichier {file_id} ({path}) : {e}");
                let _ = media_probe_repository::upsert(
                    &conn,
                    file_id,
                    None,
                    None,
                    None,
                    None,
                    &[],
                    &[],
                );
                failed += 1;
            }
        }
        processed += 1;
    }
    let _ = app.emit(
        "library:scan-progress",
        serde_json::json!({
            "library_id": library_id,
            "phase": "probe",
            "processed": processed,
            "total": total,
            "current": "",
        }),
    );
    log::info!(
        "[probe] bibliothèque {library_id} : {ok_count} fichier(s) sondé(s), {failed} échec(s)."
    );
}