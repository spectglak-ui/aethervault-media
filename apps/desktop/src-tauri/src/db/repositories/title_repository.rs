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
use serde::{Deserialize, Serialize};

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

// ---- Fournisseur en ligne (Étape 7) --------------------------------

/// Enregistre les identifiants du fournisseur en ligne — un `tmdb_id`
/// non NULL marque le Titre comme enrichi (l'appariement local initial
/// reste dans `metadata_source` jusqu'à ce qu'un rafraîchissement le
/// remplace par "tmdb").
pub fn set_online_ids(
    conn: &Connection,
    title_id: i64,
    tmdb_id: i64,
    imdb_id: Option<&str>,
) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE titles SET tmdb_id = ?1, imdb_id = ?2, updated_at = ?3 WHERE id = ?4",
        rusqlite::params![tmdb_id, imdb_id, chrono::Utc::now().to_rfc3339(), title_id],
    )?;
    Ok(())
}

/// Titres d'une catégorie pas encore enrichis par le fournisseur en
/// ligne — la file de travail de l'enrichissement TMDB (Étape 7).
pub fn list_missing_tmdb_by_category(
    conn: &Connection,
    category_id: i64,
) -> rusqlite::Result<Vec<TitleRecord>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {COLUMNS} FROM titles WHERE category_id = ?1 AND tmdb_id IS NULL ORDER BY id"
    ))?;
    let rows = stmt.query_map(rusqlite::params![category_id], map_row)?;
    rows.collect()
}

// ---- Recherche multi-critères (Étape 7, lot 3 : Explorateur) ---------

/// Critères de l'Explorateur — tous optionnels, combinés en ET ; les
/// listes sont des OU internes. `#[serde(default)]` : le frontend n'envoie
/// que ce qu'il remplit.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct TitleSearchQuery {
    pub q: Option<String>,
    pub category_keys: Vec<String>,
    pub kinds: Vec<String>,
    pub year_from: Option<i64>,
    pub year_to: Option<i64>,
    pub genres: Vec<String>,
    pub actor: Option<String>,
    pub director: Option<String>,
    pub resolutions: Vec<String>,
    pub codecs: Vec<String>,
    pub audio_langs: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TitleSearchResult {
    pub id: i64,
    pub category_id: i64,
    pub category_key: String,
    pub category_name: String,
    pub kind: String,
    pub name: String,
    pub year: Option<i64>,
    pub poster: Option<String>,
    pub rating: Option<f64>,
}

fn placeholders(count: usize) -> String {
    vec!["?"; count].join(", ")
}

