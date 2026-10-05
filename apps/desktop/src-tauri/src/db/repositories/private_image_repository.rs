//! Accès SQL aux tables `private_image_folders`/`private_image_files` —
//! toutes à l'intérieur de `vault.db` (doc §6.4 quater). Même principe que
//! `private_video_repository` (Étape 6b-i), avec en plus la gestion de la
//! couverture d'album et des vignettes chiffrées.
use rusqlite::{Connection, OptionalExtension};
use serde::Serialize;
use std::collections::HashSet;

#[derive(Debug, Clone, Serialize)]
pub struct PrivateImageFolderRecord {
    pub id: i64,
    pub private_library_id: i64,
    pub path: String,
    pub cover_file_id: Option<i64>,
    pub added_at: String,
}

/// Sans `thumbnail_blob` volontairement : la vignette elle-même se
/// récupère via une commande dédiée (`get_thumbnail`), jamais incluse dans
/// un listing — envoyer des dizaines de vignettes dans une seule réponse
/// JSON serait inutilement coûteux (doc §6.4 quater).
#[derive(Debug, Clone, Serialize)]
pub struct PrivateImageFileRecord {
    pub id: i64,
    pub private_library_id: i64,
    pub folder_id: i64,
    pub path: String,
    pub file_name: String,
    pub size_bytes: i64,
    pub modified_at: String,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub taken_at: Option<String>,
    pub camera_model: Option<String>,
    pub has_thumbnail: bool,
    pub is_available: bool,
    pub discovered_at: String,
}

/// Données extraites par `services::private_image_scanner` pour un
/// fichier — ce module ne connaît que le schéma SQL, jamais le décodage
/// d'image ni l'EXIF.
pub struct NewImageFileData<'a> {
    pub path: &'a str,
    pub file_name: &'a str,
    pub size_bytes: i64,
    pub modified_at: &'a str,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub taken_at: Option<&'a str>,
    pub camera_model: Option<&'a str>,
    pub thumbnail: Option<&'a [u8]>,
    pub perceptual_hash: Option<&'a str>,
    pub file_hash: Option<&'a str>,
}

const FILE_COLUMNS: &str = "id, private_library_id, folder_id, path, file_name, size_bytes, \
    modified_at, width, height, taken_at, camera_model, thumbnail_blob IS NOT NULL, is_available, discovered_at";

fn map_file_row(row: &rusqlite::Row) -> rusqlite::Result<PrivateImageFileRecord> {
    Ok(PrivateImageFileRecord {
        id: row.get(0)?,
        private_library_id: row.get(1)?,
        folder_id: row.get(2)?,
        path: row.get(3)?,
        file_name: row.get(4)?,
        size_bytes: row.get(5)?,
        modified_at: row.get(6)?,
        width: row.get(7)?,
        height: row.get(8)?,
        taken_at: row.get(9)?,
        camera_model: row.get(10)?,
        has_thumbnail: row.get(11)?,
        is_available: row.get(12)?,
        discovered_at: row.get(13)?,
    })
}

// --- Dossiers (albums) -------------------------------------------------------

pub fn create_folder(conn: &Connection, private_library_id: i64, path: &str) -> rusqlite::Result<i64> {
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO private_image_folders (private_library_id, path, added_at) VALUES (?1, ?2, ?3)",
        rusqlite::params![private_library_id, path, now],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn list_folders_by_library(
    conn: &Connection,
    private_library_id: i64,
) -> rusqlite::Result<Vec<PrivateImageFolderRecord>> {
    let mut stmt = conn.prepare(
        "SELECT id, private_library_id, path, cover_file_id, added_at
         FROM private_image_folders WHERE private_library_id = ?1 ORDER BY id",
    )?;
    let rows = stmt.query_map(rusqlite::params![private_library_id], |row| {
        Ok(PrivateImageFolderRecord {
            id: row.get(0)?,
            private_library_id: row.get(1)?,
            path: row.get(2)?,
            cover_file_id: row.get(3)?,
            added_at: row.get(4)?,
        })
    })?;
    rows.collect()
}

pub fn delete_folder(conn: &Connection, folder_id: i64) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM private_image_folders WHERE id = ?1", rusqlite::params![folder_id])?;
    Ok(())
}

