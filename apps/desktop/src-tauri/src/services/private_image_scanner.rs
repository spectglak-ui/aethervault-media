//! Scanner de dossiers image privés (Étape 6b-ii, doc §6.4 quater).
//!
//! Même architecture que `services::private_video_scanner` (Étape 6b-i),
//! avec une étape supplémentaire : le traitement pur d'un fichier
//! (`gather_file` — décodage, orientation EXIF, vignette, métadonnées) est
//! isolé de son écriture en base (`write_gathered_file`), elle-même isolée
//! du parcours complet (`scan_library`). Un futur Watcher privé n'aurait
//! besoin que d'appeler `upsert_one_file` pour le chemin concerné par un
//! événement filesystem — sans dupliquer ni la détection, ni le décodage,
//! ni le parcours.
//!
//! Formats supportés : JPEG/PNG/WebP/GIF/BMP/TIFF (décodage 100% Rust via
//! le crate `image`). **HEIC/HEIF volontairement exclu** — nécessiterait
//! `libheif`, une dépendance C (doc §6.4 quater, décision utilisateur).
//! Coordonnées GPS volontairement jamais lues (doc §6.4 quater).
//!
//! *(Correctif de performance, retour utilisateur après livraison)* Le
//! traitement pur (`gather_file`) est délibérément séparé de l'écriture en
//! base pour une seconde raison, au-delà de la préparation à un futur
//! watcher : `scan_library` parallélise cette étape sur plusieurs cœurs
//! (crate `rayon`), le décodage/redimensionnement/encodage d'une image
//! étant strictement CPU-bound et indépendant d'un fichier à l'autre.
//! Seule l'écriture SQLite reste séquentielle (`rusqlite::Connection`
//! n'est pas `Sync`, une seule connexion ne peut pas être partagée entre
//! threads). Le filtre de redimensionnement est également passé de
//! `Lanczos3` (le plus coûteux) à `Triangle` (bilinéaire) — différence de
//! qualité imperceptible à 400 px, sensiblement plus rapide.

use crate::db::repositories::private_image_repository::{self, NewImageFileData};
use image::codecs::jpeg::JpegEncoder;
use image::{DynamicImage, ImageDecoder, ImageReader};
use rayon::prelude::*;
use rusqlite::Connection;
use serde::Serialize;
use std::collections::HashSet;
use std::io::{BufReader, Cursor};
use std::path::{Path, PathBuf};

const IMAGE_EXTENSIONS: &[&str] = &["jpg", "jpeg", "png", "gif", "bmp", "webp", "tif", "tiff"];
const THUMBNAIL_MAX_DIMENSION: u32 = 400;
const THUMBNAIL_JPEG_QUALITY: u8 = 80;

pub fn is_image_file(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| IMAGE_EXTENSIONS.contains(&ext.to_lowercase().as_str()))
        .unwrap_or(false)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UpsertOutcome {
    Added,
    Updated,
}

/// Résultat du traitement pur d'un fichier — aucune écriture en base ici,
/// uniquement du décodage/calcul. `width`/`height` sont les dimensions
/// *après* correction d'orientation EXIF (dimensions d'affichage réelles).
/// Tous les champs sont volontairement `Option` : un fichier illisible ou
/// dans un format inattendu reste quand même catalogué, seulement sans
/// vignette ni métadonnées enrichies.
struct ProcessedImage {
    width: Option<u32>,
    height: Option<u32>,
    thumbnail: Option<Vec<u8>>,
    taken_at: Option<String>,
    camera_model: Option<String>,
}

/// Données rassemblées pour un fichier avant écriture en base — pur,
/// `Send` (aucune référence à `Connection`), donc calculable depuis
/// n'importe quel thread du pool `rayon`.
struct GatheredFile {
    path_string: String,
    file_name: String,
    size_bytes: i64,
    modified_at: String,
    processed: ProcessedImage,
}

fn decode_with_orientation(path: &Path) -> Option<DynamicImage> {
    let mut decoder = ImageReader::open(path).ok()?.into_decoder().ok()?;
    let orientation = decoder.orientation().ok();
    let mut img = DynamicImage::from_decoder(decoder).ok()?;
    if let Some(orientation) = orientation {
        img.apply_orientation(orientation);
    }
    Some(img)
}

