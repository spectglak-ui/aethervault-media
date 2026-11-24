import { useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent } from "react";
import {
  Check, ChevronDown, ChevronUp, Copy, Download, ExternalLink, Eye, EyeOff,
  GripVertical, KeyRound, Link2, Lock, Mail, Pencil, Plus, RotateCcw, Search,
  Star, Trash2, Upload, User, X,
} from "lucide-react";
import { ModernPageHeader } from "../components/ModernPageHeader";
import {
  PROVIDER_CATEGORIES, addProvider, brandColor, copyText, exportProvidersJson,
  getProviders, importProvidersJson, insertProviderAt, moveProvider, moveProviderBy,
  openExternal, providerHost, removeProvider, restoreDefaults, subscribeProviders,
  updateProvider, withProtocol, type ProviderCategory, type ProviderEntry,
} from "../features/providers/api";
import { ProviderIcon } from "../features/providers/ProviderIcon";
import "../features/providers/providers.css";

type SortKey = "manual" | "name" | "recent" | "category";
const SORT_LABELS: Record<SortKey, string> = {
  manual: "Mon ordre",
  name: "Nom (A → Z)",
  recent: "Ajout récent",
  category: "Catégorie",
};
const SWATCHES = ["#7c5cff", "#00c2ff", "#ff4d6d", "#1db954", "#f5a623", "#ff6600", "#e8365d", "#36e86d"];

interface Toast { msg: string; undo?: { entry: ProviderEntry; index: number } }

function blankDraft(): ProviderEntry {
  return {
    id: "", name: "", url: "", category: "streaming", color: "#7c5cff",
    username: "", email: "", password: "", notes: "", createdAt: 0,
  };
}

/** Champ d'identifiant avec copie rapide (retour visuel ✓ pendant 1,4 s). */
function CredRow({
  icon, label, value, secret, revealed, onReveal, onCopied,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  secret?: boolean;
  revealed?: boolean;
  onReveal?: () => void;
  onCopied: (ok: boolean, label: string) => void;
}) {
  const [ok, setOk] = useState(false);
  const timer = useRef<number | null>(null);
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);
  const copy = async () => {
    const success = await copyText(value);
    onCopied(success, label);
    if (success) {
      setOk(true);
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setOk(false), 1400);
    }
  };
  return (
    <div className="avm-pv-cred">
      {icon}
      <span className="avm-pv-cred__label">{label}</span>
      <span className="avm-pv-cred__value" title={secret && !revealed ? undefined : value}>
        {secret && !revealed ? "••••••••••" : value}
      </span>
      {secret && onReveal && (
        <button type="button" className="avm-pv-eye" onClick={onReveal}
          aria-label={revealed ? "Masquer le mot de passe" : "Afficher le mot de passe"}>
          {revealed ? <EyeOff size={13} /> : <Eye size={13} />}
        </button>
      )}
      <button type="button" className={`avm-pv-copy${ok ? " avm-pv-copy--ok" : ""}`} onClick={() => void copy()}>
        {ok ? <Check size={12} /> : <Copy size={12} />} {ok ? "Copié" : "Copier"}
      </button>
    </div>
  );
}

