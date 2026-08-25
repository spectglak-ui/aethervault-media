//! Accès SQL à la table `titles` et à ses relations (genres, studios,
//! casting) — Étape 4, doc §6.3.
//!
//! `kind` distingue deux natures (`"movie"` / `"series"`) au sein d'un seul
//! modèle plutôt que deux tables séparées : voir la justification dans la
//! migration 0004 et dans la doc §6.3 (un documentaire unitaire est un
//! Titre `"movie"` comme un Film, un documentaire à épisodes un Titre
//! `"series"` comme une Série — aucun troisième modèle).

use super::custom_image_repository;
use rusqlite::{Connection, OptionalExtension};
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct TitleRecord {
    pub id: i64,
    pub category_id: i64,
    pub kind: String,
    pub name: String,
    pub description: Option<String>,
    pub year: Option<i64>,
    pub duration_seconds: Option<i64>,
    pub rating: Option<f64>,
    /// Affiche/bannière *automatiques* (Metadata Service) uniquement —
    /// la personnalisation par l'utilisateur vit désormais dans
    /// `custom_images` (Étape 5, doc §6.6), interrogée séparément par
    /// `domain::title` pour composer la valeur *effective*.
    pub poster_path: Option<String>,
    pub banner_path: Option<String>,
    pub metadata_source: String,
}

const COLUMNS: &str = "id, category_id, kind, name, description, year, duration_seconds, rating,
    poster_path, banner_path, metadata_source";

fn map_row(row: &rusqlite::Row) -> rusqlite::Result<TitleRecord> {
    Ok(TitleRecord {
        id: row.get(0)?,
        category_id: row.get(1)?,
        kind: row.get(2)?,
        name: row.get(3)?,
        description: row.get(4)?,
        year: row.get(5)?,
        duration_seconds: row.get(6)?,
        rating: row.get(7)?,
        poster_path: row.get(8)?,
        banner_path: row.get(9)?,
        metadata_source: row.get(10)?,
    })
}

pub fn get(conn: &Connection, id: i64) -> rusqlite::Result<Option<TitleRecord>> {
    conn.query_row(
        &format!("SELECT {COLUMNS} FROM titles WHERE id = ?1"),
        rusqlite::params![id],
        map_row,
    )
    .optional()
}

pub fn list_by_category(conn: &Connection, category_id: i64) -> rusqlite::Result<Vec<TitleRecord>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {COLUMNS} FROM titles WHERE category_id = ?1 ORDER BY name COLLATE NOCASE"
    ))?;
    let rows = stmt.query_map(rusqlite::params![category_id], map_row)?;
    rows.collect()
}

/// Recherche un Titre existant par nom exact au sein d'une catégorie —
/// utilisé par le Metadata Service pour éviter de créer un doublon quand
/// plusieurs fichiers appartiennent au même Titre (plusieurs épisodes
/// d'une même série, par exemple). Comparaison insensible à la casse :
/// deux fichiers nommés différemment en capitalisation désignent presque
/// toujours le même contenu.
pub fn find_by_name(
    conn: &Connection,
    category_id: i64,
    name: &str,
) -> rusqlite::Result<Option<i64>> {
    conn.query_row(
        "SELECT id FROM titles WHERE category_id = ?1 AND name = ?2 COLLATE NOCASE",
        rusqlite::params![category_id, name],
        |row| row.get(0),
    )
    .optional()
}

pub fn create(
    conn: &Connection,
    category_id: i64,
    kind: &str,
    name: &str,
    year: Option<i64>,
    metadata_source: &str,
) -> rusqlite::Result<i64> {
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO titles (category_id, kind, name, year, metadata_source, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)",
        rusqlite::params![category_id, kind, name, year, metadata_source, now],
    )?;
    Ok(conn.last_insert_rowid())
}

/// Recherche-ou-création : point d'entrée principal utilisé par le
/// Metadata Service (`services::metadata`), pour ne jamais avoir à
/// dupliquer la logique find-puis-create à chaque appelant.
pub fn find_or_create(
    conn: &Connection,
    category_id: i64,
    kind: &str,
    name: &str,
    year: Option<i64>,
    metadata_source: &str,
) -> rusqlite::Result<i64> {
    if let Some(id) = find_by_name(conn, category_id, name)? {
        return Ok(id);
    }
    create(conn, category_id, kind, name, year, metadata_source)
}

