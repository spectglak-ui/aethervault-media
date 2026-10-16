import { Bookmark, Star } from "lucide-react";
import { WATCH_STATUS_LABELS, type TitleUserState } from "./api";

/**
 * Pastille de la note personnelle (« ★ 4,5 ») et marque-page de watchlist
 * affichés sous une affiche. Ne rend rien si le titre n'a ni note ni statut.
 */
export function TitleUserBadges({ state }: { state?: TitleUserState }) {
  if (!state || (state.rating === null && state.watch_status === null)) return null;
  return (
    <div className="avm-userbadges">
      {state.rating !== null && (
        <span className="avm-userbadges__rating" title={`Ma note : ${state.rating} sur 5`}>
          <Star size={13} aria-hidden="true" /> {state.rating.toFixed(1).replace(".", ",")}
        </span>
      )}
      {state.watch_status !== null && (
        <span
          className={`avm-userbadges__watch avm-userbadges__watch--${state.watch_status}`}
          title={`Watchlist : ${WATCH_STATUS_LABELS[state.watch_status]}`}
        >
          <Bookmark size={13} aria-hidden="true" /> {WATCH_STATUS_LABELS[state.watch_status]}
        </span>
      )}
    </div>
  );
}
