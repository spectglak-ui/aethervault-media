//! NAS (Network Attached Storage) — montage de partages SMB/CIFS.
//!
//! **Windows** : utilise `cmdkey` (stockage sécurisé des identifiants
//! dans le Gestionnaire d'identification Windows — JAMAIS dans notre
//! base), puis montage du partage (`net use`) ; renvoie le chemin UNC.
//!
//! **Linux/macOS** (0.5.0) : montage non supporté. Les utilisateurs
//! doivent monter les partages manuellement via leur gestionnaire de
//! fichiers (ex. `/mnt/nas/...` ou `/Volumes/...`), puis ajouter le
//! chemin monté comme dossier de bibliothèque.

use serde::{Deserialize, Serialize};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
#[cfg(target_os = "windows")]
use std::process::Command;

/// Masque la console des commandes système (net use, cmdkey) sur Windows.
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

const UNSUPPORTED_MSG: &str = "Le montage NAS n'est pas supporté sur cet OS. \
Montez votre partage via votre gestionnaire de fichiers \
(/mnt/... ou /Volumes/...) puis ajoutez le chemin monté comme dossier \
de bibliothèque.";

#[derive(Clone, Serialize, Deserialize)]
pub struct NasFolder {
    pub path: String,
    pub username: Option<String>,
    pub password: Option<String>,
}

/// Teste la connexion à un partage NAS (montage + listing).
pub fn test_connection(folder: &NasFolder) -> Result<(), String> {
    #[cfg(not(target_os = "windows"))]
    {
        let _ = folder;
        return Err(UNSUPPORTED_MSG.to_string());
    }

    #[cfg(target_os = "windows")]
    {
        let unc = normalize_unc(&folder.path);
        store_credentials(&unc, folder)?;
        ensure_mounted(&unc, folder)?;
        std::fs::read_dir(&unc).map_err(|e| format!("Impossible de lire le partage : {e}"))?;
        Ok(())
    }
}

/// Monte un partage NAS et renvoie le chemin UNC à utiliser.
pub fn mount(folder: &NasFolder) -> Result<String, String> {
    #[cfg(not(target_os = "windows"))]
    {
        let _ = folder;
        return Err(UNSUPPORTED_MSG.to_string());
    }

    #[cfg(target_os = "windows")]
    {
        let unc = normalize_unc(&folder.path);
        store_credentials(&unc, folder)?;
        ensure_mounted(&unc, folder)?;
        Ok(unc)
    }
}

/// Démonte un partage NAS (best-effort).
pub fn unmount(path: &str) -> Result<(), String> {
    #[cfg(not(target_os = "windows"))]
    {
        let _ = path;
        return Err(UNSUPPORTED_MSG.to_string());
    }

    #[cfg(target_os = "windows")]
    {
        let unc = normalize_unc(path);
        let mut cmd = Command::new("net");
        cmd.args(["use", &unc, "/delete", "/y"]);
        cmd.creation_flags(CREATE_NO_WINDOW);
        let output = cmd.output().map_err(|e| format!("net use /delete : {e}"))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            // 2250 = connexion non utilisée → déjà démonté, OK.
            if !stderr.contains("2250") {
                log::warn!("[nas] net use /delete en échec : {stderr}");
            }
        }
        // Nettoie les identifiants stockés (best-effort).
        let mut cmd = Command::new("cmdkey");
        cmd.args(["/delete:", &unc]);
        cmd.creation_flags(CREATE_NO_WINDOW);
        let _ = cmd.output();
        Ok(())
    }
}

// ---------------------------------------------------------------------
// Helpers Windows
// ---------------------------------------------------------------------

/// Stocke les identifiants dans le Gestionnaire d'identification
/// (jamais dans notre base).
#[cfg(target_os = "windows")]
fn store_credentials(unc: &str, folder: &NasFolder) -> Result<(), String> {
    if let (Some(user), Some(pass)) = (&folder.username, &folder.password) {
        let mut cmd = Command::new("cmdkey");
        cmd.arg(format!("/generic:{unc}"));
        cmd.arg(format!("/user:{user}"));
        cmd.arg(format!("/pass:{pass}"));
        cmd.creation_flags(CREATE_NO_WINDOW);
        let output = cmd.output().map_err(|e| format!("cmdkey : {e}"))?;
        if !output.status.success() {
            log::warn!(
                "[nas] cmdkey en échec (non bloquant) : {}",
                String::from_utf8_lossy(&output.stderr).trim()
            );
        }
    }
    Ok(())
}

/// Monte le partage s'il ne l'est pas déjà.
#[cfg(target_os = "windows")]
fn ensure_mounted(unc: &str, folder: &NasFolder) -> Result<(), String> {
    // Déjà monté ?
    if std::fs::metadata(unc).is_ok() {
        return Ok(());
    }
    let mut cmd = Command::new("net");
    cmd.arg("use");
    cmd.arg(unc);
    if let Some(user) = &folder.username {
        cmd.arg(format!("/user:{user}"));
    }
    cmd.creation_flags(CREATE_NO_WINDOW);
    let output = cmd.output().map_err(|e| format!("net use : {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        // 1219 = multiples connexions non autorisées → déjà connecté, OK.
        if !stderr.contains("1219") {
            return Err(format!("Montage du partage impossible : {stderr}"));
        }
    }
    Ok(())
}

/// Normalise un chemin en UNC Windows (`\\serveur\partage`).
/// Accepte `\\serveur\partage`, `//serveur/partage`, `smb://serveur/partage`.
#[cfg(target_os = "windows")]
fn normalize_unc(path: &str) -> String {
    let p = path.trim();
    let p = p.strip_prefix("smb://").unwrap_or(p);
    let p = p.replace('/', "\\");
    if p.starts_with("\\\\") {
        p
    } else {
        format!("\\\\{}", p.trim_start_matches('\\'))
    }
}

// ---------------------------------------------------------------------
// Commandes Tauri (enregistrées dans lib.rs)
// ---------------------------------------------------------------------

#[tauri::command]
pub fn nas_test_connection(
    path: String,
    username: Option<String>,
    password: Option<String>,
) -> Result<(), String> {
    test_connection(&NasFolder { path, username, password })
}

#[tauri::command]
pub fn nas_connect(
    path: String,
    username: Option<String>,
    password: Option<String>,
) -> Result<String, String> {
    mount(&NasFolder { path, username, password })
}