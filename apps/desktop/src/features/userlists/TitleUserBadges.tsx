import { Bookmark, Star } from "lucide-react";
import type { TitleUserState } from "./api";
import { WatchStateBadge } from "../watchState/WatchStateBadge";
import type { TitleWatchState } from "../watchState/api";

/**
 * Pastilles affichées sous une affiche : statut de visionnage automatique
 * (« À voir » / « En cours » / « Vu »), note personnelle (« ★ 4,5 ») et
 * marque-page si le titre est dans la watchlist. Le statut de la watchlist
 * n'est plus écrit en toutes lettres ici : il suit le statut automatique.
 */
export function TitleUserBadges({
  state,
  watch,
}: {
  state?: TitleUserState;
  watch?: TitleWatchState;
}) {
  const rating = state?.rating ?? null;
  const inWatchlist = (state?.watch_status ?? null) !== null;
  if (rating === null && !inWatchlist && !watch) return null;
  return (
    <div className="avm-userbadges">
      {watch && <WatchStateBadge status={watch.status} watched={watch.watched} total={watch.total} />}
      {rating !== null && (
        <span className="avm-userbadges__rating" title={`Ma note : ${rating} sur 5`}>
          <Star size={13} aria-hidden="true" /> {rating.toFixed(1).replace(".", ",")}
        </span>
      )}
      {inWatchlist && (
        <span className="avm-userbadges__watch" title="Dans ma watchlist">
          <Bookmark size={13} aria-hidden="true" />
        </span>
      )}
    </div>
  );
}
