import { supabase } from './supabase'
import type { Role } from '../types/database'

export async function signUp(email: string, password: string, fullName: string) {
  const { data, error } = await supabase.auth.signUp({ email, password })
  if (error) throw error
  if (!data.user) throw new Error('No user returned from sign-up')

  // Create the profile immediately — coordinator role, no org yet
  const { error: profileError } = await supabase.from('profiles').insert({
    id: data.user.id,
    full_name: fullName,
    role: 'coordinator' as Role,
    org_id: null,
  })
  if (profileError) throw profileError

  return data
}

export async function signIn(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw error
  return data
}

export async function signOut() {
  const { error } = await supabase.auth.signOut()
  if (error) throw error
}

export async function getProfile(userId: string) {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single()
  if (error) throw error
  return data
}

export async function createOrganisation(
  userId: string,
  name: string,
  state: string,
  services: string[],
) {
  // Create the org
  const { data: org, error: orgError } = await supabase
    .from('organisations')
    .insert({ name, state, services, plan: 'trial', billing_status: 'trial' })
    .select()
    .single()
  if (orgError) throw orgError

  // Link the coordinator's profile to the org
  const { error: profileError } = await supabase
    .from('profiles')
    .update({ org_id: org.id })
    .eq('id', userId)
  if (profileError) throw profileError

  // Create default org settings
  await supabase.from('org_settings').insert({ org_id: org.id })

  return org
}
