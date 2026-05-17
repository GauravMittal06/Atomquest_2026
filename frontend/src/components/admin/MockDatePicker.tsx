/**
 * Admin Mock-Date dropdown.
 *
 * Lets an Admin override the backend's "today" so the quarterly check-in
 * calendar (docs/CHECKIN_RULES.md) can be demoed in any month without
 * touching the server clock.
 *
 * Rendered in the AppShell topbar only for ADMIN sessions. Other roles see
 * the resulting CycleStatusBanner change in real time.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { CalendarClock, ChevronDown, Loader2, RotateCcw } from 'lucide-react'

import api from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'
import { broadcastCycleStatus, useCycleStatus } from '@/lib/useCycleStatus'
import type { CycleStatus } from '@/types'

interface MockOption {
  label: string
  iso: string | null
}

/**
 * Hand-picked demo dates — one per cycle state defined in CHECKIN_RULES.md.
 * Years are 2026 so dates appear "current" in the running demo.
 */
const MOCK_OPTIONS: MockOption[] = [
  { label: 'Use real system date', iso: null },
  { label: 'May (Goal Setting)', iso: '2026-05-15' },
  { label: 'July (Q1 window)', iso: '2026-07-15' },
  { label: 'October (Q2 window)', iso: '2026-10-15' },
  { label: 'January (Q3 window)', iso: '2027-01-15' },
  { label: 'March (Q4 window)', iso: '2027-03-15' },
  { label: 'August (between windows)', iso: '2026-08-15' },
]

export function MockDatePicker() {
  const { role } = useAuth()
  const { status, refresh } = useCycleStatus()

  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const select = useCallback(
    async (option: MockOption) => {
      setOpen(false)
      setSaving(true)
      try {
        if (option.iso === null) {
          const { data } = await api.delete<CycleStatus>('/system/mock-date')
          broadcastCycleStatus(data)
        } else {
          const { data } = await api.post<CycleStatus>('/system/mock-date', {
            date: option.iso,
          })
          broadcastCycleStatus(data)
        }
        await refresh()
      } catch {
        // Non-fatal — user can try again
      } finally {
        setSaving(false)
      }
    },
    [refresh],
  )

  if (role !== 'ADMIN') return null

  const activeLabel = status?.is_mocked
    ? `Mocked: ${status.today}`
    : 'Real system date'

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={[
          'inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium shadow-sm transition-colors',
          status?.is_mocked
            ? 'border-purple-300 bg-purple-50 text-purple-800 hover:bg-purple-100'
            : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
        ].join(' ')}
      >
        {saving ? (
          <Loader2 size={13} className="animate-spin" />
        ) : (
          <CalendarClock size={13} className="text-purple-500" />
        )}
        <span className="hidden sm:inline">{activeLabel}</span>
        <span className="sm:hidden">Date</span>
        <ChevronDown size={11} className={open ? 'rotate-180 transition-transform' : 'transition-transform'} />
      </button>

      {open && (
        <div className="absolute right-0 z-40 mt-2 w-60 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
          <div className="border-b bg-slate-50 px-3 py-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Mock System Date
            </p>
            <p className="mt-0.5 text-xs text-slate-400">
              Demo-only · controls cycle state
            </p>
          </div>
          <ul className="max-h-72 overflow-y-auto py-1">
            {MOCK_OPTIONS.map((option) => {
              const isActive =
                option.iso === null ? !status?.is_mocked : status?.today === option.iso
              return (
                <li key={option.label}>
                  <button
                    type="button"
                    onClick={() => select(option)}
                    className={[
                      'flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition-colors',
                      isActive
                        ? 'bg-purple-50 font-semibold text-purple-800'
                        : 'text-slate-700 hover:bg-slate-50',
                    ].join(' ')}
                  >
                    <span className="flex items-center gap-2">
                      {option.iso === null && <RotateCcw size={11} className="text-slate-400" />}
                      {option.label}
                    </span>
                    {isActive && <span className="text-purple-600">✓</span>}
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}
