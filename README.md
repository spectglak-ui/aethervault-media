# AetherVault Media

<img width="1919" height="635" alt="AetherVault Media - Centre multimédia personnel" src="https://github.com/user-attachments/assets/9152b0d9-8d67-4511-b3d8-588f48f80259" />

**AetherVault Media** est un centre multimédia personnel, **local-first**, entièrement installé sur votre appareil. Gérez votre bibliothèque de films, séries, anime et galeries privées — sans serveur, sans compte en ligne, hors-ligne par défaut.

**État actuel** : **0.4.0 Alpha** — Lecteur vidéo OpenGL intégré, coffre privé chiffré AES-256-GCM, partage sécurisé par code, galeries d'images chiffrées, scan parallélisé, installateur Windows NSIS complet, profils multi-utilisateurs.

---

##  Fonctionnalités principales

###  Gestion de bibliothèque avancée
- **Catalogue public** : films, séries et anime avec détection automatique des saisons et épisodes
- **Coffre privé chiffré** : vidéos et galeries d'images protégées en **AES-256-GCM**
- **Métadonnées enrichies** : intégration TMDB (synopsis, affiches, casting, genres, notes)
- **Profils multi-utilisateurs** : authentification avec intro animée et sélection de profil
- **Watcher automatique** : détecte les nouveaux fichiers médias en temps réel

###  Lecteur multimédia haute performance
- **Moteur libmpv intégré** : support complet des formats/codecs via FFmpeg
- **Rendu OpenGL headless** : performance optimale, accélération matérielle multiplateforme
- **Modes de lecture** : lecteur plein écran, mode flottant, interface intégrée
- **Shaders de post-traitement** : 4 presets WebGL (Désactivé, Netteté, Couleurs vives, Anime4K-lite)
- **Informations techniques** : résolution, codecs, langues audio et sous-titres en direct

###  Exploration et recherche intelligente
- **Explorateur multicritère** : recherchez par titre, catégorie, année, genre, acteur, réalisateur, résolution, codec, langue
- **Facets intelligentes** : navigation intuitive avec compteur de résultats en temps réel
- **Barre de recherche globale** : accès rapide via raccourci shell
- **Fonds d'écran dynamiques** : bannières TMDB automatiquement appliquées aux pages titre

###  Interface utilisateur moderne
- **Accueil v2** : héro à la une avec synopsis et boutons d'action, rangées style Netflix
- **Fenêtre frameless** : design moderne sans barre de titre native, draggable
- **Thème sombre cohérent** : scrollbars personnalisées et adaptation complète
- **Maximisée au démarrage** : expérience immersive dès le lancement
- **Animations fluides** : transitions Framer Motion pour une UI premium

###  Partage sécurisé
- **Partage via code** : générez un code partageable pour inviter d'autres utilisateurs
- **Chiffrement bout-à-bout** : SHA-256 + AES-256-GCM pour les données partagées
- **Ouverture de port UPnP** : support optionnel pour le LAN (configurable)
- **Isolation réseau** : jamais d'exposition non contrôlée des données

###  Galeries d'images privées
- **Stockage chiffré** : images protégées en **AES-256-GCM**, jamais en clair sur disque
- **Formats supportés** : JPEG, PNG, WebP, GIF, BMP, TIFF
- **Métadonnées EXIF** : date de prise de vue et modèle d'appareil préservés (GPS volontairement exclu pour la confidentialité)
- **Scan parallélisé** : analyse ultra-rapide avec Rayon, même sur les grandes collections

###  Performance et sécurité
- **Vignettes d'aperçu automatiques** : extraites efficacement à ~1s de chaque épisode
- **Scan d'images parallélisé** : performance optimale sur multi-cœurs via Rayon
- **Barre de progression du scan** : suivi en temps réel (analyse → appariement → vignettes)
- **Chiffrement du coffre** : Argon2id (KDF) + AES-256-GCM, jamais en clair sur disque
- **Aucune dépendance système** : SQLite bundled, rustls (100% Rust), pas de C non contrôlé
- **Panic safety** : isolation des panics sur fichiers pathologiques, l'app reste stable

---

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

