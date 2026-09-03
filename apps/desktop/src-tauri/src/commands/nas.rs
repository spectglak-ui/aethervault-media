//! 0.4.0 — Support NAS (SMB / chemins UNC).
//!
//! Windows gère nativement les chemins `\\serveur\partage` (std::fs,
//! mpv, vignettes, watcher). Ces commandes servent uniquement à
//! établir la session réseau avec le NAS :
//! - `nas_connect` : identifiants → Gestionnaire d'identification
//!   Windows (`cmdkey` — JAMAIS dans notre base), puis montage du
//!   partage (`net use`) ;
//! - `nas_test_connection` : vérifie que le partage est lisible.
//!
//! Le chemin UNC renvoyé s'ajoute ensuite comme dossier de
//! bibliothèque classique (`add_library_folder`) : tout l'aval
//! (scan, watch, lecture, vignettes, reprises) fonctionne déjà.

use std::process::Command;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

/// Masque la console des commandes système (net use, cmdkey).
fn hide_console(cmd: &mut Command) {
    #[cfg(windows)]
    cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    #[cfg(not(windows))]
    let _ = cmd;
}

/// Construit et normalise le chemin UNC `\\serveur\partage`.
fn unc_path(server: &str, share: &str) -> String {
    let server = server
        .trim()
        .trim_start_matches('\\')
        .trim_start_matches("//")
        .replace('/', "\\");
    let share = share.trim().trim_start_matches('\\').trim_start_matches('/');
    format!("\\\\{server}\\{share}")
}

/// 0.4.0 : vérifie qu'un partage réseau existe et est lisible.
#[tauri::command]
pub fn nas_test_connection(server: String, share: String) -> Result<(), String> {
    let path = unc_path(&server, &share);
    let dir = std::path::Path::new(&path);
    if !dir.is_dir() {
        return Err(format!(
            "Le chemin {path} n'existe pas ou n'est pas accessible. \
             Vérifiez le serveur, le nom du partage et la connexion au NAS."
        ));
    }
    std::fs::read_dir(dir)
        .map_err(|e| format!("Le partage {path} est visible mais illisible : {e}"))?;
    Ok(())
}

/// 0.4.0 : établit la session avec le NAS (identifiants → Gestionnaire
/// d'identification Windows, puis `net use`) et renvoie le chemin UNC à
/// ajouter comme dossier de bibliothèque.
#[tauri::command]
pub fn nas_connect(
    server: String,
    share: String,
    username: Option<String>,
    password: Option<String>,
) -> Result<String, String> {
    let server_clean = server
        .trim()
        .trim_start_matches('\\')
        .trim_start_matches("//")
        .replace('/', "\\");
    let path = unc_path(&server, &share);

    let user = username
        .map(|u| u.trim().to_string())
        .filter(|u| !u.is_empty());
    let pass = password
        .map(|p| p.trim().to_string())
        .filter(|p| !p.is_empty());

    // 1. Identifiants → Gestionnaire d'identification Windows (jamais en base).
    if let (Some(u), Some(p)) = (user, pass) {
        let mut cmd = Command::new("cmdkey");
        cmd.arg(format!("/generic:{server_clean}"));
        cmd.arg(format!("/user:{u}"));
        cmd.arg(format!("/pass:{p}"));
        hide_console(&mut cmd);
        let out = cmd
            .output()
            .map_err(|e| format!("Impossible d'enregistrer les identifiants : {e}"))?;
        if !out.status.success() {
            return Err(format!(
                "Échec de l'enregistrement des identifiants Windows : {}",
                String::from_utf8_lossy(&out.stderr).trim()
            ));
        }
    }

    // 2. Montage du partage (utilise les identifiants stockés si besoin).
    let mut cmd = Command::new("net");
    cmd.arg("use");
    cmd.arg(&path);
    hide_console(&mut cmd);
    let net_err = match cmd.output() {
        Ok(out) if out.status.success() => None,
        Ok(out) => Some(String::from_utf8_lossy(&out.stderr).trim().to_string()),
        Err(e) => Some(e.to_string()),
    };

    // 3. Vérification finale : le partage doit être lisible.
    if let Err(test_err) = nas_test_connection(server, share) {
        return Err(match net_err {
            Some(e) if !e.is_empty() => format!("Connexion au NAS en échec : {e}"),
            _ => test_err,
        });
    }
    Ok(path)
}