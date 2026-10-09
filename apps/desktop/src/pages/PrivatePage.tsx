import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import {
  ChevronLeft,
  ChevronRight,
  Film,
  FolderOpen,
  FolderPlus,
  Image as ImageIcon,
  LayoutGrid,
  Lock,
  LockOpen,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { Button, EmptyState, IconButton } from "@aethervault/ui-kit";
import type {
  Category,
  PlayableMedia,
  PrivateImageFile,
  PrivateLibrary,
  SecretKind,
} from "@aethervault/shared-types";
import { useActiveProfile } from "../profile/ActiveProfileContext";
import { categoryApi } from "../features/category/api";
import { privacyApi } from "../features/privacy/api";
import { CreatePrivateLibraryModal } from "../features/privacy/CreatePrivateLibraryModal";
import { privateImageApi } from "../features/privateImage/api";
import { PrivateThumbnailImage } from "../features/privateImage/PrivateThumbnailImage";
import { ImageViewer } from "../features/privateImage/ImageViewer";
import { useImageViewer } from "../features/privateImage/useImageViewer";
import { privateVideoApi } from "../features/privateVideo/api";
import { privateTagsApi, type PrivateTag } from "../features/privateTags/api";
import { usePlayer } from "../player/PlayerContext";
import { PersonalizableImage } from "../features/personalization/PersonalizableImage";
import { assetUrl } from "../lib/assetUrl";
import "./privateGallery.css";
import "./private-modern.css";

/* ------------------------------------------------------------------ */
/* 0.6.2 — Accueil unifié Privé (« VaultGallery »).                   */
/* 0.6.3 — tags, tri avancé, recherche ciblée, bannière compacte.     */
/* 0.6.5 — grille paginée 2 rangées × 11 colonnes avec flèches        */
/*         gauche/droite (perf sur gros coffres : 22 cartes montées   */
/*         au lieu de plusieurs centaines) ; actions Renommer/Retirer */
/*         au survol des cartes de la vue Albums (photos ET vidéos).  */
/* Sécurité inchangée : mêmes phases denied/setup/unlock/unlocked.    */
/* ------------------------------------------------------------------ */

type Phase =
  | { kind: "loading" }
  | { kind: "denied" }
  | { kind: "setup" }
  | { kind: "unlock" }
  | { kind: "unlocked" };

type View = "home" | "photos" | "videos" | "albums" | "libraries";
type Chip = "all" | "photos" | "videos" | "albums" | "recent";
type SortKey = "added_desc" | "added_asc" | "name_asc" | "name_desc" | "taken_desc";
type TagRef = { id: number; name: string };

/* 0.6.5 : pagination de la grille — 4 rangées × 5 colonnes = 20 cartes
   montées par page (assez grand pour être confortable, assez petit
   pour rester fluide sur un coffre volumineux). */
const PAGE_COLS = 5;
const PAGE_ROWS = 4;
const PAGE_SIZE = PAGE_COLS * PAGE_ROWS;

type PhotoExtra = {
  taken_at?: string | null;
  camera_model?: string | null;
  discovered_at?: string | null;
  modified_at?: string | null;
};
type VideoExtra = {
  discovered_at?: string | null;
  modified_at?: string | null;
};

interface PhotoItem {
  kind: "photo";
  id: number;
  libraryId: number;
  libraryName: string;
  folderId: number;
  albumName: string;
  fileName: string;
  available: boolean;
  takenAt: string | null;
  camera: string | null;
  addedAt: string | null;
  raw: PrivateImageFile;
}
interface VideoItem {
  kind: "video";
  id: number;
  libraryId: number;
  libraryName: string;
  folderId: number;
  fileName: string;
  path: string;
  available: boolean;
  addedAt: string | null;
}
interface AlbumItem {
  kind: "album";
  id: number;
  libraryId: number;
  libraryName: string;
  name: string;
  path: string;
  count: number;
  mediaType: "images" | "videos";
  coverFileId: number | null;
}
type GalleryItem = PhotoItem | VideoItem | AlbumItem;

interface GalleryData {
  libraries: PrivateLibrary[];
  photos: PhotoItem[];
  videos: VideoItem[];
  albums: AlbumItem[];
}

const EMPTY_DATA: GalleryData = { libraries: [], photos: [], videos: [], albums: [] };

function lastSegment(path: string): string {
  const normalized = path.replace(/[\\/]+$/, "");
  const parts = normalized.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}
function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
}
function itemName(item: GalleryItem): string {
  return item.kind === "album" ? item.name : item.fileName;
}
function itemAddedAt(item: GalleryItem): string | null {
  return item.kind === "album" ? null : item.addedAt;
}
function mediaKey(item: GalleryItem): string | null {
  if (item.kind === "photo") return `image:${item.id}`;
  if (item.kind === "video") return `video:${item.id}`;
  return null;
}
function itemTakenAt(item: GalleryItem): string | null {
  if (item.kind === "photo") return item.takenAt ?? item.addedAt;
  return itemAddedAt(item);
}

