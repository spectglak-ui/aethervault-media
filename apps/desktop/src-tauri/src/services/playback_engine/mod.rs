//! Playback Engine Bridge (doc §4.2) — Étape 3b, puis migration Étape 3c
//! (abandon du rendu Win32/OpenGL natif au profit du rendu logiciel +
//! `<canvas>`, voir le rapport de transmission "écran noir" et la
//! discussion qui a suivi).
pub(crate) mod mpv_ffi;
mod sw_render;
pub use sw_render::set_render_scale;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

use mpv_ffi::MpvFormat;
pub use mpv_ffi::MpvFunctions;
use std::ffi::{c_void, CStr, CString};
use std::os::raw::{c_char, c_int};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicI32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, Emitter};

#[derive(Clone, Default, serde::Serialize)]
pub struct PlayerStateEvent {
    pub position_seconds: Option<f64>,
    pub duration_seconds: Option<f64>,
    pub playing: Option<bool>,
    pub ended: bool,
    pub error: Option<String>,
    /// 0.4.0 : fin du préchargement (timestamp absolu) pour la barre verte.
    pub buffered_seconds: Option<f64>,
}

#[derive(Clone, serde::Serialize)]
pub struct PlayerTrack {
    pub id: i64,
    pub lang: Option<String>,
    pub title: Option<String>,
    pub selected: bool,
}

#[derive(Clone, Default, serde::Serialize)]
pub struct TrackList {
    pub audio: Vec<PlayerTrack>,
    pub subtitles: Vec<PlayerTrack>,
}

/// 0.4.0 (lecteur hybride) : extraction SANS lecture. Renvoie un flux
/// fusionné (lisible par <video> HTML5) ou séparé (mpv uniquement).
#[derive(Clone, serde::Serialize)]
pub struct ExtractedMedia {
    pub kind: String, // "merged" | "split"
    pub url: String,
    pub audio_url: Option<String>,
}

/// 0.5.0 : option de qualité proposée au sélecteur AetherFy.
#[derive(Clone, serde::Serialize)]
pub struct QualityOption {
    pub height: i64,
    pub label: String,
    pub has_audio: bool,
}

#[derive(Clone, Copy)]
struct MpvHandlePtr(*mut c_void);
unsafe impl Send for MpvHandlePtr {}
unsafe impl Sync for MpvHandlePtr {}

struct SurfaceState {
    stop_flag: Arc<AtomicBool>,
    render_thread: Option<std::thread::JoinHandle<()>>,
    size: Arc<(AtomicI32, AtomicI32)>,
    in_flight_frames: Arc<AtomicI32>,
    /// Repli PiP : dernière image rendue, partagée avec le thread de rendu
    /// (`sw_render.rs`) et lue par la commande `player_pull_frame` pour les
    /// fenêtres dont le canal Tauri est muet (fenêtre détachée).
    latest_frame: Arc<Mutex<Vec<u8>>>,
}

/// 0.5.3 : « start gate » — pour les flux réseau, la lecture reste en
/// pause jusqu'à ce que la barre verte atteigne 30 % de la durée
/// (bornée à [5 s, 240 s]), ou 45 s d'attente max (timeout de sécurité).
struct StartGate {
    armed: AtomicBool,
    armed_at: Mutex<Instant>,
    /// (durée_seconds, buffered_seconds) — dernières valeurs observées.
    latest: Mutex<(f64, f64)>,
}

impl StartGate {
    fn new() -> Self {
        Self {
            armed: AtomicBool::new(false),
            armed_at: Mutex::new(Instant::now()),
            latest: Mutex::new((0.0, 0.0)),
        }
    }

    fn arm(&self) {
        *self.latest.lock().unwrap_or_else(|p| p.into_inner()) = (0.0, 0.0);
        *self.armed_at.lock().unwrap_or_else(|p| p.into_inner()) = Instant::now();
        self.armed.store(true, Ordering::Relaxed);
    }

    fn disarm(&self) {
        self.armed.store(false, Ordering::Relaxed);
    }
}

/// Depuis le thread d'événements mpv : libère la gate quand le buffer
/// atteint 30 % de la durée (ou timeout 45 s) → `set pause no`.
fn maybe_release_gate(
    gate: &StartGate,
    functions: &MpvFunctions,
    mpv: MpvHandlePtr,
    duration: Option<f64>,
    buffered: Option<f64>,
) {
    if !gate.armed.load(Ordering::Relaxed) {
        return;
    }
    {
        let mut latest = gate.latest.lock().unwrap_or_else(|p| p.into_inner());
        if let Some(d) = duration {
            latest.0 = d;
        }
        if let Some(c) = buffered {
            latest.1 = c;
        }
    }
    let (dur, cache) = *gate.latest.lock().unwrap_or_else(|p| p.into_inner());
    let target = if dur > 1.0 {
        (dur * 0.30).clamp(5.0, 240.0)
    } else {
        10.0
    };
    let timed_out = gate.armed_at.lock().unwrap_or_else(|p| p.into_inner()).elapsed()
        > Duration::from_secs(45);
    if cache >= target || timed_out {
        gate.disarm();
        let c_args = vec![
            CString::new("set").unwrap_or_default(),
            CString::new("pause").unwrap_or_default(),
            CString::new("no").unwrap_or_default(),
        ];
        let mut ptrs: Vec<*const c_char> = c_args.iter().map(|a| a.as_ptr()).collect();
        ptrs.push(std::ptr::null());
        unsafe {
            (functions.command)(mpv.0, ptrs.as_ptr());
        }
        log::info!(
            "[playback] start gate : lecture lancée (buffer {:.0}s / cible {:.0}s{})",
            cache,
            target,
            if timed_out { ", timeout 45s" } else { "" }
        );
    }
}

pub struct PlaybackEngineHandle {
    functions: Arc<MpvFunctions>,
    mpv: MpvHandlePtr,
    surface: Mutex<Option<SurfaceState>>,
    /// 0.5.0 : dernière source chargée (vidéo, audio séparé éventuel).
    last_source: Mutex<Option<(String, Option<String>)>>,
    /// 0.5.0 : qualité préférée (bouton AetherFy). `None` = auto.
    preferred_quality: Mutex<Option<i64>>,
    /// 0.5.2 : cache du PO Token YouTube — (visitor_data, po_token, instant).
    /// Valide 30 min (marge de sécurité sur les ~60 min annoncés par YouTube).
    pot_cache: Mutex<Option<(String, String, Instant)>>,
    /// 0.5.3 : start gate (buffer 30 % → lecture).
    gate: Arc<StartGate>,
}

pub enum PlaybackEngineState {
    Ready(Arc<PlaybackEngineHandle>),
    Unavailable(String),
}

impl PlaybackEngineState {
    pub fn handle(&self) -> Result<&Arc<PlaybackEngineHandle>, String> {
        match self {
            Self::Ready(handle) => Ok(handle),
            Self::Unavailable(reason) => {
                Err(format!("Moteur de lecture natif indisponible : {reason}"))
            }
        }
    }
}

impl PlaybackEngineHandle {
    /// Étape 6d : expose les fonctions libmpv chargées pour qu'un service
    /// externe (vignettes d'épisodes) crée ses PROPRES handles mpv
    /// indépendants — jamais le handle de lecture lui-même.
    pub fn mpv_functions(&self) -> Arc<MpvFunctions> {
        self.functions.clone()
    }

