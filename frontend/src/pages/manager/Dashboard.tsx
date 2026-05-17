/**
 * Manager L1 Dashboard
 *
 * Data sources:
 *   GET /api/users/team        — direct reports
 *   GET /api/goalsheets/       — all team goal sheets (filtered server-side)
 *
 * "Review →" links open /manager/review/:sheetId for SUBMITTED sheets.
 * KPI cards per docs/REPORTING_REQUIREMENTS.md §6 (Manager Dashboard).
 */

import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CheckCircle, Clock, Loader2, TrendingUp, Users } from 'lucide-react'

import api from '@/lib/api'
import { KpiCard } from '@/components/shared/KpiCard'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { PushSharedKpiForm } from '@/components/shared-goals/PushSharedKpiForm'
import { useAuth } from '@/contexts/AuthContext'
import type { GoalSheet, GoalSheetStatus, User } from '@/types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TeamRow {
  user: User
  sheet: GoalSheet | null
}

// ---------------------------------------------------------------------------
// ManagerDashboard
// ---------------------------------------------------------------------------

export function ManagerDashboard() {
  const { user } = useAuth()
  const navigate = useNavigate()

  const [rows, setRows] = useState<TeamRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [teamRes, sheetsRes] = await Promise.all([
        api.get<User[]>('/users/team'),
        api.get<GoalSheet[]>('/goalsheets/'),
      ])

      const sheetByEmployee = new Map<string, GoalSheet>()
      for (const s of sheetsRes.data) {
        // Keep the most recent sheet per employee
        const existing = sheetByEmployee.get(s.employee_id)
        if (!existing || new Date(s.updated_at) > new Date(existing.updated_at)) {
          sheetByEmployee.set(s.employee_id, s)
        }
      }

      setRows(
        teamRes.data.map((u) => ({
          user: u,
          sheet: sheetByEmployee.get(u._id) ?? null,
        })),
      )
    } catch {
      setError('Failed to load team data. Please refresh.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  // ---------------------------------------------------------------------------
  // Derived KPIs
  // ---------------------------------------------------------------------------

  const teamSize = rows.length
  const pendingApprovals = rows.filter((r) => r.sheet?.status === 'SUBMITTED').length
  const lockedCount = rows.filter(
    (r) => r.sheet?.status === 'LOCKED' || r.sheet?.status === 'APPROVED',
  ).length
  const scores = rows
    .filter((r) => r.sheet?.overall_score != null)
    .map((r) => r.sheet!.overall_score as number)
  const avgScore =
    scores.length
      ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1)
      : null

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Team Overview</h1>
        <p className="text-sm text-slate-500 mt-1">
          Welcome back, {user?.name} · FY 2025-26
        </p>
      </div>

      {/* Error banner */}
      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <span>{error}</span>
          <button
            onClick={loadData}
            className="ml-auto text-xs font-medium underline hover:no-underline"
          >
            Retry
          </button>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard
          label="Team Size"
          value={teamSize}
          sub="Direct reports"
          icon={<Users size={18} />}
          accent="blue"
        />
        <KpiCard
          label="Pending Approvals"
          value={pendingApprovals}
          sub={pendingApprovals > 0 ? 'Action required' : 'All reviewed'}
          icon={<Clock size={18} />}
          accent="amber"
        />
        <KpiCard
          label="Locked / Approved"
          value={lockedCount}
          sub={`of ${teamSize} team members`}
          icon={<CheckCircle size={18} />}
          accent="green"
        />
        <KpiCard
          label="Avg Team Score"
          value={avgScore !== null ? `${avgScore} / 100` : '—'}
          sub="Approved / Locked only"
          icon={<TrendingUp size={18} />}
          accent="purple"
        />
      </div>

      {/* ── Push Departmental KPI ── */}
      <PushSharedKpiForm teamMembers={rows.map((r) => r.user)} />

      {/* Team table */}
      <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b flex items-center justify-between bg-slate-50">
          <h2 className="font-semibold text-slate-900">Team Goal Sheets</h2>
          <span className="text-xs text-slate-400">FY 2025-26</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500 uppercase tracking-wide">
              <tr>
                <th className="px-5 py-3 text-left">Employee</th>
                <th className="px-5 py-3 text-left">Department</th>
                <th className="px-5 py-3 text-left">Status</th>
                <th className="px-5 py-3 text-right">Goals</th>
                <th className="px-5 py-3 text-right">Wt. %</th>
                <th className="px-5 py-3 text-right">Score</th>
                <th className="px-5 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-5 py-10 text-center text-slate-400"
                  >
                    No team members found.
                  </td>
                </tr>
              ) : (
                rows.map(({ user: member, sheet }) => (
                  <tr
                    key={member._id}
                    className="hover:bg-slate-50 transition-colors"
                  >
                    <td className="px-5 py-3">
                      <div className="font-medium text-slate-900">{member.name}</div>
                      <div className="text-xs text-slate-400">{member.employee_id}</div>
                    </td>
                    <td className="px-5 py-3 text-slate-500">{member.department}</td>
                    <td className="px-5 py-3">
                      {sheet ? (
                        <StatusBadge status={sheet.status as GoalSheetStatus} />
                      ) : (
                        <span className="text-xs text-slate-400 italic">No sheet</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right text-slate-700">
                      {sheet ? sheet.goal_count : '—'}
                    </td>
                    <td className="px-5 py-3 text-right">
                      {sheet ? (
                        <span
                          className={
                            sheet.total_weightage === 100
                              ? 'text-green-600 font-semibold'
                              : 'text-amber-600'
                          }
                        >
                          {sheet.total_weightage} %
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-5 py-3 text-right font-semibold text-slate-700">
                      {sheet?.overall_score != null
                        ? `${sheet.overall_score.toFixed(1)}`
                        : '—'}
                    </td>
                    <td className="px-5 py-3 text-right">
                      {sheet?.status === 'SUBMITTED' ? (
                        <button
                          onClick={() =>
                            navigate(`/manager/review/${sheet._id}`)
                          }
                          className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 transition-colors"
                        >
                          Review →
                        </button>
                      ) : sheet?.status === 'RETURNED' ? (
                        <span className="text-xs text-amber-600 font-medium italic">
                          Awaiting resubmission
                        </span>
                      ) : sheet?.status === 'LOCKED' ? (
                        <span className="text-xs text-purple-600 font-medium">
                          ✓ Locked
                        </span>
                      ) : sheet?.status === 'APPROVED' ? (
                        <span className="text-xs text-green-600 font-medium">
                          ✓ Approved
                        </span>
                      ) : (
                        <span className="text-xs text-slate-300">—</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
