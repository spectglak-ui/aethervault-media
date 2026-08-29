import { createHashRouter } from "react-router-dom";
import { AppShell } from "./layout/AppShell";
import { HomePage } from "./pages/HomePage";
import { CategoryPage } from "./pages/CategoryPage";
import { TitleDetailPage } from "./pages/TitleDetailPage";
import { SeasonEpisodesPage } from "./pages/SeasonEpisodesPage";
import { PrivatePage } from "./pages/PrivatePage";
import { PrivateAlbumPage } from "./pages/PrivateAlbumPage";
import { PrivateImageLibraryPage } from "./pages/PrivateImageLibraryPage";
import { PrivateVideoLibraryPage } from "./pages/PrivateVideoLibraryPage";
import { LibraryPage } from "./pages/LibraryPage";
import { LibraryDetailPage } from "./pages/LibraryDetailPage";
import { ExplorePage } from "./pages/ExplorePage";
import { CollectionsPage } from "./pages/CollectionsPage";
import { SharePage } from "./pages/SharePage";
import { StatsPage } from "./pages/StatsPage";
import { ProfilesPage } from "./pages/ProfilesPage";
import { SettingsPage } from "./pages/SettingsPage";
import { ExperimentalPlayerPage } from "./pages/ExperimentalPlayerPage";

/**
 * Routeur "hash" (#/...) plutôt que "browser" : évite d'avoir à configurer
 * un fallback serveur pour les routes profondes dans une application desktop
 * packagée, où il n'y a pas de vrai serveur HTTP derrière chaque chemin.
 *
 * Depuis l'Étape 4, la navigation principale suit la hiérarchie de la doc
 * §6.7 (Accueil → Catégorie → Titre → Saison → Épisode) plutôt que l'ancien
 * `/library` générique — conservé sous `/libraries` comme vue
 * d'administration transverse (voir `LibraryPage`), plus comme point
 * d'entrée principal.
 */
export const router = createHashRouter([
  {
    element: <AppShell />,
    children: [
      { path: "/", element: <HomePage /> },
      { path: "/category/:key", element: <CategoryPage /> },
      { path: "/category/:key/title/:titleId", element: <TitleDetailPage /> },
      { path: "/category/:key/title/:titleId/season/:seasonId", element: <SeasonEpisodesPage /> },
      { path: "/private", element: <PrivatePage /> },
      { path: "/private/videos/:id", element: <PrivateVideoLibraryPage /> },
      { path: "/private/images/:id", element: <PrivateImageLibraryPage /> },
      { path: "/private/images/:libraryId/albums/:folderId", element: <PrivateAlbumPage /> },
      { path: "/libraries", element: <LibraryPage /> },
      { path: "/libraries/:id", element: <LibraryDetailPage /> },
      { path: "/explore", element: <ExplorePage /> },
      { path: "/collections", element: <CollectionsPage /> },
	  { path: "/share", element: <SharePage /> },
	  { path: "/stats", element: <StatsPage /> },
      { path: "/profiles", element: <ProfilesPage /> },
      { path: "/settings", element: <SettingsPage /> },
      {
        path: "/experimental-player",
        element: <ExperimentalPlayerPage />,
      },
    ],
  },
]);
