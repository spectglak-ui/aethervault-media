//! Thread de rendu — backend **logiciel** de libmpv (`MPV_RENDER_API_TYPE_SW`,
//! `render.h`).
//!
//! Remplace entièrement `windows.rs` (`SurfaceWindow`/`GlContext`, WGL) et
//! `unsupported.rs` de l'ancienne architecture Étape 3b : il n'y a plus
//! aucune fenêtre Win32 ni contexte OpenGL. mpv écrit directement l'image
//! décodée dans un buffer mémoire (`Vec<u8>`, format `"rgb0"` — RGB sur 4
//! octets/pixel, 4e octet garbage, voir plus bas) que ce module transmet au
//! frontend via un `tauri::ipc::Channel`, pour affichage dans un
//! `<canvas>` React (`PlayerSurface.tsx`).
//!
//! Ce changement d'architecture élimine par construction le problème
//! d'« airspace » WebView2 documenté dans le rapport de transmission
//! "écran noir" (Étape 3b) : il n'existe plus aucune fenêtre native
//! candidate à un conflit de superposition avec la WebView2, puisqu'il n'y
//! a plus de fenêtre du tout de ce côté.
//!
//! ⚠️ Comme le reste de ce module, non compilé/testé ici (pas de toolchain
//! Windows/GPU côté assistant) — voir la note en tête de `mpv_ffi.rs`.
//! Les valeurs numériques de `render_param_type` ont pu être vérifiées
//! directement contre le source officiel de `render.h`
//! (mpv-player/mpv/libmpv/render.h) avant d'écrire ce fichier ; le format
//! de pixel `"rgb0"` et le comportement du backend SW proviennent de la
//! même source (section "Software renderer" de `render.h`).

use super::mpv_ffi::{self, MpvFunctions};
use std::ffi::c_void;
use std::os::raw::c_int;
use std::sync::atomic::{AtomicBool, AtomicI32, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};
use tauri::ipc::{Channel, InvokeResponseBody};

/// Compteur global du nombre de threads de rendu logiciel EN VIE en même
/// temps, tous mpv_handle/toutes fenêtres confondus (un seul process =
/// un seul mpv_handle de toute façon). Sert de PREUVE directe : si sa
/// valeur dépasse jamais 1, on a la certitude que deux threads de rendu
/// coexistent réellement (pas juste deux logs "create OK" successifs mais
/// séquentiels) — voir `run()`, incrémenté à l'entrée, décrémenté à la
/// sortie.
static ACTIVE_RENDER_THREADS: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);

/// Garde RAII pour `ACTIVE_RENDER_THREADS` : décrémente automatiquement à
/// la sortie de portée (donc à la sortie de `run()`, quel que soit le
/// chemin — fin de boucle normale ou déroulement de panique), sans avoir à
/// identifier manuellement chaque `return`/point de sortie.
struct ActiveThreadGuard;

impl ActiveThreadGuard {
    fn enter() -> (Self, u32) {
        let now = ACTIVE_RENDER_THREADS.fetch_add(1, Ordering::SeqCst) + 1;
        (Self, now)
    }
}

impl Drop for ActiveThreadGuard {
    fn drop(&mut self) {
        let remaining = ACTIVE_RENDER_THREADS.fetch_sub(1, Ordering::SeqCst) - 1;
        log::info!(
            "[playback_engine] [AV-DIAG] thread de rendu arrêté — threads actifs restants : {remaining}"
        );
    }
}

/// ⚠️ Repli PiP : dernière image rendue, stockée dans un slot STATIQUE
/// indépendant de tout câblage `SurfaceState`/`Arc` (prouvé fragile en
/// test réel : `player_pull_frame` renvoyait 0 octet). Lu par
/// `pull_latest_frame()`, appelé par la commande `player_pull_frame`.
static LATEST_FRAME: Mutex<Vec<u8>> = Mutex::new(Vec::new());

/// Renvoie une copie de la dernière image rendue (format
/// `[largeur:u32 LE][hauteur:u32 LE][pixels RGB0]`), ou un Vec vide si
/// aucune image n'a encore été rendue.
pub fn pull_latest_frame() -> Vec<u8> {
    LATEST_FRAME.lock().unwrap_or_else(|p| p.into_inner()).clone()
}

/// Pointeur `mpv_handle` — même type que celui défini dans `mod.rs`, repris
/// ici pour ne pas dépendre de la visibilité de `MpvHandlePtr` (privée dans
/// `mod.rs`). `Copy` volontairement : c'est un pointeur brut passé par
/// valeur entre threads, comme partout ailleurs dans ce module.
#[derive(Clone, Copy)]
pub struct MpvHandlePtr(pub *mut c_void);
unsafe impl Send for MpvHandlePtr {}
unsafe impl Sync for MpvHandlePtr {}

/// Format de pixel demandé à mpv : 4 octets/pixel, R à l'adresse 0, G à
/// l'adresse 1, B à l'adresse 2, 4e octet garbage ("rgb0", voir render.h).
/// Choisi plutôt que "0rgb"/"bgr0"/"0bgr" parce que c'est l'ordre mémoire
/// direct attendu par `ImageData`/`putImageData` côté canvas (R,G,B,_) —
/// aucune permutation de canaux nécessaire côté frontend. Le 4e octet
/// (garbage, pas garanti à 0xFF) est neutralisé en créant le contexte 2D du
/// canvas avec `{ alpha: false }` côté frontend (voir `PlayerSurface.tsx`),
/// qui ignore purement et simplement le canal alpha de `ImageData` — pas
/// besoin de le corriger nous-mêmes à chaque image.
const SW_FORMAT: &[u8] = b"rgb0\0";
const BYTES_PER_PIXEL: usize = 4;
/// Alignement requis par mpv pour le pointeur ET le stride passés au
/// backend logiciel (voir la note ci-dessous sur `RenderTarget`).
const MPV_SW_ALIGNMENT: usize = 64;

