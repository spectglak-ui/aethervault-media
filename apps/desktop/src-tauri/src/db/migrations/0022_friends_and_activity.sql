-- 0.4.0 : Système d'amis et activité de visionnage
-- Table friends : relations d'amitié entre profils (unidirectionnelle)
CREATE TABLE IF NOT EXISTS friends (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id INTEGER NOT NULL,
    friend_profile_id INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(profile_id, friend_profile_id),
    FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE,
    FOREIGN KEY (friend_profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);

-- Table profile_activity : ce que chaque profil regarde actuellement
CREATE TABLE IF NOT EXISTS profile_activity (
    profile_id INTEGER PRIMARY KEY,
    title_id INTEGER,
    title_name TEXT,
    poster TEXT,
    category_key TEXT,
    position_seconds REAL,
    duration_seconds REAL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE,
    FOREIGN KEY (title_id) REFERENCES titles(id) ON DELETE SET NULL
);

-- Table profile_settings : préférences de confidentialité
CREATE TABLE IF NOT EXISTS profile_settings (
    profile_id INTEGER PRIMARY KEY,
    activity_visibility INTEGER NOT NULL DEFAULT 1, -- 1 = visible, 0 = cachée
    FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);

-- Index pour accélérer les requêtes d'amis
CREATE INDEX IF NOT EXISTS idx_friends_profile ON friends(profile_id);
CREATE INDEX IF NOT EXISTS idx_friends_friend ON friends(friend_profile_id);