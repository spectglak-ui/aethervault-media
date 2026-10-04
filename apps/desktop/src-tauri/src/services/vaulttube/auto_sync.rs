//! Synchronisation automatique des abonnements VaultTube.
//!
//! Thread dédié qui se réveille toutes les `SYNC_INTERVAL_HOURS` heures
//! et lance la sync de tous les abonnements actifs. Peut être arrêté
//! proprement via `stop()`.

use crate::services::vaulttube::{VaultTubeRepository, VaultTubeSync};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

const SYNC_INTERVAL_HOURS: u64 = 6;

pub struct AutoSyncHandle {
    stop_flag: Arc<AtomicBool>,
    thread: Option<std::thread::JoinHandle<()>>,
}

impl AutoSyncHandle {
    pub fn stop(&mut self) {
        self.stop_flag.store(true, Ordering::Relaxed);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

pub fn start(
    repo: Arc<VaultTubeRepository>,
    sync: Arc<VaultTubeSync>,
) -> AutoSyncHandle {
    let stop_flag = Arc::new(AtomicBool::new(false));
    let stop_flag_clone = stop_flag.clone();

    let thread = std::thread::spawn(move || {
        let interval = Duration::from_secs(SYNC_INTERVAL_HOURS * 3600);
        
        loop {
            if stop_flag_clone.load(Ordering::Relaxed) {
                log::info!("[vaulttube] auto-sync : arrêt demandé");
                break;
            }

            log::info!("[vaulttube] auto-sync : lancement de la synchronisation");
            
            // Récupère tous les abonnements
            let subs = match repo.list_subscriptions() {
                Ok(s) => s,
                Err(e) => {
                    log::error!("[vaulttube] auto-sync : impossible de lister les abonnements : {e}");
                    std::thread::sleep(interval);
                    continue;
                }
            };

            let mut total_added = 0;
            for sub in &subs {
                if stop_flag_clone.load(Ordering::Relaxed) {
                    break;
                }
                
                match sync.sync_subscription(sub) {
                    Ok(added) => {
                        total_added += added;
                        if added > 0 {
                            log::info!("[vaulttube] auto-sync : {} vidéos ajoutées pour {}", added, sub.name);
                        }
                    }
                    Err(e) => {
                        log::warn!("[vaulttube] auto-sync : échec pour {} : {e}", sub.name);
                    }
                }
                
                // Petite pause entre chaque abonnement pour ne pas saturer
                std::thread::sleep(Duration::from_secs(2));
            }

            if total_added > 0 {
                log::info!("[vaulttube] auto-sync : {} vidéos ajoutées au total", total_added);
            }

            // Attend l'intervalle ou l'arrêt
            let start = std::time::Instant::now();
            while start.elapsed() < interval {
                if stop_flag_clone.load(Ordering::Relaxed) {
                    break;
                }
                std::thread::sleep(Duration::from_secs(10));
            }
        }
    });

    AutoSyncHandle {
        stop_flag,
        thread: Some(thread),
    }
}