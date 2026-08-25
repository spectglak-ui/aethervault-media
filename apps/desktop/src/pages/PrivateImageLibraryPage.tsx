import { useCallback, useEffect, useState, type MouseEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { FolderPlus, RefreshCw, Trash2 } from "lucide-react";
import { Button, EmptyState, IconButton, PageHeader } from "@aethervault/ui-kit";
import type { PrivateImageFolder } from "@aethervault/shared-types";
import { libraryApi } from "../features/library/api";
import { privacyApi } from "../features/privacy/api";
import { privateImageApi } from "../features/privateImage/api";
import { PrivateThumbnailImage } from "../features/privateImage/PrivateThumbnailImage";
import "./pages.css";

function describeSummary(summary: {
  added: number;
  updated: number;
  removed: number;
  failed: number;
}): string {
  const base = `${summary.added} ajouté(s), ${summary.updated} mis à jour, ${summary.removed} retiré(s).`;
  return summary.failed > 0 ? `${base} ${summary.failed} fichier(s) ignoré(s) (erreur de lecture).` : base;
}

function folderDisplayName(path: string): string {
  const normalized = path.replace(/[\\/]+$/, "");
  const parts = normalized.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

/**
 * Liste des albums (dossiers) d'une bibliothèque privée de type Images
 * (Étape 6b-ii, doc §6.4 quater) — un album, c'est un dossier, même
 * principe que `PrivateVideoLibraryPage` pour les vidéos (Étape 6b-i).
 */
export function PrivateImageLibraryPage() {
  const { id } = useParams<{ id: string }>();
  const privateLibraryId = Number(id);
  const navigate = useNavigate();

  const [libraryName, setLibraryName] = useState<string | null>(null);
  const [folders, setFolders] = useState<PrivateImageFolder[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSummary, setLastSummary] = useState<string | null>(null);
  // Incrémenté après chaque scan/ajout réussi et utilisé comme `key` de la
  // grille : force le remontage des vignettes de couverture (donc leur
  // rechargement) quand un scan a pu changer la photo par défaut d'un
  // album — `PrivateThumbnailImage` ne se réabonne volontairement pas à
  // chaque rendu (voir sa propre note de tête), ce compteur est le
  // mécanisme explicite pour les cas où un rechargement est réellement
  // nécessaire.
  const [scanGeneration, setScanGeneration] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const [libraries, folderList] = await Promise.all([
        privacyApi.listLibraries(),
        privateImageApi.listFolders(privateLibraryId),
      ]);

      const library = libraries.find((candidate) => candidate.id === privateLibraryId) ?? null;
      if (!library) {
        setError("Bibliothèque privée introuvable.");
        setLibraryName(null);
        return;
      }

      setLibraryName(library.name);
      setFolders(folderList);
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
      const summary = await privateImageApi.addFolder(privateLibraryId, path);
      setLastSummary(describeSummary(summary));
      setScanGeneration((generation) => generation + 1);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible d'ajouter ce dossier.");
    } finally {
      setBusy(false);
    }
  };

  const handleRemoveFolder = async (event: MouseEvent, folderId: number) => {
    event.stopPropagation();
    setBusy(true);
    setError(null);
    try {
      await privateImageApi.removeFolder(folderId);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Suppression de l'album impossible.");
    } finally {
      setBusy(false);
    }
  };

  const handleScan = async () => {
    setBusy(true);
    setError(null);
    try {
      const summary = await privateImageApi.scan(privateLibraryId);
      setLastSummary(describeSummary(summary));
      setScanGeneration((generation) => generation + 1);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Scan impossible.");
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteLibrary = async () => {
    if (!libraryName) return;
    if (!window.confirm(`Supprimer la bibliothèque privée « ${libraryName} » ? Les fichiers présents sur le disque ne seront jamais supprimés.`)) {
      return;
    }
    try {
      await privacyApi.removeLibrary(privateLibraryId);
      navigate("/private");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Suppression impossible.");
    }
  };

  if (libraryName === null && !error) {
    return <p>Chargement…</p>;
  }

  return (
    <div>
      <PageHeader
        title={libraryName ?? "Bibliothèque introuvable"}
        description={`${folders.length} album(s).`}
        actions={
          libraryName ? (
            <div className="avm-private-actions">
              <Button variant="secondary" onClick={handleAddFolder} disabled={busy}>
                <FolderPlus size={14} /> Ajouter un dossier
              </Button>
              <Button variant="primary" onClick={handleScan} disabled={busy || folders.length === 0}>
                <RefreshCw size={14} /> {busy ? "Analyse en cours…" : "Scanner"}
              </Button>
              <Button variant="danger" onClick={handleDeleteLibrary}>
                <Trash2 size={14} /> Supprimer
              </Button>
            </div>
          ) : undefined
        }
      />

      {error && <p className="avm-settings-error">{error}</p>}
      {lastSummary && !error && <p className="avm-settings-muted">{lastSummary}</p>}

      {folders.length === 0 ? (
        <EmptyState
          icon={<FolderPlus size={32} />}
          title="Aucun album"
          description="Ajoutez un dossier de votre disque pour qu'AetherVault Media y recherche des photos."
        />
      ) : (
        <div className="avm-album-grid" key={scanGeneration}>
          {folders.map((folder) => (
            <div key={folder.id} className="avm-album-card">
              <button
                type="button"
                className="avm-album-card__open"
                onClick={() => navigate(`/private/images/${privateLibraryId}/albums/${folder.id}`)}
              >
                <PrivateThumbnailImage
                  fetchThumbnail={() => privateImageApi.getAlbumCover(folder.id)}
                  alt={folderDisplayName(folder.path)}
                  className="avm-album-card__cover"
                />
              </button>
              <div className="avm-album-card__footer">
                <span className="avm-album-card__name">{folderDisplayName(folder.path)}</span>
                <IconButton label="Retirer cet album" onClick={(event) => handleRemoveFolder(event, folder.id)}>
                  <Trash2 size={14} />
                </IconButton>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
