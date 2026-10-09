import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, Film, FolderPlus, RefreshCw, Trash2 } from "lucide-react";
import { Button, EmptyState, IconButton, Modal } from "@aethervault/ui-kit";
import type { PlayableMedia, PrivateVideoFile, PrivateVideoFolder } from "@aethervault/shared-types";
import { libraryApi } from "../features/library/api";
import { privacyApi } from "../features/privacy/api";
import { privateVideoApi } from "../features/privateVideo/api";
import { usePlayer } from "../player/PlayerContext";
import { PrivateScanProgressBar } from "../components/PrivateScanProgressBar";
import "./privateGallery.css";
import "./private-modern.css";

/* 0.6.2 (étape 2, correctif) — Bibliothèque privée Vidéos restylée.
   CORRECTIF crash « Invalid hook call » : tous les hooks (useNavigate,
   useSearchParams, useState…) sont STRICTEMENT dans le corps du
   composant — une ligne `const navigate = useNavigate();` placée au
   niveau du module s'exécutait à l'import et faisait planter toute
   l'application dès le chargement du routeur.
   Inclut : sélecteur natif de dossier, scan + résumé + barre de
   progression, modale de suppression, retrait de dossier au survol,
   pré-sélection de dossier via ?folder=<id> (vue Albums de la galerie). */

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
  return summary.failed > 0
    ? `${base} ${summary.failed} fichier(s) ignoré(s) (erreur de lecture).`
    : base;
}

function folderName(path: string): string {
  const segments = path.replace(/[\\/]+$/, "").split(/[\\/]/);
  return segments[segments.length - 1] || path;
}

function norm(path: string): string {
  return path.replace(/[\\/]+$/, "");
}
function isInside(child: string, parent: string): boolean {
  const c = norm(child);
  const p = norm(parent);
  return c !== p && c.startsWith(p) && (c[p.length] === "\\" || c[p.length] === "/");
}

