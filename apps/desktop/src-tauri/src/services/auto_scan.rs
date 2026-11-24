//! Scan automatique des bibliothèques (Films, Séries, Anime, Documentaires).
//!
//! Le watcher (`services::watcher`) repère déjà les fichiers qui apparaissent dans les dossiers
//! d'une bibliothèque, mais il se contentait d'inscrire le fichier brut : sans appariement
//! (titre, épisode, affiche TMDB), sans vignette ni sonde technique, jusqu'à un scan manuel.
//! Ce module déclenche la CHAÎNE COMPLÈTE (scan → appariement → TMDB → vignettes → sonde), la
//! même que le bouton « Scanner », quand de nouveaux fichiers sont arrivés.
//!
//! - Un fichier en cours de copie n'est jamais traité : on attend que sa taille et sa date ne
//!   bougent plus (`AUTO_SCAN_SETTLE`), sinon vignette noire / sonde en échec sur un fichier
//!   incomplet.
//! - Au démarrage (30 s après), chaque bibliothèque concernée est scannée une fois, pour les
//!   fichiers ajoutés pendant que le logiciel était fermé.
//! - Réglage « Analyser automatiquement » (activé par défaut), clé `auto_scan_enabled`.

use crate::db::repositories::{
    category_repository, library_repository, settings_repository, title_repository,
};
use crate::services::watcher;
use crate::state::AppState;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant, SystemTime};
use tauri::{AppHandle, Emitter, Manager};

/// Clé de `app_settings` : « 1 » (défaut) ou « 0 ».
pub const AUTO_SCAN_SETTING_KEY: &str = "auto_scan_enabled";

/// Délai avant le scan de démarrage (laisse l'interface et le moteur se mettre en place).
const STARTUP_SCAN_DELAY: Duration = Duration::from_secs(30);

// ---- Planificateur (début) ----

/// Silence + stabilité des fichiers exigés avant de lancer le scan.
pub const AUTO_SCAN_SETTLE: Duration = Duration::from_secs(12);
/// Fréquence de vérification de la stabilité des fichiers d'une bibliothèque.
pub const AUTO_SCAN_CHECK_EVERY: Duration = Duration::from_secs(2);
/// Au-delà, on scanne quand même (un fichier qui n'en finit pas de grandir ne bloque pas tout).
pub const AUTO_SCAN_MAX_WAIT: Duration = Duration::from_secs(30 * 60);
/// Nouvel essai quand un scan de la même bibliothèque est déjà en cours.
pub const AUTO_SCAN_RETRY: Duration = Duration::from_secs(20);

/// État observable d'un fichier : s'il ne change plus, la copie est terminée.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Snapshot {
    pub size: u64,
    pub modified: Option<SystemTime>,
}

struct Pending {
    files: HashMap<PathBuf, Option<Snapshot>>,
    first_seen: Instant,
    stable_since: Option<Instant>,
    next_check: Instant,
}

/// Regroupe les fichiers nouveaux par bibliothèque et dit QUAND lancer le scan : lorsque tous
/// sont stables depuis `settle`. Logique pure (horloge et lecture des fichiers injectées).
pub struct AutoScanPlanner {
    pending: HashMap<i64, Pending>,
    settle: Duration,
    check_every: Duration,
    max_wait: Duration,
}

impl AutoScanPlanner {
    pub fn new(settle: Duration, check_every: Duration, max_wait: Duration) -> Self {
        Self { pending: HashMap::new(), settle, check_every, max_wait }
    }

    pub fn standard() -> Self {
        Self::new(AUTO_SCAN_SETTLE, AUTO_SCAN_CHECK_EVERY, AUTO_SCAN_MAX_WAIT)
    }

    /// Un fichier vidéo est apparu ou a été modifié dans la bibliothèque : il faudra scanner.
    pub fn note_file(&mut self, library_id: i64, path: PathBuf, now: Instant) {
        let entry = self.pending.entry(library_id).or_insert_with(|| Pending {
            files: HashMap::new(),
            first_seen: now,
            stable_since: None,
            next_check: now,
        });
        entry.files.insert(path, None);
        entry.stable_since = None; // de la nouveauté : il faut de nouveau attendre la stabilité
    }

