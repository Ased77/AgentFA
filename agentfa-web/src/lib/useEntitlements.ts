import { useCallback, useEffect, useState } from "react";
import { api } from "./account";
import { useSession } from "./session";

export function useEntitlements() {
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

  return { owned, loading, refresh, owns: (id: string) => owned.includes(id) };
}