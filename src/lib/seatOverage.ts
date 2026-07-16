import { supabase } from './supabase'
import type { Organisation } from '../types/database'

/** True when an org has more active participants than its current plan
 * allows — e.g. right after downgrading from Team to Family without anyone
 * having chosen which participants to keep. Only plans that meter on
 * 'participants' with a known seat count can be over; worker-metered or
 * unlimited plans never are. */
export async function isOverParticipantSeats(org: Organisation | null): Promise<boolean> {
  if (!org || org.metered_axis !== 'participants' || org.seats == null) return false
  const { count } = await supabase
    .from('clients')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', org.id)
    .eq('active', true)
  return (count ?? 0) > org.seats
}

export const CHOOSE_PARTICIPANTS_PATH = '/choose-participants'