    pub fn start(app_handle: AppHandle) -> Result<Arc<Self>, String> {
        let library_path = locate_library()?;

        if let Some(ytdlp) = locate_ytdlp() {
            if let Some(dir) = ytdlp.parent() {
                let old_path = std::env::var("PATH").unwrap_or_default();
                let sep = if cfg!(windows) { ";" } else { ":" };
                let dir_str = dir.to_string_lossy();
                if !old_path.split(sep).any(|p| p == dir_str.as_ref()) {
                    std::env::set_var("PATH", format!("{dir_str}{sep}{old_path}"));
                }
                log::info!("[playback] yt-dlp disponible : {}", ytdlp.display());
            }
        } else {
            log::info!("[playback] yt-dlp introuvable — lecture d'URLs désactivée");
        }

        // 0.5.2 : détection du sidecar PO Token (bgutil-pot-server Rust).
        if let Some(pot) = locate_bgutil_pot() {
            log::info!("[playback] PO Token sidecar disponible : {}", pot.display());
        } else {
            log::info!(
                "[playback] PO Token sidecar introuvable — repli sur clients tv/android/web"
            );
        }

        let functions =
            Arc::new(MpvFunctions::load(&library_path).map_err(|err| err.to_string())?);
        let mpv_ptr = unsafe { (functions.create)() };
        if mpv_ptr.is_null() {
            return Err("mpv_create a échoué".to_string());
        }
        let mpv = MpvHandlePtr(mpv_ptr);

        set_option(&functions, mpv, "vo", "libmpv")?;
        set_option(&functions, mpv, "hwdec", "auto-safe")?;
        // 0.5.3 : SUPPRIMÉ `video-timing-offset=0.150` (décalait la vidéo
        // de 150 ms par rapport à l'audio).
        set_option(&functions, mpv, "keep-open", "yes")?;
        let _ = set_option(&functions, mpv, "ytdl", "yes");
        let _ = set_option(
            &functions,
            mpv,
            "ytdl-format",
            "bv*[height=1080]+ba/bv*[height=720]+ba/bv*[height<=1080]+ba/b[height<=1080]",
        );
        // 0.5.4 : anti-grésillement — buffer de sortie audio plus généreux
        // (500 ms au lieu des 250 ms par défaut) : absorbe les micro-pics
        // CPU/GC sans underrun audible.
        let _ = set_option(&functions, mpv, "audio-buffer", "0.5");
        // 0.5.3 : le cache DEVANCE la lecture mais on NE L'ATTEND PAS via
        // mpv (plus de `demuxer-cache-wait`) : c'est la « start gate » Rust
        // qui démarre la lecture à 30 % de buffer (timeout 45 s).
        let _ = set_option(&functions, mpv, "cache", "yes");
        let _ = set_option(&functions, mpv, "demuxer-max-bytes", "512MiB");
        let _ = set_option(&functions, mpv, "demuxer-max-back-bytes", "256MiB");
        let _ = set_option(&functions, mpv, "network-timeout", "60");
        let _ = set_option(&functions, mpv, "hr-seek", "yes");
        // 0.5.3 : horloge AUDIO maître (`display-resample` dérivait sur
        // notre rendu logiciel sans vsync fiable).
        let _ = set_option(&functions, mpv, "video-sync", "audio");
        // 0.5.3 : sauter les trames en retard plutôt que les présenter en
        // retard → vidéo calée sur l'audio.
        let _ = set_option(&functions, mpv, "framedrop", "yes");
        let _ = set_option(&functions, mpv, "hr-seek-framedrop", "no");
        let _ = set_option(&functions, mpv, "video-sync-max-video-change", "5");
        let _ = set_option(&functions, mpv, "video-sync-max-audio-change", "0.1");

        let rc = unsafe { (functions.initialize)(mpv.0) };
        if rc < 0 {
            return Err(error_string(&functions, rc));
        }

        observe(&functions, mpv, "time-pos", MpvFormat::Double);
        observe(&functions, mpv, "duration", MpvFormat::Double);
        observe(&functions, mpv, "pause", MpvFormat::Flag);
        observe(&functions, mpv, "demuxer-cache-time", MpvFormat::Double);

        let gate = Arc::new(StartGate::new());

        let handle = Arc::new(Self {
            functions: functions.clone(),
            mpv,
            surface: Mutex::new(None),
            last_source: Mutex::new(None),
            preferred_quality: Mutex::new(None),
            pot_cache: Mutex::new(None),
            gate: gate.clone(),
        });

        std::thread::spawn(move || run_event_thread(functions, mpv, app_handle, gate));

        log::info!(
            "Playback Engine Bridge démarré (libmpv chargée depuis {})",
            library_path.display()
        );

        Ok(handle)
    }

    /// Point d'entrée unique de chargement : les URLs http(s) passent par
    /// l'extraction Cobalt/yt-dlp (`load_url`), tout le reste (fichiers
    /// locaux, flux directs déjà extraits) passe par `load_direct`.
    pub fn load(&self, path: &str) -> Result<(), String> {
        if path.starts_with("http://") || path.starts_with("https://") {
            return self.load_url(path);
        }
        self.load_direct(path)
    }

    fn load_direct(&self, path: &str) -> Result<(), String> {
        *self.last_source.lock().unwrap_or_else(|p| p.into_inner()) =
            Some((path.to_string(), None));
        if path.starts_with("http://") || path.starts_with("https://") {
            // 0.5.3 : flux réseau → start gate (pause jusqu'à 30 % de buffer).
            self.gate.arm();
            self.command(&["set", "pause", "yes"])?;
            self.command(&["loadfile", path, "replace"])?;
            Ok(())
        } else {
            // Fichier local : lecture immédiate, pas de gate.
            self.gate.disarm();
            self.command(&["loadfile", path, "replace"])?;
            self.set_paused(false)
        }
    }

    /// 0.5.0 : lit une URL en appliquant la qualité préférée mémorisée.
    pub fn load_url(&self, url: &str) -> Result<(), String> {
        let pref = *self
            .preferred_quality
            .lock()
            .unwrap_or_else(|p| p.into_inner());
        self.load_url_quality(url, pref)
    }

