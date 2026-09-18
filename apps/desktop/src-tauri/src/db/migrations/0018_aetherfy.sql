-- 0.4.0 : extension AetherFy — ajout de la source (youtube/dailymotion/vimeo/peertube/generic)
-- aux abonnements et vidéos VaultTube existants. Par défaut : "youtube" (toutes les données
-- actuelles sont issues de YouTube, ce qui préserve la cohérence des abonnements existants).
ALTER TABLE vaulttube_subscriptions ADD COLUMN source TEXT NOT NULL DEFAULT 'youtube';
ALTER TABLE vaulttube_videos ADD COLUMN source TEXT NOT NULL DEFAULT 'youtube';
ALTER TABLE vaulttube_playlists ADD COLUMN source TEXT NOT NULL DEFAULT 'youtube';