//! 0.5.0 — Abstraction multiplateforme : un seul point de vérité pour
//! les différences OS (noms de binaires, chemins de recherche).
//!
//! Ordre de résolution des binaires externes (libmpv, yt-dlp) :
//! 1. variable d'environnement `AVM_BIN_DIR` (override dev/tests) ;
//! 2. répertoire des ressources Tauri (binaires bundlés) ;
//! 3. à côté de l'exécutable (comportement historique Windows) ;
//! 4. PATH système (installations Linux/macOS via apt/brew).

use std::path::{Path, PathBuf};

/// Noms candidats de la bibliothèque dynamique mpv, par OS.
pub fn mpv_lib_candidates() -> Vec<&'static str> {
    if cfg!(target_os = "windows") {
        vec!["libmpv-2.dll", "mpv-2.dll", "libmpv.dll"]
    } else if cfg!(target_os = "macos") {
        vec!["libmpv.2.dylib", "libmpv.dylib"]
    } else {
        vec!["libmpv.so.2", "libmpv.so.1", "libmpv.so"]
    }
}

/// Nom du binaire yt-dlp pour l'OS courant.
pub fn yt_dlp_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "yt-dlp.exe"
    } else {
        "yt-dlp"
    }
}

/// Résout un binaire externe selon l'ordre de recherche documenté.
/// `exe_dir` : répertoire de l'exécutable ; `resource_dir` : ressources
/// Tauri (Option car indisponible avant setup).
pub fn resolve_binary(
    candidates: &[&str],
    exe_dir: &Path,
    resource_dir: Option<&Path>,
) -> Option<PathBuf> {
    // 1. Override explicite
    if let Ok(dir) = std::env::var("AVM_BIN_DIR") {
        for name in candidates {
            let p = Path::new(&dir).join(name);
            if p.exists() {
                return Some(p);
            }
        }
    }
    // 2. Ressources bundlées
    if let Some(res) = resource_dir {
        for name in candidates {
            let p = res.join(name);
            if p.exists() {
                return Some(p);
            }
        }
    }
    // 3. À côté de l'exécutable
    for name in candidates {
        let p = exe_dir.join(name);
        if p.exists() {
            return Some(p);
        }
    }
    // 4. PATH système : renvoie juste le nom, l'OS résoudra
    Some(PathBuf::from(candidates[0]))
}

/// Résolution yt-dlp (un seul nom, même ordre).
pub fn resolve_yt_dlp(exe_dir: &Path, resource_dir: Option<&Path>) -> PathBuf {
    resolve_binary(&[yt_dlp_name()], exe_dir, resource_dir)
        .unwrap_or_else(|| PathBuf::from(yt_dlp_name()))
}

/// Résolution libmpv (plusieurs noms candidats).
pub fn resolve_mpv(exe_dir: &Path, resource_dir: Option<&Path>) -> PathBuf {
    resolve_binary(&mpv_lib_candidates(), exe_dir, resource_dir)
        .unwrap_or_else(|| PathBuf::from(mpv_lib_candidates()[0]))
}

/// Message d'aide par OS si libmpv introuvable.
pub fn mpv_install_hint() -> &'static str {
    if cfg!(target_os = "windows") {
        "Placez libmpv-2.dll à côté de l'exécutable."
    } else if cfg!(target_os = "macos") {
        "Installez mpv : brew install mpv"
    } else {
        "Installez mpv : sudo apt install libmpv2 (ou libmpv1)"
    }
}