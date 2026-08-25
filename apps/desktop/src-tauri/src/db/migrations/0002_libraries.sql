-- Migration 0002 — Bibliothèques, dossiers surveillés, fichiers détectés.
--
-- Portée volontairement limitée à l'Étape 2a : pas encore de table dédiée
-- aux volumes de stockage (identification stable par numéro de série) —
-- elle arrivera avec le vrai Filesystem Watcher (Étape 2b), qui en aura
-- réellement besoin. Ici, la disponibilité d'un dossier est déterminée à la
-- demande via l'existence du chemin sur le disque (voir services::scanner).

CREATE TABLE libraries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    media_type TEXT NOT NULL,
    icon TEXT,
    accent_color TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE library_folders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    library_id INTEGER NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
    path TEXT NOT NULL UNIQUE,
    added_at TEXT NOT NULL
);

CREATE TABLE media_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    library_id INTEGER NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
    folder_id INTEGER NOT NULL REFERENCES library_folders(id) ON DELETE CASCADE,
    path TEXT NOT NULL UNIQUE,
    file_name TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    modified_at TEXT NOT NULL,
    is_available INTEGER NOT NULL DEFAULT 1,
    discovered_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX idx_library_folders_library_id ON library_folders(library_id);
CREATE INDEX idx_media_files_library_id ON media_files(library_id);
CREATE INDEX idx_media_files_folder_id ON media_files(folder_id);
