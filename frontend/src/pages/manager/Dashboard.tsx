/**
 * Manager Dashboard
 * KPI cards per docs/REPORTING_REQUIREMENTS.md §6 (Manager Dashboard)
 */
import { CheckCircle, Clock, TrendingUp, Users } from 'lucide-react'
import { KpiCard } from '@/components/shared/KpiCard'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { useAuth } from '@/contexts/AuthContext'
import type { GoalSheetStatus } from '@/types'

// Placeholder data
const MOCK_TEAM = [
  { id: '1', name: 'Priya Sharma', department: 'Engineering', status: 'APPROVED' as GoalSheetStatus, score: 72.5, checkins: 4, total: 6 },
  { id: '2', name: 'Arjun Nair', department: 'Engineering', status: 'SUBMITTED' as GoalSheetStatus, score: null, checkins: 0, total: 5 },
  { id: '3', name: 'Kavya Reddy', department: 'Engineering', status: 'RETURNED' as GoalSheetStatus, score: null, checkins: 0, total: 4 },
  { id: '4', name: 'Siddharth Joshi', department: 'Engineering', status: 'DRAFT' as GoalSheetStatus, score: null, checkins: 0, total: 0 },
  { id: '5', name: 'Meera Iyer', department: 'Engineering', status: 'APPROVED' as GoalSheetStatus, score: 85.0, checkins: 5, total: 6 },
]

export function ManagerDashboard() {
  const { user } = useAuth()

  const pendingApprovals = MOCK_TEAM.filter((m) => m.status === 'SUBMITTED').length
  const approvedCount = MOCK_TEAM.filter((m) => m.status === 'APPROVED').length
  const scores = MOCK_TEAM.filter((m) => m.score !== null).map((m) => m.score as number)
  const avgScore = scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1) : '—'

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Team Overview</h1>
        <p className="text-sm text-slate-500 mt-1">Welcome back, {user?.name} · FY 2025-26</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard
          label="Team Size"
          value={MOCK_TEAM.length}
          sub="Direct reports"
          icon={<Users size={18} />}
          accent="blue"
        />
        <KpiCard
          label="Pending Approvals"
          value={pendingApprovals}
          sub="Action required"
          icon={<Clock size={18} />}
          accent="amber"
        />
        <KpiCard
          label="Approved Sheets"
          value={approvedCount}
          sub={`of ${MOCK_TEAM.length} team members`}
          icon={<CheckCircle size={18} />}
          accent="green"
        />
        <KpiCard
          label="Avg Team Score"
          value={avgScore === '—' ? '—' : `${avgScore} / 100`}
          sub="Approved / Locked only"
          icon={<TrendingUp size={18} />}
          accent="purple"
        />
      </div>

      {/* Team table */}
      <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b flex items-center justify-between">
          <h2 className="font-semibold text-slate-900">Team Goal Sheets</h2>
          <button className="text-xs text-blue-600 hover:text-blue-800 font-medium">Export CSV</button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500 uppercase tracking-wide">
              <tr>
                <th className="px-5 py-3 text-left">Employee</th>
                <th className="px-5 py-3 text-left">Department</th>
                <th className="px-5 py-3 text-left">Status</th>
                <th className="px-5 py-3 text-right">Goals</th>
                <th className="px-5 py-3 text-right">Check-ins</th>
                <th className="px-5 py-3 text-right">Score</th>
                <th className="px-5 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {MOCK_TEAM.map((member) => (
                <tr key={member.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-5 py-3 font-medium text-slate-900">{member.name}</td>
                  <td className="px-5 py-3 text-slate-500">{member.department}</td>
                  <td className="px-5 py-3">
                    <StatusBadge status={member.status} />
                  </td>
                  <td className="px-5 py-3 text-right text-slate-700">{member.total || '—'}</td>
                  <td className="px-5 py-3 text-right text-slate-700">
                    {member.checkins > 0 ? `${member.checkins}/${member.total}` : '—'}
                  </td>
                  <td className="px-5 py-3 text-right font-semibold">
                    {member.score !== null ? `${member.score}` : '—'}
                  </td>
                  <td className="px-5 py-3 text-right">
                    {member.status === 'SUBMITTED' && (
                      <button className="text-xs font-semibold text-blue-600 hover:text-blue-800">
                        Review →
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
