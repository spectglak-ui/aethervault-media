-- Migration 0026 — Notes personnelles et Watchlist, PAR PROFIL.
--
-- Contrairement aux Collections (migration 0016, globales), ces deux tables
-- sont rattachées à un profil : chaque profil a ses propres notes et sa
-- propre liste « À regarder ». La suppression d'un profil ou d'un titre
-- supprime en cascade les lignes correspondantes.
--
-- title_ratings : note de 0,5 à 5 étoiles par pas de 0,5 (demi-étoiles).
--   Pas de ligne = pas de note ; retirer la note supprime la ligne.
-- watchlist_items : titre à regarder, avec un statut manuel :
--   'todo' (à voir), 'in_progress' (en cours), 'done' (vu).

CREATE TABLE title_ratings (
    profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    title_id   INTEGER NOT NULL REFERENCES titles(id)   ON DELETE CASCADE,
    rating     REAL    NOT NULL
        CHECK (rating >= 0.5 AND rating <= 5.0 AND rating * 2 = CAST(rating * 2 AS INTEGER)),
    rated_at   TEXT    NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (profile_id, title_id)
);
CREATE INDEX idx_title_ratings_title_id ON title_ratings(title_id);

CREATE TABLE watchlist_items (
    profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    title_id   INTEGER NOT NULL REFERENCES titles(id)   ON DELETE CASCADE,
    status     TEXT    NOT NULL DEFAULT 'todo'
        CHECK (status IN ('todo', 'in_progress', 'done')),
    added_at   TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT    NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (profile_id, title_id)
);
CREATE INDEX idx_watchlist_profile_status ON watchlist_items(profile_id, status);
CREATE INDEX idx_watchlist_title_id ON watchlist_items(title_id);