    /// 0.5.2 : cascade d'extraction avec PO Token.
    /// 1. Cobalt (si dispo) — 1 requête HTTP, non-throtté
    /// 2. yt-dlp web + POT (si sidecar dispo) — 1080p/4K VP9 non-throtté
    /// 3. yt-dlp cascade tv/android/ios (fallback) — 720p H.264
    pub fn load_url_quality(&self, url: &str, height: Option<i64>) -> Result<(), String> {
        log::info!(
            "[playback] extraction des flux : {url} (qualité : {:?})",
            height
        );

        // 1. Cobalt d'abord (si dispo, le plus rapide).
        if let Some(cobalt_url) = cobalt_extract(url, height) {
            log::info!("[playback] lecture via Cobalt (qualité {:?})", height);
            return self.load_split(&cobalt_url, None);
        }
        log::info!("[playback] Cobalt indisponible — bascule yt-dlp");

        let ytdlp = locate_ytdlp().ok_or_else(|| "yt-dlp introuvable".to_string())?;

        // 2. Sélection exacte (bouton Qualité) — POT en tête.
        if let Some(h) = height {
            let resume = self.get_property_double("time-pos").unwrap_or(0.0);
            let sel = format!("bv*[height={h}]+ba/b[height={h}][acodec!=none]");

            // 2a. web + POT (1080p/4K VP9 non-throtté)
            let pot_args = self.pot_extractor_args();
            if !pot_args.is_empty() {
                if let Some(json) = ytdlp_json_owned(&ytdlp, url, &sel, &pot_args) {
                    if json.get("height").and_then(|v| v.as_i64()) == Some(h) {
                        let (video, audio) = urls_from_json(&json);
                        log::info!("[playback] {h}p exacte via web+POT");
                        self.load_split(&video, audio.as_deref())?;
                        if resume > 1.0 {
                            let _ = self.command(&["seek", &format!("{resume:.3}"), "absolute"]);
                        }
                        return Ok(());
                    }
                }
            }

            // 2b. Repli cascade sans POT (tv/android/web/ios)
            let exact_configs: &[&[&str]] = &[
                &["--extractor-args", "youtube:player_client=tv"],
                &["--extractor-args", "youtube:player_client=android"],
                &[],
                &["--extractor-args", "youtube:player_client=ios"],
            ];
            for extra in exact_configs {
                if let Some(json) = ytdlp_json(&ytdlp, url, &sel, extra) {
                    if json.get("height").and_then(|v| v.as_i64()) == Some(h) {
                        let (video, audio) = urls_from_json(&json);
                        log::info!("[playback] {h}p exacte via client {:?}", extra);
                        self.load_split(&video, audio.as_deref())?;
                        if resume > 1.0 {
                            let _ = self.command(&["seek", &format!("{resume:.3}"), "absolute"]);
                        }
                        return Ok(());
                    }
                }
            }
            log::warn!("[playback] {h}p indisponible partout — fallback auto");
        }

        // 3. Auto : web+POT d'abord (4K possible), puis cascade.
        let format_sel = "bv*[height=1080]+ba/bv*[height=720]+ba/bv*[height<=1080]+ba/b[height<=1080][acodec!=none]";

        // 3a. web + POT
        let pot_args = self.pot_extractor_args();
        if !pot_args.is_empty() {
            if let Some((video, audio)) = ytdlp_urls_owned(&ytdlp, url, format_sel, &pot_args) {
                log::info!("[playback] auto : flux via web+POT (haute résolution débloquée)");
                return self.load_split(&video, audio.as_deref());
            }
        }

        // 3b. Cascade classique
        let auto_configs: &[&[&str]] = &[
            &["--extractor-args", "youtube:player_client=android"],
            &["--extractor-args", "youtube:player_client=tv"],
            &[],
            &["--extractor-args", "youtube:player_client=ios"],
        ];
        let mut last_err = String::from("aucun flux extrait");
        let mut fallback: Option<(String, Option<String>)> = None;
        for extra in auto_configs {
            match ytdlp_json(&ytdlp, url, format_sel, extra) {
                Some(json) => {
                    let h = json.get("height").and_then(|v| v.as_i64()).unwrap_or(0);
                    let urls = urls_from_json(&json);
                    if urls.0.is_empty() {
                        continue;
                    }
                    if h >= 720 {
                        log::info!("[playback] auto : {}p via client {:?}", h, extra);
                        return self.load_split(&urls.0, urls.1.as_deref());
                    }
                    if fallback.is_none() {
                        fallback = Some(urls);
                    }
                }
                None => last_err = format!("client {:?} : extraction échouée", extra),
            }
        }
        if let Some((video, audio)) = fallback {
            log::info!("[playback] auto : repli basse résolution");
            return self.load_split(&video, audio.as_deref());
        }
        Err(format!("yt-dlp en échec : {last_err}"))
    }

    /// Charge un flux vidéo (+ piste audio séparée éventuelle).
    /// 0.5.3 : arme la start gate (pause jusqu'à 30 % de buffer).
    fn load_split(&self, video: &str, audio: Option<&str>) -> Result<(), String> {
        *self.last_source.lock().unwrap_or_else(|p| p.into_inner()) =
            Some((video.to_string(), audio.map(|s| s.to_string())));
        self.gate.arm();
        self.command(&["set", "pause", "yes"])?;
        match audio {
            Some(a) => {
                let opts = format!("audio-file={a}");
                if self
                    .command(&["loadfile", video, "replace", "0", &opts])
                    .is_err()
                {
                    log::warn!("[playback] options loadfile non supportées — vidéo seule");
                    self.command(&["loadfile", video, "replace"])?;
                }
            }
            None => self.command(&["loadfile", video, "replace"])?,
        }
        Ok(())
    }

