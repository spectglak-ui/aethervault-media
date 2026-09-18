import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import "./ScanProgressBar.css";

/** Payload de `library:scan-progress` (Étape 6d) — un seul événement,
 * trois phases utiles + le signal de fin `done`. */
interface ScanProgressPayload {
  library_id: number;
  phase: "scan" | "metadata" | "thumbnails" | "done";
  processed: number;
  total: number;
  current: string;
}

const PHASE_LABELS: Record<ScanProgressPayload["phase"], string> = {
  scan: "Analyse",
  metadata: "Appariement",
  thumbnails: "Vignettes",
  done: "",
};

/** Mini barre de progression d'un scan (Étape 6d), à placer à côté du
 * bouton « Scanner » d'une bibliothèque. N'affiche strictement rien tant
 * qu'aucun scan n'est actif pour `libraryId` — zéro impact visuel au
 * repos. Suit les trois phases de la chaîne (analyse des fichiers →
 * appariement Metadata Service → génération des vignettes) et disparaît
 * ~0 ms après le signal `done`. */
export function ScanProgressBar({ libraryId }: { libraryId: number }) {
  const [progress, setProgress] = useState<ScanProgressPayload | null>(null);

  useEffect(() => {
    const unlisten = listen<ScanProgressPayload>("library:scan-progress", (event) => {
      if (event.payload.library_id !== libraryId) return;
      if (event.payload.phase === "done") {
        setProgress(null);
      } else {
        setProgress(event.payload);
      }
    });
    return () => {
      unlisten.then((stop) => stop());
    };
  }, [libraryId]);

  if (!progress || progress.phase === "done") return null;

  const percent =
    progress.total > 0
      ? Math.min(100, Math.round((progress.processed / progress.total) * 100))
      : 0;

  return (
    <div className="avm-scan-progress--inline" title={progress.current}>
      <span className="avm-scan-progress__label">
        {PHASE_LABELS[progress.phase]}
        {progress.total > 0 ? ` ${progress.processed}/${progress.total}` : ""}
      </span>
      <div className="avm-scan-progress__track">
        {progress.total > 0 ? (
          <div className="avm-scan-progress__fill" style={{ width: `${percent}%` }} />
        ) : (
          <div className="avm-scan-progress__fill avm-scan-progress__fill--indeterminate" />
        )}
      </div>
    </div>
  );
}