    /// Bibliothèques prêtes à être scannées. Elles restent en attente jusqu'à `finish` ou
    /// `postpone` (le lanceur dit si le scan a pu démarrer).
    pub fn poll<F: Fn(&Path) -> Option<Snapshot>>(&mut self, now: Instant, stat: F) -> Vec<i64> {
        let mut ready = Vec::new();
        let mut empty = Vec::new();
        for (&library_id, pending) in self.pending.iter_mut() {
            if now < pending.next_check {
                continue;
            }
            pending.next_check = now + self.check_every;
            let mut all_stable = true;
            pending.files.retain(|path, last| match stat(path) {
                None => false, // supprimé ou déplacé entre-temps : rien à scanner pour lui
                Some(current) => {
                    if *last != Some(current) {
                        all_stable = false;
                    }
                    *last = Some(current);
                    true
                }
            });
            if pending.files.is_empty() {
                empty.push(library_id);
                continue;
            }
            if !all_stable {
                pending.stable_since = None;
            } else if pending.stable_since.is_none() {
                pending.stable_since = Some(now);
            }
            let settled = pending.stable_since.map_or(false, |t| now.duration_since(t) >= self.settle);
            if settled || now.duration_since(pending.first_seen) >= self.max_wait {
                ready.push(library_id);
            }
        }
        for id in empty {
            self.pending.remove(&id);
        }
        ready.sort_unstable();
        ready
    }

    /// Le scan a démarré (ou n'a plus lieu d'être) : la bibliothèque n'est plus en attente.
    pub fn finish(&mut self, library_id: i64) {
        self.pending.remove(&library_id);
    }

    /// Un scan de cette bibliothèque est déjà en cours : on réessaiera dans `AUTO_SCAN_RETRY`.
    pub fn postpone(&mut self, library_id: i64, now: Instant) {
        if let Some(p) = self.pending.get_mut(&library_id) {
            p.stable_since = None;
            p.next_check = now + AUTO_SCAN_RETRY;
        }
    }

    pub fn is_idle(&self) -> bool {
        self.pending.is_empty()
    }
}

/// État actuel d'un fichier (`None` s'il n'existe plus).
pub fn file_snapshot(path: &Path) -> Option<Snapshot> {
    std::fs::metadata(path)
        .ok()
        .map(|m| Snapshot { size: m.len(), modified: m.modified().ok() })
}

// ---- Planificateur (fin) ----

/// Les catégories scannées automatiquement : Films, Séries, Anime, Documentaires.
fn is_scannable_category_key(key: &str) -> bool {
    title_repository::PUBLIC_CATEGORY_KEYS.contains(&key)
}

fn is_scannable_library(conn: &rusqlite::Connection, library_id: i64) -> bool {
    let Ok(Some(library)) = library_repository::get(conn, library_id) else {
        return false;
    };
    library
        .category_id
        .and_then(|id| category_repository::get(conn, id).ok().flatten())
        .map(|c| is_scannable_category_key(&c.key))
        .unwrap_or(false)
}

/// Scan automatique activé ? (oui tant qu'il n'a pas été coupé dans les réglages)
pub fn is_enabled(conn: &rusqlite::Connection) -> bool {
    settings_repository::get(conn, AUTO_SCAN_SETTING_KEY)
        .ok()
        .flatten()
        .map(|v| v != "0")
        .unwrap_or(true)
}

pub fn set_enabled(conn: &rusqlite::Connection, enabled: bool) -> rusqlite::Result<()> {
    settings_repository::set(conn, AUTO_SCAN_SETTING_KEY, if enabled { "1" } else { "0" })
}