    /// 0.5.4 : lecture AUDIO SEUL (mode musique d'AetherFy). Extrait
    /// uniquement la meilleure piste audio (opus de préférence), sans
    /// flux vidéo : zéro décodage vidéo, zéro rendu logiciel → plus
    /// aucun grésillement dû à la charge CPU, et qualité audio maximale
    /// disponible sur la source (opus ~160-250 kbps = plafond YouTube).
    pub fn load_url_audio(&self, url: &str) -> Result<(), String> {
        let ytdlp = locate_ytdlp().ok_or_else(|| "yt-dlp introuvable".to_string())?;
        log::info!("[playback] extraction AUDIO seul : {url}");
        // opus d'abord (meilleur rendu à bitrate égal), puis meilleure
        // piste audio disponible, puis repli flux fusionné.
        let sel = "ba[acodec^=opus]/ba/bestaudio/b";
        let mut cmd = std::process::Command::new(&ytdlp);
        cmd.args(["-f", sel, "-g", "--no-warnings"]);
        cmd.arg(url);
        #[cfg(windows)]
        cmd.creation_flags(0x08000000);
        let output = cmd.output().map_err(|e| e.to_string())?;
        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
        }
        let audio_url = String::from_utf8_lossy(&output.stdout)
            .lines()
            .map(str::trim)
            .find(|l| !l.is_empty())
            .map(str::to_string)
            .ok_or_else(|| "aucun flux audio extrait".to_string())?;
        // Flux audio = petit débit → démarrage immédiat, pas de gate.
        self.gate.disarm();
        self.command(&["loadfile", &audio_url, "replace"])?;
        self.set_paused(false)
    }

    /// 0.5.2 : liste les résolutions disponibles, en profitant du POT si dispo.
    pub fn list_qualities(&self, url: &str) -> Result<Vec<QualityOption>, String> {
        let ytdlp = locate_ytdlp().ok_or_else(|| "yt-dlp introuvable".to_string())?;
        let pot_args = self.pot_extractor_args();
        let mut cmd = std::process::Command::new(&ytdlp);
        cmd.args(["-J", "--no-warnings", "--extractor-args", "youtube:player-client=web,default"]);
        if !pot_args.is_empty() {
            cmd.args(&pot_args);
        }
        cmd.arg(url);
        #[cfg(windows)]
        cmd.creation_flags(0x08000000);
        let output = match cmd.output() {
            Ok(o) if o.status.success() => o,
            _ => {
                let mut cmd2 = std::process::Command::new(&ytdlp);
                cmd2.args(["-J", "--no-warnings", url]);
                #[cfg(windows)]
                cmd2.creation_flags(0x08000000);
                cmd2.output().map_err(|e| e.to_string())?
            }
        };
        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
        }
        let json: serde_json::Value =
            serde_json::from_slice(&output.stdout).map_err(|e| e.to_string())?;
        let mut seen: std::collections::BTreeSet<(i64, bool)> = std::collections::BTreeSet::new();
        if let Some(formats) = json.get("formats").and_then(|f| f.as_array()) {
            for f in formats {
                let vcodec = f.get("vcodec").and_then(|v| v.as_str()).unwrap_or("none");
                if vcodec == "none" {
                    continue;
                }
                let h = f.get("height").and_then(|v| v.as_i64()).unwrap_or(0);
                if h <= 0 || h > 2160 {
                    continue;
                }
                let has_audio = f
                    .get("acodec")
                    .and_then(|v| v.as_str())
                    .map(|a| a != "none")
                    .unwrap_or(false);
                seen.insert((h, has_audio));
            }
        }
        let mut heights: Vec<i64> = seen.iter().map(|(h, _)| *h).collect();
        heights.sort_unstable();
        heights.dedup();
        heights.reverse();
        Ok(heights
            .into_iter()
            .map(|h| QualityOption {
                has_audio: seen.contains(&(h, true)),
                label: format!("{h}p"),
                height: h,
            })
            .collect())
    }

    /// 0.5.2 : extraction hybride avec POT.
    pub fn extract_media(&self, url: &str) -> Result<ExtractedMedia, String> {
        let ytdlp = locate_ytdlp().ok_or_else(|| "yt-dlp introuvable".to_string())?;
        log::info!("[playback] extraction hybride (HTML5/mpv) : {url}");
        let pot_args = self.pot_extractor_args();
        if !pot_args.is_empty() {
            let mut cmd = std::process::Command::new(&ytdlp);
            cmd.args([
                "-f",
                "b[vcodec^=avc1][acodec!=none][height<=720]/bv*[vcodec^=avc1][height<=1080]+ba/b",
                "-g",
                "--no-warnings",
                "--extractor-args",
                "youtube:player-client=web,default",
            ]);
            cmd.args(&pot_args);
            cmd.arg(url);
            #[cfg(windows)]
            cmd.creation_flags(0x08000000);
            if let Ok(output) = cmd.output() {
                if output.status.success() {
                    let urls: Vec<String> = String::from_utf8_lossy(&output.stdout)
                        .lines()
                        .map(str::trim)
                        .filter(|l| !l.is_empty())
                        .map(str::to_string)
                        .collect();
                    if !urls.is_empty() {
                        return Ok(if urls.len() == 1 {
                            ExtractedMedia {
                                kind: "merged".into(),
                                url: urls[0].clone(),
                                audio_url: None,
                            }
                        } else {
                            ExtractedMedia {
                                kind: "split".into(),
                                url: urls[0].clone(),
                                audio_url: Some(urls[1].clone()),
                            }
                        });
                    }
                }
            }
        }
        let configs: &[&[&str]] = &[
            &[],
            &["--extractor-args", "youtube:player_client=android"],
            &["--extractor-args", "youtube:player_client=tv"],
        ];
        let mut last_err = String::new();
        for extra in configs {
            let mut cmd = std::process::Command::new(&ytdlp);
            cmd.args([
                "-f",
                "b[vcodec^=avc1][acodec!=none][height<=720]/bv*[vcodec^=avc1][height<=1080]+ba/b",
                "-g",
                "--no-warnings",
            ]);
            cmd.args(*extra);
            cmd.arg(url);
            #[cfg(windows)]
            cmd.creation_flags(0x08000000);
            match cmd.output() {
                Ok(output) if output.status.success() => {
                    let urls: Vec<String> = String::from_utf8_lossy(&output.stdout)
                        .lines()
                        .map(str::trim)
                        .filter(|l| !l.is_empty())
                        .map(str::to_string)
                        .collect();
                    if urls.is_empty() {
                        last_err = "aucun flux extrait".to_string();
                        continue;
                    }
                    return Ok(if urls.len() == 1 {
                        ExtractedMedia {
                            kind: "merged".into(),
                            url: urls[0].clone(),
                            audio_url: None,
                        }
                    } else {
                        ExtractedMedia {
                            kind: "split".into(),
                            url: urls[0].clone(),
                            audio_url: Some(urls[1].clone()),
                        }
                    });
                }
                Ok(output) => {
                    last_err = String::from_utf8_lossy(&output.stderr).trim().to_string();
                }
                Err(e) => last_err = e.to_string(),
            }
        }
        Err(format!("yt-dlp en échec : {last_err}"))
    }

    /// 0.5.2 : renvoie les args yt-dlp pour utiliser le PO Token (vide si indisponible).
    fn pot_extractor_args(&self) -> Vec<String> {
        let Some((visitor, token)) = self.fetch_pot_token() else {
            return Vec::new();
        };
        vec![
            "--extractor-args".to_string(),
            format!("youtube:player-client=web,default;po_token=web.gvs+{token};po_token=web.player+{token};visitor_data={visitor}"),
        ]
    }

    /// 0.5.2 : récupère un PO Token (cache 30 min), ou None si sidecar absent/échec.
    fn fetch_pot_token(&self) -> Option<(String, String)> {
        // 1. Cache encore valide ?
        {
            let guard = self.pot_cache.lock().unwrap_or_else(|p| p.into_inner());
            if let Some((v, t, instant)) = guard.as_ref() {
                if instant.elapsed() < Duration::from_secs(30 * 60) {
                    return Some((v.clone(), t.clone()));
                }
            }
        }
        // 2. Génération
        let pot_bin = locate_bgutil_pot()?;
        let mut cmd = std::process::Command::new(&pot_bin);
        #[cfg(windows)]
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
        let output = match cmd.output() {
            Ok(o) if o.status.success() => o,
            Ok(o) => {
                log::warn!(
                    "[playback] bgutil-pot a échoué : {}",
                    String::from_utf8_lossy(&o.stderr).trim()
                );
                return None;
            }
            Err(e) => {
                log::warn!("[playback] impossible de lancer bgutil-pot : {e}");
                return None;
            }
        };
        let stdout = String::from_utf8_lossy(&output.stdout);
        let json: serde_json::Value = match serde_json::from_str(&stdout) {
            Ok(j) => j,
            Err(e) => {
                log::warn!("[playback] bgutil-pot JSON invalide : {e}");
                return None;
            }
        };
        let token = json.get("poToken").and_then(|v| v.as_str())?.to_string();
        let visitor = json.get("contentBinding").and_then(|v| v.as_str())?.to_string();
        if token.is_empty() || visitor.is_empty() {
            log::warn!("[playback] bgutil-pot : token ou visitor vide");
            return None;
        }
        log::info!(
            "[playback] PO Token généré (visitor={}…, token={}…)",
            &visitor[..visitor.len().min(20)],
            &token[..token.len().min(20)]
        );
        // 3. Mise en cache
        *self.pot_cache.lock().unwrap_or_else(|p| p.into_inner()) =
            Some((visitor.clone(), token.clone(), Instant::now()));
        Some((visitor, token))
    }

    /// Stoppe mpv sans effet de bord — pour libérer la place quand le
    /// frontend bascule sur le lecteur HTML5.
    pub fn unload(&self) -> Result<(), String> {
        self.command(&["stop"])
    }

    pub fn set_paused(&self, paused: bool) -> Result<(), String> {
        // 0.5.3 : action utilisateur explicite → priorité sur la start gate.
        self.gate.disarm();
        // 0.5.4 : pause/reprise repart sur une ardoise propre — les trames
        // encore « en vol » avant la pause sont abandonnées (le frontend
        // les jettera de toute façon via le plafond strict de sw_render).
        if let Some(state) = self.surface.lock().unwrap_or_else(|p| p.into_inner()).as_ref() {
            state.in_flight_frames.store(0, Ordering::Relaxed);
        }
        self.set_property_flag("pause", paused)
    }

    pub fn seek_absolute(&self, seconds: f64) -> Result<(), String> {
        // 0.5.3 : un seek utilisateur prend la main immédiatement.
        self.gate.disarm();
        self.command(&["seek", &format!("{seconds:.3}"), "absolute"])
    }

    pub fn set_volume(&self, volume: f64) -> Result<(), String> {
        self.set_property_double("volume", volume.clamp(0.0, 1.0) * 100.0)
    }

    pub fn set_muted(&self, muted: bool) -> Result<(), String> {
        self.set_property_flag("mute", muted)
    }

    pub fn set_rate(&self, rate: f64) -> Result<(), String> {
        self.set_property_double("speed", rate.clamp(0.25, 4.0))
    }

    pub fn set_audio_track(&self, track_id: i64) -> Result<(), String> {
        self.command(&["set", "aid", &track_id.to_string()])
    }

    pub fn set_subtitle_track(&self, track_id: Option<i64>) -> Result<(), String> {
        match track_id {
            Some(id) => self.command(&["set", "sid", &id.to_string()]),
            None => self.command(&["set", "sid", "no"]),
        }
    }

    pub fn list_tracks(&self) -> Result<TrackList, String> {
        let count = self
            .get_property_int64("track-list/count")
            .unwrap_or(0)
            .max(0);
        let mut list = TrackList::default();
        for index in 0..count {
            let Ok(id) = self.get_property_int64(&format!("track-list/{index}/id")) else {
                continue;
            };
            let Some(track_type) =
                self.get_property_string_opt(&format!("track-list/{index}/type"))
            else {
                continue;
            };
            let track = PlayerTrack {
                id,
                lang: self.get_property_string_opt(&format!("track-list/{index}/lang")),
                title: self.get_property_string_opt(&format!("track-list/{index}/title")),
                selected: self
                    .get_property_flag(&format!("track-list/{index}/selected"))
                    .unwrap_or(false),
            };
            match track_type.as_str() {
                "audio" => list.audio.push(track),
                "sub" => list.subtitles.push(track),
                _ => {}
            }
        }
        Ok(list)
    }

    pub fn stop(&self) -> Result<(), String> {
        let result = self.command(&["stop"]);
        self.detach_internal();
        result
    }

    pub fn redraw(&self) -> Result<(), String> {
        self.command(&["seek", "0", "relative"])
    }

    pub fn capture_screenshot(&self, target_path: &str) -> Result<(), String> {
        self.command(&["screenshot-to-file", target_path, "video"])
    }

    pub fn attach_surface(
        &self,
        channel: Channel<InvokeResponseBody>,
        width: i32,
        height: i32,
    ) -> Result<(), String> {
        let mut guard = self.surface.lock().unwrap_or_else(|p| p.into_inner());
        if let Some(mut previous) = guard.take() {
            previous.stop_flag.store(true, Ordering::Relaxed);
            if let Some(render_thread) = previous.render_thread.take() {
                let _ = render_thread.join();
            }
        }
        let size = Arc::new((AtomicI32::new(width), AtomicI32::new(height)));
        let stop_flag = Arc::new(AtomicBool::new(false));
        let in_flight_frames = Arc::new(AtomicI32::new(0));
        let latest_frame = Arc::new(Mutex::new(Vec::new()));
        let functions = self.functions.clone();
        let mpv = sw_render::MpvHandlePtr(self.mpv.0);
        let render_stop_flag = stop_flag.clone();
        let render_size = size.clone();
        let render_in_flight = in_flight_frames.clone();
        let render_latest_frame = latest_frame.clone();
        let render_thread = std::thread::spawn(move || {
            sw_render::run(
                functions,
                mpv,
                channel,
                render_stop_flag,
                render_size,
                render_in_flight,
                render_latest_frame,
            );
        });
        *guard = Some(SurfaceState {
            stop_flag,
            render_thread: Some(render_thread),
            size,
            in_flight_frames,
            latest_frame,
        });
        // 0.5.0 (correctif écran noir) : le VO libmpv de mpv a pu démarrer
        // AVANT que ce contexte de rendu existe → rechargement complet de
        // la source 300 ms plus tard pour réinitialiser le VO AVEC le
        // contexte présent.
        let source = self
            .last_source
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .clone();
        let functions_for_reload = self.functions.clone();
        let mpv_addr = self.mpv.0 as usize;
        let gate = self.gate.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(300));
            let Some((video, audio)) = source else {
                return;
            };
            let mpv_ptr = mpv_addr as *mut c_void;
            // Reprend la position courante pour que le rechargement
            // correctif ne remette PAS la lecture à zéro.
            let resume_cname = CString::new("time-pos").unwrap_or_default();
            let mut resume_val: f64 = 0.0;
            let rc = unsafe {
                (functions_for_reload.get_property)(
                    mpv_ptr,
                    resume_cname.as_ptr(),
                    MpvFormat::Double as c_int,
                    &mut resume_val as *mut _ as *mut c_void,
                )
            };
            let resume = if rc < 0 { 0.0 } else { resume_val };
            let mut c_args = vec![
                CString::new("loadfile").unwrap_or_default(),
                CString::new(video.as_str()).unwrap_or_default(),
                CString::new("replace").unwrap_or_default(),
                CString::new("0").unwrap_or_default(),
            ];
            let audio_opt = audio.map(|a| format!("audio-file={a}"));
            if let Some(opts) = &audio_opt {
                c_args.push(CString::new(opts.as_str()).unwrap_or_default());
            }
            let mut ptrs: Vec<*const c_char> = c_args.iter().map(|a| a.as_ptr()).collect();
            ptrs.push(std::ptr::null());
            unsafe {
                (functions_for_reload.command)(mpv_ptr, ptrs.as_ptr());
            }
            // 0.5.3 : après le reload correctif, on ne coupe PAS la start
            // gate si elle est armée. On ne dépause que si aucune gate
            // n'est active (fichiers locaux, re-mounts).
            if !gate.armed.load(Ordering::Relaxed) {
                let c_unpause = vec![
                    CString::new("set").unwrap_or_default(),
                    CString::new("pause").unwrap_or_default(),
                    CString::new("no").unwrap_or_default(),
                ];
                let mut uptrs: Vec<*const c_char> =
                    c_unpause.iter().map(|a| a.as_ptr()).collect();
                uptrs.push(std::ptr::null());
                unsafe {
                    (functions_for_reload.command)(mpv_ptr, uptrs.as_ptr());
                }
            }
            if resume > 1.0 {
                let r = format!("{resume:.3}");
                let c_seek = vec![
                    CString::new("seek").unwrap_or_default(),
                    CString::new(r.as_str()).unwrap_or_default(),
                    CString::new("absolute").unwrap_or_default(),
                ];
                let mut sptrs: Vec<*const c_char> = c_seek.iter().map(|a| a.as_ptr()).collect();
                sptrs.push(std::ptr::null());
                unsafe {
                    (functions_for_reload.command)(mpv_ptr, sptrs.as_ptr());
                }
            }
        });
        Ok(())
    }

        pub fn ack_frame(&self) {
        let guard = self.surface.lock().unwrap_or_else(|p| p.into_inner());
        if let Some(state) = guard.as_ref() {
            // 0.5.6 : borne basse STRICTE — un accusé ne doit JAMAIS faire
            // descendre in_flight sous 0 (double-ack frontend, ack d'une
            // trame tirée par le polling…) : sinon la contre-pression est
            // désamorcée silencieusement (vu en test : -1425).
            let _ = state.in_flight_frames.fetch_update(
                Ordering::Relaxed,
                Ordering::Relaxed,
                |v| if v > 0 { Some(v - 1) } else { None },
            );
        }
    }

    pub fn pull_frame(&self) -> Vec<u8> {
        let guard = self.surface.lock().unwrap_or_else(|p| p.into_inner());
        guard
            .as_ref()
            .map(|state| state.latest_frame.lock().unwrap_or_else(|p| p.into_inner()).clone())
            .unwrap_or_default()
    }

    pub fn resize_surface(&self, width: i32, height: i32) {
        let guard = self.surface.lock().unwrap_or_else(|p| p.into_inner());
        if let Some(state) = guard.as_ref() {
            state.size.0.store(width, Ordering::Relaxed);
            state.size.1.store(height, Ordering::Relaxed);
        }
    }

    fn detach_internal(&self) {
        let previous = self
            .surface
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .take();
        if let Some(mut state) = previous {
            state.stop_flag.store(true, Ordering::Relaxed);
            if let Some(render_thread) = state.render_thread.take() {
                let _ = render_thread.join();
            }
        }
    }

    fn command(&self, args: &[&str]) -> Result<(), String> {
        let c_args: Vec<CString> = args
            .iter()
            .map(|arg| CString::new(*arg).unwrap_or_default())
            .collect();
        let mut ptrs: Vec<*const std::os::raw::c_char> =
            c_args.iter().map(|arg| arg.as_ptr()).collect();
        ptrs.push(std::ptr::null());
        let rc = unsafe { (self.functions.command)(self.mpv.0, ptrs.as_ptr()) };
        if rc < 0 {
            Err(error_string(&self.functions, rc))
        } else {
            Ok(())
        }
    }

    fn set_property_flag(&self, name: &str, value: bool) -> Result<(), String> {
        let cname = CString::new(name).unwrap_or_default();
        let mut raw: c_int = if value { 1 } else { 0 };
        let rc = unsafe {
            (self.functions.set_property)(
                self.mpv.0,
                cname.as_ptr(),
                MpvFormat::Flag as c_int,
                &mut raw as *mut _ as *mut c_void,
            )
        };
        if rc < 0 {
            Err(error_string(&self.functions, rc))
        } else {
            Ok(())
        }
    }

    fn set_property_double(&self, name: &str, value: f64) -> Result<(), String> {
        let cname = CString::new(name).unwrap_or_default();
        let mut raw = value;
        let rc = unsafe {
            (self.functions.set_property)(
                self.mpv.0,
                cname.as_ptr(),
                MpvFormat::Double as c_int,
                &mut raw as *mut _ as *mut c_void,
            )
        };
        if rc < 0 {
            Err(error_string(&self.functions, rc))
        } else {
            Ok(())
        }
    }

    fn get_property_int64(&self, name: &str) -> Result<i64, String> {
        let cname = CString::new(name).unwrap_or_default();
        let mut value: i64 = 0;
        let rc = unsafe {
            (self.functions.get_property)(
                self.mpv.0,
                cname.as_ptr(),
                MpvFormat::Int64 as c_int,
                &mut value as *mut _ as *mut c_void,
            )
        };
        if rc < 0 {
            Err(error_string(&self.functions, rc))
        } else {
            Ok(value)
        }
    }

    fn get_property_flag(&self, name: &str) -> Result<bool, String> {
        let cname = CString::new(name).unwrap_or_default();
        let mut value: c_int = 0;
        let rc = unsafe {
            (self.functions.get_property)(
                self.mpv.0,
                cname.as_ptr(),
                MpvFormat::Flag as c_int,
                &mut value as *mut _ as *mut c_void,
            )
        };
        if rc < 0 {
            Err(error_string(&self.functions, rc))
        } else {
            Ok(value != 0)
        }
    }

    fn get_property_double(&self, name: &str) -> Result<f64, String> {
        let cname = CString::new(name).unwrap_or_default();
        let mut value: f64 = 0.0;
        let rc = unsafe {
            (self.functions.get_property)(
                self.mpv.0,
                cname.as_ptr(),
                MpvFormat::Double as c_int,
                &mut value as *mut _ as *mut c_void,
            )
        };
        if rc < 0 {
            Err(error_string(&self.functions, rc))
        } else {
            Ok(value)
        }
    }

    fn get_property_string_opt(&self, name: &str) -> Option<String> {
        let cname = CString::new(name).ok()?;
        let mut ptr: *mut c_char = std::ptr::null_mut();
        let rc = unsafe {
            (self.functions.get_property)(
                self.mpv.0,
                cname.as_ptr(),
                MpvFormat::String as c_int,
                &mut ptr as *mut _ as *mut c_void,
            )
        };
        if rc < 0 || ptr.is_null() {
            return None;
        }
        let value = unsafe { CStr::from_ptr(ptr) }.to_string_lossy().to_string();
        unsafe { (self.functions.free)(ptr as *mut c_void) };
        Some(value)
    }
}

