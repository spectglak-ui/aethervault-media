# AetherVault Media

<div align="center">

![AetherVault Media](https://github.com/user-attachments/assets/9152b0d9-8d67-4511-b3d8-588f48f80259)

**Centre multimédia personnel, local-first, entièrement contrôlé par vous**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE.txt)
[![Rust](https://img.shields.io/badge/Backend-Rust%201.77%2B-CE422B?logo=rust)](https://www.rust-lang.org/)
[![TypeScript](https://img.shields.io/badge/Frontend-TypeScript%205-3178C6?logo=typescript)](https://www.typescriptlang.org/)
[![Tauri](https://img.shields.io/badge/Framework-Tauri%202-FFC131?logo=tauri)](https://tauri.app/)

[Caractéristiques](#-caractéristiques) • [Installation](#-installation) • [Architecture](#-architecture) • [Contribution](#-contribution)

</div>

---

## À propos

**AetherVault Media** est une application de bureau moderne combinant la puissance d'un lecteur vidéo professionnel avec l'expérience d'une médiathèque contemporaine. Gérez votre bibliothèque locale, profitez d'une lecture immersive, et gardez le contrôle total de vos contenus, sans dépendre d'un cloud externe ni d'un compte tiers.

- **Local-First** : Aucun compte, aucun cloud, aucune dépendance réseau
- **Chiffrement intégral** : Section privée protégée en AES-256-GCM
- **Haute performance** : Lecteur basé sur libmpv avec rendu OpenGL optimisé
- **Multiplateforme** : Windows, Linux, macOS (Tauri)
- **Bibliothèque universelle** : films, séries, anime, documentaires, manga, webtoons, bandes dessinées et romans
- **Open Source** : MIT License

**Version actuelle** : 0.6.5 (backend) / 0.5.7 (frontend)

---

## ✨ Caractéristiques

### 📚 Gestion de bibliothèque avancée
- Catalogue public multi-catégories : films, séries, anime, documentaires, manga, webtoons, BD et romans
- **Détection automatique** des saisons, épisodes et tomes
- **Coffre privé chiffré** : vidéos, galeries d'images et bibliothèques de lecture en AES-256-GCM
- Métadonnées enrichies via TMDB, OpenLibrary et sources locales : affiches, synopsis, genres, auteurs, éditeurs, dates de publication
- **Profils multi-utilisateurs** avec authentification et intro animée
- **Watcher automatique** : détecte les nouveaux fichiers en temps réel

### 📖 Lecture numérique et bandes dessinées
- Support des catégories de lecture : **Manga**, **Webtoon**, **BD**, **Roman**, **Comics** et **Livres numériques**
- Gestion des **séries, tomes, chapitres, volumes et épisodes** avec indexation automatique
- **Progression de lecture** par page, chapitre ou volume, mémorisée localement
- Suivi visuel des titres lus, en cours et à terminer
- Navigation facilitée par **auteur, éditeur, genre, série, année, statut de lecture**
- Interface optimisée pour les formats à lecture verticale, horizontale et paginée
- Présentation élégante des couvertures, résumés et métadonnées de collection

### 🎬 Lecteur multimédia haute performance
- Moteur **libmpv** intégré avec support FFmpeg complet
- Rendu **OpenGL headless** avec accélération matérielle multiplateforme
- 4 presets de post-traitement : Standard, Netteté, Couleurs vives, Anime4K-lite
- Modes de lecture : plein écran, fenêtre flottante, interface intégrée
- Informations techniques en direct : résolution, codecs, langues audio/sous-titres

### 🔍 Exploration et recherche intelligente
- **Explorateur multicritère** : titre, catégorie, année, genre, acteur, réalisateur, résolution, codec, langue
- Facettes dynamiques avec compteurs en temps réel
- Barre de recherche globale avec raccourci shell
- Fonds d'écran dynamiques : bannières TMDB automatiquement appliquées

### 🎨 Interface utilisateur moderne
- Accueil v2 avec héro à la une et rangées Netflix-style
- Fenêtre frameless avec draggable sans barre de titre native
- Thème sombre cohérent avec scrollbars personnalisées
- Animations fluides via Framer Motion
- Maximisée au démarrage pour expérience immersive

### 🔐 Partage sécurisé
- Partage via code : invitez d'autres utilisateurs
- Chiffrement bout-à-bout : SHA-256 + AES-256-GCM
- Support UPnP optionnel pour LAN (configurable)
- Isolation réseau : zéro exposition non contrôlée

### 🖼️ Galeries d'images privées
- Stockage chiffré en AES-256-GCM (jamais en clair sur disque)
- Formats supportés : JPEG, PNG, WebP, GIF, BMP, TIFF
- Métadonnées EXIF préservées (GPS volontairement exclu)
- Scan parallélisé ultra-rapide avec Rayon (multi-cœurs)

### ⚡ Performance et sécurité
- Vignettes d'aperçu automatiques (~1s par épisode)
- SQLite bundled : zéro configuration
- **100 % Rust** : rustls, aucune dépendance C non contrôlée
- Chiffrement du coffre : Argon2id (KDF) + AES-256-GCM
- Panic safety : isolation des panics sur fichiers pathologiques

---

## 📋 Prérequis

### Windows
- **Rust** 1.77+ ([rustup](https://rustup.rs))
- **Node.js LTS** 20+
- **pnpm** 9.0.0+ (via `corepack enable`)
- **Microsoft C++ Build Tools** (Desktop development with C++)
- **WebView2 Runtime** (préinstallé Windows 11 ; [installer](https://developer.microsoft.com/microsoft-edge/webview2/) sur Windows 10)

### macOS
- **Rust** 1.77+
- **Node.js LTS** 20+
- **pnpm** 9.0.0+
- **Xcode Command Line Tools** (`xcode-select --install`)

### Linux (Debian/Ubuntu)
- **Rust** 1.77+
- **Node.js LTS** 20+
- **pnpm** 9.0.0+
- **Dépendances système** :
  ```bash
  sudo apt-get install libssl-dev libgtk-3-dev libayatana-appindicator3-dev libxdotool-dev
  ```

### libmpv (crucial pour la lecture vidéo)

L'application fonctionne complètement sans lecteur, mais les commandes de lecture retourneront `PlaybackEngineState::Unavailable`.

#### Mode développement
```bash
# Téléchargez la build LGPL depuis :
# https://sourceforge.net/projects/mpv-player-windows/files/ (Windows)
# https://mpv.io/installation/ (macOS/Linux)
# 
# Déposez le binaire :
# Windows:  apps/desktop/src-tauri/libs/libmpv-2.dll
# macOS:    apps/desktop/src-tauri/libs/libmpv.dylib
# Linux:    apps/desktop/src-tauri/libs/libmpv.so
```

#### Mode production (Installateur)
```bash
# Avant de lancer la build :
cp libmpv-2.dll apps/desktop/src-tauri/libs/

# L'installateur embarquera automatiquement le binaire
```

---

## 🚀 Installation et utilisation

### Mode développement (hot-reload)

```bash
# Installation initiale
pnpm install

# Démarrage avec hot-reload Vite
pnpm dev
```

Vite recompile le frontend instantanément à chaque modification. Tauri recharge la fenêtre automatiquement.

### Mode production — Installateurs multiplateformes

```bash
# Générer les installateurs
pnpm build
```

Produit selon la plateforme :

**Windows** :
```
apps/desktop/src-tauri/target/release/bundle/nsis/AetherVault Media_0.6.5_x64-setup.exe
```
- ✅ Sélection de langue (FR/EN)
- ✅ Installation par utilisateur (sans UAC)
- ✅ Raccourci Menu Démarrer
- ✅ Intégration "Applications installées"
- ✅ Désinstallation propre

**macOS** :
```
apps/desktop/src-tauri/target/release/bundle/dmg/AetherVault Media_0.6.5_x64.dmg
```
- ✅ Drag & drop vers /Applications
- ✅ Intégration Dock

**Linux** :
```
# Debian/Ubuntu
apps/desktop/src-tauri/target/release/bundle/deb/aethervault-media_0.6.5_amd64.deb

# AppImage
apps/desktop/src-tauri/target/release/bundle/appimage/AetherVault Media_0.6.5_amd64.AppImage
```
- ✅ Installation via `dpkg -i` (DEB)
- ✅ Exécution directe (AppImage)
- ✅ Intégration menu applications

**Données utilisateur** : stockées dans `%APPDATA%` (Windows), `~/Library/Application Support/` (macOS), ou `~/.config/` (Linux) — jamais modifiées par l'installateur.

---

## 🏗️ Architecture

### Stack technique

| Composant | Détails |
|-----------|---------|
| **Backend** | Rust 2021 (1.77+) avec Tauri 2 — 51.2% du code |
| **Frontend** | React 18 + React Router 6 + TypeScript 5 — 43.6% du code |
| **Styles** | CSS 3 avec système de variables de thème — 5.2% du code |
| **Build** | Vite 5, pnpm 9.0.0 workspaces |
| **BD** | SQLite bundled (rusqlite) + connection pooling (r2d2) |
| **Lecteur** | libmpv (chargement dynamique, rendu OpenGL) |
| **Audio** | Symphonia 0.5 (décodage multi-format) |
| **Chiffrement** | AES-256-GCM (Rust pur) + Argon2id KDF |

### Structure du monorepo

```
aethervault-media/
├── apps/
│   └── desktop/                    # Application Tauri
│       ├── src-tauri/              # Backend Rust
│       │   ├── src/
│       │   │   ├── commands/       # Handlers IPC (scan, playback, vault)
│       │   │   ├── services/       # Métier (lecteur, scanner, chiffrement)
│       │   │   ├── domain/         # Logique de domaine (profils, lib)
│       │   │   ├── models/         # Persistance (SQLite)
│       │   │   ├── security/       # Chiffrement AES-256-GCM
│       │   │   └── db/             # Migrations, schéma
│       │   ├── Cargo.toml
│       │   └── libs/               # libmpv binaries (à ajouter)
│       ├── src/                    # Frontend React
│       │   ├── pages/              # Pages routées
│       │   ├── components/         # Composants réutilisables
│       │   ├── layout/             # Shell et structure
│       │   ├── player/             # Moteur du lecteur
│       │   ├── hooks/              # Hooks personnalisés
│       │   ├── services/           # API Tauri commands
│       │   └── theme/              # Variables CSS et thème
│       ├── package.json
│       └── tauri.conf.json
├── packages/
│   ├── shared-types/               # Types TypeScript partagés
│   └── ui-kit/                     # Composants UI réutilisables
└── pnpm-workspace.yaml
```

### Flux de données

```
UI React
    ↓
Tauri Commands (IPC)
    ↓
Backend Handlers (Rust)
    ↓
Services (Scanner, Metadata, Encryption)
    ↓
Data Layer (SQLite, File System)
    ↓
Events (IPC events)
    ↓
State React Update
```

### Dépendances Rust principales

| Domaine | Crates | Notes |
|---------|--------|-------|
| **BD** | `rusqlite 0.31`, `r2d2 0.8` | SQLite bundled, pooling |
| **Chiffrement** | `aes-gcm 0.10`, `argon2 0.5` | AES-256-GCM + KDF |
| **Multimédia** | `image 0.25.8`, `kamadak-exif 0.6` | Décodage images, EXIF |
| **Audio** | `symphonia 0.5`, `rustfft 6` | Décodage multi-format |
| **Réseau** | `ureq 2`, `igd 0.12` | Client HTTP pur + UPnP |
| **Fichiers** | `walkdir 2`, `notify 6` | Récursion + watcher |
| **Lecteur** | `libloading 0.8` | Chargement dynamique libmpv |
| **Parallélisation** | `rayon 1` | Scan multi-cœurs |
| **Tauri** | `tauri 2`, plugins | IPC et plugins officiels |

---

## 🔐 Principes de sécurité

- ✅ **Aucune dépendance C système** : rustls, Rust pur, zéro liaison statique
- ✅ **Chiffrement du coffre applicatif** : Argon2id + AES-256-GCM au niveau SQLite
- ✅ **libmpv chargée dynamiquement** : pas d'héritage GPL, licence propre
- ✅ **Données sensibles jamais en clair** : secrets chiffrés en mémoire
- ✅ **Partage chiffré** : dérivation SHA-256 + AES-256-GCM
- ✅ **Métadonnées EXIF sélectives** : GPS volontairement exclu
- ✅ **Panic safety** : isolation des panics sur fichiers pathologiques

---

## 📖 Documentation

Pour l'architecture détaillée, la roadmap complète et les choix techniques en profondeur :

👉 **[docs/AetherVault-Media-Documentation-Technique.md](docs/AetherVault-Media-Documentation-Technique.md)**

---

## 🤝 Contribution

Ce projet est en développement actif sous Tauri 2. Les contributions sont bienvenues !

**Avant de démarrer** : consultez la [documentation technique](docs/AetherVault-Media-Documentation-Technique.md) pour comprendre l'architecture.

**Points chauds pour contributeurs** :
- Optimisations du pipeline vidéo OpenGL (latence, ressources)
- Tests sur configurations hétérogènes (résolutions, codecs, formats)
- Support Linux/macOS (buildchain, testage)
- Plugins et architecture extensible (roadmap)

---

## 📝 Licence

AetherVault Media est publié sous la **[Licence MIT](LICENSE.txt)**.

**Note spéciale sur libmpv** : libmpv (inclus dans l'installateur) est distribué sous licence LGPL. Voir la [documentation technique](docs/AetherVault-Media-Documentation-Technique.md) pour les détails.

---

## 💬 Support et retours

Pour les questions, bugs ou suggestions d'amélioration :
- **Issues** : [Ouvrir une issue GitHub](https://github.com/spectglak-ui/aethervault-media/issues)
- **Discussions** : [Rejoindre les discussions](https://github.com/spectglak-ui/aethervault-media/discussions)

---

<div align="center">

**Fabriqué avec ❤️ en Rust et TypeScript**

![Rust](https://img.shields.io/badge/51.2%25-Rust-CE422B?style=flat-square&logo=rust) ![TypeScript](https://img.shields.io/badge/43.6%25-TypeScript-3178C6?style=flat-square&logo=typescript) ![CSS](https://img.shields.io/badge/5.2%25-CSS-1572B6?style=flat-square&logo=css3)

**Dernière mise à jour** : Octobre 2026  
**Mainteneur** : [@spectglak-ui](https://github.com/spectglak-ui)

</div>
