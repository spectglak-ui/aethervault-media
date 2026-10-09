import type { CSSProperties, MouseEvent, ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowUpRight, Tv } from "lucide-react";
import type { Category } from "@aethervault/shared-types";
import { assetUrl } from "../../lib/assetUrl";
import { categoryIcon } from "../../lib/categoryIcon";
import { categoryRoute } from "../../lib/categoryRoute";
import { CountUp } from "./CountUp";
import { tintFor } from "./homeTheme";

/** 0.4.0 : détection tolérante de la catégorie Animés. */
function isAnimeCategory(c: Category): boolean {
  return c.key === "animes" || c.key === "anime" || c.name.toLowerCase().includes("anim");
}

interface Portal {
  id: string;
  route: string;
  name: string;
  tint: string;
  icon: ReactNode;
  /** Grande icône décorative affichée quand il n'y a pas de bannière. */
  ghost?: ReactNode;
  banner?: string;
  /** `undefined` : pas de compteur ; `null` : catégorie verrouillée (Privé). */
  count?: number | null;
  subtitle?: string;
  badge?: string;
  variant?: "aetherfy" | "tv";
}

function buildPortals(categories: Category[], hidePrivate: boolean): Portal[] {
  const aetherfy: Portal = {
    id: "aetherfy",
    route: "/vaulttube",
    name: "AetherFy",
    tint: tintFor("aetherfy"),
    icon: null,
    subtitle: "Streaming en ligne",
    badge: "Alpha",
    variant: "aetherfy",
  };
  const tv: Portal = {
    id: "tv",
    route: "/tv",
    name: "TV",
    tint: tintFor("tv"),
    icon: <Tv size={18} />,
    ghost: <Tv size={120} />,
    subtitle: "Chaînes en direct",
    variant: "tv",
  };

  // Tuile TV : après Privé, ou à la place d'une éventuelle catégorie « tv »
  // (même règle qu'avant la refonte) ; sinon en dernier recours à la fin.
  const hasTvCategory = categories.some((c) => c.key === "tv");
  const out: Portal[] = [];
  let tvPlaced = false;
  const placeTv = () => {
    if (!tvPlaced) {
      out.push(tv);
      tvPlaced = true;
    }
  };
  for (const category of categories) {
    if (category.key === "tv") {
      placeTv();
      continue;
    }
    if (!(category.key === "private" && hidePrivate)) {
      out.push({
        id: `category-${category.id}`,
        route: categoryRoute(category),
        name: category.name,
        tint: tintFor(category.key),
        icon: categoryIcon(category.key, 18),
        ghost: categoryIcon(category.key, 120),
        banner: assetUrl(category.banner) ?? undefined,
        count: category.title_count,
      });
    }
    if (isAnimeCategory(category)) out.push(aetherfy);
    if (category.key === "private" && !hasTvCategory) placeTv();
  }
  if (!categories.some(isAnimeCategory)) out.push(aetherfy);
  placeTv();
  return out;
}

/**
 * « Vos univers » : les fonctionnalités principales sous forme de
 * portails — catégories (avec leur bannière), AetherFy et TV. Mêmes
 * destinations qu'avant ; Privé reste masquable depuis les Paramètres.
 */
export function HomeUniverses({
  categories,
  hidePrivate,
}: {
  categories: Category[];
  hidePrivate: boolean;
}) {
  const navigate = useNavigate();
  const portals = buildPortals(categories, hidePrivate);

  // Projecteur qui suit le curseur (variables lues par la feuille de style).
  const trackPointer = (e: MouseEvent<HTMLButtonElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty("--mx", `${e.clientX - rect.left}px`);
    e.currentTarget.style.setProperty("--my", `${e.clientY - rect.top}px`);
  };

  return (
    <section className="avm-hx-section" aria-label="Vos univers">
      <div className="avm-hx-head">
        <span className="avm-hx-kicker">Naviguer</span>
        <h2>Vos univers</h2>
      </div>
      <div className="avm-hx-universes">
        {portals.map((portal) => (
          <button
            key={portal.id}
            type="button"
            className={`avm-hx-portal${portal.variant ? ` avm-hx-portal--${portal.variant}` : ""}`}
            style={{ "--tint": portal.tint } as CSSProperties}
            onMouseMove={trackPointer}
            onClick={() => navigate(portal.route)}
          >
            {portal.banner ? (
              <img className="avm-hx-portal__img" src={portal.banner} alt="" loading="lazy" />
            ) : (
              <span className="avm-hx-portal__ghost" aria-hidden="true">
                {portal.ghost}
              </span>
            )}
            {portal.variant === "aetherfy" && (
              <span className="avm-hx-portal__waves" aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
            )}
            <span className="avm-hx-portal__shade" aria-hidden="true" />

            <span className="avm-hx-portal__top">
              {portal.icon && <span className="avm-hx-portal__chip">{portal.icon}</span>}
              {portal.badge && <span className="avm-hx-portal__badge">{portal.badge}</span>}
              <ArrowUpRight className="avm-hx-portal__arrow" size={18} aria-hidden="true" />
            </span>

            <span className="avm-hx-portal__bottom">
              <span className="avm-hx-portal__name">
                {portal.variant === "aetherfy" ? (
                  <span className="avm-brand-aetherfy">AetherFy</span>
                ) : (
                  portal.name
                )}
              </span>
              <span className="avm-hx-portal__count">
                {portal.subtitle ??
                  (portal.count === null || portal.count === undefined ? (
                    "🔒"
                  ) : (
                    <>
                      <CountUp value={portal.count} /> titre{portal.count > 1 ? "s" : ""}
                    </>
                  ))}
              </span>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
