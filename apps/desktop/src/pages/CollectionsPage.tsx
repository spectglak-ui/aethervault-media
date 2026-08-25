import { Layers } from "lucide-react";
import { EmptyState, PageHeader } from "@aethervault/ui-kit";

export function CollectionsPage() {
  return (
    <div>
      <PageHeader
        title="Collections"
        description="Regroupez des médias de vos différentes bibliothèques en collections thématiques."
      />
      <EmptyState
        icon={<Layers size={32} />}
        title="Aucune collection créée"
        description="Cette fonctionnalité sera détaillée et implémentée avec le reste de la personnalisation avancée."
      />
    </div>
  );
}
