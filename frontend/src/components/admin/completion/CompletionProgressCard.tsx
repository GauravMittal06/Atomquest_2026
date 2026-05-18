/**
 * CompletionProgressCard
 *
 * A widget that pairs a large headline percentage with an animated progress
 * bar and the underlying count breakdown.  Used twice on the Completion
 * Dashboard:
 *   - % of Employees who submitted goal sheets
 *   - % of Managers who completed quarterly check-ins
 *
 * Empty-state handling: when `total === 0` the bar renders at 0 % and the
 * caller is expected to also display an "no data yet" hint via `subtitle`.
 */
import { cn } from '@/lib/utils'
import { formatScore } from '@/utils/scoring'

type Tone = 'blue' | 'emerald' | 'amber' | 'purple'

interface CompletionProgressCardProps {
  title: string
  subtitle?: string
  /** Computed percentage 0-100. */
  percentage: number
  /** Number that has completed the action. */
  completedCount: number
  /** Total number expected to complete the action. */
  totalCount: number
  /** Label shown next to the completed count, e.g. "submitted". */
  completedLabel: string
  /** Label shown next to the pending count, e.g. "pending". */
  pendingLabel: string
  /** Optional left-side icon component (e.g. <Users size={16} />). */
  icon?: React.ReactNode
  tone?: Tone
}

const TONE_STYLES: Record<Tone, { ring: string; bar: string; text: string; pill: string }> = {
  blue: {
    ring: 'ring-blue-100',
    bar: 'bg-blue-500',
    text: 'text-blue-700',
    pill: 'bg-blue-50 text-blue-700 ring-1 ring-blue-200',
  },
  emerald: {
    ring: 'ring-emerald-100',
    bar: 'bg-emerald-500',
    text: 'text-emerald-700',
    pill: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
  },
  amber: {
    ring: 'ring-amber-100',
    bar: 'bg-amber-500',
    text: 'text-amber-700',
    pill: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
  },
  purple: {
    ring: 'ring-purple-100',
    bar: 'bg-purple-500',
    text: 'text-purple-700',
    pill: 'bg-purple-50 text-purple-700 ring-1 ring-purple-200',
  },
}

function clampPct(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, value))
}

export function CompletionProgressCard({
  title,
  subtitle,
  percentage,
  completedCount,
  totalCount,
  completedLabel,
  pendingLabel,
  icon,
  tone = 'blue',
}: CompletionProgressCardProps) {
  const styles = TONE_STYLES[tone]
  const safePct = clampPct(percentage)
  const pendingCount = Math.max(0, totalCount - completedCount)
  const isEmpty = totalCount === 0

  return (
    <div className={cn('rounded-xl border bg-white p-5 shadow-sm ring-1', styles.ring)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {icon && <span className={cn('opacity-80', styles.text)}>{icon}</span>}
            <h3 className="text-sm font-semibold tracking-wide uppercase text-slate-500">
              {title}
            </h3>
          </div>
          {subtitle && (
            <p className="text-xs text-slate-400 mt-1.5 leading-snug">{subtitle}</p>
          )}
        </div>

        <span
          className={cn(
            'inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium whitespace-nowrap',
            styles.pill,
          )}
        >
          {isEmpty ? '—' : `${completedCount}/${totalCount}`}
        </span>
      </div>

      <div className="mt-4 flex items-baseline gap-2">
        <span className={cn('text-4xl font-bold tabular-nums', styles.text)}>
          {isEmpty ? '—' : formatScore(safePct)}
        </span>
        {!isEmpty && <span className="text-lg font-medium text-slate-400">%</span>}
      </div>

      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-100">
        <div
          role="progressbar"
          aria-valuenow={Math.round(safePct)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={title}
          className={cn('h-full rounded-full transition-[width] duration-500 ease-out', styles.bar)}
          style={{ width: `${safePct}%` }}
        />
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-4">
        <div>
          <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
            {completedLabel}
          </dt>
          <dd className="text-base font-semibold text-slate-700 tabular-nums">
            {isEmpty ? '—' : completedCount}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
            {pendingLabel}
          </dt>
          <dd className="text-base font-semibold text-slate-700 tabular-nums">
            {isEmpty ? '—' : pendingCount}
          </dd>
        </div>
      </dl>
    </div>
  )
}
