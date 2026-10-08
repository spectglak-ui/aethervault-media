//! Synchronisation via yt-dlp : métadonnées de chaînes/playlists,
//! playlists liées, aperçus sans sauvegarde, recherche multi-sources.
use super::models::{Comment, SearchResult, VaultTubeSubscription, VaultTubeVideo};
use super::repository::VaultTubeRepository;
use std::path::PathBuf;
use std::process::Command;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

pub struct VaultTubeSync {
    repo: VaultTubeRepository,
    ytdlp_path: Option<PathBuf>,
}

fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64
}

fn parse_upload_date(date: Option<&str>) -> Option<i64> {
    let date = date?;
    if date.len() != 8 { return None; }
    let year = date[0..4].parse::<i32>().ok()?;
    let month = date[4..6].parse::<u32>().ok()?;
    let day = date[6..8].parse::<u32>().ok()?;
    let naive = chrono::NaiveDate::from_ymd_opt(year, month, day)?.and_hms_opt(0, 0, 0)?;
    Some(naive.and_utc().timestamp())
}

fn detect_short(entry: &serde_json::Value) -> bool {
    if let Some(d) = entry.get("duration").and_then(|v| v.as_i64()) {
        if d > 0 && d <= 60 { return true; }
    }
    let w = entry.get("width").and_then(|v| v.as_i64());
    let h = entry.get("height").and_then(|v| v.as_i64());
    if let (Some(w), Some(h)) = (w, h) {
        if h > w { return true; }
    }
    false
}

fn entry_thumbnail(entry: &serde_json::Value) -> Option<String> {
    entry.get("thumbnail").and_then(|v| v.as_str()).map(|s| s.to_string())
        .or_else(|| {
            entry.get("thumbnails").and_then(|t| {
                t.as_array().and_then(|arr| {
                    arr.last().and_then(|last| last.get("url").and_then(|u| u.as_str()))
                })
            }).map(|s| s.to_string())
        })
}

fn name_from_url(url: &str) -> String {
    let path = url.split('?').next().unwrap_or(url);
    let seg: Vec<&str> = path.trim_end_matches('/').split('/').filter(|s| !s.is_empty()).collect();
    let last = seg.last().copied().unwrap_or("");
    let cand = if last.contains('.') && !last.starts_with('@') {
        seg.get(seg.len().saturating_sub(2)).copied().unwrap_or("")
    } else { last };
    let cand = cand.strip_prefix('@').unwrap_or(cand);
    if cand.is_empty() { "Sans nom".to_string() } 
    else {
        let mut chars = cand.chars();
        match chars.next() {
            Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
            None => "Sans nom".to_string(),
        }
    }
}

pub fn detect_source(url: &str) -> &'static str {
    let u = url.to_lowercase();
    if u.contains("youtube.com") || u.contains("youtu.be") || u.contains("ytsearch") || u.contains("youtubekids.com") || u.contains("music.youtube.com") { "youtube" }
    else if u.contains("dailymotion.com") || u.contains("dai.ly") { "dailymotion" }
    else if u.contains("vimeo.com") { "vimeo" }
    else if u.contains("/c/") && u.contains("/videos") && !u.contains("youtube.com") { "peertube" }
    else { "generic" }
}

fn search_prefix(source: &str) -> Option<&'static str> {
    match source {
        "youtube" => Some("ytsearch20:"),
        "dailymotion" => Some("dmsearch20:"),
        _ => Some("ytsearch20:"),
    }
}

fn fallback_thumbnail_for(source: &str, id: &str) -> Option<String> {
    match source {
        "youtube" => Some(format!("https://i.ytimg.com/vi/{id}/hqdefault.jpg")),
        "dailymotion" => Some(format!("https://www.dailymotion.com/thumbnail/video/{id}")),
        _ => None,
    }
}

impl VaultTubeSync {
	    /// 0.8.2 — téléchargement complet (vidéo+audio fusionnés en mp4)
    /// dans le dossier fourni. Bloquant : à appeler depuis un thread.
    pub fn download_video(
        &self,
        video_id: &str,
        source: Option<&str>,
        dest: &std::path::Path,
    ) -> Result<(), String> {
        let src = source.unwrap_or("youtube");
        let url = match src {
            "dailymotion" => format!("https://www.dailymotion.com/video/{video_id}"),
            _ => format!("https://www.youtube.com/watch?v={video_id}"),
        };
        let ytdlp = self.ytdlp()?;
        let out = dest.join("%(title)s.%(ext)s");
        let mut cmd = Command::new(ytdlp);
        cmd.args([
            "-f", "bv*+ba/b",
            "--merge-output-format", "mp4",
            "--no-warnings",
            "-o", &out.to_string_lossy(),
            &url,
        ]);
        #[cfg(windows)]
        cmd.creation_flags(0x08000000);
        let status = cmd.status().map_err(|e| format!("yt-dlp : {e}"))?;
        if status.success() {
            Ok(())
        } else {
            Err("yt-dlp a échoué".to_string())
        }
    }
    pub fn new(repo: VaultTubeRepository) -> Self {
        let ytdlp_path = locate_ytdlp();
        Self { repo, ytdlp_path }
    }