/// Renseigne les champs enrichis obtenus d'un fournisseur de métadonnées
/// (description, durée, note, affiche/bannière *automatiques*) — ne touche
/// jamais à la personnalisation de l'utilisateur, qui vit dans une table
/// séparée (`custom_images`, doc §6.6) et que cette fonction ne connaît
/// même pas. Les colonnes automatiques, elles, sont écrasées sans
/// ménagement : un rafraîchissement ultérieur des métadonnées doit pouvoir
/// corriger une correspondance initiale imparfaite.
#[allow(clippy::too_many_arguments)]
pub fn apply_metadata(
    conn: &Connection,
    title_id: i64,
    description: Option<&str>,
    duration_seconds: Option<i64>,
    rating: Option<f64>,
    poster_path: Option<&str>,
    banner_path: Option<&str>,
    metadata_source: &str,
) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE titles
         SET description = COALESCE(?1, description),
             duration_seconds = COALESCE(?2, duration_seconds),
             rating = COALESCE(?3, rating),
             poster_path = COALESCE(?4, poster_path),
             banner_path = COALESCE(?5, banner_path),
             metadata_source = ?6,
             updated_at = ?7
         WHERE id = ?8",
        rusqlite::params![
            description,
            duration_seconds,
            rating,
            poster_path,
            banner_path,
            metadata_source,
            chrono::Utc::now().to_rfc3339(),
            title_id
        ],
    )?;
    Ok(())
}

// ---- Genres / Studios / Casting ---------------------------------------
//
// Même schéma pour les trois : une table de référence (nom unique) + une
// table de jointure. `attach_genre`/`attach_studio` sont idempotentes par
// construction (`INSERT OR IGNORE` sur la jointure) — le Metadata Service
// peut donc les rappeler sans vérifier au préalable si le lien existe déjà.

pub fn attach_genre(conn: &Connection, title_id: i64, genre_name: &str) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO genres (name) VALUES (?1) ON CONFLICT(name) DO NOTHING",
        rusqlite::params![genre_name],
    )?;
    let genre_id: i64 = conn.query_row(
        "SELECT id FROM genres WHERE name = ?1",
        rusqlite::params![genre_name],
        |row| row.get(0),
    )?;
    conn.execute(
        "INSERT OR IGNORE INTO title_genres (title_id, genre_id) VALUES (?1, ?2)",
        rusqlite::params![title_id, genre_id],
    )?;
    Ok(())
}

pub fn attach_studio(conn: &Connection, title_id: i64, studio_name: &str) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO studios (name) VALUES (?1) ON CONFLICT(name) DO NOTHING",
        rusqlite::params![studio_name],
    )?;
    let studio_id: i64 = conn.query_row(
        "SELECT id FROM studios WHERE name = ?1",
        rusqlite::params![studio_name],
        |row| row.get(0),
    )?;
    conn.execute(
        "INSERT OR IGNORE INTO title_studios (title_id, studio_id) VALUES (?1, ?2)",
        rusqlite::params![title_id, studio_id],
    )?;
    Ok(())
}

/// `role` : `"actor"` ou `"director"` (contrainte `CHECK` en base — voir
/// migration 0004). `character_name` n'a de sens que pour `"actor"`.
pub fn attach_credit(
    conn: &Connection,
    title_id: i64,
    person_name: &str,
    role: &str,
    character_name: Option<&str>,
    sort_order: i64,
) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO people (name) VALUES (?1) ON CONFLICT(name) DO NOTHING",
        rusqlite::params![person_name],
    )?;
    let person_id: i64 = conn.query_row(
        "SELECT id FROM people WHERE name = ?1",
        rusqlite::params![person_name],
        |row| row.get(0),
    )?;
    conn.execute(
        "INSERT OR IGNORE INTO title_credits (title_id, person_id, role, character_name, sort_order)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![title_id, person_id, role, character_name, sort_order],
    )?;
    Ok(())
}

pub fn list_genres(conn: &Connection, title_id: i64) -> rusqlite::Result<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT g.name FROM genres g
         JOIN title_genres tg ON tg.genre_id = g.id
         WHERE tg.title_id = ?1 ORDER BY g.name COLLATE NOCASE",
    )?;
    let rows = stmt.query_map(rusqlite::params![title_id], |row| row.get(0))?;
    rows.collect()
}

