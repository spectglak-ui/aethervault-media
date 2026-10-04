import { BookOpen, Clapperboard, Film, Lock, Sparkles, Tv } from "lucide-react";

/** 0.3.0 : icônes de catégories en lucide-react — même style visuel
que les autres boutons de navigation (Compass, Layers, Users…), en
remplacement des émojis historiques dans la sidebar.
0.7.0 : ajout de la catégorie système « reading » (Lecture) — icône
BookOpen, cohérente avec le hero de ReadingHomePage. */
export function categoryIcon(key: string, size = 18) {
  switch (key) {
    case "movies":
      return <Film size={size} />;
    case "series":
      return <Tv size={size} />;
    case "anime":
      return <Sparkles size={size} />;
    case "documentaries":
      return <Clapperboard size={size} />;
    case "private":
      return <Lock size={size} />;
    case "reading":
      return <BookOpen size={size} />;
    default:
      return <Film size={size} />;
  }
}