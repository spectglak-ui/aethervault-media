-- Migration 29 — Type de secret des profils : mot de passe OU code PIN.
--
-- `password_hash` contient désormais le hash Argon2id d'un secret de l'un des deux
-- types, `auth_kind` dit lequel : 'password' (mot de passe complet) ou 'pin'
-- (4 à 8 chiffres). L'interface en a besoin AVANT la connexion pour afficher le
-- bon champ (clavier numérique pour un PIN). NULL = profil sans secret.

ALTER TABLE profiles ADD COLUMN auth_kind TEXT NULL
    CHECK (auth_kind IS NULL OR auth_kind IN ('password', 'pin'));

-- Les profils existants qui ont un secret ont un mot de passe.
UPDATE profiles SET auth_kind = 'password' WHERE password_hash IS NOT NULL;
