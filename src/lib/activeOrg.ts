/**
 * The active-plan context, per identity-access-model-design.md §2.3 — a
 * request header, not shared server-side state, so two tabs on different
 * plans never fight over which one is "current." sessionStorage (not
 * localStorage) is what makes it per-tab: a fresh tab starts with no
 * stored choice and AuthContext resolves one on hydrate.
 */
export const ACTIVE_ORG_STORAGE_KEY = 'companion_active_org_id'

export function getActiveOrgId(): string | null {
  return sessionStorage.getItem(ACTIVE_ORG_STORAGE_KEY)
}
