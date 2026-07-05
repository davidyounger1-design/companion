import { supabase } from './supabase'

/**
 * If the signed-in session still needs a second factor before it's fully
 * trusted (aal2), returns the verified TOTP factor id to challenge.
 * Returns null if no second factor is required.
 */
export async function checkMfaRequired(): Promise<string | null> {
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
  if (error || !data) return null
  if (data.nextLevel === 'aal2' && data.currentLevel !== 'aal2') {
    const { data: factors } = await supabase.auth.mfa.listFactors()
    const totp = factors?.totp?.find((f) => f.status === 'verified')
    return totp?.id ?? null
  }
  return null
}

export async function getVerifiedTotpFactor() {
  const { data } = await supabase.auth.mfa.listFactors()
  return data?.totp?.find((f) => f.status === 'verified') ?? null
}
