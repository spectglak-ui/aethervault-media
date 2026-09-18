-- Migration 0009 — Configuration du coffre privé (Étape 6a, doc §6.4 bis).
--
-- Vit volontairement dans `aethervault.db` (non chiffrée), pas dans
-- `vault.db` : il faut pouvoir savoir "un coffre a-t-il déjà été créé, et
-- avec quel sel/paramètres Argon2id" AVANT de pouvoir dériver la clé qui
-- ouvrirait `vault.db` — c'est-à-dire avant toute authentification.
--
-- Ne contient jamais le PIN/mot de passe, ni en clair ni sous forme de
-- hash : `kdf_salt` n'est pas un secret (un sel n'a pas besoin de l'être),
-- uniquement l'ingrédient qui, combiné au PIN/mot de passe saisi à chaque
-- déverrouillage, permet de redériver la même clé AES via Argon2id. Voir
-- `security::kdf`.
--
-- Une seule ligne possible (`id` contraint à 1) : un seul coffre privé par
-- installation, comme posé dès l'Étape 4 (doc §6.4, "Portée").

CREATE TABLE vault_security (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    secret_kind TEXT NOT NULL CHECK (secret_kind IN ('pin', 'password')),
    kdf_salt BLOB NOT NULL,
    kdf_mem_cost_kib INTEGER NOT NULL,
    kdf_time_cost INTEGER NOT NULL,
    kdf_parallelism INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
