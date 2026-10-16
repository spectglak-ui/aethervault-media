//! Notes personnelles et Watchlist (migration 0026) — PAR PROFIL.
//!
//! Seul endroit du code autorisé à écrire du SQL pour ces deux tables.

use rusqlite::{params, params_from_iter, Connection, OptionalExtension};

/// Statuts valides d'un élément de watchlist (miroir du CHECK SQL).
pub const WATCH_STATUSES: [&str; 3] = ["todo", "in_progress", "done"];

/// Une note est valide si elle est comprise entre 0,5 et 5 par pas de 0,5.
pub fn is_valid_rating(rating: f64) -> bool {
    rating.is_finite() && (0.5..=5.0).contains(&rating) && (rating * 2.0).fract() == 0.0
}

/// Pose (ou remplace) la note d'un titre ; `None` retire la note.
pub fn set_rating(
    conn: &Connection,
    profile_id: i64,
    title_id: i64,
    rating: Option<f64>,
) -> rusqlite::Result<()> {
    match rating {
        Some(value) => {
            conn.execute(
                "INSERT INTO title_ratings (profile_id, title_id, rating)
                 VALUES (?1, ?2, ?3)
                 ON CONFLICT(profile_id, title_id)
                 DO UPDATE SET rating = excluded.rating, rated_at = datetime('now')",
                params![profile_id, title_id, value],
            )?;
        }
        None => {
            conn.execute(
                "DELETE FROM title_ratings WHERE profile_id = ?1 AND title_id = ?2",
                params![profile_id, title_id],
            )?;
        }
    }
    Ok(())
}

/// Ajoute un titre à la watchlist (sans effet s'il y est déjà : son statut
/// est conservé).
pub fn watchlist_add(conn: &Connection, profile_id: i64, title_id: i64) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT OR IGNORE INTO watchlist_items (profile_id, title_id) VALUES (?1, ?2)",
        params![profile_id, title_id],
    )?;
    Ok(())
}

pub fn watchlist_remove(conn: &Connection, profile_id: i64, title_id: i64) -> rusqlite::Result<()> {
    conn.execute(
        "DELETE FROM watchlist_items WHERE profile_id = ?1 AND title_id = ?2",
        params![profile_id, title_id],
    )?;
    Ok(())
}

/// Change le statut d'un titre ; l'ajoute à la watchlist s'il n'y était pas.
pub fn watchlist_set_status(
    conn: &Connection,
    profile_id: i64,
    title_id: i64,
    status: &str,
) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO watchlist_items (profile_id, title_id, status)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(profile_id, title_id)
         DO UPDATE SET status = excluded.status, updated_at = datetime('now')",
        params![profile_id, title_id, status],
    )?;
    Ok(())
}

/// (note, statut de watchlist) d'un titre pour un profil.
pub fn user_state(
    conn: &Connection,
    profile_id: i64,
    title_id: i64,
) -> rusqlite::Result<(Option<f64>, Option<String>)> {
    let rating: Option<f64> = conn
        .query_row(
            "SELECT rating FROM title_ratings WHERE profile_id = ?1 AND title_id = ?2",
            params![profile_id, title_id],
            |row| row.get(0),
        )
        .optional()?;
    let status: Option<String> = conn
        .query_row(
            "SELECT status FROM watchlist_items WHERE profile_id = ?1 AND title_id = ?2",
            params![profile_id, title_id],
            |row| row.get(0),
        )
        .optional()?;
    Ok((rating, status))
}

