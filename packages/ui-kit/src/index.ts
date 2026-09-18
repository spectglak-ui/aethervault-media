// Effets de bord : injecte les jetons de thème et les styles des composants
// dès que quoi que ce soit est importé depuis "@aethervault/ui-kit". Import
// relatif (résolu par rapport à ce fichier), fonctionne donc quel que soit
// l'alias utilisé côté application pour atteindre ce module.
import "./theme/tokens.css";
import "./components/components.css";

export * from "./theme/ThemeProvider";
export * from "./components";