/// Issue d'une demande de scan automatique.
pub enum Launch {
    Started,
    /// Pas possible maintenant (scan déjà en cours, application pas prête) : réessayer.
    Busy,
    /// Sans objet (réglage coupé, catégorie non concernée) : abandonner.
    Skipped(&'static str),
}

/// Lance la chaîne complète pour une bibliothèque, comme le bouton « Scanner ».
pub fn launch(app: &AppHandle, library_id: i64) -> Launch {
    let Some(state) = app.try_state::<AppState>() else {
        return Launch::Busy; // l'état de l'application n'est pas encore prêt
    };
    {
        let Ok(conn) = state.db_pool.get() else {
            return Launch::Busy;
        };
        if !is_enabled(&conn) {
            return Launch::Skipped("scan automatique désactivé");
        }
        if !is_scannable_library(&conn, library_id) {
            return Launch::Skipped("catégorie non concernée");
        }
    }
    if !watcher::try_start(&state.scanning_libraries, library_id) {
        return Launch::Busy;
    }
    log::info!("[auto-scan] nouveaux fichiers détectés : scan de la bibliothèque {library_id}");
    crate::commands::library::trigger_scan(
        app.clone(),
        state.db_pool.clone(),
        state.scanning_libraries.clone(),
        state.metadata_service.clone(),
        state.data_dir.clone(),
        state.playback_engine.handle().ok().map(|h| h.mpv_functions()),
        library_id,
    );
    let _ = app.emit("library:auto-scan", serde_json::json!({ "library_id": library_id }));
    Launch::Started
}

/// Scan de rattrapage au démarrage : fichiers ajoutés pendant que le logiciel était fermé.
/// Une bibliothèque à la fois, 30 s après le lancement, jamais si le réglage est coupé.
pub fn spawn_startup_scan(app: AppHandle) {
    std::thread::spawn(move || {
        std::thread::sleep(STARTUP_SCAN_DELAY);
        let ids: Vec<i64> = {
            let Some(state) = app.try_state::<AppState>() else { return };
            let Ok(conn) = state.db_pool.get() else { return };
            if !is_enabled(&conn) {
                return;
            }
            library_repository::list_all(&conn)
                .map(|libraries| {
                    libraries
                        .into_iter()
                        .filter(|l| is_scannable_library(&conn, l.id))
                        .map(|l| l.id)
                        .collect()
                })
                .unwrap_or_default()
        };
        for id in ids {
            let mut attempts = 0;
            loop {
                match launch(&app, id) {
                    Launch::Started => {
                        wait_until_free(&app, id);
                        std::thread::sleep(Duration::from_secs(5));
                        break;
                    }
                    Launch::Busy => {
                        attempts += 1;
                        if attempts > 60 {
                            break;
                        }
                        std::thread::sleep(Duration::from_secs(5));
                    }
                    Launch::Skipped(_) => break,
                }
            }
        }
    });
}

/// Attend la fin du parcours des fichiers de la bibliothèque (libère la réservation du scan).
fn wait_until_free(app: &AppHandle, library_id: i64) {
    let Some(state) = app.try_state::<AppState>() else { return };
    for _ in 0..3600 {
        let busy = state
            .scanning_libraries
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .contains(&library_id);
        if !busy {
            return;
        }
        std::thread::sleep(Duration::from_secs(2));
    }
}

#[cfg(test)]
mod planner_tests {
    use super::*;
    use std::cell::RefCell;
    use std::collections::HashMap;

    /// Faux système de fichiers : (taille, date) modifiables à la main.
    struct Disk(RefCell<HashMap<PathBuf, Snapshot>>);

    impl Disk {
        fn new() -> Disk {
            Disk(RefCell::new(HashMap::new()))
        }
        fn put(&self, path: &str, size: u64, mtime_secs: u64) {
            self.0.borrow_mut().insert(
                PathBuf::from(path),
                Snapshot { size, modified: Some(SystemTime::UNIX_EPOCH + Duration::from_secs(mtime_secs)) },
            );
        }
        fn remove(&self, path: &str) {
            self.0.borrow_mut().remove(Path::new(path));
        }
        fn stat(&self) -> impl Fn(&Path) -> Option<Snapshot> + '_ {
            move |p| self.0.borrow().get(p).copied()
        }
    }

