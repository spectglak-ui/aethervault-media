//! Génération automatique de vignettes d'aperçu pour les épisodes
//! (Étape 6d) : une image JPEG ~480 px extraite de chaque fichier vidéo
//! rattaché à un épisode, générée après l'appariement Metadata Service
//! (donc « au scan »), stockée sur disque dans
//! `<data_dir>/thumbnails/episodes/episode_<id>.jpg` et référencée par la
//! colonne `episodes.still_path` (migration 0004 — cohérent doc §9 :
//! images sur disque, chemins en base, jamais de BLOB).
//!
//! Cadrage produit : catégories Séries et Anime uniquement (filtre dans
//! `commands::library::match_library_metadata`).
//!
//! Architecture : instance libmpv DÉDIÉE par fichier (jamais le handle de
//! lecture du Playback Engine Bridge — une lecture en cours ne doit pas
//! être perturbée), rendu logiciel `MPV_RENDER_API_TYPE_SW` sur le même
//! principe que `sw_render.rs` mais pour UNE seule image, encodée en JPEG
//! par le crate `image`.
//!
//! CONFIGURATION PROUVÉE EN TEST RÉEL (Séries + Anime générés sans échec)
//! — les deux lignes ci-dessous sont INDISPENSABLES, toutes les versions
//! qui les ont perdues ont gelé ou échoué en test réel :
//!   1. `pause=yes` : une seule image suffit, et le cœur mpv idle rend
//!      `terminate_destroy` rapide au nettoyage ;
//!   2. `seek 0 relative` juste après l'installation du callback de
//!      réveil : sans ce seek, mpv considère la frame comme déjà
//!      « présentée » et ne réveille JAMAIS le nouveau contexte de rendu
//!      (même mécanisme que le correctif « image figée du PiP » de
//!      `sw_render.rs`).
//!
//! Anti-gel : chaque extraction tourne dans un thread dédié avec délai
//! absolu (`grab_one_frame_guarded`) ; un traceur d'étape (`Stage`)
//! mémorise la dernière étape franchie pour nommer précisément tout gel
//! futur. Le thread gelé est abandonné (fuite tolérée, cas exceptionnel).
//!
//! Barre de progression du scan : émission de `library:scan-progress`
//! (phase "thumbnails", traités/total + fichier courant) throttlée à
//! ~150 ms ; l'événement final `phase: "done"` est émis par
//! `commands::library` à la fin de toute la chaîne.
use super::playback_engine::mpv_ffi::{self, MpvFunctions};
use crate::db::repositories::episode_repository;
use crate::db::DbPool;
use std::ffi::{c_void, CString};
use std::os::raw::c_int;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

/// Largeur cible des vignettes — suffisant pour des cartes d'épisodes,
/// léger sur disque (~30-60 Ko en JPEG qualité 80).
const THUMB_WIDTH: usize = 480;
const JPEG_QUALITY: u8 = 80;
/// Position de départ : 1 seconde. Seek minuscule = chargement rapide
/// même en HEVC ; évite le frame noir initial de nombreux fichiers.
const START_POSITION: &str = "1";
/// Délai maximal d'attente d'une image PAR TENTATIVE — un fichier
/// pathologique ne doit pas geler la file de génération.
const FRAME_TIMEOUT: Duration = Duration::from_secs(10);
/// Intervalle minimal entre deux émissions de progression — même
/// throttling que le scan (Étape 6d, `scanner.rs`).
const PROGRESS_INTERVAL: Duration = Duration::from_millis(150);

/// Format de pixel demandé à mpv (render.h) : 4 octets/pixel, 4e octet
/// garbage — même choix que `sw_render.rs`.
const SW_FORMAT: &[u8] = b"rgb0\0";
const BYTES_PER_PIXEL: usize = 4;
/// Alignement exigé par mpv (pointeur ET stride) en rendu logiciel.
const MPV_SW_ALIGNMENT: usize = 64;

#[derive(Clone, serde::Serialize)]
pub struct ThumbnailSummary {
    pub library_id: i64,
    pub generated: u32,
    pub failed: u32,
}

fn align_up(value: usize, align: usize) -> usize {
    (value + align - 1) / align * align
}

#[derive(Clone, Copy)]
#[repr(align(64))]
struct AlignedPage([u8; 64]);

