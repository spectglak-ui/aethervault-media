//! Synchronisation via yt-dlp : métadonnées de chaînes/playlists,
//! playlists liées, aperçus sans sauvegarde, recherche YouTube.
use super::models::{SearchResult, VaultTubeSubscription, VaultTubeVideo};
use super::repository::VaultTubeRepository;
use std::path::PathBuf;
use std::process::Command;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

pub struct VaultTubeSync {
    repo: VaultTubeRepository,
    ytdlp_path: Option<PathBuf>,
}

/// Miniature YouTube garantie (motif d'URL officiel) — utilisée quand
/// yt-dlp ne fournit pas de vignette (entrées récentes en mode flat).
pub fn fallback_thumbnail(youtube_id: &str) -> String {
    format!("https://i.ytimg.com/vi/{youtube_id}/hqdefault.jpg")
}

fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64
}

/// Parse une date yt-dlp "YYYYMMDD" en timestamp Unix.
fn parse_upload_date(date: Option<&str>) -> Option<i64> {
    let date = date?;
    if date.len() != 8 {
        return None;
    }
    let year = date[0..4].parse::<i32>().ok()?;
    let month = date[4..6].parse::<u32>().ok()?;
    let day = date[6..8].parse::<u32>().ok()?;
    let naive = chrono::NaiveDate::from_ymd_opt(year, month, day)?.and_hms_opt(0, 0, 0)?;
    Some(naive.and_utc().timestamp())
}

/// Extrait la vignette d'une entrée flat (thumbnail ou thumbnails[].url).
fn entry_thumbnail(entry: &serde_json::Value) -> Option<String> {
    entry
        .get("thumbnail")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .or_else(|| {
            entry.get("thumbnails").and_then(|t| {
                t.as_array().and_then(|arr| {
                    arr.last()
                        .and_then(|last| last.get("url").and_then(|u| u.as_str()))
                })
            })
            .map(|s| s.to_string())
        })
}

impl VaultTubeSync {
    pub fn new(repo: VaultTubeRepository) -> Self {
        let ytdlp_path = locate_ytdlp();
        Self { repo, ytdlp_path }
    }

    fn ytdlp(&self) -> Result<&PathBuf, String> {
        self.ytdlp_path
            .as_ref()
            .ok_or_else(|| "yt-dlp introuvable".to_string())
    }

    /// Sonde une URL de chaîne/playlist : nom, id, type et miniature.
    pub fn probe_url(
        &self,
        url: &str,
    ) -> Result<(String, String, String, Option<String>), String> {
        let ytdlp = self.ytdlp()?;
        let mut cmd = Command::new(ytdlp);
        cmd.args(["-J", "--flat-playlist", "--playlist-end", "1", "--no-warnings", url]);
        #[cfg(windows)]
        cmd.creation_flags(0x08000000);
        let output = cmd.output().map_err(|e| format!("yt-dlp : {e}"))?;
        if !output.status.success() {
            return Err(format!(
                "yt-dlp en échec : {}",
                String::from_utf8_lossy(&output.stderr).trim()
            ));
        }
        let json: serde_json::Value =
            serde_json::from_slice(&output.stdout).map_err(|e| e.to_string())?;
        let name = json
            .get("title")
            .or_else(|| json.get("playlist_title"))
            .and_then(|v| v.as_str())
            .unwrap_or("Sans nom")
            .to_string();
        let youtube_id = json
            .get("id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let mut thumbnail = entry_thumbnail(&json);
        if thumbnail.is_none() {
            let mut cmd2 = Command::new(ytdlp);
            cmd2.args(["-J", "--no-warnings", "--playlist-items", "1", url]);
            #[cfg(windows)]
            cmd2.creation_flags(0x08000000);
            if let Ok(o2) = cmd2.output() {
                if o2.status.success() {
                    if let Ok(j2) = serde_json::from_slice::<serde_json::Value>(&o2.stdout) {
                        thumbnail = j2
                            .get("entries")
                            .and_then(|e| e.as_array())
                            .and_then(|a| a.first())
                            .and_then(|e| e.get("channel_thumbnail"))
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string());
                    }
                }
            }
        }
        let kind = if url.contains("list=") || url.contains("/playlist") {
            "playlist"
        } else {
            "channel"
        };
        Ok((name, youtube_id, kind.to_string(), thumbnail))
    }

