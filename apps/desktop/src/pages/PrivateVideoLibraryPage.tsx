import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { FolderPlus, RefreshCw, Trash2 } from "lucide-react";
import { Button, EmptyState, Modal, PageHeader } from "@aethervault/ui-kit";
import type { PlayableMedia, PrivateVideoFile, PrivateVideoFolder } from "@aethervault/shared-types";
import { libraryApi } from "../features/library/api";
import { privacyApi } from "../features/privacy/api";
import { privateVideoApi } from "../features/privateVideo/api";
import { usePlayer } from "../player/PlayerContext";
import "./pages.css";

function toPlayableMedia(file: PrivateVideoFile): PlayableMedia {
  return {
    id: file.id,
    title: file.file_name,
    path: file.path,
    libraryId: file.private_library_id,
    isPrivate: true,
  };
}

function describeSummary(summary: {
  added: number;
  updated: number;
  removed: number;
  failed: number;
}): string {
  const base = `${summary.added} ajouté(s), ${summary.updated} mis à jour, ${summary.removed} retiré(s).`;
  return summary.failed > 0 ? `${base} ${summary.failed} fichier(s) ignoré(s) (erreur de lecture).` : base;
}

/**
 * Détail d'une bibliothèque privée de type Vidéos (Étape 6b-i, doc §6.4
 * ter) — même principe que `LibraryDetailPage` (bibliothèques publiques),
 * mais scan **manuel uniquement** (pas d'écoute d'événements de
 * progression : la commande de scan est synchrone et renvoie directement
 * son résumé, voir `privateVideoApi.scan`) et aucune surveillance
 * continue des dossiers.
 */
export function PrivateVideoLibraryPage() {
  const { id } = useParams<{ id: string }>();
  const privateLibraryId = Number(id);
  const navigate = useNavigate();
  const { playQueue } = usePlayer();

  const [libraryName, setLibraryName] = useState<string | null>(null);
  const [folders, setFolders] = useState<PrivateVideoFolder[]>([]);
  const [files, setFiles] = useState<PrivateVideoFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSummary, setLastSummary] = useState<string | null>(null);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [libraries, folderList, fileList] = await Promise.all([
        privacyApi.listLibraries(),
        privateVideoApi.listFolders(privateLibraryId),
        privateVideoApi.listFiles(privateLibraryId),
      ]);

      const library = libraries.find((candidate) => candidate.id === privateLibraryId) ?? null;
      if (!library) {
        setError("Bibliothèque privée introuvable.");
        setLibraryName(null);
        return;
      }

      setLibraryName(library.name);
      setFolders(folderList);
      setFiles(fileList);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Chargement impossible.");
    }
  }, [privateLibraryId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleAddFolder = async () => {
    const path = await libraryApi.pickFolder();
    if (!path) return;

    setBusy(true);
    setError(null);
    try {
      const summary = await privateVideoApi.addFolder(privateLibraryId, path);
      setLastSummary(describeSummary(summary));
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible d'ajouter ce dossier.");
    } finally {
      setBusy(false);
    }
  };

  const handleRemoveFolder = async (folderId: number) => {
    setBusy(true);
    setError(null);
    try {
      await privateVideoApi.removeFolder(folderId);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Suppression du dossier impossible.");
    } finally {
      setBusy(false);
    }
  };

  const handleScan = async () => {
    setBusy(true);
    setError(null);
    try {
      const summary = await privateVideoApi.scan(privateLibraryId);
      setLastSummary(describeSummary(summary));
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Scan impossible.");
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await privacyApi.removeLibrary(privateLibraryId);
      navigate("/private");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Suppression impossible.");
      setDeleting(false);
      setDeleteModalOpen(false);
    }
  };

  if (libraryName === null && !error) {
    return <p>Chargement…</p>;
  }

  return (
    <div>
      <PageHeader
        title={libraryName ?? "Bibliothèque introuvable"}
        description={`${files.length} fichier(s) détecté(s) dans ${folders.length} dossier(s).`}
        actions={
          libraryName ? (
            <div className="avm-private-actions">
              <Button variant="secondary" onClick={handleAddFolder} disabled={busy}>
                <FolderPlus size={14} /> Ajouter un dossier
              </Button>
              <Button variant="primary" onClick={handleScan} disabled={busy || folders.length === 0}>
                <RefreshCw size={14} /> {busy ? "Analyse en cours…" : "Scanner"}
              </Button>
              <Button variant="danger" onClick={() => setDeleteModalOpen(true)}>
                <Trash2 size={14} /> Supprimer
              </Button>
            </div>
          ) : undefined
        }
      />

      <Modal
        open={deleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
        title={`Supprimer « ${libraryName} » ?`}
      >
        <p>
          Cette bibliothèque privée sera retirée du coffre. <strong>Les fichiers présents sur le
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
      {lastSummary && !error && <p className="avm-settings-muted">{lastSummary}</p>}

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
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  {!folder.is_available && (
                    <span className="avm-badge avm-badge--warning">Indisponible</span>
                  )}
                  <Button variant="ghost" onClick={() => handleRemoveFolder(folder.id)} disabled={busy}>
                    Retirer
                  </Button>
                </div>
              </li>
            ))}
          </ul>

          {files.length === 0 ? (
            <EmptyState
              title="Aucun fichier détecté pour l'instant"
              description="Lancez un scan si vous venez d'ajouter des fichiers dans ce dossier."
            />
          ) : (
            <ul className="avm-media-list">
              {files.map((file) => (
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
                    const playableFiles = files.filter((candidate) => candidate.is_available);
                    const startIndex = playableFiles.findIndex((candidate) => candidate.id === file.id);
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
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
