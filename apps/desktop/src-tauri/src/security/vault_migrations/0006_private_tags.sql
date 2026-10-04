-- 0.6.3 : tags utilisateur sur les médias privés (coffre chiffré).
-- Deux tables de jonction (une par type de média) pour bénéficier de
-- ON DELETE CASCADE quand un fichier/dossier est retiré du coffre.
CREATE TABLE IF NOT EXISTS private_tags (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE
);
CREATE TABLE IF NOT EXISTS private_image_tags (
    tag_id   INTEGER NOT NULL REFERENCES private_tags(id) ON DELETE CASCADE,
    media_id INTEGER NOT NULL REFERENCES private_image_files(id) ON DELETE CASCADE,
    PRIMARY KEY (tag_id, media_id)
);
CREATE TABLE IF NOT EXISTS private_video_tags (
    tag_id   INTEGER NOT NULL REFERENCES private_tags(id) ON DELETE CASCADE,
    media_id INTEGER NOT NULL REFERENCES private_video_files(id) ON DELETE CASCADE,
    PRIMARY KEY (tag_id, media_id)
);
CREATE INDEX IF NOT EXISTS idx_private_image_tags_media ON private_image_tags(media_id);
CREATE INDEX IF NOT EXISTS idx_private_video_tags_media ON private_video_tags(media_id);