import "server-only";

/**
 * Founder-only gate for internal tooling (currently just /admin/metrics).
 * Hardcoded allowlist, not a role/flag on profiles — deliberately the
 * simplest possible check for a single-person audience. If this ever
 * needs to extend to a teammate, that's a real decision (probably a
 * profiles.is_admin column + its own RLS story), not a one-line add here.
 */
const ADMIN_USER_IDS = new Set<string>([
  "f3d54a29-ad84-4de5-a727-5af825be3206", // jordanperez1270@gmail.com
]);

export function isAdminUser(userId: string | null | undefined): boolean {
  return !!userId && ADMIN_USER_IDS.has(userId);
}
