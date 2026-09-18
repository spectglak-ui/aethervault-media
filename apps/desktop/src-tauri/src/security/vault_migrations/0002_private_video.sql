-- Migration v2 de vault.db — Vidéos privées : dossiers, fichiers et
-- progression de lecture (Étape 6b-i, doc §6.4 ter).
--
-- Même gabarit que `library_folders`/`media_files` de `aethervault.db`,
-- mais volontairement sans `title_id`/`episode_id` : le contenu privé
-- n'est jamais enrichi par le Metadata Service ni rattaché à un
-- Titre/Saison/Épisode (doc §6.4, "espace de stockage personnel").
--
-- `private_playback_progress` ne porte pas de contrainte
-- `REFERENCES profiles(id)` : `profiles` vit dans `aethervault.db`, un
-- fichier séparé — une clé étrangère SQLite ne peut pas traverser deux
-- bases distinctes (et les ATTACHer romprait la frontière de sécurité que
-- le chiffrement du coffre est censé garantir). L'existence du profil est
-- vérifiée au niveau applicatif, comme le sont déjà les permissions
-- (voir `domain::privacy::require_private_access`).

CREATE TABLE private_video_folders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    private_library_id INTEGER NOT NULL REFERENCES private_libraries(id) ON DELETE CASCADE,
    path TEXT NOT NULL UNIQUE,
    added_at TEXT NOT NULL
);

CREATE TABLE private_video_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    private_library_id INTEGER NOT NULL REFERENCES private_libraries(id) ON DELETE CASCADE,
    folder_id INTEGER NOT NULL REFERENCES private_video_folders(id) ON DELETE CASCADE,
    path TEXT NOT NULL UNIQUE,
    file_name TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    modified_at TEXT NOT NULL,
    is_available INTEGER NOT NULL DEFAULT 1,
    discovered_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE private_playback_progress (
    profile_id INTEGER NOT NULL,
    media_file_id INTEGER NOT NULL REFERENCES private_video_files(id) ON DELETE CASCADE,
    position_seconds REAL NOT NULL,
    duration_seconds REAL NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (profile_id, media_file_id)
);

CREATE INDEX idx_private_video_folders_library ON private_video_folders(private_library_id);
CREATE INDEX idx_private_video_files_library ON private_video_files(private_library_id);
CREATE INDEX idx_private_video_files_folder ON private_video_files(folder_id);
