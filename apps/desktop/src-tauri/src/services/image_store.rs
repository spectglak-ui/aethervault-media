//! Stockage des images personnalisées par l'utilisateur (doc §6.6) — copie
//! un fichier choisi via le sélecteur natif vers le répertoire de données
//! de l'application, pour ne jamais dépendre du fichier source original
//! (déplacé/supprimé par l'utilisateur après coup, par exemple).
//!
//! Aucun traitement d'image (redimensionnement, recompression) à ce
//! stade : l'objectif de l'Étape 4 est de poser une architecture correcte
//! pour la personnalisation, pas d'optimiser le stockage — voir doc §6.6.
//! Une normalisation de format/taille pourra être ajoutée plus tard sans
//! changer la forme de cette fonction (même signature, même emplacement).

use std::path::{Path, PathBuf};

/// Copie `source_path` vers `{data_dir}/images/{category}/{entity_id}-{purpose}.{ext}`
/// et renvoie le chemin absolu écrit — c'est ce chemin que
/// `custom_image_repository::set` stocke dans `custom_images` (Étape 5,
/// doc §6.6).
///
/// `category` distingue les images de Titres de celles de Catégories dans
/// l'arborescence (ex. `"titles"`, `"categories"`), purement pour garder le
/// répertoire lisible en cas d'inspection manuelle.
pub fn store_custom_image(
    data_dir: &Path,
    category: &str,
    entity_id: i64,
    purpose: &str,
    source_path: &str,
) -> Result<String, String> {
    let source = Path::new(source_path);
    if !source.exists() {
        return Err(format!("Fichier introuvable : {source_path}"));
    }

    let extension = source
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("img");

    let target_dir = data_dir.join("images").join(category);
    std::fs::create_dir_all(&target_dir)
        .map_err(|e| format!("Impossible de créer le répertoire d'images : {e}"))?;

    let target: PathBuf = target_dir.join(format!("{entity_id}-{purpose}.{extension}"));

    std::fs::copy(source, &target).map_err(|e| format!("Impossible de copier l'image : {e}"))?;

    Ok(target.to_string_lossy().to_string())
}

/// Supprime une image personnalisée du disque — *best-effort* : un échec
/// (fichier déjà absent, permissions...) est journalisé mais ne fait
/// jamais échouer l'appelant. Une personnalisation orpheline sur le
/// disque (fichier image sans plus aucune ligne `custom_images` associée)
/// est un gaspillage de quelques kilo-octets, jamais une donnée
/// incohérente visible dans l'application — contrairement à une ligne de
/// base de données orpheline, qui elle peut réapparaître dans l'UI. C'est
/// pourquoi cette fonction ne renvoie pas d'erreur bloquante : la
/// cohérence de la base (voir `custom_image_repository`) prime sur le
/// nettoyage du disque.
pub fn remove_image(path: &str) {
    if let Err(err) = std::fs::remove_file(path) {
        log::warn!("Impossible de supprimer l'image personnalisée '{path}' : {err}");
    }
}
