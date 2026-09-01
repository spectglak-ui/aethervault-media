//! Opérations SQLite pour VaultTube.
use crate::db::DbPool;
use super::models::{UserPlaylist, UserPlaylistItem, VaultTubePlaylist, VaultTubeSubscription, VaultTubeVideo};

pub struct VaultTubeRepository {
    pool: DbPool,
}

impl VaultTubeRepository {
    pub fn new(pool: DbPool) -> Self {
        Self { pool }
    }

    /// Crée les tables VaultTube si elles n'existent pas.
    pub fn create_tables(&self) -> Result<(), String> {
        let conn = self.pool.get().map_err(|e| e.to_string())?;
        conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS vaulttube_subscriptions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                url TEXT NOT NULL UNIQUE,
                kind TEXT NOT NULL,
                youtube_id TEXT NOT NULL,
                thumbnail_url TEXT,
                added_at INTEGER NOT NULL,
                last_synced_at INTEGER
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
                UNIQUE(subscription_id, youtube_id)
            );
            CREATE TABLE IF NOT EXISTS vaulttube_user_playlists (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                created_at INTEGER NOT NULL
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
                UNIQUE(playlist_id, youtube_id)
            );
            ",
        )
        .map_err(|e| e.to_string())?;
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
    ) -> Result<i64, String> {
        let conn = self.pool.get().map_err(|e| e.to_string())?;
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;
        conn.execute(
            "INSERT INTO vaulttube_subscriptions (name, url, kind, youtube_id, thumbnail_url, added_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params![name, url, kind, youtube_id, thumbnail_url, now],
        )
        .map_err(|e| e.to_string())?;
        Ok(conn.last_insert_rowid())
    }

    /// Liste tous les abonnements.
    pub fn list_subscriptions(&self) -> Result<Vec<VaultTubeSubscription>, String> {
        let conn = self.pool.get().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT id, name, url, kind, youtube_id, thumbnail_url, added_at, last_synced_at
                 FROM vaulttube_subscriptions
                 ORDER BY added_at DESC",
            )
            .map_err(|e| e.to_string())?;
        let subs = stmt
            .query_map([], |row| {
                Ok(VaultTubeSubscription {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    url: row.get(2)?,
                    kind: row.get(3)?,
                    youtube_id: row.get(4)?,
                    thumbnail_url: row.get(5)?,
                    added_at: row.get(6)?,
                    last_synced_at: row.get(7)?,
                })
            })
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        Ok(subs)
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

    /// Ajoute une vidéo (ignore si déjà présente).
    pub fn add_video(
        &self,
        subscription_id: i64,
        youtube_id: &str,
        title: &str,
        description: Option<&str>,
        thumbnail_url: Option<&str>,
        duration_seconds: Option<i64>,
        published_at: Option<i64>,
    ) -> Result<(), String> {
        let conn = self.pool.get().map_err(|e| e.to_string())?;
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;
        conn.execute(
            "INSERT OR IGNORE INTO vaulttube_videos
             (subscription_id, youtube_id, title, description, thumbnail_url, duration_seconds, published_at, added_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            rusqlite::params![
                subscription_id,
                youtube_id,
                title,
                description,
                thumbnail_url,
                duration_seconds,
                published_at,
                now
            ],
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
                        duration_seconds, published_at, added_at
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
    ) -> Result<(), String> {
        let conn = self.pool.get().map_err(|e| e.to_string())?;
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;
        conn.execute(
            "INSERT INTO vaulttube_playlists
             (subscription_id, youtube_id, title, thumbnail_url, video_count, added_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(subscription_id, youtube_id) DO UPDATE SET
               title = excluded.title,
               thumbnail_url = excluded.thumbnail_url,
               video_count = excluded.video_count",
            rusqlite::params![subscription_id, youtube_id, title, thumbnail_url, video_count, now],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Liste les playlists d'une chaîne.
    pub fn list_playlists(&self, subscription_id: i64) -> Result<Vec<VaultTubePlaylist>, String> {
        let conn = self.pool.get().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT id, subscription_id, youtube_id, title, thumbnail_url, video_count, added_at
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

    pub fn create_user_playlist(&self, name: &str) -> Result<i64, String> {
        let conn = self.pool.get().map_err(|e| e.to_string())?;
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;
        conn.execute(
            "INSERT INTO vaulttube_user_playlists (name, created_at) VALUES (?1, ?2)",
            rusqlite::params![name, now],
        )
        .map_err(|e| e.to_string())?;
        Ok(conn.last_insert_rowid())
    }

    pub fn list_user_playlists(&self) -> Result<Vec<UserPlaylist>, String> {
        let conn = self.pool.get().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT p.id, p.name, p.created_at,
                        (SELECT COUNT(*) FROM vaulttube_user_playlist_items i
                         WHERE i.playlist_id = p.id) AS item_count
                 FROM vaulttube_user_playlists p
                 ORDER BY p.name ASC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok(UserPlaylist {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    created_at: row.get(2)?,
                    item_count: row.get(3)?,
                })
            })
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        Ok(rows)
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
                        duration_seconds, channel, position, added_at
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
                })
            })
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        Ok(rows)
    }

    /// Ajoute une vidéo à la fin d'une playlist locale (doublon ignoré).
    pub fn add_user_playlist_item(
        &self,
        playlist_id: i64,
        youtube_id: &str,
        title: &str,
        thumbnail_url: Option<&str>,
        duration_seconds: Option<i64>,
        channel: Option<&str>,
    ) -> Result<(), String> {
        let conn = self.pool.get().map_err(|e| e.to_string())?;
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
             (playlist_id, youtube_id, title, thumbnail_url, duration_seconds, channel, position, added_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            rusqlite::params![
                playlist_id,
                youtube_id,
                title,
                thumbnail_url,
                duration_seconds,
                channel,
                next_pos,
                now
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
}