fn set_option(
    functions: &MpvFunctions,
    mpv: MpvHandlePtr,
    name: &str,
    value: &str,
) -> Result<(), String> {
    let cname = CString::new(name).unwrap_or_default();
    let cvalue = CString::new(value).unwrap_or_default();
    let rc = unsafe { (functions.set_option_string)(mpv.0, cname.as_ptr(), cvalue.as_ptr()) };
    if rc < 0 {
        Err(error_string(functions, rc))
    } else {
        Ok(())
    }
}

fn observe(functions: &MpvFunctions, mpv: MpvHandlePtr, name: &str, format: MpvFormat) {
    let cname = CString::new(name).unwrap_or_default();
    unsafe {
        (functions.observe_property)(mpv.0, 0, cname.as_ptr(), format as c_int);
    }
}

fn error_string(functions: &MpvFunctions, code: c_int) -> String {
    unsafe {
        let ptr = (functions.error_string)(code);
        if ptr.is_null() {
            format!("erreur mpv {code}")
        } else {
            CStr::from_ptr(ptr).to_string_lossy().to_string()
        }
    }
}

/// 0.5.0 : extraction via Cobalt (API self-host ou publique) — flux muxés
/// (vidéo+audio) NON throttés, en une seule requête HTTP.
fn cobalt_extract(url: &str, height: Option<i64>) -> Option<String> {
    let instances: Vec<String> = std::env::var("COBALT_API")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .map(|s| vec![s.trim().trim_end_matches('/').to_string()])
        .unwrap_or_else(|| {
            vec![
                "http://127.0.0.1:9000".into(),
                "https://cobalt-api.meow.lol".into(),
                "https://api.cobalt.tools".into(),
            ]
        });
    let quality = match height {
        Some(h) => h.to_string(),
        None => "1080".to_string(),
    };
    for base in instances {
        let body = ureq::json!({
            "url": url,
            "videoQuality": quality,
            "downloadMode": "auto",
            "filenameStyle": "basic",
        });
        let res = ureq::post(&format!("{base}/"))
            .set("Accept", "application/json")
            .set("Content-Type", "application/json")
            .timeout(std::time::Duration::from_secs(10))
            .send_json(body);
        match res {
            Ok(resp) => {
                if let Ok(json) = resp.into_json::<serde_json::Value>() {
                    let status = json.get("status").and_then(|s| s.as_str()).unwrap_or("");
                    if (status == "tunnel" || status == "redirect")
                        && json.get("url").and_then(|u| u.as_str()).is_some()
                    {
                        let u = json["url"].as_str().unwrap().to_string();
                        log::info!("[playback] cobalt OK via {base} ({status})");
                        return Some(u);
                    }
                    log::warn!("[playback] cobalt {base} : réponse sans URL");
                }
            }
            Err(e) => log::warn!("[playback] cobalt {base} en échec : {e}"),
        }
    }
    None
}

