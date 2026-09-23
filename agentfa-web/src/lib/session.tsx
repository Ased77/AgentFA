import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api, type OtpStart, type SessionUser } from "./account";

type SessionState = {
  user: SessionUser | null;
  loading: boolean;
  refresh: () => Promise<void>;
  /** Ask for a login code. Creates no account on its own. */
  startOtp: (phone: string) => Promise<OtpStart>;
  /** Verify the code: signs in, creating the account on a first login. */
  verifyOtp: (phone: string, code: string) => Promise<{ isNewUser: boolean }>;
  logout: () => Promise<void>;
};

const SessionContext = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const { user: me } = await api.me();
      setUser(me);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const startOtp = useCallback((phone: string) => api.startOtp(phone), []);

  const verifyOtp = useCallback(async (phone: string, code: string) => {
    const { user: me, isNewUser } = await api.verifyOtp(phone, code);
    setUser(me);
    return { isNewUser };
  }, []);

  const logout = useCallback(async () => {
    await api.logout();
    setUser(null);
  }, []);

  const value = useMemo<SessionState>(
    () => ({ user, loading, refresh, startOtp, verifyOtp, logout }),
    [user, loading, refresh, startOtp, verifyOtp, logout],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside SessionProvider");
  return ctx;
}