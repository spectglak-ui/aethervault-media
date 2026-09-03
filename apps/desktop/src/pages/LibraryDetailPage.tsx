import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { listen } from "@tauri-apps/api/event";
import { FolderPlus, Network, RefreshCw, Trash2 } from "lucide-react";
import { Button, EmptyState, Modal, PageHeader } from "@aethervault/ui-kit";
import type {
  Library,
  LibraryFolder,
  MediaFile,
  PlayableMedia,
  ScanCompleteEvent,
} from "@aethervault/shared-types";
import { libraryApi } from "../features/library/api";
import { nasApi } from "../features/nas/api";
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

interface ScanProgressPayload {
  library_id: number;
  phase: "scan" | "metadata" | "thumbnails" | "done";
  processed: number;
  total: number;
  current: string;
}

const PHASE_LABELS: Record<ScanProgressPayload["phase"], string> = {
  scan: "Analyse des fichiers…",
  metadata: "Appariement des métadonnées…",
  thumbnails: "Génération des vignettes…",
  done: "",
};

export function LibraryDetailPage() {
  const { id } = useParams<{ id: string }>();
  const libraryId = Number(id);
  const navigate = useNavigate();
  const { playQueue } = usePlayer();
  const [library, setLibrary] = useState<Library | null>(null);
  const [folders, setFolders] = useState<LibraryFolder[]>([]);
  const [mediaFiles, setMediaFiles] = useState<MediaFile[]>([]);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState<ScanProgressPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // 0.4.0 : modal NAS (serveur distant).
  const [nasModalOpen, setNasModalOpen] = useState(false);
  const [nasServer, setNasServer] = useState("");
  const [nasShare, setNasShare] = useState("");
  const [nasUsername, setNasUsername] = useState("");
  const [nasPassword, setNasPassword] = useState("");
  const [nasTesting, setNasTesting] = useState(false);
  const [nasConnecting, setNasConnecting] = useState(false);
  const [nasFeedback, setNasFeedback] = useState<{
    kind: "success" | "error";
    message: string;
  } | null>(null);

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

  useEffect(() => {
    const unlistenUpdated = listen<number>("library:updated", (event) => {
      if (event.payload === libraryId) {
        refresh();
      }
    });
    const unlistenProgress = listen<ScanProgressPayload>("library:scan-progress", (event) => {
      if (event.payload.library_id !== libraryId) return;
      if (event.payload.phase === "done") {
        setScanning(false);
        window.setTimeout(() => setProgress(null), 900);
      } else {
        setProgress(event.payload);
        setScanning(true);
      }
    });
    const unlistenComplete = listen<ScanCompleteEvent>("library:scan-complete", (event) => {
      if (event.payload.library_id === libraryId) {
        refresh();
      }
    });
    const unlistenError = listen<string>("library:scan-error", () => {
      setScanning(false);
      setProgress(null);
    });
    return () => {
      unlistenUpdated.then((stop) => stop());
      unlistenProgress.then((stop) => stop());
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

  // 0.4.0 : test de connexion NAS (vérifie que le partage est lisible).
  const handleNasTest = async () => {
    setNasTesting(true);
    setNasFeedback(null);
    try {
      await nasApi.test(nasServer, nasShare);
      setNasFeedback({ kind: "success", message: "Connexion réussie !" });
    } catch (err) {
      setNasFeedback({
        kind: "error",
        message: err instanceof Error ? err.message : "Test échoué.",
      });
    } finally {
      setNasTesting(false);
    }
  };

  // 0.4.0 : connexion NAS + ajout comme dossier de bibliothèque.
  const handleNasConnect = async () => {
    setNasConnecting(true);
    setNasFeedback(null);
    try {
      const uncPath = await nasApi.connect(
        nasServer,
        nasShare,
        nasUsername || null,
        nasPassword || null
      );
      await libraryApi.addFolder(libraryId, uncPath);
      setNasModalOpen(false);
      setNasServer("");
      setNasShare("");
      setNasUsername("");
      setNasPassword("");
      setNasFeedback(null);
      setScanning(true);
      refresh();
    } catch (err) {
      setNasFeedback({
        kind: "error",
        message: err instanceof Error ? err.message : "Connexion échouée.",
      });
    } finally {
      setNasConnecting(false);
    }
  };

  if (!library) {
    return <p>Chargement…</p>;
  }

  const percent =
    progress && progress.total > 0
      ? Math.min(100, Math.round((progress.processed / progress.total) * 100))
      : 0;

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
            {/* 0.4.0 : ajout de dossier NAS (serveur distant). */}
            <Button variant="secondary" onClick={() => setNasModalOpen(true)} disabled={scanning}>
              <Network size={14} style={{ marginRight: 6, verticalAlign: "text-bottom" }} />
              Ajouter un dossier NAS
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
      {progress && progress.phase !== "done" && (
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
      )}
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
      {/* 0.4.0 : modal NAS — serveur distant avec identifiants optionnels. */}
      <Modal
        open={nasModalOpen}
        onClose={() => {
          if (!nasConnecting) {
            setNasModalOpen(false);
            setNasFeedback(null);
          }
        }}
        title="Ajouter un dossier NAS"
      >
        <p style={{ marginTop: 0 }}>
          Connectez-vous à un partage réseau (NAS, serveur Windows, etc.) pour y rechercher des
          fichiers média. Les identifiants sont stockés dans le Gestionnaire d'identification
          Windows, <strong>jamais dans la base de données</strong>.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 16 }}>
          <div>
            <label style={{ display: "block", fontSize: 12, marginBottom: 4 }}>
              Serveur (adresse IP ou nom)
            </label>
            <input
              type="text"
              value={nasServer}
              onChange={(e) => setNasServer(e.target.value)}
              placeholder="192.168.1.100 ou NAS-MAISON"
              disabled={nasConnecting}
              style={{
                width: "100%",
                padding: "8px 10px",
                border: "1px solid var(--color-border, #2c2c33)",
                borderRadius: 6,
                background: "var(--color-bg, #0f0f14)",
                color: "var(--color-text, #f2f2f5)",
                fontSize: 14,
              }}
            />
          </div>
          <div>
            <label style={{ display: "block", fontSize: 12, marginBottom: 4 }}>
              Nom du partage
            </label>
            <input
              type="text"
              value={nasShare}
              onChange={(e) => setNasShare(e.target.value)}
              placeholder="Films ou Series"
              disabled={nasConnecting}
              style={{
                width: "100%",
                padding: "8px 10px",
                border: "1px solid var(--color-border, #2c2c33)",
                borderRadius: 6,
                background: "var(--color-bg, #0f0f14)",
                color: "var(--color-text, #f2f2f5)",
                fontSize: 14,
              }}
            />
          </div>
          <div>
            <label style={{ display: "block", fontSize: 12, marginBottom: 4 }}>
              Nom d'utilisateur (optionnel)
            </label>
            <input
              type="text"
              value={nasUsername}
              onChange={(e) => setNasUsername(e.target.value)}
              placeholder="Laisser vide si accès anonyme"
              disabled={nasConnecting}
              style={{
                width: "100%",
                padding: "8px 10px",
                border: "1px solid var(--color-border, #2c2c33)",
                borderRadius: 6,
                background: "var(--color-bg, #0f0f14)",
                color: "var(--color-text, #f2f2f5)",
                fontSize: 14,
              }}
            />
          </div>
          <div>
            <label style={{ display: "block", fontSize: 12, marginBottom: 4 }}>
              Mot de passe (optionnel)
            </label>
            <input
              type="password"
              value={nasPassword}
              onChange={(e) => setNasPassword(e.target.value)}
              placeholder="Laisser vide si accès anonyme"
              disabled={nasConnecting}
              style={{
                width: "100%",
                padding: "8px 10px",
                border: "1px solid var(--color-border, #2c2c33)",
                borderRadius: 6,
                background: "var(--color-bg, #0f0f14)",
                color: "var(--color-text, #f2f2f5)",
                fontSize: 14,
              }}
            />
          </div>
        </div>
        {nasFeedback && (
          <div
            style={{
              marginTop: 12,
              padding: "8px 12px",
              borderRadius: 6,
              fontSize: 13,
              background:
                nasFeedback.kind === "success"
                  ? "rgba(74,222,128,0.15)"
                  : "rgba(255,100,100,0.15)",
              color: nasFeedback.kind === "success" ? "#4ade80" : "#ff6464",
            }}
          >
            {nasFeedback.message}
          </div>
        )}
        <div className="avm-form-actions">
          <Button
            variant="ghost"
            onClick={() => {
              setNasModalOpen(false);
              setNasFeedback(null);
            }}
            disabled={nasConnecting}
          >
            Annuler
          </Button>
          <Button
            variant="secondary"
            onClick={handleNasTest}
            disabled={nasTesting || nasConnecting || !nasServer || !nasShare}
          >
            {nasTesting ? "Test en cours…" : "Tester la connexion"}
          </Button>
          <Button
            variant="primary"
            onClick={handleNasConnect}
            disabled={nasConnecting || !nasServer || !nasShare}
          >
            {nasConnecting ? "Connexion…" : "Connecter et ajouter"}
          </Button>
        </div>
      </Modal>
      {error && <p className="avm-settings-error">{error}</p>}
      {folders.length === 0 ? (
        <EmptyState
          icon={<FolderPlus size={32} />}
          title="Aucun dossier associé"
          description="Ajoutez un dossier de votre disque ou un partage réseau pour qu'AetherVault Media y recherche des vidéos."
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
                      const playableFiles = mediaFiles.filter(
                        (candidate) => candidate.is_available
                      );
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