fn align_up(value: usize, align: usize) -> usize {
    (value + align - 1) / align * align
}

/// Bloc de 64 octets utilisé uniquement pour forcer l'alignement mémoire du
/// `Vec` ci-dessous — `#[repr(align(64))]` garantit que CHAQUE élément (et
/// donc le début du buffer contigu `Vec<AlignedPage>`) est aligné à 64
/// octets, ce qu'un `Vec<u8>` ordinaire ne garantit PAS (seulement
/// l'alignement naturel de `u8`, en pratique ~16 octets selon
/// l'allocateur — insuffisant, voir la documentation citée dans le
/// commentaire de `RenderTarget`).
#[derive(Clone, Copy)]
#[repr(align(64))]
struct AlignedPage([u8; 64]);

/// Buffer dédié exclusivement au rendu mpv — distinct du buffer envoyé au
/// frontend (voir `run()`). Réutilisé d'une image à l'autre, recréé
/// seulement quand la taille cible change (donc pas de réallocation par
/// image en fonctionnement normal, contrairement à la première version de
/// cette migration).
///
/// ⚠️ Correctif (retour de test — image très saturée puis blanchissant
/// progressivement) : `render.h` (MPV_RENDER_PARAM_SW_STRIDE) est explicite
/// — pointeur ET stride "should be a multiple of 64 to facilitate fast SIMD
/// operation [...] the pointer and stride must be aligned at least to the
/// pixel alignment size. Otherwise, crashes and undefined behavior is
/// possible". La première version de ce fichier écrivait directement dans
/// `buffer.as_mut_ptr().add(8)` (buffer destiné au frontend, décalé de 8
/// octets pour loger l'en-tête largeur/hauteur) : même si l'allocation de
/// base avait été 64-aligned (ce qu'un `Vec<u8>` ne garantit de toute façon
/// pas), ce décalage de 8 octets aurait cassé l'alignement 64 octets pour
/// les pixels eux-mêmes, et le stride (`largeur × 4`) n'est pratiquement
/// jamais un multiple de 64 pour une taille de canvas arbitraire. Un accès
/// SIMD désaligné côté mpv peut alors lire/écrire légèrement à côté du
/// buffer réellement alloué — corruption mémoire silencieuse, dont la
/// manifestation visuelle exacte (couleurs aberrantes, dérive progressive)
/// n'a rien de prévisible par construction, ce qui correspond au symptôme
/// rapporté.
struct RenderTarget {
    pages: Vec<AlignedPage>,
    width: usize,
    height: usize,
    stride: usize,
}

impl RenderTarget {
    fn new() -> Self {
        Self {
            pages: Vec::new(),
            width: 0,
            height: 0,
            stride: 0,
        }
    }

    /// Recrée le buffer seulement si la taille cible a changé — coûteux
    /// (nouvelle allocation + mise à zéro) mais rare : un simple
    /// redimensionnement de fenêtre, pas chaque image.
    fn ensure(&mut self, width: usize, height: usize) {
        if self.width == width && self.height == height && !self.pages.is_empty() {
            return;
        }
        let stride = align_up(width * BYTES_PER_PIXEL, MPV_SW_ALIGNMENT);
        let total_bytes = stride * height;
        let page_count = (total_bytes + MPV_SW_ALIGNMENT - 1) / MPV_SW_ALIGNMENT;
        self.pages = vec![AlignedPage([0u8; MPV_SW_ALIGNMENT]); page_count.max(1)];
        self.width = width;
        self.height = height;
        self.stride = stride;
    }

    fn as_mut_ptr(&mut self) -> *mut u8 {
        self.pages.as_mut_ptr() as *mut u8
    }

    fn as_ptr(&self) -> *const u8 {
        self.pages.as_ptr() as *const u8
    }
}

/// Réveil du thread de rendu par mpv (`mpv_render_context_set_update_callback`).
/// Le callback C ne DOIT appeler aucune fonction de l'API mpv (règle stricte
/// documentée dans render.h) — il se contente de positionner `dirty` et de
/// notifier la `Condvar`, rien d'autre.
struct WakeState {
    mutex: Mutex<()>,
    condvar: Condvar,
    dirty: AtomicBool,
}

extern "C" fn wake_trampoline(ctx: *mut c_void) {
    // SAFETY : `ctx` a été positionné juste en dessous, dans `run()`, comme
    // un pointeur brut issu de `Arc::into_raw` sur ce même type — il reste
    // valide tant que le thread de rendu n'a pas appelé `Arc::from_raw`
    // pour le reprendre en fin de boucle (voir `run()`).
    let state = unsafe { &*(ctx as *const WakeState) };
    state.dirty.store(true, Ordering::Release);
    // Le verrou n'est là que pour la sémantique standard `Condvar::wait` —
    // aucune donnée protégée dessous, juste le couple habituel requis par
    // l'API `std::sync::Condvar`.
    let _guard = state.mutex.lock().unwrap_or_else(|p| p.into_inner());
    state.condvar.notify_one();
}

