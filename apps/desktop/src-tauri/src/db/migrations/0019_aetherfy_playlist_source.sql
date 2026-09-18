-- 0.4.0 : source des vidéos des playlists locales (pour reconstruire
-- l'URL de lecture selon la plateforme d'origine).
ALTER TABLE vaulttube_user_playlist_items ADD COLUMN source TEXT NOT NULL DEFAULT 'youtube';