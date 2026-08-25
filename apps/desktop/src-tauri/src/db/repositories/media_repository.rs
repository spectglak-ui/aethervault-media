//! Accès SQL à la table `media_files`.
//!
//! Porte la logique de distinction "réellement supprimé" vs "indisponible"
//! au niveau des requêtes (voir `remove_missing` et `mark_folder_unavailable`),
//! utilisée par `services::scanner`.

use rusqlite::{Connection, OptionalExtension};
use serde::Serialize;
use std::collections::HashSet;

#[derive(Debug, Clone, Serialize)]
pub struct MediaFileRecord {
    pub id: i64,
    pub library_id: i64,
    pub folder_id: i64,
    pub path: String,
    pub file_name: String,
    pub size_bytes: i64,
    pub modified_at: String,
    pub is_available: bool,
    pub discovered_at: String,
    /// Rattachement au modèle de contenu (Étape 4, doc §6.3) — exclusif,
    /// jamais les deux à la fois : `title_id` pour un Titre de nature
    /// `"movie"`, `episode_id` pour un épisode d'un Titre `"series"`. Les
    /// deux restent `None` tant que le Metadata Service n'a pas traité ce
    /// fichier (ou si l'utilisateur ne l'a jamais lancé) — un fichier non
    /// apparié reste consultable tel quel, comme avant l'Étape 4.
    pub title_id: Option<i64>,
    pub episode_id: Option<i64>,
}

pub fn list_by_library(conn: &Connection, library_id: i64) -> rusqlite::Result<Vec<MediaFileRecord>> {
    let mut stmt = conn.prepare(
        "SELECT id, library_id, folder_id, path, file_name, size_bytes, modified_at, is_available, discovered_at, title_id, episode_id
         FROM media_files WHERE library_id = ?1 ORDER BY file_name COLLATE NOCASE",
    )?;

    let rows = stmt.query_map(rusqlite::params![library_id], |row| {
        Ok(MediaFileRecord {
            id: row.get(0)?,
            library_id: row.get(1)?,
            folder_id: row.get(2)?,
            path: row.get(3)?,
            file_name: row.get(4)?,
            size_bytes: row.get(5)?,
            modified_at: row.get(6)?,
            is_available: row.get(7)?,
            discovered_at: row.get(8)?,
            title_id: row.get(9)?,
            episode_id: row.get(10)?,
        })
    })?;

    rows.collect()
}

/// Fichiers d'une bibliothèque pas encore rattachés à un Titre ni à un
/// Épisode — c'est la file de travail du Metadata Service
/// (`services::metadata::match_library`), appelée après chaque scan.
/// Requête volontairement idempotente-friendly : rejouer le matching ne
/// retraite jamais un fichier déjà apparié.
pub fn get(conn: &Connection, id: i64) -> rusqlite::Result<Option<MediaFileRecord>> {
    conn.query_row(
        "SELECT id, library_id, folder_id, path, file_name, size_bytes, modified_at, is_available, discovered_at, title_id, episode_id
         FROM media_files WHERE id = ?1",
        rusqlite::params![id],
        |row| {
            Ok(MediaFileRecord {
                id: row.get(0)?,
                library_id: row.get(1)?,
                folder_id: row.get(2)?,
                path: row.get(3)?,
                file_name: row.get(4)?,
                size_bytes: row.get(5)?,
                modified_at: row.get(6)?,
                is_available: row.get(7)?,
                discovered_at: row.get(8)?,
                title_id: row.get(9)?,
                episode_id: row.get(10)?,
            })
        },
    )
    .optional()
}

