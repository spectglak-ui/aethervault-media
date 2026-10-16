import { useCallback, useEffect, useState } from "react";
import { Bookmark, BookmarkCheck, BookmarkX } from "lucide-react";
import { Button } from "@aethervault/ui-kit";
import { StarRating } from "../../components/StarRating";
import {
  userListsApi,
  WATCH_STATUS_LABELS,
  type TitleUserState,
  type WatchStatus,
} from "./api";

/**
 * Note personnelle (demi-étoiles) et watchlist d'un titre, pour le profil
 * actif — affichés sur la page du titre.
 */
export function TitleUserPanel({ titleId }: { titleId: number }) {
  const [state, setState] = useState<TitleUserState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    userListsApi
      .getState(titleId)
      .then((s) => {
        setState(s);
        setError(null);
      })
      .catch((err) => setError(typeof err === "string" ? err : "Chargement impossible."));
  }, [titleId]);

  useEffect(() => {
    setState(null);
    refresh();
  }, [refresh]);

  const run = async (action: () => Promise<void>) => {
    setError(null);
    try {
      await action();
      refresh();
    } catch (err) {
      setError(typeof err === "string" ? err : err instanceof Error ? err.message : "Échec.");
    }
  };

  if (state === null) return error ? <p className="avm-settings-error">{error}</p> : null;

  const status = state.watch_status;
  return (
    <div className="avm-user-panel">
      <div className="avm-user-panel__row">
        <span className="avm-user-panel__label">Ma note</span>
        <StarRating
          value={state.rating}
          size={24}
          showValue
          onChange={(next) => void run(() => userListsApi.setRating(titleId, next))}
        />
      </div>
      <div className="avm-user-panel__row">
        <span className="avm-user-panel__label">Watchlist</span>
        {status === null ? (
          <Button variant="secondary" onClick={() => void run(() => userListsApi.watchlistAdd(titleId))}>
            <Bookmark size={14} style={{ marginRight: 6, verticalAlign: "text-bottom" }} />
            Ajouter à ma watchlist
          </Button>
        ) : (
          <>
            <BookmarkCheck size={16} aria-hidden="true" />
            <select
              className="avm-user-panel__select"
              aria-label="Statut dans la watchlist"
              value={status}
              onChange={(e) =>
                void run(() => userListsApi.watchlistSetStatus(titleId, e.target.value as WatchStatus))
              }
            >
              {(Object.keys(WATCH_STATUS_LABELS) as WatchStatus[]).map((s) => (
                <option key={s} value={s}>
                  {WATCH_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
            <Button variant="secondary" onClick={() => void run(() => userListsApi.watchlistRemove(titleId))}>
              <BookmarkX size={14} style={{ marginRight: 6, verticalAlign: "text-bottom" }} />
              Retirer
            </Button>
          </>
        )}
      </div>
      {error && <p className="avm-settings-error">{error}</p>}
    </div>
  );
}
