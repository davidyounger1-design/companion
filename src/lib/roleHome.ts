/** True for any worker-flavoured base role, including the transitional
 * trusted_support_worker (retired as a base role in favour of a
 * coordinator-defined sub-role, but still live in the DB until that
 * migration's flip runs). Centralised so the two role strings can't
 * drift out of sync across the many call sites that need this check. */
export function isWorkerRole(role?: string | null): boolean {
  return role === 'support_worker' || role === 'trusted_support_worker'
}

/** The in-app landing route for a given role + org type. Shared by the
 * post-auth redirect (App's RequireNoAuth) and the PWA launch redirect
 * (Landing) so they can't drift apart. */
export function roleHome(role?: string | null, orgType?: string | null): string {
  if (isWorkerRole(role)) return '/worker'
  if (role === 'family' || role === 'recipient') return '/family'
  if (role === 'therapist') return '/therapist'
  if (role === 'coordinator' && orgType === 'family') return '/family'
  return '/dashboard'
}
