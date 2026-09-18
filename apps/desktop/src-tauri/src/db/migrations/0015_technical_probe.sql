-- Migration 0015 — Sonde technique des fichiers média (Étape 7, lot 2).
-- Table 1-1 SÉPARÉE de media_files plutôt que des colonnes ajoutées :
-- aucune requête existante (scanner, metadata, vignettes) n'est touchée,
-- et un fichier non sondé n'a simplement pas de ligne ici — ses critères
-- techniques sont alors absents des filtres, sans erreur.
CREATE TABLE media_probes (
    media_file_id INTEGER PRIMARY KEY REFERENCES media_files(id) ON DELETE CASCADE,
    width INTEGER,
    height INTEGER,
    resolution TEXT,
    video_codec TEXT,
    audio_langs TEXT NOT NULL DEFAULT '[]',
    subtitle_langs TEXT NOT NULL DEFAULT '[]',
    probe_updated_at TEXT NOT NULL
);
CREATE INDEX idx_media_probes_resolution ON media_probes(resolution);
CREATE INDEX idx_media_probes_codec ON media_probes(video_codec);