fn make_thumbnail(img: &DynamicImage) -> Option<Vec<u8>> {
    // `Triangle` (bilinéaire) plutôt que `Lanczos3` : correctif de
    // performance (voir la note de tête du module) — la différence de
    // qualité est imperceptible pour une vignette de 400 px.
    let resized = img.resize(
        THUMBNAIL_MAX_DIMENSION,
        THUMBNAIL_MAX_DIMENSION,
        image::imageops::FilterType::Triangle,
    );

    let mut buffer = Vec::new();
    let mut cursor = Cursor::new(&mut buffer);
    let encoder = JpegEncoder::new_with_quality(&mut cursor, THUMBNAIL_JPEG_QUALITY);
    resized.write_with_encoder(encoder).ok()?;
    Some(buffer)
}

/// Date de prise de vue et modèle d'appareil uniquement — jamais les
/// coordonnées GPS, jamais lues (doc §6.4 quater). Échec silencieux : un
/// fichier sans EXIF (ou dans un format qui n'en porte pas) est un cas
/// normal, pas une erreur.
fn read_exif_fields(path: &Path) -> (Option<String>, Option<String>) {
    let Ok(file) = std::fs::File::open(path) else {
        return (None, None);
    };
    let mut reader = BufReader::new(&file);
    let Ok(exif) = exif::Reader::new().read_from_container(&mut reader) else {
        return (None, None);
    };

    let taken_at = exif
        .get_field(exif::Tag::DateTimeOriginal, exif::In::PRIMARY)
        .map(|field| field.display_value().to_string());
    let camera_model = exif
        .get_field(exif::Tag::Model, exif::In::PRIMARY)
        .map(|field| field.display_value().to_string());

    (taken_at, camera_model)
}

/// Traitement pur d'un fichier déjà confirmé comme existant et image :
/// décodage, orientation, vignette, EXIF. Ne touche jamais à `vault.db`.
fn process_image(path: &Path) -> ProcessedImage {
    let image = decode_with_orientation(path);
    let (width, height) = match &image {
        Some(img) => (Some(img.width()), Some(img.height())),
        None => (None, None),
    };
    let thumbnail = image.as_ref().and_then(make_thumbnail);
    let (taken_at, camera_model) = read_exif_fields(path);

    ProcessedImage {
        width,
        height,
        thumbnail,
        taken_at,
        camera_model,
    }
}

/// Rassemble métadonnées fichier + traitement de l'image — pur, aucune
/// écriture en base. Seule fonction appelée en parallèle par
/// `scan_library` ; aussi utilisée par `upsert_one_file` (usage unitaire,
/// futur watcher).
///
/// *(Correctif de robustesse, retour utilisateur après livraison)* Renvoie
/// désormais une erreur *pour ce fichier seulement* plutôt que de faire
/// échouer tout le scan : un fichier illisible (permissions, suppression
/// entre le parcours et la lecture) ne doit jamais faire perdre le
/// traitement des autres fichiers déjà découverts.
fn gather_file(path: &Path) -> Result<GatheredFile, String> {
    let metadata = std::fs::metadata(path).map_err(|e| e.to_string())?;
    let size_bytes = metadata.len() as i64;
    let modified_at = metadata
        .modified()
        .map(|time| chrono::DateTime::<chrono::Utc>::from(time).to_rfc3339())
        .unwrap_or_else(|_| chrono::Utc::now().to_rfc3339());
    let file_name = path
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_default();
    let path_string = path.to_string_lossy().to_string();

    let processed = process_image(path);

    Ok(GatheredFile {
        path_string,
        file_name,
        size_bytes,
        modified_at,
        processed,
    })
}

fn write_gathered_file(
    conn: &Connection,
    private_library_id: i64,
    folder_id: i64,
    gathered: &GatheredFile,
) -> Result<UpsertOutcome, String> {
    let data = NewImageFileData {
        path: &gathered.path_string,
        file_name: &gathered.file_name,
        size_bytes: gathered.size_bytes,
        modified_at: &gathered.modified_at,
        width: gathered.processed.width.map(i64::from),
        height: gathered.processed.height.map(i64::from),
        taken_at: gathered.processed.taken_at.as_deref(),
        camera_model: gathered.processed.camera_model.as_deref(),
        thumbnail: gathered.processed.thumbnail.as_deref(),
    };

    let was_inserted = private_image_repository::upsert_file(conn, private_library_id, folder_id, &data)
        .map_err(|e| e.to_string())?;

    Ok(if was_inserted {
        UpsertOutcome::Added
    } else {
        UpsertOutcome::Updated
    })
}

