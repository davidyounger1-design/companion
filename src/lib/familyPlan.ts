import { supabase } from './supabase'
import { checkPlan } from './planCheck'
import type { BillingStatus } from '../types/database'

const CHECKOUT_URL = 'https://myappbuddy.com.au/api/v1/checkout'
export const FREE_FAMILY_PLAN = 'companion_family'

const BILLING_FROM_MAB: Record<string, BillingStatus> = {
  active: 'active', trialing: 'trial', trial: 'trial',
  past_due: 'past_due', paused: 'past_due', canceled: 'cancelled', cancelled: 'cancelled',
}

/**
 * Pull the org's CURRENT subscription from MAB and mirror it onto the org row,
 * so the app reflects upgrades/downgrades/cancellations even if the MAB webhook
 * (sync-subscription) never fired. If MAB has no subscription for this account
 * yet, register the free family plan so entitlements can resolve.
 *
 * Only the coordinator (account owner) should call this — checkPlan resolves by
 * the caller's own email, which is the subscription owner.
 */
export async function syncFamilySubscription(params: {
  orgId: string
  email: string
  name: string
}): Promise<boolean> {
  try {
    const info = await checkPlan()
    if (info.subscription_id) {
      const { error } = await supabase
        .from('organisations')
        .update({
          ...(info.plan && { plan: info.plan }),
          billing_status: BILLING_FROM_MAB[info.status ?? ''] ?? 'trial',
          myappbuddy_subscription_id: info.subscription_id,
          ...(info.account_id && { myappbuddy_account_id: info.account_id }),
        })
        .eq('id', params.orgId)
      return !error
    }
    // No subscription in MAB yet — create the free family one.
    await ensureFreeFamilySubscription(params)
    return true
  } catch {
    return false
  }
}

/**
 * Register the free family plan as a real MAB subscription, so its entitlements
 * (retention_<n>, etc.) resolve through check-features exactly like any paid
 * plan — free is just its price. Stores the returned subscription/account ids
 * on the org.
 *
 * Best-effort and safe to call more than once: MAB keys on email, so a repeat
 * call for an existing subscriber is a no-op there; and we only run it when the
 * org has no subscription id yet. A failure just means entitlements won't
 * resolve until it's retried — it never blocks family setup.
 */
export async function ensureFreeFamilySubscription(params: {
  email: string
  name: string
  orgId: string
}): Promise<void> {
  try {
    const res = await fetch(CHECKOUT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: params.email,
        name: params.name || params.email.split('@')[0],
        plan_id: FREE_FAMILY_PLAN,
        interval: 'month',
        trial: false,
        currency: 'AUD',
      }),
    })
    if (!res.ok) return
    const json = await res.json()
    const subId: string | undefined = json?.subscription?.id
    const accountId: string | undefined = json?.account?.id
    if (!subId && !accountId) return
    await supabase
      .from('organisations')
      .update({
        ...(subId && { myappbuddy_subscription_id: subId }),
        ...(accountId && { myappbuddy_account_id: accountId }),
        billing_status: 'active',
      })
      .eq('id', params.orgId)
  } catch {
    // best-effort — never block the family experience on this
  }
}
