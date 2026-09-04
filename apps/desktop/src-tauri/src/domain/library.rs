//! Library Manager : règles métier autour des bibliothèques et de leurs
//! dossiers. Combine les repositories SQL avec des informations qui ne
//! viennent pas de la base — notamment la disponibilité d'un dossier, qui
//! dépend de l'état du système de fichiers au moment de la consultation.

use crate::db::repositories::{
    category_repository, episode_repository, folder_repository, library_repository,
    media_repository, title_repository,
};
use crate::db::DbPool;
use crate::services::image_store;
use serde::Serialize;
use std::path::Path;

/// Vue complète d'une bibliothèque exposée au frontend : les colonnes de
/// `libraries` enrichies du nombre de dossiers actuellement inaccessibles
/// (vérifié à la demande — la détection instantanée d'un débranchement
/// arrivera avec le Filesystem Watcher, Étape 2b).
#[derive(Debug, Clone, Serialize)]
pub struct LibrarySummary {
    pub id: i64,
    pub name: String,
    pub category_id: Option<i64>,
    pub icon: Option<String>,
    pub accent_color: Option<String>,
    pub sort_order: i64,
    pub folder_count: i64,
    pub media_count: i64,
    pub unavailable_folder_count: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct FolderSummary {
    pub id: i64,
    pub library_id: i64,
    pub path: String,
    pub is_available: bool,
    pub added_at: String,
}

pub fn list_libraries(pool: &DbPool) -> Result<Vec<LibrarySummary>, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    let records = library_repository::list_all(&conn).map_err(|e| e.to_string())?;
    let mut summaries = Vec::with_capacity(records.len());

    for record in records {
        let folders =
            folder_repository::list_by_library(&conn, record.id).map_err(|e| e.to_string())?;
        let unavailable_folder_count = folders
            .iter()
            .filter(|folder| !Path::new(&folder.path).exists())
            .count() as i64;
        summaries.push(LibrarySummary {
            id: record.id,
            name: record.name,
            category_id: record.category_id,
            icon: record.icon,
            accent_color: record.accent_color,
            sort_order: record.sort_order,
            folder_count: record.folder_count,
            media_count: record.media_count,
            unavailable_folder_count,
            created_at: record.created_at,
            updated_at: record.updated_at,
        });
    }
    Ok(summaries)
}

/// Crée une bibliothèque rattachée à `category_id` (doc §6.1). Résout la
/// `key` de la catégorie une seule fois ici plutôt que dans le repository
/// (qui n'a pas à connaître `category_repository` — une seule requête de
/// plus à cet endroit, contre un couplage entre deux repositories sinon).
pub fn create_library(
    pool: &DbPool,
    name: &str,
    category_id: i64,
    icon: Option<&str>,
    accent_color: Option<&str>,
) -> Result<i64, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    let category = category_repository::get(&conn, category_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Catégorie {category_id} introuvable"))?;
    library_repository::create(&conn, name, category_id, &category.key, icon, accent_color)
        .map_err(|e| e.to_string())
}