/// Traite un seul fichier déjà confirmé comme existant et image, et
/// persiste le résultat — unité réutilisable telle quelle par un futur
/// watcher (un événement = un appel ici), sans jamais avoir à reparcourir
/// tout un dossier ni à passer par le chemin parallélisé de `scan_library`.
pub fn upsert_one_file(
    conn: &Connection,
    private_library_id: i64,
    folder_id: i64,
    path: &Path,
) -> Result<UpsertOutcome, String> {
    let gathered = gather_file(path)?;
    write_gathered_file(conn, private_library_id, folder_id, &gathered)
}

#[derive(Debug, Clone, Serialize)]
pub struct PrivateImageScanSummary {
    pub private_library_id: i64,
    pub added: u64,
    pub updated: u64,
    pub removed: u64,
    pub unavailable_folders: u64,
    /// Fichiers rencontrés mais dont le traitement a échoué (permissions,
    /// fichier supprimé entre le parcours et la lecture...) — n'interrompt
    /// plus le reste du scan depuis le correctif de robustesse ci-dessus.
    pub failed: u64,
}

/// Parcourt l'ensemble des dossiers d'une bibliothèque image privée.
/// Comme `private_video_scanner::scan_library`, ne persiste jamais rien
/// lui-même sur `vault.db` : c'est l'appelant (`domain::private_image`)
/// qui appelle `VaultState::persist_if_unlocked()` une seule fois, à la
/// fin du scan complet.
///
/// Le parcours du disque (`WalkDir`, E/S) et l'écriture SQLite (une seule
/// connexion) restent séquentiels ; seul le traitement CPU-bound de chaque
/// image (`gather_file`) est parallélisé.
pub fn scan_library(conn: &Connection, private_library_id: i64) -> Result<PrivateImageScanSummary, String> {
    let folders = private_image_repository::list_folders_by_library(conn, private_library_id)
        .map_err(|e| e.to_string())?;

    let mut added = 0u64;
    let mut updated = 0u64;
    let mut removed = 0u64;
    let mut unavailable_folders = 0u64;
    let mut failed = 0u64;

    for folder in folders {
        let root = Path::new(&folder.path);

        if !root.exists() {
            unavailable_folders += 1;
            private_image_repository::mark_folder_unavailable(conn, folder.id).map_err(|e| e.to_string())?;
            continue;
        }

        let paths: Vec<PathBuf> = walkdir::WalkDir::new(root)
            .into_iter()
            .filter_map(|entry| entry.ok())
            .filter(|entry| entry.file_type().is_file() && is_image_file(entry.path()))
            .map(|entry| entry.into_path())
            .collect();

        let seen_paths: HashSet<String> =
            paths.iter().map(|path| path.to_string_lossy().to_string()).collect();

        // Étape CPU-bound, parallélisée : décodage + orientation +
        // redimensionnement + encodage JPEG + lecture EXIF, indépendants
        // d'un fichier à l'autre. Aucune connexion SQLite ici.
        let gathered: Vec<GatheredFile> = paths
            .par_iter()
            .filter_map(|path| gather_file(path).ok())
            .collect();
        failed += (paths.len() - gathered.len()) as u64;

        // Étape séquentielle : écriture en base, une seule connexion.
        for item in &gathered {
            match write_gathered_file(conn, private_library_id, folder.id, item)? {
                UpsertOutcome::Added => added += 1,
                UpsertOutcome::Updated => updated += 1,
            }
        }

        removed += private_image_repository::remove_missing(conn, folder.id, &seen_paths)
            .map_err(|e| e.to_string())?;
    }

    Ok(PrivateImageScanSummary {
        private_library_id,
        added,
        updated,
        removed,
        unavailable_folders,
        failed,
    })
}