/// ⚠️ Correctif (désynchronisation audio/vidéo constatée en usage prolongé —
/// `hwdec=auto-safe` conservé tel quel, ce correctif n'y touche pas) :
/// `mpv_render_context_report_swap()` signale à mpv l'instant où une image
/// vient réellement d'être présentée à l'écran, et sert de référence de
/// temps à son estimateur interne de cadence d'affichage (utilisé pour le
/// framedrop et le lissage audio/vidéo, voir render.h). Ce thread de rendu
/// peut, lors d'un rattrapage après un ralentissement ponctuel (canal IPC
/// momentanément lent, redimensionnement, plusieurs images décodées prêtes
/// d'un coup), enchaîner plusieurs itérations de boucle quasiment sans
/// attendre entre elles — chaque itération appelant alors
/// `report_swap()` en rafale, à quelques microsecondes d'intervalle.
/// mpv interprète chacun de ces appels comme une présentation d'écran
/// réelle et recale sa cadence estimée en conséquence, ce qui peut
/// progressivement désynchroniser son horloge audio/vidéo interne — sans
/// rapport avec le décodage matériel lui-même.
///
/// Option retenue (plus simple que le système de diagnostic complet
/// envisagé) : CHAQUE image décodée continue d'être rendue et transmise au
/// `<canvas>` normalement (aucun changement visuel, aucune image sautée à
/// l'affichage) — seul l'appel à `report_swap()` est limité à une
/// fréquence plausible pour un écran réel, voir `run()` plus bas. 240 Hz
/// (~4,17 ms) est une marge large au-dessus de tout écran grand public
/// existant : en fonctionnement normal (un réveil correspondant à une
/// image réellement affichée), cette limite n'est jamais atteinte et ne
/// change donc rien au comportement actuel ; elle ne s'active que lors
/// d'un rattrapage en rafale, précisément le cas qui posait problème.
const MIN_REPORT_SWAP_INTERVAL: Duration = Duration::from_micros(4_166); // ~240 Hz

/// ⚠️ Correctif (désynchronisation A/V CROISSANTE, confirmée par un test
/// réel — voir l'échange associé : à la pause, l'audio s'arrête net mais
/// l'image continue d'avancer un instant avant de s'arrêter là où l'audio
/// s'est arrêté, preuve directe d'une file d'images accumulée quelque
/// part entre mpv et l'écran). `tauri::ipc::Channel::send` est documenté
/// "fire-and-forget" par Tauri lui-même — rien ne garantissait jusqu'ici
/// que le frontend avait fini de dessiner une image avant que la suivante
/// ne soit poussée. Sans limite, une file invisible (côté WebView2/Tauri,
/// hors de notre contrôle direct) pouvait s'accumuler dès que le dessin
/// JS prenait ne serait-ce que ponctuellement du retard sur le rythme
/// réel de la vidéo — exactement le symptôme observé, qui s'aggrave avec
/// le temps plutôt que de rester un décalage fixe.
///
/// `MAX_IN_FLIGHT_FRAMES` : nombre d'images autorisées à être en route
/// vers le frontend sans accusé de réception (voir
/// `PlaybackEngineHandle::ack_frame`, appelée par `PlayerSurface.tsx`
/// juste après CHAQUE dessin réel — pas à la réception du message). Une
/// fois cette limite atteinte, l'image suivante est simplement SAUTÉE
/// (jamais mise en attente ni bloquée, voir `run()` plus bas) plutôt que
/// d'agrandir une file qui finirait par créer le même problème sous une
/// autre forme. 2 laisse une petite marge d'absorption pour le jitter
/// normal sans jamais laisser un vrai retard s'accumuler.
///
/// `ACK_TIMEOUT` : filet de sécurité — si aucun accusé de réception
/// n'arrive pendant ce délai alors que des images sont "en vol" (accusé
/// perdu, fenêtre fermée en plein transfert...), le compteur est
/// réinitialisé et la contre-pression temporairement abandonnée plutôt
/// que de geler la vidéo indéfiniment. Dégrade au pire vers le
/// comportement d'avant ce correctif, jamais pire.
const MAX_IN_FLIGHT_FRAMES: i32 = 2;
const ACK_TIMEOUT: Duration = Duration::from_millis(500);

