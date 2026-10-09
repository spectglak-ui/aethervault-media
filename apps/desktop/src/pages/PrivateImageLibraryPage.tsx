import { useCallback, useEffect, useState, type MouseEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, FolderPlus, Images, Pencil, RefreshCw, Trash2 } from "lucide-react"; // ← Pencil ajouté
import { Button, EmptyState, IconButton } from "@aethervault/ui-kit";
import type { PrivateImageFolder } from "@aethervault/shared-types";
import { libraryApi } from "../features/library/api";
import { privacyApi } from "../features/privacy/api";
import { privateImageApi } from "../features/privateImage/api";
import { PrivateThumbnailImage } from "../features/privateImage/PrivateThumbnailImage";
import "./privateGallery.css";
import "./private-modern.css";

function describeSummary(summary: {
  added: number;
  updated: number;
  removed: number;
  failed: number;
}): string {
  const base = `${summary.added} ajouté(s), ${summary.updated} mis à jour, ${summary.removed} retiré(s).`;
  return summary.failed > 0
    ? `${base} ${summary.failed} fichier(s) ignoré(s) (erreur de lecture).`
    : base;
}

function folderDisplayName(path: string): string {
  const normalized = path.replace(/[\/]+$/, "");
  const parts = normalized.split(/[\/]/);
  return parts[parts.length - 1] || path;
}

interface AlbumCard {
  folder: PrivateImageFolder;
  count: number;
}

export function PrivateImageLibraryPage() {
  const { id } = useParams<{ id: string }>();
  const privateLibraryId = Number(id);
  const navigate = useNavigate();
  const [libraryName, setLibraryName] = useState<string | null>(null);
  const [albums, setAlbums] = useState<AlbumCard[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSummary, setLastSummary] = useState<string | null>(null);
  const [scanGeneration, setScanGeneration] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const [libraries, folderList] = await Promise.all([
        privacyApi.listLibraries(),
        privateImageApi.listFolders(privateLibraryId),
      ]);
      const library = libraries.find((c) => c.id === privateLibraryId) ?? null;
      if (!library) {
        setError("Bibliothèque privée introuvable.");
        setLibraryName(null);
        return;
      }
      setLibraryName(library.name);
      const withCounts = await Promise.all(
        folderList.map(async (folder): Promise<AlbumCard> => {
          const files = await privateImageApi.listFiles(folder.id);
          return { folder, count: files.length };
        })
      );
      setAlbums(withCounts);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Chargement impossible.");
    }
  }, [privateLibraryId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleAddFolder = async () => {
    const path = await libraryApi.pickFolder();
    if (!path) return;
    setBusy(true);
    setError(null);
    try {
      const summary = await privateImageApi.addFolder(privateLibraryId, path);
      setLastSummary(describeSummary(summary));
      setScanGeneration((g) => g + 1);
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

  // ← AJOUT : renommer un album (dossier sur disque + base)
  const handleRenameFolder = async (event: MouseEvent, folder: PrivateImageFolder) => {
    event.stopPropagation();
    const next = window.prompt("Nouveau nom de l'album", folderDisplayName(folder.path));
    if (!next || next.trim() === folderDisplayName(folder.path)) return;
    setBusy(true);
    setError(null);
    try {
      await privateImageApi.renameFolder(folder.id, next.trim());
      setScanGeneration((g) => g + 1);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Renommage impossible.");
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
      setScanGeneration((g) => g + 1);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Scan impossible.");
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteLibrary = async () => {
    if (!libraryName) return;
    if (
      !window.confirm(
        `Supprimer la bibliothèque privée « ${libraryName} » ? Les fichiers présents sur le disque ne seront jamais supprimés.`
      )
    ) {
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
    <div className="pvg-sub">
      <nav className="pvg-crumb">
        <Link to="/private">
          <ArrowLeft size={15} /> Privé
        </Link>
        <span> / </span>
        <span>{libraryName ?? "Images"}</span>
      </nav>
      <div className="pvg-sub__head">
        <div>
          <h1 className="pvg-header__title">{libraryName ?? "Bibliothèque introuvable"}</h1>
          <div className="pvg-header__sub">{albums.length} album(s) • catalogue chiffré</div>
        </div>
        <div className="pvg-sub__actions">
          <button type="button" className="pvg-btn-soft" onClick={handleAddFolder} disabled={busy}>
            <FolderPlus size={15} /> Ajouter un album
          </button>
          <button
            type="button"
            className="pvg-btn-soft"
            onClick={handleScan}
            disabled={busy || albums.length === 0}
          >
            <RefreshCw size={15} /> {busy ? "Analyse…" : "Scanner"}
          </button>
          <button
            type="button"
            className="pvg-btn-soft"
            onClick={handleDeleteLibrary}
            style={{ color: "#fb7185" }}
          >
            <Trash2 size={15} /> Supprimer
          </button>
        </div>
      </div>
      {error && <p className="avm-settings-error">{error}</p>}
      {lastSummary && !error && <p className="avm-settings-muted">{lastSummary}</p>}
      {albums.length === 0 ? (
        <EmptyState
          icon={<Images size={32} />}
          title="Aucun album"
          description="Ajoutez un dossier de votre disque pour qu'AetherVault Media y recherche des photos."
        />
      ) : (
        <div className="pvg-grid" key={scanGeneration}>
          {albums.map(({ folder, count }) => (
            <div className="pvg-card" key={folder.id}>
              <button
                type="button"
                className="pvg-card__open"
                title={folderDisplayName(folder.path)}
                onClick={() =>
                  navigate(`/private/images/${privateLibraryId}/albums/${folder.id}`)
                }
              >
                <div className="pvg-card__media">
                  <PrivateThumbnailImage
                    fetchThumbnail={() => privateImageApi.getAlbumCover(folder.id)}
                    alt={folderDisplayName(folder.path)}
                  />
                  <div className="pvg-card__shade" />
                  <span className="pvg-card__count">{count}</span>
                </div>
                <div className="pvg-card__meta">
                  <span className="pvg-card__title">{folderDisplayName(folder.path)}</span>
                  <span className="pvg-card__sub">Album • {count} photo(s)</span>
                </div>
              </button>
              <div className="pvg-card__footer">
                <span className="pvg-card__sub">{folder.path}</span>
                {/* ← AJOUT : boutons Renommer + Retirer */}
                <IconButton
                  label="Renommer cet album"
                  onClick={(event) => handleRenameFolder(event, folder)}
                >
                  <Pencil size={14} />
                </IconButton>
                <IconButton
                  label="Retirer cet album"
                  onClick={(event) => handleRemoveFolder(event, folder.id)}
                >
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