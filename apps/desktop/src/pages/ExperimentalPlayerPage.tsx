import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen, FlaskConical } from "lucide-react";
import { PageHeader, Button, EmptyState } from "@aethervault/ui-kit";
import { ExperimentalVideoPlayer } from "../player/experimental/ExperimentalVideoPlayer";

/**
 * Page de validation ciblée — Phase 1 du plan de migration `<video>` + MSE
 * (voir le rapport d'évaluation associé). Entièrement indépendante du
 * lecteur principal (`PlayerContext`/`PlayerSurface`/`playback_engine`) :
 * aucun fichier de ce dernier n'a été modifié pour construire cette page.
 *
 * But unique : choisir manuellement un fichier vidéo et vérifier si sa
 * lecture via l'élément `<video>` natif du navigateur (plutôt que via
 * mpv + copie de pixels) résout la désynchronisation observée sur le
 * lecteur actuel — pour un fichier déjà dans un conteneur/codec que le
 * navigateur sait lire nativement (MP4/H.264, WebM...). Un fichier MKV
 * avec des codecs non pris en charge affichera une erreur explicite
 * (`MEDIA_ERR_SRC_NOT_SUPPORTED`, voir `ExperimentalVideoPlayer.tsx`) —
 * c'est attendu, pas un bug : c'est exactement ce que la Phase 2
 * (remuxage à la volée, pas encore implémentée) devra résoudre.
 *
 * Accessible depuis `/experimental-player` — volontairement pas mis en
 * avant dans la navigation principale (voir `SettingsPage.tsx` pour son
 * seul point d'entrée), le temps que la validation soit faite.
 */
export function ExperimentalPlayerPage() {
  const [filePath, setFilePath] = useState<string | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);

  const pickFile = async () => {
    setPickError(null);
    try {
      const selected = await open({
        multiple: false,
        filters: [
          { name: "Vidéo", extensions: ["mp4", "m4v", "mkv", "webm", "mov", "avi"] },
        ],
      });
      if (typeof selected === "string") {
        setFilePath(selected);
      }
    } catch (err) {
      setPickError(String(err));
    }
  };

  return (
    <div>
      <PageHeader
        title="Lecteur expérimental (validation <video>)"
        description="Test isolé, indépendant du lecteur principal : choisissez un fichier vidéo pour vérifier si la lecture native du navigateur élimine la désynchronisation audio/vidéo constatée sur le lecteur actuel."
        actions={
          <Button onClick={() => void pickFile()}>
            <FolderOpen size={16} />
            Choisir un fichier vidéo
          </Button>
        }
      />

      {pickError && (
        <div className="avm-experimental-player__pick-error" role="alert">
          Impossible d'ouvrir le sélecteur de fichier : {pickError}
        </div>
      )}

      {!filePath && !pickError && (
        <EmptyState
          icon={<FlaskConical size={32} />}
          title="Aucun fichier choisi"
          description="Un fichier déjà en MP4/H.264 ou WebM devrait se lire sans réglage particulier — un MKV avec des codecs non standards affichera une erreur explicite, ce qui est le résultat attendu à ce stade (voir la Phase 2 du plan de migration, pas encore implémentée)."
        />
      )}

      {filePath && (
        <>
          <p className="avm-experimental-player__path">{filePath}</p>
          <ExperimentalVideoPlayer filePath={filePath} />
        </>
      )}
    </div>
  );
}