/// Boucle de rendu logicielle : tourne jusqu'à `stop_flag`, pousse chaque
/// image décodée dans `channel` sous forme d'un message binaire brut
/// `[largeur:u32 LE][hauteur:u32 LE][pixels RGB0, largeur*hauteur*4 octets]`.
///
/// `size` est partagé avec `PlaybackEngineHandle::resize_surface` (voir
/// `mod.rs`) : un redimensionnement de la zone `<canvas>` change
/// simplement ces deux entiers, sans recréer le contexte de rendu — mpv se
/// reconfigure lui-même à chaque changement de taille de la surface cible
/// (documenté dans render.h : "The renderer will reconfigure itself every
/// time the target surface configuration is changed"), exactement le même
/// principe que le FBO redimensionné à la volée dans l'ancienne version
/// OpenGL.
///
/// `in_flight` : compteur de contre-pression partagé avec
/// `PlaybackEngineHandle::ack_frame` — voir `MAX_IN_FLIGHT_FRAMES`
/// ci-dessus pour le détail du correctif.
pub fn run(
    functions: Arc<MpvFunctions>,
    mpv: MpvHandlePtr,
    channel: Channel<InvokeResponseBody>,
    stop_flag: Arc<AtomicBool>,
    size: Arc<(AtomicI32, AtomicI32)>,
    in_flight: Arc<AtomicI32>,
    latest_frame: Arc<Mutex<Vec<u8>>>,
) {
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

    let mut render_ctx: *mut mpv_ffi::mpv_render_context = std::ptr::null_mut();
    let rc =
        unsafe { (functions.render_context_create)(&mut render_ctx, mpv.0, params.as_mut_ptr()) };
    if rc < 0 {
        log::error!(
            "[playback_engine] mpv_render_context_create (SW) a échoué (code {rc})"
        );
        return;
    }
    log::info!("[playback_engine] mpv_render_context_create OK (backend logiciel \"sw\")");

    // Preuve directe (demandée explicitement) : si `active_now` dépasse 1
    // ne serait-ce qu'une fois dans les logs, on a la certitude que deux
    // threads de rendu logiciel coexistent RÉELLEMENT (pas juste deux logs
    // "create OK" successifs mais séquentiels, ce qu'un simple grep ne
    // permet pas de distinguer). `_active_guard` décrémente
    // automatiquement à la sortie de `run()`, quel que soit le chemin de
    // sortie (RAII — voir `ActiveThreadGuard`).
    let (_active_guard, active_now) = ActiveThreadGuard::enter();
    log::info!(
        "[playback_engine] [AV-DIAG] thread de rendu démarré — threads actifs simultanément : {active_now}"
    );
    if active_now > 1 {
        log::error!(
            "[playback_engine] [AV-DIAG] ALERTE : {active_now} threads de rendu logiciel actifs \
             EN MÊME TEMPS — un seul producteur de frames devrait exister à la fois. Ceci \
             confirmerait directement la cause de la superposition observée."
        );
    }

    let wake_state = Arc::new(WakeState {
        mutex: Mutex::new(()),
        condvar: Condvar::new(),
        dirty: AtomicBool::new(true), // true : force un premier rendu immédiat
    });
    // `Arc::into_raw` fige l'adresse et incrémente le compte de références —
    // le pointeur brut transmis à mpv reste donc valide jusqu'à ce qu'on le
    // reprenne explicitement via `Arc::from_raw` juste avant de sortir de
    // cette fonction (voir la fin de cette boucle).
    let wake_ctx = Arc::into_raw(wake_state.clone()) as *mut c_void;
    unsafe {
        (functions.render_context_set_update_callback)(render_ctx, wake_trampoline, wake_ctx);
    }
	
	    // ⚠️ Correctif image FIGÉE du PiP (prouvé en test réel : la fenêtre PiP
    // affichait une image fixe pendant que le son continuait). Quand ce
    // contexte de rendu est créé EN COURS de lecture (transfert de surface
    // vers le PiP), mpv considère la frame courante comme déjà « présentée »
    // et ne réveille plus JAMAIS le wake callback de ce contexte — la boucle
    // ci-dessous ne rendrait alors aucune image (jamais de
    // MPV_RENDER_UPDATE_FRAME). Un seek relatif de 0 seconde (imperceptible)
    // force mpv à re-présenter la vidéo et relance le pipeline. Le second
    // envoi, 300 ms plus tard, couvre la course entre le seek et la
    // disponibilité de ce contexte. Tout se fait ICI, dans le thread de
    // rendu : `functions` et `mpv` y sont déjà possédés et `Send`, aucun
    // emprunt extérieur, aucune autre modification de fichier nécessaire.
    {
        let c_args = ["seek", "0", "relative"]
            .iter()
            .map(|arg| std::ffi::CString::new(*arg).unwrap_or_default())
            .collect::<Vec<_>>();
        let mut ptrs: Vec<*const std::ffi::c_char> = c_args.iter().map(|a| a.as_ptr()).collect();
        ptrs.push(std::ptr::null());
        unsafe { (functions.command)(mpv.0, ptrs.as_ptr()) };
    }
        let functions_for_redraw = functions.clone();
    // ⚠️ L'adresse est passée sous forme de `usize` (toujours `Send`)
    // plutôt que le pointeur brut `*mut c_void` (qui ne l'est pas) :
    // ce thread compile donc à coup sûr, et le pointeur est reconstitué
    // à l'intérieur du thread.
    let mpv_addr = mpv.0 as usize;
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(300));
        let c_args = ["seek", "0", "relative"]
            .iter()
            .map(|arg| std::ffi::CString::new(*arg).unwrap_or_default())
            .collect::<Vec<_>>();
        let mut ptrs: Vec<*const std::ffi::c_char> = c_args.iter().map(|a| a.as_ptr()).collect();
        ptrs.push(std::ptr::null());
        let mpv_ptr = mpv_addr as *mut c_void;
        unsafe { (functions_for_redraw.command)(mpv_ptr, ptrs.as_ptr()) };
    });

    let mut render_target = RenderTarget::new();
    let mut buffer: Vec<u8> = Vec::new();
    let mut frame_index: u64 = 0;
    let mut frame_dump = FrameDumpState::maybe_new();
    // Correctif désync A/V — voir `MIN_REPORT_SWAP_INTERVAL` ci-dessus.
    let mut last_swap_report: Option<Instant> = None;
    // Correctif contre-pression — voir `MAX_IN_FLIGHT_FRAMES` ci-dessus.
    let mut last_frame_sent: Option<Instant> = None;
	let mut first_frame_logged = false;

    while !stop_flag.load(Ordering::Relaxed) {
        // Attente passive : le thread ne consomme aucun CPU tant que mpv ne
        // signale rien (lecture en pause, en mémoire tampon, etc.) — à la
        // différence de l'ancienne boucle OpenGL qui redessinait sans
        // condition à ~60 Hz en permanence. Amélioration délibérée (voir
        // le message d'accompagnement) : le rendu logiciel est documenté
        // par mpv lui-même comme nettement plus coûteux en CPU que le
        // rendu GPU ("This method of rendering is very slow" — render.h),
        // donc éviter tout redessin superflu compte davantage ici qu'avec
        // l'ancien pipeline OpenGL.
        {
            let guard = wake_state.mutex.lock().unwrap_or_else(|p| p.into_inner());
            if !wake_state.dirty.load(Ordering::Acquire) {
                // Timeout de sécurité (200 ms) : filet de sécurité si jamais
                // un réveil était manqué (pas de garantie contraire connue,
                // mais un `wait` purement infini transformerait un tel bug
                // en gel silencieux plutôt qu'en dégradation visible).
                let _ = wake_state
                    .condvar
                    .wait_timeout(guard, std::time::Duration::from_millis(200));
            }
        }
        wake_state.dirty.store(false, Ordering::Release);

        if stop_flag.load(Ordering::Relaxed) {
            break;
        }

        // `mpv_render_context_update` indique si une nouvelle image est
        // réellement prête (bit MPV_RENDER_UPDATE_FRAME) — voir la
        // correction de type dans `mpv_ffi.rs` (uint64_t, pas c_ulong).
        let flags = unsafe { (functions.render_context_update)(render_ctx) };
        if flags & mpv_ffi::RENDER_UPDATE_FRAME == 0 {
            continue;
        }

        let raw_width = size.0.load(Ordering::Relaxed).max(1) as usize;
let raw_height = size.1.load(Ordering::Relaxed).max(1) as usize;
// ⚠️ Optimisation performance (plein écran 1080p saccadé) : plafonnement
// du rendu logiciel à 720p (1280x720). Le GPU du compositeur Windows
// (DWM) upscale gratuitement ensuite — imperceptible à l'œil nu sur un
// écran 1080p, mais ~2.25× moins de travail CPU pour mpv.
const MAX_RENDER_WIDTH: usize = 1280;
const MAX_RENDER_HEIGHT: usize = 720;
let width = raw_width.min(MAX_RENDER_WIDTH);
let height = raw_height.min(MAX_RENDER_HEIGHT);

        // Buffer dédié au rendu mpv, aligné à 64 octets (voir
        // `RenderTarget`) — recréé seulement si la taille a changé, jamais
        // à chaque image.
        render_target.ensure(width, height);
        let stride = render_target.stride;

        // ⚠️ Correctif (retour de test — superposition d'anciennes et de
        // nouvelles images, ex. logo visible sous les crédits suivants) :
        // `render.h` garantit que mpv réécrit TOUTE la région
        // pointeur..pointeur+stride*h à chaque appel réussi — mais ce
        // buffer est maintenant RÉUTILISÉ d'une image à l'autre (introduit
        // par le correctif d'alignement précédent, pour éviter une
        // réallocation par image). Si mpv n'écrit pas strictement 100% de
        // la zone à une itération donnée (redraw partiel, arrondi lié au
        // stride paddé, ou autre cas de bord propre au chemin logiciel),
        // la portion non réécrite contient alors le contenu de l'image
        // PRÉCÉDENTE au lieu d'être vierge — exactement la superposition
        // observée. L'ancienne version (buffer neuf + mis à zéro à chaque
        // image) masquait ce problème sans le corriger : une zone non
        // réécrite y apparaissait simplement en noir. On rétablit ici la
        // même garantie, à moindre coût qu'une réallocation complète
        // (un remplissage à zéro, pas une nouvelle allocation).
        unsafe {
            std::ptr::write_bytes(render_target.as_mut_ptr(), 0, stride * height);
        }

        let mut sw_size: [c_int; 2] = [width as c_int, height as c_int];
        let mut stride_value: usize = stride;
        let pixel_ptr = render_target.as_mut_ptr() as *mut c_void;

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
                data: pixel_ptr,
            },
            mpv_ffi::mpv_render_param {
                param_type: mpv_ffi::render_param_type::INVALID,
                data: std::ptr::null_mut(),
            },
        ];

        let render_rc =
            unsafe { (functions.render_context_render)(render_ctx, render_params.as_mut_ptr()) };

        // Correctif désync A/V (voir `MIN_REPORT_SWAP_INTERVAL`) : l'image
        // est de toute façon rendue et transmise plus bas à chaque
        // itération, que ce `report_swap` soit envoyé ou non — seul le
        // signal de temps donné à mpv est throttlé, jamais l'affichage.
        let now = Instant::now();
        let should_report_swap = last_swap_report
            .map(|previous| now.duration_since(previous) >= MIN_REPORT_SWAP_INTERVAL)
            .unwrap_or(true);
        if should_report_swap {
            unsafe {
                (functions.render_context_report_swap)(render_ctx);
            }
            last_swap_report = Some(now);
        }

        if render_rc < 0 {
            if frame_index % 300 == 0 {
                // Throttlé : évite d'inonder les logs si l'échec persiste
                // image après image (rendu logiciel ~24-60 Hz).
                log::warn!(
                    "[playback_engine] mpv_render_context_render (SW) a échoué (code {render_rc})"
                );
            }
            frame_index = frame_index.wrapping_add(1);
            continue;
        }

        // Vue directe sur ce que mpv vient d'écrire, AVANT toute
        // compaction/transport — c'est le point de vérité pour le mode
        // diagnostic ci-dessous, et pour la copie de compactage qui suit.
        let rendered =
            unsafe { std::slice::from_raw_parts(render_target.as_ptr(), stride * height) };

        // ⚠️ Mode diagnostic (demandé explicitement) : décidé une seule
        // fois par image, pour que le BMP et les logs [AV-DIAG] portent
        // bien sur EXACTEMENT la même image (même index de fichier, mêmes
        // valeurs de référence).
        let should_sample = frame_dump
            .as_mut()
            .map(|dump| dump.should_sample())
            .unwrap_or(false);

        if should_sample {
            if let Some(dump) = frame_dump.as_ref() {
                dump.dump_bmp(rendered, stride, width, height);
            }
        }

        // Copie de compactage : `render_target` a un stride aligné à 64
        // octets (donc généralement > largeur*4, avec du padding de fin de
        // ligne dont le contenu est explicitement documenté comme
        // "unspecified" par mpv — jamais à transmettre tel quel). Cette
        // copie ne garde que les `largeur*4` octets utiles de chaque
        // ligne, dans un buffer de transport strictement compact —
        // exactement le format attendu par `PlayerSurface.tsx`
        // (`[largeur][hauteur][pixels contigus]`), qui n'a donc pas eu à
        // changer pour ce correctif.
        let row_bytes = width * BYTES_PER_PIXEL;
        buffer.clear();
        buffer.reserve(8 + row_bytes * height);
        buffer.extend_from_slice(&(width as u32).to_le_bytes());
        buffer.extend_from_slice(&(height as u32).to_le_bytes());
        for row in 0..height {
            let start = row * stride;
            buffer.extend_from_slice(&rendered[start..start + row_bytes]);
        }
		    // ⚠️ Repli PiP (canal Tauri muet dans les fenêtres secondaires,
    // prouvé en test réel) : copie de la dernière image partagée avec la
    // commande `player_pull_frame` (voir mod.rs) — la fenêtre détachée
    // « tire » ce buffer au lieu de le recevoir par le canal.
    *latest_frame.lock().unwrap_or_else(|p| p.into_inner()) = buffer.clone();
    *LATEST_FRAME.lock().unwrap_or_else(|p| p.into_inner()) = buffer.clone();
    if !first_frame_logged {
        first_frame_logged = true;
        log::info!(
            "[playback_engine] première image rendue et mémorisée pour le repli PiP ({} octets)",
            buffer.len()
        );
    }

        // Instrumentation [AV-DIAG] : logge, pour CETTE image précise,
        // l'état exact du buffer qui va être remis à `channel.send`
        // juste en dessous — à comparer aux logs équivalents produits
        // côté JS (voir `PlayerSurface.tsx`) pour la même image.
        if should_sample {
            if let Some(dump) = frame_dump.as_mut() {
                dump.log_transport(rendered, stride, &buffer, width, height);
                dump.count += 1;
                if dump.count >= dump.max_dumps {
                    log::warn!(
                        "[playback_engine] [diagnostic] limite de {} images atteinte — arrêt \
                         de la capture (dossier : {})",
                        dump.max_dumps,
                        dump.dir.display()
                    );
                }
            }
        }

        // ⚠️ Correctif contre-pression (voir `MAX_IN_FLIGHT_FRAMES` en tête
        // de fichier). Ce test intervient volontairement APRÈS la capture
        // diagnostique [AV-DIAG] ci-dessus, pas avant : une image sautée
        // ici n'aura donc pas de log JS correspondant côté
        // `PlayerSurface.tsx` — à garder en tête en cas de comparaison
        // manuelle des deux séries de logs. `frame_index` (juste en
        // dessous) continue d'avancer normalement même pour une image
        // sautée : c'est un simple compteur de boucle, sans lien avec
        // l'envoi.
        let in_flight_now = in_flight.load(Ordering::Relaxed);
        let ack_stalled = last_frame_sent
            .map(|t| t.elapsed() >= ACK_TIMEOUT)
            .unwrap_or(false);
        let should_send_frame = in_flight_now < MAX_IN_FLIGHT_FRAMES || ack_stalled;

        if should_send_frame {
            if ack_stalled && in_flight_now >= MAX_IN_FLIGHT_FRAMES {
                // Les accusés de réception semblent bloqués (voir
                // ACK_TIMEOUT) : on abandonne la contre-pression pour
                // cette surface plutôt que de rester bloqué indéfiniment
                // — se réengagera naturellement dès qu'un accusé arrivera
                // à nouveau.
                log::warn!(
                    "[playback_engine] contre-pression vidéo : aucun accusé de réception \
                     depuis {ACK_TIMEOUT:?}, réinitialisation."
                );
                in_flight.store(0, Ordering::Relaxed);
            }

            // `InvokeResponseBody::Raw` : transfert binaire brut, sans passer
            // par la sérialisation JSON/base64 — voir la justification dans le
            // message d'accompagnement (mécanisme confirmé dans le code source
            // de tauri::ipc::Channel). `buffer` est consommé ici ; une nouvelle
            // allocation est faite à l'image suivante pour CE buffer de
            // transport (simplification délibérée pour cette première version
            // — un pool de deux buffers réutilisés en alternance serait
            // l'optimisation naturelle si le profilage montre une pression
            // mémoire/GC gênante). `render_target`, lui, est déjà réutilisé
            // d'une image à l'autre (voir plus haut).
            if channel
                .send(InvokeResponseBody::Raw(std::mem::take(&mut buffer)))
                .is_err()
            {
                // La fenêtre destinataire a probablement disparu (fermeture de
                // la fenêtre détachée, navigation...) — ce n'est pas une erreur
                // du moteur de lecture lui-même, `detach_internal` positionnera
                // `stop_flag` séparément. On se contente de journaliser et de
                // continuer jusqu'au prochain contrôle de `stop_flag`.
                log::warn!("[playback_engine] envoi d'image au frontend impossible (canal fermé ?)");
            } else {
                in_flight.fetch_add(1, Ordering::Relaxed);
                last_frame_sent = Some(Instant::now());
            }
        }

        frame_index = frame_index.wrapping_add(1);
    }

    unsafe {
        (functions.render_context_set_update_callback)(
            render_ctx,
            no_op_wake_trampoline,
            std::ptr::null_mut(),
        );
        (functions.render_context_free)(render_ctx);
    }
    // Reprend proprement le compte de références posé par `Arc::into_raw`
    // ci-dessus, maintenant que mpv ne peut plus rappeler `wake_trampoline`
    // (callback désenregistré juste au-dessus).
    unsafe {
        drop(Arc::from_raw(wake_ctx as *const WakeState));
    }
}

