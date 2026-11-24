//! Opérations SQLite pour VaultTube / AetherFy.
use crate::db::DbPool;
use rusqlite::OptionalExtension;
use super::models::{UserPlaylist, UserPlaylistItem, VaultTubePlaylist, VaultTubeSubscription, VaultTubeVideo};

pub struct VaultTubeRepository {
    pool: DbPool,
}

/// Détecte si une URL pointe probablement vers du contenu audio
/// (chaînes « - Topic », playlists musicales, podcasts). L'utilisateur
/// peut toujours basculer le mode manuellement ensuite.
pub fn detect_mode_from_url(url: &str, title: &str) -> &'static str {
    let u = url.to_lowercase();
    let t = title.to_lowercase();
    if u.contains("- topic") || t.contains("- topic") {
        return "audio";
    }
    if t.contains("music") || t.contains("musique") || t.contains("podcast") || t.contains("album")
    {
        return "audio";
    }
    "video"
}

// ---- Adresses d'abonnement (0.7.10) ----------------------------------------------

/// Identifiant de playlist (`list=…`) d'une adresse YouTube / YouTube Music, quelle
/// que soit l'écriture : `playlist?list=`, `watch?v=…&list=`, `music.youtube.com`,
/// `youtu.be/…?list=`, paramètres de suivi (`si=`)… `None` pour toute autre adresse.
pub fn youtube_playlist_id(url: &str) -> Option<String> {
    let trimmed = url.trim();
    let rest = trimmed
        .strip_prefix("https://")
        .or_else(|| trimmed.strip_prefix("http://"))?;
    let (host, after_host) = match rest.find(|c| c == '/' || c == '?' || c == '#') {
        Some(i) => (&rest[..i], &rest[i..]),
        None => (rest, ""),
    };
    let host = host.to_ascii_lowercase();
    let known = matches!(
        host.as_str(),
        "youtube.com" | "www.youtube.com" | "m.youtube.com" | "music.youtube.com" | "youtu.be"
    );
    if !known {
        return None;
    }
    let query = after_host.split_once('?')?.1;
    let query = query.split('#').next().unwrap_or("");
    query
        .split('&')
        .filter_map(|pair| pair.strip_prefix("list="))
        .map(|id| id.to_string())
        .find(|id| {
            id.len() >= 2 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
        })
}

/// Forme canonique d'une adresse d'abonnement : une playlist YouTube s'écrit toujours
/// `https://www.youtube.com/playlist?list=ID` (une même playlist ne peut ainsi pas être
/// enregistrée sous plusieurs écritures) ; toute autre adresse est seulement nettoyée.
pub fn normalize_subscription_url(url: &str) -> String {
    match youtube_playlist_id(url) {
        Some(id) => format!("https://www.youtube.com/playlist?list={id}"),
        None => url.trim().to_string(),
    }
}

fn map_subscription(row: &rusqlite::Row<'_>) -> rusqlite::Result<VaultTubeSubscription> {
    Ok(VaultTubeSubscription {
        id: row.get(0)?,
        name: row.get(1)?,
        url: row.get(2)?,
        kind: row.get(3)?,
        youtube_id: row.get(4)?,
        thumbnail_url: row.get(5)?,
        added_at: row.get(6)?,
        last_synced_at: row.get(7)?,
        source: row.get(8)?,
        mode: row.get(9)?,
    })
}

/// Message lisible à la place du texte brut de SQLite quand l'adresse est déjà suivie.
fn friendly_subscription_error(error: &rusqlite::Error, mode: &str) -> String {
    let text = error.to_string();
    if !text.contains("UNIQUE constraint failed: vaulttube_subscriptions") {
        return text;
    }
    if text.contains("vaulttube_subscriptions.mode") {
        let space = if mode == "audio" { "AetherFy Musique" } else { "AetherFy Vidéo" };
        format!("Cette adresse est déjà suivie dans {space}.")
    } else {
        // Ancien schéma `UNIQUE(url)` encore en place (mise à niveau impossible).
        "Cette adresse est déjà suivie dans l'autre espace (AetherFy Vidéo ou Musique).".to_string()
    }
}

// ---- Mise à niveau du schéma : UNIQUE(url) → UNIQUE(url, mode) (0.7.10) ----------
//
// Défaut corrigé : `url` était UNIQUE à elle seule. Une playlist déjà suivie (dans
// AetherFy Vidéo, ou lors d'un essai précédent) interdisait donc de la suivre dans
// AetherFy Musique : « UNIQUE constraint failed: vaulttube_subscriptions.url ».
// Les deux espaces sont indépendants : l'unicité porte désormais sur (url, mode).
//
// SQLite ne sait pas retirer un `UNIQUE` : on reconstruit la table (procédure officielle
// https://www.sqlite.org/lang_altertable.html). `PRAGMA foreign_keys` doit être coupé
// pendant l'opération — sinon le `DROP TABLE` supprimerait en cascade toutes les
// vidéos et playlists synchronisées — puis remis (la connexion retourne au pool).

const SUBSCRIPTION_COLUMNS: [&str; 10] = [
    "id", "name", "url", "kind", "youtube_id", "thumbnail_url", "added_at", "last_synced_at",
    "source", "mode",
];

fn text_column(
    conn: &rusqlite::Connection,
    sql: &str,
    arg: Option<&str>,
) -> Result<Vec<String>, rusqlite::Error> {
    let mut stmt = conn.prepare(sql)?;
    let rows = match arg {
        Some(a) => stmt.query_map([a], |r| r.get::<_, String>(0))?.collect::<Result<Vec<_>, _>>()?,
        None => stmt.query_map([], |r| r.get::<_, String>(0))?.collect::<Result<Vec<_>, _>>()?,
    };
    Ok(rows)
}

/// Taille maximale d'une image de playlist (data URL) : ~300 Ko. L'interface la réduit à
/// 320 × 320 px (≈ 30 Ko) ; cette limite protège la base contre un appel détourné.
const MAX_COVER_IMAGE_LEN: usize = 400_000;

/// Une image de playlist est une data URL JPEG, PNG ou WebP en base64, de taille raisonnable.
pub fn validate_cover_image(image: &str) -> Result<(), String> {
    let data = ["data:image/jpeg;base64,", "data:image/png;base64,", "data:image/webp;base64,"]
        .iter()
        .find_map(|prefix| image.strip_prefix(prefix))
        .ok_or_else(|| "Image invalide : formats acceptés JPEG, PNG ou WebP.".to_string())?;
    if image.len() > MAX_COVER_IMAGE_LEN {
        return Err("Image trop lourde (300 Ko maximum après réduction).".to_string());
    }
    if data.is_empty() || !data.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'+' | b'/' | b'=')) {
        return Err("Image invalide : contenu illisible.".to_string());
    }
    Ok(())
}

