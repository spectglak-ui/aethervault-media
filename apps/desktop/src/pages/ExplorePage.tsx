import { useSearchParams } from "react-router-dom";
import { Compass } from "lucide-react";
import { EmptyState, PageHeader } from "@aethervault/ui-kit";

export function ExplorePage() {
  const [searchParams] = useSearchParams();
  const query = searchParams.get("q");

  return (
    <div>
      <PageHeader
        title="Explorer"
        description="Parcourez et recherchez à travers toutes vos bibliothèques."
      />
      <EmptyState
        icon={<Compass size={32} />}
        title={query ? `Recherche : "${query}"` : "Aucune recherche en cours"}
        description="Le moteur de recherche multi-critères (nom, acteur, genre, année…) sera implémenté à l'Étape 7."
      />
    </div>
  );
}
