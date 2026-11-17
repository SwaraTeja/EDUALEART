/**
 * The ONE place the API location is decided. Every request (axios calls, health check, AI streaming)
 * goes through API_BASE, so a deployment can never end up with some calls missing the `/api` prefix.
 *
 *  - VITE_API_URL unset  → "/api"  (Vite dev server proxies it to the backend; in production put a reverse proxy in front)
 *  - VITE_API_URL=http://localhost:4000 → "http://localhost:4000/api" (cross-origin; backend FRONTEND_URL must match this page's origin)
 */
const origin = (import.meta.env.VITE_API_URL ?? '').trim().replace(/\/+$/, '').replace(/\/api$/, '');
export const API_BASE = origin ? `${origin}/api` : '/api';
