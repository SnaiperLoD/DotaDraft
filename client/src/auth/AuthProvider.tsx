import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { AuthSessionResponse, AuthUserView } from 'shared';
import { api } from '../api/client';
import { setSubmitterToken } from '../utils/submitterToken';
import { resetVisitorId } from '../telemetry/ids';

interface AuthContextValue {
  user: AuthUserView | null;
  googleEnabled: boolean;
  ready: boolean;
  refresh: () => Promise<void>;
  applySession: (body: AuthSessionResponse) => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUserView | null>(null);
  const [googleEnabled, setGoogleEnabled] = useState(false);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    const me = await api.authMe();
    setUser(me.user);
    setGoogleEnabled(me.googleEnabled);
    if (me.ownerToken && setSubmitterToken(me.ownerToken)) resetVisitorId();
  }, []);

  useEffect(() => {
    let cancelled = false;
    void api
      .authMe()
      .then((me) => {
        if (cancelled) return;
        setUser(me.user);
        setGoogleEnabled(me.googleEnabled);
        if (me.ownerToken && setSubmitterToken(me.ownerToken)) resetVisitorId();
      })
      .catch(() => {
        if (!cancelled) setUser(null);
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const applySession = useCallback((body: AuthSessionResponse) => {
    if (setSubmitterToken(body.ownerToken)) resetVisitorId();
    setUser(body.user);
  }, []);

  const logout = useCallback(async () => {
    await api.authLogout();
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, googleEnabled, ready, refresh, applySession, logout }),
    [user, googleEnabled, ready, refresh, applySession, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth requires AuthProvider');
  return ctx;
}
