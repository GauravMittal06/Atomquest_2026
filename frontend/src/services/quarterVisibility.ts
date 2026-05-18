/**
 * Frontend Quarter Visibility Resolution Service
 * 
 * This module provides centralized quarter visibility resolution matching
 * backend services/quarter_visibility.py logic for consistent frontend behavior.
 * 
 * Key responsibilities:
 * - Determine quarter visibility based on window state and snapshot existence
 * - Resolve score source priority: frozen snapshot > live scoring > null
 * - Ensure historical quarters remain visible after mock-date rollback
 * - Prevent future quarter leakage
 * 
 * Score Priority Rules:
 * 1. Frozen snapshot score (highest priority - mock-date independent)
 * 2. Active live score (for current quarter only)
 * 3. "—" (null display for hidden/unavailable quarters)
 */

import type { PeriodLabel, CycleStatus } from '@/types'
import api from '@/lib/api'

export enum QuarterState {
  FUTURE = 'FUTURE',                    // Not yet reached, window unopened → HIDDEN
  ACTIVE = 'ACTIVE',                    // Current window open → VISIBLE with LIVE scoring
  CLOSED_NO_SNAPSHOT = 'CLOSED_NO_SNAPSHOT', // Window closed, no snapshot → HIDDEN
  FROZEN = 'FROZEN'                     // Snapshot exists → VISIBLE with SNAPSHOT
}

export interface QuarterVisibility {
  quarter_label: string
  state: QuarterState
  is_visible: boolean
  use_live_scoring: boolean
  use_snapshot: boolean
  window_is_open: boolean
  snapshot_exists: boolean
}

export interface QuarterVisibilitySet {
  quarters: QuarterVisibility[]
  active_quarter: string | null
  visible_quarter_labels: string[]
  frozen_quarter_labels: string[]
  live_quarter_labels: string[]
}

export interface QuarterSnapshot {
  quarter_label: string
  overall_score: number
  goals: Array<{
    goal_id: string
    goal_score: number
    achievement_pct: number
    actual_value: any
  }>
  frozen_at: string
  frozen_by: string
  source_check_in_count: number
  locked: boolean
}

// Quarter order for determining "future" vs "past"
const QUARTER_ORDER: PeriodLabel[] = ['Q1', 'Q2', 'Q3', 'Q4']

/**
 * Determine the canonical state for a single quarter.
 * Mirrors backend resolve_quarter_state() logic.
 */
export function resolveQuarterState(
  quarterLabel: string,
  snapshotExists: boolean,
  currentQuarter: string | null = null
): QuarterState {
  // FROZEN: Snapshot exists → always visible, use snapshot values
  if (snapshotExists) {
    return QuarterState.FROZEN
  }

  // ACTIVE: Current quarter window is open → visible, use live scoring
  if (currentQuarter && currentQuarter === quarterLabel) {
    return QuarterState.ACTIVE
  }

  // During goal setting, no quarters are "active" yet
  if (currentQuarter === 'GOAL_SETTING') {
    return QuarterState.FUTURE
  }

  // Between windows (currentQuarter is null)
  if (currentQuarter === null) {
    return QuarterState.CLOSED_NO_SNAPSHOT
  }

  // Determine position relative to current quarter
  const currentIndex = QUARTER_ORDER.indexOf(currentQuarter as PeriodLabel)
  const quarterIndex = QUARTER_ORDER.indexOf(quarterLabel as PeriodLabel)

  if (currentIndex === -1 || quarterIndex === -1) {
    return QuarterState.CLOSED_NO_SNAPSHOT
  }

  if (quarterIndex > currentIndex) {
    // Future quarter → hidden
    return QuarterState.FUTURE
  } else {
    // Past quarter without snapshot → hidden
    return QuarterState.CLOSED_NO_SNAPSHOT
  }
}

/**
 * Resolve complete visibility information for a single quarter.
 * Mirrors backend resolve_quarter_visibility() logic.
 */
export function resolveQuarterVisibility(
  quarterLabel: string,
  snapshotExists: boolean,
  currentQuarter: string | null = null
): QuarterVisibility {
  const state = resolveQuarterState(quarterLabel, snapshotExists, currentQuarter)

  // Derive visibility and scoring flags from state
  const is_visible = state === QuarterState.ACTIVE || state === QuarterState.FROZEN
  const use_live_scoring = state === QuarterState.ACTIVE
  const use_snapshot = state === QuarterState.FROZEN
  const window_is_open = state === QuarterState.ACTIVE

  return {
    quarter_label: quarterLabel,
    state,
    is_visible,
    use_live_scoring,
    use_snapshot,
    window_is_open,
    snapshot_exists: snapshotExists
  }
}

/**
 * Resolve visibility for all quarters for a specific goal sheet.
 * This is the top-level function for dashboards and reports.
 */
