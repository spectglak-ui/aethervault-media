# assets/branding/

Contient la source graphique officielle du logiciel : `AVM-source.ico`
(icône fournie par le porteur du projet, 256×256, RGBA).

Les déclinaisons utilisées réellement par l'application (tailles multiples,
formats par OS) sont générées à partir de ce fichier source et vivent dans
`apps/desktop/src-tauri/icons/`. Ne pas modifier les icônes directement dans
ce dernier dossier : toujours repartir de la source ici, pour éviter toute
divergence entre les endroits où l'icône est utilisée (exécutable,
installateur, raccourcis, barre des tâches).

Formats à ajouter dans une prochaine étape (support Linux/macOS) :
`.icns` (macOS) et un jeu de `.png` à tailles fixes (spécification
freedesktop.org pour Linux).
