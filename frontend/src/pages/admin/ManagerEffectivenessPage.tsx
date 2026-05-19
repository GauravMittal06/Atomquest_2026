/**
 * Admin Manager Effectiveness Page
 *
 * Per-manager check-in completion rates for direct-report employees.
 *
 * Data source: GET /api/admin/manager-effectiveness (Admin-only)
 */
import { useCallback, useEffect, useState } from 'react'
import {
  AlertTriangle,
  BarChart2,
  Loader2,
  RefreshCcw,
  ShieldCheck,
  Users,
} from 'lucide-react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import api from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'

// ── Design tokens (mirrors CompletionDashboard / CompletionProgressCard) ──
const ON_TRACK_BAR_FILL = '#10b981' // emerald-500
const ON_TRACK_LABEL_FILL = '#047857' // emerald-700

interface ManagerEffectivenessRow {
  manager_id: string
  manager_name: string
  team_size: number
  checkins_submitted: number
  completion_rate: number
}

interface TooltipPayloadEntry {
  dataKey?: string
  name?: string
  value?: number | string
  color?: string
  payload?: ManagerEffectivenessRow
}

interface TooltipProps {
  active?: boolean
  payload?: TooltipPayloadEntry[]
  label?: string
}

function formatRate(value: number): string {
  if (!Number.isFinite(value)) return '—'
  return `${value.toFixed(1)}%`
}

function EffectivenessTooltip({ active, payload, label }: TooltipProps) {
  if (!active || !payload || payload.length === 0) return null
  const row = payload[0]?.payload
  if (!row) return null

  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg">
      <p className="font-semibold text-slate-800">{label}</p>
      <div className="mt-1.5 space-y-1">
        <div className="flex items-center justify-between gap-6">
          <span className="text-slate-500">Completion rate</span>
          <span className="font-semibold tabular-nums text-emerald-700">
            {formatRate(row.completion_rate)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-6">
          <span className="text-slate-500">Check-ins submitted</span>
          <span className="font-semibold tabular-nums text-slate-700">
            {row.checkins_submitted}/{row.team_size}
          </span>
        </div>
        <p className="pt-1 text-[11px] text-slate-400">
          Team size: {row.team_size} direct report{row.team_size === 1 ? '' : 's'}
        </p>
      </div>
    </div>
  )
}