export async function resolveAllQuartersVisibility(
  sheetId: string,
  cycleStatus?: CycleStatus
): Promise<QuarterVisibilitySet> {
  // Get current cycle status if not provided
  let currentQuarter: string | null = null
  if (cycleStatus) {
    currentQuarter = cycleStatus.active_quarter
  } else {
    try {
      const cycleRes = await api.get<CycleStatus>('/cycle-status')
      currentQuarter = cycleRes.data.active_quarter
    } catch {
      currentQuarter = null
    }
  }

  // Check snapshot existence for all quarters
  const snapshotChecks = await Promise.allSettled(
    QUARTER_ORDER.map(async (quarter) => {
      try {
        const res = await api.get(`/quarter-snapshots/${sheetId}/${quarter}`)
        return { quarter, exists: res.status === 200 }
      } catch {
        return { quarter, exists: false }
      }
    })
  )

  const snapshotExistence = new Map<string, boolean>()
  snapshotChecks.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      snapshotExistence.set(result.value.quarter, result.value.exists)
    } else {
      snapshotExistence.set(QUARTER_ORDER[index], false)
    }
  })

  // Resolve visibility for all quarters
  const quarters: QuarterVisibility[] = []
  const visible_quarter_labels: string[] = []
  const frozen_quarter_labels: string[] = []
  const live_quarter_labels: string[] = []

  for (const quarterLabel of QUARTER_ORDER) {
    const snapshotExists = snapshotExistence.get(quarterLabel) || false
    
    const visibility = resolveQuarterVisibility(
      quarterLabel,
      snapshotExists,
      currentQuarter
    )

    quarters.push(visibility)

    if (visibility.is_visible) {
      visible_quarter_labels.push(quarterLabel)
      
      if (visibility.use_snapshot) {
        frozen_quarter_labels.push(quarterLabel)
      } else if (visibility.use_live_scoring) {
        live_quarter_labels.push(quarterLabel)
      }
    }
  }

  return {
    quarters,
    active_quarter: currentQuarter,
    visible_quarter_labels,
    frozen_quarter_labels,
    live_quarter_labels
  }
}

/**
 * Get quarter snapshot data for a specific sheet and quarter.
 * Returns null if snapshot doesn't exist or fetch fails.
 */
export async function getQuarterSnapshot(
  sheetId: string,
  quarterLabel: string
): Promise<QuarterSnapshot | null> {
  try {
    const res = await api.get<QuarterSnapshot>(`/quarter-snapshots/${sheetId}/${quarterLabel}`)
    return res.data
  } catch {
    return null
  }
}

/**
 * Get all available snapshots for a sheet.
 * Returns map of quarter -> snapshot data.
 */
export async function getAllQuarterSnapshots(
  sheetId: string
): Promise<Map<string, QuarterSnapshot>> {
  const snapshots = new Map<string, QuarterSnapshot>()
  
  const snapshotPromises = QUARTER_ORDER.map(async (quarter) => {
    const snapshot = await getQuarterSnapshot(sheetId, quarter)
    if (snapshot) {
      snapshots.set(quarter, snapshot)
    }
  })

  await Promise.allSettled(snapshotPromises)
  return snapshots
}

/**
 * Simple visibility resolver WITHOUT snapshot checking (backward compatibility).
 * 
 * WARNING: This function only considers window state. Use resolveAllQuartersVisibility()
 * for complete visibility resolution that includes frozen snapshots.
 */
export function getVisibleQuartersSimple(currentQuarter: string | null = null): string[] {
  const visible_quarters: string[] = []

  // During goal setting, no quarterly scores are visible yet
  if (currentQuarter === 'GOAL_SETTING') {
    return []
  }

  // Between windows, show no quarters (caller must check snapshots separately!)
  if (currentQuarter === null) {
    return []
  }

  // Show only quarters whose windows have closed (before current quarter)
  for (const quarter of QUARTER_ORDER) {
    if (quarter === currentQuarter) {
      // Active quarter - don't include (window is open)
      break
    }
    visible_quarters.push(quarter)
  }

  return visible_quarters
}

/**
 * Resolve score for a quarter with snapshot-aware priority.
 * 
 * Returns the appropriate score value following priority rules:
 * 1. Frozen snapshot score (if available)
 * 2. Live score (if quarter is active and live scoring enabled)
 * 3. null (for hidden or unavailable quarters)
 */
export async function resolveQuarterScore(
  sheetId: string,
  quarterLabel: string,
  visibility?: QuarterVisibility,
  liveScore?: number | null
): Promise<number | null> {
  // Get visibility if not provided
  if (!visibility) {
    const visibilitySet = await resolveAllQuartersVisibility(sheetId)
    visibility = visibilitySet.quarters.find(q => q.quarter_label === quarterLabel)
    if (!visibility) {
      return null
    }
  }

  // If quarter is not visible, return null
  if (!visibility.is_visible) {
    return null
  }

  // Priority 1: Use snapshot score if available
  if (visibility.use_snapshot) {
    const snapshot = await getQuarterSnapshot(sheetId, quarterLabel)
    return snapshot ? snapshot.overall_score : null
  }

  // Priority 2: Use live score if quarter is active
  if (visibility.use_live_scoring && liveScore !== undefined) {
    return liveScore
  }

  // Default: no score available
  return null
}