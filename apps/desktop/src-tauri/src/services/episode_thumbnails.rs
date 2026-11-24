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
//!       `terminate_destroy` rapide au nettoyage ;
//!   2. `seek 0 relative` juste après l'installation du callback de
//!      réveil : sans ce seek, mpv considère la frame comme déjà
//!      « présentée » et ne réveille JAMAIS le nouveau contexte de rendu
//!      (même mécanisme que le correctif « image figée du PiP » de
//!       `sw_render.rs`).
//!
//! 0.6.5 (correctif vignettes manquantes) : stratégie multi-positions
//! de seek avec repli automatique. Timeout proportionnel à la taille du
//! fichier (2s de base + 1s par 100 Mo).
//!
//! Vignettes NOIRES (Anime, Séries) — deux défauts corrigés :
//!   1. la durée était lue JUSTE après `loadfile`, avant que le fichier soit
//!      ouvert : absente, elle faisait retomber TOUTES les positions en
//!      ratio sur 1 s — donc la même image de début (fondu, logo sur noir) à
//!      chaque tentative. On attend maintenant que la durée soit connue ;
//!   2. la première image obtenue était gardée sans jamais être regardée.
//!      Les images noires ou unies sont maintenant écartées (`frame_stats`)
//!      et la capture passe à la position suivante (25 %, 40 %, 10 %, 55 %,
//!      70 %…), en gardant la meilleure image si aucune n'est claire.
//! Les vignettes DÉJÀ générées et noires sont régénérées une fois par
//! bibliothèque (`repair_dark_stills`).
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

/// Positions de seek à essayer (en secondes ou ratio de la durée). Le début d'un épisode est
/// souvent noir (fondu, logo du studio) et l'ouverture/générique n'est pas représentative : on
/// commence à 25 % (récit), puis 40 %, 10 %, 55 %, 70 %, et seulement ensuite les positions
/// courtes (30 s, 1 s, première image) pour les médias très courts ou sans durée fiable.
const SEEK_POSITIONS: &[SeekPosition] = &[
    SeekPosition::Ratio(0.25),
    SeekPosition::Ratio(0.40),
    SeekPosition::Ratio(0.10),
    SeekPosition::Ratio(0.55),
    SeekPosition::Ratio(0.70),
    SeekPosition::Absolute(30.0),
    SeekPosition::Absolute(1.0),
    SeekPosition::Absolute(0.0),
];

/// Timeout de base pour un fichier (augmenté proportionnellement à la taille)
const BASE_TIMEOUT: Duration = Duration::from_secs(8);
const TIMEOUT_PER_100MB: Duration = Duration::from_secs(1);

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

/// Position de seek : soit absolue (secondes), soit relative (ratio de la durée)
#[derive(Clone, Copy, Debug)]
enum SeekPosition {
    Absolute(f64),
    Ratio(f64),
}

fn align_up(value: usize, align: usize) -> usize {
    (value + align - 1) / align * align
}

#[derive(Clone, Copy)]
#[repr(align(64))]
struct AlignedPage {
    // Jamais lu : seul le bloc (adresse alignée + taille) compte pour mpv.
    _bytes: [u8; 64],
}

// Garde-fou compile-time : le cast `Vec<AlignedPage>` -> `*mut u8` et le calcul
// `page_count = octets / MPV_SW_ALIGNMENT` ne sont valides que si un bloc fait
// exactement MPV_SW_ALIGNMENT octets ET est aligné sur MPV_SW_ALIGNMENT.
const _: () = assert!(
    std::mem::size_of::<AlignedPage>() == MPV_SW_ALIGNMENT
        && std::mem::align_of::<AlignedPage>() == MPV_SW_ALIGNMENT
);

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