/// Exécute yt-dlp `-J -f <sel>` et renvoie le JSON décrit.
fn ytdlp_json(
    ytdlp: &Path,
    url: &str,
    format_sel: &str,
    extra: &[&str],
) -> Option<serde_json::Value> {
    let mut cmd = std::process::Command::new(ytdlp);
    cmd.args(["-J", "-f", format_sel, "--no-warnings"]);
    cmd.args(extra);
    cmd.arg(url);
    #[cfg(windows)]
    cmd.creation_flags(0x08000000);
    let output = cmd.output().ok()?;
    if !output.status.success() {
        return None;
    }
    serde_json::from_slice(&output.stdout).ok()
}

/// 0.5.2 : variant owned pour les args POT (qui sont des String).
fn ytdlp_json_owned(
    ytdlp: &Path,
    url: &str,
    format_sel: &str,
    extra: &[String],
) -> Option<serde_json::Value> {
    let mut cmd = std::process::Command::new(ytdlp);
    cmd.args(["-J", "-f", format_sel, "--no-warnings"]);
    cmd.args(extra);
    cmd.arg(url);
    #[cfg(windows)]
    cmd.creation_flags(0x08000000);
    let output = cmd.output().ok()?;
    if !output.status.success() {
        return None;
    }
    serde_json::from_slice(&output.stdout).ok()
}

