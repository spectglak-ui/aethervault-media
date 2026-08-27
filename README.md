# AetherVault Media

<img width="212" height="212" alt="logo" src="https://github.com/user-attachments/assets/c392e065-f0ec-4beb-8c01-15602badb9d8" />

Centre multimédia personnel, local-first, inspiré de Jellyfin/Plex. Voir
`docs/AetherVault-Media-Documentation-Technique.md` pour l'architecture
complète et la roadmap.

**État actuel : Étape 8 livrée — installateur Windows NSIS.** Les étapes 0 à 8
de la roadmap sont terminées, compilées et testées en conditions réelles sur
Windows : socle applicatif, bibliothèques avec watcher, lecteur libmpv
intégré (rendu logiciel + canvas WebGL, mode flottant, PiP en quarantaine),
métadonnées et catégories, personnalisation, profils multi-utilisateurs avec
authentification (intro animée au démarrage puis sélection de profil ou
assistant de premier démarrage), coffre privé chiffré AES-256-GCM (vidéos +
galerie d'images), vignettes d'aperçu, Explorateur / Search Engine avec
métadonnées TMDB et sonde technique, Accueil v2 (héro + rangées), shaders de
post-traitement WebGL, fenêtre frameless, et installateur NSIS embarquant
libmpv. Voir la documentation technique, sections §6.5 et §8, pour le détail.

## Étape 6d — Vignettes d'aperçu automatiques & barre de progression du scan

- **Catalogue public (Séries & Anime uniquement)** : à la fin de chaque
  scan + appariement Metadata Service, une vignette JPEG ~480 px est extraite
  de chaque épisode (image à ~1 s, instance libmpv dédiée, rendu logiciel)
  puis stockée dans `<data_dir>/thumbnails/episodes/episode_<id>.jpg` ; le
  chemin est enregistré dans `episodes.still_path`. Rattrapage manuel via la
  commande `generate_episode_thumbnails`.
- **Coffre privé (vidéos)** : vignettes générées au scan privé, stockées
  chiffrées en BLOB dans `vault.db` (`thumbnail_blob`, migration v4) —
  jamais en clair sur disque ; servies au frontend en base64 via
  `private_video_thumbnail`.
- **Barre de progression du scan** : événements `library:scan-progress`
  (analyse → appariement → vignettes) et `private:scan-progress`, affichés
  par `ScanProgressBar` / `PrivateScanProgressBar` à côté du bouton Scanner.
- **Robustesse éprouvée en test réel** : thread dédié + délai absolu par
  fichier (aucun fichier ne peut geler la file), traceur d'étape pour
  diagnostiquer tout gel futur.

## Étape 7 — Explorateur / Search Engine, métadonnées TMDB & sonde technique

- **Fournisseur en ligne TMDB** (même modèle que Jellyfin) : après chaque
  scan, les Titres sans `tmdb_id` sont enrichis automatiquement — synopsis
  (fr-FR, repli en-US), genres, studios, top 10 casting, réalisateurs,
  note, affiche/backdrop **téléchargés localement** dans
  `<data_dir>/metadata/tmdb/`. Recherche par nom + année + nature
  (`search/movie` / `search/tv`), `tmdb_id` + `imdb_id` conservés
  (migration 0014). Clé API saisie dans **Paramètres → « Métadonnées en
  ligne (TMDB) »** (stockée dans `aethervault.db`, jamais en dur),
  enrichissement automatique désactivable.
- **Sonde technique mpv** : résolution, codec vidéo, langues audio et
  sous-titres de chaque fichier, lus sans lecture (handle dédié `vo=null`,
  en pause) et stockés dans `media_probes` (migration 0015) — affichés dans
  la section « Informations techniques » des pages Titre et utilisés comme
  critères de recherche.
- **Explorateur** (`/explore`) : recherche multicritère — nom, nature
  (film/série), catégories, années, genres, acteur, réalisateur,
  résolution, codec, langue audio — avec facets distinctes, debounce
  300 ms, compteur de résultats et grille d'affiches cliquables. La barre
  de recherche globale du shell navigue vers `/explore?q=…`. Périmètre :
  catalogue public uniquement, jamais le coffre privé.
- **Fonds d'écran de page** : sur les pages Titre et Catégorie, la petite
  bannière horizontale est remplacée par un fond de page (bannière, ou
  affiche du premier titre à défaut, assombrie et fondue vers le noir) ;
  la personnalisation existante est conservée (boutons changer /
  réinitialiser dans la barre d'actions).
- **Accueil v2** : héro « à la une » (backdrop TMDB choisi au hasard,
  synopsis, boutons Lecture / Plus d'infos), tuiles de catégories en 16:9
  (fini les logos coupés), rangées horizontales « style Netflix »
  (Ajouts récents + une rangée par catégorie publique).
- **Shaders de post-traitement** (Option A, WebGL) : 4 presets intégrés
  (Désactivé, Netteté, Couleurs vives, Anime4K-lite) via le menu ✨ du
  lecteur — un seul fragment shader, preset sélectionné par uniform
  (changement instantané, sans re-attach ni recompilation), preset
  persisté et diffusé aux deux fenêtres. L'interpolation de mouvement
  reste reportée (nécessite un backend GPU mpv fonctionnel).
- **Fenêtre frameless** : l'application s'ouvre maximisée sans barre de
  titre native (`decorations: false` + `maximized: true`) ; la barre du
  haut sert de barre de titre draggable avec boutons réduire / agrandir /
  fermer personnalisés.
- **Scrollbars** sombres, cohérentes avec le thème.

## Étape 8 — Installateur Windows NSIS

- `pnpm --filter @aethervault/desktop tauri build` produit
  `apps/desktop/src-tauri/target/release/bundle/nsis/AetherVault Media_0.1.0_x64-setup.exe`
  (premier build : téléchargement automatique de l'outil NSIS, connexion
  requise une fois ; compilation release longue).
- Installation par utilisateur (sans UAC), sélecteur de langue FR/EN,
  raccourci Menu Démarrer, inscription dans « Applications installées »,
  désinstallation propre.
- libmpv-2.dll (LGPL, non modifiée) embarquée dans `<installation>\resources\`
  via `bundle.resources` ; `locate_library` cherche ce dossier en repli.
  **Avant le build**, copier le dll dans `apps/desktop/src-tauri/libs/`
  (voir Prérequis).
- Les données utilisateur (`%APPDATA%`) ne sont jamais touchées par
  l'installation ni la désinstallation.
- Non livré : signature de code (avertissement SmartScreen possible au
  premier lancement), Tauri Updater.

## Prérequis (Windows)

- **Rust** — via [rustup](https://rustup.rs).
- **Node.js LTS** (v20 ou supérieur).
- **pnpm** — `corepack enable` (inclus avec Node ≥ 16.10), puis
  `corepack prepare pnpm@latest --activate`.
- **Microsoft C++ Build Tools** — via le "Visual Studio Installer", charge
  de travail *Desktop development with C++* (nécessaire pour compiler les
  dépendances natives de Tauri).
- **WebView2 Runtime** — préinstallé sur Windows 11 ; à installer
  manuellement sur Windows 10 si absent
  ([lien Microsoft](https://developer.microsoft.com/microsoft-edge/webview2/)).
- **libmpv (Étape 3b)** — le lecteur a besoin de `libmpv-2.dll` (build
  LGPL, voir doc §9 « Licence de libmpv »). En développement
  (`pnpm dev`), la déposer à côté de l'exécutable
  (`apps/desktop/src-tauri/target/debug/`). Depuis l'Étape 8,
  l'installateur embarque automatiquement ce binaire : copier
  `libmpv-2.dll` dans `apps/desktop/src-tauri/libs/` avant `tauri build`
  (il sera installé dans `<installation>\resources\`). Sans ce fichier en
  dev, le reste de l'application fonctionne normalement — seules les
  commandes de lecture renverront une erreur explicite
  (`PlaybackEngineState::Unavailable`).

## Lancer le projet en développement

```bash
pnpm install
pnpm dev