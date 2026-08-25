-- Migration 0003 — Progression de lecture.
--
-- Volontairement indépendante du moteur de lecture (HTML5 aujourd'hui,
-- libmpv à l'Étape 3b) : ne stocke qu'une position/durée par fichier, sans
-- rien qui dépende de la technologie de rendu. Ne sera pas affectée par le
-- changement de moteur prévu en 3b.

CREATE TABLE playback_progress (
    media_file_id INTEGER PRIMARY KEY REFERENCES media_files(id) ON DELETE CASCADE,
    position_seconds REAL NOT NULL,
    duration_seconds REAL NOT NULL,
    updated_at TEXT NOT NULL
);