    /// Synchronise les vidéos d'un abonnement (50 max).
    pub fn sync_subscription(&self, sub: &VaultTubeSubscription) -> Result<usize, String> {
        let ytdlp = self.ytdlp()?;
        log::info!("[vaulttube] sync : {} ({})", sub.name, sub.url);
        let mut cmd = Command::new(ytdlp);
        cmd.args([
            "--flat-playlist",
            "--dump-json",
            "--no-warnings",
            "--playlist-end",
            "50",
            &sub.url,
        ]);
        #[cfg(windows)]
        cmd.creation_flags(0x08000000);
        let output = cmd.output().map_err(|e| format!("yt-dlp : {e}"))?;
        if !output.status.success() {
            return Err(format!(
                "yt-dlp en échec : {}",
                String::from_utf8_lossy(&output.stderr).trim()
            ));
        }
        let mut count = 0;
        for line in String::from_utf8_lossy(&output.stdout).lines() {
            if let Ok(video) = serde_json::from_str::<serde_json::Value>(line) {
                let youtube_id = video.get("id").and_then(|v| v.as_str()).unwrap_or("");
                let title = video.get("title").and_then(|v| v.as_str()).unwrap_or("");
                if youtube_id.is_empty() || title.is_empty() {
                    continue;
                }
                let thumb = entry_thumbnail(&video)
                    .unwrap_or_else(|| fallback_thumbnail(youtube_id));
                let duration = video.get("duration").and_then(|v| v.as_i64());
                let published_at = parse_upload_date(
                    video.get("upload_date").and_then(|v| v.as_str()),
                );
                let _ = self.repo.add_video(
                    sub.id,
                    youtube_id,
                    title,
                    None,
                    Some(&thumb),
                    duration,
                    published_at,
                );
                count += 1;
            }
        }
        let _ = self.repo.update_last_synced(sub.id);
        log::info!("[vaulttube] {} vidéo(s) synchronisée(s)", count);
        Ok(count)
    }

    /// Synchronise les playlists publiques d'une chaîne (onglet /playlists).
    pub fn sync_playlists(&self, sub: &VaultTubeSubscription) -> Result<usize, String> {
        if sub.kind != "channel" {
            return Ok(0);
        }
        let ytdlp = self.ytdlp()?;
        let url = format!("{}/playlists", sub.url.trim_end_matches('/'));
        log::info!("[vaulttube] sync playlists : {}", url);
        let mut cmd = Command::new(ytdlp);
        cmd.args([
            "--flat-playlist",
            "--dump-json",
            "--no-warnings",
            "--playlist-end",
            "100",
            &url,
        ]);
        #[cfg(windows)]
        cmd.creation_flags(0x08000000);
        let output = cmd.output().map_err(|e| format!("yt-dlp : {e}"))?;
        if !output.status.success() {
            return Err(format!(
                "yt-dlp en échec : {}",
                String::from_utf8_lossy(&output.stderr).trim()
            ));
        }
        let mut count = 0;
        for line in String::from_utf8_lossy(&output.stdout).lines() {
            if let Ok(entry) = serde_json::from_str::<serde_json::Value>(line) {
                let pid = entry.get("id").and_then(|v| v.as_str()).unwrap_or("");
                let title = entry.get("title").and_then(|v| v.as_str()).unwrap_or("");
                if pid.is_empty() || title.is_empty() {
                    continue;
                }
                let thumb = entry_thumbnail(&entry);
                let video_count = entry
                    .get("playlist_count")
                    .or_else(|| entry.get("video_count"))
                    .and_then(|v| v.as_i64());
                let _ = self
                    .repo
                    .upsert_playlist(sub.id, pid, title, thumb.as_deref(), video_count);
                count += 1;
            }
        }
        log::info!("[vaulttube] {} playlist(s) synchronisée(s)", count);
        Ok(count)
    }

