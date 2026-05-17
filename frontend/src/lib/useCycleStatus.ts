/**
 * useCycleStatus — React hook that reads the current quarterly cycle state.
 *
 * Calls GET /api/system/cycle-status. The backend service is the source of
 * truth (docs/CHECKIN_RULES.md). Components use the returned state to:
 *   - show a banner explaining the active window
 *   - flip achievement inputs to read-only outside the window
 *
 * The hook exposes a `refresh()` callback so Admin's MockDatePicker can
 * trigger a re-read after changing the mock date.
 */

import { useCallback, useEffect, useState } from 'react'

import api from '@/lib/api'
import type { CycleStatus } from '@/types'

interface State {
  status: CycleStatus | null
  loading: boolean
  error: string | null
}

let cachedStatus: CycleStatus | null = null
const subscribers: Array<(s: CycleStatus | null) => void> = []

function notifySubscribers(next: CycleStatus | null) {
  cachedStatus = next
  for (const sub of subscribers) sub(next)
}

export function useCycleStatus() {
  const [state, setState] = useState<State>({
    status: cachedStatus,
    loading: cachedStatus === null,
    error: null,
  })

  const refresh = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: prev.status === null, error: null }))
    try {
      const { data } = await api.get<CycleStatus>('/system/cycle-status')
      notifySubscribers(data)
      setState({ status: data, loading: false, error: null })
    } catch {
      setState({ status: null, loading: false, error: 'Failed to load cycle status.' })
    }
  }, [])

  useEffect(() => {
    const handler = (s: CycleStatus | null) =>
      setState({ status: s, loading: false, error: null })
    subscribers.push(handler)
    return () => {
      const i = subscribers.indexOf(handler)
      if (i >= 0) subscribers.splice(i, 1)
    }
  }, [])

  useEffect(() => {
    if (cachedStatus === null) {
      refresh()
    }
  }, [refresh])

  return { ...state, refresh }
}

/** Imperatively update the shared cycle status (used by MockDatePicker). */
export function broadcastCycleStatus(status: CycleStatus): void {
  notifySubscribers(status)
}