/// Réveil du thread par mpv — même contrat strict que dans
/// `sw_render.rs` : le callback C ne rappelle JAMAIS dans l'API mpv.
struct WakeState {
    mutex: Mutex<()>,
    condvar: Condvar,
    dirty: AtomicBool,
}

extern "C" fn wake_trampoline(ctx: *mut c_void) {
    let state = unsafe { &*(ctx as *const WakeState) };
    state.dirty.store(true, Ordering::Release);
    let _guard = state.mutex.lock().unwrap_or_else(|p| p.into_inner());
    state.condvar.notify_one();
}

extern "C" fn no_op_wake_trampoline(_ctx: *mut c_void) {}

/// Garde RAII : `mpv_terminate_destroy` sur tous les chemins de sortie.
struct HandleGuard<'a>(&'a MpvFunctions, *mut c_void);
impl Drop for HandleGuard<'_> {
    fn drop(&mut self) {
        unsafe { (self.0.terminate_destroy)(self.1) }
    }
}

/// Garde RAII : `mpv_render_context_free` sur tous les chemins de sortie.
struct RenderCtxGuard<'a>(&'a MpvFunctions, *mut mpv_ffi::mpv_render_context);
impl Drop for RenderCtxGuard<'_> {
    fn drop(&mut self) {
        unsafe { (self.0.render_context_free)(self.1) }
    }
}

/// Traceur d'étape : dernière étape franchie par `grab_one_frame`, lue par
/// le filet de sécurité pour nommer précisément un éventuel gel.
type Stage = Arc<Mutex<&'static str>>;

fn set_stage(stage: &Stage, value: &'static str) {
    *stage.lock().unwrap_or_else(|p| p.into_inner()) = value;
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
    let mut ptrs: Vec<*const std::os::raw::c_char> = c_args.iter().map(|a| a.as_ptr()).collect();
    ptrs.push(std::ptr::null());
    let rc = unsafe { (functions.command)(mpv, ptrs.as_ptr()) };
    if rc < 0 {
        Err(format!("commande mpv échouée (code {rc})"))
    } else {
        Ok(())
    }
}

fn get_property_double(functions: &MpvFunctions, mpv: *mut c_void, name: &str) -> Option<f64> {
    let cname = CString::new(name).ok()?;
    let mut value: f64 = 0.0;
    let rc = unsafe {
        (functions.get_property)(
            mpv,
            cname.as_ptr(),
            mpv_ffi::MpvFormat::Double as c_int,
            &mut value as *mut _ as *mut c_void,
        )
    };
    if rc < 0 {
        None
    } else {
        Some(value)
    }
}