/// `None` réinitialise à la couverture par défaut (première photo). Ne
/// vérifie pas ici que `file_id` appartient bien à `folder_id` — c'est la
/// responsabilité de l'appelant (`domain::private_image::set_album_cover`),
/// cette fonction reste un pur accès SQL.
pub fn set_cover(conn: &Connection, folder_id: i64, file_id: Option<i64>) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE private_image_folders SET cover_file_id = ?1 WHERE id = ?2",
        rusqlite::params![file_id, folder_id],
    )?;
    Ok(())
}

/// Vignette de couverture d'un album : celle choisie explicitement
/// (`cover_file_id`) si elle existe, sinon celle de la première photo par
/// nom de fichier (doc §6.4 quater, "par défaut : première image").
pub fn get_cover_thumbnail(conn: &Connection, folder_id: i64) -> rusqlite::Result<Option<Vec<u8>>> {
    let result: Option<Option<Vec<u8>>> = conn
        .query_row(
            "SELECT f.thumbnail_blob
             FROM private_image_folders AS d
             LEFT JOIN private_image_files AS f
                 ON f.id = COALESCE(
                     d.cover_file_id,
                     (SELECT id FROM private_image_files
                      WHERE folder_id = d.id
                      ORDER BY file_name COLLATE NOCASE ASC LIMIT 1)
                 )
             WHERE d.id = ?1",
            rusqlite::params![folder_id],
            |row| row.get::<_, Option<Vec<u8>>>(0),
        )
        .optional()?;

    Ok(result.flatten())
}

// --- Fichiers ------------------------------------------------------------------

pub fn list_files_by_folder(
    conn: &Connection,
    folder_id: i64,
) -> rusqlite::Result<Vec<PrivateImageFileRecord>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {FILE_COLUMNS} FROM private_image_files WHERE folder_id = ?1 ORDER BY file_name COLLATE NOCASE"
    ))?;
    let rows = stmt.query_map(rusqlite::params![folder_id], map_file_row)?;
    rows.collect()
}

pub fn get_file(conn: &Connection, file_id: i64) -> rusqlite::Result<Option<PrivateImageFileRecord>> {
    conn.query_row(
        &format!("SELECT {FILE_COLUMNS} FROM private_image_files WHERE id = ?1"),
        rusqlite::params![file_id],
        map_file_row,
    )
    .optional()
}

pub fn get_thumbnail(conn: &Connection, file_id: i64) -> rusqlite::Result<Option<Vec<u8>>> {
    let result: Option<Option<Vec<u8>>> = conn
        .query_row(
            "SELECT thumbnail_blob FROM private_image_files WHERE id = ?1",
            rusqlite::params![file_id],
            |row| row.get::<_, Option<Vec<u8>>>(0),
        )
        .optional()?;

    Ok(result.flatten())
}

