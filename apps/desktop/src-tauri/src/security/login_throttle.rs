//! Ralentissement des tentatives de connexion répétées (0.7.9).
//!
//! Un PIN de 4 chiffres n'a que 10 000 combinaisons : sans frein, on les essaie
//! toutes en quelques minutes. Après 5 échecs consécutifs sur un profil, les
//! essais suivants sont refusés pendant un délai qui double à chaque échec
//! supplémentaire (30 s, 1 min, 2 min, 4 min, 8 min, puis 10 min au maximum). Un
//! succès remet le compteur à zéro. L'état est en mémoire : redémarrer
//! l'application le réinitialise (le frein vise l'essai répété depuis l'interface,
//! pas quelqu'un qui peut déjà lire le disque).

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

/// Échecs consécutifs tolérés avant le premier blocage.
pub const FREE_ATTEMPTS: u32 = 5;
const BASE_LOCK_SECONDS: u64 = 30;
const MAX_LOCK_SECONDS: u64 = 600;

/// Durée du blocage après `failures` échecs consécutifs.
pub fn lock_seconds(failures: u32) -> u64 {
    if failures < FREE_ATTEMPTS {
        return 0;
    }
    let doublings = (failures - FREE_ATTEMPTS).min(10);
    (BASE_LOCK_SECONDS << doublings).min(MAX_LOCK_SECONDS)
}

#[derive(Default)]
struct Entry {
    failures: u32,
    locked_until: Option<Instant>,
}

/// Compteurs par profil (cœur testable : l'heure est passée en paramètre).
#[derive(Default)]
pub struct Throttle {
    entries: HashMap<i64, Entry>,
}

impl Throttle {
    /// `Err(secondes restantes)` si le profil est bloqué à l'instant `now`.
    pub fn check(&self, profile_id: i64, now: Instant) -> Result<(), u64> {
        match self.entries.get(&profile_id).and_then(|e| e.locked_until) {
            Some(until) if until > now => Err((until - now).as_secs() + 1),
            _ => Ok(()),
        }
    }

    pub fn failure(&mut self, profile_id: i64, now: Instant) {
        let entry = self.entries.entry(profile_id).or_default();
        entry.failures = entry.failures.saturating_add(1);
        let lock = lock_seconds(entry.failures);
        entry.locked_until = (lock > 0).then(|| now + Duration::from_secs(lock));
    }

    pub fn success(&mut self, profile_id: i64) {
        self.entries.remove(&profile_id);
    }
}

fn global() -> &'static Mutex<Throttle> {
    static STATE: OnceLock<Mutex<Throttle>> = OnceLock::new();
    STATE.get_or_init(|| Mutex::new(Throttle::default()))
}

fn locked_message(seconds: u64) -> String {
    if seconds >= 90 {
        format!("Trop de tentatives. Réessayez dans {} min.", seconds.div_ceil(60))
    } else {
        format!("Trop de tentatives. Réessayez dans {seconds} s.")
    }
}

/// À appeler AVANT de vérifier un secret : refuse tant que le profil est bloqué.
pub fn check(profile_id: i64) -> Result<(), String> {
    let state = global().lock().map_err(|_| "Verrou interne indisponible.".to_string())?;
    state.check(profile_id, Instant::now()).map_err(locked_message)
}

/// Secret incorrect.
pub fn record_failure(profile_id: i64) {
    if let Ok(mut state) = global().lock() {
        state.failure(profile_id, Instant::now());
    }
}

/// Secret correct : le compteur repart de zéro.
pub fn record_success(profile_id: i64) {
    if let Ok(mut state) = global().lock() {
        state.success(profile_id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn delais_progressifs_plafonnes() {
        let expected = [(0, 0), (4, 0), (5, 30), (6, 60), (7, 120), (8, 240), (9, 480), (10, 600), (50, 600)];
        for (failures, seconds) in expected {
            assert_eq!(lock_seconds(failures), seconds, "après {failures} échecs");
        }
    }

    #[test]
    fn cinq_essais_libres_puis_blocage_puis_deblocage() {
        let mut t = Throttle::default();
        let start = Instant::now();
        for _ in 0..4 {
            t.failure(1, start);
            assert!(t.check(1, start).is_ok());
        }
        t.failure(1, start); // 5e échec
        let remaining = t.check(1, start).unwrap_err();
        assert!((30..=31).contains(&remaining), "{remaining}");
        assert!(t.check(1, start + Duration::from_secs(29)).is_err());
        assert!(t.check(1, start + Duration::from_secs(31)).is_ok());
    }

    #[test]
    fn le_delai_double_a_chaque_echec_suivant() {
        let mut t = Throttle::default();
        let start = Instant::now();
        for _ in 0..5 {
            t.failure(1, start);
        }
        let later = start + Duration::from_secs(40);
        t.failure(1, later); // 6e échec : 60 s
        assert!(t.check(1, later + Duration::from_secs(59)).is_err());
        assert!(t.check(1, later + Duration::from_secs(61)).is_ok());
    }

    #[test]
    fn un_succes_remet_a_zero_et_les_profils_sont_independants() {
        let mut t = Throttle::default();
        let now = Instant::now();
        for _ in 0..5 {
            t.failure(1, now);
        }
        assert!(t.check(1, now).is_err());
        assert!(t.check(2, now).is_ok()); // autre profil non concerné
        t.success(1);
        assert!(t.check(1, now).is_ok());
        t.failure(1, now); // repart de 1 échec, pas de 6
        assert!(t.check(1, now).is_ok());
    }

    #[test]
    fn messages_lisibles() {
        assert_eq!(locked_message(30), "Trop de tentatives. Réessayez dans 30 s.");
        assert_eq!(locked_message(120), "Trop de tentatives. Réessayez dans 2 min.");
        assert_eq!(locked_message(600), "Trop de tentatives. Réessayez dans 10 min.");
    }
}