/// Extrait UNE image du fichier (frame à ~1 s), rendue en logiciel à
/// `THUMB_WIDTH` de large. Renvoie `(largeur, hauteur, pixels RGB8
/// compacts)`. Aucune ressource mpv ne survit à cet appel : handle et
/// contexte de rendu sont détruits sur tous les chemins (gardes RAII +
/// désenregistrement du callback).
fn grab_one_frame(
    functions: &MpvFunctions,
    path: &str,
    stage: Stage,
) -> Result<(usize, usize, Vec<u8>), String> {
    unsafe {
        set_stage(&stage, "mpv_create");
        let mpv = (functions.create)();
        if mpv.is_null() {
            return Err("mpv_create a échoué".to_string());
        }
        let handle = HandleGuard(functions, mpv);

        set_stage(&stage, "set_options");
        set_option(functions, mpv, "vo", "libmpv")?;
        set_option(functions, mpv, "ao", "null")?;
        // Décodage logiciel : configuration des vignettes réussies en
        // test réel ; le décodage matériel a été suspecté de gels.
        set_option(functions, mpv, "hwdec", "no")?;
        set_option(functions, mpv, "start", START_POSITION)?;
        // ⚠️ LIGNE PROUVÉE n°1 (ne JAMAIS la retirer) : voir tête de
        // fichier.
        set_option(functions, mpv, "pause", "yes")?;

        set_stage(&stage, "mpv_initialize");
        let rc = (functions.initialize)(mpv);
        if rc < 0 {
            return Err(format!("mpv_initialize a échoué (code {rc})"));
        }

        set_stage(&stage, "loadfile");
        command(functions, mpv, &["loadfile", path, "replace"])?;

        set_stage(&stage, "render_context_create");
        let mut render_ctx: *mut mpv_ffi::mpv_render_context = std::ptr::null_mut();
        let mut params = [
            mpv_ffi::mpv_render_param {
                param_type: mpv_ffi::render_param_type::API_TYPE,
                data: mpv_ffi::RENDER_API_TYPE_SW.as_ptr() as *mut c_void,
            },
            mpv_ffi::mpv_render_param {
                param_type: mpv_ffi::render_param_type::INVALID,
                data: std::ptr::null_mut(),
            },
        ];
        let rc = (functions.render_context_create)(&mut render_ctx, mpv, params.as_mut_ptr());
        if rc < 0 {
            return Err(format!("mpv_render_context_create a échoué (code {rc})"));
        }
        let ctx_guard = RenderCtxGuard(functions, render_ctx);

        let wake = Arc::new(WakeState {
            mutex: Mutex::new(()),
            condvar: Condvar::new(),
            dirty: AtomicBool::new(true),
        });
        let wake_ctx = Arc::into_raw(wake.clone()) as *mut c_void;
        set_stage(&stage, "update_callback");
        (functions.render_context_set_update_callback)(render_ctx, wake_trampoline, wake_ctx);

        // ⚠️ LIGNE PROUVÉE n°2 (ne JAMAIS la retirer) : force mpv à
        // présenter la frame cible au nouveau contexte de rendu — sans
        // elle, aucune image n'arrive jamais. Voir tête de fichier.
        set_stage(&stage, "seek_0_relative");
        let _ = command(functions, mpv, &["seek", "0", "relative"]);

        set_stage(&stage, "attente_frame");
        let outcome = (|| {
            let deadline = Instant::now() + FRAME_TIMEOUT;
            while Instant::now() < deadline {
                {
                    let guard = wake.mutex.lock().unwrap_or_else(|p| p.into_inner());
                    if !wake.dirty.load(Ordering::Acquire) {
                        let remaining = deadline.saturating_duration_since(Instant::now());
                        if remaining.is_zero() {
                            break;
                        }
                        let _ = wake
                            .condvar
                            .wait_timeout(guard, remaining.min(Duration::from_millis(200)));
                    }
                }
                                wake.dirty.store(false, Ordering::Release);

                // VOLONTAIREMENT AUCUN appel `wait_event` ici : régression
                // constatée en test réel (gels « attente_frame » sur le
                // scan privé) — sur un handle en pause, ce pompage se
                // bloque indéfiniment sur ce build de libmpv. Le réveil
                // passe uniquement par le callback mpv (Condvar), comme le
                // thread de rendu de production (sw_render.rs) qui ne
                // pompe jamais les événements. Pour une extraction bornée
                // à ~10 s, une file d'événements qui se remplit est sans
                // conséquence.
                                wake.dirty.store(false, Ordering::Release);

                let flags = (functions.render_context_update)(render_ctx);
                if flags & mpv_ffi::RENDER_UPDATE_FRAME == 0 {
                    continue;
                }

                set_stage(&stage, "render");

                set_stage(&stage, "render");
                let aspect = get_property_double(functions, mpv, "video-params/aspect")
                    .filter(|a| *a > 0.1 && *a < 10.0)
                    .unwrap_or(16.0 / 9.0);
                let width = THUMB_WIDTH;
                let height = ((width as f64 / aspect) as usize).clamp(2, width) & !1;

                let stride = align_up(width * BYTES_PER_PIXEL, MPV_SW_ALIGNMENT);
                let page_count = (stride * height + MPV_SW_ALIGNMENT - 1) / MPV_SW_ALIGNMENT;
                let mut pages = vec![AlignedPage([0u8; MPV_SW_ALIGNMENT]); page_count.max(1)];
                let base = pages.as_mut_ptr() as *mut u8;

                let mut sw_size: [c_int; 2] = [width as c_int, height as c_int];
                let mut stride_value = stride;
                let mut render_params = [
                    mpv_ffi::mpv_render_param {
                        param_type: mpv_ffi::render_param_type::SW_SIZE,
                        data: sw_size.as_mut_ptr() as *mut c_void,
                    },
                    mpv_ffi::mpv_render_param {
                        param_type: mpv_ffi::render_param_type::SW_FORMAT,
                        data: SW_FORMAT.as_ptr() as *mut c_void,
                    },
                    mpv_ffi::mpv_render_param {
                        param_type: mpv_ffi::render_param_type::SW_STRIDE,
                        data: &mut stride_value as *mut _ as *mut c_void,
                    },
                    mpv_ffi::mpv_render_param {
                        param_type: mpv_ffi::render_param_type::SW_POINTER,
                        data: base as *mut c_void,
                    },
                    mpv_ffi::mpv_render_param {
                        param_type: mpv_ffi::render_param_type::INVALID,
                        data: std::ptr::null_mut(),
                    },
                ];
                let render_rc =
                    (functions.render_context_render)(render_ctx, render_params.as_mut_ptr());
                if render_rc < 0 {
                    return Err(format!("mpv_render_context_render a échoué (code {render_rc})"));
                }

                // Compactage rgb0 -> rgb8 (on jette le 4e octet garbage).
                let mut rgb8 = Vec::with_capacity(width * 3 * height);
                for row in 0..height {
                    let start = row * stride;
                    for px in 0..width {
                        let o = start + px * BYTES_PER_PIXEL;
                        rgb8.push(*base.add(o));
                        rgb8.push(*base.add(o + 1));
                        rgb8.push(*base.add(o + 2));
                    }
                }
                set_stage(&stage, "ok");
                return Ok((width, height, rgb8));
            }
            Err("aucune image décodée avant le délai imparti".to_string())
        })();

        set_stage(&stage, "cleanup");
        (functions.render_context_set_update_callback)(
            render_ctx,
            no_op_wake_trampoline,
            std::ptr::null_mut(),
        );
        drop(Arc::from_raw(wake_ctx as *const WakeState));
        drop(ctx_guard);
        drop(handle);
        outcome
    }
}