/// Insère un fichier nouvellement découvert, ou met à jour ses métadonnées
/// et sa vignette s'il existait déjà. Renvoie `true` si le fichier était
/// nouveau — même contrat que `private_video_repository::upsert_file`.
pub fn upsert_file(
    conn: &Connection,
    private_library_id: i64,
    folder_id: i64,
    data: &NewImageFileData,
) -> rusqlite::Result<bool> {
    let now = chrono::Utc::now().to_rfc3339();

    let existing_id: Option<i64> = conn
        .query_row(
            "SELECT id FROM private_image_files WHERE path = ?1",
            rusqlite::params![data.path],
            |row| row.get(0),
        )
        .optional()?;

    match existing_id {
        Some(id) => {
            conn.execute(
                "UPDATE private_image_files
                 SET size_bytes = ?1, modified_at = ?2, width = ?3, height = ?4,
                     taken_at = ?5, camera_model = ?6, thumbnail_blob = ?7,
                     perceptual_hash = ?8, file_hash = ?9, is_available = 1, updated_at = ?10
                 WHERE id = ?11",
                rusqlite::params![
                    data.size_bytes,
                    data.modified_at,
                    data.width,
                    data.height,
                    data.taken_at,
                    data.camera_model,
                    data.thumbnail,
                    data.perceptual_hash,
                    data.file_hash,
                    now,
                    id
                ],
            )?;
            Ok(false)
        }
        None => {
            conn.execute(
                "INSERT INTO private_image_files
                    (private_library_id, folder_id, path, file_name, size_bytes, modified_at,
                     width, height, taken_at, camera_model, thumbnail_blob, is_available,
                     discovered_at, updated_at, perceptual_hash, file_hash)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 1, ?12, ?12, ?13, ?14)",
                rusqlite::params![
                    private_library_id,
                    folder_id,
                    data.path,
                    data.file_name,
                    data.size_bytes,
                    data.modified_at,
                    data.width,
                    data.height,
                    data.taken_at,
                    data.camera_model,
                    data.thumbnail,
                    now,
                    data.perceptual_hash,
                    data.file_hash
                ],
            )?;
            Ok(true)
        }
    }
}

/// Supprime les fichiers auparavant connus dans ce dossier mais absents du
/// dernier parcours. Renvoie le nombre de fichiers supprimés.
pub fn remove_missing(
    conn: &Connection,
    folder_id: i64,
    seen_paths: &HashSet<String>,
) -> rusqlite::Result<u64> {
    let mut stmt = conn.prepare("SELECT id, path FROM private_image_files WHERE folder_id = ?1")?;
    let known: Vec<(i64, String)> = stmt
        .query_map(rusqlite::params![folder_id], |row| Ok((row.get(0)?, row.get(1)?)))?
        .collect::<rusqlite::Result<_>>()?;

    let mut removed = 0u64;
    for (id, path) in known {
        if !seen_paths.contains(&path) {
            conn.execute("DELETE FROM private_image_files WHERE id = ?1", rusqlite::params![id])?;
            removed += 1;
        }
    }
    Ok(removed)
}

pub fn mark_folder_unavailable(conn: &Connection, folder_id: i64) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE private_image_files SET is_available = 0 WHERE folder_id = ?1",
        rusqlite::params![folder_id],
    )?;
    Ok(())
}