function PrivateVideoThumb({ fileId }: { fileId: number }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    privateVideoApi
      .thumbnail(fileId)
      .then((b64) => {
        if (!cancelled && b64) setSrc(`data:image/jpeg;base64,${b64}`);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [fileId]);
  return <img src={src ?? undefined} alt="" />;
}

export function PrivateVideoLibraryPage() {
  const { id } = useParams<{ id: string }>();
  const privateLibraryId = Number(id);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { playQueue } = usePlayer();

  const [libraryName, setLibraryName] = useState<string | null>(null);
  const [folders, setFolders] = useState<PrivateVideoFolder[]>([]);
  const [files, setFiles] = useState<PrivateVideoFile[]>([]);
  // 0.6.2 : pré-sélection d'un dossier via ?folder=<id> (depuis la vue
  // Albums de la galerie unifiée) — validée après chargement ci-dessous.
  const [activeFolderId, setActiveFolderId] = useState<number | null>(() => {
    const raw = searchParams.get("folder");
    const parsed = raw ? Number(raw) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  });
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
      const library = libraries.find((c) => c.id === privateLibraryId) ?? null;
      if (!library) {
        setError("Bibliothèque privée introuvable.");
        setLibraryName(null);
        return;
      }
      setLibraryName(library.name);
      setFolders(folderList);
      setFiles(fileList);
      // Le dossier demandé n'existe (plus) pas → retour racine.
      setActiveFolderId((current) =>
        current !== null && !folderList.some((f) => f.id === current) ? null : current
      );
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Chargement impossible.");
    }
  }, [privateLibraryId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const depthOf = useCallback(
    (folder: PrivateVideoFolder) =>
      folders.filter((g) => g.id !== folder.id && isInside(folder.path, g.path)).length,
    [folders]
  );

  const visible = useMemo(() => {
    if (activeFolderId === null) return files;
    const folder = folders.find((f) => f.id === activeFolderId);
    if (!folder) return files;
    return files.filter((v) => isInside(v.path, folder.path));
  }, [files, folders, activeFolderId]);

  const countFor = useCallback(
    (folder: PrivateVideoFolder) => files.filter((v) => isInside(v.path, folder.path)).length,
    [files]
  );

  const playVisible = (file: PrivateVideoFile) => {
    if (!file.is_available) return;
    const playable = visible.filter((c) => c.is_available);
    const startIndex = playable.findIndex((c) => c.id === file.id);
    if (startIndex === -1) return;
    playQueue(playable.map(toPlayableMedia), startIndex);
  };

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
      if (activeFolderId === folderId) setActiveFolderId(null);
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
    <div className="pvg-sub">
      <nav className="pvg-crumb">
        <Link to="/private">
          <ArrowLeft size={15} /> Privé
        </Link>
        <span>/</span>
        <span>{libraryName ?? "Vidéos"}</span>
      </nav>

      <div className="pvg-sub__head">
        <div>
          <h1 className="pvg-header__title">{libraryName ?? "Bibliothèque introuvable"}</h1>
          <div className="pvg-header__sub">
            {files.length} vidéo(s) • {folders.length} dossier(s) • catalogue chiffré
          </div>
        </div>
        <div className="pvg-sub__actions">
          <button type="button" className="pvg-btn-soft" onClick={handleAddFolder} disabled={busy}>
            <FolderPlus size={15} /> Ajouter un dossier
          </button>
          <button
            type="button"
            className="pvg-btn-soft"
            onClick={handleScan}
            disabled={busy || folders.length === 0}
          >
            <RefreshCw size={15} /> {busy ? "Analyse…" : "Scanner"}
          </button>
          <button
            type="button"
            className="pvg-btn-soft"
            onClick={() => setDeleteModalOpen(true)}
            style={{ color: "#fb7185" }}
          >
            <Trash2 size={15} /> Supprimer
          </button>
        </div>
      </div>

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

      <div className="pvg-split">
        <aside className="pvg-folders">
          <button
            type="button"
            className={`pvg-folder${activeFolderId === null ? " pvg-folder--active" : ""}`}
            onClick={() => setActiveFolderId(null)}
          >
            <Film size={15} />
            <span>Toutes les vidéos</span>
            <span className="pvg-folder__count">{files.length}</span>
          </button>
          {folders.map((folder) => (
            <div className="pvg-folder-wrap" key={folder.id}>
              <button
                type="button"
                className={`pvg-folder${activeFolderId === folder.id ? " pvg-folder--active" : ""}`}
                style={{ paddingLeft: 10 + depthOf(folder) * 14 }}
                onClick={() => setActiveFolderId(folder.id)}
              >
                <Film size={14} />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {folderName(folder.path)}
                </span>
                <span className="pvg-folder__count">{countFor(folder)}</span>
              </button>
              <span className="pvg-folder-wrap__del">
                <IconButton
                  label="Retirer ce dossier"
                  onClick={() => void handleRemoveFolder(folder.id)}
                >
                  <Trash2 size={13} />
                </IconButton>
              </span>
            </div>
          ))}
        </aside>

        {visible.length === 0 ? (
          <EmptyState
            icon={<Film size={32} />}
            title="Aucune vidéo"
            description="Ajoutez un dossier puis lancez un scan pour remplir cette bibliothèque."
          />
        ) : (
          <div className="pvg-grid">
            {visible.map((video) => (
              <button
                key={video.id}
                type="button"
                className="pvg-card"
                onClick={() => playVisible(video)}
                title={video.file_name}
              >
                <div className="pvg-card__media">
                  <PrivateVideoThumb fileId={video.id} />
                  <div className="pvg-card__shade" />
                  <span className="pvg-card__play">
                    <span>
                      <Film size={18} />
                    </span>
                  </span>
                  {!video.is_available && <span className="pvg-card__badge">Indisponible</span>}
                </div>
                <div className="pvg-card__meta">
                  <span className="pvg-card__title">{video.file_name}</span>
                  <span className="pvg-card__sub">
                    {folderName(video.path.replace(/[^\\/]+$/, "")) || "—"}
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}