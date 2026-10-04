//! Tags des médias privés (0.6.3) — opère sur la connexion du coffre
//! déchiffré en mémoire (voir `domain::privacy::require_unlocked_connection`).
//! Les noms de tables sont issus d'une liste blanche (`table_for`),
//! jamais interpolés depuis une entrée utilisateur.
use rusqlite::{params, Connection};

pub struct PrivateTagRow(pub i64, pub String, pub i64);
pub struct PrivateMediaTagRow(pub i64, pub i64, pub String);

fn table_for(kind: &str) -> Result<&'static str, String> {
    match kind {
        "image" => Ok("private_image_tags"),
        "video" => Ok("private_video_tags"),
        other => Err(format!("Type de média invalide : {other}")),
    }
}

/// (id, nom, nombre d'utilisations tous médias confondus).
pub fn list_tags(conn: &Connection) -> rusqlite::Result<Vec<PrivateTagRow>> {
    let mut stmt = conn.prepare(
        "SELECT t.id, t.name,
                (SELECT COUNT(*) FROM private_image_tags it WHERE it.tag_id = t.id) +
                (SELECT COUNT(*) FROM private_video_tags vt WHERE vt.tag_id = t.id)
         FROM private_tags t
         ORDER BY t.name COLLATE NOCASE",
    )?;
    let rows = stmt.query_map([], |r| Ok(PrivateTagRow(r.get(0)?, r.get(1)?, r.get(2)?)))?;
    rows.collect()
}

pub fn ensure_tag(conn: &Connection, name: &str) -> rusqlite::Result<i64> {
    conn.execute(
        "INSERT INTO private_tags (name) VALUES (?1) ON CONFLICT(name) DO NOTHING",
        params![name],
    )?;
    conn.query_row("SELECT id FROM private_tags WHERE name = ?1", params![name], |r| r.get(0))
}

pub fn delete_tag(conn: &Connection, tag_id: i64) -> Result<(), String> {
    conn.execute("DELETE FROM private_tags WHERE id = ?1", params![tag_id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn add_tag(conn: &Connection, kind: &str, media_id: i64, name: &str) -> Result<i64, String> {
    let table = table_for(kind)?;
    let tag_id = ensure_tag(conn, name).map_err(|e| e.to_string())?;
    conn.execute(
        &format!("INSERT OR IGNORE INTO {table} (tag_id, media_id) VALUES (?1, ?2)"),
        params![tag_id, media_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(tag_id)
}

pub fn remove_tag(conn: &Connection, kind: &str, media_id: i64, tag_id: i64) -> Result<(), String> {
    let table = table_for(kind)?;
    conn.execute(
        &format!("DELETE FROM {table} WHERE tag_id = ?1 AND media_id = ?2"),
        params![tag_id, media_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// (media_id, tag_id, nom) pour un lot de médias d'un même type.
pub fn tags_for_many(
    conn: &Connection,
    kind: &str,
    media_ids: &[i64],
) -> Result<Vec<PrivateMediaTagRow>, String> {
    let table = table_for(kind)?;
    if media_ids.is_empty() {
        return Ok(Vec::new());
    }
    let placeholders = media_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let sql = format!(
        "SELECT l.media_id, t.id, t.name
         FROM {table} l JOIN private_tags t ON t.id = l.tag_id
         WHERE l.media_id IN ({placeholders})
         ORDER BY t.name COLLATE NOCASE"
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params_from_iter(media_ids.iter().copied()), |r| {
            Ok(PrivateMediaTagRow(r.get(0)?, r.get(1)?, r.get(2)?))
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<rusqlite::Result<Vec<_>>>().map_err(|e| e.to_string())
}