/// Notes et statuts de watchlist de plusieurs titres en UNE requête (grilles
/// d'affiches : évite une requête par carte). Seuls les titres qui ont une
/// note ou un statut sont renvoyés.
pub fn user_states(
    conn: &Connection,
    profile_id: i64,
    title_ids: &[i64],
) -> rusqlite::Result<Vec<(i64, Option<f64>, Option<String>)>> {
    let mut out = Vec::new();
    // Par tranches : SQLite limite le nombre de paramètres d'une requête.
    for chunk in title_ids.chunks(500) {
        let placeholders = vec!["?"; chunk.len()].join(",");
        let sql = format!(
            "SELECT t.id, r.rating, w.status
             FROM titles t
             LEFT JOIN title_ratings r ON r.title_id = t.id AND r.profile_id = ?1
             LEFT JOIN watchlist_items w ON w.title_id = t.id AND w.profile_id = ?1
             WHERE t.id IN ({placeholders})
               AND (r.rating IS NOT NULL OR w.status IS NOT NULL)"
        );
        let mut stmt = conn.prepare(&sql)?;
        let mut args: Vec<i64> = Vec::with_capacity(chunk.len() + 1);
        args.push(profile_id);
        args.extend_from_slice(chunk);
        let rows = stmt.query_map(params_from_iter(args.iter()), |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?))
        })?;
        for row in rows {
            out.push(row?);
        }
    }
    Ok(out)
}

/// Ligne de la watchlist : colonnes du Titre + statut, date d'ajout, note.
pub struct WatchlistRow {
    pub title_id: i64,
    pub category_id: i64,
    pub kind: String,
    pub name: String,
    pub year: Option<i64>,
    pub poster_path: Option<String>,
    pub status: String,
    pub added_at: String,
    pub rating: Option<f64>,
}

