import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Film, Image as ImageIcon, Lock, LockOpen, Pencil, Plus, Trash2 } from "lucide-react";
import { Button, EmptyState, IconButton, PageHeader } from "@aethervault/ui-kit";
import type { Category, PrivateLibrary, SecretKind } from "@aethervault/shared-types";
import { useActiveProfile } from "../profile/ActiveProfileContext";
import { categoryApi } from "../features/category/api";
import { privacyApi } from "../features/privacy/api";
import { CreatePrivateLibraryModal } from "../features/privacy/CreatePrivateLibraryModal";
import { PersonalizableImage } from "../features/personalization/PersonalizableImage";
import { assetUrl } from "../lib/assetUrl";
import "./pages.css";

type Phase =
  | { kind: "loading" }
  | { kind: "denied" }
  | { kind: "setup" }
  | { kind: "unlock" }
  | { kind: "unlocked"; libraries: PrivateLibrary[] };

/**
 * Remplace `PrivatePlaceholderPage` (Étape 6a, doc §6.4/§6.4 bis).
 *
 * Double condition d'accès vérifiée ici comme côté Rust (défense en
 * profondeur, jamais la seule vérification — voir `domain::privacy`) :
 * `activeProfile.can_access_private` d'abord (sinon message générique,
 * aucune information sur l'état du coffre), puis le statut réel du coffre
 * (`initialized`/`unlocked`) pour choisir entre création, déverrouillage ou
 * contenu.
 */
