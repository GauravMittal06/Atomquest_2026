/**
 * AdminCompletionDashboard
 *
 * Enterprise Completion Dashboard — Admin-only.
 *
 * Governed by:
 *   docs/ROLE_PERMISSIONS.md  §Admin → "Monitor completion dashboard"
 *   docs/REPORTING_REQUIREMENTS.md §Completion Dashboard
 *
 * Backed by a single aggregation endpoint (GET /api/admin/dashboard/completion)
 * that computes every metric live from MongoDB.  The page polls that endpoint
 * every `REFRESH_INTERVAL_MS` so the widgets stay current as employees submit
 * goal sheets and managers add check-in comments — no websocket, no caching,
 * always sourced from the database.
 *
 * Empty-state policy:
 *   - Progress bars degrade to "—" when there are zero employees / managers
 *   - The pie chart renders a placeholder when no goals exist
 *   - The bar chart renders a placeholder when no check-ins exist
 *   - The whole page never crashes on `[]` payloads.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  ClipboardList,
  Clock,
  Loader2,
  PieChart,
  RefreshCcw,
  ShieldCheck,
  TrendingUp,
  UserCheck,
  Users,
} from 'lucide-react'

import api from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'
import type { CompletionDashboardData } from '@/types'

import { CompletionProgressCard } from '@/components/admin/completion/CompletionProgressCard'
import { ThrustAreaPieChart } from '@/components/admin/completion/ThrustAreaPieChart'
import { QuarterlyTrendChart } from '@/components/admin/completion/QuarterlyTrendChart'

/** Poll the aggregation endpoint every 15 s so the dashboard feels "live". */
const REFRESH_INTERVAL_MS = 15_000

function formatTimestamp(iso: string | undefined): string {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    return d.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  } catch {
    return iso
  }
}

export function AdminCompletionDashboard() {
  const { role } = useAuth()
  const [data, setData] = useState<CompletionDashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Track whether the user is mid-tab-switch so we skip auto-polling that
  // would otherwise waste API calls when the dashboard isn't visible.
  const isVisibleRef = useRef<boolean>(true)

  const load = useCallback(
    async (mode: 'initial' | 'refresh' = 'refresh') => {
      if (mode === 'refresh') setRefreshing(true)
      try {
        const res = await api.get<CompletionDashboardData>('/admin/dashboard/completion')
        setData(res.data)
        setError(null)
      } catch (err: unknown) {
        const detail =
          err && typeof err === 'object' && 'response' in err
            ? (err as { response?: { data?: { detail?: string } } }).response?.data?.detail
            : undefined
        setError(typeof detail === 'string' ? detail : 'Failed to load completion dashboard.')
      } finally {
        if (mode === 'initial') setLoading(false)
        setRefreshing(false)
      }
    },
    [],
  )

  // Initial load
  useEffect(() => {
    void load('initial')
  }, [load])

  // Real-time polling — only while the page is visible
  useEffect(() => {
    const onVisibility = () => {
      isVisibleRef.current = document.visibilityState === 'visible'
    }
    document.addEventListener('visibilitychange', onVisibility)
    const timer = window.setInterval(() => {
      if (isVisibleRef.current) {
        void load('refresh')
      }
    }, REFRESH_INTERVAL_MS)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [load])

  // ── Permission gate (defense in depth; route also gated by AppShell role) ──
  if (role && role !== 'ADMIN') {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-20 text-slate-500">
        <ShieldCheck size={36} className="text-slate-400" />
        <p className="text-base font-semibold text-slate-700">Admin access required</p>
        <p className="text-sm text-slate-400">
          The Completion Dashboard is restricted to Administrators (docs/ROLE_PERMISSIONS.md §Admin).
        </p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
      </div>
    )
  }

  if (error && !data) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
        <div className="flex items-start gap-2">
          <AlertTriangle size={18} className="mt-0.5 shrink-0" />
          <div>
            <p className="font-semibold">Could not load completion dashboard</p>
            <p className="text-xs text-red-600 mt-1">{error}</p>
            <button
              onClick={() => void load('initial')}
              className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50"
            >
              <RefreshCcw size={12} /> Retry
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (!data) {
    return null
  }

  const {
    as_of,
    active_quarter,
    employee_submission,
    manager_checkins,
    checkin_summary,
    thrust_area_distribution,
    quarterly_trend,
  } = data

  return (
    <div className="space-y-6">
      {/* ── Page header ─────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-slate-900">Completion Dashboard</h1>
            <span className="inline-flex items-center rounded-full bg-purple-50 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-purple-700 ring-1 ring-purple-200">
              Admin
            </span>
          </div>
          <p className="text-sm text-slate-500 mt-1">
            Real-time submission, check-in, and quarterly achievement metrics across the organisation.
          </p>
        </div>

        <div className="flex flex-col items-end gap-1">
          <button
            onClick={() => void load('refresh')}
            disabled={refreshing}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-60 transition-colors"
          >
            {refreshing ? (
              <Loader2 size={14} className="animate-spin text-indigo-500" />
            ) : (
              <RefreshCcw size={13} className="text-slate-500" />
            )}
            {refreshing ? 'Refreshing…' : 'Refresh now'}
          </button>
          <p className="text-[11px] text-slate-400 flex items-center gap-1.5">
            <span className={`inline-block h-1.5 w-1.5 rounded-full ${refreshing ? 'bg-amber-400' : 'bg-emerald-400'} animate-pulse`} />
            Live · last updated {formatTimestamp(as_of)}
          </p>
        </div>
      </div>

      {/* ── Soft warning banner if a stale-data fetch failed mid-session ── */}
      {error && data && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-800 flex items-center gap-2">
          <AlertTriangle size={14} />
          {error} Showing last successful snapshot.
        </div>
      )}

      {/* ── Section 1: Completion progress bars ──────────────────────────── */}
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500 mb-3">
          Completion Tracking
        </h2>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <CompletionProgressCard
            title="Employees Submitted Goal Sheets"
            subtitle="Sheets that have left DRAFT (SUBMITTED, RETURNED, APPROVED or LOCKED)."
            percentage={employee_submission.submission_pct}
            completedCount={employee_submission.submitted_count}
            totalCount={employee_submission.total_employees}
            completedLabel="Submitted"
            pendingLabel="Pending"
            icon={<Users size={16} />}
            tone="blue"
          />
          <CompletionProgressCard
            title="Managers Completed Check-ins"
            subtitle={
              active_quarter
                ? `Authored a remark or comment for the active ${active_quarter} window.`
                : 'No active check-in window — showing all-time manager review coverage.'
            }
            percentage={manager_checkins.completion_pct}
            completedCount={manager_checkins.completed_count}
            totalCount={manager_checkins.total_managers}
            completedLabel="Completed"
            pendingLabel="Pending"
            icon={<UserCheck size={16} />}
            tone="emerald"
          />
        </div>

        {/* Pending / completed / reviewed check-ins per REPORTING_REQUIREMENTS.md §Completion Dashboard */}
        <div className="grid grid-cols-1 gap-4 mt-4 sm:grid-cols-3">
          <MiniStat
            label="Completed Check-ins"
            value={checkin_summary.completed_checkins}
            icon={<ClipboardList size={15} />}
            tone="emerald"
          />
          <MiniStat
            label="Pending Check-ins"
            value={checkin_summary.pending_checkins}
            icon={<Clock size={15} />}
            tone="amber"
          />
          <MiniStat
            label="Manager Review Coverage"
            value={`${checkin_summary.manager_review_completion_pct.toFixed(1)}%`}
            subValue={`${checkin_summary.manager_reviewed_checkins} reviewed`}
            icon={<ShieldCheck size={15} />}
            tone="purple"
          />
        </div>
      </section>

      {/* ── Section 2: Visual breakdown ──────────────────────────────────── */}
      <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <ChartCard
          title="Goals by Thrust Area"
          subtitle="Distribution of all active goals across the 8 enterprise Thrust Areas."
          icon={<PieChart size={16} className="text-indigo-500" />}
        >
          <ThrustAreaPieChart data={thrust_area_distribution} />
        </ChartCard>

        <ChartCard
          title="Quarter-on-Quarter Achievement"
          subtitle="Aggregate weighted goal score: Planned vs Actual, sourced from check-in data."
          icon={<TrendingUp size={16} className="text-indigo-500" />}
        >
          <QuarterlyTrendChart data={quarterly_trend} />
        </ChartCard>
      </section>
    </div>
  )
}