    fn planner() -> AutoScanPlanner {
        AutoScanPlanner::new(Duration::from_secs(10), Duration::from_secs(2), Duration::from_secs(600))
    }

    /// Avance l'horloge par pas de 2 s en interrogeant le planificateur ; renvoie quand une
    /// bibliothèque est prête, avec le temps écoulé.
    fn run_until_ready(p: &mut AutoScanPlanner, disk: &Disk, t0: Instant, max_secs: u64) -> Option<(Vec<i64>, u64)> {
        let mut s = 0;
        while s <= max_secs {
            let ready = p.poll(t0 + Duration::from_secs(s), disk.stat());
            if !ready.is_empty() {
                return Some((ready, s));
            }
            s += 2;
        }
        None
    }

    #[test]
    fn un_fichier_stable_declenche_le_scan_apres_le_delai_de_stabilite() {
        let disk = Disk::new();
        disk.put("/films/a.mkv", 1000, 5);
        let mut p = planner();
        let t0 = Instant::now();
        p.note_file(1, PathBuf::from("/films/a.mkv"), t0);
        let (ready, at) = run_until_ready(&mut p, &disk, t0, 60).expect("doit devenir prêt");
        assert_eq!(ready, vec![1]);
        // 1er relevé (t=0) = instable (jamais vu) ; stable dès t=2 ; prêt 10 s plus tard.
        assert_eq!(at, 12);
    }

    #[test]
    fn un_fichier_en_cours_de_copie_retarde_le_scan_jusqu_a_la_fin_de_la_copie() {
        let disk = Disk::new();
        let mut p = planner();
        let t0 = Instant::now();
        disk.put("/films/gros.mkv", 100, 1);
        p.note_file(1, PathBuf::from("/films/gros.mkv"), t0);
        // La copie dure 40 s : la taille grandit toutes les 2 s.
        for s in (0..40).step_by(2) {
            disk.put("/films/gros.mkv", 100 + (s as u64) * 1_000_000, 1 + s as u64);
            assert!(p.poll(t0 + Duration::from_secs(s), disk.stat()).is_empty(), "pas de scan à t={s}");
        }
        // Copie terminée à t=40 : plus de changement, prêt ~12 s plus tard (pas avant).
        let mut ready_at = None;
        for s in (40..80).step_by(2) {
            if !p.poll(t0 + Duration::from_secs(s), disk.stat()).is_empty() {
                ready_at = Some(s);
                break;
            }
        }
        let at = ready_at.expect("doit finir par être prêt");
        assert!(at >= 50, "jamais avant la stabilité : t={at}");
        assert!(at <= 54, "pas d'attente inutile : t={at}");
    }

    #[test]
    fn un_nouveau_fichier_pendant_l_attente_repousse_le_scan_pour_tout_le_lot() {
        let disk = Disk::new();
        disk.put("/series/s01e01.mkv", 10, 1);
        disk.put("/series/s01e02.mkv", 10, 1);
        let mut p = planner();
        let t0 = Instant::now();
        p.note_file(2, PathBuf::from("/series/s01e01.mkv"), t0);
        assert!(p.poll(t0, disk.stat()).is_empty());
        assert!(p.poll(t0 + Duration::from_secs(2), disk.stat()).is_empty());
        // 8 s plus tard, un 2e épisode arrive : le compte à rebours repart.
        p.note_file(2, PathBuf::from("/series/s01e02.mkv"), t0 + Duration::from_secs(8));
        assert!(p.poll(t0 + Duration::from_secs(10), disk.stat()).is_empty(), "l'ancien délai ne s'applique plus");
        let (ready, at) = run_until_ready_from(&mut p, &disk, t0, 12, 60).unwrap();
        assert_eq!(ready, vec![2]);
        assert!(at >= 22, "un seul scan, après stabilité du dernier arrivé : t={at}");
    }

