import type { GoalStatus, ProgressRating } from '../types/database'

export const GOAL_STATUS_LABEL: Record<GoalStatus, string> = {
  active: 'Active', achieved: 'Achieved', discontinued: 'Discontinued',
}

export const GOAL_STATUS_COLOR: Record<GoalStatus, { fg: string; bg: string }> = {
  active:       { fg: 'var(--color-primary-deep)', bg: 'color-mix(in srgb, var(--color-primary) 15%, transparent)' },
  achieved:     { fg: '#2e9e6b',                    bg: 'color-mix(in srgb, #2e9e6b 15%, transparent)' },
  discontinued: { fg: 'var(--color-muted)',         bg: 'color-mix(in srgb, var(--color-muted) 15%, transparent)' },
}

export const RATING_LABEL: Record<ProgressRating, string> = {
  regressed: 'Regressed', no_change: 'No change', some_progress: 'Some progress',
  good_progress: 'Good progress', achieved: 'Goal achieved',
}

export const RATING_EMOJI: Record<ProgressRating, string> = {
  regressed: '📉', no_change: '➡️', some_progress: '📈', good_progress: '🌟', achieved: '🏆',
}

export function formatGoalDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function formatProgressDate(iso: string) {
  return new Date(iso).toLocaleString('en-AU', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}
