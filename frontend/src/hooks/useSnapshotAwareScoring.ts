/**
 * Hook for snapshot-aware score resolution in frontend components.
 * 
 * Provides utilities for components to handle score display with proper
 * snapshot vs live score priority and quarter visibility resolution.
 */

import { useState, useEffect } from 'react'
import { resolveAllQuartersVisibility, resolveQuarterScore, type QuarterVisibilitySet } from '@/services/quarterVisibility'
import { useCycleStatus } from '@/lib/useCycleStatus'

export interface UseSnapshotAwareScoringOptions {
  sheetId?: string
  autoRefresh?: boolean
  refreshInterval?: number
}

export interface SnapshotAwareScoringState {
  visibilitySet: QuarterVisibilitySet | null
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
}

/**
 * Hook to manage quarter visibility resolution for a specific goal sheet.
 */
export function useSnapshotAwareScoring({
  sheetId,
  autoRefresh = false,
  refreshInterval = 30000
}: UseSnapshotAwareScoringOptions = {}): SnapshotAwareScoringState {
  const { status: cycleStatus } = useCycleStatus()
  const [visibilitySet, setVisibilitySet] = useState<QuarterVisibilitySet | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = async () => {
    if (!sheetId) {
      setVisibilitySet(null)
      setError(null)
      return
    }

    setLoading(true)
    setError(null)

    try {
      const result = await resolveAllQuartersVisibility(sheetId, cycleStatus)
      setVisibilitySet(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resolve quarter visibility')
      setVisibilitySet(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
  }, [sheetId, cycleStatus?.active_quarter])

  useEffect(() => {
    if (!autoRefresh || !sheetId) return

    const interval = setInterval(refresh, refreshInterval)
    return () => clearInterval(interval)
  }, [autoRefresh, refreshInterval, sheetId])

  return {
    visibilitySet,
    loading,
    error,
    refresh
  }
}

/**
 * Hook to resolve a specific quarter's score with snapshot-aware priority.
 */
export function useQuarterScore(
  sheetId: string | undefined,
  quarterLabel: string,
  liveScore?: number | null
) {
  const [resolvedScore, setResolvedScore] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!sheetId || !quarterLabel) {
      setResolvedScore(null)
      setError(null)
      return
    }

    const resolveScore = async () => {
      setLoading(true)
      setError(null)

      try {
        const score = await resolveQuarterScore(sheetId, quarterLabel, undefined, liveScore)
        setResolvedScore(score)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to resolve quarter score')
        setResolvedScore(null)
      } finally {
        setLoading(false)
      }
    }

    resolveScore()
  }, [sheetId, quarterLabel, liveScore])

  return {
    score: resolvedScore,
    loading,
    error
  }
}

/**
 * Utility to check if a quarter is visible based on visibility set.
 */
export function useQuarterVisibility(
  visibilitySet: QuarterVisibilitySet | null,
  quarterLabel: string
) {
  if (!visibilitySet) {
    return {
      isVisible: false,
      useSnapshot: false,
      useLiveScoring: false,
      windowIsOpen: false
    }
  }

  const visibility = visibilitySet.quarters.find(q => q.quarter_label === quarterLabel)
  
  return {
    isVisible: visibility?.is_visible ?? false,
    useSnapshot: visibility?.use_snapshot ?? false,
    useLiveScoring: visibility?.use_live_scoring ?? false,
    windowIsOpen: visibility?.window_is_open ?? false
  }
}