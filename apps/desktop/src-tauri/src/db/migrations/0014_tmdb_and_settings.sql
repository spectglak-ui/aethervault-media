-- Migration 0014 — Métadonnées TMDB + paramètres applicatifs (Étape 7).
-- `app_settings` : réglages clés/valeurs (clé API TMDB, langue,
-- enrichissement auto) — non sensibles, donc dans aethervault.db, pas
-- dans le coffre (décision validée).
CREATE TABLE app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- Identifiants du fournisseur en ligne : un Titre avec `tmdb_id` non
-- NULL est considéré enrichi ; l'index partiel permet le lookup sans
-- pénaliser les titres locaux.
ALTER TABLE titles ADD COLUMN tmdb_id INTEGER;
ALTER TABLE titles ADD COLUMN imdb_id TEXT;
CREATE UNIQUE INDEX idx_titles_tmdb_id ON titles(tmdb_id) WHERE tmdb_id IS NOT NULL;