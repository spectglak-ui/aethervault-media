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
use std::sync::atomic::{AtomicBool, AtomicI32, AtomicU64, AtomicU8, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
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
    /// `paused-for-cache` de mpv : vrai SEULEMENT quand la lecture est
    /// réellement suspendue faute de données (et non quand le tampon est
    /// simplement court). Pilote l'indicateur « Mise en mémoire tampon… ».
    pub buffering: Option<bool>,
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
}

/// 0.5.3 : « start gate » — pour les flux réseau, la lecture reste en
/// pause jusqu'à ce que le tampon ait `gate_target_secs()` secondes
/// d'AVANCE sur la tête de lecture (`demuxer-cache-duration`), ou
/// `gate_timeout()` d'attente max (timeout de sécurité).
///
/// Avant 0.9.x la cible était 30 % de la durée (jusqu'à 240 s de tampon,
/// timeout 45 s) et comparée à `demuxer-cache-time`, qui est un TIMESTAMP
/// ABSOLU (fin du tampon) et non une avance : une vidéo de 10 min devait
/// charger 3 min avant de démarrer, et une reprise à t = 20 min levait la
/// gate instantanément. Le cache mpv (`cache-pause`) absorbe ensuite les
/// à-coups réseau.
/// Avance de tampon (secondes) à atteindre avant de lancer la lecture.
/// Surchargeable SANS recompiler, pour les essais : variable d'environnement
/// `AVM_GATE_SECS` (0 = démarrage immédiat).
const GATE_DEFAULT_TARGET_SECS: f64 = 8.0;
/// Attente maximale avant de lancer la lecture quoi qu'il arrive.
/// Surchargeable : `AVM_GATE_TIMEOUT_SECS`.
const GATE_DEFAULT_TIMEOUT_SECS: u64 = 20;

fn gate_target_secs() -> f64 {
    static V: OnceLock<f64> = OnceLock::new();
    *V.get_or_init(|| {
        std::env::var("AVM_GATE_SECS")
            .ok()
            .and_then(|s| s.trim().parse::<f64>().ok())
            .filter(|v| v.is_finite() && *v >= 0.0)
            .unwrap_or(GATE_DEFAULT_TARGET_SECS)
    })
}

fn gate_timeout() -> Duration {
    static V: OnceLock<u64> = OnceLock::new();
    Duration::from_secs(*V.get_or_init(|| {
        std::env::var("AVM_GATE_TIMEOUT_SECS")
            .ok()
            .and_then(|s| s.trim().parse::<u64>().ok())
            .filter(|v| *v > 0)
            .unwrap_or(GATE_DEFAULT_TIMEOUT_SECS)
    }))
}

struct StartGate {
    armed: AtomicBool,
    armed_at: Mutex<Instant>,
    /// (durée_seconds, avance_de_tampon_seconds) — dernières valeurs observées.
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

/// Depuis le thread d'événements mpv : libère la gate quand l'avance de
/// tampon atteint `gate_target_secs()` (ou timeout) → `set pause no`.
/// `buffered` = `demuxer-cache-duration` (secondes d'avance), PAS
/// `demuxer-cache-time` (timestamp absolu).
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
    let mut target = gate_target_secs();
    if dur > 1.0 {
        // Média très court : ne pas exiger plus de la moitié de sa durée.
        target = target.min(dur * 0.5);
    }
    let waited = gate.armed_at.lock().unwrap_or_else(|p| p.into_inner()).elapsed();
    let timed_out = waited > gate_timeout();
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
            "[playback] start gate : lecture lancée après {} ms (avance {:.1}s / cible {:.1}s{})",
            waited.as_millis(),
            cache,
            target,
            if timed_out { ", TIMEOUT" } else { "" }
        );
    }
}

/// Niveau de spatialisation audio (virtualisation casque) — réglage global.
///
/// Les filtres ont été mesurés dans mpv 0.37 (signal décorrélé gauche/droite,
/// source S/M = −5,0 dB) : « léger » = crossfeed seul, plus étroit que la
/// source (S/M −8,6 dB) mais naturel ; « moyen » élargit un peu avant le
/// crossfeed (S/M −6,8 dB) ; « fort » élargit franchement (S/M −4,2 dB).
/// Réponse centrée plate à ±0,5 dB (pas de creux dans les médiums, contrairement
/// à `earwax` : −13 à −18 dB sur les voix centrées). `alimiter … level=disabled`
/// = simple limiteur de crêtes (sans normalisation de volume).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SpatialLevel {
    Off,
    Light,
    Medium,
    Strong,
}

/// Valeur « inconnue » de `spatial_applied` : force la prochaine application.
const SPATIAL_UNKNOWN: u8 = u8::MAX;

impl SpatialLevel {
    /// Clé stockée en base et échangée avec le frontend.
    pub fn key(self) -> &'static str {
        match self {
            SpatialLevel::Off => "off",
            SpatialLevel::Light => "light",
            SpatialLevel::Medium => "medium",
            SpatialLevel::Strong => "strong",
        }
    }

    pub fn parse(key: &str) -> Option<Self> {
        match key.trim() {
            "off" => Some(SpatialLevel::Off),
            "light" => Some(SpatialLevel::Light),
            "medium" => Some(SpatialLevel::Medium),
            "strong" => Some(SpatialLevel::Strong),
            _ => None,
        }
    }

    fn as_u8(self) -> u8 {
        self as u8
    }

    fn from_u8(v: u8) -> Self {
        match v {
            1 => SpatialLevel::Light,
            2 => SpatialLevel::Medium,
            3 => SpatialLevel::Strong,
            _ => SpatialLevel::Off,
        }
    }

    /// Filtres libavfilter de ce niveau (liste séparée par des virgules, sans
    /// enveloppe `lavfi=[…]` ni limiteur : voir `build_audio_filter`).
    fn graph(self) -> &'static str {
        match self {
            SpatialLevel::Off => "",
            SpatialLevel::Light => "crossfeed=strength=0.20:range=0.50",
            SpatialLevel::Medium => "extrastereo=m=1.4,crossfeed=strength=0.30:range=0.60",
            SpatialLevel::Strong => "extrastereo=m=2.0,crossfeed=strength=0.40:range=0.70",
        }
    }
}

