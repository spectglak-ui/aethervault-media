import { useEffect, useState } from "react";
import { Copy, Download, StopCircle } from "lucide-react";
import { Button, PageHeader } from "@aethervault/ui-kit";
import type { EpisodeSummary, TitleDetails, TitleSearchResult } from "@aethervault/shared-types";
import { titleApi } from "../features/title/api";
import { shareApi, type ShareOffer, type ShareProgress } from "../features/share/api";
import "./pages.css";

interface ShareableEpisode {
  mediaFileId: number;
  label: string;
}

/**
 * Partage via code (Étape 8, version durcie) : sélection d'un film ou
 * d'un épisode → code `AVM-…` (10 min, usage unique, flux AES-256-GCM) ;
 * l'ami le colle dans « Recevoir » et télécharge en P2P direct.
 * Case « LAN uniquement » : jamais d'UPnP, zéro exposition internet.
 */
export function SharePage() {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<TitleSearchResult[]>([]);
  const [pendingSeries, setPendingSeries] = useState<{
    name: string;
    episodes: ShareableEpisode[];
  } | null>(null);
  const [lanOnly, setLanOnly] = useState(false);
  const [offer, setOffer] = useState<ShareOffer | null>(null);
  const [busyShare, setBusyShare] = useState(false);
  const [receiveCode, setReceiveCode] = useState("");
  const [busyReceive, setBusyReceive] = useState(false);
  const [progress, setProgress] = useState<ShareProgress | null>(null);
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unlisten = shareApi.onProgress(setProgress);
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);

  const search = () => {
    if (!q.trim()) return;
    titleApi
      .search({
        q,
        category_keys: [],
        kinds: [],
        year_from: null,
        year_to: null,
        genres: [],
        actor: null,
        director: null,
        resolutions: [],
        codecs: [],
        audio_langs: [],
      })
      .then(setResults)
      .catch(() => setResults([]));
  };

  const startShare = async (mediaFileId: number) => {
    setBusyShare(true);
    setError(null);
    setPendingSeries(null);
    try {
      const result = await shareApi.start(mediaFileId, lanOnly);
      setOffer(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Partage impossible.");
    } finally {
      setBusyShare(false);
    }
  };

  const handlePick = async (result: TitleSearchResult) => {
    setError(null);
    if (result.kind === "movie") {
      const details = await titleApi.getDetails(result.id);
      if (details.media_file_id === null) {
        setError("Ce film n'a aucun fichier disponible.");
        return;
      }
      await startShare(details.media_file_id);
      return;
    }
    const details: TitleDetails = await titleApi.getDetails(result.id);
    const episodes: ShareableEpisode[] = [];
    for (const season of details.seasons) {
      const list: EpisodeSummary[] = await titleApi.listEpisodes(season.id);
      for (const episode of list) {
        if (episode.media_file_id !== null) {
          episodes.push({
            mediaFileId: episode.media_file_id,
            label: `${details.name} S${String(season.season_number).padStart(2, "0")}E${String(
              episode.episode_number
            ).padStart(2, "0")}`,
          });
        }
      }
    }
    if (episodes.length === 0) {
      setError("Aucun épisode disponible pour cette série.");
      return;
    }
    setPendingSeries({ name: details.name, episodes });
  };

  const handleStop = async () => {
    await shareApi.stop();
    setOffer(null);
  };

  const handleReceive = async () => {
    if (!receiveCode.trim()) return;
    setBusyReceive(true);
    setError(null);
    setSavedPath(null);
    setProgress(null);
    try {
      const path = await shareApi.receive(receiveCode);
      setSavedPath(path);
      setReceiveCode("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Réception impossible.");
    } finally {
      setBusyReceive(false);
    }
  };

  const percent =
    progress && progress.total > 0
      ? Math.min(100, Math.round((progress.transferred / progress.total) * 100))
      : null;

  return (
    <div>
      <PageHeader
        title="Partage via code"
        description="Envoyez un média à un ami AetherVault : P2P direct chiffré, aucun cloud, intégrité SHA-256."
      />
      {error && <p className="avm-settings-error">{error}</p>}
      <div className="avm-share-grid">
        <section className="avm-share-panel">
          <h2>Partager un média</h2>
          <label className="avm-share-lan">
            <input
              type="checkbox"
              checked={lanOnly}
              onChange={(event) => setLanOnly(event.target.checked)}
            />
            LAN uniquement (jamais d'UPnP : zéro exposition internet, même réseau seulement)
          </label>
          <div className="avm-explore-bar">
            <input
              type="search"
              className="avm-explore-input"
              placeholder="Nom d'un film ou d'une série…"
              value={q}
              onChange={(event) => setQ(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") search();
              }}
            />
            <Button variant="secondary" onClick={search}>
              Chercher
            </Button>
          </div>
          {results.length > 0 && (
            <ul className="avm-media-list" style={{ marginTop: 12 }}>
              {results.slice(0, 8).map((result) => (
                <li
                  key={`${result.category_key}-${result.id}`}
                  className="avm-media-list__item avm-media-list__item--playable"
                  onClick={() => void handlePick(result)}
                >
                  <span>{result.name}</span>
                  <span className="avm-card__subtitle">
                    {result.kind === "movie" ? "Film" : "Série"}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {pendingSeries && (
            <div style={{ marginTop: 12 }}>
              <p className="avm-settings-muted">Épisode à partager de « {pendingSeries.name} » :</p>
              <ul className="avm-media-list">
                {pendingSeries.episodes.map((episode) => (
                  <li
                    key={episode.mediaFileId}
                    className="avm-media-list__item avm-media-list__item--playable"
                    onClick={() => void startShare(episode.mediaFileId)}
                  >
                    <span>{episode.label}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {offer && (
            <div style={{ marginTop: 16 }}>
              <p className="avm-settings-muted">
                Partage actif : <strong>{offer.fileName}</strong> — code valable 10 minutes,
                usage unique :
              </p>
              <textarea className="avm-share-code" readOnly value={offer.code} rows={5} />
              <div className="avm-form-actions">
                <Button
                  variant="primary"
                  onClick={() => void navigator.clipboard.writeText(offer.code)}
                >
                  <Copy size={14} /> Copier le code
                </Button>
                <Button variant="danger" onClick={() => void handleStop()}>
                  <StopCircle size={14} /> Arrêter le partage
                </Button>
              </div>
            </div>
          )}
        </section>
        <section className="avm-share-panel">
          <h2>Recevoir un média</h2>
          <textarea
            className="avm-share-code"
            placeholder="Collez ici le code AVM-… reçu de votre ami"
            value={receiveCode}
            onChange={(event) => setReceiveCode(event.target.value)}
            rows={5}
          />
          <div className="avm-form-actions">
            <Button variant="primary" onClick={() => void handleReceive()} disabled={busyReceive}>
              <Download size={14} /> {busyReceive ? "Téléchargement…" : "Télécharger"}
            </Button>
          </div>
          {percent !== null && (
            <div className="avm-share-progress">
              <div style={{ width: `${percent}%` }} />
            </div>
          )}
          {progress && percent !== null && (
            <p className="avm-settings-muted">
              {progress.phase === "recv" ? "Réception" : "Envoi"} : {percent}%
            </p>
          )}
          {savedPath && (
            <p className="avm-settings-muted">
              ✅ Reçu et vérifié : <span className="avm-mono">{savedPath}</span>
              <br />
              Ajoutez le dossier « AetherVault Partages » comme bibliothèque pour l'intégrer au
              catalogue.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}