export function AdminManagerEffectivenessPage() {
  const { role } = useAuth()
  const [data, setData] = useState<ManagerEffectivenessRow[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (mode: 'initial' | 'refresh' = 'refresh') => {
    if (mode === 'refresh') setRefreshing(true)
    try {
      const res = await api.get<ManagerEffectivenessRow[]>('/admin/manager-effectiveness')
      setData(res.data)
      setError(null)
    } catch (err: unknown) {
      const detail =
        err && typeof err === 'object' && 'response' in err
          ? (err as { response?: { data?: { detail?: string } } }).response?.data?.detail
          : undefined
      setError(typeof detail === 'string' ? detail : 'Failed to load manager effectiveness data.')
    } finally {
      if (mode === 'initial') setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void load('initial')
  }, [load])

  if (role && role !== 'ADMIN') {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-20 text-slate-500">
        <ShieldCheck size={36} className="text-slate-400" />
        <p className="text-base font-semibold text-slate-700">Admin access required</p>
        <p className="text-sm text-slate-400">
          Manager Effectiveness is restricted to Administrators.
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
            <p className="font-semibold">Could not load manager effectiveness</p>
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

  const rows = data ?? []
  const isEmpty = rows.length === 0

  return (
    <div className="space-y-6">
      {/* ── Page header ─────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          {/* <p className="breadcrumb">ADMIN · MANAGER EFFECTIVENESS</p> */}
          <h1 className="page-title">Manager Effectiveness</h1>
          <p className="text-sm text-slate-500 mt-1">
            Check-in completion rates across all L1 managers
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
            <span
              className={`inline-block h-1.5 w-1.5 rounded-full ${refreshing ? 'bg-amber-400' : 'bg-emerald-400'} animate-pulse`}
            />
            {refreshing ? 'Updating…' : 'Live data'}
          </p>
        </div>
      </div>

      {error && data && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-800 flex items-center gap-2">
          <AlertTriangle size={14} />
          {error} Showing last successful snapshot.
        </div>
      )}

      {/* ── Bar chart ───────────────────────────────────────────────────── */}
      <ChartCard
        title="Completion Rate by Manager"
        subtitle="Percentage of direct reports with at least one check-in submitted."
        icon={<BarChart2 size={16} className="text-indigo-500" />}
      >
        {isEmpty ? (
          <EmptyState />
        ) : (
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={rows}
                margin={{ top: 28, right: 16, left: 0, bottom: 8 }}
                barCategoryGap="22%"
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis
                  dataKey="manager_name"
                  tick={{ fontSize: 12, fill: '#64748b' }}
                  tickLine={false}
                  axisLine={{ stroke: '#cbd5e1' }}
                  interval={0}
                  angle={rows.length > 6 ? -35 : 0}
                  textAnchor={rows.length > 6 ? 'end' : 'middle'}
                  height={rows.length > 6 ? 72 : 30}
                />
                <YAxis
                  domain={[0, 100]}
                  tick={{ fontSize: 11, fill: '#94a3b8' }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) => `${v}%`}
                  label={{
                    value: 'Completion Rate (%)',
                    angle: -90,
                    position: 'insideLeft',
                    style: { fill: '#94a3b8', fontSize: 11, textAnchor: 'middle' },
                    offset: 14,
                  }}
                />
                <Tooltip
                  cursor={{ fill: 'rgba(148, 163, 184, 0.08)' }}
                  content={<EffectivenessTooltip />}
                />
                <Bar
                  dataKey="completion_rate"
                  name="Completion Rate"
                  fill={ON_TRACK_BAR_FILL}
                  radius={[6, 6, 0, 0]}
                  maxBarSize={42}
                >
                  <LabelList
                    dataKey="completion_rate"
                    position="top"
                    formatter={(value) =>
                      typeof value === 'number' ? formatRate(value) : ''
                    }
                    style={{ fill: ON_TRACK_LABEL_FILL, fontSize: 11, fontWeight: 600 }}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </ChartCard>

      {/* ── Data table ────────────────────────────────────────────────────── */}
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500 mb-3">
          Manager Details
        </h2>
        <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
          {isEmpty ? (
            <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-slate-400">
              <Users size={32} className="opacity-60" />
              <p className="text-sm font-medium text-slate-500">No managers found</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 uppercase tracking-wide border-b border-slate-100">
                  <tr>
                    <th className="th text-left">Manager Name</th>
                    <th className="th text-right">Team Size</th>
                    <th className="th text-right">Check-ins Submitted</th>
                    <th className="th text-right">Completion Rate (%)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((row) => (
                    <tr key={row.manager_id} className="tr">
                      <td className="td">
                        <span className="font-medium text-slate-900">{row.manager_name || '—'}</span>
                      </td>
                      <td className="td text-right tabular-nums">{row.team_size}</td>
                      <td className="td text-right tabular-nums">{row.checkins_submitted}</td>
                      <td className="td text-right">
                        <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold tabular-nums text-emerald-700 ring-1 ring-emerald-200">
                          {formatRate(row.completion_rate)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}

// ───────────────────────────────────────────────────────────────────────────
// Local presentational helpers (mirrors CompletionDashboard)
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

function EmptyState() {
  return (
    <div className="flex h-72 w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-slate-200 bg-slate-50/50 text-slate-400">
      <Users size={32} className="opacity-60" />
      <p className="text-sm font-medium text-slate-500">No managers found</p>
    </div>
  )
}

export default AdminManagerEffectivenessPage