/// Filet de sécurité : thread dédié + délai absolu. En cas de gel, le
/// message indique l'étape exacte (lue dans `stage`) — plus jamais de
/// diagnostic à l'aveugle. Le thread gelé est abandonné (fuite tolérée,
/// cas censé rester exceptionnel).
fn grab_one_frame_guarded(
    functions: Arc<MpvFunctions>,
    path: String,
    stage: Stage,
) -> Result<(usize, usize, Vec<u8>), String> {
    let (tx, rx) = std::sync::mpsc::channel();
    let stage_for_thread = stage.clone();
    std::thread::spawn(move || {
        let _ = tx.send(grab_one_frame(&functions, &path, stage_for_thread));
    });
    match rx.recv_timeout(FRAME_TIMEOUT + Duration::from_secs(5)) {
        Ok(result) => result,
        Err(_) => {
            let frozen_at = *stage.lock().unwrap_or_else(|p| p.into_inner());
            Err(format!(
                "gel mpv à l'étape « {frozen_at} » (délai absolu dépassé)"
            ))
        }
    }
}

/// Étape 6d-privé : même extracteur prouvé, mais le JPEG est encodé EN
/// MÉMOIRE et renvoyé en octets — jamais écrit en clair sur le disque :
/// le coffre stocke ses aperçus chiffrés en BLOB dans vault.db (§6.4 bis).
pub fn extract_jpeg_bytes(
    functions: Arc<MpvFunctions>,
    path: String,
) -> Result<Vec<u8>, String> {
    let stage: Stage = Arc::new(Mutex::new("départ"));
    let (width, height, rgb) = grab_one_frame_guarded(functions, path, stage)?;
    let mut buf: Vec<u8> = Vec::new();
    let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buf, JPEG_QUALITY);
    encoder
        .encode(&rgb, width as u32, height as u32, image::ColorType::Rgb8.into())
        .map_err(|e| e.to_string())?;
    Ok(buf)
}

fn save_jpeg(
    rgb: &[u8],
    width: usize,
    height: usize,
    dest: &std::path::Path,
) -> Result<(), String> {
    let file = std::fs::File::create(dest).map_err(|e| e.to_string())?;
    let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(file, JPEG_QUALITY);
    encoder
        .encode(rgb, width as u32, height as u32, image::ColorType::Rgb8.into())
        .map_err(|e| e.to_string())
}

