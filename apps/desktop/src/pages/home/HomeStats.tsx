import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Flame, Hourglass, Library } from "lucide-react";
import type { Category } from "@aethervault/shared-types";
import { titleApi, type WatchSession, type WatchStats } from "../../features/title/api";
import { CountUp } from "./CountUp";
import { tintFor } from "./homeTheme";

const DAY_LETTERS = ["D", "L", "M", "M", "J", "V", "S"];
const RING_RADIUS = 54;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

interface WeekDay {
  letter: string;
  label: string;
  count: number;
  today: boolean;
}

/** Séances par jour sur les 7 derniers jours (aujourd'hui = dernière barre). */
function buildWeek(sessions: WatchSession[]): WeekDay[] {
  const base = new Date();
  base.setHours(0, 0, 0, 0);
  const days: WeekDay[] = [];
  for (let back = 6; back >= 0; back--) {
    const d = new Date(base);
    d.setDate(base.getDate() - back);
    days.push({
      letter: DAY_LETTERS[d.getDay()],
      label: d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" }),
      count: 0,
      today: back === 0,
    });
  }
  for (const session of sessions) {
    const when = new Date(session.endedAt);
    if (Number.isNaN(when.getTime())) continue;
    when.setHours(0, 0, 0, 0);
    const back = Math.round((base.getTime() - when.getTime()) / 86_400_000);
    if (back >= 0 && back <= 6) days[6 - back].count += 1;
  }
  return days;
}

/**
 * « En chiffres » : répartition de la médiathèque (anneau), Time Capsule
 * résumée (heures, séances, activité sur 7 jours) et genres favoris.
 * Mêmes commandes que la page Time Capsule (`/stats`) — rien de nouveau
 * côté backend ; la répartition vient des catégories déjà chargées.
 */