/// 0.5.2 : extraction des URLs (-g) avec args owned (POT).
fn ytdlp_urls_owned(
    ytdlp: &Path,
    url: &str,
    format_sel: &str,
    extra: &[String],
) -> Option<(String, Option<String>)> {
    let mut cmd = std::process::Command::new(ytdlp);
    cmd.args(["-f", format_sel, "-g", "--no-warnings"]);
    cmd.args(extra);
    cmd.arg(url);
    #[cfg(windows)]
    cmd.creation_flags(0x08000000);
    let output = cmd.output().ok()?;
    if !output.status.success() {
        return None;
    }
    let urls: Vec<String> = String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .map(|s| s.to_string())
        .collect();
    if urls.is_empty() {
        return None;
    }
    let video = urls[0].clone();
    let audio = urls.get(1).cloned();
    Some((video, audio))
}

/// Extrait (url vidéo, url audio) d'un JSON yt-dlp `-J`
/// (gère `requested_formats` pour les flux séparés).
fn urls_from_json(json: &serde_json::Value) -> (String, Option<String>) {
    if let Some(formats) = json.get("requested_formats").and_then(|f| f.as_array()) {
        let mut video: Option<String> = None;
        let mut audio: Option<String> = None;
        for f in formats {
            let vcodec = f.get("vcodec").and_then(|v| v.as_str()).unwrap_or("none");
            let u = f.get("url").and_then(|u| u.as_str()).map(|s| s.to_string());
            if vcodec != "none" {
                if video.is_none() {
                    video = u;
                }
            } else if audio.is_none() {
                audio = u;
            }
        }
        if let Some(v) = video {
            return (v, audio);
        }
    }
    (
        json.get("url")
            .and_then(|u| u.as_str())
            .unwrap_or_default()
            .to_string(),
        None,
    )
}

/// 0.5.2 : résolution du sidecar PO Token (multiplateforme).
fn locate_bgutil_pot() -> Option<PathBuf> {
    let exe_dir = std::env::current_exe().ok()?.parent()?.to_path_buf();
    let resources = exe_dir.join("resources");
    let candidates: Vec<PathBuf> = if cfg!(windows) {
        vec![
            exe_dir.join("bgutil-pot-windows-x86_64.exe"),
            exe_dir.join("bgutil-pot-server.exe"),
            resources.join("bgutil-pot-windows-x86_64.exe"),
            resources.join("bgutil-pot-server.exe"),
        ]
    } else if cfg!(target_os = "macos") {
        vec![
            exe_dir.join("bgutil-pot-macos"),
            exe_dir.join("bgutil-pot-server"),
            resources.join("bgutil-pot-macos"),
            resources.join("bgutil-pot-server"),
        ]
    } else {
        vec![
            exe_dir.join("bgutil-pot-linux-x86_64"),
            exe_dir.join("bgutil-pot-server"),
            resources.join("bgutil-pot-linux-x86_64"),
            resources.join("bgutil-pot-server"),
        ]
    };
    for c in candidates {
        if c.exists() {
            return Some(c);
        }
    }
    None
}

/// 0.5.0 (multiplateforme) : résolution de libmpv via le module platform.
fn locate_library() -> Result<PathBuf, String> {
    use crate::services::platform;
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(|p| p.to_path_buf()))
        .ok_or_else(|| "Impossible de déterminer le dossier de l'exécutable".to_string())?;
    let resolved = platform::resolve_mpv(&exe_dir, Some(&exe_dir.join("resources")));
    if resolved.exists() {
        return Ok(resolved);
    }
    Err(format!(
        "Aucune libmpv trouvée. {} (recherché dans : {}, ressources)",
        platform::mpv_install_hint(),
        exe_dir.display()
    ))
}

/// 0.5.0 (multiplateforme) : résolution de yt-dlp via le module platform.
fn locate_ytdlp() -> Option<PathBuf> {
    use crate::services::platform;
    let exe_dir = std::env::current_exe().ok()?.parent()?.to_path_buf();
    let resolved = platform::resolve_yt_dlp(&exe_dir, Some(&exe_dir.join("resources")));
    if resolved.exists() {
        Some(resolved)
    } else {
        None
    }
}

