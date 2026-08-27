import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";

/** Payload de `private:scan-progress` (Étape 6d-privé) — événement séparé
 * de `library:scan-progress` pour éviter toute collision d'ids entre le
 * coffre privé et le catalogue public. */
interface PrivateScanProgressPayload {
  private_library_id: number;
  phase: "scan" | "thumbnails" | "done";
  processed: number;
  total: number;
  current: string;
}

const PHASE_LABELS: Record<PrivateScanProgressPayload["phase"], string> = {
  scan: "Analyse des fichiers…",
  thumbnails: "Génération des vignettes…",
  done: "",
};

/** Barre de progression du scan privé : mêmes classes CSS que la barre
 * publique (`avm-scan-progress`, déjà dans pages.css). Pendant la phase
 * "scan", la ligne du bas affiche le dossier en cours («
 * sous-bibliothèque ») puis le fichier courant. */
export function PrivateScanProgressBar({ privateLibraryId }: { privateLibraryId: number }) {
  const [progress, setProgress] = useState<PrivateScanProgressPayload | null>(null);

  useEffect(() => {
    const unlisten = listen<PrivateScanProgressPayload>("private:scan-progress", (event) => {
      if (event.payload.private_library_id !== privateLibraryId) return;
      if (event.payload.phase === "done") {
        window.setTimeout(() => setProgress(null), 900);
      } else {
        setProgress(event.payload);
      }
    });
    return () => {
      unlisten.then((stop) => stop());
    };
  }, [privateLibraryId]);

  if (!progress || progress.phase === "done") return null;

  const percent =
    progress.total > 0
      ? Math.min(100, Math.round((progress.processed / progress.total) * 100))
      : 0;

  return (
    <div className="avm-scan-progress">
      <div className="avm-scan-progress__labels">
        <span>{PHASE_LABELS[progress.phase]}</span>
        {progress.total > 0 && (
          <span>
            {progress.processed}/{progress.total}
          </span>
        )}
      </div>
      <div className="avm-scan-progress__track">
        {progress.total > 0 ? (
          <div className="avm-scan-progress__fill" style={{ width: `${percent}%` }} />
        ) : (
          <div className="avm-scan-progress__fill avm-scan-progress__fill--indeterminate" />
        )}
      </div>
      {progress.current && (
        <span className="avm-scan-progress__current">{progress.current}</span>
      )}
    </div>
  );
}