/// Renomme un album : met à jour le nom du dossier sur disque puis
/// reflète le nouveau chemin dans `private_image_folders` et tous les
/// `private_image_files` qu'il contient. Renvoie le nouveau chemin.
/// Échoue si `new_name` est invalide, si le dossier source n'existe
/// plus, ou si un dossier homonyme existe déjà au même niveau.
pub fn rename_folder(
    conn: &Connection,
    folder_id: i64,
    new_name: &str,
) -> rusqlite::Result<String> {
    // 1. Validation du nouveau nom (simple nom de dossier, pas un chemin).
    let trimmed = new_name.trim();
    if trimmed.is_empty()
        || trimmed.contains('/')
        || trimmed.contains('\\') // Corrigé : '\' était une erreur de syntaxe
        || trimmed == "."         // Corrigé : ". " n'était pas standard
        || trimmed == ".."
    {
        return Err(rusqlite::Error::InvalidParameterName(
            "Nom d'album invalide.".to_string(),
        ));
    }
    
    // 2. Lecture de l'ancien chemin.
    let old_path = get_folder_path(conn, folder_id)?
        .ok_or(rusqlite::Error::QueryReturnedNoRows)?;
    
    // 3. Construction du nouveau chemin (même parent).
    let old_pb = std::path::PathBuf::from(&old_path);
    let Some(parent) = old_pb.parent().map(|p| p.to_path_buf()) else {
        return Err(rusqlite::Error::InvalidParameterName(
            "Chemin racine invalide.".to_string(),
        ));
    };
    let new_pb = parent.join(trimmed);
    let new_path = new_pb.to_string_lossy().to_string();
    if new_path == old_path {
        return Ok(new_path); // rien à faire
    }
    
    // 4. Vérifications disque.
    if !old_pb.exists() {
        return Err(rusqlite::Error::InvalidParameterName(
            "Le dossier source n'existe plus sur le disque.".to_string(),
        ));
    }
    if new_pb.exists() {
        return Err(rusqlite::Error::InvalidParameterName(
            "Un dossier homonyme existe déjà à cet emplacement.".to_string(),
        ));
    }
    
    // 5. Renommage physique.
    std::fs::rename(&old_pb, &new_pb).map_err(|e| {
        rusqlite::Error::InvalidParameterName(format!(
            "Impossible de renommer le dossier sur le disque : {e}"
        ))
    })?;
    
    // 6. Mise à jour du folder.
    update_folder_path(conn, folder_id, &new_path)?;
    
    // 7. Mise à jour en masse des fichiers contenus : leur chemin absolu
    //    commence par l'ancien chemin du dossier. Le séparateur n'est jamais
    //    supposé : sous Windows `WalkDir` produit des `\`, alors qu'un dossier
    //    peut avoir été enregistré avec des `/` (voir `rebase_path`).
    let mut stmt = conn.prepare(
        "SELECT id, path FROM private_image_files WHERE folder_id = ?1",
    )?;
    let rows: Vec<(i64, String)> = stmt
        .query_map([folder_id], |row| Ok((row.get(0)?, row.get(1)?)))?
        .filter_map(|r| r.ok())
        .collect();

    for (file_id, file_path) in rows {
        match rebase_path(&file_path, &old_path, &new_path) {
            Some(new_file_path) => {
                conn.execute(
                    "UPDATE private_image_files SET path = ?1 WHERE id = ?2",
                    rusqlite::params![new_file_path, file_id],
                )?;
            }
            // Ne devrait pas arriver (les fichiers d'un dossier vivent sous
            // son chemin) : on le signale au lieu de l'ignorer en silence.
            None => log::warn!(
                "[private_image] rename_folder : le fichier #{file_id} ({file_path}) n'est pas sous l'ancien dossier ({old_path}), chemin laissé inchangé"
            ),
        }
    }
    Ok(new_path)
}

/// Recalcule le chemin d'un fichier après le renommage de son dossier :
/// `old_folder` est remplacé par `new_folder` en tête de `file_path`.
///
/// - Accepte `/` et `\` indifféremment, y compris mélangés : le reste du
///   chemin (séparateur compris) est conservé tel quel, seul le préfixe change.
/// - Ne remplace le préfixe que sur une frontière de composant : `…\Vacances`
///   ne correspond pas à `…\Vacances 2\a.jpg`.
/// - Comparaison exacte sur du texte UTF-8 (`Été 2024` n'a rien de particulier).
///
/// Renvoie `None` si `file_path` n'est pas sous `old_folder`.
fn rebase_path(file_path: &str, old_folder: &str, new_folder: &str) -> Option<String> {
    let is_sep = |c: char| c == '/' || c == '\\';
    let old_base = old_folder.trim_end_matches(is_sep);
    let new_base = new_folder.trim_end_matches(is_sep);
    let rest = file_path.strip_prefix(old_base)?;
    if !rest.starts_with(is_sep) {
        return None;
    }
    Some(format!("{new_base}{rest}"))
}
pub fn get_folder_path(conn: &Connection, folder_id: i64) -> rusqlite::Result<Option<String>> {
    let mut stmt = conn.prepare("SELECT path FROM private_image_folders WHERE id = ?1")?;
    let mut rows = stmt.query_map([folder_id], |row| row.get::<_, String>(0))?;
    match rows.next() {
        Some(Ok(path)) => Ok(Some(path)),
        Some(Err(e)) => Err(e),
        None => Ok(None),
    }
}