/// Ambiance cinéma — réglage global, indépendant de la spatialisation et
/// combinable avec elle. Chaque niveau ajoute : des graves plus profonds
/// (étagère à 100 Hz), un léger gain de présence (3 kHz) et une réverbération
/// de salle simulée par des réflexions précoces (`aecho`, 24 à 111 ms). Un
/// `volume` négatif compense l'essentiel du gain ajouté, pour que la
/// comparaison A/B ne soit pas faussée par « plus fort = meilleur ».
///
/// Mesures (bruit rose, mpv 0.37) — graves 40–120 Hz : +0,8 / +2,6 / +4,0 dB ;
/// médiums à ±0,8 dB ; réflexions au-delà de 20 ms à −16,8 / −11,7 / −8,3 dB
/// sous le son direct. Ce sont des mesures objectives : le rendu « salle de
/// cinéma » se juge à l'oreille, d'où la comparaison A/B des Paramètres.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CinemaLevel {
    Off,
    Light,
    Medium,
    Strong,
}

impl CinemaLevel {
    pub fn key(self) -> &'static str {
        match self {
            CinemaLevel::Off => "off",
            CinemaLevel::Light => "light",
            CinemaLevel::Medium => "medium",
            CinemaLevel::Strong => "strong",
        }
    }

    pub fn parse(key: &str) -> Option<Self> {
        match key.trim() {
            "off" => Some(CinemaLevel::Off),
            "light" => Some(CinemaLevel::Light),
            "medium" => Some(CinemaLevel::Medium),
            "strong" => Some(CinemaLevel::Strong),
            _ => None,
        }
    }

    fn as_u8(self) -> u8 {
        self as u8
    }

    fn from_u8(v: u8) -> Self {
        match v {
            1 => CinemaLevel::Light,
            2 => CinemaLevel::Medium,
            3 => CinemaLevel::Strong,
            _ => CinemaLevel::Off,
        }
    }

    fn graph(self) -> &'static str {
        match self {
            CinemaLevel::Off => "",
            CinemaLevel::Light => {
                "bass=g=2:f=100:w=0.7,equalizer=f=3000:t=q:w=0.8:g=1,\
                 aecho=in_gain=1:out_gain=0.92:delays=32|58:decays=0.12|0.08,volume=-1.0dB"
            }
            CinemaLevel::Medium => {
                "bass=g=3.5:f=100:w=0.7,equalizer=f=3000:t=q:w=0.8:g=1.5,\
                 aecho=in_gain=1:out_gain=0.9:delays=28|47|71:decays=0.2|0.14|0.09,volume=-2.0dB"
            }
            CinemaLevel::Strong => {
                "bass=g=5:f=100:w=0.7,equalizer=f=3000:t=q:w=0.8:g=2,\
                 aecho=in_gain=1:out_gain=0.86:delays=24|41|63|97:decays=0.28|0.2|0.14|0.1,volume=-3.0dB"
            }
        }
    }
}

/// Valeur de la propriété mpv `af` pour une combinaison spatialisation +
/// cinéma (chaîne vide = aucun filtre). Ordre : spatialisation, puis
/// couleur/salle du cinéma, puis un limiteur de crêtes SANS normalisation de
/// volume (`level=disabled`) dès que la chaîne peut dépasser 0 dBFS
/// (élargissement moyen/fort, ou n'importe quel niveau de cinéma).
fn build_audio_filter(spatial: SpatialLevel, cinema: CinemaLevel) -> String {
    let mut parts: Vec<&str> = Vec::new();
    if spatial != SpatialLevel::Off {
        parts.push(spatial.graph());
    }
    if cinema != CinemaLevel::Off {
        parts.push(cinema.graph());
    }
    if parts.is_empty() {
        return String::new();
    }
    let needs_limiter = matches!(spatial, SpatialLevel::Medium | SpatialLevel::Strong)
        || cinema != CinemaLevel::Off;
    if needs_limiter {
        parts.push("alimiter=limit=0.97:level=disabled");
    }
    format!("lavfi=[{}]", parts.join(","))
}

pub struct PlaybackEngineHandle {
    functions: Arc<MpvFunctions>,
    mpv: MpvHandlePtr,
    surface: Mutex<Option<SurfaceState>>,
    /// 0.5.0 : dernière source chargée (vidéo, audio séparé éventuel).
    last_source: Mutex<Option<(String, Option<String>)>>,
    /// 0.6.0 (visualiseur) : URL d'origine demandée par le frontend
    /// (page YouTube, fichier local…) — permet au visualiseur de faire
    /// correspondre la source réellement chargée (flux extrait) au média
    /// affiché, malgré le délai d'extraction yt-dlp.
    audio_origin: Mutex<Option<String>>,
    /// 0.6.1 : session audio explicite (mode transmis par le frontend via
    /// `player_load_mode`) — désactive la « start gate ».
    audio_session: AtomicBool,
    /// 0.5.0 : qualité préférée (bouton AetherFy). `None` = auto.
    preferred_quality: Mutex<Option<i64>>,
    /// 0.5.2 : cache du PO Token YouTube — (visitor_data, po_token, instant).
    pot_cache: Mutex<Option<(String, String, Instant)>>,
    /// 0.5.3 : start gate (buffer 30 % → lecture).
    gate: Arc<StartGate>,
    /// Génération d'« arrêt » : incrémentée par `stop()`. Le rechargement
    /// correctif différé d'`attach_surface` (300 ms) mémorise la valeur au
    /// moment de son lancement et s'annule si elle a changé — sinon il
    /// relançait le flux (et le son) APRÈS le stop, sans image visible.
    stop_epoch: Arc<AtomicU64>,
    /// Niveau de spatialisation VOULU (`SpatialLevel as u8`) — source de
    /// vérité côté moteur : appliqué avant CHAQUE `loadfile`, quel que soit
    /// le chemin de chargement (fichier, AetherFy, TV, changement de qualité).
    spatial_level: AtomicU8,
    /// Niveau d'ambiance cinéma VOULU (`CinemaLevel as u8`), appliqué avec la
    /// spatialisation dans une seule chaîne `af`.
    cinema_level: AtomicU8,
    /// Combinaison (spatialisation × 4 + cinéma) réellement présente dans la
    /// chaîne mpv (`SPATIAL_UNKNOWN` si inconnue) : évite de reconstruire la
    /// chaîne audio à chaque morceau.
    audio_applied: AtomicU8,
}

pub enum PlaybackEngineState {
    Ready(Arc<PlaybackEngineHandle>),
    Unavailable(String),
}