/// Callback neutre utilisé uniquement pour désenregistrer proprement le
/// callback de réveil avant de libérer son contexte (voir fin de `run()`) —
/// évite un appel tardif vers un pointeur déjà repris par `Arc::from_raw`.
extern "C" fn no_op_wake_trampoline(_ctx: *mut c_void) {}

// ---------------------------------------------------------------------
// Mode diagnostic — capture directe de la sortie de mpv (voir §"Audit
// complet du pipeline logiciel"). Isolé du reste du fichier : aucune de
// ces fonctions n'est appelée si la variable d'environnement
// AETHERVAULT_DIAGNOSTIC_DUMP_FRAMES est absente.
// ---------------------------------------------------------------------

/// État du mode diagnostic — capture jusqu'à `max_dumps` images, espacées
/// d'au moins `interval`, pour couvrir une transition (ex. "logo" →
/// "crédits") sans saturer le disque en écrivant chaque image à ~30-60 Hz.
struct FrameDumpState {
    dir: std::path::PathBuf,
    count: u32,
    max_dumps: u32,
    interval: std::time::Duration,
    last_dump: Option<std::time::Instant>,
}

impl FrameDumpState {
    /// `None` si la variable d'environnement est absente — dans ce cas,
    /// aucun coût, aucun accès disque, rien ne change par rapport à avant
    /// l'ajout de ce mode diagnostic.
    fn maybe_new() -> Option<Self> {
        if std::env::var_os("AETHERVAULT_DIAGNOSTIC_DUMP_FRAMES").is_none() {
            return None;
        }
        let dir = std::env::temp_dir().join("aethervault-frame-dumps");
        if let Err(err) = std::fs::create_dir_all(&dir) {
            log::error!(
                "[playback_engine] [diagnostic] impossible de créer {}: {err}",
                dir.display()
            );
            return None;
        }
        log::warn!(
            "[playback_engine] MODE DIAGNOSTIC ACTIF (AETHERVAULT_DIAGNOSTIC_DUMP_FRAMES) : \
             jusqu'à 60 images BMP + instrumentation binaire [AV-DIAG] dans {} — capture directe \
             de la sortie de mpv_render_context_render, AVANT toute copie vers le Channel et \
             avant toute intervention du frontend.",
            dir.display()
        );
        Some(Self {
            dir,
            count: 0,
            max_dumps: 60,
            interval: std::time::Duration::from_secs(2),
            last_dump: None,
        })
    }