#### Mode développement
```bash
# Téléchargez la build LGPL de libmpv depuis :
# https://sourceforge.net/projects/mpv-player-windows/files/
# 
# Déposez libmpv-2.dll à côté de l'exécutable :
apps/desktop/src-tauri/target/debug/libmpv-2.dll
```

Sans ce fichier, le reste de l'application fonctionne — seules les commandes de lecture retourneront une erreur explicite (`PlaybackEngineState::Unavailable`).

#### Mode production (Installateur)
```bash
# Avant de lancer tauri build :
cp libmpv-2.dll apps/desktop/src-tauri/libs/

# L'installateur embarquera automatiquement le binaire dans :
<installation>\resources\libmpv-2.dll
```

---

##  Installation et utilisation

### Mode développement (hot-reload)

**Installation initiale** :
```bash
pnpm install
pnpm dev
```

L'application se lance en mode debug avec hot-reload Vite. Les modifications au frontend se reflètent instantanément.

### Mode production — Installateur NSIS

**Générer l'installateur** :
```bash
# Assurez-vous que libmpv-2.dll est dans apps/desktop/src-tauri/libs/
pnpm build
```

Cela produit :
```
apps/desktop/src-tauri/target/release/bundle/nsis/AetherVault\ Media_0.4.0-alpha_x64-setup.exe
```

**Caractéristiques de l'installateur (Étape 8)** :
- ✅ Interface de sélection de langue (FR/EN)
- ✅ Installation par utilisateur (sans UAC)
- ✅ Raccourci automatique au Menu Démarrer
- ✅ Inscription dans « Applications installées »
- ✅ Désinstallation complète et propre
- ⚠️ Signature de code non incluse (avertissement SmartScreen possible au premier lancement)

**Données utilisateur** : Les données sont stockées dans `%APPDATA%` et ne sont jamais modifiées par l'installation ou la désinstallation.

---

##  Architecture

### Stack technologique

| Composant | Détails |
|---|---|
| **Backend** | Rust 2021 (1.77+) avec Tauri 2 — **51.9% du code** |
| **Frontend** | React 18 + React Router 6 + TypeScript 5 — **43.1% du code** |
| **Styles** | CSS 3 avec variables de thème — **5% du code** |
| **Build** | Vite 5, pnpm 9.0.0 workspaces |
| **Base de données** | SQLite bundled (rusqlite) + connection pooling (r2d2) |
| **Lecteur vidéo** | libmpv (chargement dynamique, rendu OpenGL) |
| **Traitement audio** | Symphonia 0.5 (analyse spectrales multi-format) |
| **FFT** | RustFFT 6 (transformées de Fourier) |
| **Chiffrement** | AES-256-GCM (crate pure Rust) + Argon2id KDF |

### Structure monorepo (pnpm workspaces)

```
aethervault-media/
├── apps/
│   └── desktop/
│       ├── src-tauri/          # Rust (Tauri) 0.4.0-alpha
│       │   ├── src/
│       │   │   ├── commands/       # Handlers IPC (scan, playback, vault)
│       │   │   ├── services/       # Métier (lecteur, scanner, chiffrement)
│       │   │   ├── models/         # Persistance (SQLite)
│       │   │   └── security/       # Chiffrement AES-256-GCM
│       │   ├── Cargo.toml
│       │   └── libs/
│       │       └── libmpv-2.dll    # À copier avant build
│       ├── src/                # React + TypeScript 0.4.0-alpha
│       │   ├── pages/
│       │   ├── components/
│       │   ├── hooks/
│       │   └── player/
│       ├── package.json
│       └── tauri.conf.json
├── packages/
│   ├── shared-types/           # Types TypeScript partagés (0.1.0)
│   │   └── src/index.ts
│   └── ui-kit/                 # Composants React réutilisables
│       ├── Button.tsx
│       ├── Modal.tsx
│       └── ...
└── pnpm-workspace.yaml
```

### Dépendances principales (Rust 0.4.0-alpha)

