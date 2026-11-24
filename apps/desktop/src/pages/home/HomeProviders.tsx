import { useEffect, useState, type CSSProperties } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowUpRight, KeyRound, Link2, Plus, Star } from "lucide-react";
import {
  getProviders, openExternal, providerHost, subscribeProviders, type ProviderEntry,
} from "../../features/providers/api";
import { ProviderIcon } from "../../features/providers/ProviderIcon";
import "../../features/providers/providers.css";

/**
0.8.0 — Section « Fournisseurs » en haut de l'Accueil : les 5 premiers
sites de la bibliothèque, DANS L'ORDRE PERSONNALISÉ par l'utilisateur
(glisser-déposer / flèches de la page Fournisseurs), avec leur vraie
icône. Un clic ouvre le lien dans le navigateur par défaut ; le badge
vert signale un identifiant enregistré, l'étoile dorée le site recommandé.
*/
export function HomeProviders() {
  const navigate = useNavigate();
  const [providers, setProviders] = useState<ProviderEntry[]>(() => getProviders());
  useEffect(() => subscribeProviders(() => setProviders(getProviders())), []);
  const top = providers.slice(0, 5);

  return (
    <section className="avm-pv-home" aria-label="Fournisseurs">
      <div className="avm-pv-home__head">
        <div>
          <span className="avm-pv-kicker">Accès rapides</span>
          <h2>Fournisseurs</h2>
        </div>
        <button className="avm-pv-btn avm-pv-btn--ghost avm-pv-btn--small" onClick={() => navigate("/providers")}>
          <Link2 size={13} /> Gérer la bibliothèque
        </button>
      </div>
      <div className="avm-pv-home__row">
        {top.map((p) => (
          <button
            key={p.id}
            type="button"
            className="avm-pv-home__tile"
            style={{ "--pv-color": p.color } as CSSProperties}
            title={`Ouvrir ${p.name} dans le navigateur par défaut`}
            onClick={() => void openExternal(p.url)}
          >
            {(p.username || p.email || p.password) && (
              <span className="avm-pv-home__key" title="Identifiants enregistrés"><KeyRound size={11} /></span>
            )}
            <ArrowUpRight className="avm-pv-home__arrow" size={14} aria-hidden="true" />
            <ProviderIcon entry={p} size={44} />
            <span className="avm-pv-home__name">
              {p.recommended && <Star size={11} className="avm-pv-home__reco" aria-label="Recommandé" />}
              {p.name}
            </span>
            <span className="avm-pv-home__host">{providerHost(p.url)}</span>
          </button>
        ))}
        <button type="button" className="avm-pv-home__tile avm-pv-home__tile--add"
          onClick={() => navigate("/providers")} title="Ajouter un fournisseur">
          <span className="avm-pv-home__plus"><Plus size={20} /></span>
          <span className="avm-pv-home__name">Ajouter</span>
          <span className="avm-pv-home__host">un fournisseur</span>
        </button>
      </div>
    </section>
  );
}