/// Watchlist d'un profil, de l'ajout le plus récent au plus ancien.
/// `category_id` et `status` filtrent si renseignés.
pub fn watchlist_list(
    conn: &Connection,
    profile_id: i64,
    category_id: Option<i64>,
    status: Option<&str>,
) -> rusqlite::Result<Vec<WatchlistRow>> {
    let mut stmt = conn.prepare(
        "SELECT t.id, t.category_id, t.kind, t.name, t.year, t.poster_path,
                w.status, w.added_at, r.rating
         FROM watchlist_items w
         JOIN titles t ON t.id = w.title_id
         LEFT JOIN title_ratings r ON r.title_id = t.id AND r.profile_id = w.profile_id
         WHERE w.profile_id = ?1
           AND (?2 IS NULL OR t.category_id = ?2)
           AND (?3 IS NULL OR w.status = ?3)
         ORDER BY w.added_at DESC, t.id DESC",
    )?;
    let rows = stmt.query_map(params![profile_id, category_id, status], |row| {
        Ok(WatchlistRow {
            title_id: row.get(0)?,
            category_id: row.get(1)?,
            kind: row.get(2)?,
            name: row.get(3)?,
            year: row.get(4)?,
            poster_path: row.get(5)?,
            status: row.get(6)?,
            added_at: row.get(7)?,
            rating: row.get(8)?,
        })
    })?;
    rows.collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Base en mémoire : tables minimales (profiles, titles) + migration 0026,
    /// clés étrangères actives comme en production.
    fn db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "PRAGMA foreign_keys = ON;
             CREATE TABLE profiles (id INTEGER PRIMARY KEY);
             CREATE TABLE titles (
                 id INTEGER PRIMARY KEY, category_id INTEGER NOT NULL DEFAULT 1,
                 kind TEXT NOT NULL DEFAULT 'movie', name TEXT NOT NULL,
                 year INTEGER, poster_path TEXT);
             INSERT INTO profiles (id) VALUES (1), (2);
             INSERT INTO titles (id, category_id, name) VALUES (10, 1, 'Alpha'), (11, 2, 'Beta'), (12, 1, 'Gamma');",
        )
        .unwrap();
        conn.execute_batch(include_str!("../migrations/0026_ratings_watchlist.sql"))
            .unwrap();
        conn
    }

    #[test]
    fn rating_validation_accepts_half_steps_only() {
        for ok in [0.5, 1.0, 2.5, 4.5, 5.0] {
            assert!(is_valid_rating(ok), "{ok}");
        }
        for bad in [0.0, 0.25, 5.5, -1.0, 3.3, f64::NAN, f64::INFINITY] {
            assert!(!is_valid_rating(bad), "{bad}");
        }
    }

    #[test]
    fn rating_set_replace_and_clear() {
        let conn = db();
        set_rating(&conn, 1, 10, Some(3.5)).unwrap();
        assert_eq!(user_state(&conn, 1, 10).unwrap().0, Some(3.5));
        set_rating(&conn, 1, 10, Some(5.0)).unwrap();
        assert_eq!(user_state(&conn, 1, 10).unwrap().0, Some(5.0));
        set_rating(&conn, 1, 10, None).unwrap();
        assert_eq!(user_state(&conn, 1, 10).unwrap().0, None);
    }

    #[test]
    fn database_rejects_invalid_rating_and_status() {
        let conn = db();
        assert!(set_rating(&conn, 1, 10, Some(3.3)).is_err());
        assert!(set_rating(&conn, 1, 10, Some(0.0)).is_err());
        assert!(watchlist_set_status(&conn, 1, 10, "abandoned").is_err());
        // Titre inexistant : la clé étrangère refuse.
        assert!(set_rating(&conn, 1, 999, Some(4.0)).is_err());
    }

    #[test]
    fn ratings_and_watchlist_are_per_profile() {
        let conn = db();
        set_rating(&conn, 1, 10, Some(4.0)).unwrap();
        watchlist_add(&conn, 1, 10).unwrap();
        assert_eq!(user_state(&conn, 2, 10).unwrap(), (None, None));
        assert_eq!(user_state(&conn, 1, 10).unwrap(), (Some(4.0), Some("todo".into())));
        assert!(watchlist_list(&conn, 2, None, None).unwrap().is_empty());
    }

    #[test]
    fn watchlist_add_keeps_status_and_set_status_upserts() {
        let conn = db();
        watchlist_set_status(&conn, 1, 10, "in_progress").unwrap();
        watchlist_add(&conn, 1, 10).unwrap(); // sans effet : le statut est conservé
        assert_eq!(user_state(&conn, 1, 10).unwrap().1.as_deref(), Some("in_progress"));
        watchlist_set_status(&conn, 1, 10, "done").unwrap();
        assert_eq!(user_state(&conn, 1, 10).unwrap().1.as_deref(), Some("done"));
        watchlist_remove(&conn, 1, 10).unwrap();
        assert_eq!(user_state(&conn, 1, 10).unwrap().1, None);
    }

    #[test]
    fn watchlist_list_filters_by_category_and_status() {
        let conn = db();
        watchlist_add(&conn, 1, 10).unwrap(); // catégorie 1, todo
        watchlist_set_status(&conn, 1, 11, "done").unwrap(); // catégorie 2
        watchlist_set_status(&conn, 1, 12, "in_progress").unwrap(); // catégorie 1
        set_rating(&conn, 1, 11, Some(4.5)).unwrap();

        assert_eq!(watchlist_list(&conn, 1, None, None).unwrap().len(), 3);
        let cat1 = watchlist_list(&conn, 1, Some(1), None).unwrap();
        assert_eq!(cat1.len(), 2);
        let done = watchlist_list(&conn, 1, None, Some("done")).unwrap();
        assert_eq!(done.len(), 1);
        assert_eq!(done[0].name, "Beta");
        assert_eq!(done[0].rating, Some(4.5));
        assert_eq!(watchlist_list(&conn, 1, Some(2), Some("todo")).unwrap().len(), 0);
    }

    #[test]
    fn user_states_returns_only_titles_with_a_note_or_status() {
        let conn = db();
        set_rating(&conn, 1, 10, Some(2.5)).unwrap();
        watchlist_add(&conn, 1, 11).unwrap();
        let mut states = user_states(&conn, 1, &[10, 11, 12]).unwrap();
        states.sort_by_key(|s| s.0);
        assert_eq!(states.len(), 2);
        assert_eq!(states[0], (10, Some(2.5), None));
        assert_eq!(states[1], (11, None, Some("todo".to_string())));
        assert!(user_states(&conn, 1, &[]).unwrap().is_empty());
    }

    #[test]
    fn deleting_a_title_or_profile_cascades() {
        let conn = db();
        set_rating(&conn, 1, 10, Some(3.0)).unwrap();
        watchlist_add(&conn, 2, 10).unwrap();
        conn.execute("DELETE FROM titles WHERE id = 10", []).unwrap();
        assert_eq!(user_state(&conn, 1, 10).unwrap(), (None, None));
        assert_eq!(user_state(&conn, 2, 10).unwrap(), (None, None));
    }
}