function sortItems(list: GalleryItem[], sortKey: SortKey): GalleryItem[] {
  const copy = [...list];
  switch (sortKey) {
    case "name_asc":
      return copy.sort((a, b) => itemName(a).localeCompare(itemName(b), "fr"));
    case "name_desc":
      return copy.sort((a, b) => itemName(b).localeCompare(itemName(a), "fr"));
    case "added_asc":
      return copy.sort((a, b) => (itemAddedAt(a) ?? "").localeCompare(itemAddedAt(b) ?? ""));
    case "taken_desc":
      return copy.sort((a, b) => (itemTakenAt(b) ?? "").localeCompare(itemTakenAt(a) ?? ""));
    default:
      return copy.sort((a, b) => (itemAddedAt(b) ?? "").localeCompare(itemAddedAt(a) ?? ""));
  }
}

export function PrivatePage() {
  const { activeProfile, loading: profileLoading } = useActiveProfile();
  const navigate = useNavigate();
  const viewer = useImageViewer();
  const { playQueue } = usePlayer();

  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [category, setCategory] = useState<Category | null>(null);
  const [view, setView] = useState<View>("home");
  const [chip, setChip] = useState<Chip>("all");
  const [sortKey, setSortKey] = useState<SortKey>("added_desc");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<GalleryItem | null>(null);
  const [data, setData] = useState<GalleryData>(EMPTY_DATA);
  const [loadingData, setLoadingData] = useState(false);
  const [allTags, setAllTags] = useState<PrivateTag[]>([]);
  const [tagsByMedia, setTagsByMedia] = useState<Record<string, TagRef[]>>({});
  const [selectedTagIds, setSelectedTagIds] = useState<number[]>([]);

  const refreshCategory = () => {
    categoryApi.list().then((categories) => {
      setCategory(categories.find((candidate) => candidate.key === "private") ?? null);
    });
  };

  useEffect(() => {
    refreshCategory();
  }, []);

  const refreshTags = useCallback(async (photos: PhotoItem[], videos: VideoItem[]) => {
    try {
      const [tags, imageLinks, videoLinks] = await Promise.all([
        privateTagsApi.list(),
        privateTagsApi.forMedia("image", photos.map((p) => p.id)),
        privateTagsApi.forMedia("video", videos.map((v) => v.id)),
      ]);
      setAllTags(tags);
      const map: Record<string, TagRef[]> = {};
      for (const l of imageLinks) {
        const key = `image:${l.media_id}`;
        (map[key] ??= []).push({ id: l.tag_id, name: l.name });
      }
      for (const l of videoLinks) {
        const key = `video:${l.media_id}`;
        (map[key] ??= []).push({ id: l.tag_id, name: l.name });
      }
      setTagsByMedia(map);
    } catch {
      /* tags indisponibles = fonctionnalité dégradée, pas bloquante */
    }
  }, []);

  const refreshData = useCallback(async () => {
    setLoadingData(true);
    try {
      const libraries = await privacyApi.listLibraries();
      const videoLibs = libraries.filter((l) => l.kind === "videos");
      const imageLibs = libraries.filter((l) => l.kind === "images");

      const videoChunks = await Promise.all(
        videoLibs.map(async (lib) => {
          const [files, folders] = await Promise.all([
            privateVideoApi.listFiles(lib.id),
            privateVideoApi.listFolders(lib.id),
          ]);
          const items = files.map((f): VideoItem => {
            const extra = f as unknown as VideoExtra & { folder_id?: number };
            return {
              kind: "video",
              id: f.id,
              libraryId: lib.id,
              libraryName: lib.name,
              folderId: extra.folder_id ?? -1,
              fileName: f.file_name,
              path: f.path,
              available: f.is_available,
              addedAt: extra.discovered_at ?? extra.modified_at ?? null,
            };
          });
          return { lib, folders, items };
        })
      );
      const videos = videoChunks.flatMap((c) => c.items);

      const folderChunks = await Promise.all(
        imageLibs.map(async (lib) => {
          const folders = await privateImageApi.listFolders(lib.id);
          return { lib, folders };
        })
      );

      const photoChunks = await Promise.all(
        folderChunks.flatMap(({ lib, folders }) =>
          folders.map(async (folder) => {
            const files = await privateImageApi.listFiles(folder.id);
            return { lib, folder, files };
          })
        )
      );

      const photos: PhotoItem[] = photoChunks.flatMap(({ lib, folder, files }) =>
        files.map((f): PhotoItem => {
          const extra = f as unknown as PhotoExtra;
          return {
            kind: "photo",
            id: f.id,
            libraryId: lib.id,
            libraryName: lib.name,
            folderId: folder.id,
            albumName: lastSegment(folder.path),
            fileName: f.file_name,
            available: f.is_available,
            takenAt: extra.taken_at ?? null,
            camera: extra.camera_model ?? null,
            addedAt: extra.discovered_at ?? extra.modified_at ?? null,
            raw: f,
          };
        })
      );

      const albums: AlbumItem[] = [
        ...folderChunks.flatMap(({ lib, folders }) =>
          folders.map((folder): AlbumItem => {
            const id = folder.id;
            return {
              kind: "album",
              id,
              libraryId: lib.id,
              libraryName: lib.name,
              name: lastSegment(folder.path),
              path: folder.path,
              count: photos.filter((p) => p.folderId === id).length,
              mediaType: "images",
              coverFileId: null,
            };
          })
        ),
        ...videoChunks.flatMap(({ lib, folders }) =>
          folders.map((folder): AlbumItem => {
            const inFolder = videos.filter((v) => v.folderId === folder.id);
            const cover = inFolder.find((v) => v.available) ?? null;
            return {
              kind: "album",
              id: folder.id,
              libraryId: lib.id,
              libraryName: lib.name,
              name: lastSegment(folder.path),
              path: folder.path,
              count: inFolder.length,
              mediaType: "videos",
              coverFileId: cover ? cover.id : null,
            };
          })
        ),
      ];

      setData({ libraries, photos, videos, albums });
      setError(null);
      void refreshTags(photos, videos);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Chargement impossible.");
    } finally {
      setLoadingData(false);
    }
  }, [refreshTags]);

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
        setPhase({ kind: "unlocked" });
        void refreshData();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Chargement impossible.");
    }
  };

  useEffect(() => {
    if (profileLoading) return;
    setError(null);
    refreshStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileLoading, activeProfile?.id]);

  /* 0.6.5 : tout changement de contexte de filtrage revient en page 1. */
  useEffect(() => {
    setPage(0);
  }, [view, chip, query, sortKey, selectedTagIds]);

  const handleLock = async () => {
    try {
      await privacyApi.lockVault();
      setSelected(null);
      setData(EMPTY_DATA);
      setAllTags([]);
      setTagsByMedia({});
      setSelectedTagIds([]);
      setPhase({ kind: "unlock" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verrouillage impossible.");
    }
  };

  const handleRenameLibrary = async (library: PrivateLibrary) => {
    const nextName = window.prompt("Nouveau nom", library.name);
    if (!nextName || nextName.trim() === library.name) return;
    try {
      await privacyApi.renameLibrary(library.id, nextName.trim());
      void refreshData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Renommage impossible.");
    }
  };

  const handleDeleteLibrary = async (library: PrivateLibrary) => {
    if (
      !window.confirm(
        `Supprimer la bibliothèque privée « ${library.name} » ? Les fichiers présents sur le disque ne seront jamais supprimés.`
      )
    ) {
      return;
    }
    try {
      await privacyApi.removeLibrary(library.id);
      void refreshData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Suppression impossible.");
    }
  };

  const handleSetCover = async (photo: PhotoItem) => {
    try {
      await privateImageApi.setAlbumCover(photo.folderId, photo.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible de changer la couverture.");
    }
  };

  /* ----- 0.6.3 : tags ----- */
  const handleAddTag = async (item: GalleryItem, name: string) => {
    const kind = item.kind === "photo" ? "image" : item.kind === "video" ? "video" : null;
    if (!kind) return;
    try {
      await privateTagsApi.add(kind, item.id, name);
      await refreshTags(data.photos, data.videos);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ajout du tag impossible.");
    }
  };
  const handleRemoveTag = async (item: GalleryItem, tagId: number) => {
    const kind = item.kind === "photo" ? "image" : item.kind === "video" ? "video" : null;
    if (!kind) return;
    try {
      await privateTagsApi.remove(kind, item.id, tagId);
      await refreshTags(data.photos, data.videos);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Retrait du tag impossible.");
    }
  };

  /* ----- 0.6.5 : albums (photos ET vidéos) depuis la vue Albums ----- */
  const handleRenameAlbum = async (album: AlbumItem) => {
    const next = window.prompt("Nouveau nom de l'album", album.name);
    if (!next || next.trim() === album.name) return;
    try {
      if (album.mediaType === "videos") {
        await privateVideoApi.renameFolder(album.id, next.trim());
      } else {
        await privateImageApi.renameFolder(album.id, next.trim());
      }
      await refreshData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Renommage de l'album impossible.");
    }
  };

  const handleDeleteAlbum = async (album: AlbumItem) => {
    if (
      !window.confirm(
        `Retirer l'album « ${album.name} » du coffre ? Les fichiers présents sur le disque ne seront jamais supprimés.`
      )
    ) {
      return;
    }
    try {
      if (album.mediaType === "videos") {
        await privateVideoApi.removeFolder(album.id);
      } else {
        await privateImageApi.removeFolder(album.id);
      }
      if (selected !== null && selected.kind === "album" && selected.id === album.id) {
        setSelected(null);
      }
      await refreshData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Suppression de l'album impossible.");
    }
  };

  const openItem = useCallback(
    (item: GalleryItem) => {
      if (item.kind === "photo") {
        const available = data.photos.filter((p) => p.available);
        const idx = available.findIndex((p) => p.id === item.id);
        if (idx === -1) return;
        viewer.open(available.map((p) => p.raw), idx);
      } else if (item.kind === "video") {
        const playable = data.videos.filter((v) => v.available);
        const idx = playable.findIndex((v) => v.id === item.id);
        if (idx === -1) return;
        const medias: PlayableMedia[] = playable.map((v) => ({
          id: v.id,
          title: v.fileName,
          path: v.path,
          libraryId: v.libraryId,
          isPrivate: true,
        }));
        playQueue(medias, idx);
      } else if (item.mediaType === "videos") {
        navigate(`/private/videos/${item.libraryId}?folder=${item.id}`);
      } else {
        navigate(`/private/images/${item.libraryId}/albums/${item.id}`);
      }
    },
    [data, navigate, playQueue, viewer]
  );

  /* ----- Filtrage : vue + chips + tags + recherche + tri ----- */
  const filtered = useMemo(() => {
    let items: GalleryItem[];
    if (view === "photos") items = data.photos;
    else if (view === "videos") items = data.videos;
    else if (view === "albums") items = data.albums;
    else if (view === "libraries") items = [];
    else {
      if (chip === "photos") items = data.photos;
      else if (chip === "videos") items = data.videos;
      else if (chip === "albums") items = data.albums;
      else if (chip === "recent") {
        items = [...data.photos, ...data.videos]
          .sort((a, b) => (itemAddedAt(b) ?? "").localeCompare(itemAddedAt(a) ?? ""))
          .slice(0, 24);
      } else items = [...data.photos, ...data.videos, ...data.albums];
    }
    if (selectedTagIds.length > 0) {
      const sel = new Set(selectedTagIds);
      items = items.filter((i) => {
        const key = mediaKey(i);
        if (!key) return false;
        return (tagsByMedia[key] ?? []).some((t) => sel.has(t.id));
      });
    }
    const q = query.trim().toLowerCase();
    if (q) {
      items = items.filter((i) => {
        if (itemName(i).toLowerCase().includes(q)) return true;
        const key = mediaKey(i);
        return (key ? tagsByMedia[key] ?? [] : []).some((t) => t.name.toLowerCase().includes(q));
      });
    }
    return sortItems(items, sortKey);
  }, [data, view, chip, query, sortKey, selectedTagIds, tagsByMedia]);

  /* ----- 0.6.5 : pagination 2 × 11 ----- */
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageItems = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  const recentStrip = useMemo(
    () =>
      [...data.photos, ...data.videos]
        .sort((a, b) => (itemAddedAt(b) ?? "").localeCompare(itemAddedAt(a) ?? ""))
        .slice(0, 8),
    [data]
  );

  /* ----- Phases hors coffre déverrouillé ----- */
  if (profileLoading || phase.kind === "loading") {
    return (
      <div className="pvg-gate">
        <div className="pvg-gate__card">
          <span className="pvg-gate__icon"><Lock size={22} /></span>
          <h2 style={{ margin: "0 0 6px", fontSize: 22, fontWeight: 800 }}>Privé</h2>
          <p style={{ color: "var(--color-text-muted, #94a3b8)" }}>Chargement…</p>
        </div>
      </div>
    );
  }
  if (phase.kind === "denied") {
    return (
      <div className="pvg-gate">
        <div className="pvg-gate__card">
          <span className="pvg-gate__icon"><Lock size={22} /></span>
          <h2 style={{ margin: "0 0 6px", fontSize: 22, fontWeight: 800 }}>Accès non autorisé</h2>
          <p style={{ color: "var(--color-text-muted, #94a3b8)" }}>
            Ce profil ne dispose pas de la permission d'accéder à la catégorie Privé.
          </p>
          {category && <PrivateCategoryBanner category={category} onChanged={refreshCategory} />}
        </div>
      </div>
    );
  }
  if (phase.kind === "setup") {
    return (
      <div className="pvg-gate">
        <div className="pvg-gate__card">
          <span className="pvg-gate__icon"><Lock size={22} /></span>
          <VaultSetupPanel
            canManage={activeProfile?.can_manage_global_settings ?? false}
            onDone={refreshStatus}
          />
        </div>
      </div>
    );
  }
  if (phase.kind === "unlock") {
    return (
      <div className="pvg-gate">
        <div className="pvg-gate__card">
          <span className="pvg-gate__icon"><Lock size={22} /></span>
          <VaultUnlockPanel onUnlocked={refreshStatus} />
        </div>
      </div>
    );
  }

  const navItems: { key: View; icon: typeof Film; label: string; count: number | null }[] = [
    { key: "home", icon: LayoutGrid, label: "Galerie", count: data.photos.length + data.videos.length + data.albums.length },
    { key: "photos", icon: ImageIcon, label: "Photos", count: data.photos.length },
    { key: "videos", icon: Film, label: "Vidéos", count: data.videos.length },
    { key: "albums", icon: FolderOpen, label: "Albums", count: data.albums.length },
    { key: "libraries", icon: FolderPlus, label: "Bibliothèques", count: data.libraries.length },
  ];

  return (
    <div className={selected ? "pvg-shell pvg-shell--details" : "pvg-shell"}>
      <aside className="pvg-sidebar">
        <div className="pvg-brand">
          <span className="pvg-brand__logo"><Lock size={17} /></span>
          <div>
            <div className="pvg-brand__title">VaultGallery</div>
            <div className="pvg-brand__sub">Espace privé chiffré</div>
          </div>
        </div>
        <div className="pvg-nav-label">BIBLIOTHÈQUE</div>
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = view === item.key;
          return (
            <button
              key={item.key}
              type="button"
              className={`pvg-nav-item${active ? " pvg-nav-item--active" : ""}`}
              onClick={() => {
                setView(item.key);
                setSelected(null);
              }}
            >
              <Icon size={17} />
              <span>{item.label}</span>
              {item.count !== null && <span className="pvg-nav-item__count">{item.count}</span>}
            </button>
          );
        })}
        <div className="pvg-security">
          <div className="pvg-security__head">
            <span className="pvg-security__icon"><ShieldCheck size={15} /></span>
            <div>
              <div className="pvg-security__title">Protection active</div>
              <div className="pvg-security__sub">Chiffrement du coffre déverrouillé</div>
            </div>
          </div>
          <div className="pvg-security__stats">
            {data.photos.length} photos • {data.videos.length} vidéos • {data.albums.length} albums
          </div>
          <Button variant="ghost" onClick={handleLock}>
            <Lock size={14} /> Verrouiller
          </Button>
        </div>
      </aside>

      <div className="pvg-main">
        <div className="pvg-topbar">
          <label className="pvg-search">
            <Search size={16} />
            <input
              placeholder="Rechercher par nom ou par tag…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <span className="pvg-badge-e2ee">
            <ShieldCheck size={15} /> Chiffré E2EE
          </span>
        </div>

        {view === "home" && category && (
          <div className="pvg-banner pvg-banner--compact">
            <PersonalizableImage
              src={assetUrl(category.banner)}
              alt=""
              variant="banner"
              isCustom={category.banner_is_custom}
              onPick={async (sourcePath) => {
                await categoryApi.setBanner(category.id, sourcePath);
                refreshCategory();
              }}
              onReset={async () => {
                await categoryApi.setBanner(category.id, null);
                refreshCategory();
              }}
            />
          </div>
        )}

        <div className="pvg-header">
          <div>
            <h1 className="pvg-header__title">
              {view === "home" && "Galerie privée"}
              {view === "photos" && "Photos"}
              {view === "videos" && "Vidéos"}
              {view === "albums" && "Albums"}
              {view === "libraries" && "Bibliothèques"}
            </h1>
            <div className="pvg-header__sub">
              {loadingData
                ? "Chargement…"
                : `${data.photos.length + data.videos.length} éléments • ${data.albums.length} albums • ${allTags.length} tag(s)`}
            </div>
          </div>
          <div className="pvg-header__actions">
            <button type="button" className="pvg-btn-accent" onClick={() => setCreateOpen(true)}>
              <Plus size={16} /> Nouvelle bibliothèque
            </button>
          </div>
        </div>

        {error && <p className="avm-settings-error">{error}</p>}

        {view !== "libraries" && (
          <div className="pvg-toolbar">
            {view === "home" && (
              <div className="pvg-chips">
                {(
                  [
                    ["all", "Tous"],
                    ["photos", "Photos"],
                    ["videos", "Vidéos"],
                    ["albums", "Albums"],
                    ["recent", "Récents"],
                  ] as [Chip, string][]
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    className={`pvg-chip${chip === key ? " pvg-chip--active" : ""}`}
                    onClick={() => setChip(key)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
            <label className="pvg-sort">
              <span>Trier</span>
              <select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)}>
                <option value="added_desc">Ajout récent</option>
                <option value="added_asc">Ajout ancien</option>
                <option value="name_asc">Nom A → Z</option>
                <option value="name_desc">Nom Z → A</option>
                <option value="taken_desc">Date de prise</option>
              </select>
            </label>
          </div>
        )}

        {view !== "libraries" && allTags.length > 0 && (
          <div className="pvg-tagrow">
            <span className="pvg-tagrow__label">Tags</span>
            {allTags.map((tag) => (
              <button
                key={tag.id}
                type="button"
                className={`pvg-tag${selectedTagIds.includes(tag.id) ? " pvg-tag--active" : ""}`}
                title={`${tag.count} média(s) tagué(s)`}
                onClick={() =>
                  setSelectedTagIds((prev) =>
                    prev.includes(tag.id) ? prev.filter((x) => x !== tag.id) : [...prev, tag.id]
                  )
                }
              >
                #{tag.name} <span className="pvg-tag__count">{tag.count}</span>
              </button>
            ))}
            {selectedTagIds.length > 0 && (
              <button type="button" className="pvg-tag pvg-tag--clear" onClick={() => setSelectedTagIds([])}>
                Effacer
              </button>
            )}
          </div>
        )}

        {view === "libraries" ? (
          <LibrariesView
            data={data}
            onOpen={(lib) =>
              navigate(lib.kind === "videos" ? `/private/videos/${lib.id}` : `/private/images/${lib.id}`)
            }
            onRename={handleRenameLibrary}
            onDelete={handleDeleteLibrary}
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<LockOpen size={32} />}
            title="Rien à afficher"
            description="Ajoutez une bibliothèque privée puis lancez un scan pour remplir votre galerie."
          />
        ) : (
          <>
            {/* 0.6.5 : pager 2 × 11 avec flèches. */}
            <div className="pvg-pager">
              <button
                type="button"
                className="pvg-pager__btn"
                disabled={safePage === 0}
                onClick={() => setPage(safePage - 1)}
                title="Médias précédents"
              >
                <ChevronLeft size={16} />
              </button>
              <span className="pvg-pager__label">
                Page {safePage + 1}/{pageCount} — {filtered.length} média(s)
              </span>
              <button
                type="button"
                className="pvg-pager__btn"
                disabled={safePage >= pageCount - 1}
                onClick={() => setPage(safePage + 1)}
                title="Médias suivants"
              >
                <ChevronRight size={16} />
              </button>
            </div>

            <div className="pvg-grid pvg-grid--paged">
              {pageItems.map((item) => {
                const album = item.kind === "album" ? item : null;
                const key = mediaKey(item);
                return (
                  <GalleryCard
                    key={`${item.kind}-${item.id}`}
                    item={item}
                    tags={key ? tagsByMedia[key] ?? [] : []}
                    selected={selected !== null && selected.kind === item.kind && selected.id === item.id}
                    onSelect={() => setSelected(item)}
                    onOpen={() => openItem(item)}
                    onRename={album ? () => void handleRenameAlbum(album) : undefined}
                    onDelete={album ? () => void handleDeleteAlbum(album) : undefined}
                  />
                );
              })}
            </div>

            {view === "home" && recentStrip.length > 0 && (
              <>
                <h3 className="pvg-strip-title">Ajoutés récemment</h3>
                <div className="pvg-strip">
                  {recentStrip.map((item) => (
                    <button
                      key={`strip-${item.kind}-${item.id}`}
                      type="button"
                      className="pvg-strip__item"
                      onClick={() => openItem(item)}
                      title={itemName(item)}
                    >
                      <CardThumb item={item} />
                      <span className="pvg-strip__label">{itemName(item)}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>

      {selected && (
        <DetailsPanel
          item={selected}
          tags={(() => {
            const key = mediaKey(selected);
            return key ? tagsByMedia[key] ?? [] : [];
          })()}
          onClose={() => setSelected(null)}
          onOpen={() => openItem(selected)}
          onSetCover={selected.kind === "photo" ? () => handleSetCover(selected) : undefined}
          onAddTag={selected.kind === "album" ? undefined : (name) => void handleAddTag(selected, name)}
          onRemoveTag={selected.kind === "album" ? undefined : (tagId) => void handleRemoveTag(selected, tagId)}
        />
      )}

      <CreatePrivateLibraryModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => void refreshData()}
      />
      <ImageViewer controls={viewer} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sous-composants                                                     */
/* ------------------------------------------------------------------ */

function CardThumb({ item }: { item: GalleryItem }) {
  if (item.kind === "photo") {
    return (
      <PrivateThumbnailImage
        fetchThumbnail={() => privateImageApi.getThumbnail(item.id)}
        alt={item.fileName}
        className="pvg-card__thumb"
      />
    );
  }
  if (item.kind === "video") {
    return <VideoThumb fileId={item.id} />;
  }
  if (item.mediaType === "videos") {
    if (item.coverFileId === null) {
      return (
        <span className="pvg-card__placeholder">
          <FolderOpen size={26} />
        </span>
      );
    }
    return <VideoThumb fileId={item.coverFileId} />;
  }
  return (
    <PrivateThumbnailImage
      fetchThumbnail={() => privateImageApi.getAlbumCover(item.id)}
      alt={item.name}
      className="pvg-card__thumb"
    />
  );
}

function VideoThumb({ fileId }: { fileId: number }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    privateVideoApi
      .thumbnail(fileId)
      .then((b64) => {
        if (!cancelled && b64) setSrc(`data:image/jpeg;base64,${b64}`);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [fileId]);
  return <img src={src ?? undefined} alt="" />;
}

function GalleryCard({
  item,
  tags,
  selected,
  onSelect,
  onOpen,
  onRename,
  onDelete,
}: {
  item: GalleryItem;
  tags: TagRef[];
  selected: boolean;
  onSelect: () => void;
  onOpen: () => void;
  onRename?: () => void;
  onDelete?: () => void;
}) {
  const sub =
    item.kind === "photo"
      ? `Photo • ${item.albumName} • ${fmtDate(item.takenAt ?? item.addedAt)}`
      : item.kind === "video"
        ? `Vidéo • ${item.libraryName} • ${fmtDate(item.addedAt)}`
        : item.mediaType === "videos"
          ? `Album vidéo • ${item.count} élément(s)`
          : `Album • ${item.count} élément(s)`;
  return (
    <button
      type="button"
      className={`pvg-card${selected ? " pvg-card--selected" : ""}`}
      onClick={onSelect}
      onDoubleClick={onOpen}
      title={`${itemName(item)} — clic : détails, double-clic : ouvrir`}
    >
      <div className="pvg-card__media">
        <CardThumb item={item} />
        <div className="pvg-card__shade" />
        {item.kind === "video" && (
          <span className="pvg-card__play">
            <span><Film size={18} /></span>
          </span>
        )}
        {item.kind === "album" && <span className="pvg-card__count">{item.count}</span>}
        {item.kind !== "album" && !item.available && (
          <span className="pvg-card__badge">Indisponible</span>
        )}
        {/* 0.6.5 : actions album au survol (bas droite, le compteur
            occupant le coin haut droit). */}
        {(onRename || onDelete) && (
          <span className="pvg-card__hover-actions" onClick={(e) => e.stopPropagation()}>
            {onRename && (
              <span
                className="pvg-iconbtn-dark"
                role="button"
                title="Renommer l'album"
                onClick={(e) => {
                  e.stopPropagation();
                  onRename();
                }}
              >
                <Pencil size={14} />
              </span>
            )}
            {onDelete && (
              <span
                className="pvg-iconbtn-dark"
                role="button"
                title="Retirer l'album du coffre"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete();
                }}
              >
                <Trash2 size={14} />
              </span>
            )}
          </span>
        )}
      </div>
      <div className="pvg-card__meta">
        <span className="pvg-card__title">{itemName(item)}</span>
        <span className="pvg-card__sub">{sub}</span>
        {tags.length > 0 && (
          <span className="pvg-card__tags">
            {tags.slice(0, 2).map((t) => (
              <span key={t.id} className="pvg-minitag">#{t.name}</span>
            ))}
            {tags.length > 2 && <span className="pvg-minitag">+{tags.length - 2}</span>}
          </span>
        )}
      </div>
    </button>
  );
}

function TagInput({ onAdd }: { onAdd: (name: string) => void }) {
  const [value, setValue] = useState("");
  const submit = () => {
    const name = value.trim();
    if (!name) return;
    onAdd(name);
    setValue("");
  };
  return (
    <div className="pvg-taginput">
      <input
        placeholder="Ajouter un tag…"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          }
        }}
      />
      <button type="button" onClick={submit} title="Ajouter ce tag">+</button>
    </div>
  );
}

function DetailsPanel({
  item,
  tags,
  onClose,
  onOpen,
  onSetCover,
  onAddTag,
  onRemoveTag,
}: {
  item: GalleryItem;
  tags: TagRef[];
  onClose: () => void;
  onOpen: () => void;
  onSetCover?: () => void;
  onAddTag?: (name: string) => void;
  onRemoveTag?: (tagId: number) => void;
}) {
  const rows: [string, string][] =
    item.kind === "photo"
      ? [
          ["Type", "Photo"],
          ["Album", item.albumName],
          ["Bibliothèque", item.libraryName],
          ["Prise le", fmtDate(item.takenAt)],
          ["Appareil", item.camera ?? "—"],
          ["Ajoutée le", fmtDate(item.addedAt)],
        ]
      : item.kind === "video"
        ? [
            ["Type", "Vidéo"],
            ["Bibliothèque", item.libraryName],
            ["Ajoutée le", fmtDate(item.addedAt)],
            ["Statut", item.available ? "Disponible" : "Indisponible"],
          ]
        : [
            ["Type", item.mediaType === "videos" ? "Album vidéo" : "Album"],
            ["Bibliothèque", item.libraryName],
            ["Éléments", String(item.count)],
            ["Chemin", item.path],
          ];
  return (
    <aside className="pvg-details">
      <div className="pvg-details__head">
        <strong style={{ fontSize: 13, letterSpacing: 0.6, textTransform: "uppercase", color: "var(--color-text-muted, #64748b)" }}>
          Détails
        </strong>
        <IconButton label="Fermer" onClick={onClose}>
          <X size={16} />
        </IconButton>
      </div>
      <div className="pvg-details__preview">
        <CardThumb item={item} />
      </div>
      <div>
        <div className="pvg-details__name">{itemName(item)}</div>
        <div className="pvg-details__sub">
          {item.kind === "album" ? `${item.count} élément(s)` : item.fileName}
        </div>
      </div>
      <dl style={{ margin: 0 }}>
        {rows.map(([k, v]) => (
          <div className="pvg-details__row" key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      {onAddTag && onRemoveTag && (
        <>
          <div className="pvg-details__tags">
            {tags.length === 0 && (
              <span className="pvg-details__sub">Aucun tag — ajoutez-en un ci-dessous.</span>
            )}
            {tags.map((t) => (
              <span key={t.id} className="pvg-tag">
                #{t.name}
                <button
                  type="button"
                  className="pvg-tag__x"
                  title="Retirer ce tag"
                  onClick={() => onRemoveTag(t.id)}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
          <TagInput onAdd={onAddTag} />
        </>
      )}
      <div className="pvg-details__secure">
        <span className="pvg-security__icon"><ShieldCheck size={15} /></span>
        <div>
          <div className="pvg-details__secure-title">Fichier protégé</div>
          <div className="pvg-details__secure-sub">Catalogue chiffré — coffre privé actif</div>
        </div>
      </div>
      <div className="pvg-details__actions">
        <Button variant="primary" onClick={onOpen}>
          {item.kind === "video" ? "Lire" : "Ouvrir"}
        </Button>
        {onSetCover && (
          <IconButton label="Définir comme couverture de l'album" onClick={onSetCover}>
            <Star size={16} />
          </IconButton>
        )}
      </div>
    </aside>
  );
}

function LibrariesView({
  data,
  onOpen,
  onRename,
  onDelete,
}: {
  data: GalleryData;
  onOpen: (lib: PrivateLibrary) => void;
  onRename: (lib: PrivateLibrary) => void;
  onDelete: (lib: PrivateLibrary) => void;
}) {
  if (data.libraries.length === 0) {
    return (
      <EmptyState
        icon={<LockOpen size={32} />}
        title="Coffre déverrouillé — aucune bibliothèque"
        description="Créez votre première bibliothèque Images ou Vidéos privée."
      />
    );
  }
  return (
    <ul className="pvg-lib-list">
      {data.libraries.map((lib) => {
        const isVideos = lib.kind === "videos";
        const count = isVideos
          ? data.videos.filter((v) => v.libraryId === lib.id).length
          : data.photos.filter((p) => p.libraryId === lib.id).length;
        return (
          <li key={lib.id} className="pvg-lib-item">
            <span className="pvg-lib-item__icon">
              {isVideos ? <Film size={17} /> : <ImageIcon size={17} />}
            </span>
            <div style={{ minWidth: 0 }}>
              <div className="pvg-lib-item__name">{lib.name}</div>
              <div className="pvg-lib-item__sub">
                {isVideos ? "Vidéos" : "Images"} • {count} fichier(s)
              </div>
            </div>
            <div className="pvg-lib-item__actions">
              <Button variant="secondary" onClick={() => onOpen(lib)}>Ouvrir</Button>
              <IconButton label="Renommer" onClick={() => onRename(lib)}>
                <Pencil size={15} />
              </IconButton>
              <IconButton label="Supprimer" onClick={() => onDelete(lib)}>
                <Trash2 size={15} />
              </IconButton>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/* ------------------------------------------------------------------ */
/* Phases setup / unlock / bannière                                    */
/* ------------------------------------------------------------------ */

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
      <h2 style={{ margin: "0 0 10px", fontSize: 22, fontWeight: 800 }}>Coffre verrouillé</h2>
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

function PrivateCategoryBanner({ category, onChanged }: { category: Category; onChanged: () => void }) {
  return (
    <div className="avm-category-page__banner-wrap" style={{ marginTop: 16 }}>
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