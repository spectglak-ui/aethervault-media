# Changelog

Toutes les modifications notables apportées à ce projet seront documentées dans ce fichier.

## [0.7.5 « Orbite »] - 2026-10-15

### Ajouté
- **Notes personnelles et Watchlist, par profil** : note de 0,5 à 5 étoiles (demi-étoiles) par titre, liste « À regarder » avec statut (À voir / En cours / Vu), page **Watchlist** (filtres par statut et catégorie, tri par ajout, note ou titre), bloc « Ma note / Watchlist » sur la page d'un titre et pastilles sous les affiches des catégories (migration 26)
- **Audio — spatialisation à quatre niveaux** (désactivée, légère, moyenne, forte) et **ambiance cinéma** (graves, voix, réverbération de salle), combinables, avec comparaison A/B sur le média en cours ; appliquées avant chaque chargement et dès le démarrage
- **AetherFy Vidéo — barre de préchargement** superposée à la barre de lecture (vert = tampon, rose = lecture) et indicateur d'avance en secondes (rouge < 3 s, orange < 10 s)
- **AetherFy Vidéo — bouton PiP** dans les contrôles du lecteur, avec retour « Revenir ici »
- **AetherFy Vidéo — pages de chaîne** rangées en trois onglets : Vidéos (format horizontal, tri récentes / anciennes / populaires), Shorts, Playlists (chargées à la demande) ; nouvelle page de playlist de chaîne ; bouton « Tout lire » sur les playlists locales
- **Diagnostics de lecture** : journaux `[playback-diag]` (avance du tampon, débit, images perdues, codec, décodage matériel), durées d'extraction et de démarrage ; interrupteurs d'essai par variables d'environnement (`AVM_GATE_SECS`, `AVM_GATE_TIMEOUT_SECS`, `AVM_CACHE_PAUSE_WAIT`, `AVM_PREFER_AVC`, `AVM_HWDEC`, `AVM_POS_HZ`, `AVM_COBALT_PUBLIC`)

### Corrigé
- **Démarrage lent d'AetherFy** : la lecture attend 8 s d'avance de tampon (au lieu de 30 % de la durée), PO Token pré-généré et renouvelé en arrière-plan, liste des résolutions chargée seulement à l'ouverture du menu (elle relançait un second `yt-dlp`)
- **Mise en mémoire tampon** : indicateur fidèle à mpv (`paused-for-cache`), reprise à la bonne position après rechargement de la source (option `start=`), reprise de lecture moins sensible aux pannes de tampon (`cache-pause-wait`)
- **Saccades en page AetherFy** : file de lecture de plusieurs milliers de vidéos rendue par fenêtres et mémoïsée (elle se re-rendait à chaque événement de position)
- **Lecteur musique** : la page réduite ne se rouvre plus à l'enchaînement automatique ; le bouton Lecture reste actif après « Suivant »
- **Intégrité des données** : la progression et l'historique de lecture AetherFy ne sont plus écrits sur un fichier local homonyme
- **Vue classique d'AetherFy** : s'ouvre à nouveau ; **PiP** : la file, la position et la durée sont renvoyées à l'ouverture
- **Sortie de la page de lecture AetherFy** : quitter la page arrête la lecture (plus de lecteur plein écran par-dessus la page demandée) ; « À regarder plus tard » n'est plus pris pour une page de lecture
- **Playlists AetherFy** : la liste de droite ne contient que les vidéos de la playlist lancée, dans son ordre
- **Audio** : le filtre d'effets est appliqué avant tout chargement (fichiers, AetherFy, TV) et au démarrage ; une virgule dans l'URL d'un flux audio externe ne coupe plus la lecture en vidéo sans son

### Changé
- **Cobalt public désactivé par défaut** (les URL YouTube n'étaient plus envoyées à des serveurs tiers) ; `AVM_COBALT_PUBLIC=1` le réactive
- **AetherFy Vidéo** : « Jeux oniriques », le bouton menu (trois barres) et le bouton « + » sont retirés
- **Réglages par défaut** : fond animé « Ciel de carrés » sélectionné et activé, thème Transparent
- **Paramètres → Qualité de rendu** : description mise à jour (1080p natif stable)
- **Version** : 0.7.5 « Orbite »

## [0.7.0 « Orbite »] - 2026-10-09

### Ajouté
- **Nouvelle identité visuelle « Orbite »** : page de transition AetherFy (choix Vidéo / Musique), accueil repensé (« À la une », « Vos univers », « Ajouts récents », « En chiffres »), en-têtes et surfaces modernes sur les pages Catégories, Paramètres, Profils, Time Capsule, Partage, Collections, Explorer, TV, AetherFy Vidéo et Musique, Lecture et Privé
- **Fonds intégrés** : image « Voie lactée » et fond animé « Ciel de carrés », sélectionnables dans Paramètres (fonds personnels toujours possibles)

### Corrigé
- **Fuite audio HLS** : l'audio d'une chaîne TV pouvait continuer 5 à 10 s après le retour sur la grille (rechargement différé d'`attach_surface` relancé après l'arrêt)
- **Menu de suggestions de la recherche** : toujours affiché au premier plan
- **Barre latérale** : entrée TV en double (menant à `/category/tv`) retirée
- **Avertissements Rust** : plus aucun warning à la compilation

### Changé
- **Version** : 0.7.0 « Orbite » (remplace l'étiquette « Alpha » affichée dans Paramètres)
- **Fond d'AetherFy Vidéo** : transparent, c'est le fond du logiciel qui apparaît

## [0.5.7] - 2026-09-18

### Ajouté
- **Nettoyage automatique des fichiers temporaires** : Timer 24h pour supprimer les fichiers temporaires âgés
- **Buffer audio configurable** : Paramètre `AUDIO_BUFFER_MS` (250-2000ms) pour adapter la performance
- **Constantes nommées Start Gate** : Remplacement des magic numbers par des constantes explicites
- **Support multiplateforme** : Installateurs Windows NSIS, macOS DMG, Linux DEB/AppImage

### Corrigé
- **Gestion d'erreur Cobalt** : Remplacement de `.unwrap()` dangereux par gestion optionnelle sécurisée (ligne 1188)
- **Détection suppressions de fichiers** : Implémentation de `notify::EventKind::Remove` dans le watcher
- **Deadlock potentiel Share Manager** : Gestion sécurisée des poison locks avec `unwrap_or_else`
- **Politique de mot de passe** : Validation renforcée (8+ caractères, maj/min/chiffres/spéciaux)

### Changé
- **Version** : Passage de 0.4.0-alpha à 0.5.7
- **Architecture** : Amélioration de la robustesse et de la sécurité

## [0.3.0] - 2026-08-31
### Corrigé
- Remplacement des binaires d'installation Windows (.exe / .msi) par des versions corrigées et commités dans le dépôt. (commit: 54c709bd7d48eff4bf16ab64dea11c528b06e6ed)

### Notes
- Le numéro de version reste `0.3.0`. Le correctif concerne uniquement les artefacts d'installation fournis (installateurs).
- Voir le README.md pour les instructions d'installation et la mention du correctif.

