/**
 * Admin access allowlist.
 *
 * Reaching the admin surface requires BOTH the `ADMIN` role and an email that
 * appears in the configured allowlist. The allowlist is read from
 * `ADMIN_EMAILS` (comma-separated), falling back to the single `ADMIN_EMAIL`.
 *
 * When neither is configured the allowlist is empty and admin access is denied
 * for everyone — the allowlist is the source of truth for who may reach admin.
 */
export function getAdminEmails(): string[] {
  const raw = process.env.ADMIN_EMAILS ?? process.env.ADMIN_EMAIL ?? '';
  return raw
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export function isAllowlistedAdmin(email?: string | null, role?: string | null): boolean {
  if (role !== 'ADMIN' || !email) return false;
  return getAdminEmails().includes(email.trim().toLowerCase());
}