    fn ytdlp(&self) -> Result<&PathBuf, String> {
        self.ytdlp_path.as_ref().ok_or_else(|| "yt-dlp introuvable".to_string())
    }

    pub fn probe_url(&self, url: &str) -> Result<(String, String, String, Option<String>, String), String> {
        let source = detect_source(url).to_string();
        let ytdlp = self.ytdlp()?;
        let mut cmd = Command::new(ytdlp);
        cmd.args(["-J", "--flat-playlist", "--playlist-end", "1", "--no-warnings", url]);
        #[cfg(windows)] cmd.creation_flags(0x08000000);
        let output = cmd.output().map_err(|e| format!("yt-dlp : {e}"))?;
        if !output.status.success() {
            return Err(format!("yt-dlp en échec : {}", String::from_utf8_lossy(&output.stderr).trim()));
        }
        let json: serde_json::Value = serde_json::from_slice(&output.stdout).map_err(|e| e.to_string())?;
        let name = json.get("title").or_else(|| json.get("playlist_title")).or_else(|| json.get("uploader")).or_else(|| json.get("channel"))
            .and_then(|v| v.as_str()).filter(|s| !s.is_empty()).map(|s| s.to_string()).unwrap_or_else(|| name_from_url(url));
        let youtube_id = json.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let mut thumbnail = entry_thumbnail(&json);
        if thumbnail.is_none() && source == "youtube" {
            let mut cmd2 = Command::new(ytdlp);
            cmd2.args(["-J", "--no-warnings", "--playlist-items", "1", url]);
            #[cfg(windows)] cmd2.creation_flags(0x08000000);
            if let Ok(o2) = cmd2.output() {
                if o2.status.success() {
                    if let Ok(j2) = serde_json::from_slice::<serde_json::Value>(&o2.stdout) {
                        thumbnail = j2.get("entries").and_then(|e| e.as_array()).and_then(|a| a.first())
                            .and_then(|e| e.get("channel_thumbnail")).and_then(|v| v.as_str()).map(|s| s.to_string());
                    }
                }
            }
        }
        let kind = if url.contains("list=") || url.contains("/playlist") { "playlist" } else { "channel" };
        Ok((name, youtube_id, kind.to_string(), thumbnail, source))
    }

    pub fn sync_subscription(&self, sub: &VaultTubeSubscription) -> Result<usize, String> {
        let ytdlp = self.ytdlp()?;
        log::info!("[aetherfy] sync [{}] : {} ({})", sub.source, sub.name, sub.url);
        let mut cmd = Command::new(ytdlp);
        cmd.args(["--flat-playlist", "--dump-json", "--no-warnings", &sub.url]);
        #[cfg(windows)] cmd.creation_flags(0x08000000);
        let output = cmd.output().map_err(|e| format!("yt-dlp : {e}"))?;
        if !output.status.success() {
            return Err(format!("yt-dlp en échec : {}", String::from_utf8_lossy(&output.stderr).trim()));
        }
        let mut count = 0;
        for line in String::from_utf8_lossy(&output.stdout).lines() {
            if let Ok(video) = serde_json::from_str::<serde_json::Value>(line) {
                let youtube_id = video.get("id").and_then(|v| v.as_str()).unwrap_or("");
                let title = video.get("title").and_then(|v| v.as_str()).unwrap_or("");
                if youtube_id.is_empty() || title.is_empty() { continue; }
                let thumb = entry_thumbnail(&video).or_else(|| fallback_thumbnail_for(&sub.source, youtube_id));
                let duration = video.get("duration").and_then(|v| v.as_i64());
                let published_at = parse_upload_date(video.get("upload_date").and_then(|v| v.as_str()));
                
                let is_short = detect_short(&video);
                let _ = self.repo.add_video(
                    sub.id,
                    youtube_id,
                    title,
                    None,
                    thumb.as_deref(),
                    duration,
                    published_at,
                    &sub.source,
                    detect_short(&video),
                );
                count += 1;
            }
        }
        
                // 0.7.5 : rattrapage des vidéos EXISTANTES via l'onglet /shorts
        // (UPDATE, pas INSERT — cf. mark_short).
        if sub.source == "youtube" && sub.kind == "channel" {
            let shorts_url = format!("{}/shorts", sub.url.trim_end_matches('/'));
            let _ = self.mark_shorts_from_tab(sub, &shorts_url);
        }

        let _ = self.repo.update_last_synced(sub.id);
        log::info!("[aetherfy] {} vidéo(s) synchronisée(s)", count);
        Ok(count)
    }