/// Supprime une bibliothèque et, avec elle, tout ce qui n'aurait plus lieu
/// d'exister sans elle — mais rien de plus. Trois garanties (doc §8,
/// Étape 5) :
///
/// 1.  Les fichiers sur le disque ne sont jamais touchés — seules les
///    lignes de la base disparaissent (`libraries`, en cascade
///    `library_folders` / `media_files` via les clés étrangères posées à la
///    migration 0002).
/// 2.  Aucune donnée orpheline : un Titre ou un Épisode qui n'a plus
///    aucun Média associé après cette suppression est supprimé à son tour
///    — mais *seulement* s'il n'est plus alimenté par aucune autre
///    bibliothèque (un Titre peut être partagé par plusieurs bibliothèques
///    d'une même Catégorie, doc §6.1 ; le supprimer trop tôt casserait la
///    navigation de l'autre bibliothèque). Voir
///    `title_repository::orphaned` / `episode_repository::orphaned`.
/// 3.  Les personnalisations de l'utilisateur (`custom_images`, doc
///    §6.6) sur un Titre supprimé sont purgées de la base *et* leurs
///    fichiers effacés du disque — jamais une image personnalisée
///    orpheline qui traînerait indéfiniment.
///
/// Les identifiants de Titres/Épisodes concernés sont c̲o̲l̲l̲e̲c̲t̲é̲s̲ AVANT la
/// suppression de la bibliothèque (tant que les liens `media_files.*_id`
/// existent encore) ; leur statut orphelin n'est vérifié qu'APRÈS, une
/// fois la bibliothèque effectivement supprimée.
pub fn delete_library(pool: &DbPool, library_id: i64) -> Result<(), String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    let title_ids = media_repository::distinct_title_ids(&conn, library_id).map_err(|e| e.to_string())?;
    let episode_ids =
        media_repository::distinct_episode_ids(&conn, library_id).map_err(|e| e.to_string())?;
    library_repository::delete(&conn, library_id).map_err(|e| e.to_string())?;

    // Épisodes d'abord : le statut orphelin d'un Titre de nature "series"
    // (ci-dessous) dépend du nombre d'Épisodes qui LUI restent une fois
    // les épisodes orphelins déjà retirés.
    for episode_id in episode_repository::orphaned(&conn, &episode_ids).map_err(|e| e.to_string())? {
        episode_repository::delete(&conn, episode_id).map_err(|e| e.to_string())?;
    }
    for title_id in title_repository::orphaned(&conn, &title_ids).map_err(|e| e.to_string())? {
        let removed_images = title_repository::delete(&conn, title_id).map_err(|e| e.to_string())?;
        for path in removed_images {
            image_store::remove_image(&path);
        }
    }
    Ok(())
}

pub fn list_folders(pool: &DbPool, library_id: i64) -> Result<Vec<FolderSummary>, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    let folders =
        folder_repository::list_by_library(&conn, library_id).map_err(|e| e.to_string())?;
    Ok(folders
        .into_iter()
        .map(|folder| FolderSummary {
            is_available: Path::new(&folder.path).exists(),
            id: folder.id,
            library_id: folder.library_id,
            path: folder.path,
            added_at: folder.added_at,
        })
        .collect())
}

/// 0.4.1 (audit sécurité PASSE 4) : validation stricte des chemins de
/// bibliothèque. Empêche les attaques TOCTOU (symlinks malveillants) et
/// l'accès aux dossiers système critiques.
fn validate_library_folder(path: &str) -> Result<(), String> {
    let p = Path::new(path);

    // ❌ Interdire les chemins relatifs
    if !p.is_absolute() {
        return Err("Le chemin doit être absolu.".to_string());
    }

    // ✅ Canonicalize = résout symlinks, ../, et ./
    // Empêche les attaques TOCTOU : si un symlink pointe vers /etc,
    // canonicalize le résout AVANT qu'on ne vérifie la blacklist.
    let canonical = p
        .canonicalize()
        .map_err(|e| format!("Impossible de valider le chemin : {e}"))?;

    // ❌ Interdire les chemins système critiques (Windows + Unix)
    let canonical_str = canonical.to_string_lossy();
    let canonical_lower = canonical_str.to_lowercase();

    let forbidden_prefixes = [
        // Unix / macOS / Linux
        "/etc",
        "/sys",
        "/proc",
        "/dev",
        "/root",
        "/boot",
        "/usr",
        "/var",
        "/bin",
        "/sbin",
        // Windows (insensible à la casse)
        "c:\\windows",
        "c:\\program files",
        "c:\\programdata",
    ];

    for prefix in &forbidden_prefixes {
        if canonical_lower.starts_with(prefix) {
            return Err(format!("Accès au dossier système {} interdit.", prefix));
        }
    }

    // ✅ Vérifier que c'est un dossier accessible
    if !canonical.is_dir() {
        return Err("Le chemin doit être un dossier accessible.".to_string());
    }

    Ok(())
}

pub fn add_folder(pool: &DbPool, library_id: i64, path: &str) -> Result<i64, String> {
    // 0.4.1 : validation AVANT insertion en base (sécurité TOCTOU)
    validate_library_folder(path)?;

    let conn = pool.get().map_err(|e| e.to_string())?;
    folder_repository::create(&conn, library_id, path).map_err(|e| e.to_string())
}

/// Retire un dossier et renvoie son chemin s'il existait, pour que
/// l'appelant (voir `commands::library`) puisse arrêter de le surveiller.
pub fn remove_folder(pool: &DbPool, folder_id: i64) -> Result<Option<String>, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    folder_repository::delete(&conn, folder_id).map_err(|e| e.to_string())
}