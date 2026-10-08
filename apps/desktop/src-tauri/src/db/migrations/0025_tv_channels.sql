-- 0.9.0 — Catégorie TV : chaînes de télévision via flux HLS/IPTV publics.
-- Aucun tuner, aucune clé API : uniquement des URLs de flux que libmpv
-- lit nativement. Dédoublonnage par URL à l'import.
CREATE TABLE IF NOT EXISTS tv_channels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    url TEXT NOT NULL UNIQUE,
    logo_url TEXT,
    group_name TEXT,
    country TEXT,
    added_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tv_channels_group ON tv_channels(group_name);