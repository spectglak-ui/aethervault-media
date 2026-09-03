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
use std::path::PathBuf;
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
        let _ = set_option(
            &functions,
            mpv,
            "ytdl-format",
            "bv*[height<=1080][vcodec^=avc1]+ba/b[height<=1080]",
        );
        // 0.4.0 : fiabilité streaming AetherFy — gros cache qui DEVANCE la
        // lecture (60 s / 512 Mio) pour absorber le throttling YouTube,
        // buffer de flux 4 Mio, cache seekable = retour arrière instantané.
             let _ = set_option(&functions, mpv, "cache", "yes");
        let _ = set_option(&functions, mpv, "demuxer-max-bytes", "512MiB");
        let _ = set_option(&functions, mpv, "demuxer-max-back-bytes", "256MiB");
        let _ = set_option(&functions, mpv, "network-timeout", "60");
        let _ = set_option(&functions, mpv, "hr-seek", "yes");
		let _ = set_option(&functions, mpv, "demuxer-cache-wait", "yes");
        let _ = set_option(&functions, mpv, "cache-pause-initial", "yes");
        let _ = set_option(&functions, mpv, "cache-pause-wait", "10");
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
        });
        std::thread::spawn(move || run_event_thread(functions, mpv, app_handle));
        log::info!(
            "Playback Engine Bridge démarré (libmpv chargée depuis {})",
            library_path.display()
        );
        Ok(handle)
    }

    /// Point d'entrée unique de chargement : les URLs http(s) passent par
    /// l'extraction yt-dlp (`load_url`), tout le reste (fichiers locaux,
    /// flux directs déjà extraits) passe par `load_direct`.
    pub fn load(&self, path: &str) -> Result<(), String> {
        if path.starts_with("http://") || path.starts_with("https://") {
            return self.load_url(path);
        }
        self.load_direct(path)
    }

    fn load_direct(&self, path: &str) -> Result<(), String> {
        self.command(&["loadfile", path, "replace"])?;
        self.set_paused(false)
    }

    pub fn load_url(&self, url: &str) -> Result<(), String> {
        let ytdlp = locate_ytdlp().ok_or_else(|| "yt-dlp introuvable".to_string())?;
        log::info!("[playback] extraction des flux via yt-dlp : {url}");
        let configs: &[&[&str]] = &[
            &[],
            &["--extractor-args", "youtube:player_client=android"],
            &["--extractor-args", "youtube:player_client=tv"],
            &["--extractor-args", "youtube:player_client=ios"],
        ];
        let mut last_err = String::new();
        let mut urls: Vec<String> = Vec::new();
        for extra in configs {
            let mut cmd = std::process::Command::new(&ytdlp);
            cmd.args([
                "-f",
                "b[vcodec^=avc1][height<=1080][acodec!=none]/bv*[vcodec^=avc1][height<=1080]+ba/b",
                "-g",
                "--no-warnings",
            ]);
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
                            "[playback] flux extraits via client {:?} ({} URL(s))",
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
        if urls.len() == 1 {
            return self.load_direct(&video);
        }
        let opts = format!("audio-file={}", urls[1]);
        if self
            .command(&["loadfile", &video, "replace", "0", &opts])
            .is_err()
        {
            log::warn!("[playback] options loadfile non supportées — vidéo seule");
            self.load_direct(&video)?;
        }
        self.set_paused(false)
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
            let Some(track_type) = self.get_property_string_opt(&format!("track-list/{index}/type"))
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
        let _ = self.command(&["seek", "0", "relative"]);
        let functions_for_redraw = self.functions.clone();
        let mpv_addr = self.mpv.0 as usize;
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(300));
            let c_args = ["seek", "0", "relative"]
                .iter()
                .map(|arg| CString::new(*arg).unwrap_or_default())
                .collect::<Vec<_>>();
            let mut ptrs: Vec<*const c_char> = c_args.iter().map(|a| a.as_ptr()).collect();
            ptrs.push(std::ptr::null());
            let mpv_ptr = mpv_addr as *mut c_void;
            unsafe {
                (functions_for_redraw.command)(mpv_ptr, ptrs.as_ptr());
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

fn locate_library() -> Result<PathBuf, String> {
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(|p| p.to_path_buf()))
        .ok_or_else(|| "Impossible de déterminer le dossier de l'exécutable".to_string())?;
    const CANDIDATES: &[&str] = &["libmpv-2.dll", "mpv-2.dll", "libmpv.dll"];
    let dirs = [exe_dir.clone(), exe_dir.join("resources")];
    for name in CANDIDATES {
        for dir in &dirs {
            let candidate = dir.join(name);
            if candidate.exists() {
                return Ok(candidate);
            }
        }
    }
    Err(format!(
        "Aucune libmpv trouvée à côté de l'exécutable ({}). Le binaire redistribuable (build LGPL) doit être déposé là par l'installateur — voir doc §4.2.",
        exe_dir.display()
    ))
}

fn locate_ytdlp() -> Option<PathBuf> {
    let mut dirs: Vec<PathBuf> = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            dirs.push(dir.to_path_buf());
            dirs.push(dir.join("resources"));
        }
    }
    if let Ok(cwd) = std::env::current_dir() {
        dirs.push(cwd);
    }
    for dir in dirs {
        for name in ["yt-dlp.exe", "yt-dlp"] {
            let candidate = dir.join(name);
            if candidate.exists() {
                return Some(candidate);
            }
        }
    }
    None
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
/// en extrayant les flux via yt-dlp.
#[tauri::command]
pub fn player_load_url(
    state: tauri::State<'_, crate::state::AppState>,
    url: String,
) -> Result<(), String> {
    state.playback_engine.handle()?.load_url(&url)
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