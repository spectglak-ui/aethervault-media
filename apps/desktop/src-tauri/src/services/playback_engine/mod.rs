//! Playback Engine Bridge (doc §4.2) — Étape 3b, puis migration Étape 3c
//! (abandon du rendu Win32/OpenGL natif au profit du rendu logiciel +
//! `<canvas>`, voir le rapport de transmission "écran noir" et la
//! discussion qui a suivi).
pub(crate) mod mpv_ffi;
mod sw_render;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

use mpv_ffi::MpvFormat;
pub use mpv_ffi::MpvFunctions;
use std::ffi::{c_void, CStr, CString};
use std::os::raw::{c_char, c_int};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicI32, Ordering};
use std::sync::{Arc, Mutex};
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

pub struct PlaybackEngineHandle {
    functions: Arc<MpvFunctions>,
    mpv: MpvHandlePtr,
    surface: Mutex<Option<SurfaceState>>,
    /// 0.5.0 : dernière source chargée (vidéo, audio séparé éventuel) —
    /// permet de forcer un rechargement après création du contexte de
    /// rendu (course VO libmpv / render context).
    last_source: Mutex<Option<(String, Option<String>)>>,
    /// 0.5.0 : qualité préférée (bouton AetherFy). `None` = auto.
    /// Appliquée automatiquement à chaque `load_url`.
    preferred_quality: Mutex<Option<i64>>,
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
    /// indépendants — jamais le handle de lecture lui-même, pour ne
    /// jamais perturber une lecture en cours.
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

        let functions =
            Arc::new(MpvFunctions::load(&library_path).map_err(|err| err.to_string())?);
        let mpv_ptr = unsafe { (functions.create)() };
        if mpv_ptr.is_null() {
            return Err("mpv_create a échoué".to_string());
        }
        let mpv = MpvHandlePtr(mpv_ptr);

        set_option(&functions, mpv, "vo", "libmpv")?;
        set_option(&functions, mpv, "hwdec", "auto-safe")?;
        set_option(&functions, mpv, "video-timing-offset", "0.150")?;
        set_option(&functions, mpv, "keep-open", "yes")?;

        let _ = set_option(&functions, mpv, "ytdl", "yes");
        // 0.5.0 : auto-qualité — 1080p d'abord (tous codecs : vp9/av01 inclus),
        // puis 720p, puis meilleur ≤ 1080p.
        let _ = set_option(
            &functions,
            mpv,
            "ytdl-format",
            "bv*[height=1080]+ba/bv*[height=720]+ba/bv*[height<=1080]+ba/b[height<=1080]",
        );

        // 0.4.0 : fiabilité streaming AetherFy — gros cache qui DEVANCE la
        // lecture (60 s / 512 Mio) pour absorber le throttling YouTube.
        let _ = set_option(&functions, mpv, "cache", "yes");
        let _ = set_option(&functions, mpv, "demuxer-max-bytes", "512MiB");
        let _ = set_option(&functions, mpv, "demuxer-max-back-bytes", "256MiB");
        let _ = set_option(&functions, mpv, "network-timeout", "60");
        let _ = set_option(&functions, mpv, "hr-seek", "yes");
        let _ = set_option(&functions, mpv, "demuxer-cache-wait", "yes");
        let _ = set_option(&functions, mpv, "cache-pause-initial", "yes");
        // 0.5.0 : démarrage rapide — 3 s de buffer suffisent avec les flux
        // Cobalt/Android/TV non throttés.
        let _ = set_option(&functions, mpv, "cache-pause-wait", "3");
        let _ = set_option(&functions, mpv, "video-sync", "display-resample");
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

        let handle = Arc::new(Self {
            functions: functions.clone(),
            mpv,
            surface: Mutex::new(None),
            last_source: Mutex::new(None),
            preferred_quality: Mutex::new(None),
        });

        std::thread::spawn(move || run_event_thread(functions, mpv, app_handle));

        log::info!(
            "Playback Engine Bridge démarré (libmpv chargée depuis {})",
            library_path.display()
        );

