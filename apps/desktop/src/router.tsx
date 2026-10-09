import { TvPage } from "./pages/TvPage";
import { TvWatchPage } from "./pages/TvWatchPage";
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
import { VaultTubePage } from "./pages/VaultTubePage";
import { AetherFyGatewayPage } from "./pages/AetherFyGatewayPage";
import { VaultTubeVideosPage } from "./pages/VaultTubeVideosPage";
import { VaultTubePlaylistsPage } from "./pages/VaultTubePlaylistsPage";
import { VaultTubePlaylistPreviewPage } from "./pages/VaultTubePlaylistPreviewPage";
import { VaultTubeUserPlaylistPage } from "./pages/VaultTubeUserPlaylistPage";
import { PersonPage } from "./pages/PersonPage";
import { ReadingHomePage } from "./pages/ReadingHomePage";
import { ReadingLibraryPage } from "./pages/ReadingLibraryPage";
import { ReadingBookPage } from "./pages/ReadingBookPage";
import { AetherFyShell } from "./features/aetherfy/AetherFyShell";
import { AetherFyHomePage } from "./features/aetherfy/AetherFyHomePage";
import { AetherFyWatchPage } from "./features/aetherfy/AetherFyWatchPage";
import { AetherFySubscriptionPage } from "./features/aetherfy/AetherFySubscriptionPage";
import { AetherFySearchPage } from "./features/aetherfy/AetherFySearchPage";
import {
  AetherFyTrendingPage,
  AetherFyLivePage,
  AetherFyGamingPage,
  AetherFyMusicPage,
  AetherFySubscriptionsPage,
  AetherFyLibraryPage,
  AetherFyUserPlaylistPage,
  AetherFyHistoryPage,
  AetherFyWatchLaterPage,
  AetherFyLikedPage,
} from "./features/aetherfy/AetherFyPages";
import "./features/aetherfy/aetherfy.css";

/**
Routeur "hash" (#/...) plutôt que "browser" : évite d'avoir à configurer
un fallback serveur pour les routes profondes dans une application desktop
packagée, où il n'y a pas de vrai serveur HTTP derrière chaque chemin.
Depuis l'Étape 4, la navigation principale suit la hiérarchie de la doc
§6.7 (Accueil → Catégorie → Titre → Saison → Épisode) plutôt que l'ancien
`/library` générique — conservé sous `/libraries` comme vue
d'administration transverse (voir `LibraryPage`), plus comme point
d'entrée principal.
0.7.2 : le lecteur de livre (`/reading/book/:id`) est déclaré HORS de
`AppShell` : route immersive plein écran, sans sidebar ni TopBar (le
fond animé global `AppBackdrop` reste visible — il est monté au-dessus
du routeur dans `App.tsx`). L'import mort `BookReaderPage` a été
supprimé (fichier absent du dossier `features/reader`).
*/
export const router = createHashRouter([
  {
    element: <AppShell />,
    children: [
	  { path: "/tv", element: <TvPage /> },
      { path: "/tv/watch/:id", element: <TvWatchPage /> },
      { path: "/", element: <HomePage /> },
      { path: "/reading", element: <ReadingHomePage /> },
      { path: "/reading/library/:id", element: <ReadingLibraryPage /> },
      { path: "/category/:key", element: <CategoryPage /> },
      { path: "/category/:key/title/:titleId", element: <TitleDetailPage /> },
      {
        path: "/category/:key/title/:titleId/season/:seasonId",
        element: <SeasonEpisodesPage />,
      },
      { path: "/private", element: <PrivatePage /> },
      { path: "/private/videos/:id", element: <PrivateVideoLibraryPage /> },
      { path: "/private/images/:id", element: <PrivateImageLibraryPage /> },
      // Tuile « AetherFy » de l'accueil : page de transition Vidéo / Musique.
      // `VaultTubePage` reste utilisée par `/vaulttube/video` et `/vaulttube/music`.
      { path: "/vaulttube", element: <AetherFyGatewayPage /> },
      { path: "/vaulttube/video", element: <VaultTubePage defaultMode="video" /> },
      { path: "/vaulttube/music", element: <VaultTubePage defaultMode="audio" /> },
      { path: "/vaulttube/:id", element: <VaultTubeVideosPage /> },
      { path: "/vaulttube/playlist/:playlistId", element: <VaultTubePlaylistPreviewPage /> },
      { path: "/vaulttube/:id/playlists", element: <VaultTubePlaylistsPage /> },
      { path: "/vaulttube/myplaylist/:id", element: <VaultTubeUserPlaylistPage /> },
      {
        path: "/private/images/:libraryId/albums/:folderId",
        element: <PrivateAlbumPage />,
      },
      { path: "/libraries", element: <LibraryPage /> },
      { path: "/libraries/:id", element: <LibraryDetailPage /> },
      { path: "/explore", element: <ExplorePage /> },
      { path: "/collections", element: <CollectionsPage /> },
      { path: "/share", element: <SharePage /> },
      { path: "/stats", element: <StatsPage /> },
      { path: "/profiles", element: <ProfilesPage /> },
      { path: "/settings", element: <SettingsPage /> },
      { path: "/person/:personId", element: <PersonPage /> },
      {
        path: "/experimental-player",
        element: <ExperimentalPlayerPage />,
      },
      {
        path: "/aetherfy",
        element: <AetherFyShell />,
        children: [
          { index: true, element: <AetherFyHomePage /> },
          { path: "watch/:videoId", element: <AetherFyWatchPage /> },
          { path: "subscription/:id", element: <AetherFySubscriptionPage /> },
          { path: "trending", element: <AetherFyTrendingPage /> },
          { path: "subscriptions", element: <AetherFySubscriptionsPage /> },
          { path: "library", element: <AetherFyLibraryPage /> },
          { path: "playlist/:id", element: <AetherFyUserPlaylistPage /> },
          { path: "history", element: <AetherFyHistoryPage /> },
          { path: "watch-later", element: <AetherFyWatchLaterPage /> },
          { path: "liked", element: <AetherFyLikedPage /> },
          { path: "music", element: <AetherFyMusicPage /> },
          { path: "gaming", element: <AetherFyGamingPage /> },
          { path: "live", element: <AetherFyLivePage /> },
          { path: "search", element: <AetherFySearchPage /> },
        ],
      },
    ],
  },
  // 0.7.2 : lecteur de livre immersif — rendu HORS AppShell : ni sidebar,
  // ni TopBar, ni aucun élément de l'interface générale ne transparaît
  // sous la scène de lecture transparente.
  { path: "/reading/book/:id", element: <ReadingBookPage /> },
]);