// ───────────────────────────────────────────────────────────────────────────
// Local presentational helpers
// ───────────────────────────────────────────────────────────────────────────

interface ChartCardProps {
  title: string
  subtitle?: string
  icon?: React.ReactNode
  children: React.ReactNode
}

function ChartCard({ title, subtitle, icon, children }: ChartCardProps) {
  return (
    <div className="rounded-xl border bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <div className="flex items-center gap-2">
            {icon}
            <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
          </div>
          {subtitle && <p className="text-xs text-slate-400 mt-1">{subtitle}</p>}
        </div>
      </div>
      {children}
    </div>
  )
}

interface MiniStatProps {
  label: string
  value: string | number
  subValue?: string
  icon?: React.ReactNode
  tone: 'emerald' | 'amber' | 'purple'
}

const MINI_TONE_STYLES: Record<MiniStatProps['tone'], { ring: string; badge: string; text: string }> = {
  emerald: {
    ring: 'ring-emerald-100',
    badge: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
    text: 'text-emerald-700',
  },
  amber: {
    ring: 'ring-amber-100',
    badge: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
    text: 'text-amber-700',
  },
  purple: {
    ring: 'ring-purple-100',
    badge: 'bg-purple-50 text-purple-700 ring-1 ring-purple-200',
    text: 'text-purple-700',
  },
}

function MiniStat({ label, value, subValue, icon, tone }: MiniStatProps) {
  const styles = MINI_TONE_STYLES[tone]
  return (
    <div className={`rounded-xl border bg-white p-4 shadow-sm ring-1 ${styles.ring}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
          {label}
        </span>
        {icon && (
          <span className={`inline-flex h-7 w-7 items-center justify-center rounded-full ${styles.badge}`}>
            {icon}
          </span>
        )}
      </div>
      <p className={`mt-3 text-2xl font-bold tabular-nums ${styles.text}`}>{value}</p>
      {subValue && <p className="mt-0.5 text-xs text-slate-400">{subValue}</p>}
    </div>
  )
}
