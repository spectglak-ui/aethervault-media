-- Réglages globaux du lecteur (volume, muet, vitesse de lecture),
-- persistés entre les sessions. Une seule ligne (id=1), sur le même
-- modèle que `player_window_state` (0011) : pas de contenu utilisateur,
-- juste une préférence d'interface à retrouver au prochain démarrage.
CREATE TABLE player_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    volume REAL NOT NULL,
    muted INTEGER NOT NULL,
    rate REAL NOT NULL,
    updated_at TEXT NOT NULL
);
