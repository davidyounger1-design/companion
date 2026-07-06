/** The in-app landing route for a given role + org type. Shared by the
 * post-auth redirect (App's RequireNoAuth) and the PWA launch redirect
 * (Landing) so they can't drift apart. */
export function roleHome(role?: string | null, orgType?: string | null): string {
  if (role === 'support_worker' || role === 'trusted_support_worker') return '/worker'
  if (role === 'family' || role === 'recipient') return '/family'
  if (role === 'therapist') return '/therapist'
  if (role === 'coordinator' && orgType === 'family') return '/family'
  return '/dashboard'
}
