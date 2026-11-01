# assets/branding/

Contient la source graphique officielle du logiciel (nouveau logo « éventail ») :

| Fichier | Rôle |
|---|---|
| `AVM-source.svg` | Source vectorielle principale (3 triangles à dégradé, fond transparent). |
| `AVM-source-petit.svg` | Version simplifiée à 2 couches, pour les tailles de 48 px et moins. |
| `AVM-source.png` | Export 1024×1024 de la source principale (entrée de `tauri icon`). |
| `AVM-source.ico` | Export 256×256 RGBA de la source principale. |

Les déclinaisons utilisées réellement par l'application (tailles multiples,
formats par OS) sont générées à partir de ces fichiers et vivent dans
`apps/desktop/src-tauri/icons/`. Ne pas modifier les icônes directement dans
ce dernier dossier : toujours repartir de la source ici, pour éviter toute
divergence entre les endroits où l'icône est utilisée (exécutable,
installateur, raccourcis, barre des tâches).

## Régénérer les icônes

Depuis `apps/desktop/` :

```
pnpm tauri icon ../../assets/branding/AVM-source.png --ios-color "#0a0b10"
```

Cette commande produit tout le jeu (`.ico`, `.icns`, `.png` par taille, tuiles
Windows, Android, iOS). Pour les petites tailles (16, 24, 32 px, `32x32.png`,
`Square30x30Logo.png`, `Square44x44Logo.png`), remplacer ensuite les rendus
par ceux de `AVM-source-petit.svg`, plus lisibles que la version complète.

Les images de l'installateur NSIS (`installer/header.bmp` 150×57 et
`installer/sidebar.bmp` 164×314) ne sont pas générées par cette commande : elles
sont produites à part avec le même logo.
