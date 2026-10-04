//! Scanner de la catégorie Lecture (0.7.0) : parcourt les dossiers d'une
//! bibliothèque et y détecte des LIVRES — une archive (.cbz/.zip) = un
//! livre, un sous-dossier contenant des images = un livre, des images
//! en vrac à la racine = un livre synthétique nommé comme le dossier.
//! Les couvertures sont extraites UNE fois au scan (JPEG ~600 px) dans
//! `<data_dir>/cache/reading/covers/` ; les pages, elles, ne sont
//! extraites qu'à la lecture (cache paresseux, voir commands::reading).
use crate::db::repositories::reading_repository::{self, NewBookData};
use rusqlite::Connection;
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter};

#[derive(Clone, Serialize)]
pub struct ReadingScanSummary {
    pub added: u64,
    pub updated: u64,
    pub removed: u64,
    pub failed: u64,
}

const IMAGE_EXTS: &[&str] = &["jpg", "jpeg", "png", "webp", "gif", "bmp"];
const ARCHIVE_EXTS: &[&str] = &["cbz", "zip"];

pub fn is_image_name(name: &str) -> bool {
    let lower = name.to_lowercase();
    IMAGE_EXTS.iter().any(|e| lower.ends_with(&format!(".{e}")))
}

/// Tri « naturel » : les suites de chiffres comparées numériquement
/// (page2 < page10) — même besoin que media_repository.
pub fn natural_cmp(a: &str, b: &str) -> std::cmp::Ordering {
    let mut ai = 0usize;
    let mut bi = 0usize;
    let ab = a.as_bytes();
    let bb = b.as_bytes();
    while ai < ab.len() && bi < bb.len() {
        let ca = ab[ai] as char;
        let cb = bb[bi] as char;
        if ca.is_ascii_digit() && cb.is_ascii_digit() {
            let mut an = String::new();
            while ai < ab.len() && (ab[ai] as char).is_ascii_digit() { an.push(ab[ai] as char); ai += 1; }
            let mut bn = String::new();
            while bi < bb.len() && (bb[bi] as char).is_ascii_digit() { bn.push(bb[bi] as char); bi += 1; }
            let at = an.trim_start_matches('0');
            let bt = bn.trim_start_matches('0');
            match at.len().cmp(&bt.len()).then_with(|| at.cmp(bt)) {
                std::cmp::Ordering::Equal => {}
                other => return other,
            }
        } else {
            match ca.to_lowercase().cmp(cb.to_lowercase()) {
                std::cmp::Ordering::Equal => { ai += 1; bi += 1; }
                other => return other,
            }
        }
    }
    ab.len().cmp(&bb.len())
}

/// Noms des entrées image d'une archive, triés en ordre de lecture.
pub fn zip_image_entries(path: &Path) -> Result<Vec<String>, String> {
    let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
    let mut names: Vec<String> = Vec::new();
    for i in 0..archive.len() {
        if let Ok(entry) = archive.by_index(i) {
            let name = entry.name().to_string();
            if !entry.is_dir() && is_image_name(&name) {
                names.push(name);
            }
        }
    }
    names.sort_by(|a, b| natural_cmp(a, b));
    Ok(names)
}

/// Octets d'une entrée d'archive (page ou couverture).
pub fn read_zip_entry(path: &Path, name: &str) -> Result<Vec<u8>, String> {
    let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
    let mut entry = archive.by_name(name).map_err(|e| e.to_string())?;
    let mut buf = Vec::new();
    std::io::Read::read_to_end(&mut entry, &mut buf).map_err(|e| e.to_string())?;
    Ok(buf)
}

/// Pages d'un livre « dossier » : images directes, tri naturel.
pub fn folder_images(dir: &Path) -> Result<Vec<PathBuf>, String> {
    let mut out: Vec<PathBuf> = std::fs::read_dir(dir)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.is_file() && p.file_name().map(|n| is_image_name(&n.to_string_lossy())).unwrap_or(false))
        .collect();
    out.sort_by(|a, b| natural_cmp(&a.file_name().unwrap_or_default().to_string_lossy(), &b.file_name().unwrap_or_default().to_string_lossy()));
    Ok(out)
}

/// Extrait et met en cache la couverture (première page) d'un livre.
fn extract_cover(book_path: &Path, format: &str, book_id: i64, data_dir: &Path) -> Option<String> {
    let bytes: Vec<u8> = match format {
        "folder" => {
            let first = folder_images(book_path).ok()?.into_iter().next()?;
            std::fs::read(first).ok()?
        }
        _ => {
            let first = zip_image_entries(book_path).ok()?.into_iter().next()?;
            read_zip_entry(book_path, &first).ok()?
        }
    };
    let img = image::load_from_memory(&bytes).ok()?;
    let scaled = img.resize(600, 900, image::imageops::FilterType::Triangle);
    let dest_dir = data_dir.join("cache").join("reading").join("covers");
    std::fs::create_dir_all(&dest_dir).ok()?;
    let dest = dest_dir.join(format!("book_{book_id}.jpg"));
    scaled.save_with_format(&dest, image::ImageFormat::Jpeg).ok()?;
    Some(dest.to_string_lossy().to_string())
}

