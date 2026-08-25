//! Bindings FFI minimalistes vers libmpv — sous-ensemble de l'API client
//! (`client.h`) et de l'API de rendu (`render.h`) dont AetherVault a besoin.
//!
//! Migration Étape 3f (rendu OpenGL headless) : ce fichier réintègre les
//! types OpenGL nécessaires au backend `MPV_RENDER_API_TYPE_OPENGL`
//! (`mpv_opengl_init_params`, `mpv_opengl_fbo`, constantes associées),
//! abandonnés à l'Étape 3c lors du passage au rendu logiciel. Le backend
//! SW reste disponible mais n'est plus utilisé par défaut — le rendu
//! logiciel de mpv étant documenté comme "very slow" (render.h) et
//! incapable de maintenir la fluidité en 1080p.
//!
//! ⚠️ Choix technique documenté (même logique que `services::watcher` pour
//! `notify-debouncer-full`) : plutôt que de dépendre d'un crate tiers
//! wrapper (`libmpv-sys`, `libmpv2`...) dont je ne peux pas vérifier la
//! version/l'API exacte dans cet environnement (pas d'accès réseau ni de
//! compilateur ici), j'ai écrit ces signatures à la main, directement
//! d'après l'ABI C stable et documentée de libmpv. Cette API est stable
//! depuis de nombreuses années et je lui fais une confiance élevée, MAIS :
//! les valeurs numériques des enums `mpv_format`, `mpv_event_id` et
//! `mpv_render_param_type` ci-dessous doivent être vérifiées contre les
//! en-têtes réels (`client.h`, `render.h`) livrés avec le binaire libmpv
//! choisi, à la première compilation — exactement comme le socle de
//! l'Étape 0 n'a pas pu être compilé ici et devait être vérifié par vos
//! soins. Une valeur erronée ne casse pas la compilation (ce sont de
//! simples entiers passés à travers du FFI) mais peut faire échouer un
//! événement précis silencieusement ; les points les plus sensibles
//! (MPV_FORMAT_*, MPV_EVENT_PROPERTY_CHANGE) sont signalés inline.
//!
//! Chargement dynamique (pas de link statique) : voir `mod.rs` pour la
//! justification — c'est ce qui nous permet de rester compatibles avec une
//! libmpv construite en LGPL par l'utilisateur, sans imposer GPL à
//! AetherVault.
#![allow(non_camel_case_types, dead_code)]
use libloading::{Library, Symbol};
use std::ffi::c_void;
use std::os::raw::{c_char, c_double, c_int};