/// 0.9.2 — détecte une URL de flux direct (HLS/HTTP) que mpv peut lire
/// immédiatement sans extraction (pas de Cobalt, pas de yt-dlp).
/// Extensions reconnues : .m3u8, .m3u, .ts, .mp4, .mkv, .webm
/// Protocoles : http://, https://
fn is_direct_stream(url: &str) -> bool {
    let u = url.to_lowercase();
    if !u.starts_with("http://") && !u.starts_with("https://") {
        return false;
    }
    // Extrait le chemin (sans query string)
    let path = u.split('?').next().unwrap_or(&u);
    // Vérifie les extensions de flux directs
    path.ends_with(".m3u8")
        || path.ends_with(".m3u")
        || path.ends_with(".ts")
        || path.ends_with(".mp4")
        || path.ends_with(".mkv")
        || path.ends_with(".webm")
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
        // `AVM_HWDEC` (ex. `auto-copy-safe`) : essai de décodage matériel avec
        // recopie en mémoire système, seule forme compatible avec le rendu
        // logiciel de l'app (`auto-safe` ne sait pas rendre des surfaces GPU
        // via l'API SW de libmpv et retombe sur le décodage CPU).
        let hwdec = std::env::var("AVM_HWDEC")
            .ok()
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty())
            .unwrap_or_else(|| "auto-safe".to_string());
        log::info!("[playback] hwdec demandé : {hwdec}");
        set_option(&functions, mpv, "hwdec", &hwdec)?;
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
        // (500 ms au lieu des 250 ms par défaut).
        let _ = set_option(&functions, mpv, "audio-buffer", "0.5");
        // 0.5.3 : le cache DEVANCE la lecture mais on NE L'ATTEND PAS via
        // mpv (plus de `demuxer-cache-wait`) : c'est la « start gate » Rust
        // qui démarre la lecture à 30 % de buffer (timeout 45 s).
        let _ = set_option(&functions, mpv, "cache", "yes");
        let _ = set_option(&functions, mpv, "demuxer-max-bytes", "512MiB");
        let _ = set_option(&functions, mpv, "demuxer-max-back-bytes", "256MiB");
        // 20 s (et non 60) : une connexion googlevideo muette depuis 20 s est
        // morte ; 60 s figeait l'UI en « chargement » pendant une minute.
        let _ = set_option(&functions, mpv, "network-timeout", "20");
        // Après une panne de tampon, mpv ne reprend qu'avec `cache-pause-wait`
        // secondes d'avance (1 s par défaut). Avec un débit voisin de la
        // vitesse de lecture, 1 s fait alterner lecture / « mise en mémoire
        // tampon » toutes les secondes ; 6 s donne des pauses plus rares.
        // Surchargeable : `AVM_CACHE_PAUSE_WAIT` (secondes).
        let cache_pause_wait = std::env::var("AVM_CACHE_PAUSE_WAIT")
            .ok()
            .and_then(|v| v.trim().parse::<f64>().ok())
            .filter(|v| v.is_finite() && *v >= 0.0)
            .unwrap_or(6.0);
        let _ = set_option(
            &functions,
            mpv,
            "cache-pause-wait",
            &format!("{cache_pause_wait}"),
        );
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
        // 0.5.6 : rendu logiciel plus rapide (render.h recommande explicitement
        // sw-fast + zimg ; l'OSD mpv est inutile car l'UI est dessinée par
        // l'app — le rendu OSD CPU est un coût pur à 1080p).
        let _ = set_option(&functions, mpv, "sws-fast", "yes");
        let _ = set_option(&functions, mpv, "sw-fast", "yes"); // alias selon versions
        let _ = set_option(&functions, mpv, "sws-allow-zimg", "yes");
        let _ = set_option(&functions, mpv, "osd-level", "0");
        let _ = set_option(&functions, mpv, "video-osd", "no");
        let rc = unsafe { (functions.initialize)(mpv.0) };
        if rc < 0 {
            return Err(error_string(&functions, rc));
        }
        observe(&functions, mpv, "time-pos", MpvFormat::Double);
        observe(&functions, mpv, "duration", MpvFormat::Double);
        observe(&functions, mpv, "pause", MpvFormat::Flag);
        observe(&functions, mpv, "paused-for-cache", MpvFormat::Flag);
        observe(&functions, mpv, "demuxer-cache-time", MpvFormat::Double);
        // Avance de tampon en secondes : pilote la start gate.
        observe(&functions, mpv, "demuxer-cache-duration", MpvFormat::Double);
        let gate = Arc::new(StartGate::new());
        let handle = Arc::new(Self {
            functions: functions.clone(),
            mpv,
            surface: Mutex::new(None),
            last_source: Mutex::new(None),
            audio_origin: Mutex::new(None),
            audio_session: AtomicBool::new(false),
            preferred_quality: Mutex::new(None),
            pot_cache: Mutex::new(None),
            gate: gate.clone(),
            stop_epoch: Arc::new(AtomicU64::new(0)),
            spatial_level: AtomicU8::new(SpatialLevel::Off.as_u8()),
            cinema_level: AtomicU8::new(CinemaLevel::Off.as_u8()),
            audio_applied: AtomicU8::new(SPATIAL_UNKNOWN),
        });
        std::thread::spawn(move || run_event_thread(functions, mpv, app_handle, gate));
        spawn_pot_prewarm(handle.clone());
        spawn_playback_diagnostics(handle.clone());
        if let Some(ytdlp) = locate_ytdlp() {
            warn_if_no_js_runtime(&ytdlp);
        }
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
        // 0.6.1 : sans mode explicite, comportement historique (gate
        // armée pour les flux réseau) — évite qu'une session audio
        // précédente ne « fuie » vers une session vidéo.
        self.audio_session.store(false, Ordering::Relaxed);
        self.load_inner(path)
    }

    /// 0.6.1 : chargement avec mode explicite ("audio" | "video").
    /// Le mode audio désactive la start gate (voir `load_split`) :
    /// lecture immédiate de chaque piste suivante d'une playlist.
    pub fn load_with_mode(&self, path: &str, mode: Option<&str>) -> Result<(), String> {
        self.audio_session
            .store(mode == Some("audio"), Ordering::Relaxed);
        self.load_inner(path)
    }

    fn load_inner(&self, path: &str) -> Result<(), String> {
        if path.starts_with("http://") || path.starts_with("https://") {
            return self.load_url(path);
        }
        self.load_direct(path)
    }

    fn load_direct(&self, path: &str) -> Result<(), String> {
        // Spatialisation : chaîne audio dans l'état voulu AVANT le loadfile.
        self.apply_audio_filter();
        *self.last_source.lock().unwrap_or_else(|p| p.into_inner()) =
            Some((path.to_string(), None));
        // 0.6.0 (visualiseur) : pour un fichier local, l'origine = le chemin lui-même.
        *self.audio_origin.lock().unwrap_or_else(|p| p.into_inner()) =
            Some(path.to_string());
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
        let t0 = Instant::now();
        let res = self.load_url_quality_inner(url, height);
        log::info!(
            "[playback] load_url_quality terminé en {} ms (ok={}, thread={:?})",
            t0.elapsed().as_millis(),
            res.is_ok(),
            std::thread::current().name()
        );
        res
    }

    fn load_url_quality_inner(&self, url: &str, height: Option<i64>) -> Result<(), String> {
        // 0.9.2 — flux direct (HLS/HTTP) : mpv lit l'URL telle quelle,
        // sans Cobalt ni yt-dlp (démarrage immédiat, aucun échec d'extraction).
        if is_direct_stream(url) {
            log::info!("[playback] flux direct détecté : {url} (lecture immédiate, pas d'extraction)");
            *self.audio_origin.lock().unwrap_or_else(|p| p.into_inner()) =
                Some(url.to_string());
            return self.load_split(url, None);
        }
        log::info!(
            "[playback] extraction des flux : {url} (qualité : {:?})",
            height
        );
        // 0.6.0 (visualiseur) : mémorise l'URL d'origine AVANT toute
        // extraction — `load_split` ne reçoit que les flux extraits, pas
        // l'URL demandée par le frontend.
        *self.audio_origin.lock().unwrap_or_else(|p| p.into_inner()) =
            Some(url.to_string());
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
            let avc = if prefer_avc() {
                format!("bv*[height={h}][vcodec^=avc1]+ba/")
            } else {
                String::new()
            };
            let sel = format!("{avc}bv*[height={h}]+ba/b[height={h}][acodec!=none]");
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
        const BASE_FORMAT_SEL: &str =
            "bv*[height=1080]+ba/bv*[height=720]+ba/bv*[height<=1080]+ba/b[height<=1080][acodec!=none]";
        let format_owned = if prefer_avc() {
            format!(
                "bv*[height=1080][vcodec^=avc1]+ba/bv*[height=720][vcodec^=avc1]+ba/{BASE_FORMAT_SEL}"
            )
        } else {
            BASE_FORMAT_SEL.to_string()
        };
        let format_sel = format_owned.as_str();
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
    /// 0.5.3 : arme la start gate (pause jusqu'à 30 % de buffer) —
    /// 0.6.1 : SAUF en session audio explicite (lecture immédiate).
    fn load_split(&self, video: &str, audio: Option<&str>) -> Result<(), String> {
        // Spatialisation : chaîne audio dans l'état voulu AVANT le loadfile
        // (couvre AetherFy, TV/HLS, changement de qualité…).
        self.apply_audio_filter();
        *self.last_source.lock().unwrap_or_else(|p| p.into_inner()) =
            Some((video.to_string(), audio.map(|s| s.to_string())));
        // 0.6.0 (visualiseur) : on NE touche PLUS à `audio_origin` ici.
        log::info!(
            "[playback] flux : vidéo {} | audio {}",
            describe_stream_url(video),
            audio.map(describe_stream_url).unwrap_or_else(|| "(intégré)".into())
        );
        if self.audio_session.load(Ordering::Relaxed) {
            // 0.6.1 : flux audio → pas de gate, démarrage immédiat.
            self.gate.disarm();
        } else {
            self.gate.arm();
            self.command(&["set", "pause", "yes"])?;
        }
        match audio {
            Some(a) => {
                // Syntaxe mpv « %longueur%valeur » : sans elle, une virgule dans
                // l'URL coupe la valeur et loadfile échoue (« invalid parameter »,
                // vérifié sur mpv 0.37) → repli silencieux en vidéo SANS son.
                let opts = format!("audio-file=%{}%{}", a.len(), a);
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
        if self.audio_session.load(Ordering::Relaxed) {
            self.set_paused(false)?;
        }
        Ok(())
    }

    /// 0.5.4 : lecture AUDIO SEUL (mode musique d'AetherFy). Extrait
    /// uniquement la meilleure piste audio (opus de préférence), sans
    /// flux vidéo : zéro décodage vidéo, zéro rendu logiciel.
    pub fn load_url_audio(&self, url: &str) -> Result<(), String> {
        // 0.6.1 : idem load_split — pas de start gate en audio.
        self.audio_session.store(true, Ordering::Relaxed);
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
        // 0.6.0 (visualiseur) : mémorise le flux audio extrait ET l'URL
        // d'origine — le visualiseur Symphonia ré-ouvrira ce flux précis.
        *self.last_source.lock().unwrap_or_else(|p| p.into_inner()) =
            Some((audio_url.clone(), None));
        *self.audio_origin.lock().unwrap_or_else(|p| p.into_inner()) =
            Some(url.to_string());
        // Flux audio = petit débit → démarrage immédiat, pas de gate.
        self.gate.disarm();
        self.apply_audio_filter();
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
                        .map(|s| s.to_string())
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
                        .map(|s| s.to_string())
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

    /// 0.5.2 : récupère un PO Token (cache `CACHE_TTL_SECS`), ou None si sidecar absent/échec.
    /// Le token est pré-généré au démarrage et rafraîchi en tâche de fond
    /// (voir `spawn_pot_prewarm`) : un clic sur une vidéo ne paie normalement
    /// plus la génération (processus sidecar, plusieurs secondes à froid).
    fn fetch_pot_token(&self) -> Option<(String, String)> {
        {
            let guard = self.pot_cache.lock().unwrap_or_else(|p| p.into_inner());
            if let Some((v, t, instant)) = guard.as_ref() {
                if instant.elapsed() < Duration::from_secs(POT_CACHE_TTL_SECS) {
                    return Some((v.clone(), t.clone()));
                }
            }
        }
        self.generate_pot_token()
    }

    /// Lance le sidecar bgutil-pot et met le résultat en cache (sans
    /// consulter le cache — utilisé par le rafraîchissement anticipé).
    fn generate_pot_token(&self) -> Option<(String, String)> {
        let t_pot = Instant::now();
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
            "[playback] PO Token généré en {} ms (visitor={}…, token={}…)",
            t_pot.elapsed().as_millis(),
            &visitor[..visitor.len().min(20)],
            &token[..token.len().min(20)]
        );
        *self.pot_cache.lock().unwrap_or_else(|p| p.into_inner()) =
            Some((visitor.clone(), token.clone(), Instant::now()));
        Some((visitor, token))
    }

    /// Stoppe mpv sans effet de bord — pour libérer la place quand le
    /// frontend bascule sur le lecteur HTML5.
    pub fn unload(&self) -> Result<(), String> {
        self.command(&["stop"])
    }

    /// 0.6.0 (visualiseur) : source réellement chargée dans mpv.
    pub fn current_source(&self) -> Option<(String, Option<String>)> {
        self.last_source
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .clone()
    }

    /// 0.6.0 (visualiseur) : URL d'origine demandée (page YouTube, fichier…).
    pub fn current_origin(&self) -> Option<String> {
        self.audio_origin
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .clone()
    }

    /// 0.6.0 (visualiseur) : position de lecture courante (resync).
    pub fn current_position(&self) -> f64 {
        self.get_property_double("time-pos").unwrap_or(0.0)
    }

    pub fn set_paused(&self, paused: bool) -> Result<(), String> {
        // 0.5.3 : action utilisateur explicite → priorité sur la start gate.
        self.gate.disarm();
        // 0.5.4 : pause/reprise repart sur une ardoise propre — les trames
        // encore « en vol » avant la pause sont abandonnées.
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

    /// Spatialisation audio : fixe le niveau voulu et l'applique tout de suite
    /// au média en cours. Le niveau reste mémorisé dans le moteur et est
    /// ré-appliqué avant chaque chargement (`apply_audio_filter`).
    pub fn set_spatial_level(&self, level: SpatialLevel) -> Result<(), String> {
        self.spatial_level.store(level.as_u8(), Ordering::Relaxed);
        self.try_apply_audio_filter()
    }

    /// Ambiance cinéma : même principe que `set_spatial_level`.
    pub fn set_cinema_level(&self, level: CinemaLevel) -> Result<(), String> {
        self.cinema_level.store(level.as_u8(), Ordering::Relaxed);
        self.try_apply_audio_filter()
    }

    /// Applique les DEUX niveaux d'un coup (aperçu A/B des Paramètres : un seul
    /// changement de chaîne audio au lieu de deux).
    pub fn set_audio_effects(
        &self,
        spatial: SpatialLevel,
        cinema: CinemaLevel,
    ) -> Result<(), String> {
        self.spatial_level.store(spatial.as_u8(), Ordering::Relaxed);
        self.cinema_level.store(cinema.as_u8(), Ordering::Relaxed);
        self.try_apply_audio_filter()
    }

    /// Place la chaîne `af` de mpv dans l'état voulu si elle ne l'y est pas déjà.
    fn try_apply_audio_filter(&self) -> Result<(), String> {
        let spatial = self.spatial_level.load(Ordering::Relaxed);
        let cinema = self.cinema_level.load(Ordering::Relaxed);
        let wanted = spatial * 4 + cinema;
        if self.audio_applied.load(Ordering::Relaxed) == wanted {
            return Ok(());
        }
        let filter = build_audio_filter(SpatialLevel::from_u8(spatial), CinemaLevel::from_u8(cinema));
        self.command(&["set", "af", &filter])?;
        self.audio_applied.store(wanted, Ordering::Relaxed);
        Ok(())
    }

    /// Variante « au chargement » : ne doit JAMAIS empêcher la lecture.
    fn apply_audio_filter(&self) {
        if let Err(err) = self.try_apply_audio_filter() {
            log::warn!("[playback] effets audio non appliqués : {err}");
        }
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

        /// 0.9.14 — Arrêt PROPRE + SILENCE IMMÉDIAT :
    /// 1) Pause mpv : coupe l'audio en < 50 ms, AVANT que le stop ne
    ///    purge le cache HLS (qui peut prendre plusieurs secondes sur
    ///    un flux live en buffer).
    /// 2) Stop : libère décodeurs, démuxeur, cache.
    /// 3) Détachement du thread de rendu (arrête sw_render).
    /// 4) Désarmement de la start gate.
    pub fn stop(&self) -> Result<(), String> {
        let t0 = Instant::now();
        // 0. Invalide tout rechargement correctif différé (attach_surface)
        //    et oublie la source : sans cela, un `attach_surface` tardif
        //    (ou déjà en attente) rechargeait `last_source` 300 ms plus
        //    tard et relançait l'audio après le stop.
        self.stop_epoch.fetch_add(1, Ordering::SeqCst);
        *self.last_source.lock().unwrap_or_else(|p| p.into_inner()) = None;
        // 1. Pause immédiate : coupe l'audio avant même que le stop
        //    n'ait fini de démonter le démuxeur.
        let _ = self.set_property_flag("pause", true);
        let t_pause = t0.elapsed();
        // 2. Stop : arrête la lecture et libère les ressources.
        let result = self.command(&["stop"]);
        let t_stop = t0.elapsed();
        // 3. Détache la surface (arrête le thread sw_render).
        self.detach_internal();
        let t_detach = t0.elapsed();
        // 4. Désarme la start gate (un load suivant repart propre).
        self.gate.disarm();
        log::info!(
            "[playback] stop() : pause {} ms, stop {} ms, détachement {} ms (cumulés)",
            t_pause.as_millis(),
            t_stop.as_millis(),
            t_detach.as_millis()
        );
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
        log::info!(
            "[playback] attach_surface {width}x{height} — la source sera RECHARGÉE dans 300 ms (cache perdu)"
        );
        let size = Arc::new((AtomicI32::new(width), AtomicI32::new(height)));
        let stop_flag = Arc::new(AtomicBool::new(false));
        let in_flight_frames = Arc::new(AtomicI32::new(0));
        let functions = self.functions.clone();
        let mpv = sw_render::MpvHandlePtr(self.mpv.0);
        let render_stop_flag = stop_flag.clone();
        let render_size = size.clone();
        let render_in_flight = in_flight_frames.clone();
        let render_thread = std::thread::spawn(move || {
            sw_render::run(
                functions,
                mpv,
                channel,
                render_stop_flag,
                render_size,
                render_in_flight,
            );
        });
        *guard = Some(SurfaceState {
            stop_flag,
            render_thread: Some(render_thread),
            size,
            in_flight_frames,
        });
        // 0.5.0 (correctif écran noir) : le VO libmpv de mpv a pu démarrer
        // AVANT que ce contexte de rendu existe → rechargement complet de
        // la source 300 ms plus tard pour réinitialiser le VO AVEC le
        // contexte présent. Configuration d'origine PROUVÉE (image OK sur
        // HLS TV) : ni skip « flux direct » (0.9.12 → plus aucun son),
        // ni wake seek (0.9.10 → image toujours noire).
        let source = self
            .last_source
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .clone();
        let functions_for_reload = self.functions.clone();
        let mpv_addr = self.mpv.0 as usize;
        let gate = self.gate.clone();
        let stop_epoch = self.stop_epoch.clone();
        let epoch_at_attach = stop_epoch.load(Ordering::SeqCst);
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(300));
            let Some((video, audio)) = source else {
                return;
            };
            // Un stop() est intervenu pendant les 300 ms d'attente : ne
            // surtout pas relancer le flux (audio fantôme sans image).
            if stop_epoch.load(Ordering::SeqCst) != epoch_at_attach {
                log::info!(
                    "[playback] rechargement correctif annulé : stop() intervenu depuis attach_surface"
                );
                return;
            }
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
            // Options du loadfile. Même quoting `%n%` que `load_split` (virgule
            // dans l'URL). La reprise passe par `start=` : un `seek` lancé
            // juste après `loadfile` échoue (« error running command », fichier
            // pas encore ouvert — vérifié sur mpv 0.37) et la lecture repartait
            // de 0:00, tampon vide, à chaque attache de surface (PiP, plein écran…).
            let mut opts: Vec<String> = Vec::new();
            if let Some(a) = &audio {
                opts.push(format!("audio-file=%{}%{}", a.len(), a));
            }
            if resume > 1.0 {
                opts.push(format!("start={resume:.3}"));
            }
            log::info!(
                "[playback] rechargement correctif : reprise à {resume:.1}s, audio externe={}",
                audio.is_some()
            );
            if !opts.is_empty() {
                c_args.push(CString::new(opts.join(",")).unwrap_or_default());
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
            // Filet de sécurité : un stop() a pu s'intercaler entre le
            // contrôle ci-dessus et le loadfile (fenêtre de quelques µs).
            // Dans ce cas on coupe immédiatement ce qu'on vient de relancer.
            if stop_epoch.load(Ordering::SeqCst) != epoch_at_attach {
                log::warn!(
                    "[playback] rechargement correctif : stop() intervenu pendant le reload — arrêt immédiat"
                );
                let c_stop = vec![CString::new("stop").unwrap_or_default()];
                let mut stptrs: Vec<*const c_char> = c_stop.iter().map(|a| a.as_ptr()).collect();
                stptrs.push(std::ptr::null());
                unsafe {
                    (functions_for_reload.command)(mpv_ptr, stptrs.as_ptr());
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
            // trame tirée par le polling…).
            let _ = state.in_flight_frames.fetch_update(
                Ordering::Relaxed,
                Ordering::Relaxed,
                |v| if v > 0 { Some(v - 1) } else { None },
            );
        }
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

    /// Propriété mpv de type chaîne (ex. `video-format`, `hwdec-current`).
    fn get_property_string(&self, name: &str) -> Result<String, String> {
        let cname = CString::new(name).unwrap_or_default();
        let mut raw: *mut c_char = std::ptr::null_mut();
        let rc = unsafe {
            (self.functions.get_property)(
                self.mpv.0,
                cname.as_ptr(),
                MpvFormat::String as c_int,
                &mut raw as *mut _ as *mut c_void,
            )
        };
        if rc < 0 {
            return Err(error_string(&self.functions, rc));
        }
        if raw.is_null() {
            return Ok(String::new());
        }
        let value = unsafe { CStr::from_ptr(raw) }.to_string_lossy().into_owned();
        unsafe { (self.functions.free)(raw as *mut c_void) };
        Ok(value)
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

/// Résumé SANS JETON d'une URL de flux, pour les logs : hôte, `mime`, `itag`.
/// Permet de voir d'un coup d'œil si le flux vient de googlevideo ou d'un
/// serveur tiers (Cobalt), et quel codec a été retenu (`mime=video/webm` =
/// VP9/AV1, `video/mp4` = H.264/AV1 selon l'itag).
fn describe_stream_url(url: &str) -> String {
    let host = url
        .split("://")
        .nth(1)
        .and_then(|rest| rest.split('/').next())
        .unwrap_or("?");
    let param = |key: &str| -> Option<&str> {
        let query = url.split_once('?')?.1;
        query
            .split('&')
            .find_map(|kv| kv.strip_prefix(key).and_then(|v| v.strip_prefix('=')))
    };
    format!(
        "{host} (mime={}, itag={})",
        param("mime").unwrap_or("?"),
        param("itag").unwrap_or("?")
    )
}

/// Essai de fluidité : `AVM_PREFER_AVC=1` fait préférer le H.264 à AV1/VP9
/// (que yt-dlp classe en tête). Sur le rendu logiciel de l'app, le décodage
/// H.264 est nettement plus léger. Désactivé par défaut.
fn prefer_avc() -> bool {
    static V: OnceLock<bool> = OnceLock::new();
    *V.get_or_init(|| std::env::var("AVM_PREFER_AVC").as_deref() == Ok("1"))
}

/// Depuis yt-dlp 2025.11.12, un runtime JavaScript externe (Deno par défaut)
/// est requis pour résoudre les défis YouTube (signature, `n`). Sans lui :
/// formats manquants, flux bridés, erreurs 403 — et `--no-warnings` masque
/// l'avertissement de yt-dlp. On le signale donc une fois au démarrage.
fn warn_if_no_js_runtime(ytdlp: &std::path::Path) {
    let exe = if cfg!(windows) { "deno.exe" } else { "deno" };
    let beside_ytdlp = ytdlp.parent().map(|d| d.join(exe)).filter(|p| p.exists());
    let in_path = std::env::var_os("PATH").and_then(|paths| {
        std::env::split_paths(&paths)
            .map(|d| d.join(exe))
            .find(|p| p.exists())
    });
    match beside_ytdlp.or(in_path) {
        Some(found) => log::info!("[playback] runtime JS pour yt-dlp : {}", found.display()),
        None => log::warn!(
            "[playback] AUCUN runtime JavaScript (deno) trouvé pour yt-dlp : depuis yt-dlp \
             2025.11.12, YouTube sans lui peut renvoyer des formats manquants, bridés ou des \
             erreurs 403 (cause possible de « mise en mémoire tampon » fréquente). Placer \
             `{exe}` à côté de yt-dlp (ce dossier est ajouté au PATH par l'app)."
        ),
    }
}

/// Diagnostic de lecture : toutes les 5 s, tant qu'un média est chargé et
/// qu'il joue (ou attend son tampon), trace l'état du cache et du rendu.
/// Sert à départager « réseau trop lent » (avance ≈ 0, débit < débit du flux),
/// « décodage/rendu trop lent » (images perdues qui montent) et « source
/// rechargée » (compteurs remis à zéro).
fn spawn_playback_diagnostics(handle: Arc<PlaybackEngineHandle>) {
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(5));
        let Ok(pos) = handle.get_property_double("time-pos") else {
            continue;
        };
        let waiting = handle.get_property_flag("paused-for-cache").unwrap_or(false);
        let paused = handle.get_property_flag("pause").unwrap_or(false);
        if paused && !waiting {
            continue;
        }
        let ahead = handle.get_property_double("demuxer-cache-duration").unwrap_or(-1.0);
        let speed_kib = handle.get_property_int64("cache-speed").unwrap_or(-1) / 1024;
        let fps = handle.get_property_double("estimated-vf-fps").unwrap_or(-1.0);
        let src_fps = handle.get_property_double("container-fps").unwrap_or(-1.0);
        let vo_drops = handle.get_property_int64("frame-drop-count").unwrap_or(-1);
        let dec_drops = handle.get_property_int64("decoder-frame-drop-count").unwrap_or(-1);
        let delayed = handle.get_property_int64("vo-delayed-frame-count").unwrap_or(-1);
        let codec = handle.get_property_string("video-format").unwrap_or_default();
        let hwdec = handle.get_property_string("hwdec-current").unwrap_or_default();
        let size = format!(
            "{}x{}",
            handle.get_property_int64("width").unwrap_or(0),
            handle.get_property_int64("height").unwrap_or(0)
        );
        log::info!(
            "[playback-diag] t={pos:.0}s avance={ahead:.1}s débit={speed_kib}KiB/s \
             tampon_vide={waiting} fps={fps:.1}/{src_fps:.1} perdues(vo={vo_drops}, \
             décodeur={dec_drops}) en_retard={delayed} codec={codec} {size} hwdec={hwdec}"
        );
    });
}

/// Durée de validité d'un PO Token en cache.
const POT_CACHE_TTL_SECS: u64 = 20 * 60;
/// Rafraîchissement anticipé (strictement < TTL) : le cache ne tombe donc
/// jamais « à froid » sous les yeux de l'utilisateur.
const POT_REFRESH_EVERY_SECS: u64 = 15 * 60;

/// Pré-chauffe le PO Token au démarrage puis le renouvelle en tâche de fond.
/// Sans sidecar (`locate_bgutil_pot()` vide) : aucun thread n'est créé.
fn spawn_pot_prewarm(handle: Arc<PlaybackEngineHandle>) {
    if locate_bgutil_pot().is_none() {
        return;
    }
    std::thread::spawn(move || {
        let _ = handle.generate_pot_token();
        loop {
            std::thread::sleep(Duration::from_secs(POT_REFRESH_EVERY_SECS));
            let _ = handle.generate_pot_token();
        }
    });
}

/// 0.5.0 : extraction via Cobalt — flux muxés (vidéo+audio) en une seule
/// requête HTTP.
///
/// Instances interrogées : par défaut UNIQUEMENT l'instance locale
/// `127.0.0.1:9000` (échec immédiat si rien n'écoute). Les instances
/// publiques tierces ne sont plus jamais contactées par défaut : elles
/// recevaient l'URL de chaque vidéo regardée (contraire à « 100 % local »),
/// ajoutaient jusqu'à 2 × 6 s d'attente avant yt-dlp et faisaient passer le
/// flux par un serveur tiers (débit bridé → mise en mémoire tampon).
/// Réglages : `COBALT_API=<url>` pour sa propre instance ;
/// `AVM_COBALT_PUBLIC=1` pour réactiver les instances publiques.
fn cobalt_extract(url: &str, height: Option<i64>) -> Option<String> {
    let instances: Vec<String> = std::env::var("COBALT_API")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .map(|s| vec![s.trim().trim_end_matches('/').to_string()])
        .unwrap_or_else(|| {
            let mut list: Vec<String> = vec!["http://127.0.0.1:9000".into()];
            if std::env::var("AVM_COBALT_PUBLIC").as_deref() == Ok("1") {
                list.push("https://cobalt-api.meow.lol".into());
                list.push("https://api.cobalt.tools".into());
            }
            list
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
        let t_cobalt = Instant::now();
        let res = ureq::post(&format!("{base}/"))
            .set("Accept", "application/json")
            .set("Content-Type", "application/json")
            .timeout(std::time::Duration::from_secs(6))
            .send_json(body);
        match res {
            Ok(resp) => {
                if let Ok(json) = resp.into_json::<serde_json::Value>() {
                    let status = json.get("status").and_then(|s| s.as_str()).unwrap_or("");
                    if (status == "tunnel" || status == "redirect")
                        && json.get("url").and_then(|u| u.as_str()).is_some()
                    {
                        if let Some(u) = json["url"].as_str() {
                            let url = u.to_string();
                            log::info!("[playback] cobalt OK via {base} ({status})");
                            return Some(url);
                        }
                    }
                    log::warn!("[playback] cobalt {base} : réponse sans URL");
                }
            }
            Err(e) => log::warn!(
                "[playback] cobalt {base} en échec après {} ms : {e}",
                t_cobalt.elapsed().as_millis()
            ),
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

/// Essai : `AVM_POS_HZ=4` limite à 4/s les événements de position envoyés
/// à l'interface (chacun re-rend tous les composants qui lisent le contexte
/// du lecteur — jusqu'à 30–60 fois par seconde sans limite). Le PTS interne
/// du rendu reste mis à jour à chaque événement. Désactivé par défaut.
fn pos_emit_min_gap() -> Option<Duration> {
    static V: OnceLock<Option<Duration>> = OnceLock::new();
    *V.get_or_init(|| {
        std::env::var("AVM_POS_HZ")
            .ok()
            .and_then(|s| s.trim().parse::<f64>().ok())
            .filter(|hz| hz.is_finite() && *hz > 0.0)
            .map(|hz| Duration::from_secs_f64(1.0 / hz))
    })
}

fn run_event_thread(
    functions: Arc<MpvFunctions>,
    mpv: MpvHandlePtr,
    app_handle: AppHandle,
    gate: Arc<StartGate>,
) {
    let mut last_pos_emit: Option<Instant> = None;
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
                        let secs = unsafe { *(prop.data as *const f64) };
                        payload.position_seconds = Some(secs);
                        // 0.5.6 : publie le PTS pour le thread de rendu
                        // (sw_render::LAST_PTS_MS) — sans appeler libmpv
                        // depuis ce dernier.
                        sw_render::LAST_PTS_MS.store((secs * 1000.0) as i64, Ordering::Relaxed);
                        if let Some(gap) = pos_emit_min_gap() {
                            if last_pos_emit.is_some_and(|t| t.elapsed() < gap) {
                                continue;
                            }
                            last_pos_emit = Some(Instant::now());
                        }
                    }
                    "duration" if prop.format == MpvFormat::Double as c_int => {
                        payload.duration_seconds = Some(unsafe { *(prop.data as *const f64) });
                    }
                    "demuxer-cache-duration" if prop.format == MpvFormat::Double as c_int => {
                        // Avance de tampon : ne sert qu'à la start gate (la
                        // barre verte de l'UI reste pilotée par
                        // `demuxer-cache-time`) — aucun événement UI ici.
                        let ahead = unsafe { *(prop.data as *const f64) };
                        maybe_release_gate(&gate, &functions, mpv, None, Some(ahead));
                        continue;
                    }
                    "pause" if prop.format == MpvFormat::Flag as c_int => {
                        let flag = unsafe { *(prop.data as *const c_int) };
                        payload.playing = Some(flag == 0);
                    }
                    "paused-for-cache" if prop.format == MpvFormat::Flag as c_int => {
                        let flag = unsafe { *(prop.data as *const c_int) };
                        payload.buffering = Some(flag != 0);
                    }
                    _ => continue,
                }
                // 0.5.3 : start gate — libère la lecture dès que la durée est
                // connue et que l'avance de tampon suffit (voir plus haut).
                maybe_release_gate(&gate, &functions, mpv, payload.duration_seconds, None);
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
                // `playing: Some(false)` UNIQUEMENT pour une vraie fin (EOF /
                // erreur). Un END_FILE de raison STOP/REDIRECT est émis par
                // mpv à chaque `loadfile … replace` (morceau suivant, changement
                // de qualité) ; or, en lecture audio (pas de start gate), la
                // propriété `pause` ne change alors pas → aucun événement
                // `pause` ne venait corriger le `false` : le bouton Lecture
                // restait « inactif » alors que le son jouait.
                let _ = app_handle.emit(
                    "player-state",
                    PlayerStateEvent {
                        ended: is_real_end,
                        playing: if is_real_end { Some(false) } else { None },
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

// `(async)` : exécutée dans le thread pool de Tauri et non sur le thread
// principal (une commande synchrone `#[tauri::command]` y tourne en ligne et
// bloquerait fenêtre + autres commandes pendant tout le yt-dlp). Lecture
// seule : aucun risque de course avec un chargement en cours.
#[tauri::command(async)]
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
/// `(async)` : voir `player_extract_media` (yt-dlp -J hors du thread principal).
#[tauri::command(async)]
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

#[cfg(test)]
mod tests {
    use super::{build_audio_filter, CinemaLevel, SpatialLevel};

    const ALL: [SpatialLevel; 4] = [
        SpatialLevel::Off,
        SpatialLevel::Light,
        SpatialLevel::Medium,
        SpatialLevel::Strong,
    ];

    #[test]
    fn spatial_level_keys_round_trip() {
        for level in ALL {
            assert_eq!(SpatialLevel::parse(level.key()), Some(level));
            assert_eq!(SpatialLevel::from_u8(level.as_u8()), level);
        }
        assert_eq!(SpatialLevel::parse("  medium "), Some(SpatialLevel::Medium));
        assert_eq!(SpatialLevel::parse("earwax"), None);
        assert_eq!(SpatialLevel::parse(""), None);
    }

    #[test]
    fn spatial_filters_are_well_formed() {
        // « off » partout = chaîne `af` vide ; sinon un graphe lavfi entre crochets.
        assert_eq!(build_audio_filter(SpatialLevel::Off, CinemaLevel::Off), "");
        for level in [SpatialLevel::Light, SpatialLevel::Medium, SpatialLevel::Strong] {
            let f = build_audio_filter(level, CinemaLevel::Off);
            assert!(f.starts_with("lavfi=[") && f.ends_with(']'), "{f}");
            assert!(f.contains("crossfeed="), "{f}");
        }
        // Les niveaux qui élargissent la scène doivent être protégés par un
        // limiteur de crêtes SANS normalisation de volume (`level=disabled`).
        for level in [SpatialLevel::Medium, SpatialLevel::Strong] {
            assert!(build_audio_filter(level, CinemaLevel::Off)
                .contains("alimiter=limit=0.97:level=disabled"));
        }
        // Le niveau « léger » seul ne dépasse pas : pas de limiteur ajouté.
        assert!(!build_audio_filter(SpatialLevel::Light, CinemaLevel::Off).contains("alimiter"));
    }

    #[test]
    fn cinema_levels_round_trip_and_combine() {
        for level in [CinemaLevel::Off, CinemaLevel::Light, CinemaLevel::Medium, CinemaLevel::Strong] {
            assert_eq!(CinemaLevel::parse(level.key()), Some(level));
            assert_eq!(CinemaLevel::from_u8(level.as_u8()), level);
        }
        assert_eq!(CinemaLevel::parse("imax"), None);
        // Cinéma seul : graves + réflexions + limiteur.
        let f = build_audio_filter(SpatialLevel::Off, CinemaLevel::Medium);
        assert!(f.contains("bass=") && f.contains("aecho=") && f.contains("alimiter="), "{f}");
        // Combinaison : la spatialisation passe AVANT le cinéma, le limiteur est en dernier.
        let both = build_audio_filter(SpatialLevel::Strong, CinemaLevel::Light);
        let (i_cross, i_bass, i_lim) = (
            both.find("crossfeed=").unwrap(),
            both.find("bass=").unwrap(),
            both.find("alimiter=").unwrap(),
        );
        assert!(i_cross < i_bass && i_bass < i_lim, "{both}");
        // Un seul limiteur, une seule enveloppe lavfi.
        assert_eq!(both.matches("alimiter=").count(), 1);
        assert_eq!(both.matches("lavfi=[").count(), 1);
    }
}