fn emit_progress(app: &AppHandle, library_id: i64, phase: &str, processed: u64, total: u64, current: &str) {
    let _ = app.emit(
        "reading:scan-progress",
        serde_json::json!({ "library_id": library_id, "phase": phase, "processed": processed, "total": total, "current": current }),
    );
}

pub fn scan_library(
    conn: &Connection,
    library_id: i64,
    data_dir: &Path,
    app: &AppHandle,
) -> Result<ReadingScanSummary, String> {
    let folders = reading_repository::list_folders_by_library(conn, library_id).map_err(|e| e.to_string())?;
    let mut summary = ReadingScanSummary { added: 0, updated: 0, removed: 0, failed: 0 };

    // Inventaire d'abord (rapide), traitement ensuite : la barre de
    // progression connaît son total dès le départ.
    struct Target { folder_id: i64, path: PathBuf, file_name: String, format: &'static str, size: i64, modified: String }
    let mut targets: Vec<Target> = Vec::new();
    for folder in &folders {
        let root = PathBuf::from(&folder.path);
        if !root.is_dir() { continue; }
        let entries = std::fs::read_dir(&root).map_err(|e| e.to_string())?;
        let mut loose_images = 0usize;
        for entry in entries.filter_map(|e| e.ok()) {
            let path = entry.path();
            let meta = entry.metadata().map_err(|e| e.to_string())?;
            let modified = meta.modified().ok()
                .map(|t| chrono::DateTime::<chrono::Utc>::from(t).to_rfc3339())
                .unwrap_or_default();
            if path.is_dir() {
                if folder_images(&path).map(|v| !v.is_empty()).unwrap_or(false) {
                    targets.push(Target { folder_id: folder.id, path: path.clone(), file_name: path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(), format: "folder", size: meta.len() as i64, modified });
                }
            } else if let Some(ext) = path.extension().map(|e| e.to_string_lossy().to_lowercase()) {
                if ARCHIVE_EXTS.contains(&ext.as_str()) {
                    targets.push(Target { folder_id: folder.id, path: path.clone(), file_name: path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(), format: if ext == "cbz" { "cbz" } else { "zip" }, size: meta.len() as i64, modified });
                } else if IMAGE_EXTS.contains(&ext.as_str()) {
                    loose_images += 1;
                }
            }
        }
        if loose_images > 0 {
            let meta = std::fs::metadata(&root).map_err(|e| e.to_string())?;
            let modified = meta.modified().ok()
                .map(|t| chrono::DateTime::<chrono::Utc>::from(t).to_rfc3339())
                .unwrap_or_default();
            targets.push(Target { folder_id: folder.id, path: root.clone(), file_name: root.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(), format: "folder", size: meta.len() as i64, modified });
        }
    }

    let total = targets.len() as u64;
    emit_progress(app, library_id, "scan", 0, total, "");
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();

    for (idx, target) in targets.iter().enumerate() {
        seen.insert(target.path.to_string_lossy().to_string());
        let current = target.file_name.clone();
        emit_progress(app, library_id, "scan", idx as u64, total, &current);
        let page_count: i64 = match target.format {
            "folder" => folder_images(&target.path).map(|v| v.len() as i64).unwrap_or(0),
            _ => zip_image_entries(&target.path).map(|v| v.len() as i64).unwrap_or(0),
        };
        if page_count == 0 {
            summary.failed += 1;
            continue;
        }
        let title = target.path.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| target.file_name.clone());
        // Couverture : extraite après upsert (l'id est nécessaire pour le nom de fichier cache).
        let (book_id, is_new) = reading_repository::upsert_book(conn, library_id, target.folder_id, &NewBookData {
            path: &target.path.to_string_lossy(),
            file_name: &target.file_name,
            format: target.format,
            title: &title,
            page_count,
            cover_path: None,
            size_bytes: target.size,
            modified_at: &target.modified,
        }).map_err(|e| e.to_string())?;
        if is_new { summary.added += 1; } else { summary.updated += 1; }
        let cover = extract_cover(&target.path, target.format, book_id, data_dir);
        if let Some(cover) = cover {
            let _ = conn.execute(
                "UPDATE reading_books SET cover_path = ?1 WHERE id = ?2",
                rusqlite::params![cover, book_id],
            );
        }
    }

    for folder in &folders {
        let folder_seen: std::collections::HashSet<String> = seen.iter()
            .filter(|p| p.starts_with(&folder.path))
            .cloned()
            .collect();
        summary.removed += reading_repository::mark_missing_books(conn, folder.id, &folder_seen).map_err(|e| e.to_string())?;
    }
    emit_progress(app, library_id, "done", total, total, "");
    Ok(summary)
}