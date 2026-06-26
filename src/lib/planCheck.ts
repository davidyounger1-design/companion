import { supabase } from './supabase'

export interface PlanInfo {
  plan: string | null
  status: string | null
  subscription_id: string | null
  account_id: string | null
}

export async function checkPlan(): Promise<PlanInfo> {
  try {
    const { data, error } = await supabase.functions.invoke('check-plan')
    if (error) return { plan: null, status: null, subscription_id: null, account_id: null }
    return data ?? { plan: null, status: null, subscription_id: null, account_id: null }
  } catch {
    return { plan: null, status: null, subscription_id: null, account_id: null }
  }
}

export const FAMILY_PLAN = 'companion_family'

export function isFamilyPlan(plan: string | null): boolean {
  return plan === FAMILY_PLAN
}
