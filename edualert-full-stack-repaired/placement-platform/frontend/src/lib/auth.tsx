import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import api, { tokens } from './api';

export type Role = 'STUDENT' | 'TPC_OFFICER' | 'MENTOR' | 'ADMIN';
export interface User { id: string; email: string; role: Role; firstName: string; lastName: string }

export const roleLabel: Record<Role, string> = { STUDENT: 'Student', TPC_OFFICER: 'TPC Officer', MENTOR: 'Mentor', ADMIN: 'Admin' };
export const isStaff = (r?: Role) => r === 'TPC_OFFICER' || r === 'ADMIN';

interface AuthCtx { user: User | null; ready: boolean; signIn: (email: string, password: string) => Promise<User>; signOut: () => Promise<void> }
const Ctx = createContext<AuthCtx>(null!);
export const useAuth = () => useContext(Ctx);

function stored(): User | null {
  try { return JSON.parse(localStorage.getItem('user') ?? 'null'); } catch { return null; }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => (tokens.access ? stored() : null));
  const [ready, setReady] = useState(!tokens.access);

  // On load, confirm the stored session is still valid and pick up the CURRENT role from the server.
  useEffect(() => {
    if (!tokens.access) return;
    api.get('/auth/me')
      .then((r) => { localStorage.setItem('user', JSON.stringify(r.data)); setUser(r.data); })
      .catch((e) => { if (e?.response?.status === 401) { tokens.clear(); setUser(null); } })
      .finally(() => setReady(true));
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const { data } = await api.post('/auth/login', { email, password });
    tokens.set(data.token, data.refreshToken);
    localStorage.setItem('user', JSON.stringify(data.user));
    setUser(data.user);
    return data.user as User;
  }, []);

  const signOut = useCallback(async () => {
    try { await api.post('/auth/logout'); } catch { /* token may already be invalid — still clear locally */ }
    tokens.clear();
    setUser(null);
  }, []);

  const value = useMemo(() => ({ user, ready, signIn, signOut }), [user, ready, signIn, signOut]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function RequireAuth({ children, roles }: { children: ReactNode; roles?: Role[] }) {
  const { user, ready } = useAuth();
  if (!ready) return <div className="p-6">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/" replace />;
  return <>{children}</>;
}