    /// Aperçu SANS sauvegarde des vidéos d'une URL (playlist non suivie).
    pub fn preview_videos(&self, url: &str) -> Result<Vec<VaultTubeVideo>, String> {
        let ytdlp = self.ytdlp()?;
        let mut cmd = Command::new(ytdlp);
        cmd.args([
            "--flat-playlist",
            "--dump-json",
            "--no-warnings",
            "--playlist-end",
            "100",
            url,
        ]);
        #[cfg(windows)]
        cmd.creation_flags(0x08000000);
        let output = cmd.output().map_err(|e| format!("yt-dlp : {e}"))?;
        if !output.status.success() {
            return Err(format!(
                "yt-dlp en échec : {}",
                String::from_utf8_lossy(&output.stderr).trim()
            ));
        }
        let mut out = Vec::new();
        for line in String::from_utf8_lossy(&output.stdout).lines() {
            if let Ok(video) = serde_json::from_str::<serde_json::Value>(line) {
                let youtube_id = video.get("id").and_then(|v| v.as_str()).unwrap_or("");
                let title = video.get("title").and_then(|v| v.as_str()).unwrap_or("");
                if youtube_id.is_empty() || title.is_empty() {
                    continue;
                }
                let thumb = entry_thumbnail(&video)
                    .unwrap_or_else(|| fallback_thumbnail(youtube_id));
                out.push(VaultTubeVideo {
                    id: 0,
                    subscription_id: 0,
                    youtube_id: youtube_id.to_string(),
                    title: title.to_string(),
                    description: None,
                    thumbnail_url: Some(thumb),
                    duration_seconds: video.get("duration").and_then(|v| v.as_i64()),
                    published_at: parse_upload_date(
                        video.get("upload_date").and_then(|v| v.as_str()),
                    ),
                    added_at: now_secs(),
                });
            }
        }
        Ok(out)
    }

    /// Recherche YouTube (vidéos, chaînes, playlists) via `ytsearch`.
    /// Renvoie les 20 premiers résultats typés.
    pub fn search(&self, query: &str) -> Result<Vec<SearchResult>, String> {
        if query.trim().is_empty() {
            return Ok(Vec::new());
        }
        let ytdlp = self.ytdlp()?;
        log::info!("[vaulttube] search : {}", query);
        let mut cmd = Command::new(ytdlp);
        cmd.args([
            "--flat-playlist",
            "--dump-json",
            "--no-warnings",
            &format!("ytsearch20:{query}"),
        ]);
        #[cfg(windows)]
        cmd.creation_flags(0x08000000);
        let output = cmd.output().map_err(|e| format!("yt-dlp : {e}"))?;
        if !output.status.success() {
            return Err(format!(
                "yt-dlp en échec : {}",
                String::from_utf8_lossy(&output.stderr).trim()
            ));
        }
        let mut results = Vec::new();
        for line in String::from_utf8_lossy(&output.stdout).lines() {
            if let Ok(entry) = serde_json::from_str::<serde_json::Value>(line) {
                let id = entry.get("id").and_then(|v| v.as_str()).unwrap_or("");
                let title = entry.get("title").and_then(|v| v.as_str()).unwrap_or("");
                if id.is_empty() || title.is_empty() {
                    continue;
                }
                let url = entry
                    .get("url")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string())
                    .unwrap_or_else(|| format!("https://www.youtube.com/watch?v={id}"));
                let thumb = entry_thumbnail(&entry).or_else(|| {
                    if url.contains("watch?v=") {
                        Some(fallback_thumbnail(id))
                    } else {
                        None
                    }
                });
                let kind = if url.contains("list=") || url.contains("/playlist") {
                    "playlist"
                } else if url.contains("/@") || url.contains("/channel/") {
                    "channel"
                } else {
                    "video"
                };
                let duration = entry.get("duration").and_then(|v| v.as_i64());
                let channel = entry
                    .get("channel")
                    .or_else(|| entry.get("uploader"))
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                let video_count = entry
                    .get("playlist_count")
                    .or_else(|| entry.get("video_count"))
                    .and_then(|v| v.as_i64());
                results.push(SearchResult {
                    id: id.to_string(),
                    title: title.to_string(),
                    url,
                    kind: kind.to_string(),
                    thumbnail_url: thumb,
                    channel,
                    duration_seconds: duration,
                    video_count,
                });
            }
        }
        Ok(results)
    }
}

/// Localise yt-dlp (même logique que playback_engine).
fn locate_ytdlp() -> Option<PathBuf> {
    let mut dirs: Vec<PathBuf> = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            dirs.push(dir.to_path_buf());
            dirs.push(dir.join("resources"));
        }
    }
    if let Ok(cwd) = std::env::current_dir() {
        dirs.push(cwd);
    }
    for dir in dirs {
        for name in ["yt-dlp.exe", "yt-dlp"] {
            let candidate = dir.join(name);
            if candidate.exists() {
                return Some(candidate);
            }
        }
    }
    None
}