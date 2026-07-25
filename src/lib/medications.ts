import type { MedicationRoute, MedicationLogStatus } from '../types/database'

export const ROUTE_LABEL: Record<MedicationRoute, string> = {
  oral: 'Oral',
  topical: 'Topical',
  inhaled: 'Inhaled',
  injected: 'Injected',
  ophthalmic: 'Ophthalmic',
  otic: 'Otic',
  nasal: 'Nasal',
  sublingual: 'Sublingual',
  transdermal: 'Transdermal',
  other: 'Other',
}

export const STATUS_LABEL: Record<MedicationLogStatus, string> = {
  taken: 'Taken',
  refused: 'Refused',
  deferred: 'Deferred',
  missed: 'Missed',
}

export const STATUS_COLOR: Record<MedicationLogStatus, { fg: string; bg: string }> = {
  taken:   { fg: '#2d5a3d', bg: 'color-mix(in srgb, #2d5a3d 15%, transparent)' },
  refused: { fg: '#c0392b', bg: 'color-mix(in srgb, #c0392b 15%, transparent)' },
  deferred:{ fg: '#b8860b', bg: 'color-mix(in srgb, #b8860b 15%, transparent)' },
  missed:  { fg: '#c0392b', bg: 'color-mix(in srgb, #c0392b 15%, transparent)' },
}

export function formatMedicationDate(iso: string) {
  return new Date(iso).toLocaleString('en-AU', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}