/// Attend (jusqu'à `max_wait`) que mpv connaisse la durée du fichier ouvert.
fn wait_for_duration(functions: &MpvFunctions, mpv: *mut c_void, max_wait: Duration) -> Option<f64> {
    let start = Instant::now();
    loop {
        if let Some(d) = get_property_double(functions, mpv, "duration").filter(|d| *d > 0.0) {
            return Some(d);
        }
        if start.elapsed() >= max_wait {
            return None;
        }
        std::thread::sleep(Duration::from_millis(40));
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

/// Calcule le timeout adapté à la taille du fichier
fn compute_timeout(path: &str) -> Duration {
    match std::fs::metadata(path) {
        Ok(metadata) => {
            let size_mb = metadata.len() / (1024 * 1024);
            let extra = (size_mb / 100) as u32;
            BASE_TIMEOUT + TIMEOUT_PER_100MB * extra
        }
        Err(_) => BASE_TIMEOUT,
    }
}

/// Extrait UNE image du fichier à la position donnée, rendue en logiciel à
/// `THUMB_WIDTH` de large. Renvoie `(largeur, hauteur, pixels RGB8
/// compacts)`. Aucune ressource mpv ne survit à cet appel : handle et
/// contexte de rendu sont détruits sur tous les chemins (gardes RAII +
/// désenregistrement du callback).
fn grab_one_frame(
    functions: &MpvFunctions,
    path: &str,
    seek_pos: SeekPosition,
    stage: Stage,
    timeout: Duration,
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

        // Calcule la position de seek absolue
        let seek_seconds = match seek_pos {
            SeekPosition::Absolute(secs) => secs,
            SeekPosition::Ratio(ratio) => {
                // La durée n'existe qu'une fois le fichier ouvert : on l'attend (bornée), sinon
                // toutes les positions en ratio retombaient sur 1 s (vignettes noires).
                let duration = wait_for_duration(functions, mpv, timeout.min(Duration::from_secs(5)))
                    .unwrap_or(0.0);
                if duration > 0.0 {
                    duration * ratio
                } else {
                    1.0 // Fallback si durée inconnue
                }
            }
        };

        // Seek à la position calculée
        let seek_str = format!("{:.3}", seek_seconds);
        set_stage(&stage, "seek");
        command(functions, mpv, &["seek", &seek_str, "absolute"])?;

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
            let deadline = Instant::now() + timeout;
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

                let flags = (functions.render_context_update)(render_ctx);
                if flags & mpv_ffi::RENDER_UPDATE_FRAME == 0 {
                    continue;
                }

                set_stage(&stage, "render");
                let aspect = get_property_double(functions, mpv, "video-params/aspect")
                    .filter(|a| *a > 0.1 && *a < 10.0)
                    .unwrap_or(16.0 / 9.0);
                let width = THUMB_WIDTH;
                let height = ((width as f64 / aspect) as usize).clamp(2, width) & !1;
                let stride = align_up(width * BYTES_PER_PIXEL, MPV_SW_ALIGNMENT);
                let page_count = (stride * height + MPV_SW_ALIGNMENT - 1) / MPV_SW_ALIGNMENT;
                let mut pages = vec![AlignedPage { _bytes: [0u8; MPV_SW_ALIGNMENT] }; page_count.max(1)];
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
            Err(format!(
                "aucune image décodée avant le délai imparti ({:?}) à la position {:?}",
                timeout, seek_pos
            ))
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

// ---- Vignettes : images noires (début) ----

/// Luminosité à partir de laquelle un pixel compte comme « allumé » (0–255).
const BRIGHT_LUMA: f64 = 40.0;

/// Statistiques d'une image RGB8 (triplets R, G, B).
#[derive(Clone, Copy, Debug)]
pub struct FrameStats {
    pub mean_luma: f32,
    pub std_dev: f32,
    /// Part des pixels « allumés » (> `BRIGHT_LUMA`).
    pub bright_ratio: f32,
}

pub fn frame_stats(rgb: &[u8]) -> FrameStats {
    let n = rgb.len() / 3;
    if n == 0 {
        return FrameStats { mean_luma: 0.0, std_dev: 0.0, bright_ratio: 0.0 };
    }
    let (mut sum, mut sum_sq, mut bright) = (0f64, 0f64, 0usize);
    for px in rgb.chunks_exact(3) {
        let luma = 0.299 * px[0] as f64 + 0.587 * px[1] as f64 + 0.114 * px[2] as f64;
        sum += luma;
        sum_sq += luma * luma;
        if luma > BRIGHT_LUMA {
            bright += 1;
        }
    }
    let count = n as f64;
    let mean = sum / count;
    let variance = (sum_sq / count - mean * mean).max(0.0);
    FrameStats {
        mean_luma: mean as f32,
        std_dev: variance.sqrt() as f32,
        bright_ratio: (bright as f64 / count) as f32,
    }
}

/// Image acceptable comme vignette : ni noire (fondu, écran noir de début d'épisode) ni
/// uniforme (écran plat noir, blanc ou d'une seule couleur). Une scène de nuit, sombre mais
/// avec du détail, reste acceptée.
pub fn frame_is_usable(stats: &FrameStats) -> bool {
    let black = stats.mean_luma < 16.0 && stats.bright_ratio < 0.05;
    let flat = stats.std_dev < 6.0;
    !black && !flat
}

/// Pour départager des images non acceptables : la plus claire et la plus contrastée.
pub fn frame_score(stats: &FrameStats) -> f32 {
    stats.mean_luma.min(128.0) + stats.std_dev
}

/// Garde la meilleure image vue au fil des positions essayées.
pub struct FrameChooser {
    best: Option<(f32, usize, usize, Vec<u8>)>,
}

impl FrameChooser {
    pub fn new() -> Self {
        Self { best: None }
    }

    /// Propose une image : `true` si elle est acceptable (inutile d'essayer d'autres positions).
    pub fn offer(&mut self, width: usize, height: usize, rgb: Vec<u8>) -> bool {
        let stats = frame_stats(&rgb);
        let usable = frame_is_usable(&stats);
        let score = frame_score(&stats);
        if usable || self.best.as_ref().map_or(true, |(best, ..)| score > *best) {
            self.best = Some((score, width, height, rgb));
        }
        usable
    }

    pub fn into_best(self) -> Option<(usize, usize, Vec<u8>)> {
        self.best.map(|(_, w, h, rgb)| (w, h, rgb))
    }
}

/// Une vignette JPEG déjà enregistrée est-elle noire/unie ? `None` si elle est illisible.
pub fn dark_still_bytes(jpeg: &[u8]) -> Option<bool> {
    let image = image::load_from_memory(jpeg).ok()?.to_rgb8();
    Some(!frame_is_usable(&frame_stats(image.as_raw())))
}

/// Marque (par bibliothèque) le contrôle des vignettes noires déjà effectué.
const DARK_CHECK_MARKER: &str = ".dark-check-v1";

/// Vignettes DÉJÀ générées mais noires (anciennes captures à 1 s) ou dont le fichier a disparu :
/// retirées de la base pour être régénérées par `generate_missing`. Une seule fois par
/// bibliothèque (marqueur dans le dossier des vignettes). Ne touche que les images de ce dossier :
/// une image venue d'ailleurs (TMDB) n'est jamais supprimée. Renvoie le nombre retirées.
fn repair_dark_stills(conn: &rusqlite::Connection, dir: &std::path::Path, library_id: i64) -> u32 {
    let marker = dir.join(format!("{DARK_CHECK_MARKER}-lib{library_id}"));
    if marker.exists() {
        return 0;
    }
    let stills = match episode_repository::list_still_paths(conn, library_id) {
        Ok(stills) => stills,
        Err(e) => {
            log::warn!("[vignettes] contrôle des vignettes noires impossible : {e}");
            return 0;
        }
    };
    let mut cleared = 0u32;
    for (episode_id, still) in stills {
        let path = std::path::Path::new(&still);
        if !path.starts_with(dir) {
            continue;
        }
        let unusable = match std::fs::read(path) {
            Ok(bytes) => dark_still_bytes(&bytes).unwrap_or(false),
            Err(_) => true, // fichier absent : à régénérer
        };
        if unusable && episode_repository::clear_still_path(conn, episode_id).is_ok() {
            let _ = std::fs::remove_file(path);
            cleared += 1;
        }
    }
    let _ = std::fs::write(&marker, b"ok");
    log::info!(
        "[vignettes] bibliothèque {library_id} : {cleared} vignette(s) noire(s) ou absente(s) à régénérer."
    );
    cleared
}

// ---- Vignettes : images noires (fin) ----

/// Essaie plusieurs positions de seek jusqu'à obtenir une image acceptable (ni noire ni unie) ;
/// si aucune ne l'est, garde la meilleure. Échoue seulement si AUCUNE image n'a pu être obtenue.
fn grab_one_frame_with_retries(
    functions: &MpvFunctions,
    path: &str,
    stage: Stage,
) -> Result<(usize, usize, Vec<u8>), String> {
    let timeout = compute_timeout(path);
    let mut last_error = String::new();
    let name = || {
        std::path::Path::new(path)
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default()
    };
    let mut chooser = FrameChooser::new();

    for (i, &seek_pos) in SEEK_POSITIONS.iter().enumerate() {
        set_stage(&stage, "tentative");
        match grab_one_frame(functions, path, seek_pos, stage.clone(), timeout) {
            Ok((width, height, rgb)) => {
                if chooser.offer(width, height, rgb) {
                    if i > 0 {
                        log::debug!(
                            "[vignettes] {} : image claire obtenue à la tentative {} ({:?})",
                            name(),
                            i + 1,
                            seek_pos
                        );
                    }
                    return chooser
                        .into_best()
                        .ok_or_else(|| "image acceptable introuvable".to_string());
                }
                log::debug!(
                    "[vignettes] {} : image noire/unie à la position {:?}, autre position…",
                    name(),
                    seek_pos
                );
            }
            Err(e) => {
                log::debug!("[vignettes] {} : échec à la position {:?} — {}", name(), seek_pos, e);
                last_error = e;
            }
        }
    }

    match chooser.into_best() {
        Some(frame) => {
            log::warn!(
                "[vignettes] {} : aucune image claire trouvée, la meilleure image est conservée.",
                name()
            );
            Ok(frame)
        }
        None => Err(format!("toutes les positions de seek ont échoué : {last_error}")),
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
    // 0.6.5 : calcul du timeout AVANT le spawn — `path` est déplacé dans
    // la closure et ne serait plus disponible après.
    // Plus de positions possibles (image noire → autre position) : le budget global suit.
    let timeout = compute_timeout(&path)
        + Duration::from_secs(5)
        + Duration::from_secs(2 * (SEEK_POSITIONS.len() as u64 - 1));
    
    let (tx, rx) = std::sync::mpsc::channel();
    let stage_for_thread = stage.clone();
    std::thread::spawn(move || {
        let _ = tx.send(grab_one_frame_with_retries(&functions, &path, stage_for_thread));
    });
    
    match rx.recv_timeout(timeout) {
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
    let thumbs_dir = std::path::Path::new(data_dir).join("thumbnails").join("episodes");
    if std::fs::create_dir_all(&thumbs_dir).is_ok() {
        repair_dark_stills(&conn, &thumbs_dir, library_id);
    }
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

#[cfg(test)]
mod frame_tests {
    use super::*;

    fn solid(w: usize, h: usize, rgb: [u8; 3]) -> Vec<u8> {
        (0..w * h).flat_map(|_| rgb).collect()
    }

    /// Dégradé + motif : une vraie « scène ».
    fn scene(w: usize, h: usize, base: u8) -> Vec<u8> {
        let mut v = Vec::with_capacity(w * h * 3);
        for y in 0..h {
            for x in 0..w {
                let shade = base as usize + ((x * 3 + y * 2) % 90);
                let c = shade.min(255) as u8;
                v.extend_from_slice(&[c, c.saturating_sub(10), c.saturating_sub(25)]);
            }
        }
        v
    }

    fn jpeg(w: u32, h: u32, rgb: &[u8]) -> Vec<u8> {
        let mut out = Vec::new();
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, 80)
            .encode(rgb, w, h, image::ExtendedColorType::Rgb8)
            .unwrap();
        out
    }

    #[test]
    fn une_image_noire_est_rejetee() {
        let s = frame_stats(&solid(64, 36, [0, 0, 0]));
        assert!(!frame_is_usable(&s));
        // Fondu d'entrée presque noir (cas typique à 1 s d'un épisode).
        assert!(!frame_is_usable(&frame_stats(&solid(64, 36, [6, 6, 8]))));
    }

    #[test]
    fn une_image_unie_est_rejetee_noire_blanche_ou_coloree() {
        for rgb in [[255, 255, 255], [128, 128, 128], [200, 30, 30], [0, 0, 0]] {
            assert!(!frame_is_usable(&frame_stats(&solid(64, 36, rgb))), "{rgb:?}");
        }
    }

    #[test]
    fn une_vraie_scene_est_acceptee() {
        assert!(frame_is_usable(&frame_stats(&scene(64, 36, 60))));
    }

    #[test]
    fn une_scene_de_nuit_sombre_mais_detaillee_est_acceptee() {
        // Moyenne basse, mais du détail et des zones allumées : pas une image noire.
        let mut night = solid(64, 36, [8, 8, 12]);
        for px in night.chunks_exact_mut(3).step_by(5) {
            px.copy_from_slice(&[120, 110, 90]); // fenêtres allumées
        }
        let s = frame_stats(&night);
        assert!(s.mean_luma < 40.0 && s.bright_ratio >= 0.05, "{s:?}");
        assert!(frame_is_usable(&s));
    }

    #[test]
    fn image_vide_ou_tronquee_ne_plante_pas() {
        let s = frame_stats(&[]);
        assert!(!frame_is_usable(&s));
        let _ = frame_stats(&[1, 2]); // moins d'un pixel
    }

    #[test]
    fn le_selecteur_s_arrete_a_la_premiere_image_claire_et_la_garde() {
        let mut c = FrameChooser::new();
        assert!(!c.offer(64, 36, solid(64, 36, [0, 0, 0])), "noire : on continue");
        assert!(!c.offer(64, 36, solid(64, 36, [255, 255, 255])), "unie : on continue");
        let bonne = scene(64, 36, 80);
        assert!(c.offer(64, 36, bonne.clone()), "claire : on s'arrête");
        let (w, h, rgb) = c.into_best().unwrap();
        assert_eq!((w, h), (64, 36));
        assert_eq!(rgb, bonne);
    }

    #[test]
    fn sans_image_claire_la_meilleure_des_sombres_est_gardee() {
        let mut c = FrameChooser::new();
        let tres_noire = solid(64, 36, [0, 0, 0]);
        // Un peu plus claire mais toujours uniforme : meilleure que la noire.
        let grise_sombre = solid(64, 36, [14, 14, 14]);
        assert!(!c.offer(64, 36, tres_noire));
        assert!(!c.offer(64, 36, grise_sombre.clone()));
        assert!(!c.offer(64, 36, solid(64, 36, [2, 2, 2])));
        assert_eq!(c.into_best().unwrap().2, grise_sombre);
    }

    #[test]
    fn un_selecteur_vide_ne_renvoie_rien() {
        assert!(FrameChooser::new().into_best().is_none());
    }

    #[test]
    fn les_vignettes_deja_enregistrees_noires_sont_reconnues_via_un_vrai_jpeg() {
        let noire = jpeg(64, 36, &solid(64, 36, [0, 0, 0]));
        let claire = jpeg(64, 36, &scene(64, 36, 70));
        assert_eq!(dark_still_bytes(&noire), Some(true));
        assert_eq!(dark_still_bytes(&claire), Some(false));
        assert_eq!(dark_still_bytes(b"ceci n'est pas un jpeg"), None);
        assert_eq!(dark_still_bytes(&[]), None);
    }
}

#[cfg(test)]
mod repair_tests {
    use super::*;
    use crate::db::migrations::MIGRATIONS;

    fn jpeg(rgb: &[u8]) -> Vec<u8> {
        let mut out = Vec::new();
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, 80)
            .encode(rgb, 64, 36, image::ExtendedColorType::Rgb8)
            .unwrap();
        out
    }

    fn black() -> Vec<u8> {
        jpeg(&vec![0u8; 64 * 36 * 3])
    }

    fn bright() -> Vec<u8> {
        let mut v = Vec::new();
        for y in 0..36usize {
            for x in 0..64usize {
                let c = (60 + (x * 3 + y * 2) % 100) as u8;
                v.extend_from_slice(&[c, c, c.saturating_sub(20)]);
            }
        }
        jpeg(&v)
    }

    fn setup(dir_tag: &str) -> (rusqlite::Connection, std::path::PathBuf) {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "PRAGMA foreign_keys = OFF;
             CREATE TABLE vaulttube_subscriptions (id INTEGER PRIMARY KEY);
             CREATE TABLE vaulttube_videos (id INTEGER PRIMARY KEY);
             CREATE TABLE vaulttube_playlists (id INTEGER PRIMARY KEY);
             CREATE TABLE vaulttube_user_playlists (id INTEGER PRIMARY KEY);
             CREATE TABLE vaulttube_user_playlist_items (id INTEGER PRIMARY KEY);",
        )
        .unwrap();
        for m in MIGRATIONS {
            conn.execute_batch(m.sql).unwrap_or_else(|e| panic!("migration {} : {e}", m.version));
        }
        conn.execute(
            "INSERT INTO titles (id, category_id, kind, name, created_at, updated_at) VALUES (10, 1, 'series', 'S', 'x', 'x')",
            [],
        )
        .unwrap();
        conn.execute("INSERT INTO seasons (id, title_id, season_number, created_at) VALUES (1, 10, 1, 'x')", [])
            .unwrap();
        let dir = std::env::temp_dir().join(format!("avm-stills-{dir_tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        (conn, dir)
    }

    fn add_episode(conn: &rusqlite::Connection, n: i64, still: &std::path::Path) {
        conn.execute(
            "INSERT INTO episodes (id, title_id, season_id, episode_number, created_at, still_path)
             VALUES (?1, 10, 1, ?1, 'x', ?2)",
            rusqlite::params![n, still.to_string_lossy().to_string()],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO media_files (id, library_id, folder_id, path, file_name, size_bytes,
                                      modified_at, discovered_at, updated_at, episode_id)
             VALUES (?1, 1, 1, ?2, 'f', 1, 'x', 'x', 'x', ?1)",
            rusqlite::params![n, format!("/m/{n}.mkv")],
        )
        .unwrap();
    }

    fn still_of(conn: &rusqlite::Connection, n: i64) -> Option<String> {
        conn.query_row("SELECT still_path FROM episodes WHERE id = ?1", [n], |r| r.get(0)).unwrap()
    }

    #[test]
    fn les_vignettes_noires_ou_absentes_sont_retirees_les_bonnes_et_les_externes_conservees() {
        let (conn, dir) = setup("reparation");
        let noire = dir.join("episode_1.jpg");
        let claire = dir.join("episode_2.jpg");
        let absente = dir.join("episode_3.jpg"); // jamais écrite
        let externe_dir = std::env::temp_dir().join(format!("avm-stills-externe-{}", std::process::id()));
        std::fs::create_dir_all(&externe_dir).unwrap();
        let externe = externe_dir.join("tmdb_still.jpg"); // image « TMDB » noire hors du dossier : intouchable
        std::fs::write(&noire, black()).unwrap();
        std::fs::write(&claire, bright()).unwrap();
        std::fs::write(&externe, black()).unwrap();
        add_episode(&conn, 1, &noire);
        add_episode(&conn, 2, &claire);
        add_episode(&conn, 3, &absente);
        add_episode(&conn, 4, &externe);

        assert_eq!(repair_dark_stills(&conn, &dir, 1), 2, "la noire et l'absente");
        assert_eq!(still_of(&conn, 1), None);
        assert!(!noire.exists(), "le fichier noir est supprimé");
        assert_eq!(still_of(&conn, 2).as_deref(), Some(claire.to_string_lossy().as_ref()));
        assert!(claire.exists());
        assert_eq!(still_of(&conn, 3), None);
        assert!(still_of(&conn, 4).is_some(), "une image hors du dossier des vignettes n'est jamais touchée");
        assert!(externe.exists());

        // Les retirées redeviennent des cibles de génération.
        let missing: Vec<i64> = episode_repository::missing_still_paths(&conn, 1).unwrap().into_iter().map(|m| m.0).collect();
        assert_eq!(missing, vec![1, 3]);
        let _ = std::fs::remove_dir_all(dir);
        let _ = std::fs::remove_dir_all(externe_dir);
    }

    #[test]
    fn le_controle_ne_s_execute_qu_une_fois_par_bibliotheque() {
        let (conn, dir) = setup("une-fois");
        let noire = dir.join("episode_1.jpg");
        std::fs::write(&noire, black()).unwrap();
        add_episode(&conn, 1, &noire);
        assert_eq!(repair_dark_stills(&conn, &dir, 1), 1);
        // Une vignette noire régénérée ensuite (meilleure image disponible) ne sera pas rejetée en boucle.
        std::fs::write(&noire, black()).unwrap();
        conn.execute("UPDATE episodes SET still_path = ?1 WHERE id = 1", [noire.to_string_lossy().to_string()]).unwrap();
        assert_eq!(repair_dark_stills(&conn, &dir, 1), 0, "marqueur présent : rien à refaire");
        assert!(still_of(&conn, 1).is_some());
        // Une autre bibliothèque a son propre marqueur.
        assert!(dir.join(".dark-check-v1-lib1").exists());
        assert!(!dir.join(".dark-check-v1-lib2").exists());
        let _ = std::fs::remove_dir_all(dir);
    }
}
