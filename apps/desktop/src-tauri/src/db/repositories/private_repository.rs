//! Accès SQL à la table `private_libraries` (doc §6.4).
//!
//! Fondation posée à l'Étape 4 dans `aethervault.db`, sur le même principe
//! que `profile_repository` depuis la migration 0001 : le schéma existait,
//! mais aucune commande Tauri n'appelait ce module. Depuis l'Étape 6a, la
//! table vit dans `vault.db` (chiffrée, voir `security::vault`) — ce
//! module ne change quasiment pas pour autant : il ne connaît qu'une
//! `rusqlite::Connection`, sans savoir si elle vient du pool principal ou
//! du pool du coffre. C'est `domain::privacy` qui garantit que ces
//! fonctions ne sont jamais appelées avec une connexion vers
//! `aethervault.db`, et jamais avant vérification du déverrouillage.

use rusqlite::Connection;
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct PrivateLibraryRecord {
    pub id: i64,
    pub kind: String,
    pub name: String,
    pub icon: Option<String>,
    pub sort_order: i64,
}

pub fn list_all(conn: &Connection) -> rusqlite::Result<Vec<PrivateLibraryRecord>> {
    let mut stmt = conn.prepare(
        "SELECT id, kind, name, icon, sort_order FROM private_libraries
         ORDER BY kind ASC, sort_order ASC, id ASC",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(PrivateLibraryRecord {
            id: row.get(0)?,
            kind: row.get(1)?,
            name: row.get(2)?,
            icon: row.get(3)?,
            sort_order: row.get(4)?,
        })
    })?;
    rows.collect()
}

/// Ajoutée à l'Étape 6b-i : nécessaire pour vérifier le `kind` d'une
/// bibliothèque privée avant d'y associer un dossier vidéo (impossible
/// d'associer un dossier vidéo à une bibliothèque de type "images", et
/// inversement).
pub fn get_by_id(conn: &Connection, id: i64) -> rusqlite::Result<Option<PrivateLibraryRecord>> {
    use rusqlite::OptionalExtension;
    conn.query_row(
        "SELECT id, kind, name, icon, sort_order FROM private_libraries WHERE id = ?1",
        rusqlite::params![id],
        |row| {
            Ok(PrivateLibraryRecord {
                id: row.get(0)?,
                kind: row.get(1)?,
                name: row.get(2)?,
                icon: row.get(3)?,
                sort_order: row.get(4)?,
            })
        },
    )
    .optional()
}

pub fn create(conn: &Connection, kind: &str, name: &str, icon: Option<&str>) -> rusqlite::Result<i64> {
    let now = chrono::Utc::now().to_rfc3339();
    let next_sort_order: i64 = conn.query_row(
        "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM private_libraries WHERE kind = ?1",
        rusqlite::params![kind],
        |row| row.get(0),
    )?;

    conn.execute(
        "INSERT INTO private_libraries (kind, name, icon, sort_order, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
        rusqlite::params![kind, name, icon, next_sort_order, now],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn rename(conn: &Connection, id: i64, name: &str) -> rusqlite::Result<()> {
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE private_libraries SET name = ?1, updated_at = ?2 WHERE id = ?3",
        rusqlite::params![name, now, id],
    )?;
    Ok(())
}

/// Ne touche jamais au disque : une bibliothèque privée de l'Étape 6a est un
/// simple conteneur, sans dossier ni fichier associé (voir Étape 6b).
pub fn delete(conn: &Connection, id: i64) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM private_libraries WHERE id = ?1", rusqlite::params![id])?;
    Ok(())
}
