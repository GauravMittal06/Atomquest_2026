/**
 * QuarterlyTrendChart — Q1→Q4 planned vs actual achievement (Recharts <BarChart>).
 *
 * Data source: GET /api/admin/dashboard/completion → `quarterly_trend`.
 *
 * For each quarter the backend aggregates across every check-in filed in
 * MongoDB:
 *   planned[Q]  = Σ goal.weightage                (target weighted goal score)
 *   actual[Q]   = Σ goal.weightage × ach%/100     (delivered weighted score)
 *
 * Both bars share the same weighted-points scale so the visual gap between
 * the two bars per quarter directly represents under- or over-performance.
 *
 * Empty-state handling: if every quarter has zero check-ins the bar chart
 * is replaced with a friendly "no check-in data yet" placeholder rather
 * than mounting <BarChart> with an all-zero dataset.
 */
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { BarChart2 } from 'lucide-react'

import { formatScore } from '@/utils/scoring'
import type { QuarterlyTrendPoint } from '@/types'

interface QuarterlyTrendChartProps {
  data: QuarterlyTrendPoint[]
}

interface TooltipPayloadEntry {
  dataKey?: string
  name?: string
  value?: number | string
  color?: string
  payload?: QuarterlyTrendPoint
}

interface TooltipProps {
  active?: boolean
  payload?: TooltipPayloadEntry[]
  label?: string
}

function TrendTooltip({ active, payload, label }: TooltipProps) {
  if (!active || !payload || payload.length === 0) return null
  const sample = payload[0]?.payload
  const checkinCount = sample?.checkin_count ?? 0
  const planned = sample?.planned ?? 0
  const actual = sample?.actual ?? 0
  const delta = actual - planned
  const deltaTone = delta >= 0 ? 'text-emerald-600' : 'text-red-500'
  const deltaSign = delta >= 0 ? '+' : ''
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg">
      <p className="font-semibold text-slate-800">{label}</p>
      <div className="mt-1.5 space-y-1">
        <div className="flex items-center justify-between gap-6">
          <span className="flex items-center gap-1.5 text-slate-500">
            <span className="inline-block h-2 w-2 rounded-sm bg-slate-400" />
            Planned
          </span>
          <span className="font-semibold tabular-nums text-slate-700">{formatScore(planned)}</span>
        </div>
        <div className="flex items-center justify-between gap-6">
          <span className="flex items-center gap-1.5 text-slate-500">
            <span className="inline-block h-2 w-2 rounded-sm bg-indigo-500" />
            Actual
          </span>
          <span className="font-semibold tabular-nums text-slate-700">{formatScore(actual)}</span>
        </div>
        <div className={`flex items-center justify-between gap-6 border-t border-slate-100 pt-1.5 ${deltaTone}`}>
          <span>Delta</span>
          <span className="font-semibold tabular-nums">
            {deltaSign}
            {formatScore(Math.abs(delta))}
          </span>
        </div>
        <p className="pt-1 text-[11px] text-slate-400">
          {checkinCount} check-in{checkinCount === 1 ? '' : 's'} recorded
        </p>
      </div>
    </div>
  )
}

export function QuarterlyTrendChart({ data }: QuarterlyTrendChartProps) {
  const safe = (data ?? []).filter(Boolean)
  const totalCheckins = safe.reduce((sum, q) => sum + (q.checkin_count ?? 0), 0)

  if (safe.length === 0 || totalCheckins === 0) {
    return <EmptyState />
  }

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={safe}
          margin={{ top: 10, right: 16, left: 0, bottom: 8 }}
          barCategoryGap="22%"
          barGap={4}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
          <XAxis
            dataKey="quarter"
            tick={{ fontSize: 12, fill: '#64748b' }}
            tickLine={false}
            axisLine={{ stroke: '#cbd5e1' }}
          />
          <YAxis
            tick={{ fontSize: 11, fill: '#94a3b8' }}
            tickLine={false}
            axisLine={false}
            label={{
              value: 'Weighted Points',
              angle: -90,
              position: 'insideLeft',
              style: { fill: '#94a3b8', fontSize: 11, textAnchor: 'middle' },
              offset: 14,
            }}
          />
          <Tooltip
            cursor={{ fill: 'rgba(148, 163, 184, 0.08)' }}
            content={<TrendTooltip />}
          />
          <Legend
            verticalAlign="top"
            align="right"
            iconType="circle"
            wrapperStyle={{ fontSize: 12, color: '#475569', paddingBottom: 8 }}
          />
          <Bar
            dataKey="planned"
            name="Planned"
            fill="#cbd5e1"
            radius={[6, 6, 0, 0]}
            maxBarSize={42}
          />
          <Bar
            dataKey="actual"
            name="Actual"
            fill="#6366f1"
            radius={[6, 6, 0, 0]}
            maxBarSize={42}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="flex h-72 w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-slate-200 bg-slate-50/50 text-slate-400">
      <BarChart2 size={32} className="opacity-60" />
      <p className="text-sm font-medium text-slate-500">No check-in data yet</p>
      <p className="text-xs text-slate-400">
        Quarterly trend appears once employees file check-ins.
      </p>
    </div>
  )
}
