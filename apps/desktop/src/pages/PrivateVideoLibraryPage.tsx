import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ChevronRight, Folder, FolderOpen, FolderPlus, RefreshCw, Trash2 } from "lucide-react";
import { Button, EmptyState, Modal, PageHeader } from "@aethervault/ui-kit";
import type { PlayableMedia, PrivateVideoFile, PrivateVideoFolder } from "@aethervault/shared-types";
import { libraryApi } from "../features/library/api";
import { privacyApi } from "../features/privacy/api";
import { privateVideoApi } from "../features/privateVideo/api";
import { usePlayer } from "../player/PlayerContext";
import { PrivateScanProgressBar } from "../components/PrivateScanProgressBar";
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

function folderName(path: string): string {
  const segments = path.replace(/[/\\]+$/, "").split(/[/\\]/);
  return segments[segments.length - 1] || path;
}

function PrivateVideoThumb({ fileId }: { fileId: number }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    privateVideoApi
      .thumbnail(fileId)
      .then((b64) => {
        if (!cancelled) setSrc(`data:image/jpeg;base64,${b64}`);
      })
      .catch(() => {
        /* pas encore de vignette : placeholder */
      });
    return () => {
      cancelled = true;
    };
  }, [fileId]);
  return <img className="avm-private-thumb" src={src ?? undefined} alt="" />;
}

/**
 * Détail d'une bibliothèque privée Vidéos. Étape 8 : navigation
 * arborescente — l'arbre est reconstruit côté frontend à partir des
 * chemins des enregistrements de dossiers (parent = ancêtre le plus
 * proche), exactement l'organisation du disque au moment du scan.
 * Fil d'Ariane + dossiers cliquables + fichiers du répertoire courant.
 */
export function PrivateVideoLibraryPage() {
  const { id } = useParams<{ id: string }>();
  const privateLibraryId = Number(id);
  const navigate = useNavigate();
  const { playQueue } = usePlayer();
  const [libraryName, setLibraryName] = useState<string | null>(null);
  const [folders, setFolders] = useState<PrivateVideoFolder[]>([]);
  const [files, setFiles] = useState<PrivateVideoFile[]>([]);
  const [currentFolderId, setCurrentFolderId] = useState<number | null>(null);
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

  /** Arbre reconstruit depuis les chemins (Étape 8) : parent d'un
   * dossier = l'ancêtre le plus proche parmi les enregistrements. */
  const { childrenOf, parentOf } = useMemo(() => {
    const sorted = [...folders].sort((a, b) => a.path.length - b.path.length);
    const parentMap = new Map<number, number | null>();
    for (const folder of sorted) {
      const fp = folder.path.replace(/[/\\]+$/, "").toLowerCase();
      let parent: number | null = null;
      for (const candidate of sorted) {
        if (candidate.id === folder.id) continue;
        const cp = candidate.path.replace(/[/\\]+$/, "").toLowerCase();
        if (fp.startsWith(cp + "\\") || fp.startsWith(cp + "/")) {
          parent = candidate.id;
        }
      }
      parentMap.set(folder.id, parent);
    }
    const children = new Map<number | null, PrivateVideoFolder[]>();
    for (const folder of sorted) {
      const key = parentMap.get(folder.id) ?? null;
      const list = children.get(key) ?? [];
      list.push(folder);
      children.set(key, list);
    }
    return { childrenOf: children, parentOf: parentMap };
  }, [folders]);

  const rootIds = useMemo(
    () => new Set(folders.filter((f) => (parentOf.get(f.id) ?? null) === null).map((f) => f.id)),
    [folders, parentOf]
  );

  const childFolders = childrenOf.get(currentFolderId) ?? [];
  const visibleFiles = files.filter((file) =>
    currentFolderId === null ? rootIds.has(file.folder_id) : file.folder_id === currentFolderId
  );

  const breadcrumbs = useMemo(() => {
    const chain: PrivateVideoFolder[] = [];
    let node: number | null = currentFolderId;
    while (node !== null) {
      const folder = folders.find((f) => f.id === node);
      if (!folder) break;
      chain.unshift(folder);
      node = parentOf.get(folder.id) ?? null;
    }
    return chain;
  }, [currentFolderId, folders, parentOf]);

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
      if (currentFolderId === folderId) setCurrentFolderId(null);
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

  const playVisible = (file: PrivateVideoFile) => {
    if (!file.is_available) return;
    const playable = visibleFiles.filter((candidate) => candidate.is_available);
    const startIndex = playable.findIndex((candidate) => candidate.id === file.id);
    if (startIndex === -1) return;
    playQueue(playable.map(toPlayableMedia), startIndex);
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
      <PrivateScanProgressBar privateLibraryId={privateLibraryId} />
      <Modal
        open={deleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
        title={`Supprimer « ${libraryName} » ?`}
      >
        <p>
          Cette bibliothèque privée sera retirée du coffre.{" "}
          <strong>Les fichiers présents sur le disque ne seront jamais supprimés.</strong>
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
          description="Ajoutez un dossier de votre disque : le scan reproduira son arborescence."
        />
      ) : (
        <>
          <div className="avm-private-breadcrumb">
            <button
              className="avm-private-breadcrumb__crumb"
              onClick={() => setCurrentFolderId(null)}
            >
              <FolderOpen size={14} /> {libraryName ?? "Racine"}
            </button>
            {breadcrumbs.map((crumb) => (
              <span key={crumb.id} className="avm-private-breadcrumb__segment">
                <ChevronRight size={14} />
                <button
                  className="avm-private-breadcrumb__crumb"
                  onClick={() => setCurrentFolderId(crumb.id)}
                >
                  {folderName(crumb.path)}
                </button>
              </span>
            ))}
          </div>
          {childFolders.length > 0 && (
            <ul className="avm-media-list" style={{ marginBottom: 16 }}>
              {childFolders.map((folder) => (
                <li
                  key={folder.id}
                  className="avm-media-list__item avm-media-list__item--playable"
                  onClick={() => setCurrentFolderId(folder.id)}
                >
                  <div style={{ display: "flex", gap: 10, alignItems: "center", minWidth: 0 }}>
                    <Folder size={18} />
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                      {folderName(folder.path)}
                    </span>
                  </div>
                  <div
                    style={{ display: "flex", gap: 8, alignItems: "center" }}
                    onClick={(event) => event.stopPropagation()}
                  >
                    <span className="avm-card__subtitle">
                      {files.filter((f) => f.folder_id === folder.id).length} fichier(s)
                    </span>
                    {currentFolderId === null && (
                      <Button
                        variant="ghost"
                        onClick={() => void handleRemoveFolder(folder.id)}
                        disabled={busy}
                      >
                        Retirer
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {visibleFiles.length === 0 && childFolders.length === 0 ? (
            <EmptyState
              title="Aucun contenu ici pour l'instant"
              description="Lancez un scan si vous venez d'ajouter des fichiers dans ce dossier."
            />
          ) : visibleFiles.length === 0 ? (
            <p className="avm-settings-muted">Aucun fichier directement dans ce dossier.</p>
          ) : (
            <ul className="avm-media-list">
              {visibleFiles.map((file) => (
                <li
                  key={file.id}
                  className={[
                    "avm-media-list__item",
                    file.is_available ? "avm-media-list__item--playable" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onClick={() => playVisible(file)}
                >
                  <div style={{ display: "flex", gap: 10, alignItems: "center", minWidth: 0 }}>
                    <PrivateVideoThumb fileId={file.id} />
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                      {file.file_name}
                    </span>
                  </div>
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