/// Ajoute une colonne à une table existante si elle n'y est pas (idempotent). `table`,
/// `column` et `ddl_type` sont des constantes du code, jamais une saisie utilisateur.
fn add_column_if_missing(
    conn: &rusqlite::Connection,
    table: &str,
    column: &str,
    ddl_type: &str,
) -> Result<(), String> {
    let present = text_column(conn, &format!("SELECT name FROM pragma_table_info('{table}')"), None)
        .map_err(|e| e.to_string())?;
    if present.iter().any(|c| c == column) {
        return Ok(());
    }
    conn.execute_batch(&format!("ALTER TABLE {table} ADD COLUMN {column} {ddl_type}"))
        .map_err(|e| e.to_string())
}

/// `Ok(true)` si la table a été reconstruite, `Ok(false)` s'il n'y avait rien à faire.
fn upgrade_subscription_uniqueness(conn: &mut rusqlite::Connection) -> Result<bool, String> {
    let db = |e: rusqlite::Error| e.to_string();

    // 1. Reste-t-il un index UNIQUE sur la seule colonne `url` ?
    let unique_indexes = text_column(
        conn,
        "SELECT name FROM pragma_index_list('vaulttube_subscriptions') WHERE \"unique\" = 1",
        None,
    )
    .map_err(db)?;
    let mut url_only = false;
    for index in &unique_indexes {
        let columns = text_column(
            conn,
            "SELECT name FROM pragma_index_info(?1) ORDER BY seqno",
            Some(index),
        )
        .map_err(db)?;
        if columns.len() == 1 && columns[0] == "url" {
            url_only = true;
            break;
        }
    }
    if !url_only {
        return Ok(false);
    }

    // 2. Base très ancienne (avant les migrations 18 et 20) : `source` / `mode` n'existent
    //    pas encore. La mise à niveau se fera au démarrage suivant, migrations passées.
    let present = text_column(conn, "SELECT name FROM pragma_table_info('vaulttube_subscriptions')", None)
        .map_err(db)?;
    if !SUBSCRIPTION_COLUMNS.iter().all(|c| present.iter().any(|p| p.as_str() == *c)) {
        return Ok(false);
    }

    // 3. Reconstruction, clés étrangères suspendues puis TOUJOURS rétablies.
    conn.execute_batch("PRAGMA foreign_keys = OFF;").map_err(db)?;
    let outcome = rebuild_subscriptions_table(conn);
    let restored = conn.execute_batch("PRAGMA foreign_keys = ON;").map_err(db);
    outcome?;
    restored?;
    Ok(true)
}

fn rebuild_subscriptions_table(conn: &mut rusqlite::Connection) -> Result<(), String> {
    let db = |e: rusqlite::Error| e.to_string();
    let tx = conn
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(db)?;

    let orphans_before: i64 = tx
        .query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |r| r.get(0))
        .map_err(db)?;
    let old_seq: Option<i64> = tx
        .query_row(
            "SELECT seq FROM sqlite_sequence WHERE name = 'vaulttube_subscriptions'",
            [],
            |r| r.get(0),
        )
        .optional()
        .map_err(db)?;

    tx.execute_batch(
        "CREATE TABLE vaulttube_subscriptions_new (
             id INTEGER PRIMARY KEY AUTOINCREMENT,
             name TEXT NOT NULL,
             url TEXT NOT NULL,
             kind TEXT NOT NULL,
             youtube_id TEXT NOT NULL,
             thumbnail_url TEXT,
             added_at INTEGER NOT NULL,
             last_synced_at INTEGER,
             source TEXT NOT NULL DEFAULT 'youtube',
             mode TEXT NOT NULL DEFAULT 'video',
             UNIQUE(url, mode)
         );
         INSERT INTO vaulttube_subscriptions_new
             (id, name, url, kind, youtube_id, thumbnail_url, added_at, last_synced_at, source, mode)
             SELECT id, name, url, kind, youtube_id, thumbnail_url, added_at, last_synced_at, source, mode
             FROM vaulttube_subscriptions;
         DROP TABLE vaulttube_subscriptions;
         ALTER TABLE vaulttube_subscriptions_new RENAME TO vaulttube_subscriptions;",
    )
    .map_err(db)?;

    // Les identifiants supprimés ne doivent pas être réattribués (AUTOINCREMENT).
    if let Some(seq) = old_seq {
        let updated = tx
            .execute(
                "UPDATE sqlite_sequence SET seq = ?1 WHERE name = 'vaulttube_subscriptions' AND seq < ?1",
                [seq],
            )
            .map_err(db)?;
        if updated == 0 {
            let known: i64 = tx
                .query_row(
                    "SELECT COUNT(*) FROM sqlite_sequence WHERE name = 'vaulttube_subscriptions'",
                    [],
                    |r| r.get(0),
                )
                .map_err(db)?;
            if known == 0 {
                tx.execute(
                    "INSERT INTO sqlite_sequence (name, seq) VALUES ('vaulttube_subscriptions', ?1)",
                    [seq],
                )
                .map_err(db)?;
            }
        }
    }

    let orphans_after: i64 = tx
        .query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |r| r.get(0))
        .map_err(db)?;
    if orphans_after > orphans_before {
        return Err("des vidéos ou playlists ne seraient plus rattachées à leur abonnement".to_string());
    }
    tx.commit().map_err(db)
}

impl VaultTubeRepository {
    pub fn new(pool: DbPool) -> Self {
        Self { pool }
    }