    /// Décide si CETTE image doit être échantillonnée (BMP + logs
    /// [AV-DIAG]) — ne modifie l'horodatage que si la réponse est oui, pour
    /// respecter `interval`/`max_dumps` correctement.
    fn should_sample(&mut self) -> bool {
        if self.count >= self.max_dumps {
            return false;
        }
        let now = std::time::Instant::now();
        if let Some(last) = self.last_dump {
            if now.duration_since(last) < self.interval {
                return false;
            }
        }
        self.last_dump = Some(now);
        true
    }

    /// `rgb0`/`stride`/`width`/`height` : exactement ce que contient
    /// `render_target` juste après un appel réussi à
    /// `mpv_render_context_render` — rien d'autre n'y a touché à cet
    /// instant (ni la copie de compactage, ni le Channel, ni le JS).
    fn dump_bmp(&self, rgb0: &[u8], stride: usize, width: usize, height: usize) {
        let path = self
            .dir
            .join(format!("frame-{:03}-{}x{}.bmp", self.count, width, height));
        match write_bmp_rgb0(&path, rgb0, stride, width, height) {
            Ok(()) => {
                log::info!("[playback_engine] [diagnostic] image écrite : {}", path.display());
            }
            Err(err) => {
                log::error!(
                    "[playback_engine] [diagnostic] échec d'écriture de {}: {err}",
                    path.display()
                );
            }
        }
    }