/// Génère les vignettes manquantes de tous les épisodes d'une
/// bibliothèque ayant un fichier média rattaché. Séquentiel, dans le
/// thread d'arrière-plan appelant (jamais le thread UI). Émet
/// `library:scan-progress` (phase "thumbnails") throttlé à ~150 ms pour
/// la barre du frontend.
pub fn generate_missing(
    app: &AppHandle,
    pool: &DbPool,
    data_dir: &str,
    functions: Option<Arc<MpvFunctions>>,
    library_id: i64,
) {
    let Some(functions) = functions else {
        log::info!(
            "[vignettes] libmpv indisponible — génération sautée (bibliothèque {library_id})."
        );
        return;
    };
    let Ok(conn) = pool.get() else {
        log::error!("[vignettes] connexion base indisponible (bibliothèque {library_id}).");
        return;
    };
    let targets = match episode_repository::missing_still_paths(&conn, library_id) {
        Ok(targets) => targets,
        Err(e) => {
            log::error!("[vignettes] lecture des épisodes sans vignette impossible : {e}");
            return;
        }
    };
    if targets.is_empty() {
        log::info!(
            "[vignettes] bibliothèque {library_id} : aucun épisode sans vignette ayant un fichier rattaché — rien à faire."
        );
        return;
    }
    log::info!(
        "[vignettes] bibliothèque {library_id} : {} épisode(s) à traiter.",
        targets.len()
    );
    let dir = std::path::Path::new(data_dir)
        .join("thumbnails")
        .join("episodes");
    if let Err(e) = std::fs::create_dir_all(&dir) {
        log::error!("[vignettes] impossible de créer {} : {e}", dir.display());
        return;
    }

    let total = targets.len() as u64;
    let mut processed: u64 = 0;
    let mut last_emit: Option<Instant> = None;
    // Signale IMMÉDIATEMENT le changement de phase au frontend : sans
    // cela, l'interface reste sur « Appariement » pendant toute la
    // première tentative, donnant l'impression d'un blocage.
    let _ = app.emit(
        "library:scan-progress",
        serde_json::json!({
            "library_id": library_id,
            "phase": "thumbnails",
            "processed": 0u64,
            "total": total,
            "current": "",
        }),
    );

    let mut generated = 0u32;
    let mut failed = 0u32;
    for (episode_id, path) in targets {
        // Progression affichée AVANT la tentative : le nom du fichier
        // change à chaque épisode même si la tentative échoue —
        // l'interface ne donne jamais l'impression de geler.
        let now = Instant::now();
        let should_emit = last_emit
            .map(|previous| now.duration_since(previous) >= PROGRESS_INTERVAL)
            .unwrap_or(true);
        if should_emit {
            last_emit = Some(now);
            let current = std::path::Path::new(&path)
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or_default();
            let _ = app.emit(
                "library:scan-progress",
                serde_json::json!({
                    "library_id": library_id,
                    "phase": "thumbnails",
                    "processed": processed,
                    "total": total,
                    "current": current,
                }),
            );
        }

        // UN SEUL traitement par épisode, toujours via le filet de
        // sécurité — jamais d'appel direct à `grab_one_frame` ici.
        if !std::path::Path::new(&path).exists() {
            failed += 1;
        } else {
            let stage: Stage = Arc::new(Mutex::new("départ"));
            match grab_one_frame_guarded(functions.clone(), path.clone(), stage) {
                Ok((width, height, rgb)) => {
                    let dest = dir.join(format!("episode_{episode_id}.jpg"));
                    match save_jpeg(&rgb, width, height, &dest) {
                        Ok(()) => {
                            let dest_str = dest.to_string_lossy().to_string();
                            if let Err(e) =
                                episode_repository::update_still_path(&conn, episode_id, &dest_str)
                            {
                                log::warn!(
                                    "[vignettes] épisode {episode_id} : image créée mais base non mise à jour : {e}"
                                );
                                failed += 1;
                            } else {
                                generated += 1;
                            }
                        }
                        Err(e) => {
                            log::warn!("[vignettes] épisode {episode_id} : échec JPEG : {e}");
                            failed += 1;
                        }
                    }
                }
                Err(e) => {
                    log::warn!("[vignettes] épisode {episode_id} ({path}) : {e}");
                    failed += 1;
                }
            }
        }
        processed += 1;
    }

    // Tick final forcé : processed == total, barre pleine avant "done".
    let _ = app.emit(
        "library:scan-progress",
        serde_json::json!({
            "library_id": library_id,
            "phase": "thumbnails",
            "processed": processed,
            "total": total,
            "current": "",
        }),
    );
    log::info!(
        "[vignettes] bibliothèque {library_id} : {generated} vignette(s) générée(s), {failed} échec(s)."
    );
    let _ = app.emit(
        "library:episode-thumbnails",
        ThumbnailSummary {
            library_id,
            generated,
            failed,
        },
    );
}