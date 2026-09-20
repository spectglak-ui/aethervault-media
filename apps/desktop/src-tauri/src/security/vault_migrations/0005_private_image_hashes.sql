-- Migration v5 de vault.db — Ajout des hashes pour détection de doublons
-- (perceptuel et fichier) dans les images privées.
--
-- perceptual_hash: hash visuel (pHash) pour détecter les images similaires
-- file_hash: SHA256 du fichier pour détection de doublons exacts et intégrité

ALTER TABLE private_image_files ADD COLUMN perceptual_hash TEXT;
ALTER TABLE private_image_files ADD COLUMN file_hash TEXT;

CREATE INDEX idx_private_image_files_phash ON private_image_files(perceptual_hash);
CREATE INDEX idx_private_image_files_fhash ON private_image_files(file_hash);