        Ok(handle)
    }

    /// Point d'entrée unique de chargement : les URLs http(s) passent par
    /// l'extraction Cobalt/yt-dlp (`load_url`), tout le reste (fichiers locaux,
    /// flux directs déjà extraits) passe par `load_direct`.
    pub fn load(&self, path: &str) -> Result<(), String> {
        if path.starts_with("http://") || path.starts_with("https://") {
            return self.load_url(path);
        }
        self.load_direct(path)
    }

    fn load_direct(&self, path: &str) -> Result<(), String> {
        *self.last_source.lock().unwrap_or_else(|p| p.into_inner()) =
            Some((path.to_string(), None));
        self.command(&["loadfile", path, "replace"])?;
        self.set_paused(false)
    }

    /// 0.5.0 : lit une URL en appliquant la qualité préférée mémorisée
    /// (`preferred_quality`), avec repli auto si indisponible.
    pub fn load_url(&self, url: &str) -> Result<(), String> {
        let pref = *self
            .preferred_quality
            .lock()
            .unwrap_or_else(|p| p.into_inner());
        self.load_url_quality(url, pref)
    }

    /// 0.5.0 : chargement avec choix de résolution.
    /// **Cobalt d'ABORD** (flux muxés non-throttés, 1 requête HTTP).
    /// Repli yt-dlp si Cobalt indisponible.
    /// `None` = auto RAPIDE (`-g`, Android d'abord).
    /// `Some(h)` = sélection EXACTE vérifiée (`-J`, TV d'abord), avec
    /// reprise de position et fallback auto si la résolution n'existe pas.
    pub fn load_url_quality(&self, url: &str, height: Option<i64>) -> Result<(), String> {
        log::info!(
            "[playback] extraction des flux : {url} (qualité : {:?})",
            height
        );

        // 0.5.0 : Cobalt d'ABORD — flux muxés non-throttés.
        if let Some(cobalt_url) = cobalt_extract(url, height) {
            log::info!("[playback] lecture via Cobalt (qualité {:?})", height);
            return self.load_split(&cobalt_url, None);
        }
        log::warn!("[playback] Cobalt indisponible — repli yt-dlp");

        let ytdlp = locate_ytdlp().ok_or_else(|| "yt-dlp introuvable".to_string())?;

        // TV d'abord pour la sélection exacte (1080p H.264 non throttée),
        // Android ensuite, Web en dernier (1080p VP9).
        let exact_configs: &[&[&str]] = &[
            &["--extractor-args", "youtube:player_client=tv"],
            &["--extractor-args", "youtube:player_client=android"],
            &[],
            &["--extractor-args", "youtube:player_client=ios"],
        ];

        // ----- Sélection exacte (bouton Qualité / préférence) -----
        if let Some(h) = height {
            // Mémorise la position pour reprendre exactement là après le
            // changement de flux.
            let resume = self.get_property_double("time-pos").unwrap_or(0.0);
            let sel = format!("bv*[height={h}]+ba/b[height={h}][acodec!=none]");
            for extra in exact_configs {
                if let Some(json) = ytdlp_json(&ytdlp, url, &sel, extra) {
                    if json.get("height").and_then(|v| v.as_i64()) == Some(h) {
                        let (video, audio) = urls_from_json(&json);
                        log::info!("[playback] {h}p exacte via client {:?}", extra);
                        self.load_split(&video, audio.as_deref())?;
                        if resume > 1.0 {
                            let _ = self.command(&["seek", &format!("{resume:.3}"), "absolute"]);
                        }
                        return self.set_paused(false);
                    }
                }
            }
            // Fallback : résolution indisponible partout → bascule en auto
            // (sinon la vidéo reste muette).
            log::warn!("[playback] {h}p indisponible — fallback auto");
        }

        // ----- Auto : RAPIDE (-g), Android d'abord (non throtté) -----
        let format_sel = "bv*[height=1080]+ba/bv*[height=720]+ba/bv*[height<=1080]+ba/b[height<=1080][acodec!=none]";
        let auto_configs: &[&[&str]] = &[
            &["--extractor-args", "youtube:player_client=android"],
            &["--extractor-args", "youtube:player_client=tv"],
            &[],
            &["--extractor-args", "youtube:player_client=ios"],
        ];

        let mut last_err = String::new();
        let mut urls: Vec<String> = Vec::new();

        for extra in auto_configs {
            let mut cmd = std::process::Command::new(&ytdlp);
            cmd.args(["-f", &format_sel, "-g", "--no-warnings"]);
            cmd.args(*extra);
            cmd.arg(url);

            #[cfg(windows)]
            cmd.creation_flags(0x08000000);

            match cmd.output() {
                Ok(output) if output.status.success() => {
                    let found: Vec<String> = String::from_utf8_lossy(&output.stdout)
                        .lines()
                        .map(str::trim)
                        .filter(|l| !l.is_empty())
                        .map(str::to_string)
                        .collect();

                    if !found.is_empty() {
                        log::info!(
                            "[playback] auto : flux via client {:?} ({} URL(s))",
                            extra,
                            found.len()
                        );
                        urls = found;
                        break;
                    }
                    last_err = "aucun flux extrait".to_string();
                }
                Ok(output) => {
                    last_err = String::from_utf8_lossy(&output.stderr).trim().to_string();
                    log::warn!("[playback] yt-dlp client {:?} en échec : {}", extra, last_err);
                }
                Err(e) => last_err = e.to_string(),
            }
        }

        if urls.is_empty() {
            return Err(format!("yt-dlp en échec : {last_err}"));
        }

        let video = urls[0].clone();
        let audio = urls.get(1).cloned();
        self.load_split(&video, audio.as_deref())
    }

    /// Charge un flux vidéo (+ piste audio séparée éventuelle).
    fn load_split(&self, video: &str, audio: Option<&str>) -> Result<(), String> {
        *self.last_source.lock().unwrap_or_else(|p| p.into_inner()) =
            Some((video.to_string(), audio.map(|s| s.to_string())));
        match audio {
            Some(a) => {
                let opts = format!("audio-file={a}");
                if self
                    .command(&["loadfile", video, "replace", "0", &opts])
                    .is_err()
                {
                    log::warn!("[playback] options loadfile non supportées — vidéo seule");
                    self.load_direct(video)?;
                }
                Ok(())
            }
            None => self.load_direct(video),
        }
    }

    /// 0.5.0 : liste les résolutions disponibles (tous codecs, ≤ 1080p).
    pub fn list_qualities(&self, url: &str) -> Result<Vec<QualityOption>, String> {
        let ytdlp = locate_ytdlp().ok_or_else(|| "yt-dlp introuvable".to_string())?;
        let mut cmd = std::process::Command::new(&ytdlp);
        cmd.args(["-J", "--no-warnings", url]);
        #[cfg(windows)]
        cmd.creation_flags(0x08000000);
        let output = cmd.output().map_err(|e| e.to_string())?;
        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
        }
        let json: serde_json::Value =
            serde_json::from_slice(&output.stdout).map_err(|e| e.to_string())?;

        let mut seen: std::collections::BTreeSet<(i64, bool)> = std::collections::BTreeSet::new();
        if let Some(formats) = json.get("formats").and_then(|f| f.as_array()) {
            for f in formats {
                // Tous les codecs vidéo (avc1/vp9/av01) — mpv les lit tous.
                let vcodec = f.get("vcodec").and_then(|v| v.as_str()).unwrap_or("none");
                if vcodec == "none" {
                    continue;
                }
                let h = f.get("height").and_then(|v| v.as_i64()).unwrap_or(0);
                if h <= 0 || h > 1080 {
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

    /// 0.4.0 (lecteur hybride) : extraction SANS lecture. Renvoie un flux
    /// fusionné (lisible par <video> HTML5) ou séparé (mpv uniquement).
    pub fn extract_media(&self, url: &str) -> Result<ExtractedMedia, String> {
        let ytdlp = locate_ytdlp().ok_or_else(|| "yt-dlp introuvable".to_string())?;
        log::info!("[playback] extraction hybride (HTML5/mpv) : {url}");

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

    /// Stoppe mpv sans effet de bord — pour libérer la place quand le
    /// frontend bascule sur le lecteur HTML5.
    pub fn unload(&self) -> Result<(), String> {
        self.command(&["stop"])
    }

    pub fn set_paused(&self, paused: bool) -> Result<(), String> {
        self.set_property_flag("pause", paused)
    }

    pub fn seek_absolute(&self, seconds: f64) -> Result<(), String> {
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
        // AVANT que ce contexte de rendu existe (course au chargement) →
        // il ne produirait alors JAMAIS de trames. On force un rechargement
        // complet de la source 300 ms plus tard : le VO se réinitialise
        // AVEC le contexte de rendu présent → l'image coule.
        let source = self
            .last_source
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .clone();

        let functions_for_reload = self.functions.clone();
        let mpv_addr = self.mpv.0 as usize;

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
            state.in_flight_frames.fetch_sub(1, Ordering::Relaxed);
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
/// (vidéo+audio) NON throttés, en une seule requête HTTP. Renvoie l'URL
/// directe (tunnel ou redirect). Instance configurable via COBALT_API.
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

    // Qualité demandée (Cobalt plafonne au mieux dispo).
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

/// 0.5.1 : **id YouTube** d'une bande-annonce via recherche LOCALE
/// (yt-dlp) — repli quand TMDB est injoignable (box/FAI filtrant,
/// IPv6 cassé, pas de VPN). Renvoie l'ID (utilisable en `videoId`
/// par l'iframe YouTube du frontend), pas une URL complète.
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

/// 0.5.0 (multiplateforme) : résolution de libmpv via le module platform.
/// Ordre de recherche : AVM_BIN_DIR → ressources Tauri → dossier exe → PATH.
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

fn run_event_thread(functions: Arc<MpvFunctions>, mpv: MpvHandlePtr, app_handle: AppHandle) {
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

/// 0.5.1 : commande frontend — **id YouTube** de bande-annonce via
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