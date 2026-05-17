/**
 * Admin Dashboard
 * KPI cards per docs/REPORTING_REQUIREMENTS.md §6 (Admin Dashboard)
 */
import { Activity, CheckCircle, TrendingUp, Users } from 'lucide-react'
import { KpiCard } from '@/components/shared/KpiCard'
import { StatusBadge } from '@/components/shared/StatusBadge'
import type { GoalSheetStatus } from '@/types'

// Placeholder data
const STATUS_COUNTS: Record<GoalSheetStatus, number> = {
  DRAFT: 12,
  SUBMITTED: 8,
  RETURNED: 3,
  APPROVED: 47,
  LOCKED: 20,
}

const DEPT_STATS = [
  { dept: 'Engineering', employees: 38, avgScore: 71.2, compliance: 88 },
  { dept: 'Product', employees: 14, avgScore: 74.8, compliance: 93 },
  { dept: 'Sales', employees: 22, avgScore: 68.5, compliance: 77 },
  { dept: 'HR & Administration', employees: 8, avgScore: 79.0, compliance: 100 },
  { dept: 'Finance', employees: 10, avgScore: 72.1, compliance: 90 },
]

export function AdminDashboard() {
  const total = Object.values(STATUS_COUNTS).reduce((a, b) => a + b, 0)
  const approved = STATUS_COUNTS.APPROVED + STATUS_COUNTS.LOCKED
  const orgScore = DEPT_STATS.reduce((sum, d) => sum + d.avgScore * d.employees, 0) /
    DEPT_STATS.reduce((s, d) => s + d.employees, 0)
  const orgCompliance =
    DEPT_STATS.reduce((sum, d) => sum + d.compliance * d.employees, 0) /
    DEPT_STATS.reduce((s, d) => s + d.employees, 0)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Organisation Overview</h1>
        <p className="text-sm text-slate-500 mt-1">FY 2025-26 · All departments</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard
          label="Total Employees"
          value={total}
          sub="Active users"
          icon={<Users size={18} />}
          accent="blue"
        />
        <KpiCard
          label="Sheets by Status"
          value={`${approved} Approved`}
          sub={`${STATUS_COUNTS.SUBMITTED} pending review`}
          icon={<Activity size={18} />}
          accent="amber"
        />
        <KpiCard
          label="Org Score"
          value={`${orgScore.toFixed(1)} / 100`}
          sub="Approved / Locked only"
          icon={<TrendingUp size={18} />}
          accent="green"
        />
        <KpiCard
          label="Check-in Compliance"
          value={`${orgCompliance.toFixed(0)} %`}
          sub="Org-wide"
          icon={<CheckCircle size={18} />}
          accent="purple"
        />
      </div>

      {/* Status breakdown */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b">
            <h2 className="font-semibold text-slate-900">Goal Sheet Status Breakdown</h2>
          </div>
          <ul className="divide-y divide-slate-100">
            {(Object.entries(STATUS_COUNTS) as [GoalSheetStatus, number][]).map(([status, count]) => (
              <li key={status} className="flex items-center justify-between px-5 py-3">
                <StatusBadge status={status} />
                <div className="flex items-center gap-3">
                  <div className="w-32 h-2 rounded-full bg-slate-100 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-slate-400"
                      style={{ width: `${(count / total) * 100}%` }}
                    />
                  </div>
                  <span className="text-sm font-semibold text-slate-700 w-6 text-right">{count}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>

        {/* Department table */}
        <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b flex items-center justify-between">
            <h2 className="font-semibold text-slate-900">Department Summary</h2>
            <button className="text-xs text-blue-600 hover:text-blue-800 font-medium">Export</button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500 uppercase tracking-wide">
                <tr>
                  <th className="px-5 py-3 text-left">Department</th>
                  <th className="px-5 py-3 text-right">Employees</th>
                  <th className="px-5 py-3 text-right">Avg Score</th>
                  <th className="px-5 py-3 text-right">Compliance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {DEPT_STATS.map((row) => (
                  <tr key={row.dept} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-3 font-medium text-slate-900">{row.dept}</td>
                    <td className="px-5 py-3 text-right text-slate-600">{row.employees}</td>
                    <td className="px-5 py-3 text-right font-semibold text-slate-700">{row.avgScore}</td>
                    <td className="px-5 py-3 text-right">
                      <span
                        className={[
                          'font-semibold',
                          row.compliance >= 90 ? 'text-green-600' : row.compliance >= 75 ? 'text-amber-600' : 'text-red-500',
                        ].join(' ')}
                      >
                        {row.compliance} %
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