        fn mark_shorts_from_tab(&self, sub: &VaultTubeSubscription, url: &str) -> Result<(), String> {
        let ytdlp = self.ytdlp()?;
        let mut cmd = Command::new(ytdlp);
        cmd.args(["--flat-playlist", "--dump-json", "--no-warnings", url]);
        #[cfg(windows)]
        cmd.creation_flags(0x08000000);
        let output = match cmd.output() {
            Ok(o) if o.status.success() => o,
            _ => return Ok(()), // pas d'onglet shorts → rien à marquer
        };
        for line in String::from_utf8_lossy(&output.stdout).lines() {
            if let Ok(entry) = serde_json::from_str::<serde_json::Value>(line) {
                let id = entry.get("id").and_then(|v| v.as_str()).unwrap_or("");
                if id.is_empty() {
                    continue;
                }
                let _ = self.repo.mark_short(sub.id, id);
            }
        }
        Ok(())
    }

    pub fn sync_playlists(&self, sub: &VaultTubeSubscription) -> Result<usize, String> {
        if sub.kind != "channel" { return Ok(0); }
        let ytdlp = self.ytdlp()?;
        let url = match sub.source.as_str() {
            "youtube" => format!("{}/playlists", sub.url.trim_end_matches('/')),
            "dailymotion" => format!("{}/playlists", sub.url.trim_end_matches('/')),
            _ => return Ok(0),
        };
        log::info!("[aetherfy] sync playlists [{}] : {}", sub.source, url);
        let mut cmd = Command::new(ytdlp);
        cmd.args(["--flat-playlist", "--dump-json", "--no-warnings", &url]);
        #[cfg(windows)] cmd.creation_flags(0x08000000);
        let output = cmd.output().map_err(|e| format!("yt-dlp : {e}"))?;
        if !output.status.success() {
            return Err(format!("yt-dlp en échec : {}", String::from_utf8_lossy(&output.stderr).trim()));
        }
        let mut count = 0;
        for line in String::from_utf8_lossy(&output.stdout).lines() {
            if let Ok(entry) = serde_json::from_str::<serde_json::Value>(line) {
                let pid = entry.get("id").and_then(|v| v.as_str()).unwrap_or("");
                let title = entry.get("title").and_then(|v| v.as_str()).unwrap_or("");
                if pid.is_empty() || title.is_empty() { continue; }
                let thumb = entry_thumbnail(&entry);
                let video_count = entry.get("playlist_count").or_else(|| entry.get("video_count")).and_then(|v| v.as_i64());
                let _ = self.repo.upsert_playlist(sub.id, pid, title, thumb.as_deref(), video_count, &sub.source);
                count += 1;
            }
        }
        log::info!("[aetherfy] {} playlist(s) synchronisée(s)", count);
        Ok(count)
    }

    pub fn preview_videos(&self, url: &str) -> Result<Vec<VaultTubeVideo>, String> {
        let source = detect_source(url);
        let ytdlp = self.ytdlp()?;
        let mut cmd = Command::new(ytdlp);
        cmd.args(["--flat-playlist", "--dump-json", "--no-warnings", url]);
        #[cfg(windows)] cmd.creation_flags(0x08000000);
        let output = cmd.output().map_err(|e| format!("yt-dlp : {e}"))?;
        if !output.status.success() {
            return Err(format!("yt-dlp en échec : {}", String::from_utf8_lossy(&output.stderr).trim()));
        }
        let mut out = Vec::new();
        for line in String::from_utf8_lossy(&output.stdout).lines() {
            if let Ok(video) = serde_json::from_str::<serde_json::Value>(line) {
                let youtube_id = video.get("id").and_then(|v| v.as_str()).unwrap_or("");
                let title = video.get("title").and_then(|v| v.as_str()).unwrap_or("");
                if youtube_id.is_empty() || title.is_empty() { continue; }
                let thumb = entry_thumbnail(&video).or_else(|| fallback_thumbnail_for(source, youtube_id));
                out.push(VaultTubeVideo {
                    id: 0, subscription_id: 0,
                    youtube_id: youtube_id.to_string(), title: title.to_string(),
                    description: None, thumbnail_url: thumb,
                    duration_seconds: video.get("duration").and_then(|v| v.as_i64()),
                    published_at: parse_upload_date(video.get("upload_date").and_then(|v| v.as_str())),
                    added_at: now_secs(), source: source.to_string(),
                    mode: "video".to_string(), is_short: detect_short(&video),
                });
            }
        }
        Ok(out)
    }

