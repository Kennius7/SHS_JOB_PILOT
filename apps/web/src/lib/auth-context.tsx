'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, setAccessToken } from './api';

export interface AuthUser {
  id: string;
  email: string;
  role: 'USER' | 'ADMIN';
  isAdmin: boolean;
}

interface MeResponse {
  id: string;
  email: string;
  role: 'USER' | 'ADMIN';
  isAdmin: boolean;
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);
const USER_STORAGE_KEY = 'shs.user';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const stored = typeof window !== 'undefined' ? localStorage.getItem(USER_STORAGE_KEY) : null;
    if (stored) setUser(JSON.parse(stored));

    (async () => {
      try {
        const res = await api.post<{ accessToken: string }>('/v1/auth/refresh', {});
        setAccessToken(res.accessToken);
        try {
          const me = await api.get<MeResponse>('/v1/users/me');
          const nextUser: AuthUser = {
            id: me.id,
            email: me.email,
            role: me.role,
            isAdmin: me.isAdmin,
          };
          setUser(nextUser);
          localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(nextUser));
        } catch {
          // Keep the cached user if /me cannot be refreshed.
        }
      } catch {
        // No valid refresh; user stays logged out.
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function login(email: string, password: string) {
    const res = await api.post<{ accessToken: string; user: AuthUser }>('/v1/auth/login', {
      email,
      password,
    });
    setAccessToken(res.accessToken);
    setUser(res.user);
    localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(res.user));
  }

  async function register(email: string, password: string) {
    await api.post('/v1/auth/register', { email, password });
    await login(email, password);
  }

  async function logout() {
    await api.post('/v1/auth/logout', {}).catch(() => {});
    setAccessToken(null);
    setUser(null);
    localStorage.removeItem(USER_STORAGE_KEY);
    router.push('/');
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
