/**
 * ThrustAreaPieChart — Goals distribution by Thrust Area (Recharts <PieChart>).
 *
 * Data source: GET /api/admin/dashboard/completion → `thrust_area_distribution`.
 *
 * Empty-state handling:
 *   The backend always returns one entry per Thrust Area for consistent
 *   legend ordering — but many of those entries may have `count === 0` early
 *   in a cycle.  We filter those out here so Recharts never has to draw a
 *   zero-area slice (which crashes some 3.x builds), and if *every* entry is
 *   zero we render a friendly placeholder instead of mounting <PieChart>.
 */
import {
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from 'recharts'
import { PieChart as PieIcon } from 'lucide-react'

import type { ThrustAreaDistributionItem } from '@/types'

interface ThrustAreaPieChartProps {
  data: ThrustAreaDistributionItem[]
}

/**
 * Brand palette aligned with the rest of the dashboard's status badges and
 * Tailwind tokens.  Order is deliberate: most-used Thrust Areas get the
 * highest-contrast colours so the slice highlights are immediately readable.
 */
const SLICE_COLOURS: readonly string[] = [
  '#6366f1', // indigo-500
  '#10b981', // emerald-500
  '#f59e0b', // amber-500
  '#ef4444', // red-500
  '#8b5cf6', // violet-500
  '#06b6d4', // cyan-500
  '#ec4899', // pink-500
  '#84cc16', // lime-500
]

interface TooltipPayloadEntry {
  name?: string
  value?: number | string
  payload?: ThrustAreaDistributionItem & { totalGoals?: number }
}

interface TooltipProps {
  active?: boolean
  payload?: TooltipPayloadEntry[]
}

function ThrustTooltip({ active, payload }: TooltipProps) {
  if (!active || !payload || payload.length === 0) return null
  const entry = payload[0]
  const item = entry.payload
  if (!item) return null
  const total = item.totalGoals ?? 0
  const pct = total > 0 ? ((item.count / total) * 100).toFixed(1) : '0.0'
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg">
      <p className="font-semibold text-slate-800">{item.label}</p>
      <p className="mt-1 text-slate-600">
        <span className="tabular-nums font-semibold">{item.count}</span>
        {' '}goal{item.count === 1 ? '' : 's'} · {pct}%
      </p>
    </div>
  )
}

export function ThrustAreaPieChart({ data }: ThrustAreaPieChartProps) {
  const nonZero = (data ?? []).filter((d) => d && d.count > 0)
  const total = nonZero.reduce((sum, d) => sum + d.count, 0)

  if (nonZero.length === 0 || total === 0) {
    return <EmptyState />
  }

  const enriched = nonZero.map((d) => ({ ...d, totalGoals: total }))

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={enriched}
            dataKey="count"
            nameKey="label"
            cx="50%"
            cy="50%"
            innerRadius={55}
            outerRadius={95}
            paddingAngle={1}
            stroke="#ffffff"
            strokeWidth={2}
            isAnimationActive
          >
            {enriched.map((entry, index) => (
              <Cell
                key={entry.thrust_area}
                fill={SLICE_COLOURS[index % SLICE_COLOURS.length]}
              />
            ))}
          </Pie>
          <Tooltip content={<ThrustTooltip />} />
          <Legend
            verticalAlign="bottom"
            align="center"
            iconType="circle"
            wrapperStyle={{ fontSize: 12, color: '#475569', paddingTop: 8 }}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="flex h-72 w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-slate-200 bg-slate-50/50 text-slate-400">
      <PieIcon size={32} className="opacity-60" />
      <p className="text-sm font-medium text-slate-500">No goal data yet</p>
      <p className="text-xs text-slate-400">
        Pie chart appears once employees start adding goals.
      </p>
    </div>
  )
}
