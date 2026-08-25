-- Migration 0011 — Mémorisation de la position/taille de la fenêtre
-- détachée du lecteur (correctif retour utilisateur, évolution vers un
-- comportement de type Picture-in-Picture).
--
-- Une seule ligne (id=1) : une seule fenêtre détachée par installation.
-- Coordonnées en pixels *logiques* (indépendants de la densité d'écran),
-- jamais physiques — voir commands::window pour la conversion à la
-- lecture/écriture (via Monitor::scale_factor()).
--
-- Vit dans aethervault.db (non chiffrée, comme les profils ou les
-- catégories) : la géométrie d'une fenêtre n'est pas une donnée sensible,
-- aucune raison de la faire vivre dans le coffre privé.

CREATE TABLE player_window_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    x REAL NOT NULL,
    y REAL NOT NULL,
    width REAL NOT NULL,
    height REAL NOT NULL,
    updated_at TEXT NOT NULL
);
