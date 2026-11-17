import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import { API_BASE } from './config';

export const tokens = {
  get access() { return localStorage.getItem('access_token'); },
  get refresh() { return localStorage.getItem('refresh_token'); },
  set(access: string, refresh?: string) {
    localStorage.setItem('access_token', access);
    if (refresh) localStorage.setItem('refresh_token', refresh);
  },
  clear() {
    ['access_token', 'refresh_token', 'user'].forEach((k) => localStorage.removeItem(k));
  },
};

const api = axios.create({ baseURL: API_BASE, timeout: 20000 });

api.interceptors.request.use((config) => {
  const token = tokens.access;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Many requests can hit an expired token at once; they must share ONE refresh call.
let refreshing: Promise<string> | null = null;
function refreshAccessToken(): Promise<string> {
  refreshing ??= axios
    .post(`${API_BASE}/auth/refresh`, { refreshToken: tokens.refresh }, { timeout: 20000 })
    .then((r) => { tokens.set(r.data.token); return r.data.token as string; })
    .finally(() => { refreshing = null; });
  return refreshing;
}

type Retryable = InternalAxiosRequestConfig & { _retry?: boolean };

api.interceptors.response.use(
  (res) => res,
  async (error: AxiosError) => {
    const original = error.config as Retryable | undefined;
    const isAuthCall = original?.url?.startsWith('/auth/');
    // Only refresh for a real session (not for failed logins) and only once per request.
    if (error.response?.status === 401 && original && !original._retry && !isAuthCall && tokens.refresh) {
      original._retry = true;
      try {
        const token = await refreshAccessToken();
        original.headers.Authorization = `Bearer ${token}`;
        return api(original);
      } catch {
        tokens.clear();
        window.location.assign('/login');
      }
    }
    return Promise.reject(error);
  }
);

/** Human-readable message for any failure: server message, offline/unreachable server, or a fallback. */
export function errorMessage(err: unknown, fallback = 'Something went wrong. Please try again.'): string {
  const e = err as AxiosError<{ error?: string }>;
  if (e?.response) return e.response.data?.error ?? `${fallback} (HTTP ${e.response.status})`;
  if (e?.code === 'ECONNABORTED') return 'The server took too long to respond.';
  if (e?.request) return 'Cannot reach the server. Check your connection and that the backend is running.';
  return fallback;
}

export default api;