export function PrivatePage() {
  const { activeProfile, loading: profileLoading } = useActiveProfile();
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [category, setCategory] = useState<Category | null>(null);

  const refreshCategory = () => {
    categoryApi.list().then((categories) => {
      setCategory(categories.find((candidate) => candidate.key === "private") ?? null);
    });
  };

  useEffect(() => {
    refreshCategory();
  }, []);

  const loadLibraries = async () => {
    try {
      const libraries = await privacyApi.listLibraries();
      setPhase({ kind: "unlocked", libraries });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Chargement impossible.");
    }
  };

  const refreshStatus = async () => {
    if (!activeProfile) return;
    if (!activeProfile.can_access_private) {
      setPhase({ kind: "denied" });
      return;
    }
    try {
      const status = await privacyApi.getVaultStatus();
      if (!status.initialized) {
        setPhase({ kind: "setup" });
      } else if (!status.unlocked) {
        setPhase({ kind: "unlock" });
      } else {
        await loadLibraries();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Chargement impossible.");
    }
  };

  useEffect(() => {
    if (profileLoading) return;
    setError(null);
    refreshStatus();
    // Volontairement dépendant du profil actif : basculer de profil doit
    // ré-évaluer l'accès (doc §6.4, "Portée") — jamais rester sur l'état
    // affiché pour le profil précédent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileLoading, activeProfile?.id]);

  const handleLock = async () => {
    try {
      await privacyApi.lockVault();
      setPhase({ kind: "unlock" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verrouillage impossible.");
    }
  };

  const handleDelete = async (library: PrivateLibrary) => {
    if (!window.confirm(`Supprimer la bibliothèque privée « ${library.name} » ?`)) return;
    try {
      await privacyApi.removeLibrary(library.id);
      await loadLibraries();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Suppression impossible.");
    }
  };

  const handleRename = async (library: PrivateLibrary) => {
    const nextName = window.prompt("Nouveau nom", library.name);
    if (!nextName || nextName.trim() === library.name) return;
    try {
      await privacyApi.renameLibrary(library.id, nextName.trim());
      await loadLibraries();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Renommage impossible.");
    }
  };

  if (profileLoading || phase.kind === "loading") {
    return (
      <div>
        <PageHeader title="🔒 Privé" />
        <p>Chargement…</p>
      </div>
    );
  }

  if (phase.kind === "denied") {
    return (
      <div>
        <PageHeader title="🔒 Privé" />
        {category && <PrivateCategoryBanner category={category} onChanged={refreshCategory} />}
        <EmptyState
          icon={<Lock size={32} />}
          title="Accès non autorisé"
          description="Ce profil ne dispose pas de la permission d'accéder à la catégorie Privé."
        />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="🔒 Privé"
        actions={
          phase.kind === "unlocked" ? (
            <div className="avm-private-actions">
              <Button variant="primary" onClick={() => setCreateOpen(true)}>
                <Plus size={16} /> Nouvelle bibliothèque
              </Button>
              <Button variant="ghost" onClick={handleLock}>
                <Lock size={16} /> Verrouiller
              </Button>
            </div>
          ) : undefined
        }
      />

      {error && <p className="avm-settings-error">{error}</p>}

      {category && <PrivateCategoryBanner category={category} onChanged={refreshCategory} />}

      {phase.kind === "setup" && (
        <VaultSetupPanel
          canManage={activeProfile?.can_manage_global_settings ?? false}
          onDone={refreshStatus}
        />
      )}

      {phase.kind === "unlock" && <VaultUnlockPanel onUnlocked={refreshStatus} />}

      {phase.kind === "unlocked" &&
        (phase.libraries.length === 0 ? (
          <EmptyState
            icon={<LockOpen size={32} />}
            title="Coffre déverrouillé — aucune bibliothèque"
            description="Créez votre première bibliothèque Images ou Vidéos privée."
          />
        ) : (
          <ul className="avm-private-library-list">
            {phase.libraries.map((library) => {
              const targetRoute =
                library.kind === "videos"
                  ? `/private/videos/${library.id}`
                  : `/private/images/${library.id}`;
              return (
                <li key={library.id} className="avm-private-library-list__item">
                  <button
                    type="button"
                    className="avm-private-library-list__switch"
                    onClick={() => navigate(targetRoute)}
                    title="Ouvrir"
                  >
                    {library.kind === "images" ? <ImageIcon size={20} /> : <Film size={20} />}
                    <span className="avm-private-library-list__name">{library.name}</span>
                  </button>
                  <div className="avm-private-library-list__actions">
                    <IconButton label="Renommer" onClick={() => handleRename(library)}>
                      <Pencil size={16} />
                    </IconButton>
                    <IconButton label="Supprimer" onClick={() => handleDelete(library)}>
                      <Trash2 size={16} />
                    </IconButton>
                  </div>
                </li>
              );
            })}
          </ul>
        ))}

      <CreatePrivateLibraryModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={loadLibraries}
      />
    </div>
  );
}

/** Premier réglage du PIN/mot de passe. Réservé à `can_manage_global_settings`
 * côté Rust (doc §6.4 bis) — reproduit ici pour éviter un aller-retour
 * inutile vers le backend, jamais comme seule vérification. */
function VaultSetupPanel({ canManage, onDone }: { canManage: boolean; onDone: () => void }) {
  const [secretKind, setSecretKind] = useState<SecretKind>("pin");
  const [secret, setSecret] = useState("");
  const [confirmSecret, setConfirmSecret] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!canManage) {
    return (
      <EmptyState
        icon={<Lock size={32} />}
        title="Coffre pas encore créé"
        description="Seul un profil disposant de la permission de gestion des paramètres globaux peut créer le coffre privé — demandez à un profil Administrateur de le faire depuis les Paramètres."
      />
    );
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (secret !== confirmSecret) {
      setError("Les deux saisies ne correspondent pas.");
      return;
    }
    if (!acknowledged) {
      setError("Vous devez confirmer avoir compris qu'un oubli rendra le coffre illisible.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await privacyApi.setupVault(secretKind, secret);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Création impossible.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="avm-vault-form">
      <p>
        Aucun coffre privé n'existe encore pour cette installation. Choisissez un PIN ou un mot de
        passe pour le créer — les fichiers vidéo et image d'origine resteront sur le disque, seuls
        le catalogue et les vignettes du coffre seront chiffrés.
      </p>

      <label className="avm-form-field">
        <span>Type de secret</span>
        <select value={secretKind} onChange={(event) => setSecretKind(event.target.value as SecretKind)}>
          <option value="pin">PIN (chiffres)</option>
          <option value="password">Mot de passe</option>
        </select>
      </label>

      <label className="avm-form-field">
        <span>{secretKind === "pin" ? "PIN (4 chiffres minimum)" : "Mot de passe (8 caractères minimum)"}</span>
        <input
          type="password"
          inputMode={secretKind === "pin" ? "numeric" : "text"}
          value={secret}
          onChange={(event) => setSecret(event.target.value)}
          autoFocus
        />
      </label>

      <label className="avm-form-field">
        <span>Confirmation</span>
        <input
          type="password"
          inputMode={secretKind === "pin" ? "numeric" : "text"}
          value={confirmSecret}
          onChange={(event) => setConfirmSecret(event.target.value)}
        />
      </label>

      <p className="avm-vault-warning">
        ⚠️ En cas d'oubli, il n'existe aucun moyen de récupérer ce PIN/mot de passe : le contenu du
        coffre deviendrait alors définitivement illisible.
      </p>
      <label className="avm-vault-acknowledge">
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={(event) => setAcknowledged(event.target.checked)}
        />
        J'ai compris et j'accepte ce risque.
      </label>

      {error && <p className="avm-settings-error">{error}</p>}

      <div className="avm-form-actions">
        <Button type="submit" variant="primary" disabled={submitting}>
          {submitting ? "Création…" : "Créer le coffre"}
        </Button>
      </div>
    </form>
  );
}

/**
 * Bannière de la catégorie Privé, personnalisable exactement comme celle
 * des quatre autres catégories (doc §6.6) — mécanisme déjà générique par
 * identifiant de catégorie depuis l'Étape 5 (`custom_images`), seul le
 * point d'entrée UI manquait jusqu'ici (`CategoryPage` n'est jamais rendue
 * pour Privé, `categoryRoute` l'aiguille toujours vers `/private`).
 * Volontairement pas de vérification de permission ici, pour rester
 * cohérent avec les autres catégories, dont la personnalisation n'est
 * elle-même soumise à aucune permission particulière.
 */
function PrivateCategoryBanner({ category, onChanged }: { category: Category; onChanged: () => void }) {
  return (
    <div className="avm-category-page__banner-wrap">
      <PersonalizableImage
        src={assetUrl(category.banner)}
        alt=""
        variant="banner"
        isCustom={category.banner_is_custom}
        onPick={async (sourcePath) => {
          await categoryApi.setBanner(category.id, sourcePath);
          onChanged();
        }}
        onReset={async () => {
          await categoryApi.setBanner(category.id, null);
          onChanged();
        }}
      />
    </div>
  );
}

function VaultUnlockPanel({ onUnlocked }: { onUnlocked: () => void }) {
  const [secret, setSecret] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await privacyApi.unlockVault(secret);
      setSecret("");
      onUnlocked();
    } catch (err) {
      setError(err instanceof Error ? err.message : "PIN ou mot de passe incorrect.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="avm-vault-form">
      <label className="avm-form-field">
        <span>PIN ou mot de passe</span>
        <input type="password" value={secret} onChange={(event) => setSecret(event.target.value)} autoFocus />
      </label>

      {error && <p className="avm-settings-error">{error}</p>}

      <div className="avm-form-actions">
        <Button type="submit" variant="primary" disabled={submitting}>
          {submitting ? "Déverrouillage…" : "Déverrouiller"}
        </Button>
      </div>
    </form>
  );
}
