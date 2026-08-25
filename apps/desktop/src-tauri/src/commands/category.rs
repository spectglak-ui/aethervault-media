//! Commandes de gestion des Catégories (doc §6.1) : de simples wrappers
//! autour de `domain::category` — aucune règle métier ni SQL direct ici.

use crate::domain::category::{self, CategorySummary};
use crate::services::image_store;
use crate::state::AppState;

#[tauri::command]
pub fn list_categories(state: tauri::State<AppState>) -> Result<Vec<CategorySummary>, String> {
    category::list_categories(&state.db_pool)
}

/// Ouvre le sélecteur de fichier natif filtré sur les formats d'image
/// usuels — même mécanisme que `commands::library::pick_folder` (canal
/// synchrone autour de l'API à callback du plugin), voir sa documentation
/// pour le détail de cette approche.
#[tauri::command]
pub fn pick_image(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    let (tx, rx) = std::sync::mpsc::channel();
    app.dialog()
        .file()
        .add_filter("Images", &["png", "jpg", "jpeg", "webp"])
        .pick_file(move |result| {
            let _ = tx.send(result);
        });

    let picked = rx.recv().map_err(|e| e.to_string())?;
    Ok(picked.map(|path| path.to_string()))
}

/// Remplace la bannière personnalisée d'une catégorie. `source_path` à
/// `None` efface la personnalisation (retour à la bannière automatique,
/// elle-même absente pour l'instant en l'absence de fournisseur en ligne
/// — voir doc §6.6/§8 Étape 4).
#[tauri::command]
pub fn set_category_banner(
    state: tauri::State<AppState>,
    category_id: i64,
    source_path: Option<String>,
) -> Result<(), String> {
    let path = match source_path {
        Some(source) => Some(image_store::store_custom_image(
            std::path::Path::new(&state.data_dir),
            "categories",
            category_id,
            "banner",
            &source,
        )?),
        None => None,
    };

    category::set_custom_banner(&state.db_pool, category_id, path.as_deref())
}
