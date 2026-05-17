/**
 * Frontend mirror of backend/services/progress_calculator.py.
 *
 * Kept in sync with docs/VALIDATION_RULES.md §UoM Types so the UI can show a
 * live "if you save this, your score becomes ..." preview without an extra
 * round-trip to the server. The server remains the authoritative scorer.
 */

import type { UoMType } from '@/types'

const TIMELINE_PENALTY_PER_DAY = 5.0

export interface ProgressResult {
  achievementPct: number | null
  goalScore: number | null
}

export function calculateAchievementPct(
  uomType: UoMType,
  target: unknown,
  actual: unknown,
): number | null {
  if (actual === null || actual === undefined || actual === '') return null

  switch (uomType) {
    case 'Max':
    case 'Numeric':
      return maxPct(target, actual)
    case 'Min':
      return minPct(target, actual)
    case 'Timeline':
      return timelinePct(target, actual)
    case 'Zero':
      return zeroPct(target, actual)
    default:
      return null
  }
}

export function calculateGoalScore(
  achievementPct: number | null,
  weightage: number,
): number | null {
  if (achievementPct === null) return null
  return round((achievementPct / 100) * weightage, 4)
}

export function calculateProgress(
  uomType: UoMType,
  target: unknown,
  actual: unknown,
  weightage: number,
): ProgressResult {
  const pct = calculateAchievementPct(uomType, target, actual)
  return { achievementPct: pct, goalScore: calculateGoalScore(pct, weightage) }
}

// ---------------------------------------------------------------------------
// Per-UoM formula helpers
// ---------------------------------------------------------------------------

function maxPct(target: unknown, actual: unknown): number | null {
  const t = toNumber(target)
  const a = toNumber(actual)
  if (t === null || a === null) return null
  if (t <= 0) return 0
  return clampPct((a / t) * 100)
}

function minPct(target: unknown, actual: unknown): number | null {
  const t = toNumber(target)
  const a = toNumber(actual)
  if (t === null || a === null) return null
  if (a <= 0) return 100
  if (t < 0) return 0
  return clampPct((t / a) * 100)
}

function timelinePct(target: unknown, actual: unknown): number | null {
  const td = toDate(target)
  const ad = toDate(actual)
  if (!td || !ad) return null
  const daysLate = Math.floor((ad.getTime() - td.getTime()) / (1000 * 60 * 60 * 24))
  if (daysLate <= 0) return 100
  return clampPct(100 - daysLate * TIMELINE_PENALTY_PER_DAY)
}

function zeroPct(target: unknown, actual: unknown): number | null {
  const t = String(target ?? '').trim().toLowerCase()
  const a = String(actual ?? '').trim().toLowerCase()
  if (!['yes', 'no'].includes(t) || !['yes', 'no'].includes(a)) return null
  return t === a ? 100 : 0
}

// ---------------------------------------------------------------------------
// Coercion helpers
// ---------------------------------------------------------------------------

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && !isNaN(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value)
    return isNaN(n) ? null : n
  }
  return null
}

function toDate(value: unknown): Date | null {
  if (value instanceof Date) return value
  if (typeof value !== 'string' || !value.trim()) return null
  const d = new Date(value)
  return isNaN(d.getTime()) ? null : d
}

function clampPct(v: number): number {
  return round(Math.max(0, Math.min(100, v)), 2)
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}
