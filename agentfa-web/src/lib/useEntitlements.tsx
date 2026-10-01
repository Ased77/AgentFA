import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api } from "./account";
import { useSession } from "./session";

/**
 * What the signed-in user owns.
 *
 * This used to be a hook every `AgentCard` called on its own: the marketplace
 * renders the whole catalog, so opening it fired one `GET /api/agents/owned` per
 * card — hundreds of identical requests, and a marketplace that flickered as
 * they landed. Ownership is one fact about the session, so it is fetched once
 * here and shared.
 */
type EntitlementsState = {
  owned: string[];
  loading: boolean;
  refresh: () => Promise<void>;
  /** True when the user owns this agent id. */
  owns: (id: string) => boolean;
};

const EntitlementsContext = createContext<EntitlementsState | null>(null);

export function EntitlementsProvider({ children }: { children: ReactNode }) {
  const { user } = useSession();
  const [owned, setOwned] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!user) {
      setOwned([]);
      return;
    }
    setLoading(true);
    try {
      const { owned: ids } = await api.ownedAgents();
      setOwned(ids);
    } catch {
      setOwned([]);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo<EntitlementsState>(
    () => ({ owned, loading, refresh, owns: (id: string) => owned.includes(id) }),
    [owned, loading, refresh],
  );

  return <EntitlementsContext.Provider value={value}>{children}</EntitlementsContext.Provider>;
}

export function useEntitlements(): EntitlementsState {
  const ctx = useContext(EntitlementsContext);
  if (!ctx) throw new Error("useEntitlements must be used inside EntitlementsProvider");
  return ctx;
}
