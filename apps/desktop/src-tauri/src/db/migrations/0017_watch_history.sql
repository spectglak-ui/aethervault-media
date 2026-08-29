-- Migration 0017 — Historique de visionnage (Time Capsule, Étape 8).
-- Chaque ligne = une session de visionnage complète (terminée ou
-- interrompue), distincte de `playback_progress` qui ne stocke que la
-- position courante. Permet de calculer : heures totales regardées,
-- top genres, top titres, « il y a 1 an », top 10 de l'année.
CREATE TABLE watch_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    media_file_id INTEGER NOT NULL REFERENCES media_files(id) ON DELETE CASCADE,
    title_id INTEGER NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('movie', 'series')),
    category_key TEXT NOT NULL,
    position_seconds REAL NOT NULL,
    duration_seconds REAL NOT NULL,
    started_at TEXT NOT NULL,
    ended_at TEXT NOT NULL
);
CREATE INDEX idx_watch_history_profile ON watch_history(profile_id);
CREATE INDEX idx_watch_history_title ON watch_history(title_id);
CREATE INDEX idx_watch_history_ended ON watch_history(ended_at DESC);