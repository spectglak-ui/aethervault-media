# AetherVault Media

<img width="212" height="212" alt="logo" src="https://github.com/user-attachments/assets/c392e065-f0ec-4beb-8c01-15602badb9d8" />

Centre multimédia personnel, local-first, inspiré de Jellyfin/Plex. Voir
`docs/AetherVault-Media-Documentation-Technique.md` pour l'architecture
complète et la roadmap.

**État actuel : Étape 6c-ii livrée — authentification des profils par mot de
passe et code de récupération, intro animée au démarrage, gate de
login/onboarding. Les étapes 0 à 6c-ii de la roadmap (socle applicatif,
bibliothèques, lecteur libmpv intégré, métadonnées et catégories,
personnalisation, profils, coffre privé avec vidéos et galerie d'images,
authentification multi-profil) sont terminées et ont été compilées et
testées en conditions réelles. L'application démarre désormais sur une
intro animée (fond sombre + logo + transition douce, ~2,6 s, skippable),
puis affiche un écran de sélection de profil (avec cadenas pour les profils
protégés par mot de passe) ou un assistant de création du premier compte
administrateur sur une installation neuve. Plus d'auto-activation du
premier profil admin : le démarrage requiert désormais une connexion
explicite (sauf si le profil n'a pas de mot de passe, auquel cas l'accès
est direct). Voir la documentation technique, sections §6.5 et §8 (Étapes
6c-i/6c-ii), pour le détail de l'architecture d'authentification (hash
Argon2id, code de récupération affiché une fois, `active_profile_id`
devenu `Option<i64>`) et du gate frontend (`AuthGate.tsx`, `prefers-reduced-motion`
respecté).

## Étape 6d — Vignettes d'aperçu automatiques & barre de progression du scan

- **Catalogue public (Séries & Anime uniquement)** : à la fin de chaque
  scan + appariement Metadata Service, une vignette JPEG ~480 px est extraite
  de chaque épisode (image à ~1 s, instance libmpv dédiée, rendu logiciel)
  puis stockée dans `<data_dir>/thumbnails/episodes/episode_<id>.jpg` ; le
  chemin est enregistré dans `episodes.still_path`. Rattrapage manuel via la
  commande `generate_episode_thumbnails`.
- **Coffre privé (vidéos)** : vignettes générées au scan privé, stockées
  **chiffrées en BLOB dans `vault.db`** (`thumbnail_blob`, migration v4) —
  jamais en clair sur disque ; servies au frontend en base64 via
  `private_video_thumbnail`.
- **Barre de progression du scan** : événements `library:scan-progress`
  (analyse → appariement → vignettes) et `private:scan-progress`, affichés
  par `ScanProgressBar` / `PrivateScanProgressBar` à côté du bouton Scanner.
- **Robustesse éprouvée en test réel** : thread dédié + délai absolu par
  fichier (aucun fichier ne peut geler la file), traceur d'étape pour
  diagnostiquer tout gel futur (« gel mpv à l'étape « X » »).

## Prérequis (Windows)

1. **Rust** — via [rustup](https://rustup.rs).
2. **Node.js LTS** (v20 ou supérieur).
3. **pnpm** — `corepack enable` (inclus avec Node ≥ 16.10), puis `corepack prepare pnpm@latest --activate`.
4. **Microsoft C++ Build Tools** — via le "Visual Studio Installer", charge de travail *Desktop development with C++* (nécessaire pour compiler les dépendances natives de Tauri).
5. **WebView2 Runtime** — préinstallé sur Windows 11 ; à installer manuellement sur Windows 10 si absent ([lien Microsoft](https://developer.microsoft.com/microsoft-edge/webview2/)).
6. **libmpv (Étape 3b)** — le lecteur a besoin de `libmpv-2.dll` (build **LGPL**, voir doc §9 « Licence de libmpv ») déposée à côté de l'exécutable généré par `pnpm dev`/`pnpm build` (typiquement `apps/desktop/src-tauri/target/debug/` en développement). Sans ce fichier, le reste de l'application fonctionne normalement — seules les commandes de lecture renverront une erreur explicite (`PlaybackEngineState::Unavailable`). L'empaquetage automatique de ce binaire avec l'installateur est prévu à l'Étape 9, pas encore réalisée.

## Lancer le projet en développement

```bash
pnpm install
pnpm dev
```

Une fenêtre doit s'ouvrir avec le titre "AetherVault Media" et afficher
directement l'Accueil (grille des tuiles de catégories — Films, Séries,
Anime, Documentaires, Privé — voir doc §6.7). L'écran de statut brut du
socle (nom de l'application, version, chemins de la base de données et des
logs, nombre de profils enregistrés) affiché ici jusqu'à l'Étape 3b n'est
plus la première chose visible au démarrage : il a été déplacé dans
**Paramètres → Informations système**, au fur et à mesure que l'Accueil
et la navigation par catégories (Étape 4) ont pris sa place comme point
d'entrée réel de l'application.

## Compiler un exécutable

```bash
pnpm build
```

Produit les binaires/installateurs dans
`apps/desktop/src-tauri/target/release/bundle/`.

## Note historique sur la livraison de l'Étape 3b

Le socle des étapes 0 à 3a avait déjà été compilé et validé. Le nouveau
code de cette étape (`apps/desktop/src-tauri/src/services/playback_engine/`)
avait été écrit avec le plus grand soin d'après l'ABI stable de libmpv et
l'API Win32, mais **n'avait pas pu être compilé ni testé dans
l'environnement de génération** (pas de toolchain Windows, pas de GPU, pas
d'accès réseau côté assistant) au moment de cette livraison. Chaque fichier
concerné portait une note « ⚠️ » identifiant précisément les points à
vérifier au premier `cargo build`.

**Cette limitation ne s'applique plus depuis.** Le projet a depuis été
compilé et testé de façon prolongée en conditions réelles sur Windows, à
travers toutes les étapes qui ont suivi (3c à 3g, 4, 5, 6a, 6b-i, 6b-ii) :
les nombreux bugs réels que ces tests ont mis au jour — écran noir puis
corruption d'image (Étapes 3c/3d), lecture MP4/MKV incohérente, désync
audio/vidéo, saccades en plein écran, fiabilité du Picture-in-Picture
(Étape 3f), entre autres — sont documentés en détail, correctif par
correctif, dans `docs/AetherVault-Media-Documentation-Technique.md`
(§3.2, §4.2, §8). Les notes « ⚠️ » restées dans le code ne signalent donc
plus, pour l'essentiel, une absence de compilation, mais des correctifs
réels déjà appliqués ou des points explicitement signalés comme non
vérifiables plutôt qu'inventés (voir par exemple l'incohérence relevée en
doc §3.2 autour d'une migration de rendu OpenGL annoncée en commentaire
mais absente du code livré). Le portage Linux/macOS, lui, reste
entièrement non testé et hors périmètre à ce stade (doc §3.6/§9).

## Structure du projet

Voir `docs/AetherVault-Media-Documentation-Technique.md`, section 5, pour le
détail de l'arborescence complète et sa justification.