    /// Instrumentation binaire de la seconde moitié du pipeline (buffer
    /// Rust → compactage → Channel). `rendered` = sortie mpv (référence,
    /// stride potentiellement paddé) ; `buffer` = ce qui est RÉELLEMENT
    /// remis à `channel.send` (compacté, avec l'en-tête de 8 octets).
    ///
    /// Calcule un hash (FNV-1a, choisi parce qu'il est trivial à
    /// réimplémenter à l'identique côté JavaScript sans dépendance — voir
    /// `PlayerSurface.tsx`) et 3 pixels témoins (premier, centre, dernier),
    /// et les logge sous le tag `[AV-DIAG]`, directement comparables aux
    /// logs équivalents produits côté JS pour la MÊME image (même index,
    /// même dimensions).
    ///
    /// Si `hash_source` (calculé depuis la sortie mpv) et `hash_envoyé`
    /// (calculé depuis ce qui part réellement vers le Channel) DIFFÈRENT
    /// déjà ICI, côté Rust, alors le bug est dans notre propre copie de
    /// compactage — inutile d'aller chercher plus loin côté IPC/JS.
    fn log_transport(&self, rendered: &[u8], stride: usize, buffer: &[u8], width: usize, height: usize) {
        let row_bytes = width * BYTES_PER_PIXEL;
        let expected_len = 8 + row_bytes * height;

        let hash_source = hash_tightly_packed(rendered, stride, width, height);
        let hash_sent = if buffer.len() > 8 {
            fnv1a(&buffer[8..])
        } else {
            0
        };

        let (fr, fg, fb) = sample_pixel_at(rendered, stride, 0, 0);
        let (cr, cg, cb) = sample_pixel_at(rendered, stride, width / 2, height / 2);
        let (lr, lg, lb) = sample_pixel_at(rendered, stride, width - 1, height - 1);

        log::info!(
            "[playback_engine] [AV-DIAG] image #{idx} {w}x{h} : buffer.len()={len} (attendu {expected}), \
             hash_source(mpv)={hs:#010x}, hash_envoyé(Channel)={hc:#010x}, match={m} | \
             pixel(0,0)=({fr},{fg},{fb}) pixel(centre)=({cr},{cg},{cb}) pixel(dernier)=({lr},{lg},{lb})",
            idx = self.count,
            w = width,
            h = height,
            len = buffer.len(),
            expected = expected_len,
            hs = hash_source,
            hc = hash_sent,
            m = hash_source == hash_sent,
            fr = fr, fg = fg, fb = fb,
            cr = cr, cg = cg, cb = cb,
            lr = lr, lg = lg, lb = lb,
        );

        if hash_source != hash_sent || buffer.len() != expected_len {
            log::error!(
                "[playback_engine] [AV-DIAG] DIVERGENCE détectée AVANT MÊME l'envoi au Channel \
                 (côté Rust exclusivement) — la copie de compactage elle-même altère les données. \
                 Le transport IPC et le frontend ne sont pas en cause pour cette image."
            );
        }
    }
}