export function HomeStats({ categories }: { categories: Category[] }) {
  const navigate = useNavigate();
  const [stats, setStats] = useState<WatchStats | null>(null);
  const [genres, setGenres] = useState<[string, number][]>([]);
  const [week, setWeek] = useState<WeekDay[]>(() => buildWeek([]));
  // Les anneaux/barres démarrent « vides » puis se remplissent au premier
  // rendu (transition CSS ; coupée si l'utilisateur réduit les animations).
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    let alive = true;
    titleApi
      .watchStats()
      .then((value) => alive && setStats(value))
      .catch(() => {});
    titleApi
      .topGenres(5)
      .then((value) => alive && setGenres(value))
      .catch(() => {});
    const from = new Date();
    from.setHours(0, 0, 0, 0);
    from.setDate(from.getDate() - 6);
    const to = new Date();
    to.setHours(0, 0, 0, 0);
    to.setDate(to.getDate() + 1);
    titleApi
      .watchSessions(from.toISOString(), to.toISOString())
      .then((sessions) => alive && setWeek(buildWeek(sessions)))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const slices = categories
    .filter((c) => c.key !== "private" && (c.title_count ?? 0) > 0)
    .map((c) => ({
      key: c.key,
      name: c.name,
      count: c.title_count ?? 0,
      tint: tintFor(c.key),
    }));
  const total = slices.reduce((sum, s) => sum + s.count, 0);

  let cumulated = 0;
  const arcs = slices.map((slice) => {
    const fraction = total > 0 ? slice.count / total : 0;
    const gap = slices.length > 1 ? 4 : 0;
    const length = Math.max(0, fraction * RING_LENGTH - gap);
    const offset = -cumulated * RING_LENGTH;
    cumulated += fraction;
    return { ...slice, length, offset };
  });

  const weekMax = Math.max(1, ...week.map((d) => d.count));
  const genreMax = Math.max(1, ...genres.map(([, count]) => count));
  const noWatch = stats !== null && stats.sessionCount === 0;

  return (
    <section className="avm-hx-section" aria-label="En chiffres">
      <div className="avm-hx-head">
        <span className="avm-hx-kicker">Votre médiathèque</span>
        <h2>En chiffres</h2>
      </div>

      <div className="avm-hx-stats">
        {/* Répartition */}
        <article className="avm-hx-card">
          <header className="avm-hx-card__label">
            <Library size={14} /> Médiathèque
          </header>
          <div className="avm-hx-donut">
            <svg viewBox="0 0 140 140" role="img" aria-label={`${total} titres au total`}>
              <circle className="avm-hx-donut__track" cx="70" cy="70" r={RING_RADIUS} />
              <g transform="rotate(-90 70 70)">
                {arcs.map((arc) => (
                  <circle
                    key={arc.key}
                    className="avm-hx-donut__arc"
                    cx="70"
                    cy="70"
                    r={RING_RADIUS}
                    stroke={`rgb(${arc.tint})`}
                    strokeDasharray={ready ? `${arc.length} ${RING_LENGTH - arc.length}` : `0 ${RING_LENGTH}`}
                    strokeDashoffset={arc.offset}
                  />
                ))}
              </g>
            </svg>
            <div className="avm-hx-donut__center">
              <span className="avm-hx-big">
                <CountUp value={total} />
              </span>
              <span className="avm-hx-muted">titres</span>
            </div>
          </div>
          <ul className="avm-hx-legend">
            {slices.length === 0 && <li className="avm-hx-muted">Aucun titre pour l'instant.</li>}
            {slices.map((slice) => (
              <li key={slice.key}>
                <span className="avm-hx-legend__dot" style={{ background: `rgb(${slice.tint})` }} />
                <span className="avm-hx-legend__name">{slice.name}</span>
                <span className="avm-hx-legend__count">{slice.count}</span>
              </li>
            ))}
          </ul>
        </article>

        {/* Time Capsule */}
        <article className="avm-hx-card">
          <header className="avm-hx-card__label">
            <Hourglass size={14} /> Time Capsule
          </header>
          <div className="avm-hx-hours">
            <span className="avm-hx-big avm-hx-big--xl">
              <CountUp value={stats?.totalHours ?? 0} decimals={1} />
            </span>
            <span className="avm-hx-muted">heures regardées</span>
          </div>
          <div className="avm-hx-chips">
            <div>
              <strong>{stats?.sessionCount ?? 0}</strong>
              <span>séances</span>
            </div>
            <div>
              <strong>{stats?.uniqueTitles ?? 0}</strong>
              <span>titres vus</span>
            </div>
            <div>
              <strong>{stats?.uniqueGenres ?? 0}</strong>
              <span>genres</span>
            </div>
          </div>
          <div className="avm-hx-week" aria-label="Séances des 7 derniers jours">
            {week.map((day, i) => (
              <div
                key={i}
                className={`avm-hx-week__day${day.today ? " avm-hx-week__day--today" : ""}`}
                title={`${day.label} : ${day.count} séance${day.count > 1 ? "s" : ""}`}
              >
                <span className="avm-hx-week__track">
                  <span
                    className="avm-hx-week__bar"
                    style={{ height: ready ? `${Math.max(day.count > 0 ? 14 : 5, (day.count / weekMax) * 100)}%` : "0%" }}
                  />
                </span>
                <span className="avm-hx-week__letter">{day.letter}</span>
              </div>
            ))}
          </div>
          {noWatch && (
            <p className="avm-hx-muted avm-hx-hint">Lancez un titre : vos statistiques apparaîtront ici.</p>
          )}
          <button type="button" className="avm-hx-link" onClick={() => navigate("/stats")}>
            Ouvrir la Time Capsule <ArrowRight size={14} />
          </button>
        </article>

        {/* Genres favoris */}
        <article className="avm-hx-card">
          <header className="avm-hx-card__label">
            <Flame size={14} /> Genres favoris
          </header>
          {genres.length === 0 ? (
            <p className="avm-hx-muted avm-hx-hint">
              Vos genres favoris apparaîtront ici après quelques visionnages.
            </p>
          ) : (
            <ul className="avm-hx-genres">
              {genres.map(([genre, count], i) => (
                <li key={genre}>
                  <div className="avm-hx-genres__row">
                    <span className="avm-hx-genres__rank">{i + 1}</span>
                    <span className="avm-hx-genres__name">{genre}</span>
                    <span className="avm-hx-genres__count">{count}</span>
                  </div>
                  <span className="avm-hx-genres__track">
                    <span
                      className="avm-hx-genres__bar"
                      style={{ width: ready ? `${Math.max(6, (count / genreMax) * 100)}%` : "0%" }}
                    />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </article>
      </div>
    </section>
  );
}
