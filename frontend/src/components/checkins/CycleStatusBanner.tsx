/**
 * Cycle status banner — rendered above the check-in pages.
 *
 * Shows the current "where in the appraisal cycle are we?" state so the user
 * understands why their inputs are or aren't editable. Driven entirely by the
 * backend service (docs/CHECKIN_RULES.md is the source of truth for the
 * calendar).
 */

import { CalendarClock, FlaskConical, Lock, ShieldAlert } from 'lucide-react'

import type { CycleBannerTone, CycleStatus } from '@/types'
import { isCheckInWindowOpen } from '@/types'

const TONE_CLASSES: Record<CycleBannerTone, string> = {
  blue: 'border-blue-200 bg-blue-50 text-blue-900',
  green: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  amber: 'border-amber-200 bg-amber-50 text-amber-900',
  red: 'border-red-200 bg-red-50 text-red-900',
}

const TONE_TITLE: Record<CycleBannerTone, string> = {
  blue: 'text-blue-800',
  green: 'text-emerald-800',
  amber: 'text-amber-800',
  red: 'text-red-800',
}

const TONE_ICON_BG: Record<CycleBannerTone, string> = {
  blue: 'bg-blue-100 text-blue-700',
  green: 'bg-emerald-100 text-emerald-700',
  amber: 'bg-amber-100 text-amber-700',
  red: 'bg-red-100 text-red-700',
}

interface CycleStatusBannerProps {
  status: CycleStatus
  /** When true, hides the supporting "next window opens on …" caption. */
  compact?: boolean
}

export function CycleStatusBanner({ status, compact = false }: CycleStatusBannerProps) {
  const open = isCheckInWindowOpen(status.state)
  const Icon = open ? CalendarClock : Lock

  return (
    <div
      className={[
        'flex items-start gap-3 rounded-xl border p-4 shadow-sm',
        TONE_CLASSES[status.banner_tone],
      ].join(' ')}
      role="status"
    >
      <div className={['flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', TONE_ICON_BG[status.banner_tone]].join(' ')}>
        <Icon size={18} />
      </div>
      <div className="flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className={['text-sm font-semibold uppercase tracking-wide', TONE_TITLE[status.banner_tone]].join(' ')}>
            {status.banner_title}
          </p>
          {status.is_mocked && (
            <span className="inline-flex items-center gap-1 rounded-full bg-purple-100 px-2 py-0.5 text-xs font-semibold text-purple-700 border border-purple-200">
              <FlaskConical size={10} />
              Mocked Date
            </span>
          )}
          {!open && (
            <span className="inline-flex items-center gap-1 rounded-full bg-white/70 px-2 py-0.5 text-xs font-medium border">
              <ShieldAlert size={10} />
              Inputs Read-Only
            </span>
          )}
        </div>
        <p className="mt-1 text-sm leading-relaxed">{status.banner_message}</p>
        {!compact && (
          <p className="mt-1 text-xs opacity-75">
            Today (server): {new Date(status.today).toLocaleDateString('en-IN', { dateStyle: 'long' })}
            {status.next_window_opens && (
              <>
                {' '}
                · Next window opens{' '}
                {new Date(status.next_window_opens).toLocaleDateString('en-IN', { dateStyle: 'long' })}
              </>
            )}
          </p>
        )}
      </div>
    </div>
  )
}
