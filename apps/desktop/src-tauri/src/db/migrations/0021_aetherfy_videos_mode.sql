-- 0.4.0 : colonne mode manquante sur vaulttube_videos
-- (la migration 20 ne couvrait pas cette table).
ALTER TABLE vaulttube_videos ADD COLUMN mode TEXT NOT NULL DEFAULT 'video';