/// Recherche multicritère : critères éditoriaux (nom, catégories, nature,
/// années, genres, acteur, réalisateur) ET techniques (résolution, codec,
/// langue audio — une même sonde `media_probes` doit satisfaire tout ce
/// qui est demandé, sur un fichier du Titre directement ou via un épisode).
/// Jamais de jointure explosive : un `EXISTS` par famille de critère.
pub fn search_titles(
    conn: &Connection,
    query: &TitleSearchQuery,
) -> rusqlite::Result<Vec<TitleSearchResult>> {
    let mut sql = String::from(
        "SELECT t.id, t.category_id, c.key, c.name, t.kind, t.name, t.year, t.poster_path, t.rating
         FROM titles t
         JOIN categories c ON c.id = t.category_id
         WHERE 1 = 1",
    );
    let mut values: Vec<rusqlite::types::Value> = Vec::new();

    if let Some(q) = query.q.as_deref().map(str::trim).filter(|q| !q.is_empty()) {
        sql.push_str(" AND t.name LIKE ?");
        values.push(rusqlite::types::Value::Text(format!("%{q}%")));
    }
    if !query.category_keys.is_empty() {
        sql.push_str(&format!(" AND c.key IN ({})", placeholders(query.category_keys.len())));
        for key in &query.category_keys {
            values.push(rusqlite::types::Value::Text(key.clone()));
        }
    }
    if !query.kinds.is_empty() {
        sql.push_str(&format!(" AND t.kind IN ({})", placeholders(query.kinds.len())));
        for kind in &query.kinds {
            values.push(rusqlite::types::Value::Text(kind.clone()));
        }
    }
    if let Some(from) = query.year_from {
        sql.push_str(" AND t.year >= ?");
        values.push(rusqlite::types::Value::Integer(from));
    }
    if let Some(to) = query.year_to {
        sql.push_str(" AND t.year <= ?");
        values.push(rusqlite::types::Value::Integer(to));
    }
    if !query.genres.is_empty() {
        sql.push_str(&format!(
            " AND EXISTS (SELECT 1 FROM title_genres tg JOIN genres g ON g.id = tg.genre_id
              WHERE tg.title_id = t.id AND g.name IN ({}))",
            placeholders(query.genres.len())
        ));
        for genre in &query.genres {
            values.push(rusqlite::types::Value::Text(genre.clone()));
        }
    }
    if let Some(actor) = query.actor.as_deref().map(str::trim).filter(|a| !a.is_empty()) {
        sql.push_str(
            " AND EXISTS (SELECT 1 FROM title_credits tc JOIN people p ON p.id = tc.person_id
              WHERE tc.title_id = t.id AND tc.role = 'actor' AND p.name LIKE ?)",
        );
        values.push(rusqlite::types::Value::Text(format!("%{actor}%")));
    }
    if let Some(director) = query.director.as_deref().map(str::trim).filter(|d| !d.is_empty()) {
        sql.push_str(
            " AND EXISTS (SELECT 1 FROM title_credits tc JOIN people p ON p.id = tc.person_id
              WHERE tc.title_id = t.id AND tc.role = 'director' AND p.name LIKE ?)",
        );
        values.push(rusqlite::types::Value::Text(format!("%{director}%")));
    }
    if !query.resolutions.is_empty() || !query.codecs.is_empty() || !query.audio_langs.is_empty() {
        let mut inner = String::from(
            " AND EXISTS (SELECT 1 FROM media_files m
              LEFT JOIN media_probes pr ON pr.media_file_id = m.id
              WHERE (m.title_id = t.id OR m.episode_id IN
                     (SELECT e.id FROM episodes e WHERE e.title_id = t.id))
                AND m.is_available = 1",
        );
        if !query.resolutions.is_empty() {
            inner.push_str(&format!(" AND pr.resolution IN ({})", placeholders(query.resolutions.len())));
            for resolution in &query.resolutions {
                values.push(rusqlite::types::Value::Text(resolution.clone()));
            }
        }
        if !query.codecs.is_empty() {
            inner.push_str(&format!(" AND pr.video_codec IN ({})", placeholders(query.codecs.len())));
            for codec in &query.codecs {
                values.push(rusqlite::types::Value::Text(codec.clone()));
            }
        }
        for lang in &query.audio_langs {
            inner.push_str(" AND pr.audio_langs LIKE ?");
            values.push(rusqlite::types::Value::Text(format!("%\"{lang}\"%")));
        }
        inner.push(')');
        sql.push_str(&inner);
    }
    sql.push_str(" ORDER BY t.name COLLATE NOCASE LIMIT 500");

    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(rusqlite::params_from_iter(values), |row| {
        Ok(TitleSearchResult {
            id: row.get(0)?,
            category_id: row.get(1)?,
            category_key: row.get(2)?,
            category_name: row.get(3)?,
            kind: row.get(4)?,
            name: row.get(5)?,
            year: row.get(6)?,
            poster: row.get(7)?,
            rating: row.get(8)?,
        })
    })?;
    rows.collect()
}

/// Tous les genres présents au catalogue — chips de l'Explorateur.
pub fn all_genres(conn: &Connection) -> rusqlite::Result<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT DISTINCT g.name FROM genres g
         JOIN title_genres tg ON tg.genre_id = g.id
         ORDER BY g.name COLLATE NOCASE",
    )?;
    let rows = stmt.query_map([], |row| row.get(0))?;
    rows.collect()
}