/// Identifiants distincts de Titres référencés par les Médias d'une
/// bibliothèque — collectés par `domain::library::delete_library` (Étape
/// 5) *avant* de supprimer la bibliothèque, pendant que ces liens existent
/// encore, pour savoir ensuite lesquels vérifier via
/// `title_repository::orphaned`.
///
/// Un Titre est atteint de deux façons distinctes selon sa nature (§6.3) :
/// - Film : `media_files.title_id` est renseigné directement.
/// - Série/Anime/Documentaire-série : `media_files.title_id` n'est JAMAIS
///   renseigné (voir `services::metadata::mod::match_library`, qui ne relie
///   ce type de fichier qu'à un Épisode via `link_to_episode`) ; le Titre
///   n'est atteignable qu'indirectement via `episodes.title_id`.
///
/// Correctif (erratum Étape 5) : la version précédente ne couvrait que le
/// premier cas, si bien que la suppression d'une bibliothèque Anime/Séries
/// ne proposait jamais ses Titres au nettoyage des orphelins — ceux-ci (et
/// leurs Saisons) restaient visibles indéfiniment après suppression de la
/// bibliothèque, alors même que leurs Épisodes avaient bien été supprimés.
pub fn distinct_title_ids(conn: &Connection, library_id: i64) -> rusqlite::Result<Vec<i64>> {
    let mut stmt = conn.prepare(
        "SELECT DISTINCT title_id FROM media_files WHERE library_id = ?1 AND title_id IS NOT NULL
         UNION
         SELECT DISTINCT e.title_id FROM episodes e
         INNER JOIN media_files m ON m.episode_id = e.id
         WHERE m.library_id = ?1",
    )?;
    let rows = stmt.query_map(rusqlite::params![library_id], |row| row.get(0))?;
    rows.collect()
}

/// Équivalent de `distinct_title_ids` pour les Épisodes.
pub fn distinct_episode_ids(conn: &Connection, library_id: i64) -> rusqlite::Result<Vec<i64>> {
    let mut stmt = conn.prepare(
        "SELECT DISTINCT episode_id FROM media_files WHERE library_id = ?1 AND episode_id IS NOT NULL",
    )?;
    let rows = stmt.query_map(rusqlite::params![library_id], |row| row.get(0))?;
    rows.collect()
}

pub fn list_unmatched(conn: &Connection, library_id: i64) -> rusqlite::Result<Vec<MediaFileRecord>> {
    let mut stmt = conn.prepare(
        "SELECT id, library_id, folder_id, path, file_name, size_bytes, modified_at, is_available, discovered_at, title_id, episode_id
         FROM media_files
         WHERE library_id = ?1 AND title_id IS NULL AND episode_id IS NULL
         ORDER BY file_name COLLATE NOCASE",
    )?;

    let rows = stmt.query_map(rusqlite::params![library_id], |row| {
        Ok(MediaFileRecord {
            id: row.get(0)?,
            library_id: row.get(1)?,
            folder_id: row.get(2)?,
            path: row.get(3)?,
            file_name: row.get(4)?,
            size_bytes: row.get(5)?,
            modified_at: row.get(6)?,
            is_available: row.get(7)?,
            discovered_at: row.get(8)?,
            title_id: row.get(9)?,
            episode_id: row.get(10)?,
        })
    })?;

    rows.collect()
}

/// Rattache un fichier à un Titre de nature `"movie"`. Exclusif avec
/// `link_to_episode` par construction : un fichier de film n'a jamais
/// d'épisode.
pub fn link_to_title(conn: &Connection, media_file_id: i64, title_id: i64) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE media_files SET title_id = ?1, episode_id = NULL WHERE id = ?2",
        rusqlite::params![title_id, media_file_id],
    )?;
    Ok(())
}

/// Rattache un fichier à un Épisode d'un Titre de nature `"series"`.
pub fn link_to_episode(conn: &Connection, media_file_id: i64, episode_id: i64) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE media_files SET episode_id = ?1, title_id = NULL WHERE id = ?2",
        rusqlite::params![episode_id, media_file_id],
    )?;
    Ok(())
}

/// Le Média rattaché à un Titre de nature `"movie"` (relation 1-1 en
/// pratique aujourd'hui) — utilisé par la page Titre pour retrouver le
/// fichier à lire (doc §6.3 : "bouton Lecture").
pub fn find_by_title(conn: &Connection, title_id: i64) -> rusqlite::Result<Option<MediaFileRecord>> {
    conn.query_row(
        "SELECT id, library_id, folder_id, path, file_name, size_bytes, modified_at, is_available, discovered_at, title_id, episode_id
         FROM media_files WHERE title_id = ?1 LIMIT 1",
        rusqlite::params![title_id],
        |row| {
            Ok(MediaFileRecord {
                id: row.get(0)?,
                library_id: row.get(1)?,
                folder_id: row.get(2)?,
                path: row.get(3)?,
                file_name: row.get(4)?,
                size_bytes: row.get(5)?,
                modified_at: row.get(6)?,
                is_available: row.get(7)?,
                discovered_at: row.get(8)?,
                title_id: row.get(9)?,
                episode_id: row.get(10)?,
            })
        },
    )
    .optional()
}

