import { supabase } from './supabase'
import type { Role } from '../types/database'

function supabaseMessage(err: unknown): string {
  if (!err) return 'Unknown error'
  if (typeof err === 'object' && 'message' in err) return String((err as { message: unknown }).message)
  if (err instanceof Error) return err.message
  return String(err)
}

export async function signUp(email: string, password: string, fullName: string) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName } },   // stored in auth.users.raw_user_meta_data
  })
  if (error) throw new Error(supabaseMessage(error))
  if (!data.user) throw new Error('No user returned from sign-up')

  // If a session was returned (email confirmation is OFF), create the profile now.
  // If confirmation is ON, the profile is created in AuthContext on first sign-in.
  if (data.session) {
    await ensureProfile(data.user.id, fullName)
  }

  return data
}

export async function signIn(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw new Error(supabaseMessage(error))
  return data
}

export async function signOut() {
  const { error } = await supabase.auth.signOut()
  if (error) throw new Error(supabaseMessage(error))
}

export async function getProfile(userId: string) {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single()
  if (error) throw new Error(supabaseMessage(error))
  return data
}

/** Creates a profile row if one doesn't already exist for this user. */
export async function ensureProfile(userId: string, fullName: string) {
  const { data: existing } = await supabase
    .from('profiles')
    .select('id')
    .eq('id', userId)
    .maybeSingle()

  if (existing) return   // already created

  const { error } = await supabase.from('profiles').insert({
    id: userId,
    full_name: fullName,
    role: 'coordinator' as Role,
    org_id: null,
  })
  // 409 = profile already exists (race condition or stale RLS read) — safe to ignore
  if (error && error.code !== '23505') throw new Error(supabaseMessage(error))
}

export async function createOrganisation(
  userId: string,
  name: string,
  state: string,
  services: string[],
) {
  // Generate the UUID client-side so we never need to .select() after insert.
  // Doing .insert().select() would trigger the SELECT policy before the profile
  // has an org_id set, causing an RLS denial (chicken-and-egg).
  const orgId = crypto.randomUUID()

  const { error: orgError } = await supabase
    .from('organisations')
    .insert({ id: orgId, name, state, services, plan: 'trial', billing_status: 'trial' })
  if (orgError) throw new Error(supabaseMessage(orgError))

  // Set the profile's org_id first so my_org_id() returns correctly for subsequent queries.
  const { error: profileError } = await supabase
    .from('profiles')
    .update({ org_id: orgId })
    .eq('id', userId)
  if (profileError) throw new Error(supabaseMessage(profileError))

  await supabase.from('org_settings').insert({ org_id: orgId })

  return { id: orgId }
}

export async function resetPassword(email: string) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/reset-password`,
  })
  if (error) throw new Error(supabaseMessage(error))
}

export async function updatePassword(newPassword: string) {
  const { error } = await supabase.auth.updateUser({ password: newPassword })
  if (error) throw new Error(supabaseMessage(error))
}
