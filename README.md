# AetherVault Media

<img width="1919" height="635" alt="AetherVault Media - Centre multimédia personnel" src="https://github.com/user-attachments/assets/9152b0d9-8d67-4511-b3d8-588f48f80259" />

**AetherVault Media** est un centre multimédia personnel, **local-first**, entièrement installé sur votre appareil. Gérez votre bibliothèque de films, séries, anime et galeries privées — sans compte cloud, sans surveillance.

**État actuel** :  Étape 8+ — Installateur Windows NSIS, lecteur libmpv intégré, partage via code (chiffré), scan d'images parallélisé.

##  Fonctionnalités principales

###  Gestion de bibliothèque
- **Catalogue public** : films, séries et anime avec détection automatique des saisons et épisodes
- **Coffre privé chiffré** : vidéos et galeries d'images protégées en AES-256-GCM
- **Métadonnées enrichies** : intégration TMDB (synopsis, affiches, casting, genres, notes)
- **Profils multi-utilisateurs** : authentification avec intro animée et sélection de profil
- **Watcher automatique** : détecte les nouveaux fichiers médias en temps réel

###  Lecteur multimédia intégré
- **Lecteur libmpv** : rendu logiciel + canvas WebGL pour une compatibilité maximale
- **Modes de lecture** : lecture plein écran, mode flottant
- **Shaders de post-traitement** : 4 presets WebGL (Désactivé, Netteté, Couleurs vives, Anime4K-lite)
- **Informations techniques** : résolution, codecs, langues audio et sous-titres

###  Exploration et recherche
- **Explorateur multicritère** : recherchez par titre, catégorie, année, genre, acteur, réalisateur, résolution, codec, langue
- **Facets intelligentes** : navigation intuitive avec compteur de résultats
- **Barre de recherche globale** : accès rapide via le shell
- **Fonds d'écran** : bannières TMDB automatiquement appliquées aux pages titre

###  Interface utilisateur
- **Accueil v2** : héro à la une avec synopsis et boutons d'action, rangées style Netflix
- **Fenêtre frameless** : design moderne sans barre de titre native, draggable
- **Thème cohérent** : scrollbars sombres et personnalisation complète
- **Maximisée au démarrage** : expérience immersive dès le lancement

### 🔗 Partage sécurisé
- **Partage via code** : générez un code partageable pour inviter d'autres utilisateurs
- **Chiffrement bout-à-bout** : SHA-256 + AES-256-GCM pour les données partagées
- **Ouverture de port UPnP** : support optionnel pour le LAN (configurable)

###  Galeries d'images privées
- **Stockage chiffré** : images protégées en AES-256-GCM, jamais en clair sur disque
- **Formats supportés** : JPEG, PNG, WebP, GIF, BMP, TIFF
- **Métadonnées EXIF** : date de prise de vue et modèle d'appareil préservés (GPS volontairement exclu)
- **Scan parallélisé** : analyse rapide et efficace avec Rayon

###  Performance et sécurité
- **Vignettes d'aperçu automatiques** : extraites à ~1s de chaque épisode, génération efficace
- **Scan parallélisé d'images** : performance optimale sur multi-cœurs
- **Barre de progression du scan** : suivi en temps réel (analyse → appariement → vignettes)
- **Chiffrement du coffre** : Argon2id (KDF) + AES-256-GCM, jamais en clair sur disque
- **Aucune dépendance système** : SQLite bundled, rustls (100% Rust)

##  Prérequis (Windows)

