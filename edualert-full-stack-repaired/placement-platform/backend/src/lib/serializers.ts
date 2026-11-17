/**
 * Single source of truth for which user columns may ever leave the server.
 * NEVER use `user: true` / `include: { user: true }` — that would return `passwordHash`.
 */
export const publicUserSelect = { id: true, firstName: true, lastName: true, email: true } as const;
/** Same but without the email (for data shown to other students / mentors). */
export const nameOnlyUserSelect = { id: true, firstName: true, lastName: true } as const;
export const authUserSelect = {
  id: true, email: true, role: true, firstName: true, lastName: true, isActive: true, tokenVersion: true,
} as const;

export const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