    /// Crée les tables VaultTube si elles n'existent pas.
    pub fn create_tables(&self) -> Result<(), String> {
        let mut conn = self.pool.get().map_err(|e| e.to_string())?;
        conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS vaulttube_subscriptions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                url TEXT NOT NULL,
                kind TEXT NOT NULL,
                youtube_id TEXT NOT NULL,
                thumbnail_url TEXT,
                added_at INTEGER NOT NULL,
                last_synced_at INTEGER,
                source TEXT NOT NULL DEFAULT 'youtube',
                mode TEXT NOT NULL DEFAULT 'video',
                UNIQUE(url, mode)
            );
            CREATE TABLE IF NOT EXISTS vaulttube_videos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                subscription_id INTEGER NOT NULL REFERENCES vaulttube_subscriptions(id) ON DELETE CASCADE,
                youtube_id TEXT NOT NULL,
                title TEXT NOT NULL,
                description TEXT,
                thumbnail_url TEXT,
                duration_seconds INTEGER,
                published_at INTEGER,
                added_at INTEGER NOT NULL,
                source TEXT NOT NULL DEFAULT 'youtube',
                mode TEXT NOT NULL DEFAULT 'video',
                is_short INTEGER NOT NULL DEFAULT 0,
                channel TEXT,
                UNIQUE(subscription_id, youtube_id)
            );
            CREATE INDEX IF NOT EXISTS idx_vaulttube_videos_subscription_id ON vaulttube_videos(subscription_id);
            CREATE TABLE IF NOT EXISTS vaulttube_playlists (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                subscription_id INTEGER NOT NULL REFERENCES vaulttube_subscriptions(id) ON DELETE CASCADE,
                youtube_id TEXT NOT NULL,
                title TEXT NOT NULL,
                thumbnail_url TEXT,
                video_count INTEGER,
                added_at INTEGER NOT NULL,
                source TEXT NOT NULL DEFAULT 'youtube',
                UNIQUE(subscription_id, youtube_id)
            );
            CREATE TABLE IF NOT EXISTS vaulttube_user_playlists (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                mode TEXT NOT NULL DEFAULT 'video',
                cover_image TEXT
            );
            CREATE TABLE IF NOT EXISTS vaulttube_user_playlist_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                playlist_id INTEGER NOT NULL REFERENCES vaulttube_user_playlists(id) ON DELETE CASCADE,
                youtube_id TEXT NOT NULL,
                title TEXT NOT NULL,
                thumbnail_url TEXT,
                duration_seconds INTEGER,
                channel TEXT,
                position INTEGER NOT NULL,
                added_at INTEGER NOT NULL,
                source TEXT NOT NULL DEFAULT 'youtube',
                mode TEXT NOT NULL DEFAULT 'video',
                UNIQUE(playlist_id, youtube_id)
            );
            ",
        )
        .map_err(|e| e.to_string())?;

        // 0.7.10 : une base créée avant ce correctif a encore `UNIQUE(url)`. Un échec ici
        // n'empêche PAS l'application de démarrer (elle fonctionne comme avant).
        // Colonnes ajoutées après coup : bases créées avant ces versions.
        add_column_if_missing(&conn, "vaulttube_videos", "channel", "TEXT")?;
        add_column_if_missing(&conn, "vaulttube_user_playlists", "cover_image", "TEXT")?;

        match upgrade_subscription_uniqueness(&mut conn) {
            Ok(true) => log::info!("[vaulttube] unicité des abonnements : UNIQUE(url) → UNIQUE(url, mode)"),
            Ok(false) => {}
            Err(e) => log::warn!("[vaulttube] mise à niveau de l'unicité des abonnements impossible : {e}"),
        }
        Ok(())
    }

    /// Ajoute un abonnement.
    pub fn add_subscription(
        &self,
        name: &str,
        url: &str,
        kind: &str,
        youtube_id: &str,
        thumbnail_url: Option<&str>,
        source: &str,
        mode: &str,
    ) -> Result<i64, String> {
        let conn = self.pool.get().map_err(|e| e.to_string())?;
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;
        conn.execute(
            "INSERT INTO vaulttube_subscriptions (name, url, kind, youtube_id, thumbnail_url, added_at, source, mode)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            rusqlite::params![name, url, kind, youtube_id, thumbnail_url, now, source, mode],
        )
        .map_err(|e| friendly_subscription_error(&e, mode))?;
        Ok(conn.last_insert_rowid())
    }

    /// Liste tous les abonnements.
    pub fn list_subscriptions(&self) -> Result<Vec<VaultTubeSubscription>, String> {
        let conn = self.pool.get().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT id, name, url, kind, youtube_id, thumbnail_url, added_at, last_synced_at, source, mode
                 FROM vaulttube_subscriptions
                 ORDER BY added_at DESC",
            )
            .map_err(|e| e.to_string())?;
        let subs = stmt
            .query_map([], map_subscription)
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        Ok(subs)
    }

    /// Cherche l'abonnement déjà enregistré pour cette adresse — ou pour cette playlist
    /// YouTube, quelle que soit l'écriture de l'adresse. `mode` = `None` : tous modes.
    pub fn find_subscription(
        &self,
        url: &str,
        mode: Option<&str>,
    ) -> Result<Option<VaultTubeSubscription>, String> {
        let conn = self.pool.get().map_err(|e| e.to_string())?;
        let canonical = normalize_subscription_url(url);
        let raw = url.trim().to_string();
        let list_id = youtube_playlist_id(&canonical).unwrap_or_default();
        conn.query_row(
            "SELECT id, name, url, kind, youtube_id, thumbnail_url, added_at, last_synced_at, source, mode
             FROM vaulttube_subscriptions
             WHERE (url IN (?1, ?2)
                    OR (?3 <> '' AND source = 'youtube' AND kind = 'playlist' AND youtube_id = ?3))
               AND (?4 IS NULL OR mode = ?4)
             ORDER BY id ASC
             LIMIT 1",
            rusqlite::params![canonical, raw, list_id, mode],
            map_subscription,
        )
        .optional()
        .map_err(|e| e.to_string())
    }

    /// Supprime un abonnement (et ses vidéos en cascade).
    pub fn remove_subscription(&self, id: i64) -> Result<(), String> {
        let conn = self.pool.get().map_err(|e| e.to_string())?;
        conn.execute(
            "DELETE FROM vaulttube_subscriptions WHERE id = ?1",
            rusqlite::params![id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Met à jour la date de dernière synchronisation.
    pub fn update_last_synced(&self, id: i64) -> Result<(), String> {
        let conn = self.pool.get().map_err(|e| e.to_string())?;
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;
        conn.execute(
            "UPDATE vaulttube_subscriptions SET last_synced_at = ?1 WHERE id = ?2",
            rusqlite::params![now, id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Ajoute une vidéo (ignore si déjà présente). Le mode est hérité
    /// automatiquement de l'abonnement parent.
        pub fn add_video(
        &self,
        subscription_id: i64,
        youtube_id: &str,
        title: &str,
        description: Option<&str>,
        thumbnail_url: Option<&str>,
        duration_seconds: Option<i64>,
        published_at: Option<i64>,
        source: &str,
        is_short: bool,
        channel: Option<&str>,
    ) -> Result<(), String> {
        let conn = self.pool.get().map_err(|e| e.to_string())?;
        let mode: String = conn
            .query_row(
                "SELECT mode FROM vaulttube_subscriptions WHERE id = ?1",
                rusqlite::params![subscription_id],
                |row| row.get(0),
            )
            .unwrap_or_else(|_| "video".to_string());
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;
        // Déjà présente : seule la chaîne est rattrapée (les vidéos synchronisées avant l'ajout
        // de la colonne la reçoivent à la resynchronisation) ; le reste n'est jamais modifié.
        conn.execute(
            "INSERT INTO vaulttube_videos
             (subscription_id, youtube_id, title, description, thumbnail_url, duration_seconds, published_at, added_at, source, mode, is_short, channel)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
             ON CONFLICT(subscription_id, youtube_id)
             DO UPDATE SET channel = COALESCE(excluded.channel, vaulttube_videos.channel)",
            rusqlite::params![
                subscription_id, youtube_id, title, description, thumbnail_url,
                duration_seconds, published_at, now, source, mode, is_short as i64, channel
            ],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// 0.7.5 — force is_short = 1 sur une vidéo DÉJÀ en base.
    /// Indispensable : INSERT OR IGNORE ne met jamais à jour les
    /// lignes existantes, sans ça les 2000+ vidéos déjà synchronisées
    /// resteraient à is_short = 0 pour toujours.
    pub fn mark_short(&self, subscription_id: i64, youtube_id: &str) -> Result<(), String> {
        let conn = self.pool.get().map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE vaulttube_videos SET is_short = 1
             WHERE subscription_id = ?1 AND youtube_id = ?2",
            rusqlite::params![subscription_id, youtube_id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Liste les vidéos d'un abonnement.
    pub fn list_videos(&self, subscription_id: i64) -> Result<Vec<VaultTubeVideo>, String> {
        let conn = self.pool.get().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT id, subscription_id, youtube_id, title, description, thumbnail_url,
                        duration_seconds, published_at, added_at, source, mode, is_short, channel
                 FROM vaulttube_videos
                 WHERE subscription_id = ?1
                 ORDER BY published_at DESC NULLS LAST, added_at DESC",
            )
            .map_err(|e| e.to_string())?;
        let videos = stmt
            .query_map(rusqlite::params![subscription_id], |row| {
                Ok(VaultTubeVideo {
                    id: row.get(0)?,
                    subscription_id: row.get(1)?,
                    youtube_id: row.get(2)?,
                    title: row.get(3)?,
                    description: row.get(4)?,
                    thumbnail_url: row.get(5)?,
                    duration_seconds: row.get(6)?,
                    published_at: row.get(7)?,
                    added_at: row.get(8)?,
                    source: row.get(9)?,
                    mode: row.get(10)?,
                    is_short: row.get::<_, i64>(11).unwrap_or(0) != 0,
                    channel: row.get(12)?,
                })
            })
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        Ok(videos)
    }

    /// Ajoute ou met à jour une playlist de chaîne.
    pub fn upsert_playlist(
        &self,
        subscription_id: i64,
        youtube_id: &str,
        title: &str,
        thumbnail_url: Option<&str>,
        video_count: Option<i64>,
        source: &str,
    ) -> Result<(), String> {
        let conn = self.pool.get().map_err(|e| e.to_string())?;
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;
        conn.execute(
            "INSERT INTO vaulttube_playlists
             (subscription_id, youtube_id, title, thumbnail_url, video_count, added_at, source)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(subscription_id, youtube_id) DO UPDATE SET
               title = excluded.title,
               thumbnail_url = excluded.thumbnail_url,
               video_count = excluded.video_count",
            rusqlite::params![subscription_id, youtube_id, title, thumbnail_url, video_count, now, source],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Liste les playlists d'une chaîne.
    pub fn list_playlists(&self, subscription_id: i64) -> Result<Vec<VaultTubePlaylist>, String> {
        let conn = self.pool.get().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT id, subscription_id, youtube_id, title, thumbnail_url, video_count, added_at, source
                 FROM vaulttube_playlists
                 WHERE subscription_id = ?1
                 ORDER BY title ASC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(rusqlite::params![subscription_id], |row| {
                Ok(VaultTubePlaylist {
                    id: row.get(0)?,
                    subscription_id: row.get(1)?,
                    youtube_id: row.get(2)?,
                    title: row.get(3)?,
                    thumbnail_url: row.get(4)?,
                    video_count: row.get(5)?,
                    added_at: row.get(6)?,
                    source: row.get(7)?,
                })
            })
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        Ok(rows)
    }

    /// Complète l'avatar d'un abonnement (quand il manquait à l'ajout).
    pub fn update_thumbnail(&self, subscription_id: i64, thumbnail_url: &str) -> Result<(), String> {
        let conn = self.pool.get().map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE vaulttube_subscriptions SET thumbnail_url = ?1 WHERE id = ?2",
            rusqlite::params![thumbnail_url, subscription_id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    // ---------- Playlists locales (utilisateur) ----------

    pub fn create_user_playlist(&self, name: &str, mode: &str) -> Result<i64, String> {
        let conn = self.pool.get().map_err(|e| e.to_string())?;
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;
        conn.execute(
            "INSERT INTO vaulttube_user_playlists (name, created_at, mode) VALUES (?1, ?2, ?3)",
            rusqlite::params![name, now, mode],
        )
        .map_err(|e| e.to_string())?;
        Ok(conn.last_insert_rowid())
    }

    pub fn list_user_playlists(&self) -> Result<Vec<UserPlaylist>, String> {
        let conn = self.pool.get().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT p.id, p.name, p.created_at, p.mode,
                        (SELECT COUNT(*) FROM vaulttube_user_playlist_items i
                         WHERE i.playlist_id = p.id) AS item_count,
                        p.cover_image
                 FROM vaulttube_user_playlists p
                 ORDER BY p.name ASC",
            )
            .map_err(|e| e.to_string())?;
        let mut rows: Vec<UserPlaylist> = stmt
            .query_map([], |row| {
                Ok(UserPlaylist {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    created_at: row.get(2)?,
                    mode: row.get(3)?,
                    item_count: row.get(4)?,
                    cover_image: row.get(5)?,
                    preview_thumbnails: Vec::new(),
                })
            })
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();

        // Image par défaut : les 4 premières vignettes DISTINCTES de chaque playlist (dans
        // l'ordre de lecture) — une seule requête pour toutes les playlists.
        let mut thumbs = conn
            .prepare(
                "SELECT playlist_id, thumbnail_url FROM (
                     SELECT playlist_id, thumbnail_url,
                            ROW_NUMBER() OVER (PARTITION BY playlist_id ORDER BY MIN(position), MIN(id)) AS rn
                     FROM vaulttube_user_playlist_items
                     WHERE thumbnail_url IS NOT NULL AND thumbnail_url <> ''
                     GROUP BY playlist_id, thumbnail_url
                 ) WHERE rn <= 4
                 ORDER BY playlist_id, rn",
            )
            .map_err(|e| e.to_string())?;
        let mut by_playlist: std::collections::HashMap<i64, Vec<String>> = std::collections::HashMap::new();
        for row in thumbs
            .query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
        {
            by_playlist.entry(row.0).or_default().push(row.1);
        }
        for playlist in &mut rows {
            playlist.preview_thumbnails = by_playlist.remove(&playlist.id).unwrap_or_default();
        }
        Ok(rows)
    }

    /// Définit (ou, avec `None`, retire) l'image d'une playlist locale.
    pub fn set_user_playlist_cover(&self, id: i64, image: Option<&str>) -> Result<(), String> {
        let image = image.filter(|i| !i.is_empty());
        if let Some(i) = image {
            validate_cover_image(i)?;
        }
        let conn = self.pool.get().map_err(|e| e.to_string())?;
        let changed = conn
            .execute(
                "UPDATE vaulttube_user_playlists SET cover_image = ?1 WHERE id = ?2",
                rusqlite::params![image, id],
            )
            .map_err(|e| e.to_string())?;
        if changed == 0 {
            return Err("Playlist introuvable.".to_string());
        }
        Ok(())
    }

    pub fn delete_user_playlist(&self, id: i64) -> Result<(), String> {
        let conn = self.pool.get().map_err(|e| e.to_string())?;
        conn.execute(
            "DELETE FROM vaulttube_user_playlists WHERE id = ?1",
            rusqlite::params![id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn list_user_playlist_items(
        &self,
        playlist_id: i64,
    ) -> Result<Vec<UserPlaylistItem>, String> {
        let conn = self.pool.get().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT id, playlist_id, youtube_id, title, thumbnail_url,
                        duration_seconds, channel, position, added_at, source, mode
                 FROM vaulttube_user_playlist_items
                 WHERE playlist_id = ?1
                 ORDER BY position ASC, id ASC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(rusqlite::params![playlist_id], |row| {
                Ok(UserPlaylistItem {
                    id: row.get(0)?,
                    playlist_id: row.get(1)?,
                    youtube_id: row.get(2)?,
                    title: row.get(3)?,
                    thumbnail_url: row.get(4)?,
                    duration_seconds: row.get(5)?,
                    channel: row.get(6)?,
                    position: row.get(7)?,
                    added_at: row.get(8)?,
                    source: row.get(9)?,
                    mode: row.get(10)?,
                })
            })
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        Ok(rows)
    }

    /// Ajoute une vidéo à la fin d'une playlist locale (doublon ignoré).
    /// Le mode est hérité automatiquement de la playlist parente.
    pub fn add_user_playlist_item(
        &self,
        playlist_id: i64,
        youtube_id: &str,
        title: &str,
        thumbnail_url: Option<&str>,
        duration_seconds: Option<i64>,
        channel: Option<&str>,
        source: &str,
    ) -> Result<(), String> {
        let conn = self.pool.get().map_err(|e| e.to_string())?;
        let mode: String = conn
            .query_row(
                "SELECT mode FROM vaulttube_user_playlists WHERE id = ?1",
                rusqlite::params![playlist_id],
                |row| row.get(0),
            )
            .unwrap_or_else(|_| "video".to_string());
        let next_pos: i64 = conn
            .query_row(
                "SELECT COALESCE(MAX(position), -1) + 1
                 FROM vaulttube_user_playlist_items WHERE playlist_id = ?1",
                rusqlite::params![playlist_id],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;
        conn.execute(
            "INSERT OR IGNORE INTO vaulttube_user_playlist_items
             (playlist_id, youtube_id, title, thumbnail_url, duration_seconds, channel, position, added_at, source, mode)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            rusqlite::params![
                playlist_id, youtube_id, title, thumbnail_url,
                duration_seconds, channel, next_pos, now, source, mode
            ],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn remove_user_playlist_item(
        &self,
        playlist_id: i64,
        youtube_id: &str,
    ) -> Result<(), String> {
        let conn = self.pool.get().map_err(|e| e.to_string())?;
        conn.execute(
            "DELETE FROM vaulttube_user_playlist_items
             WHERE playlist_id = ?1 AND youtube_id = ?2",
            rusqlite::params![playlist_id, youtube_id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Réordonne une playlist locale : `ordered_item_ids` donne le nouvel
    /// ordre (position = index dans le tableau).
    pub fn reorder_user_playlist(
        &self,
        playlist_id: i64,
        ordered_item_ids: &[i64],
    ) -> Result<(), String> {
        let mut conn = self.pool.get().map_err(|e| e.to_string())?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        for (idx, item_id) in ordered_item_ids.iter().enumerate() {
            tx.execute(
                "UPDATE vaulttube_user_playlist_items
                 SET position = ?1 WHERE id = ?2 AND playlist_id = ?3",
                rusqlite::params![idx as i64, item_id, playlist_id],
            )
            .map_err(|e| e.to_string())?;
        }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Bascule une playlist locale en mode video/audio et propage aux items.
    pub fn set_user_playlist_mode(&self, id: i64, mode: &str) -> Result<(), String> {
        let conn = self.pool.get().map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE vaulttube_user_playlists SET mode = ?1 WHERE id = ?2",
            rusqlite::params![mode, id],
        )
        .map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE vaulttube_user_playlist_items SET mode = ?1 WHERE playlist_id = ?2",
            rusqlite::params![mode, id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Bascule un abonnement en mode video/audio et propage aux vidéos.
    /// Refusé (message clair) si la même adresse est déjà suivie dans le mode demandé.
    pub fn set_subscription_mode(&self, id: i64, mode: &str) -> Result<(), String> {
        let mut conn = self.pool.get().map_err(|e| e.to_string())?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        tx.execute(
            "UPDATE vaulttube_subscriptions SET mode = ?1 WHERE id = ?2",
            rusqlite::params![mode, id],
        )
        .map_err(|e| friendly_subscription_error(&e, mode))?;
        tx.execute(
            "UPDATE vaulttube_videos SET mode = ?1 WHERE subscription_id = ?2",
            rusqlite::params![mode, id],
        )
        .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Base SQLite réelle (fichier temporaire) avec les réglages de l'application.
    struct TempDb {
        path: std::path::PathBuf,
        pool: DbPool,
    }

    impl TempDb {
        fn new(name: &str) -> TempDb {
            let path = std::env::temp_dir().join(format!("avm-vaulttube-{name}-{}.db", std::process::id()));
            let _ = std::fs::remove_file(&path);
            let pool = crate::db::init_pool(&path).expect("init_pool");
            TempDb { path, pool }
        }
        fn repo(&self) -> VaultTubeRepository {
            VaultTubeRepository::new(self.pool.clone())
        }
    }

    impl Drop for TempDb {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(&self.path);
        }
    }

    const URL: &str = "https://www.youtube.com/playlist?list=PLabc123";

    fn add(repo: &VaultTubeRepository, url: &str, mode: &str) -> Result<i64, String> {
        repo.add_subscription("Playlist", url, "playlist", "PLabc123", None, "youtube", mode)
    }

    #[test]
    fn les_ecritures_d_une_meme_playlist_youtube_donnent_la_meme_adresse() {
        let canonical = "https://www.youtube.com/playlist?list=PLabc123";
        for variant in [
            "https://www.youtube.com/playlist?list=PLabc123",
            "  https://www.youtube.com/playlist?list=PLabc123&si=xyz  ",
            "https://youtube.com/playlist?si=xyz&list=PLabc123",
            "http://m.youtube.com/playlist?list=PLabc123#fragment",
            "https://music.youtube.com/playlist?list=PLabc123",
            "https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLabc123&index=3",
            "https://youtu.be/dQw4w9WgXcQ?list=PLabc123",
        ] {
            assert_eq!(normalize_subscription_url(variant), canonical, "{variant}");
        }
    }

    #[test]
    fn les_autres_adresses_ne_sont_pas_modifiees() {
        for url in [
            "https://www.youtube.com/@artiste",
            "https://www.youtube.com/channel/UC1234567890",
            "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            "https://www.dailymotion.com/playlist/x7abc",
            "https://example.com/watch?list=PLabc123",
            "https://www.youtube.com/playlist?list=",
        ] {
            assert_eq!(normalize_subscription_url(url), url, "{url}");
        }
        assert_eq!(normalize_subscription_url("  https://www.youtube.com/@a  "), "https://www.youtube.com/@a");
    }

    #[test]
    fn la_meme_playlist_peut_etre_suivie_dans_les_deux_espaces() {
        let db = TempDb::new("deux-modes");
        let repo = db.repo();
        repo.create_tables().unwrap();
        // Cas du bug : la playlist est déjà dans AetherFy Vidéo, on la suit dans Musique.
        let video = add(&repo, URL, "video").unwrap();
        let audio = add(&repo, URL, "audio").expect("suivre dans l'autre mode doit fonctionner");
        assert_ne!(video, audio);
        assert_eq!(repo.find_subscription(URL, Some("audio")).unwrap().unwrap().id, audio);
        assert_eq!(repo.find_subscription(URL, Some("video")).unwrap().unwrap().id, video);
    }

    #[test]
    fn suivre_deux_fois_dans_le_meme_mode_donne_un_message_clair() {
        let db = TempDb::new("meme-mode");
        let repo = db.repo();
        repo.create_tables().unwrap();
        add(&repo, URL, "audio").unwrap();
        let err = add(&repo, URL, "audio").unwrap_err();
        assert_eq!(err, "Cette adresse est déjà suivie dans AetherFy Musique.");
        assert!(!err.contains("UNIQUE"));
    }

    #[test]
    fn find_subscription_retrouve_la_playlist_sous_une_autre_ecriture() {
        let db = TempDb::new("find");
        let repo = db.repo();
        repo.create_tables().unwrap();
        // Enregistrée autrefois avec un paramètre de suivi dans l'adresse.
        let id = repo
            .add_subscription(
                "Playlist",
                "https://www.youtube.com/playlist?list=PLabc123&si=old",
                "playlist",
                "PLabc123",
                None,
                "youtube",
                "audio",
            )
            .unwrap();
        for query in [URL, "https://music.youtube.com/playlist?list=PLabc123", "https://www.youtube.com/watch?v=x&list=PLabc123"] {
            assert_eq!(repo.find_subscription(query, Some("audio")).unwrap().map(|s| s.id), Some(id), "{query}");
            assert_eq!(repo.find_subscription(query, None).unwrap().map(|s| s.id), Some(id), "{query}");
            assert!(repo.find_subscription(query, Some("video")).unwrap().is_none(), "{query}");
        }
        assert!(repo.find_subscription("https://www.youtube.com/playlist?list=PLautre", None).unwrap().is_none());
    }

    #[test]
    fn changer_de_mode_vers_un_mode_deja_suivi_est_refuse_proprement() {
        let db = TempDb::new("bascule");
        let repo = db.repo();
        repo.create_tables().unwrap();
        let video = add(&repo, URL, "video").unwrap();
        add(&repo, URL, "audio").unwrap();
        let err = repo.set_subscription_mode(video, "audio").unwrap_err();
        assert_eq!(err, "Cette adresse est déjà suivie dans AetherFy Musique.");
        // Rien n'a bougé.
        assert_eq!(repo.find_subscription(URL, Some("video")).unwrap().unwrap().id, video);
    }

    // ---- Mise à niveau d'une base créée AVANT le correctif ----

    /// Schéma exact de l'ancienne version : `url TEXT NOT NULL UNIQUE`.
    const OLD_SCHEMA: &str = "
        CREATE TABLE vaulttube_subscriptions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            url TEXT NOT NULL UNIQUE,
            kind TEXT NOT NULL,
            youtube_id TEXT NOT NULL,
            thumbnail_url TEXT,
            added_at INTEGER NOT NULL,
            last_synced_at INTEGER,
            source TEXT NOT NULL DEFAULT 'youtube',
            mode TEXT NOT NULL DEFAULT 'video'
        );
        CREATE TABLE vaulttube_videos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            subscription_id INTEGER NOT NULL REFERENCES vaulttube_subscriptions(id) ON DELETE CASCADE,
            youtube_id TEXT NOT NULL,
            title TEXT NOT NULL,
            description TEXT,
            thumbnail_url TEXT,
            duration_seconds INTEGER,
            published_at INTEGER,
            added_at INTEGER NOT NULL,
            source TEXT NOT NULL DEFAULT 'youtube',
            mode TEXT NOT NULL DEFAULT 'video',
            is_short INTEGER NOT NULL DEFAULT 0,
            UNIQUE(subscription_id, youtube_id)
        );
        CREATE TABLE vaulttube_playlists (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            subscription_id INTEGER NOT NULL REFERENCES vaulttube_subscriptions(id) ON DELETE CASCADE,
            youtube_id TEXT NOT NULL,
            title TEXT NOT NULL,
            thumbnail_url TEXT,
            video_count INTEGER,
            added_at INTEGER NOT NULL,
            source TEXT NOT NULL DEFAULT 'youtube',
            UNIQUE(subscription_id, youtube_id)
        );";

    fn count(conn: &rusqlite::Connection, table: &str) -> i64 {
        conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0)).unwrap()
    }

    #[test]
    fn une_ancienne_base_est_mise_a_niveau_sans_perdre_aucune_donnee() {
        let db = TempDb::new("migration");
        {
            let conn = db.pool.get().unwrap();
            conn.execute_batch(OLD_SCHEMA).unwrap();
            // 3 abonnements ; le n°3 est supprimé ensuite : l'identifiant 3 ne doit pas être réattribué.
            for (i, url) in ["https://www.youtube.com/@a", URL, "https://www.youtube.com/@c"].iter().enumerate() {
                conn.execute(
                    "INSERT INTO vaulttube_subscriptions (name, url, kind, youtube_id, added_at, mode)
                     VALUES (?1, ?2, 'channel', 'x', 1, ?3)",
                    rusqlite::params![format!("Abo {i}"), url, if i == 1 { "audio" } else { "video" }],
                )
                .unwrap();
            }
            for sub in 1..=2 {
                for v in 0..5 {
                    conn.execute(
                        "INSERT INTO vaulttube_videos (subscription_id, youtube_id, title, added_at)
                         VALUES (?1, ?2, 'Titre', 1)",
                        rusqlite::params![sub, format!("vid{sub}{v}")],
                    )
                    .unwrap();
                }
                conn.execute(
                    "INSERT INTO vaulttube_playlists (subscription_id, youtube_id, title, added_at)
                     VALUES (?1, 'PLx', 'Liste', 1)",
                    [sub],
                )
                .unwrap();
            }
            conn.execute("DELETE FROM vaulttube_subscriptions WHERE id = 3", []).unwrap();
            // L'ancienne contrainte est bien là : c'est le bug.
            let err = conn
                .execute(
                    "INSERT INTO vaulttube_subscriptions (name, url, kind, youtube_id, added_at, mode)
                     VALUES ('Doublon', ?1, 'playlist', 'PLabc123', 1, 'audio')",
                    [URL],
                )
                .unwrap_err()
                .to_string();
            assert!(err.contains("UNIQUE constraint failed: vaulttube_subscriptions.url"), "{err}");
        }

        let repo = db.repo();
        repo.create_tables().expect("la mise à niveau ne doit pas empêcher le démarrage");

        let conn = db.pool.get().unwrap();
        assert_eq!(count(&conn, "vaulttube_subscriptions"), 2);
        assert_eq!(count(&conn, "vaulttube_videos"), 10, "les vidéos synchronisées doivent être conservées");
        assert_eq!(count(&conn, "vaulttube_playlists"), 2);
        let fk: i64 = conn.query_row("PRAGMA foreign_keys", [], |r| r.get(0)).unwrap();
        assert_eq!(fk, 1, "les clés étrangères doivent être rétablies avant le retour au pool");

        // Les abonnements existants gardent leur contenu.
        let subs = repo.list_subscriptions().unwrap();
        assert_eq!(subs.len(), 2);
        assert_eq!(repo.find_subscription(URL, Some("audio")).unwrap().unwrap().id, 2);

        // Le bug est corrigé : même adresse dans l'autre mode ; même mode = message clair.
        add(&repo, URL, "video").expect("la même adresse dans l'autre mode doit être acceptée");
        assert_eq!(
            add(&repo, URL, "audio").unwrap_err(),
            "Cette adresse est déjà suivie dans AetherFy Musique."
        );
        // L'identifiant 3 (supprimé) n'est pas réattribué.
        assert_eq!(repo.find_subscription(URL, Some("video")).unwrap().unwrap().id, 4);

        // La cascade fonctionne toujours après la reconstruction.
        conn.execute("DELETE FROM vaulttube_subscriptions WHERE id = 1", []).unwrap();
        assert_eq!(count(&conn, "vaulttube_videos"), 5);
        assert_eq!(count(&conn, "vaulttube_playlists"), 1);

        // Idempotent : un second démarrage ne reconstruit rien.
        drop(conn);
        repo.create_tables().unwrap();
        let mut conn = db.pool.get().unwrap();
        assert!(!upgrade_subscription_uniqueness(&mut conn).unwrap());
        assert_eq!(count(&conn, "vaulttube_videos"), 5);
    }

    #[test]
    fn une_base_neuve_a_directement_le_bon_schema() {
        let db = TempDb::new("neuve");
        let repo = db.repo();
        repo.create_tables().unwrap();
        let mut conn = db.pool.get().unwrap();
        assert!(!upgrade_subscription_uniqueness(&mut conn).unwrap(), "rien à reconstruire sur une base neuve");
    }

    #[test]
    fn une_base_tres_ancienne_sans_colonne_mode_n_est_pas_touchee() {
        let db = TempDb::new("tres-ancienne");
        {
            let conn = db.pool.get().unwrap();
            conn.execute_batch(
                "CREATE TABLE vaulttube_subscriptions (
                     id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, url TEXT NOT NULL UNIQUE,
                     kind TEXT NOT NULL, youtube_id TEXT NOT NULL, thumbnail_url TEXT,
                     added_at INTEGER NOT NULL, last_synced_at INTEGER);
                 INSERT INTO vaulttube_subscriptions (name, url, kind, youtube_id, added_at)
                     VALUES ('Vieux', 'https://www.youtube.com/@v', 'channel', 'UC1', 1);",
            )
            .unwrap();
        }
        let mut conn = db.pool.get().unwrap();
        assert!(!upgrade_subscription_uniqueness(&mut conn).unwrap());
        assert_eq!(count(&conn, "vaulttube_subscriptions"), 1);
    }

    #[test]
    fn si_la_mise_a_niveau_est_impossible_le_message_reste_lisible() {
        // Ancien schéma conservé (ex. mise à niveau reportée) : jamais de texte SQLite brut.
        let db = TempDb::new("ancien-schema");
        {
            let conn = db.pool.get().unwrap();
            conn.execute_batch(OLD_SCHEMA).unwrap();
        }
        let repo = db.repo();
        add(&repo, URL, "video").unwrap();
        let err = add(&repo, URL, "audio").unwrap_err();
        assert_eq!(err, "Cette adresse est déjà suivie dans l'autre espace (AetherFy Vidéo ou Musique).");
    }

    // ---- Chaîne YouTube = nom d'artiste (AetherFy Musique) ----

    fn add_track(repo: &VaultTubeRepository, sub: i64, id: &str, channel: Option<&str>) {
        repo.add_video(sub, id, "Titre", None, None, Some(180), None, "youtube", false, channel).unwrap();
    }

    fn channel_of(repo: &VaultTubeRepository, sub: i64, id: &str) -> Option<String> {
        repo.list_videos(sub).unwrap().into_iter().find(|v| v.youtube_id == id).unwrap().channel
    }

    #[test]
    fn la_chaine_est_enregistree_puis_rattrapee_sans_toucher_au_reste() {
        let db = TempDb::new("chaine");
        let repo = db.repo();
        repo.create_tables().unwrap();
        let sub = add(&repo, URL, "audio").unwrap();

        // Synchronisation d'avant : pas de chaîne.
        add_track(&repo, sub, "a", None);
        assert_eq!(channel_of(&repo, sub, "a"), None);
        // Resynchronisation : la chaîne est rattrapée sur la vidéo DÉJÀ en base…
        add_track(&repo, sub, "a", Some("Alohaii"));
        assert_eq!(channel_of(&repo, sub, "a").as_deref(), Some("Alohaii"));
        // …sans créer de doublon, ni changer le titre ou la durée.
        let videos = repo.list_videos(sub).unwrap();
        assert_eq!(videos.len(), 1);
        assert_eq!((videos[0].title.as_str(), videos[0].duration_seconds), ("Titre", Some(180)));
        // Une synchronisation qui ne fournit pas la chaîne n'efface pas celle qu'on connaît.
        add_track(&repo, sub, "a", None);
        assert_eq!(channel_of(&repo, sub, "a").as_deref(), Some("Alohaii"));
        // Une chaîne renommée est mise à jour.
        add_track(&repo, sub, "a", Some("Alohaii Music"));
        assert_eq!(channel_of(&repo, sub, "a").as_deref(), Some("Alohaii Music"));
    }

    #[test]
    fn une_ancienne_base_recoit_la_colonne_chaine_sans_perdre_ses_videos() {
        let db = TempDb::new("chaine-ancienne");
        {
            let conn = db.pool.get().unwrap();
            conn.execute_batch(OLD_SCHEMA).unwrap(); // vidéos SANS colonne `channel`
            conn.execute(
                "INSERT INTO vaulttube_subscriptions (name, url, kind, youtube_id, added_at, mode) VALUES ('P', ?1, 'playlist', 'PLabc123', 1, 'audio')",
                [URL],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO vaulttube_videos (subscription_id, youtube_id, title, added_at, mode) VALUES (1, 'v1', 'Ancienne piste', 1, 'audio')",
                [],
            )
            .unwrap();
        }
        let repo = db.repo();
        repo.create_tables().unwrap();
        repo.create_tables().unwrap(); // idempotent : la colonne n'est ajoutée qu'une fois

        let videos = repo.list_videos(1).unwrap();
        assert_eq!(videos.len(), 1);
        assert_eq!(videos[0].title, "Ancienne piste");
        assert_eq!(videos[0].channel, None);
        add_track(&repo, 1, "v1", Some("DOWNFVLL"));
        assert_eq!(channel_of(&repo, 1, "v1").as_deref(), Some("DOWNFVLL"));
    }

    // ---- Image des playlists locales ----

    const PIXEL: &str = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/";

    fn playlist_with_items(repo: &VaultTubeRepository, name: &str, thumbs: &[Option<&str>]) -> i64 {
        let id = repo.create_user_playlist(name, "audio").unwrap();
        for (i, t) in thumbs.iter().enumerate() {
            repo.add_user_playlist_item(
                id, &format!("vid{i}"), &format!("Titre {i}"), *t, Some(100), Some("Chaîne"), "youtube",
            )
            .unwrap();
        }
        id
    }

    fn find(repo: &VaultTubeRepository, id: i64) -> UserPlaylist {
        repo.list_user_playlists().unwrap().into_iter().find(|p| p.id == id).unwrap()
    }

    #[test]
    fn l_image_par_defaut_est_faite_de_4_vignettes_distinctes_dans_l_ordre() {
        let db = TempDb::new("mosaique");
        let repo = db.repo();
        repo.create_tables().unwrap();
        let id = playlist_with_items(
            &repo,
            "Mix",
            &[Some("a.jpg"), Some("a.jpg"), None, Some("b.jpg"), Some("c.jpg"), Some("d.jpg"), Some("e.jpg")],
        );
        let p = find(&repo, id);
        assert_eq!(p.preview_thumbnails, ["a.jpg", "b.jpg", "c.jpg", "d.jpg"]);
        assert_eq!(p.item_count, 7);
        assert_eq!(p.cover_image, None);
    }

    #[test]
    fn une_playlist_vide_ou_sans_vignette_n_a_pas_d_apercu() {
        let db = TempDb::new("sans-apercu");
        let repo = db.repo();
        repo.create_tables().unwrap();
        let vide = playlist_with_items(&repo, "Vide", &[]);
        let sans = playlist_with_items(&repo, "Sans", &[None, Some("")]);
        assert!(find(&repo, vide).preview_thumbnails.is_empty());
        assert!(find(&repo, sans).preview_thumbnails.is_empty());
    }

    #[test]
    fn les_apercus_ne_se_melangent_pas_d_une_playlist_a_l_autre() {
        let db = TempDb::new("apercus-separes");
        let repo = db.repo();
        repo.create_tables().unwrap();
        let a = playlist_with_items(&repo, "A", &[Some("a1.jpg"), Some("a2.jpg")]);
        let b = playlist_with_items(&repo, "B", &[Some("b1.jpg")]);
        assert_eq!(find(&repo, a).preview_thumbnails, ["a1.jpg", "a2.jpg"]);
        assert_eq!(find(&repo, b).preview_thumbnails, ["b1.jpg"]);
    }

    #[test]
    fn l_image_choisie_est_enregistree_puis_retiree() {
        let db = TempDb::new("image-choisie");
        let repo = db.repo();
        repo.create_tables().unwrap();
        let id = playlist_with_items(&repo, "Ma playlist", &[Some("a.jpg")]);
        repo.set_user_playlist_cover(id, Some(PIXEL)).unwrap();
        assert_eq!(find(&repo, id).cover_image.as_deref(), Some(PIXEL));
        // L'aperçu reste disponible (l'interface choisit l'image de l'utilisateur en priorité).
        assert_eq!(find(&repo, id).preview_thumbnails, ["a.jpg"]);
        repo.set_user_playlist_cover(id, None).unwrap();
        assert_eq!(find(&repo, id).cover_image, None);
        repo.set_user_playlist_cover(id, Some(PIXEL)).unwrap();
        repo.set_user_playlist_cover(id, Some("")).unwrap(); // chaîne vide = retirer
        assert_eq!(find(&repo, id).cover_image, None);
    }

    #[test]
    fn les_images_invalides_sont_refusees_sans_rien_modifier() {
        let db = TempDb::new("image-invalide");
        let repo = db.repo();
        repo.create_tables().unwrap();
        let id = playlist_with_items(&repo, "P", &[]);
        repo.set_user_playlist_cover(id, Some(PIXEL)).unwrap();
        let trop_lourde = format!("data:image/png;base64,{}", "A".repeat(MAX_COVER_IMAGE_LEN));
        for mauvaise in [
            "https://exemple.com/image.jpg",
            "data:text/html;base64,PHNjcmlwdD4=",
            "data:image/svg+xml;base64,PHN2Zz4=",
            "data:image/png;base64,",
            "data:image/png;base64,<script>alert(1)</script>",
            trop_lourde.as_str(),
        ] {
            assert!(repo.set_user_playlist_cover(id, Some(mauvaise)).is_err(), "{mauvaise:.40}");
        }
        assert_eq!(find(&repo, id).cover_image.as_deref(), Some(PIXEL), "l'ancienne image est conservée");
        assert_eq!(repo.set_user_playlist_cover(9999, Some(PIXEL)).unwrap_err(), "Playlist introuvable.");
    }

    #[test]
    fn une_ancienne_base_recoit_la_colonne_image_sans_perdre_ses_playlists() {
        let db = TempDb::new("image-ancienne");
        {
            let conn = db.pool.get().unwrap();
            conn.execute_batch(
                "CREATE TABLE vaulttube_user_playlists (
                     id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
                     created_at INTEGER NOT NULL, mode TEXT NOT NULL DEFAULT 'video');
                 INSERT INTO vaulttube_user_playlists (name, created_at, mode) VALUES ('Ancienne', 1, 'audio');",
            )
            .unwrap();
        }
        let repo = db.repo();
        repo.create_tables().unwrap();
        repo.create_tables().unwrap();
        let p = repo.list_user_playlists().unwrap();
        assert_eq!(p.len(), 1);
        assert_eq!(p[0].name, "Ancienne");
        repo.set_user_playlist_cover(p[0].id, Some(PIXEL)).unwrap();
        assert_eq!(find(&repo, p[0].id).cover_image.as_deref(), Some(PIXEL));
    }
}