pub fn update_folder_path(conn: &Connection, folder_id: i64, new_path: &str) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE private_image_folders SET path = ?1 WHERE id = ?2",
        rusqlite::params![new_path, folder_id],
    )?;
    Ok(())
}
#[cfg(test)]
mod rename_folder_tests {
    use super::*;

    /// Schéma minimal : uniquement les colonnes que `rename_folder` lit ou écrit.
    fn stub_connection() -> Connection {
        let conn = Connection::open_in_memory().expect("base mémoire");
        conn.execute_batch(
            "CREATE TABLE private_image_folders (id INTEGER PRIMARY KEY, path TEXT NOT NULL);
             CREATE TABLE private_image_files (id INTEGER PRIMARY KEY, folder_id INTEGER NOT NULL, path TEXT NOT NULL);",
        )
        .expect("schéma de test");
        conn
    }

    fn unique_temp_dir(tag: &str) -> std::path::PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let dir = std::env::temp_dir().join(format!("aethervault-{tag}-{}-{nanos}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("dossier temporaire");
        dir
    }

    #[test]
    fn renames_on_disk_then_updates_folder_and_file_paths() {
        let root = unique_temp_dir("rename");
        let old_dir = root.join("Vacances");
        std::fs::create_dir_all(&old_dir).unwrap();
        let old_path = old_dir.to_string_lossy().to_string();
        let sep = std::path::MAIN_SEPARATOR;

        let conn = stub_connection();
        conn.execute("INSERT INTO private_image_folders (id, path) VALUES (1, ?1)", [&old_path]).unwrap();
        conn.execute(
            "INSERT INTO private_image_files (id, folder_id, path) VALUES (10, 1, ?1)",
            [format!("{old_path}{sep}a.jpg")],
        )
        .unwrap();

        let new_path = rename_folder(&conn, 1, "  Été 2024  ").expect("renommage");

        assert_eq!(new_path, root.join("Été 2024").to_string_lossy().to_string());
        assert!(root.join("Été 2024").exists());
        assert!(!old_dir.exists());
        assert_eq!(get_folder_path(&conn, 1).unwrap().as_deref(), Some(new_path.as_str()));
        let file_path: String = conn
            .query_row("SELECT path FROM private_image_files WHERE id = 10", [], |r| r.get(0))
            .unwrap();
        assert_eq!(file_path, format!("{new_path}{sep}a.jpg"));

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn unknown_folder_still_reports_query_returned_no_rows() {
        let conn = stub_connection();
        let err = rename_folder(&conn, 999, "Nouveau").unwrap_err();
        assert!(matches!(err, rusqlite::Error::QueryReturnedNoRows), "erreur inattendue : {err:?}");
    }

    #[test]
    fn rejects_names_that_are_paths() {
        let conn = stub_connection();
        for bad in ["", "   ", ".", "..", "a/b", "a\\b"] {
            let err = rename_folder(&conn, 1, bad).unwrap_err();
            assert!(matches!(err, rusqlite::Error::InvalidParameterName(_)), "nom accepté à tort : {bad:?}");
        }
    }

    /// Cas réel sous Windows : le dossier est enregistré avec un séparateur
    /// (ex. `C:/Photos/Vacances`, saisi à la main) et les fichiers avec un autre
    /// (`WalkDir` produit des `\`). Les enfants doivent suivre le dossier quel que
    /// soit le séparateur, et conserver chacun le leur après le nouveau préfixe.
    /// Ce test ne dépend pas de la plateforme.
    #[test]
    fn updates_children_whatever_separator_they_were_stored_with() {
        let root = unique_temp_dir("rename-sep");
        let old_dir = root.join("Vacances");
        std::fs::create_dir_all(&old_dir).unwrap();
        let old_path = old_dir.to_string_lossy().to_string();

        let conn = stub_connection();
        conn.execute("INSERT INTO private_image_folders (id, path) VALUES (1, ?1)", [&old_path]).unwrap();
        let children = [
            (10, format!("{old_path}\\a.jpg")),
            (11, format!("{old_path}/sub/b.jpg")),
            (12, format!("{old_path}\\sub\\c.jpg")),
        ];
        for (id, path) in &children {
            conn.execute(
                "INSERT INTO private_image_files (id, folder_id, path) VALUES (?1, 1, ?2)",
                rusqlite::params![id, path],
            )
            .unwrap();
        }

        let new_path = rename_folder(&conn, 1, "Été 2024").expect("renommage");

        for (id, old_child) in &children {
            let expected = format!("{new_path}{}", &old_child[old_path.len()..]);
            let stored: String = conn
                .query_row("SELECT path FROM private_image_files WHERE id = ?1", [id], |r| r.get(0))
                .unwrap();
            assert_eq!(stored, expected, "fichier {id} non réaligné sur le nouveau dossier");
        }

        let _ = std::fs::remove_dir_all(&root);
    }
}

#[cfg(test)]
mod rebase_path_tests {
    use super::rebase_path;

    #[test]
    fn windows_paths_with_unicode_folder_name() {
        assert_eq!(
            rebase_path(
                r"C:\Users\spect\Pictures\Vacances\a.jpg",
                r"C:\Users\spect\Pictures\Vacances",
                r"C:\Users\spect\Pictures\Été 2024",
            )
            .as_deref(),
            Some(r"C:\Users\spect\Pictures\Été 2024\a.jpg")
        );
    }

    #[test]
    fn nested_files_and_unix_paths_keep_their_own_remainder() {
        assert_eq!(
            rebase_path("/home/u/Photos/Vacances/sub/b.jpg", "/home/u/Photos/Vacances", "/home/u/Photos/Été 2024").as_deref(),
            Some("/home/u/Photos/Été 2024/sub/b.jpg")
        );
        assert_eq!(
            rebase_path(r"C:\p\Vacances\sub\c.jpg", r"C:\p\Vacances", r"C:\p\été").as_deref(),
            Some(r"C:\p\été\sub\c.jpg")
        );
    }

    #[test]
    fn mixed_separators_between_folder_and_file() {
        // Dossier enregistré avec `/`, fichier produit avec `\` (cas Windows).
        assert_eq!(
            rebase_path(r"C:/p/Vacances\a.jpg", "C:/p/Vacances", r"C:/p\Été 2024").as_deref(),
            Some(r"C:/p\Été 2024\a.jpg")
        );
        // Et inversement.
        assert_eq!(
            rebase_path("C:\\p\\Vacances/a.jpg", r"C:\p\Vacances", r"C:\p\Été 2024").as_deref(),
            Some("C:\\p\\Été 2024/a.jpg")
        );
    }

    #[test]
    fn trailing_separators_on_folder_paths_are_ignored() {
        assert_eq!(
            rebase_path(r"C:\p\Vacances\a.jpg", "C:\\p\\Vacances\\", "C:\\p\\Été 2024\\").as_deref(),
            Some(r"C:\p\Été 2024\a.jpg")
        );
    }

    #[test]
    fn only_matches_on_a_path_component_boundary() {
        // Dossier voisin partageant le même début de nom.
        assert_eq!(rebase_path(r"C:\p\Vacances 2\a.jpg", r"C:\p\Vacances", r"C:\p\Été"), None);
        assert_eq!(rebase_path("/p/Vacances2/a.jpg", "/p/Vacances", "/p/Été"), None);
    }

    #[test]
    fn unrelated_path_or_folder_itself_is_not_rebased() {
        assert_eq!(rebase_path(r"D:\Autre\a.jpg", r"C:\p\Vacances", r"C:\p\Été"), None);
        assert_eq!(rebase_path(r"C:\p\Vacances", r"C:\p\Vacances", r"C:\p\Été"), None);
    }
}
