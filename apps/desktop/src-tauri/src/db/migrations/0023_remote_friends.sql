-- 0.4.0 : amis DISTANTS (appairage par code) et demandes de média.
-- Un « ticket » (host / port / token) est conservé de part et d'autre
-- après l'appairage ; les connexions ne sont ouvertes qu'à la demande
-- (présence, aperçu bibliothèque, partage) — jamais en permanence.

CREATE TABLE IF NOT EXISTS remote_friends (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token TEXT NOT NULL UNIQUE,          -- secret partagé lors de l'appairage
    my_name TEXT NOT NULL,               -- mon nom (tel que transmis au pair)
    peer_name TEXT NOT NULL,             -- nom du profil ami
    host TEXT NOT NULL,                  -- adresse (IP ou nom) du pair
    port INTEGER NOT NULL,               -- port d'écoute du pair
    last_seen TEXT,                      -- dernier ping réussi
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS friend_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    friend_id INTEGER NOT NULL,
    title_name TEXT NOT NULL,            -- titre demandé (aperçu TMDB)
    tmdb_id INTEGER,
    media_type TEXT,                     -- movie / tv / ...
    poster_path TEXT,                    -- chemin d'affiche TMDB (optionnel)
    status TEXT NOT NULL DEFAULT 'pending',  -- pending / accepted / refused
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (friend_id) REFERENCES remote_friends(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_remote_friends_token ON remote_friends(token);
CREATE INDEX IF NOT EXISTS idx_friend_requests_status ON friend_requests(status);