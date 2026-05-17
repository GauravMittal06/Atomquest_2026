/**
 * Employee Dashboard
 * KPI cards per docs/REPORTING_REQUIREMENTS.md §6 (Employee Dashboard)
 */
import { CheckCircle, ClipboardList, PieChart, TrendingUp } from 'lucide-react'
import { KpiCard } from '@/components/shared/KpiCard'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { useAuth } from '@/contexts/AuthContext'
import { THRUST_AREA_LABELS } from '@/types'

// Placeholder data — replace with real API calls once backend is wired
const MOCK_SHEET = {
  status: 'APPROVED' as const,
  period_label: 'FY 2025-26',
  goal_count: 6,
  total_weightage: 100,
  overall_score: 72.5,
}

const MOCK_GOALS = [
  { _id: '1', thrust_area: 'INNOVATION_TECHNOLOGY' as const, description: 'Launch AI-assisted code review tool', weightage: 20, achievement_pct: 80 },
  { _id: '2', thrust_area: 'DELIVERY_TIMELINESS' as const, description: 'Reduce sprint carryover to < 5 %', weightage: 20, achievement_pct: 95 },
  { _id: '3', thrust_area: 'QUALITY_PROCESS_EXCELLENCE' as const, description: 'Achieve > 85 % code coverage', weightage: 15, achievement_pct: 60 },
  { _id: '4', thrust_area: 'PEOPLE_DEVELOPMENT' as const, description: 'Complete 40 hrs of L&D', weightage: 15, achievement_pct: 50 },
  { _id: '5', thrust_area: 'CUSTOMER_SATISFACTION' as const, description: 'CSAT score ≥ 4.5', weightage: 15, achievement_pct: 100 },
  { _id: '6', thrust_area: 'COST_OPTIMISATION' as const, description: 'Reduce infra cost by 10 %', weightage: 15, achievement_pct: 40 },
]

export function EmployeeDashboard() {
  const { user } = useAuth()

  const checkinsDone = 4
  const checkinsRequired = 6

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Welcome, {user?.name?.split(' ')[0]} 👋</h1>
        <p className="text-sm text-slate-500 mt-1">
          {MOCK_SHEET.period_label} · Goal Sheet status:{' '}
          <StatusBadge status={MOCK_SHEET.status} className="ml-1" />
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard
          label="Goals Defined"
          value={MOCK_SHEET.goal_count}
          sub={`Max 10 · Min 3`}
          icon={<ClipboardList size={18} />}
          accent="blue"
        />
        <KpiCard
          label="Weightage"
          value={`${MOCK_SHEET.total_weightage} %`}
          sub={MOCK_SHEET.total_weightage === 100 ? 'Balanced ✓' : 'Incomplete!'}
          icon={<PieChart size={18} />}
          accent={MOCK_SHEET.total_weightage === 100 ? 'green' : 'amber'}
        />
        <KpiCard
          label="Check-ins"
          value={`${checkinsDone} / ${checkinsRequired}`}
          sub="This period"
          icon={<CheckCircle size={18} />}
          accent="amber"
        />
        <KpiCard
          label="Current Score"
          value={`${MOCK_SHEET.overall_score} / 100`}
          sub="Based on latest check-ins"
          icon={<TrendingUp size={18} />}
          accent="purple"
        />
      </div>

      {/* Goals table */}
      <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b flex items-center justify-between">
          <h2 className="font-semibold text-slate-900">My Goals</h2>
          <span className="text-xs text-slate-400">FY 2025-26</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500 uppercase tracking-wide">
              <tr>
                <th className="px-5 py-3 text-left">Thrust Area</th>
                <th className="px-5 py-3 text-left">Description</th>
                <th className="px-5 py-3 text-right">Wt. %</th>
                <th className="px-5 py-3 text-right">Achievement</th>
                <th className="px-5 py-3 text-right">Score</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {MOCK_GOALS.map((goal) => {
                const score = ((goal.achievement_pct ?? 0) / 100) * goal.weightage
                return (
                  <tr key={goal._id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-3 text-slate-500 whitespace-nowrap">
                      {THRUST_AREA_LABELS[goal.thrust_area]}
                    </td>
                    <td className="px-5 py-3 text-slate-800 max-w-xs truncate">{goal.description}</td>
                    <td className="px-5 py-3 text-right font-medium">{goal.weightage}</td>
                    <td className="px-5 py-3 text-right">
                      <span
                        className={[
                          'font-semibold',
                          (goal.achievement_pct ?? 0) >= 80
                            ? 'text-green-600'
                            : (goal.achievement_pct ?? 0) >= 50
                            ? 'text-amber-600'
                            : 'text-red-500',
                        ].join(' ')}
                      >
                        {goal.achievement_pct} %
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right font-semibold text-slate-700">
                      {score.toFixed(1)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot className="bg-slate-50 text-xs font-semibold text-slate-700">
              <tr>
                <td colSpan={2} className="px-5 py-3">Total</td>
                <td className="px-5 py-3 text-right">100</td>
                <td />
                <td className="px-5 py-3 text-right">{MOCK_SHEET.overall_score}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  )
}
