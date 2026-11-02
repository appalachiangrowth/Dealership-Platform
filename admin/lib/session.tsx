'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, auth } from './api';

export interface Me {
  user: { id: string; kind: 'owner' | 'dealer'; login: string; name: string; email: string; role: string; perms: string[] };
  tenant: null | { id: string; name: string; logo: string; dealerCode: string; status: string; domains: string[]; siteUrl: string; features: Record<string, boolean> };
  support: { email?: string; phone?: string; note?: string };
  catalog: {
    permissions: Record<string, { label: string; desc: string }>;
    roles: Record<string, { label: string; desc: string; perms: string[] }>;
    customAllowed: string[];
  };
}

interface Ctx {
  me: Me | null;
  loading: boolean;
  reload: () => Promise<void>;
  logout: () => void;
  can: (...perms: string[]) => boolean;
}

const SessionContext = createContext<Ctx>({ me: null, loading: true, reload: async () => {}, logout: () => {}, can: () => false });

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  const reload = useCallback(async () => {
    if (!auth.token()) {
      setMe(null);
      setLoading(false);
      return;
    }
    try {
      setMe(await api<Me>('/auth/me'));
    } catch {
      setMe(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const logout = useCallback(() => {
    auth.clear();
    setMe(null);
    router.replace('/login');
  }, [router]);

  const can = useCallback((...perms: string[]) => !!me && perms.some((p) => me.user.perms.includes(p)), [me]);

  return <SessionContext.Provider value={{ me, loading, reload, logout, can }}>{children}</SessionContext.Provider>;
}

export const useSession = () => useContext(SessionContext);