fn run_event_thread(
    functions: Arc<MpvFunctions>,
    mpv: MpvHandlePtr,
    app_handle: AppHandle,
    gate: Arc<StartGate>,
) {
    loop {
        let event_ptr = unsafe { (functions.wait_event)(mpv.0, -1.0) };
        if event_ptr.is_null() {
            continue;
        }
        let event = unsafe { &*event_ptr };
        match event.event_id {
            id if id == mpv_ffi::event_id::SHUTDOWN => {
                log::info!("Playback Engine Bridge : arrêt du moteur mpv");
                break;
            }
            id if id == mpv_ffi::event_id::PROPERTY_CHANGE => {
                if event.data.is_null() {
                    continue;
                }
                let prop = unsafe { &*(event.data as *const mpv_ffi::mpv_event_property) };
                if prop.name.is_null() || prop.data.is_null() {
                    continue;
                }
                let name = unsafe { CStr::from_ptr(prop.name) }.to_string_lossy();
                let mut payload = PlayerStateEvent::default();
                match name.as_ref() {
                    "demuxer-cache-time" if prop.format == MpvFormat::Double as c_int => {
                        payload.buffered_seconds = Some(unsafe { *(prop.data as *const f64) });
                    }
                    "time-pos" if prop.format == MpvFormat::Double as c_int => {
                        payload.position_seconds = Some(unsafe { *(prop.data as *const f64) });
                    }
                    "duration" if prop.format == MpvFormat::Double as c_int => {
                        payload.duration_seconds = Some(unsafe { *(prop.data as *const f64) });
                    }
                    "pause" if prop.format == MpvFormat::Flag as c_int => {
                        let flag = unsafe { *(prop.data as *const c_int) };
                        payload.playing = Some(flag == 0);
                    }
                    _ => continue,
                }
                // 0.5.3 : start gate — libère la lecture à 30 % de buffer
                // (ou timeout 45 s).
                maybe_release_gate(
                    &gate,
                    &functions,
                    mpv,
                    payload.duration_seconds,
                    payload.buffered_seconds,
                );
                let _ = app_handle.emit("player-state", payload);
            }
            id if id == mpv_ffi::event_id::END_FILE => {
                let end_file = if event.data.is_null() {
                    None
                } else {
                    Some(unsafe { &*(event.data as *const mpv_ffi::mpv_event_end_file) })
                };
                let reason = end_file.map(|ef| ef.reason);
                let is_real_end = matches!(
                    reason,
                    Some(mpv_ffi::end_file_reason::EOF) | Some(mpv_ffi::end_file_reason::ERROR)
                );
                log::info!("[playback] END_FILE reason={reason:?} is_real_end={is_real_end}");
                let error = match (reason, end_file) {
                    (Some(mpv_ffi::end_file_reason::ERROR), Some(ef)) => {
                        Some(error_string(&functions, ef.error))
                    }
                    _ => None,
                };
                let _ = app_handle.emit(
                    "player-state",
                    PlayerStateEvent {
                        ended: is_real_end,
                        playing: Some(false),
                        error,
                        ..Default::default()
                    },
                );
            }
            _ => {}
        }
    }
}

/// 0.5.1 : id YouTube d'une bande-annonce via recherche LOCALE (yt-dlp) —
/// repli quand TMDB est injoignable (box/FAI filtrant, IPv6 cassé, pas de VPN).
fn find_trailer_ytdlp(title: &str) -> Option<String> {
    let ytdlp = locate_ytdlp()?;
    let query = format!("ytsearch1:{title} official trailer");
    let mut cmd = std::process::Command::new(&ytdlp);
    cmd.args(["-J", "--flat-playlist", "--no-warnings", &query]);
    #[cfg(windows)]
    cmd.creation_flags(0x08000000);
    let output = cmd.output().ok()?;
    if !output.status.success() {
        return None;
    }
    let json: serde_json::Value = serde_json::from_slice(&output.stdout).ok()?;
    let first = json.get("entries")?.as_array()?.first()?;
    if let Some(id) = first.get("id").and_then(|v| v.as_str()) {
        return Some(id.to_string());
    }
    first
        .get("url")
        .and_then(|v| v.as_str())
        .and_then(|u| u.split("v=").last().map(|s| s.to_string()))
}

// ====================== Commandes Tauri ======================

/// 0.5.1 : commande frontend — id YouTube de bande-annonce via
/// repli YouTube local (yt-dlp), sans dépendre de TMDB.
#[tauri::command]
pub fn player_find_trailer(
    state: tauri::State<'_, crate::state::AppState>,
    title: String,
) -> Result<Option<String>, String> {
    let _ = state;
    Ok(find_trailer_ytdlp(&title))
}

/// ⚠️ Commande de repli PiP (canal Tauri muet dans les fenêtres
/// secondaires) : la fenêtre détachée « tire » la dernière image rendue.
#[tauri::command]
pub fn player_pull_frame(
    state: tauri::State<'_, crate::state::AppState>,
) -> tauri::ipc::Response {
    let _ = state;
    let bytes = sw_render::pull_latest_frame();
    tauri::ipc::Response::new(tauri::ipc::InvokeResponseBody::Raw(bytes))
}

/// 0.4.0 (VaultTube, jalon 1) : lit directement une URL (YouTube, etc.)
/// en extrayant les flux via Cobalt/yt-dlp.
#[tauri::command]
pub fn player_load_url(
    state: tauri::State<'_, crate::state::AppState>,
    url: String,
) -> Result<(), String> {
    state.playback_engine.handle()?.load_url(&url)
}

/// 0.5.4 : mode musique — audio seul, meilleure qualité disponible
/// (opus prioritaire), zéro décodage vidéo → zéro grésillement CPU.
#[tauri::command]
pub fn player_load_url_audio(
    state: tauri::State<'_, crate::state::AppState>,
    url: String,
) -> Result<(), String> {
    state.playback_engine.handle()?.load_url_audio(&url)
}

/// 0.5.0 : mémorise la qualité préférée (appliquée à chaque load_url).
#[tauri::command]
pub fn player_set_preferred_quality(
    state: tauri::State<'_, crate::state::AppState>,
    height: Option<i64>,
) -> Result<(), String> {
    *state
        .playback_engine
        .handle()?
        .preferred_quality
        .lock()
        .unwrap_or_else(|p| p.into_inner()) = height;
    Ok(())
}

#[tauri::command]
pub fn player_extract_media(
    state: tauri::State<'_, crate::state::AppState>,
    url: String,
) -> Result<ExtractedMedia, String> {
    state.playback_engine.handle()?.extract_media(&url)
}

#[tauri::command]
pub fn player_unload(
    state: tauri::State<'_, crate::state::AppState>,
) -> Result<(), String> {
    state.playback_engine.handle()?.unload()
}

/// 0.5.0 : résolutions disponibles pour une URL AetherFy.
#[tauri::command]
pub fn player_list_qualities(
    state: tauri::State<'_, crate::state::AppState>,
    url: String,
) -> Result<Vec<QualityOption>, String> {
    state.playback_engine.handle()?.list_qualities(&url)
}

/// 0.5.0 : (re)charge une URL AetherFy à la résolution demandée
/// (`height = null` → auto).
#[tauri::command]
pub fn player_load_url_quality(
    state: tauri::State<'_, crate::state::AppState>,
    url: String,
    height: Option<i64>,
) -> Result<(), String> {
    state.playback_engine.handle()?.load_url_quality(&url, height)
}