/// Le Média rattaché à un Épisode donné — utilisé par la page Épisode pour
/// retrouver le fichier à lire.
pub fn find_by_episode(conn: &Connection, episode_id: i64) -> rusqlite::Result<Option<MediaFileRecord>> {
    conn.query_row(
        "SELECT id, library_id, folder_id, path, file_name, size_bytes, modified_at, is_available, discovered_at, title_id, episode_id
         FROM media_files WHERE episode_id = ?1 LIMIT 1",
        rusqlite::params![episode_id],
        |row| {
            Ok(MediaFileRecord {
                id: row.get(0)?,
                library_id: row.get(1)?,
                folder_id: row.get(2)?,
                path: row.get(3)?,
                file_name: row.get(4)?,
                size_bytes: row.get(5)?,
                modified_at: row.get(6)?,
                is_available: row.get(7)?,
                discovered_at: row.get(8)?,
                title_id: row.get(9)?,
                episode_id: row.get(10)?,
            })
        },
    )
    .optional()
}

/// Insère un fichier nouvellement découvert, ou met à jour ses métadonnées
/// s'il existait déjà (retrouvé après un débranchement, ou simplement
/// modifié). Renvoie `true` si le fichier était nouveau.
pub fn upsert(
    conn: &Connection,
    library_id: i64,
    folder_id: i64,
    path: &str,
    file_name: &str,
    size_bytes: i64,
    modified_at: &str,
) -> rusqlite::Result<bool> {
    let now = chrono::Utc::now().to_rfc3339();

    let existing_id: Option<i64> = conn
        .query_row(
            "SELECT id FROM media_files WHERE path = ?1",
            rusqlite::params![path],
            |row| row.get(0),
        )
        .optional()?;

    match existing_id {
        Some(id) => {
            conn.execute(
                "UPDATE media_files
                 SET size_bytes = ?1, modified_at = ?2, is_available = 1, updated_at = ?3
                 WHERE id = ?4",
                rusqlite::params![size_bytes, modified_at, now, id],
            )?;
            Ok(false)
        }
        None => {
            conn.execute(
                "INSERT INTO media_files
                    (library_id, folder_id, path, file_name, size_bytes, modified_at, is_available, discovered_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, ?7, ?7)",
                rusqlite::params![library_id, folder_id, path, file_name, size_bytes, modified_at, now],
            )?;
            Ok(true)
        }
    }
}

/// Supprime les fichiers auparavant connus dans ce dossier mais absents du
/// dernier parcours — le dossier étant, lui, accessible, ils sont donc
/// réellement supprimés du disque (pas juste indisponibles). Renvoie le
/// nombre de fichiers supprimés.
pub fn remove_missing(
    conn: &Connection,
    folder_id: i64,
    seen_paths: &HashSet<String>,
) -> rusqlite::Result<u64> {
    let mut stmt = conn.prepare("SELECT id, path FROM media_files WHERE folder_id = ?1")?;
    let known: Vec<(i64, String)> = stmt
        .query_map(rusqlite::params![folder_id], |row| {
            Ok((row.get(0)?, row.get(1)?))
        })?
        .collect::<rusqlite::Result<_>>()?;

    let mut removed = 0u64;
    for (id, path) in known {
        if !seen_paths.contains(&path) {
            conn.execute(
                "DELETE FROM media_files WHERE id = ?1",
                rusqlite::params![id],
            )?;
            removed += 1;
        }
    }
    Ok(removed)
}

/// Marque tous les fichiers d'un dossier comme indisponibles sans les
/// supprimer — cas du disque externe débranché.
pub fn mark_folder_unavailable(conn: &Connection, folder_id: i64) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE media_files SET is_available = 0 WHERE folder_id = ?1",
        rusqlite::params![folder_id],
    )?;
    Ok(())
}

/// Supprime un unique fichier par son chemin exact — utilisé par le
/// Filesystem Watcher pour une suppression réelle et ciblée (le dossier
/// parent restant, lui, accessible), sans toucher au reste du dossier.
pub fn remove_by_path(conn: &Connection, path: &str) -> rusqlite::Result<()> {
    conn.execute(
        "DELETE FROM media_files WHERE path = ?1",
        rusqlite::params![path],
    )?;
    Ok(())
}