### Outils obligatoires
- **Rust** — installez via [rustup](https://rustup.rs) (1.77+)
- **Node.js LTS** — version 20 ou supérieure
- **pnpm** — gestionnaire de paquets 9.0.0+ (installé via `corepack` inclus avec Node ≥ 16.10)
  ```bash
  corepack enable
  corepack prepare pnpm@latest --activate
  ```
- **Microsoft C++ Build Tools** — depuis Visual Studio Installer (charge de travail : *Desktop development with C++*)
- **WebView2 Runtime** — préinstallé sur Windows 11 ; à [installer manuellement](https://developer.microsoft.com/microsoft-edge/webview2/) sur Windows 10

###  libmpv-2.dll (crucial)
Le lecteur multimédia nécessite **libmpv-2.dll** (build LGPL, non modifié) :

#### Pour le mode développement
```bash
# Téléchargez la build LGPL de libmpv
# Déposez libmpv-2.dll à côté de l'exécutable :
apps/desktop/src-tauri/target/debug/libmpv-2.dll
```

Sans ce fichier, le reste de l'application fonctionne — seules les commandes de lecture retourneront une erreur explicite (`PlaybackEngineState::Unavailable`).

#### Pour l'installation (Étape 8)
```bash
# Avant de lancer tauri build :
cp libmpv-2.dll apps/desktop/src-tauri/libs/

# L'installateur embarquera automatiquement le binaire dans :
<installation>\resources\libmpv-2.dll
```

##  Installation et utilisation

### Mode développement

**Installation initiale** :
```bash
pnpm install
pnpm dev
```

L'application se lance en mode debug avec hot-reload Vite.

### Mode production — Installateur NSIS

**Générer l'installateur** :
```bash
# Assurez-vous que libmpv-2.dll est dans apps/desktop/src-tauri/libs/
pnpm build
```

Cela produit :
```
apps/desktop/src-tauri/target/release/bundle/nsis/AetherVault Media_0.3.0_x64-setup.exe
```

**Installation** :
- Interface de sélection de langue (FR/EN)
- Installation par utilisateur (sans UAC)
- Raccourci automatique au Menu Démarrer
- Inscription dans « Applications installées »
- Désinstallation complète et propre

**Données utilisateur** : Les données sont stockées dans `%APPDATA%` et ne sont jamais modifiées par l'installation ou la désinstallation.

**Notes** :
- ⚠️ Signature de code non incluse (avertissement SmartScreen possible au premier lancement)
- ⚠️ Tauri Updater non implémenté
- Premier build télécharge l'outil NSIS automatiquement (connexion requise une seule fois)

##  Architecture

### Stack technologique
- **Backend** : Rust 2021 (1.77+) avec Tauri 2 — **55.9% du code**
- **Frontend** : React 18 + React Router 6 + TypeScript 5 — **37.3% du code**
- **Styles** : CSS 3 — **6.8% du code**
- **Outils de build** : Vite 5, pnpm 9.0.0
- **Base de données** : SQLite (rusqlite bundled)
- **Lecteur vidéo** : libmpv (chargement dynamique)
- **Traitement audio** : Symphonia 0.5 (analyse spectrales)
- **FFT** : RustFFT 6 (transformées de Fourier)

### Structure monorepo (pnpm workspaces)
```
aethervault-media/
├── apps/
│   └── desktop/
│       ├── src-tauri/          # Rust (Tauri) v0.3.0
│       ├── src/                # React + TypeScript v0.2.0
│       └── src-tauri/libs/     # libmpv-2.dll (à copier avant build)
├── packages/
│   ├── shared-types/           # Types TypeScript partagés v0.1.0
│   └── ui-kit/                 # Composants React réutilisables
└── pnpm-workspace.yaml         # Configuration du monorepo
```

### Dépendances principales (Rust v0.3.0)

| Domaine | Crates | Notes |
|---------|--------|-------|
| **Base de données** | `rusqlite 0.31`, `r2d2 0.8`, `r2d2_sqlite 0.24` | SQLite bundled, connection pooling |
| **Chiffrement** | `aes-gcm 0.10`, `argon2 0.5`, `rand 0.8` | AES-256-GCM + Argon2id KDF, 100% Rust |
| **Chiffrement de partage** | `sha2 0.10`, `igd 0.12` | SHA-256 + UPnP pour partage via code |
| **Multimédia** | `image 0.25.8`, `kamadak-exif 0.6`, `base64 0.22` | Décodage images, EXIF (sans GPS), encodage des vignettes |
| **Audio** | `symphonia 0.5`, `rustfft 6` | Décodage audio multi-format, analyse spectrales |
| **Réseau** | `ureq 2` | Client HTTP Rust pur (rustls) |
| **Système de fichiers** | `walkdir 2`, `notify 6` | Récursion + watcher temps réel |
| **Lecteur vidéo** | `libloading 0.8` | Chargement dynamique de libmpv |
| **Parallélisation** | `rayon 1` | Scan d'images en parallèle, traitement CPU multi-cœurs |
| **Frontend bridge** | `tauri 2`, `tauri-plugin-log 2`, `tauri-plugin-dialog 2` | IPC et plugins Tauri 2 |
| **Sérialisation** | `serde 1`, `serde_json 1` | Sérialisation des structures de données |
| **Temps** | `chrono 0.4` | Gestion des timestamps et fuseaux horaires |
| **Logging** | `log 0.4` | Système de logging unifié |

## Dépendances requises

### libmpv-2.dll (lecture vidéo)
Téléchargez depuis [mpv-player releases](https://sourceforge.net/projects/mpv-player-windows/files/) :
- `mpv-x86_64-xxxxxxxx-git-xxxxxxx.7z`
- Extrayez `libmpv-2.dll` dans `apps/desktop/src-tauri/`

### fpcalc.exe (détection de génériques)
Téléchargez depuis [Chromaprint releases](https://github.com/acoustid/chromaprint/releases) :
- `chromaprint-fpcalc-x.x.x-windows-x86_64.zip`
- Extrayez `fpcalc.exe` dans `apps/desktop/src-tauri/`

Les deux fichiers doivent être présents dans `apps/desktop/src-tauri/` avant de builder.

### Principes de sécurité
- ✅ Aucune dépendance C système (rustls, Rust pur)
- ✅ Chiffrement du coffre entièrement applicatif (niveau SQLite, pas SQLCipher)
- ✅ libmpv chargée dynamiquement (pas d'héritage GPL, licence propre AetherVault)
- ✅ Données sensibles jamais en clair sur disque
- ✅ Pas de hash de mot de passe stocké (KDF Argon2id uniquement)
- ✅ Partage chiffré avec dérivation SHA-256 (Étape 8)
- ✅ Coordonnées GPS volontairement exclues des métadonnées EXIF
- ✅ Panic safety : configuration "unwind" pour isolation des panics (fichiers pathologiques)

## 🔐 Licence

AetherVault Media est publié sous la **Licence MIT**.

**Note spéciale sur libmpv** : libmpv-2.dll (inclus dans l'installateur) est distribué sous licence LGPL. Voir la documentation technique (§9) pour les détails de conformité.

## 📖 Documentation complète

Pour l'architecture détaillée, le plan de développement (roadmap), les choix techniques et les étapes de livraison :

👉 **[docs/AetherVault-Media-Documentation-Technique.md](docs/AetherVault-Media-Documentation-Technique.md)**

## 🤝 Contribution

Ce projet est actuellement en développement actif. Les contributions sont bienvenues — consultez la documentation technique pour comprendre l'architecture avant de soumettre des pull requests.

## 📬 Support et retours

Pour les questions, bugs ou suggestions d'amélioration, ouvrez les issues sur GitHub.

---

**Dernière mise à jour** : Étape 8+ — Août 2026  
**Version** : 0.3.0 (Rust/Tauri) + 0.2.0 (TypeScript)  
**Composition** : Rust 55.9% — TypeScript 37.3% — CSS 6.8%  
**Mainteneur** : [@spectglak-ui](https://github.com/spectglak-ui)
