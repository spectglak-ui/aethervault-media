-- 0.7.3 (AetherFy Phase 3a) — détection fiable des Shorts :
-- colonne is_short remplie à la synchronisation via l'onglet /shorts
-- de chaque chaîne yt-dlp + heuristique de durée (≤ 60 s).
ALTER TABLE vaulttube_videos ADD COLUMN is_short INTEGER NOT NULL DEFAULT 0;