/**
0.8.0 — Page « Fournisseurs » : bibliothèque personnalisable de liens
vers les fournisseurs de médias, avec identifiants optionnels copiables
en un clic, ouverture dans le navigateur par défaut, recherche, filtres,
tri, réordonnancement (glisser-déposer + flèches ↑↓), export/import JSON
et restauration des liens par défaut.
0.8.x — badge « Recommandé » (Loadix en tête par défaut) ; l'ordre de la
liste est VOTRE ordre : l'Accueil affiche les 5 premiers de cet ordre.
*/
export function ProvidersPage() {
  const [providers, setProviders] = useState<ProviderEntry[]>(() => getProviders());
  const [query, setQuery] = useState("");
  const [cat, setCat] = useState<"all" | ProviderCategory>("all");
  const [sort, setSort] = useState<SortKey>("manual");
  const [draft, setDraft] = useState<ProviderEntry | null>(null);
  const [draftIsNew, setDraftIsNew] = useState(false);
  const [draftReveal, setDraftReveal] = useState(false);
  const [reveal, setReveal] = useState<Record<string, boolean>>({});
  const [toast, setToast] = useState<Toast | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = () => setProviders(getProviders());
  useEffect(() => subscribeProviders(refresh), []);
  useEffect(() => () => { if (toastTimer.current) window.clearTimeout(toastTimer.current); }, []);

  const showToast = (t: Toast, ms = 2400) => {
    setToast(t);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), ms);
  };

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = providers.filter((p) => {
      if (cat !== "all" && p.category !== cat) return false;
      if (!q) return true;
      return [p.name, providerHost(p.url), p.username, p.email, p.notes]
        .join(" ").toLowerCase().includes(q);
    });
    if (sort === "name") list = [...list].sort((a, b) => a.name.localeCompare(b.name, "fr"));
    else if (sort === "recent") list = [...list].sort((a, b) => b.createdAt - a.createdAt);
    else if (sort === "category") {
      const order = PROVIDER_CATEGORIES.map((c) => c.key);
      list = [...list].sort((a, b) => order.indexOf(a.category) - order.indexOf(b.category) || a.name.localeCompare(b.name, "fr"));
    }
    return list;
  }, [providers, query, cat, sort]);

  const withCreds = providers.filter((p) => p.username || p.email || p.password).length;
  const canDrag = sort === "manual" && cat === "all" && !query.trim();

  const openDraft = (entry?: ProviderEntry) => {
    setDraft(entry ? { ...entry } : blankDraft());
    setDraftIsNew(!entry);
    setDraftReveal(false);
  };
  const saveDraft = () => {
    if (!draft || !draft.name.trim() || !draft.url.trim()) return;
    const payload = { ...draft, name: draft.name.trim(), url: withProtocol(draft.url) };
    if (draftIsNew) {
      const { id: _id, createdAt: _c, ...rest } = payload;
      addProvider(rest);
      showToast({ msg: `« ${payload.name} » ajouté à votre bibliothèque.` });
    } else {
      updateProvider(payload.id, payload);
      showToast({ msg: `« ${payload.name} » mis à jour.` });
    }
    setDraft(null);
    refresh();
  };
  const doDelete = (entry: ProviderEntry) => {
    const removed = removeProvider(entry.id);
    refresh();
    if (removed) showToast({ msg: `« ${entry.name} » supprimé.`, undo: removed }, 6000);
  };
  const undoDelete = () => {
    if (toast?.undo) {
      insertProviderAt(toast.undo.entry, toast.undo.index);
      refresh();
    }
    setToast(null);
  };
  const onCopied = (ok: boolean, label: string) =>
    showToast({ msg: ok ? `${label} copié dans le presse-papiers.` : "Copie impossible sur cette machine." });

  const onDrop = (e: DragEvent<HTMLDivElement>, targetId: string) => {
    e.preventDefault();
    if (dragId && dragId !== targetId) { moveProvider(dragId, targetId); refresh(); }
    setDragId(null); setOverId(null);
  };

  const doExport = () => {
    const blob = new Blob([exportProvidersJson()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "aethervault-fournisseurs.json";
    a.click();
    URL.revokeObjectURL(url);
    showToast({ msg: "Bibliothèque exportée (sauvegarde JSON)." });
  };
  const doImport = async (file: File) => {
    try {
      const n = importProvidersJson(await file.text());
      refresh();
      showToast({ msg: `${n} fournisseur(s) importé(s).` });
    } catch (err) {
      showToast({ msg: err instanceof Error ? err.message : "Import impossible." }, 4000);
    }
  };

  return (
    <div className="avm-pv">
      <ModernPageHeader
        icon={<Link2 size={26} />}
        tint="0, 194, 255"
        kicker="Vos accès"
        title="Fournisseurs"
        description="Vos liens de streaming, anime, TV et musique — centralisés, avec vos identifiants copiables en un clic."
      />

      <div className="avm-pv-bar">
        <div className="avm-pv-search">
          <Search size={15} />
          <input type="search" placeholder="Rechercher un site, un identifiant, une note…"
            value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <select className="avm-pv-select" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}
          aria-label="Trier par">
          {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => <option key={k} value={k}>{SORT_LABELS[k]}</option>)}
        </select>
        <button className="avm-pv-btn avm-pv-btn--primary" onClick={() => openDraft()}>
          <Plus size={14} /> Ajouter
        </button>
        <button className="avm-pv-btn avm-pv-btn--ghost avm-pv-btn--small" onClick={doExport} title="Exporter en JSON">
          <Download size={13} /> Exporter
        </button>
        <button className="avm-pv-btn avm-pv-btn--ghost avm-pv-btn--small" onClick={() => fileRef.current?.click()} title="Importer un JSON">
          <Upload size={13} /> Importer
        </button>
        <button className="avm-pv-btn avm-pv-btn--ghost avm-pv-btn--small"
          onClick={() => { const n = restoreDefaults(); refresh(); showToast({ msg: n > 0 ? `${n} lien(s) par défaut restauré(s).` : "Tous les liens par défaut sont déjà présents." }); }}
          title="Restaurer les liens par défaut manquants">
          <RotateCcw size={13} /> Défauts
        </button>
        <input ref={fileRef} type="file" accept=".json,application/json" className="avm-visually-hidden"
          style={{ display: "none" }}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void doImport(f); e.target.value = ""; }} />
      </div>

      <div className="avm-pv-chips" role="group" aria-label="Filtrer par catégorie">
        <button className={`avm-pv-chip${cat === "all" ? " avm-pv-chip--on" : ""}`} onClick={() => setCat("all")}>Toutes</button>
        {PROVIDER_CATEGORIES.map((c) => (
          <button key={c.key} className={`avm-pv-chip${cat === c.key ? " avm-pv-chip--on" : ""}`} onClick={() => setCat(c.key)}>
            {c.label}
          </button>
        ))}
      </div>

      <p className="avm-pv-stats">
        <strong>{providers.length}</strong> fournisseur{providers.length > 1 ? "s" : ""} ·
        <strong>{withCreds}</strong> avec identifiants ·
        {canDrag
          ? "glissez une carte ou utilisez les flèches ↑↓ : l'Accueil affiche les 5 premiers de VOTRE ordre"
          : "tri/filtre actif : les flèches ↑↓ vous ramènent en « Mon ordre »"}
      </p>

      {providers.length === 0 ? (
        <div className="avm-pv-empty">
          <Link2 size={30} />
          <strong>Votre bibliothèque est vide</strong>
          <span>Ajoutez vos sites de streaming, anime, TV ou musique — ou restaurez les liens par défaut.</span>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="avm-pv-btn avm-pv-btn--primary" onClick={() => openDraft()}><Plus size={14} /> Ajouter un fournisseur</button>
            <button className="avm-pv-btn" onClick={() => { restoreDefaults(); refresh(); }}><RotateCcw size={13} /> Liens par défaut</button>
          </div>
        </div>
      ) : visible.length === 0 ? (
        <div className="avm-pv-empty">
          <Search size={26} />
          <strong>Aucun résultat</strong>
          <span>Essayez un autre terme ou retirez les filtres.</span>
          <button className="avm-pv-btn" onClick={() => { setQuery(""); setCat("all"); }}>Réinitialiser les filtres</button>
        </div>
      ) : (
        <div className="avm-pv-grid">
          {visible.map((p) => {
            const hasCreds = Boolean(p.username || p.email || p.password);
            return (
              <div
                key={p.id}
                className={`avm-pv-card${overId === p.id ? " avm-pv-card--over" : ""}${dragId === p.id ? " avm-pv-card--drag" : ""}`}
                style={{ "--pv-color": p.color } as CSSProperties}
                draggable={canDrag}
                onDragStart={() => setDragId(p.id)}
                onDragEnd={() => { setDragId(null); setOverId(null); }}
                onDragOver={(e) => { if (canDrag && dragId) { e.preventDefault(); setOverId(p.id); } }}
                onDragLeave={() => setOverId((o) => (o === p.id ? null : o))}
                onDrop={(e) => onDrop(e, p.id)}
              >
                <div className="avm-pv-card__head">
                  <ProviderIcon entry={p} size={44} />
                  <div className="avm-pv-card__titles">
                    <strong>{p.name}</strong>
                    <small>{providerHost(p.url)}</small>
                  </div>
                  <span className="avm-pv-badge">{PROVIDER_CATEGORIES.find((c) => c.key === p.category)?.label ?? "Autre"}</span>
                  {p.recommended && (
                    <span className="avm-pv-reco" title="Site recommandé par AetherVault">
                      <Star size={10} /> Recommandé
                    </span>
                  )}
                  {canDrag && <span className="avm-pv-grip" title="Glisser pour réordonner"><GripVertical size={15} /></span>}
                </div>

                {hasCreds && (
                  <div className="avm-pv-creds">
                    {p.username && (
                      <CredRow icon={<User size={13} />} label="Utilisateur" value={p.username} onCopied={onCopied} />
                    )}
                    {p.email && (
                      <CredRow icon={<Mail size={13} />} label="E-mail" value={p.email} onCopied={onCopied} />
                    )}
                    {p.password && (
                      <CredRow icon={<Lock size={13} />} label="Mot de passe" value={p.password} secret
                        revealed={reveal[p.id] === true}
                        onReveal={() => setReveal((r) => ({ ...r, [p.id]: !r[p.id] }))}
                        onCopied={onCopied} />
                    )}
                  </div>
                )}

                {p.notes && <p className="avm-pv-card__notes">{p.notes}</p>}

                <div className="avm-pv-card__actions">
                  <button className="avm-pv-btn avm-pv-btn--primary avm-pv-btn--small"
                    onClick={() => void openExternal(p.url)} title="Ouvrir dans le navigateur par défaut">
                    <ExternalLink size={13} /> Ouvrir
                  </button>
                  {hasCreds && <span title="Identifiants enregistrés" style={{ color: "var(--pv-ok)", display: "inline-flex" }}><KeyRound size={14} /></span>}
                  <span className="avm-pv-move">
                    <button
                      className="avm-pv-btn avm-pv-btn--icon"
                      title="Monter dans ma liste (l'Accueil suit cet ordre)"
                      onClick={() => { setSort("manual"); moveProviderBy(p.id, -1); refresh(); }}
                    >
                      <ChevronUp size={14} />
                    </button>
                    <button
                      className="avm-pv-btn avm-pv-btn--icon"
                      title="Descendre dans ma liste (l'Accueil suit cet ordre)"
                      onClick={() => { setSort("manual"); moveProviderBy(p.id, 1); refresh(); }}
                    >
                      <ChevronDown size={14} />
                    </button>
                  </span>
                  <button className="avm-pv-btn avm-pv-btn--icon" onClick={() => openDraft(p)} aria-label={`Modifier ${p.name}`} title="Modifier">
                    <Pencil size={14} />
                  </button>
                  <button className="avm-pv-btn avm-pv-btn--icon avm-pv-btn--danger" onClick={() => doDelete(p)} aria-label={`Supprimer ${p.name}`} title="Supprimer">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p className="avm-pv-note">
        Les identifiants sont stockés localement sur cette machine, uniquement pour vous.
        Pensez à « Exporter » régulièrement : le fichier JSON est votre sauvegarde portable.
      </p>

      {draft && (
        <>
          <div className="avm-pv-scrim" onClick={() => setDraft(null)} />
          <aside className="avm-pv-drawer" role="dialog" aria-modal="true" aria-label={draftIsNew ? "Ajouter un fournisseur" : "Modifier le fournisseur"}>
            <div className="avm-pv-drawer__head">
              <ProviderIcon entry={{ name: draft.name || "?", url: draft.url || "https://exemple.com", color: draft.color }} size={34} />
              <h2>{draftIsNew ? "Nouveau fournisseur" : `Modifier « ${draft.name} »`}</h2>
              <button className="avm-pv-btn avm-pv-btn--icon" onClick={() => setDraft(null)} aria-label="Fermer"><X size={15} /></button>
            </div>
            <div className="avm-pv-drawer__body">
              <label className="avm-pv-field">
                <span>Nom du site *</span>
                <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Netflix, Crunchyroll…" />
              </label>
              <label className="avm-pv-field">
                <span>Adresse du lien *</span>
                <input value={draft.url}
                  onChange={(e) => setDraft({ ...draft, url: e.target.value })}
                  onBlur={() => setDraft((d) => d ? { ...d, color: d.color === "#7c5cff" ? brandColor(d.url) : d.color } : d)}
                  placeholder="https://www.netflix.com" />
              </label>
              <label className="avm-pv-field">
                <span>Catégorie</span>
                <select value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value as ProviderCategory })}>
                  {PROVIDER_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                </select>
              </label>
              <div className="avm-pv-field">
                <span>Couleur de marque</span>
                <div className="avm-pv-field__row">
                  <input type="color" value={draft.color} onChange={(e) => setDraft({ ...draft, color: e.target.value })} aria-label="Couleur personnalisée" />
                  <div className="avm-pv-swatches">
                    {SWATCHES.map((hex) => (
                      <button key={hex} type="button" className={`avm-pv-swatch${draft.color === hex ? " avm-pv-swatch--on" : ""}`}
                        style={{ background: hex }} onClick={() => setDraft({ ...draft, color: hex })} aria-label={`Couleur ${hex}`} />
                    ))}
                  </div>
                </div>
              </div>
              <label className="avm-pv-field">
                <span>Nom d'utilisateur (optionnel)</span>
                <input value={draft.username} onChange={(e) => setDraft({ ...draft, username: e.target.value })} placeholder="pseudo du compte" autoComplete="off" />
              </label>
              <label className="avm-pv-field">
                <span>Adresse e-mail (optionnel)</span>
                <input type="email" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} placeholder="vous@exemple.com" autoComplete="off" />
              </label>
              <div className="avm-pv-field">
                <span>Mot de passe (optionnel)</span>
                <div className="avm-pv-field__row">
                  <input type={draftReveal ? "text" : "password"} value={draft.password}
                    onChange={(e) => setDraft({ ...draft, password: e.target.value })}
                    placeholder="••••••••" autoComplete="new-password" style={{ flex: 1 }} />
                  <button type="button" className="avm-pv-eye" onClick={() => setDraftReveal((v) => !v)}
                    aria-label={draftReveal ? "Masquer" : "Afficher"}>
                    {draftReveal ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>
              <label className="avm-pv-field">
                <span>Notes (optionnel)</span>
                <textarea value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} placeholder="Formule, profil, remarques…" />
              </label>
              <p className="avm-pv-drawer__hint">
                <KeyRound size={13} />
                Stockage local uniquement : ces identifiants ne quittent jamais votre machine et ne sont pas synchronisés.
              </p>
            </div>
            <div className="avm-pv-drawer__foot">
              <button className="avm-pv-btn avm-pv-btn--ghost" onClick={() => setDraft(null)}>Annuler</button>
              <button className="avm-pv-btn avm-pv-btn--primary" disabled={!draft.name.trim() || !draft.url.trim()} onClick={saveDraft}>
                <Check size={14} /> {draftIsNew ? "Ajouter" : "Enregistrer"}
              </button>
            </div>
          </aside>
        </>
      )}

      {toast && (
        <div className="avm-pv-toast" role="status">
          <span>{toast.msg}</span>
          {toast.undo && <button onClick={undoDelete}>Annuler</button>}
        </div>
      )}
    </div>
  );
}