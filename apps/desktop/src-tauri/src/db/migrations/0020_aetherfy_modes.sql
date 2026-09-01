-- 0.4.0 : distinction lecture vidéo / lecture audio (musique/podcasts)
-- pour adapter l'interface du lecteur. Valeur par défaut : 'video' pour
-- préserver le comportement actuel de tous les contenus.
ALTER TABLE vaulttube_subscriptions ADD COLUMN mode TEXT NOT NULL DEFAULT 'video';
ALTER TABLE vaulttube_user_playlists ADD COLUMN mode TEXT NOT NULL DEFAULT 'video';
ALTER TABLE vaulttube_user_playlist_items ADD COLUMN mode TEXT NOT NULL DEFAULT 'video';