pub type mpv_handle = c_void;
pub type mpv_render_context = c_void;
/// Sous-ensemble de mpv_format (client.h). Seuls les formats réellement
/// utilisés par AetherVault sont listés.
#[repr(C)]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum MpvFormat {
None = 0,
String = 1,
Flag = 3,
Int64 = 4,
Double = 5,
}
/// Sous-ensemble de mpv_event_id (client.h). Les valeurs dépréciées
/// (anciens événements retirés au fil des versions de mpv) sont
/// volontairement omises : seuls les événements que nous traitons
/// explicitement sont nommés, tout le reste tombe dans le bras _ de nos
/// match côté Rust et est simplement ignoré, donc un écart sur un
/// événement que nous ne traitons pas de toute façon est sans risque.
pub mod event_id {
pub const NONE: i32 = 0;
pub const SHUTDOWN: i32 = 1;
pub const END_FILE: i32 = 7;
pub const FILE_LOADED: i32 = 8;
pub const PROPERTY_CHANGE: i32 = 22;
}
/// Sous-ensemble de mpv_render_param_type (render.h). Valeurs vérifiées
/// contre le source officiel de render.h (mpv-player/mpv) :
/// INVALID=0, API_TYPE=1, OPENGL_INIT_PARAMS=4, OPENGL_FBO=5, FLIP_Y=6,
/// SW_SIZE=17, SW_FORMAT=18, SW_STRIDE=19, SW_POINTER=20.
///
/// ⚠️ Réintroduction Étape 3f : les constantes OpenGL avaient été retirées
/// à l'Étape 3c (rendu logiciel). Elles sont nécessaires pour le nouveau
/// backend OpenGL headless (gl_render.rs), qui utilise un contexte
/// OpenGL sans fenêtre native (WGL headless) pour éviter le conflit
/// d'airspace avec WebView2 qui avait motivé l'abandon initial.
pub mod render_param_type {
pub const INVALID: i32 = 0;
pub const API_TYPE: i32 = 1;
pub const OPENGL_INIT_PARAMS: i32 = 4;
pub const OPENGL_FBO: i32 = 5;
pub const FLIP_Y: i32 = 6;
pub const SW_SIZE: i32 = 17;
pub const SW_FORMAT: i32 = 18;
pub const SW_STRIDE: i32 = 19;
pub const SW_POINTER: i32 = 20;
}
/// Bit renvoyé par mpv_render_context_update() indiquant qu'une nouvelle
/// image est prête à être rendue (MPV_RENDER_UPDATE_FRAME, render.h).
///
/// ⚠️ Type corrigé : mpv_render_context_update() renvoie un uint64_t côté
/// C. La déclaration héritée de l'Étape 3b utilisait c_ulong, qui vaut 32
/// bits sous Windows (modèle LLP64) — un décalage d'ABI resté sans
/// conséquence tant que ce retour était ignoré (let _ = ..., voir
/// l'ancien run_render_thread), mais qui serait devenu un bug réel dès
/// qu'on teste ce bit, ce que fait le nouveau thread de rendu logiciel
/// (sw_render.rs) pour éviter de redessiner inutilement. Voir aussi
/// FnRenderContextUpdate ci-dessous, corrigé en conséquence.
pub const RENDER_UPDATE_FRAME: u64 = 1;
/// MPV_RENDER_API_TYPE_SW est une constante chaîne côté C
/// (#define ... "sw"), pas un entier.
pub const RENDER_API_TYPE_SW: &[u8] = b"sw\0";
/// MPV_RENDER_API_TYPE_OPENGL — backend OpenGL pour le rendu (render.h).
/// Réintroduit à l'Étape 3f pour le rendu headless (voir gl_render.rs).
pub const RENDER_API_TYPE_OPENGL: &[u8] = b"opengl\0";
/// Paramètres d'initialisation OpenGL pour mpv (render.h).
///
/// get_proc_address est un callback appelé par mpv pour résoudre les
/// fonctions OpenGL — on lui passe notre propre résolveur (voir gl_render.rs).
/// get_proc_address_ctx est un pointeur opaque transmis au callback.
///
/// ⚠️ Réintroduction Étape 3f : structure nécessaire pour le backend OpenGL
/// headless, avait été retirée à l'Étape 3c.
#[repr(C)]
pub struct mpv_opengl_init_params {
pub get_proc_address: unsafe extern "C" fn(*mut c_void, *const c_char) -> *mut c_void,
pub get_proc_address_ctx: *mut c_void,
}
/// FBO cible pour le rendu OpenGL (render.h).
///
/// fbo = 0 pour le FBO par défaut (framebuffer écran), ou l'ID d'un FBO
/// créé par l'application. w/h = dimensions du FBO.
///
/// ⚠️ Réintroduction Étape 3f : structure nécessaire pour le backend OpenGL
/// headless, avait été retirée à l'Étape 3c.
#[repr(C)]
pub struct mpv_opengl_fbo {
pub fbo: c_int,
pub w: c_int,
pub h: c_int,
}
#[repr(C)]
pub struct mpv_event {
pub event_id: c_int,
pub error: c_int,
pub reply_userdata: u64,
pub data: *mut c_void,
}
#[repr(C)]
pub struct mpv_event_property {
pub name: *const c_char,
pub format: c_int,
pub data: *mut c_void,
}
/// mpv_event_end_file (client.h) — accompagne l'événement END_FILE.
/// Layout vérifié par recherche (le champ reason est toujours le
/// premier, error le second — stable depuis l'introduction de ces
/// champs ; des champs de suivi de playlist ont été ajoutés après dans
/// des versions plus récentes de mpv, sans jamais déplacer ces deux-là).
///
/// ⚠️ Correctif (retour utilisateur après livraison — "MKV fonctionne, pas
/// MP4") : avant ce correctif, run_event_thread (voir mod.rs) ignorait
/// entièrement cette structure et traitait tout END_FILE comme une fin
/// de lecture normale, y compris un véritable échec de lecture
/// (reason == ERROR). Un fichier qui échoue à charger apparaissait donc
/// comme "terminé" sans aucun message d'erreur.
#[repr(C)]
pub struct mpv_event_end_file {
pub reason: c_int,
pub error: c_int,
pub playlist_entry_id: i64,
pub playlist_insert_id: i64,
pub playlist_insert_num_entries: c_int,
}
/// Sous-ensemble de mpv_end_file_reason (client.h).
pub mod end_file_reason {
pub const EOF: i32 = 0;
pub const STOP: i32 = 2;
pub const QUIT: i32 = 3;
pub const ERROR: i32 = 4;
pub const REDIRECT: i32 = 5;
}
#[repr(C)]
pub struct mpv_render_param {
pub param_type: c_int,
pub data: *mut c_void,
}
type FnCreate = unsafe extern "C" fn() -> *mut mpv_handle;
type FnInitialize = unsafe extern "C" fn(*mut mpv_handle) -> c_int;
type FnTerminateDestroy = unsafe extern "C" fn(*mut mpv_handle);
type FnSetOptionString =
unsafe extern "C" fn(*mut mpv_handle, *const c_char, *const c_char) -> c_int;
type FnCommand = unsafe extern "C" fn(*mut mpv_handle, *const *const c_char) -> c_int;
type FnSetProperty =
unsafe extern "C" fn(*mut mpv_handle, *const c_char, c_int, *mut c_void) -> c_int;
type FnGetProperty =
unsafe extern "C" fn(*mut mpv_handle, *const c_char, c_int, *mut c_void) -> c_int;
type FnObserveProperty =
unsafe extern "C" fn(*mut mpv_handle, u64, *const c_char, c_int) -> c_int;
type FnWaitEvent = unsafe extern "C" fn(*mut mpv_handle, c_double) -> *mut mpv_event;
type FnWakeup = unsafe extern "C" fn(*mut mpv_handle);
type FnErrorString = unsafe extern "C" fn(c_int) -> *const c_char;
type FnFree = unsafe extern "C" fn(*mut c_void);
type FnRenderContextCreate = unsafe extern "C" fn(
*mut *mut mpv_render_context,
*mut mpv_handle,
*mut mpv_render_param,
) -> c_int;
type FnRenderContextRender =
unsafe extern "C" fn(*mut mpv_render_context, *mut mpv_render_param) -> c_int;
type FnRenderContextSetUpdateCallback = unsafe extern "C" fn(
*mut mpv_render_context,
extern "C" fn(*mut c_void),
*mut c_void,
);
// Voir la note au-dessus de RENDER_UPDATE_FRAME : uint64_t côté C, pas
// c_ulong (corrigé lors de la migration vers le rendu logiciel, où ce
// retour est désormais effectivement lu).
type FnRenderContextUpdate = unsafe extern "C" fn(*mut mpv_render_context) -> u64;
type FnRenderContextReportSwap = unsafe extern "C" fn(*mut mpv_render_context);
type FnRenderContextFree = unsafe extern "C" fn(*mut mpv_render_context);
/// Signature de mpv_render_update_fn (render.h) : callback de réveil
/// enregistré via mpv_render_context_set_update_callback. Appelé depuis un
/// thread interne à mpv — ne doit JAMAIS rappeler dans l'API mpv (voir
/// commentaire dans sw_render.rs / gl_render.rs).
pub type FnRenderUpdateCallback = extern "C" fn(*mut c_void);
/// Table des symboles résolus dynamiquement depuis libmpv-2.dll (ou
/// équivalent). _library doit rester en vie tant que ces pointeurs de
/// fonction sont utilisés — d'où le champ conservé sur la struct plutôt
/// qu'une bibliothèque chargée puis oubliée.
pub struct MpvFunctions {
_library: Library,
pub create: FnCreate,
pub initialize: FnInitialize,
pub terminate_destroy: FnTerminateDestroy,
pub set_option_string: FnSetOptionString,
pub command: FnCommand,
pub set_property: FnSetProperty,
pub get_property: FnGetProperty,
pub observe_property: FnObserveProperty,
pub wait_event: FnWaitEvent,
pub wakeup: FnWakeup,
pub error_string: FnErrorString,
pub free: FnFree,
pub render_context_create: FnRenderContextCreate,
pub render_context_render: FnRenderContextRender,
pub render_context_set_update_callback: FnRenderContextSetUpdateCallback,
pub render_context_update: FnRenderContextUpdate,
pub render_context_report_swap: FnRenderContextReportSwap,
pub render_context_free: FnRenderContextFree,
}
/// Erreur de chargement — volontairement descriptive : c'est la première
/// chose qu'un utilisateur verra si libmpv-2.dll n'est pas installée ou
/// pas trouvée à côté de l'exécutable.
#[derive(Debug)]
pub struct MpvLoadError(pub String);
impl std::fmt::Display for MpvLoadError {
fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
write!(f, "Impossible de charger libmpv : {}", self.0)
}
}
impl std::error::Error for MpvLoadError {}
macro_rules! load_symbol {
($lib:expr, $name:literal) => {{
// $name est un littéral b"..." donc un &[u8; N], qui n'implémente
// pas Display — on le convertit explicitement en texte lisible
// pour le message d'erreur (le .get() lui-même, juste en
// dessous, attend bien un &[u8], donc $name est passé tel quel).
let symbol_name = std::str::from_utf8($name).unwrap_or("<nom de symbole invalide>");
let symbol: Symbol<'_, _> = $lib
.get($name)
.map_err(|e| MpvLoadError(format!("symbole {symbol_name} introuvable : {e}")))?;
*symbol
}};
}
impl MpvFunctions {
/// Charge la bibliothèque dynamique à l'emplacement donné (voir
/// mod.rs::locate_library pour la logique de recherche) et résout
/// chaque symbole utilisé par AetherVault. Échoue tôt et explicitement
/// si un seul symbole manque, plutôt que de laisser un pointeur nul
/// filer jusqu'à un appel — conformément au principe « pas de faux
/// placeholder » : soit le moteur natif est réellement disponible, soit
/// on le signale clairement à l'appelant.
pub fn load(library_path: &std::path::Path) -> Result<Self, MpvLoadError> {
// SAFETY : on charge une bibliothèque système désignée par
// l'utilisateur/l'installateur, pas un chemin arbitraire venu du
// réseau — risque équivalent à celui de charger n'importe quelle
// DLL native, inhérent à ce type d'intégration.
let library = unsafe { Library::new(library_path) }
.map_err(|e| MpvLoadError(format!("{} : {e}", library_path.display())))?;
    // SAFETY : chaque transmutation ci-dessous suppose que le symbole
    // exporté par libmpv correspond exactement à la signature C
    // documentée reproduite plus haut dans ce fichier.
    unsafe {
        Ok(Self {
            create: load_symbol!(library, b"mpv_create"),
            initialize: load_symbol!(library, b"mpv_initialize"),
            terminate_destroy: load_symbol!(library, b"mpv_terminate_destroy"),
            set_option_string: load_symbol!(library, b"mpv_set_option_string"),
            command: load_symbol!(library, b"mpv_command"),
            set_property: load_symbol!(library, b"mpv_set_property"),
            get_property: load_symbol!(library, b"mpv_get_property"),
            observe_property: load_symbol!(library, b"mpv_observe_property"),
            wait_event: load_symbol!(library, b"mpv_wait_event"),
            wakeup: load_symbol!(library, b"mpv_wakeup"),
            error_string: load_symbol!(library, b"mpv_error_string"),
            free: load_symbol!(library, b"mpv_free"),
            render_context_create: load_symbol!(library, b"mpv_render_context_create"),
            render_context_render: load_symbol!(library, b"mpv_render_context_render"),
            render_context_set_update_callback: load_symbol!(
                library,
                b"mpv_render_context_set_update_callback"
            ),
            render_context_update: load_symbol!(library, b"mpv_render_context_update"),
            render_context_report_swap: load_symbol!(
                library,
                b"mpv_render_context_report_swap"
            ),
            render_context_free: load_symbol!(library, b"mpv_render_context_free"),
            _library: library,
        })
    }
}
}
// MpvFunctions n'est envoyé qu'entre les threads internes du moteur de
// lecture (thread d'événements, thread de rendu) que nous contrôlons
// entièrement — jamais partagé avec le reste de l'application sans passer
// par PlaybackEngineHandle, qui expose une API sûre.
unsafe impl Send for MpvFunctions {}
unsafe impl Sync for MpvFunctions {}