    fn run_until_ready_from(p: &mut AutoScanPlanner, disk: &Disk, t0: Instant, from: u64, to: u64) -> Option<(Vec<i64>, u64)> {
        let mut s = from;
        while s <= to {
            let ready = p.poll(t0 + Duration::from_secs(s), disk.stat());
            if !ready.is_empty() {
                return Some((ready, s));
            }
            s += 2;
        }
        None
    }

    #[test]
    fn deux_bibliotheques_sont_planifiees_separement() {
        let disk = Disk::new();
        disk.put("/films/a.mkv", 5, 1);
        let mut p = planner();
        let t0 = Instant::now();
        p.note_file(1, PathBuf::from("/films/a.mkv"), t0);
        // La bibliothèque 7 reçoit un fichier beaucoup plus tard.
        let (first, _) = run_until_ready(&mut p, &disk, t0, 60).unwrap();
        assert_eq!(first, vec![1]);
        p.finish(1);
        disk.put("/anime/ep1.mkv", 5, 1);
        p.note_file(7, PathBuf::from("/anime/ep1.mkv"), t0 + Duration::from_secs(100));
        let (second, _) = run_until_ready_from(&mut p, &disk, t0, 100, 160).unwrap();
        assert_eq!(second, vec![7]);
    }

    #[test]
    fn un_fichier_supprime_avant_le_scan_est_oublie() {
        let disk = Disk::new();
        disk.put("/films/temp.mkv", 5, 1);
        let mut p = planner();
        let t0 = Instant::now();
        p.note_file(1, PathBuf::from("/films/temp.mkv"), t0);
        assert!(p.poll(t0, disk.stat()).is_empty());
        disk.remove("/films/temp.mkv");
        assert!(run_until_ready(&mut p, &disk, t0, 60).is_none(), "rien à scanner");
        assert!(p.is_idle(), "la bibliothèque n'est plus en attente");
    }

    #[test]
    fn un_scan_deja_en_cours_reporte_et_reessaie_plus_tard() {
        let disk = Disk::new();
        disk.put("/films/a.mkv", 5, 1);
        let mut p = planner();
        let t0 = Instant::now();
        p.note_file(1, PathBuf::from("/films/a.mkv"), t0);
        let (ready, at) = run_until_ready(&mut p, &disk, t0, 60).unwrap();
        assert_eq!(ready, vec![1]);
        let now = t0 + Duration::from_secs(at);
        p.postpone(1, now); // scan déjà en cours
        assert!(p.poll(now + Duration::from_secs(5), disk.stat()).is_empty(), "pas avant le délai de reprise");
        assert!(!p.is_idle(), "toujours en attente");
        let (again, later) = run_until_ready_from(&mut p, &disk, t0, at + 6, at + 120).unwrap();
        assert_eq!(again, vec![1]);
        assert!(later >= at + 20, "réessai après AUTO_SCAN_RETRY (20 s) : t={later}");
        p.finish(1);
        assert!(p.is_idle());
    }

    #[test]
    fn un_fichier_qui_ne_finit_jamais_de_grandir_ne_bloque_pas_indefiniment() {
        let disk = Disk::new();
        let mut p = AutoScanPlanner::new(Duration::from_secs(10), Duration::from_secs(2), Duration::from_secs(60));
        let t0 = Instant::now();
        p.note_file(1, PathBuf::from("/films/interminable.mkv"), t0);
        let mut ready_at = None;
        for s in (0..200).step_by(2) {
            disk.put("/films/interminable.mkv", s as u64 * 10, s as u64);
            if !p.poll(t0 + Duration::from_secs(s), disk.stat()).is_empty() {
                ready_at = Some(s);
                break;
            }
        }
        assert_eq!(ready_at, Some(60), "délai maximal atteint");
    }

    #[test]
    fn les_categories_scannees_sont_les_quatre_publiques() {
        for key in ["movies", "series", "anime", "documentaries"] {
            assert!(is_scannable_category_key(key), "{key}");
        }
        for key in ["private", "music", "books", ""] {
            assert!(!is_scannable_category_key(key), "{key}");
        }
    }
}
