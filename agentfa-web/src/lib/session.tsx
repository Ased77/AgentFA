import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api, ApiError, type OtpStart, type SessionUser } from "./account";

type SessionState = {
  user: SessionUser | null;
  loading: boolean;
  /** The session check failed for a reason that is not "signed out". */
  apiDown: boolean;
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
  const [apiDown, setApiDown] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const { user: me } = await api.me();
      setUser(me);
      setApiDown(false);
    } catch (err) {
      setUser(null);
      // A 401 is a normal answer: nobody is signed in. A network failure or a
      // 5xx is not, and the shell says so instead of quietly rendering a
      // logged-out site that looks like it works.
      setApiDown(err instanceof ApiError ? err.status >= 500 : true);
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
    () => ({ user, loading, apiDown, refresh, startOtp, verifyOtp, logout }),
    [user, loading, apiDown, refresh, startOtp, verifyOtp, logout],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside SessionProvider");
  return ctx;
}