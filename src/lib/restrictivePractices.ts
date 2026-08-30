import type { RestrictivePracticeType } from '../types/database'

export const RP_TYPE_LABEL: Record<RestrictivePracticeType, string> = {
  chemical: 'Chemical',
  environmental: 'Environmental',
  mechanical: 'Mechanical',
  physical: 'Physical',
  seclusion: 'Seclusion',
}

export function formatRpDate(iso: string) {
  return new Date(iso).toLocaleString('en-AU', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}