/// FNV-1a 32 bits — implémentation volontairement la plus simple et la
/// plus portable possible (aucune dépendance), pour pouvoir être
/// reproduite À L'IDENTIQUE côté JavaScript (voir `PlayerSurface.tsx`,
/// fonction `fnv1a`) et ainsi comparer un hash calculé de chaque côté du
/// pipeline sur les mêmes octets.
fn fnv1a(bytes: &[u8]) -> u32 {
    let mut hash: u32 = 0x811c_9dc5;
    for &b in bytes {
        hash ^= b as u32;
        hash = hash.wrapping_mul(0x0100_0193);
    }
    hash
}

/// Comme `fnv1a`, mais lit directement depuis un buffer strided (avec
/// padding de fin de ligne, voir `RenderTarget`) en ignorant ce padding —
/// donne donc le hash de ce que le buffer compacté DEVRAIT contenir s'il
/// est fidèle à la sortie mpv.
fn hash_tightly_packed(strided: &[u8], stride: usize, width: usize, height: usize) -> u32 {
    let mut hash: u32 = 0x811c_9dc5;
    let row_bytes = width * BYTES_PER_PIXEL;
    for row in 0..height {
        let start = row * stride;
        for &b in &strided[start..start + row_bytes] {
            hash ^= b as u32;
            hash = hash.wrapping_mul(0x0100_0193);
        }
    }
    hash
}

/// Extrait (R,G,B) du pixel (x,y) dans un buffer "rgb0" avec le `stride`
/// donné (fonctionne aussi bien pour `rendered`, stride paddé, que pour la
/// portion pixels d'un buffer tightly-packed en passant `stride =
/// width*4`).
fn sample_pixel_at(bytes: &[u8], stride: usize, x: usize, y: usize) -> (u8, u8, u8) {
    let idx = y * stride + x * BYTES_PER_PIXEL;
    (bytes[idx], bytes[idx + 1], bytes[idx + 2])
}

/// Écrit un BMP 24 bits non compressé à partir d'un buffer au format
/// "rgb0" (voir `SW_FORMAT`) avec un stride potentiellement paddé (voir
/// `RenderTarget`). Volontairement le format le plus simple et le plus
/// universellement lisible possible (Aperçu/Photos/GIMP/Explorateur
/// Windows l'ouvrent tous nativement) — aucune dépendance externe, aucune
/// compression, donc aucune ambiguïté possible entre "ce que mpv a écrit"
/// et "ce que l'encodeur a fait subir à l'image" : c'est un outil de
/// preuve, pas un chemin de code de production.
///
/// Le format BMP attend l'ordre B,G,R par pixel (inverse de notre
/// "rgb0" = R,G,B,_) et des lignes stockées de BAS EN HAUT — les deux
/// sont gérés explicitement ci-dessous, indépendamment du reste du
/// pipeline (donc un bug éventuel dans CETTE fonction ne peut pas, par
/// construction, être confondu avec un bug du pipeline réel qu'on cherche
/// justement à isoler).
fn write_bmp_rgb0(
    path: &std::path::Path,
    rgb0: &[u8],
    stride: usize,
    width: usize,
    height: usize,
) -> std::io::Result<()> {
    use std::io::Write;

    let row_bytes_out = width * 3; // BMP 24 bits : 3 octets/pixel (B,G,R)
    let row_padding = (4 - (row_bytes_out % 4)) % 4; // BMP : chaque ligne alignée à 4 octets
    let padded_row = row_bytes_out + row_padding;
    let pixel_data_size = padded_row * height;
    let file_size = 14 + 40 + pixel_data_size;

    let mut file = std::fs::File::create(path)?;

    // BITMAPFILEHEADER (14 octets)
    file.write_all(b"BM")?;
    file.write_all(&(file_size as u32).to_le_bytes())?;
    file.write_all(&0u16.to_le_bytes())?; // réservé
    file.write_all(&0u16.to_le_bytes())?; // réservé
    file.write_all(&54u32.to_le_bytes())?; // offset des données pixel (14+40)

    // BITMAPINFOHEADER (40 octets)
    file.write_all(&40u32.to_le_bytes())?;
    file.write_all(&(width as i32).to_le_bytes())?;
    file.write_all(&(height as i32).to_le_bytes())?; // positif = stocké bas-en-haut
    file.write_all(&1u16.to_le_bytes())?; // plans
    file.write_all(&24u16.to_le_bytes())?; // bits/pixel
    file.write_all(&0u32.to_le_bytes())?; // BI_RGB (aucune compression)
    file.write_all(&(pixel_data_size as u32).to_le_bytes())?;
    file.write_all(&2835i32.to_le_bytes())?; // ~72 DPI, sans importance ici
    file.write_all(&2835i32.to_le_bytes())?;
    file.write_all(&0u32.to_le_bytes())?; // palette : aucune (24 bits)
    file.write_all(&0u32.to_le_bytes())?;

    let zero_padding = [0u8; 3];
    // BMP stocke les lignes de la DERNIÈRE (bas de l'image) à la PREMIÈRE.
    for y in (0..height).rev() {
        let row_start = y * stride;
        let row = &rgb0[row_start..row_start + width * BYTES_PER_PIXEL];
        for pixel in row.chunks_exact(BYTES_PER_PIXEL) {
            // pixel = [R, G, B, _] ("rgb0") -> BMP attend [B, G, R]
            file.write_all(&[pixel[2], pixel[1], pixel[0]])?;
        }
        if row_padding > 0 {
            file.write_all(&zero_padding[..row_padding])?;
        }
    }

    file.flush()
}