    pub fn search(&self, query: &str, source: Option<&str>) -> Result<Vec<SearchResult>, String> {
        let q = query.trim();
        if q.is_empty() { return Ok(Vec::new()); }
        let sources: Vec<&str> = match source {
            Some("all") | None => vec!["youtube", "dailymotion"],
            Some(s) => vec![s],
        };
        let ytdlp = self.ytdlp()?;
        let mut results = Vec::new();
        for src in sources {
            let prefix = match search_prefix(src) { Some(p) => p, None => continue };
            log::info!("[aetherfy] search [{}] : {}", src, q);
            let mut cmd = Command::new(ytdlp);
            cmd.args(["--flat-playlist", "--dump-json", "--no-warnings", &format!("{prefix}{q}")]);
            #[cfg(windows)] cmd.creation_flags(0x08000000);
            let output = match cmd.output() {
                Ok(o) if o.status.success() => o,
                Ok(o) => { log::warn!("[aetherfy] recherche [{}] en échec : {}", src, String::from_utf8_lossy(&o.stderr).trim()); continue; }
                Err(e) => { log::warn!("[aetherfy] recherche [{}] impossible : {}", src, e); continue; }
            };
            for line in String::from_utf8_lossy(&output.stdout).lines() {
                if let Ok(entry) = serde_json::from_str::<serde_json::Value>(line) {
                    let id = entry.get("id").and_then(|v| v.as_str()).unwrap_or("");
                    let title = entry.get("title").and_then(|v| v.as_str()).unwrap_or("");
                    if id.is_empty() || title.is_empty() { continue; }
                    let url = entry.get("url").and_then(|v| v.as_str()).map(|s| s.to_string())
                        .unwrap_or_else(|| match src {
                            "youtube" => format!("https://www.youtube.com/watch?v={id}"),
                            "dailymotion" => format!("https://www.dailymotion.com/video/{id}"),
                            _ => format!("https://www.youtube.com/watch?v={id}"),
                        });
                    let thumb = entry_thumbnail(&entry).or_else(|| fallback_thumbnail_for(src, id));
                    let kind = if url.contains("list=") || url.contains("/playlist") { "playlist" }
                        else if url.contains("/@") || url.contains("/channel/") || url.contains("/user/") { "channel" }
                        else { "video" };
                    let duration = entry.get("duration").and_then(|v| v.as_i64());
                    let channel = entry.get("channel").or_else(|| entry.get("uploader")).and_then(|v| v.as_str()).map(|s| s.to_string());
                    let video_count = entry.get("playlist_count").or_else(|| entry.get("video_count")).and_then(|v| v.as_i64());
                    results.push(SearchResult {
                        id: id.to_string(), title: title.to_string(), url, kind: kind.to_string(),
                        thumbnail_url: thumb, channel, duration_seconds: duration, video_count, source: src.to_string(),
                    });
                }
            }
        }
        Ok(results)
    }

    pub fn get_comments(&self, video_id: &str, source: Option<&str>) -> Result<Vec<Comment>, String> {
        let src = source.unwrap_or("youtube");
        let url = match src {
            "youtube" => format!("https://www.youtube.com/watch?v={video_id}"),
            "dailymotion" => format!("https://www.dailymotion.com/video/{video_id}"),
            _ => format!("https://www.youtube.com/watch?v={video_id}"),
        };
        let ytdlp = self.ytdlp()?;
        let mut cmd = Command::new(ytdlp);
        cmd.args(["--skip-download", "--write-comments", "--dump-single-json", "--no-warnings", &url]);
        #[cfg(windows)] cmd.creation_flags(0x08000000);
        let output = match cmd.output() {
            Ok(o) if o.status.success() => o,
            _ => return Ok(Vec::new()),
        };
        let json: serde_json::Value = serde_json::from_slice(&output.stdout).map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        if let Some(comments) = json.get("comments").and_then(|c| c.as_array()) {
            for (i, c) in comments.iter().enumerate().take(100) {
                let author = c.get("author").or_else(|| c.get("channel")).and_then(|v| v.as_str()).unwrap_or("Anonyme");
                let text = c.get("text").and_then(|v| v.as_str()).unwrap_or("").trim();
                if text.is_empty() { continue; }
                let likes = c.get("like_count").and_then(|v| v.as_i64());
                let published_at = c.get("timestamp").and_then(|v| v.as_i64());
                let id = c.get("id").and_then(|v| v.as_str()).unwrap_or(&i.to_string()).to_string();
                out.push(Comment { author: author.to_string(), text: text.to_string(), likes, published_at, id });
            }
        }
        Ok(out)
    }
}

fn locate_ytdlp() -> Option<PathBuf> {
    use crate::services::platform;
    let exe_dir = std::env::current_exe().ok()?.parent()?.to_path_buf();
    let resolved = platform::resolve_yt_dlp(&exe_dir, Some(&exe_dir.join("resources")));
    if resolved.exists() { Some(resolved) } else { None }
}