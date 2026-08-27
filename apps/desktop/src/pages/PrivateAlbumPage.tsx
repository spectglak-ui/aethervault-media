import { useCallback, useEffect, useState, type MouseEvent } from "react";
import { useParams } from "react-router-dom";
import { Image as ImagePlaceholder, RotateCcw, Star } from "lucide-react";
import { EmptyState, IconButton, PageHeader } from "@aethervault/ui-kit";
import type { PrivateImageFile, PrivateImageFolder } from "@aethervault/shared-types";
import { privateImageApi } from "../features/privateImage/api";
import { PrivateThumbnailImage } from "../features/privateImage/PrivateThumbnailImage";
import { ImageViewer } from "../features/privateImage/ImageViewer";
import { useImageViewer } from "../features/privateImage/useImageViewer";
import "./pages.css";

function folderDisplayName(path: string): string {
  const normalized = path.replace(/[\\/]+$/, "");
  const parts = normalized.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

/**
 * Grille des photos d'un album (Étape 6b-ii, doc §6.4 quater). La
 * visionneuse (`ImageViewer`) est montée ici, pilotée par `useImageViewer`
 * — cette page n'a besoin de connaître que `open()`.
 */
export function PrivateAlbumPage() {
  const { libraryId, folderId } = useParams<{ libraryId: string; folderId: string }>();
  const privateLibraryId = Number(libraryId);
  const privateFolderId = Number(folderId);
  const viewer = useImageViewer();

  const [folder, setFolder] = useState<PrivateImageFolder | null>(null);
  const [files, setFiles] = useState<PrivateImageFile[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [folders, fileList] = await Promise.all([
        privateImageApi.listFolders(privateLibraryId),
        privateImageApi.listFiles(privateFolderId),
      ]);

      const found = folders.find((candidate) => candidate.id === privateFolderId) ?? null;
      if (!found) {
        setError("Album introuvable.");
        setFolder(null);
        return;
      }

      setFolder(found);
      setFiles(fileList);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Chargement impossible.");
    }
  }, [privateLibraryId, privateFolderId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleSetCover = async (event: MouseEvent, fileId: number) => {
    event.stopPropagation();
    try {
      await privateImageApi.setAlbumCover(privateFolderId, fileId);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible de changer la couverture.");
    }
  };

  const handleResetCover = async () => {
    try {
      await privateImageApi.setAlbumCover(privateFolderId, null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible de réinitialiser la couverture.");
    }
  };

  if (folder === null && !error) {
    return <p>Chargement…</p>;
  }

  const availableFiles = files.filter((file) => file.is_available);

  return (
    <div>
      <PageHeader
        title={folder ? folderDisplayName(folder.path) : "Album introuvable"}
        description={folder ? `${files.length} photo(s) — ${folder.path}` : undefined}
        actions={
          folder?.cover_file_id ? (
            <IconButton label="Réinitialiser la couverture de l'album" onClick={handleResetCover}>
              <RotateCcw size={16} />
            </IconButton>
          ) : undefined
        }
      />

      {error && <p className="avm-settings-error">{error}</p>}

      {files.length === 0 ? (
        <EmptyState
          icon={<ImagePlaceholder size={32} />}
          title="Aucune photo détectée pour l'instant"
          description="Lancez un scan depuis la liste des albums si vous venez d'ajouter des fichiers dans ce dossier."
        />
      ) : (
        <div className="avm-photo-grid">
          {files.map((file) => {
            const isCover = folder?.cover_file_id === file.id;
            return (
              <div key={file.id} className="avm-photo-card">
                <button
                  type="button"
                  className="avm-photo-card__open"
                  disabled={!file.is_available}
                  onClick={() => {
                    if (!file.is_available) return;
                    const startIndex = availableFiles.findIndex((candidate) => candidate.id === file.id);
                    if (startIndex === -1) return;
                    viewer.open(availableFiles, startIndex);
                  }}
                >
                  <PrivateThumbnailImage
                    fetchThumbnail={() => privateImageApi.getThumbnail(file.id)}
                    alt={file.file_name}
                    className="avm-photo-card__thumb"
                  />
                </button>
                {!file.is_available && <span className="avm-badge avm-badge--warning">Indisponible</span>}
                <IconButton
                  label={isCover ? "Couverture actuelle de l'album" : "Définir comme couverture de l'album"}
                  onClick={(event: React.MouseEvent) => handleSetCover(event, file.id)}
                  className={`avm-photo-card__cover-toggle${isCover ? " avm-photo-card__cover-toggle--active" : ""}`}
                >
                  <Star size={14} />
                </IconButton>
              </div>
            );
          })}
        </div>
      )}

      <ImageViewer controls={viewer} />
    </div>
  );
}