pub fn list_studios(conn: &Connection, title_id: i64) -> rusqlite::Result<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT s.name FROM studios s
         JOIN title_studios ts ON ts.studio_id = s.id
         WHERE ts.title_id = ?1 ORDER BY s.name COLLATE NOCASE",
    )?;
    let rows = stmt.query_map(rusqlite::params![title_id], |row| row.get(0))?;
    rows.collect()
}

#[derive(Debug, Clone, Serialize)]
pub struct CreditRecord {
    pub name: String,
    pub character_name: Option<String>,
}

pub fn list_credits(
    conn: &Connection,
    title_id: i64,
    role: &str,
) -> rusqlite::Result<Vec<CreditRecord>> {
    let mut stmt = conn.prepare(
        "SELECT p.name, tc.character_name FROM people p
         JOIN title_credits tc ON tc.person_id = p.id
         WHERE tc.title_id = ?1 AND tc.role = ?2
         ORDER BY tc.sort_order ASC, p.name COLLATE NOCASE",
    )?;
    let rows = stmt.query_map(rusqlite::params![title_id, role], |row| {
        Ok(CreditRecord {
            name: row.get(0)?,
            character_name: row.get(1)?,
        })
    })?;
    rows.collect()
}

/// Détache tous les Médias qui pointaient vers ce Titre, purge ses
/// personnalisations (`custom_images`, doc §6.6) et supprime le Titre —
/// cascade automatiquement ses Saisons/Épisodes et les jointures
/// genres/studios/casting (`ON DELETE CASCADE`, migration 0004). Renvoie
/// les chemins d'images personnalisées qui viennent d'être détachés de la
/// base, pour que l'appelant (`domain::library::delete_library` pour le
/// nettoyage automatique des orphelins, `domain::title::delete_title` pour
/// une suppression manuelle depuis une carte de Titre, Étape 5) supprime
/// aussi les fichiers correspondants du disque — cette fonction ne touche
/// jamais au système de fichiers elle-même, seulement à la base (voir
/// `custom_image_repository::delete_all_for_entity`). Ne touche jamais non
/// plus aux fichiers média eux-mêmes : seul le rattachement en base est
/// défait, quel que soit l'appelant.
///
/// Le détachement des Médias, lui, reste nécessaire explicitement : voir
/// la note de la migration 0004 sur l'absence de `REFERENCES` inline pour
/// `media_files.title_id`/`episode_id`, dont l'intégrité est assurée ici
/// plutôt que par un `ON DELETE` SQLite.
pub fn delete(conn: &Connection, title_id: i64) -> rusqlite::Result<Vec<String>> {
    let removed_images = custom_image_repository::list_paths_for_entity(conn, "title", title_id)?;
    custom_image_repository::delete_all_for_entity(conn, "title", title_id)?;

    conn.execute(
        "UPDATE media_files SET title_id = NULL WHERE title_id = ?1",
        rusqlite::params![title_id],
    )?;
    conn.execute(
        "UPDATE media_files SET episode_id = NULL WHERE episode_id IN
            (SELECT id FROM episodes WHERE title_id = ?1)",
        rusqlite::params![title_id],
    )?;
    conn.execute("DELETE FROM titles WHERE id = ?1", rusqlite::params![title_id])?;

    Ok(removed_images)
}

/// Parmi `title_ids`, ceux qui n'ont plus aucun Média ni Épisode associé —
/// utilisé par `domain::library::delete_library` (Étape 5) pour ne
/// supprimer que les Titres réellement devenus orphelins après suppression
/// d'une bibliothèque. Un Titre peut être alimenté par plusieurs
/// bibliothèques d'une même Catégorie (doc §6.1) : celui-ci ne doit
/// disparaître que si *plus aucune* bibliothèque n'y contribue, jamais dès
/// que la première d'entre elles est supprimée.
pub fn orphaned(conn: &Connection, title_ids: &[i64]) -> rusqlite::Result<Vec<i64>> {
    let mut orphans = Vec::new();
    for &title_id in title_ids {
        let remaining_movies: i64 = conn.query_row(
            "SELECT COUNT(*) FROM media_files WHERE title_id = ?1",
            rusqlite::params![title_id],
            |row| row.get(0),
        )?;
        let remaining_episodes: i64 = conn.query_row(
            "SELECT COUNT(*) FROM episodes WHERE title_id = ?1",
            rusqlite::params![title_id],
            |row| row.get(0),
        )?;
        if remaining_movies == 0 && remaining_episodes == 0 {
            orphans.push(title_id);
        }
    }
    Ok(orphans)
}