| Domaine | Crates | Notes |
|---------|--------|-------|
| **Base de données** | `rusqlite 0.31`, `r2d2 0.8`, `r2d2_sqlite 0.24` | SQLite bundled, connection pooling |
| **Chiffrement** | `aes-gcm 0.10`, `argon2 0.5`, `rand 0.8` | AES-256-GCM + Argon2id KDF, 100% Rust |
| **Chiffrement de partage** | `sha2 0.10`, `igd 0.12` | SHA-256 + UPnP pour partage via code |
| **Multimédia** | `image 0.25.8`, `kamadak-exif 0.6`, `base64 0.22` | Décodage images, EXIF (sans GPS), vignettes |
| **Audio** | `symphonia 0.5`, `rustfft 6` | Décodage audio multi-format, spectres |
| **Réseau** | `ureq 2`, `igd 0.12` | Client HTTP pur + UPnP |
| **Système de fichiers** | `walkdir 2`, `notify 6` | Récursion + watcher temps réel |
| **Lecteur vidéo** | `libloading 0.8` | Chargement dynamique de libmpv |
| **Parallélisation** | `rayon 1` | Scan d'images parallélisé, multi-cœurs |
| **Frontend bridge** | `tauri 2`, `tauri-plugin-log 2`, `tauri-plugin-dialog 2` | IPC et plugins Tauri 2 |
| **Sérialisation** | `serde 1`, `serde_json 1` | Structures de données |
| **Temps** | `chrono 0.4` | Timestamps et fuseaux horaires |
| **Logging** | `log 0.4` | Logging unifié Rust/frontend |

### Flux de données

```
Utilisateur (UI React)
    ↓
Commandes Tauri IPC (invoke)
    ↓
Command Handlers Rust (src-tauri/src/commands)
    ↓
Application Layer (Library Manager, Playback Manager)
    ↓
Services (Scanner, Metadata Provider, Encryption)
    ↓
Data Layer (SQLite, File System)
    ↓
Événements retour (IPC events)
    ↓
Mise à jour du frontend (React State)
```

---

## 🔐 Principes de sécurité

- ✅ **Aucune dépendance C système** : rustls, Rust pur, zéro liaison statique à C non contrôlé
- ✅ **Chiffrement du coffre applicatif** : niveau SQLite, pas SQLCipher (Argon2id + AES-256-GCM)
- ✅ **libmpv chargée dynamiquement** : pas d'héritage GPL, licence propre AetherVault
- ✅ **Données sensibles jamais en clair** : tous les secrets en mémoire chiffrés
- ✅ **Pas de hash de mot de passe** : KDF Argon2id uniquement, jamais stocké
- ✅ **Partage chiffré** : dérivation SHA-256 + AES-256-GCM pour chaque partage
- ✅ **Métadonnées EXIF sélectives** : GPS volontairement exclu pour la confidentialité
- ✅ **Panic safety** : configuration "unwind" pour isolation des panics (fichiers pathologiques)

---

##  Licence

AetherVault Media est publié sous la **Licence MIT**.

**Note spéciale sur libmpv** : libmpv-2.dll (inclus dans l'installateur) est distribué sous licence LGPL. Voir la documentation technique pour les détails de conformité.

---

##  Documentation complète

Pour l'architecture détaillée, le plan de développement (roadmap), les choix techniques et les étapes de livraison :

 **[docs/AetherVault-Media-Documentation-Technique.md](docs/AetherVault-Media-Documentation-Technique.md)**

---

##  Contribution

Ce projet est en développement actif sous Tauri 2. Les contributions sont bienvenues — consultez la documentation technique pour comprendre l'architecture avant de soumettre des pull requests.

Points chauds pour les contributeurs :
- Optimisations du pipeline vidéo OpenGL (latence, ressources)
- Tests sur configurations hétérogènes (résolutions, codecs, formats)
- Support Linux/macOS (buildchain, testage)
- Plugins et architecture extensible (roadmap future)

---

##  Support et retours

Pour les questions, bugs ou suggestions d'amélioration, ouvrez les issues sur GitHub.

---

**Dernière mise à jour** : 3 septembre 2026  
**Version** : 0.4.0-alpha (Rust/Tauri) + 0.4.0-alpha (TypeScript)  
**Composition** : Rust 51.9% — TypeScript 43.1% — CSS 5%  
**Mainteneur** : [@spectglak-ui](https://github.com/spectglak-ui)
