import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { listen } from "@tauri-apps/api/event";
import { FolderPlus, RefreshCw, Trash2 } from "lucide-react";
import { Button, EmptyState, Modal, PageHeader } from "@aethervault/ui-kit";
import type {
  Library,
  LibraryFolder,
  MediaFile,
  PlayableMedia,
  ScanCompleteEvent,
} from "@aethervault/shared-types";
import { libraryApi } from "../features/library/api";
import { usePlayer } from "../player/PlayerContext";
import "./pages.css";

function toPlayableMedia(file: MediaFile): PlayableMedia {
  return {
    id: file.id,
    title: file.file_name,
    path: file.path,
    libraryId: file.library_id,
  };
}

export function LibraryDetailPage() {
  const { id } = useParams<{ id: string }>();
  const libraryId = Number(id);
  const navigate = useNavigate();
  const { playQueue } = usePlayer();

  const [library, setLibrary] = useState<Library | null>(null);
  const [folders, setFolders] = useState<LibraryFolder[]>([]);
  const [mediaFiles, setMediaFiles] = useState<MediaFile[]>([]);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [libraries, folderList, files] = await Promise.all([
        libraryApi.list(),
        libraryApi.listFolders(libraryId),
        libraryApi.listMediaFiles(libraryId),
      ]);
      setLibrary(libraries.find((candidate) => candidate.id === libraryId) ?? null);
      setFolders(folderList);
      setMediaFiles(files);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Chargement impossible.");
    }
  }, [libraryId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Écoute les événements émis par le File Scanner et le Filesystem
  // Watcher (Rust) : "library:updated" signale une mise à jour incrémentale
  // (un seul fichier ajouté/modifié/supprimé, pas un nouveau scan complet),
  // tandis que "library:scan-complete"/"scan-error" concernent un scan
  // manuel déclenché depuis cette page.
  useEffect(() => {
    const unlistenUpdated = listen<number>("library:updated", (event) => {
      if (event.payload === libraryId) {
        refresh();
      }
    });

    const unlistenComplete = listen<ScanCompleteEvent>("library:scan-complete", (event) => {
      if (event.payload.library_id === libraryId) {
        setScanning(false);
        refresh();
      }
    });
    const unlistenError = listen<string>("library:scan-error", () => {
      setScanning(false);
    });

    return () => {
      unlistenUpdated.then((stop) => stop());
      unlistenComplete.then((stop) => stop());
      unlistenError.then((stop) => stop());
    };
  }, [libraryId, refresh]);

  const handleAddFolder = async () => {
    const path = await libraryApi.pickFolder();
    if (!path) return;

    setScanning(true);
    try {
      await libraryApi.addFolder(libraryId, path);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible d'ajouter ce dossier.");
      setScanning(false);
    }
  };

  const handleScan = async () => {
    setScanning(true);
    try {
      await libraryApi.scan(libraryId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Scan impossible.");
      setScanning(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await libraryApi.remove(libraryId);
      navigate("/libraries");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Suppression impossible.");
      setDeleting(false);
      setDeleteModalOpen(false);
    }
  };

  if (!library) {
    return <p>Chargement…</p>;
  }

  return (
    <div>
      <PageHeader
        title={library.name}
        description={`${mediaFiles.length} fichier(s) détecté(s) dans ${folders.length} dossier(s).`}
        actions={
          <div style={{ display: "flex", gap: 8 }}>
            <Button variant="secondary" onClick={handleAddFolder} disabled={scanning}>
              <FolderPlus size={14} style={{ marginRight: 6, verticalAlign: "text-bottom" }} />
              Ajouter un dossier
            </Button>
            <Button
              variant="primary"
              onClick={handleScan}
              disabled={scanning || folders.length === 0}
            >
              <RefreshCw size={14} style={{ marginRight: 6, verticalAlign: "text-bottom" }} />
              {scanning ? "Analyse en cours…" : "Scanner"}
            </Button>
            <Button variant="danger" onClick={() => setDeleteModalOpen(true)}>
              <Trash2 size={14} style={{ marginRight: 6, verticalAlign: "text-bottom" }} />
              Supprimer
            </Button>
          </div>
        }
      />

      <Modal
        open={deleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
        title={`Supprimer « ${library.name} » ?`}
      >
        <p>
          Cette bibliothèque sera retirée d'AetherVault Media, ainsi que les Titres/Épisodes qui
          n'apparaissent dans aucune autre bibliothèque. <strong>Les fichiers présents sur le
          disque ne seront jamais supprimés.</strong>
        </p>
        <p>Cette action est irréversible.</p>
        <div className="avm-form-actions">
          <Button variant="ghost" onClick={() => setDeleteModalOpen(false)} disabled={deleting}>
            Annuler
          </Button>
          <Button variant="danger" onClick={handleDelete} disabled={deleting}>
            {deleting ? "Suppression…" : "Supprimer définitivement"}
          </Button>
        </div>
      </Modal>

      {error && <p className="avm-settings-error">{error}</p>}

      {folders.length === 0 ? (
        <EmptyState
          icon={<FolderPlus size={32} />}
          title="Aucun dossier associé"
          description="Ajoutez un dossier de votre disque pour qu'AetherVault Media y recherche des vidéos."
        />
      ) : (
        <>
          <ul className="avm-folder-list">
            {folders.map((folder) => (
              <li key={folder.id} className="avm-folder-list__item">
                <span className="avm-mono">{folder.path}</span>
                {!folder.is_available && (
                  <span className="avm-badge avm-badge--warning">Indisponible</span>
                )}
              </li>
            ))}
          </ul>

          {mediaFiles.length === 0 ? (
            <EmptyState
              title="Aucun fichier détecté pour l'instant"
              description="Lancez un scan si vous venez d'ajouter des fichiers dans ce dossier."
            />
          ) : (
            <ul className="avm-media-list">
              {mediaFiles.map((file) => {
                return (
                  <li
                    key={file.id}
                    className={[
                      "avm-media-list__item",
                      file.is_available ? "avm-media-list__item--playable" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    onClick={() => {
                      if (!file.is_available) return;
                      // La file de lecture (Étape 3e) reflète exactement ce
                      // qui est affiché : tous les fichiers disponibles de
                      // cette bibliothèque, dans le même ordre — c'est ce
                      // qui permet à Précédent/Suivant de parcourir la
                      // liste telle que l'utilisateur la voit. Les fichiers
                      // indisponibles sont exclus, comme ils l'étaient déjà
                      // du clic lui-même.
                      const playableFiles = mediaFiles.filter((candidate) => candidate.is_available);
                      const startIndex = playableFiles.findIndex(
                        (candidate) => candidate.id === file.id
                      );
                      if (startIndex === -1) return;
                      playQueue(playableFiles.map(toPlayableMedia), startIndex);
                    }}
                  >
                    <span>{file.file_name}</span>
                    <div className="avm-media-list__badges">
                      {!file.is_available && (
                        <span className="avm-badge avm-badge--warning">Indisponible</span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
