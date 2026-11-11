# Changelog

Toutes les modifications notables apportées à ce projet seront documentées dans ce fichier.

## [0.7.9] - 2026-11-11

### Ajouté
- **Statuts de visionnage automatiques « À voir / En cours / Vu »** (migration 28), par profil et par média. Tous les médias sont « À voir » au départ ; un média commencé (au moins 30 s et 1 %) passe « En cours » et un nouveau clic reprend la lecture à la position où elle s'était arrêtée ; un média terminé passe « Vu ». Annotation sous les affiches des catégories, sur la page d'un titre et sur chaque épisode (avec barre d'avancement). Une série est « En cours » dès qu'un épisode est commencé ou terminé, « Vu » quand tous les épisodes le sont (« 3/10 »).
- **Seuil « Vu » intelligent** (plus de 95 % fixe) : fin du fichier atteinte, OU arrêt jusqu'à 15 s avant le début du générique de fin détecté (épisodes analysés), pendant ou après celui-ci ; à défaut de générique connu, queue de secours de 5 % de la durée bornée entre 45 s et 6 min. Un générique « détecté » avant 60 % de la durée est ignoré. Un média « Vu » ne repasse jamais « En cours » tout seul (revoir un film à moitié le laisse « Vu »).
- **Page d'un titre** : bouton de lecture adapté (Lecture / Reprendre à 42:10 / Revoir pour un film ; Commencer / Reprendre / Épisode suivant · S1 · É4 pour une série) et **Marquer comme vu / non vu** (un film, un épisode ou une série entière).
- Dernier instantané de progression enregistré à l'arrêt et à la fin de la lecture (la sauvegarde périodique, toutes les 5 s, pouvait fausser le statut).

### Changé
- Les médias déjà regardés avant la mise à jour sont repris : historique terminé à ≥ 95 % → « Vu », progression existante → « En cours ».
- Le statut de la **Watchlist** suit désormais le statut automatique pour les titres qu'elle contient, et marquer « Vu » / « À voir » dans la Watchlist s'applique aussi aux médias. Sous les affiches, la Watchlist n'est plus qu'un marque-page.

## [0.7.8 « Orbite »] - 2026-11-05

### Ajouté
- **Sons d'interface** : 19 sons doux et « premium » (clic, bouton principal, interrupteur on/off, navigation, ouverture/fermeture de fenêtres, succès, erreur, notification, favori, suppression, copie, verrouillage/déverrouillage du coffre, lecture, signature à la connexion) déclenchés automatiquement sur les boutons, liens, onglets, cases à cocher, dialogues et messages, et sur les événements de l'application (analyse terminée, demande d'ami). Atténués pendant une lecture. **Paramètres → Sons de l'interface** : interrupteur général, volume, tic discret au survol, signature de connexion, boutons d'écoute. Les sons sont synthétisés par `scripts/generate-ui-sounds.py` (aucun échantillon externe) et rejoués via Web Audio, à faible latence.
- **Thème Transparent — couleurs personnalisables** (Paramètres) : couleur d'accentuation, teinte ET opacité du fond, des panneaux et de la barre latérale, couleur du texte, 7 ambiances prêtes à l'emploi (Violet nuit, Océan, Forêt, Crépuscule, Ambre, Rouge cinéma, Graphite), aperçu en direct, avertissement de lisibilité et retour aux couleurs d'origine. L'opacité est conservée (l'éditeur détaillé de couleurs la perdait).
- **Bandes annonces dans le Héro de l'accueil** (Paramètres, désactivé par défaut) : la bande-annonce du titre à la une remplace l'image de bannière (muette, en boucle, bouton pour activer le son, pause hors de l'écran). Sans bande-annonce ou hors ligne, la bannière reste affichée.
- **Recherche avancée dans la barre de recherche globale** : un bouton « Filtres » à droite du champ ouvre un panneau (type de média Film / Série / Anime / Documentaire, genre, année ou décennie, acteur, réalisateur, saga, résolution, codec, langue audio) avec compteurs et nombre de résultats en direct ; « Afficher les résultats » ouvre la page de résultats `/search`. La recherche libre couvre désormais aussi les acteurs, les réalisateurs et les sagas.
- **Filtres sur chaque page de catégorie** (Films, Séries, Animés, Documentaires) : panneau de filtres à cases à cocher avec compteurs, pastilles de filtres actifs retirables et compteur « N sur M titres ».
- **Collections intelligentes** (onglet « Intelligentes » de la page Collections) : collections automatiques par saga, genre, réalisateur, acteur, studio, décennie, qualité d'image et « mieux notés », mises à jour seules.
- **Sagas** (migration 27) : la saga TMDB (`belongs_to_collection`) est mémorisée à l'enrichissement ; les films déjà présents sont analysés en tâche de fond au premier affichage des Collections (clé API TMDB requise).
- **Logo** dans la barre latérale, à côté du nom.

### Changé
- La page **Explorer** est retirée de la barre latérale : sa recherche multicritère vit dans la barre globale et dans `/search` (l'ancienne adresse `/explore` redirige).
- Nouveau logo : icônes de l'application, images de l'installateur, écran d'intro (halo et ombre passés de l'orange au violet/teal).
- **Version** : 0.7.8 « Orbite »

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

### Ajouts
- **Collections intelligentes** : sagas, genres, réalisateurs regroupés automatiquement
- **Portails Collections & Watchlist** sur l'accueil avec teintes cohérentes
- **Bande-annonce héro** : lecture automatique en arrière-plan (désactivable)
- **Sons d'interface** : 19 effets sonores pour une meilleure rétroaction
- **Recherche à facettes** : filtres par genre, année, résolution
- **Sagas** : migration SQL + regroupement automatique

### Corrections
- `fetch_update` déprécié remplacé par `try_update` (warning Rust)
- Teintes des tuiles Collections/Watchlist alignées sur les pages

### Technique
- Migration SQL `0027_sagas.sql`
- Composant `SmartCollectionsView`
- Page `SearchPage` avec filtres avancés