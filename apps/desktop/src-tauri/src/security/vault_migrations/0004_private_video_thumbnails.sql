-- Migration v4 — Vignettes des vidéos privées (Étape 6d-privé).
-- La vignette (octets JPEG) vit chiffrée dans vault.db, jamais en clair
-- sur disque — exception déjà posée en doc §6.4 bis pour les vignettes
-- du coffre.
   ALTER TABLE private_video_files ADD COLUMN thumbnail_blob BLOB;