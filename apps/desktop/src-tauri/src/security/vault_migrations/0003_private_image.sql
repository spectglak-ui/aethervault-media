-- Migration v3 de vault.db — Images privées : dossiers, fichiers, vignettes
-- et couverture d'album (Étape 6b-ii, doc §6.4 quater).
--
-- Même principe que la migration v2 (vidéos privées) : un « album », c'est
-- un dossier, aucune structure de regroupement distincte.
--
-- Référence circulaire assumée entre les deux tables (`private_image_folders.
-- cover_file_id` -> `private_image_files`, `private_image_files.folder_id` ->
-- `private_image_folders`) : SQLite résout les clés étrangères par leur nom
-- au moment de l'exécution, pas à l'analyse du `CREATE TABLE` — l'ordre de
-- création ci-dessous n'a donc pas d'importance particulière.
--
-- `thumbnail_blob` : vignette chiffrée avec le reste de `vault.db`, par
-- exception à la règle générale « images sur disque, jamais en BLOB »
-- (doc §9) — une vignette est un aperçu direct du contenu privé (§6.4 bis).
-- `taken_at`/`camera_model` : EXIF, volontairement sans les coordonnées GPS
-- (décision utilisateur, doc §6.4 quater). `width`/`height` : dimensions
-- *après* correction d'orientation EXIF (dimensions d'affichage réelles).

CREATE TABLE private_image_folders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    private_library_id INTEGER NOT NULL REFERENCES private_libraries(id) ON DELETE CASCADE,
    path TEXT NOT NULL UNIQUE,
    -- NULL = couverture par défaut (première photo par nom de fichier).
    -- Doit obligatoirement référencer un fichier de ce même dossier —
    -- vérifié au niveau applicatif (domain::private_image), pas ici.
    cover_file_id INTEGER REFERENCES private_image_files(id) ON DELETE SET NULL,
    added_at TEXT NOT NULL
);

CREATE TABLE private_image_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    private_library_id INTEGER NOT NULL REFERENCES private_libraries(id) ON DELETE CASCADE,
    folder_id INTEGER NOT NULL REFERENCES private_image_folders(id) ON DELETE CASCADE,
    path TEXT NOT NULL UNIQUE,
    file_name TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    modified_at TEXT NOT NULL,
    width INTEGER,
    height INTEGER,
    taken_at TEXT,
    camera_model TEXT,
    thumbnail_blob BLOB,
    is_available INTEGER NOT NULL DEFAULT 1,
    discovered_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX idx_private_image_folders_library ON private_image_folders(private_library_id);
CREATE INDEX idx_private_image_files_library ON private_image_files(private_library_id);
CREATE INDEX idx_private_image_files_folder ON private_image_files(folder_id);
