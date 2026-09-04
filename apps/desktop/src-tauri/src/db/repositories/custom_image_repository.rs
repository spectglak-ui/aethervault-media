//! Accès SQL à la table `custom_images` (Étape 5, doc §6.6) — mécanisme de
//! personnalisation unique, partagé par toutes les entités personnalisables
//! présentes et futures. Voir la migration 0006 pour la justification du
//! choix d'une table polymorphe plutôt qu'une colonne `custom_*_path` par
//! entité et par usage.
//!
//! `entity_type`/`purpose` restent de simples chaînes contraintes par
//! `CHECK` en base plutôt que des enums Rust dédiés — cohérent avec le
//! reste du projet (`titles.kind`, `title_credits.role`...), où la
//! contrainte SQL est déjà la seule source de vérité.

use rusqlite::Connection;
use std::collections::HashMap;

/// L'image personnalisée d'une entité pour un usage donné, si elle existe.
pub fn get(
    conn: &Connection,
    entity_type: &str,
    entity_id: i64,
    purpose: &str,
) -> rusqlite::Result<Option<String>> {
    use rusqlite::OptionalExtension;

    conn.query_row(
        "SELECT path FROM custom_images WHERE entity_type = ?1 AND entity_id = ?2 AND purpose = ?3",
        rusqlite::params![entity_type, entity_id, purpose],
        |row| row.get(0),
    )
    .optional()
}

/// Remplace (`path = Some(..)`) ou efface (`path = None`) la
/// personnalisation d'une entité pour un usage donné — jamais d'état
/// intermédiaire incohérent, une seule opération couvre les deux cas.
pub fn set(
    conn: &Connection,
    entity_type: &str,
    entity_id: i64,
    purpose: &str,
    path: Option<&str>,
) -> rusqlite::Result<()> {
    match path {
        Some(value) => {
            conn.execute(
                "INSERT INTO custom_images (entity_type, entity_id, purpose, path, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5)
                 ON CONFLICT(entity_type, entity_id, purpose)
                 DO UPDATE SET path = excluded.path, updated_at = excluded.updated_at",
                rusqlite::params![
                    entity_type,
                    entity_id,
                    purpose,
                    value,
                    chrono::Utc::now().to_rfc3339()
                ],
            )?;
        }
        None => {
            conn.execute(
                "DELETE FROM custom_images WHERE entity_type = ?1 AND entity_id = ?2 AND purpose = ?3",
                rusqlite::params![entity_type, entity_id, purpose],
            )?;
        }
    }
    Ok(())
}

/// Tous les chemins personnalisés d'une entité, tous usages confondus —
/// utilisé pour supprimer les fichiers correspondants du disque avant de
/// purger les lignes (voir `delete_all_for_entity`).
pub fn list_paths_for_entity(
    conn: &Connection,
    entity_type: &str,
    entity_id: i64,
) -> rusqlite::Result<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT path FROM custom_images WHERE entity_type = ?1 AND entity_id = ?2",
    )?;
    let rows = stmt.query_map(rusqlite::params![entity_type, entity_id], |row| row.get(0))?;
    rows.collect()
}

/// Purge toutes les personnalisations d'une entité — appelé quand
/// l'entité elle-même est supprimée (ex. Titre orphelin après suppression
/// d'une bibliothèque), pour ne jamais laisser une personnalisation
/// pointer vers une entité qui n'existe plus. Ne supprime que les LIGNES ;
/// voir `services::image_store::remove_image` pour la suppression des
/// fichiers eux-mêmes, faite par l'appelant à partir de
/// `list_paths_for_entity` (deux responsabilités distinctes : celle-ci ne
/// touche qu'à la base).
pub fn delete_all_for_entity(
    conn: &Connection,
    entity_type: &str,
    entity_id: i64,
) -> rusqlite::Result<()> {
    conn.execute(
        "DELETE FROM custom_images WHERE entity_type = ?1 AND entity_id = ?2",
        rusqlite::params![entity_type, entity_id],
    )?;
    Ok(())
}
/// Récupère les posters personnalisés pour plusieurs titles en une seule requête.
pub fn get_batch_posters(
    conn: &Connection,
    title_ids: &[i64],
) -> Result<HashMap<i64, String>, rusqlite::Error> {
    if title_ids.is_empty() {
        return Ok(HashMap::new());
    }
    
    // Construire la clause IN (?, ?, ...) dynamiquement
    let placeholders: Vec<String> = title_ids.iter().map(|_| "?".to_string()).collect();
    let sql = format!(
        "SELECT resource_id, image_path 
         FROM custom_images 
         WHERE resource_type = 'title' 
         AND resource_id IN ({})
         AND image_type = 'poster'
         LIMIT 1",
        placeholders.join(", ")
    );
    
    let mut stmt = conn.prepare(&sql)?;
    let mut map = HashMap::new();
    
    let rows = stmt.query_map(rusqlite::params_from_iter(title_ids.iter()), |row| {
        Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
    })?;
    
    for row in rows {
        if let Ok((id, path)) = row {
            map.insert(id, path);
        }
    }
    
    Ok(map)
}