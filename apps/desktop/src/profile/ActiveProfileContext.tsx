import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Profile } from "@aethervault/shared-types";
import { profileApi } from "../features/profile/api";

/**
 * Miroir côté frontend de l'autorité côté Rust (`AppState::active_profile_id`,
 * doc §6.5) : ce contexte ne fait que refléter l'état serveur, il ne le
 * remplace jamais. `switchTo` appelle toujours la commande Tauri d'abord ;
 * l'état local n'est mis à jour qu'après confirmation du backend — jamais
 * de façon optimiste, pour ne jamais afficher un profil actif différent de
 * celui réellement utilisé par les commandes suivantes.
 */
interface ActiveProfileContextValue {
  activeProfile: Profile | null;
  profiles: Profile[];
  loading: boolean;
  refresh: () => Promise<void>;
  switchTo: (profileId: number) => Promise<void>;
}

const ActiveProfileContext = createContext<ActiveProfileContextValue | null>(null);

export function ActiveProfileProvider({ children }: { children: ReactNode }) {
  const [activeProfile, setActiveProfile] = useState<Profile | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const [active, list] = await Promise.all([profileApi.getActive(), profileApi.list()]);
    setActiveProfile(active);
    setProfiles(list);
  }, []);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  const switchTo = useCallback(async (profileId: number) => {
    const profile = await profileApi.switchActive(profileId);
    setActiveProfile(profile);
  }, []);

  const value = useMemo(
    () => ({ activeProfile, profiles, loading, refresh, switchTo }),
    [activeProfile, profiles, loading, refresh, switchTo]
  );

  return <ActiveProfileContext.Provider value={value}>{children}</ActiveProfileContext.Provider>;
}

export function useActiveProfile(): ActiveProfileContextValue {
  const ctx = useContext(ActiveProfileContext);
  if (!ctx) {
    throw new Error("useActiveProfile doit être utilisé à l'intérieur d'un ActiveProfileProvider.");
  }
  return ctx;
}
