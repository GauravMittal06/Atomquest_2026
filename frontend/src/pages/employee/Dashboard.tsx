/**
 * Employee Dashboard
 *
 * Data sources:
 *   GET /api/goalsheets/           — employee's own sheets (server-filtered)
 *   GET /api/goals/sheet/:id       — goals for the most recent sheet
 *
 * When status === 'RETURNED', the manager's feedback comment is displayed
 * in a prominent amber banner so the employee knows what to fix.
 *
 * KPI cards per docs/REPORTING_REQUIREMENTS.md §6 (Employee Dashboard).
 */

import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertCircle,
  CheckCircle,
  ClipboardList,
  Loader2,
  MessageSquareWarning,
  PieChart,
  TrendingUp,
} from 'lucide-react'

import api from '@/lib/api'
import { KpiCard } from '@/components/shared/KpiCard'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/contexts/AuthContext'
import { THRUST_AREA_LABELS, type Goal, type GoalSheet } from '@/types'

export function EmployeeDashboard() {
  const { user } = useAuth()
  const navigate = useNavigate()

  const [sheet, setSheet] = useState<GoalSheet | null>(null)
  const [goals, setGoals] = useState<Goal[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const checkinsDone = 0 // TODO: wire up when check-ins page is built
  const checkinsRequired = 6

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.get<GoalSheet[]>('/goalsheets/')
      const sheets = res.data
      if (sheets.length > 0) {
        const latest = sheets.sort(
          (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
        )[0]
        setSheet(latest)
        const goalsRes = await api.get<Goal[]>(`/goals/sheet/${latest._id}`)
        setGoals(goalsRes.data)
      }
    } catch {
      setError('Failed to load dashboard data.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

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
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            Welcome, {user?.name?.split(' ')[0]}
          </h1>
          <p className="text-sm text-slate-500 mt-1 flex items-center gap-2">
            {sheet ? (
              <>
                {sheet.period_label} · Goal Sheet status:
                <StatusBadge status={sheet.status} className="ml-1" />
              </>
            ) : (
              'No goal sheet yet for this period.'
            )}
          </p>
          {user?.reporting_to_name && (
            <p className="text-xs text-slate-400 mt-1">
              Reporting to:{' '}
              <span className="font-medium text-slate-600">{user.reporting_to_name}</span>
            </p>
          )}
        </div>
        {!sheet && (
          <Button
            variant="primary"
            size="sm"
            onClick={() => navigate('/employee/goals')}
          >
            Create Goal Sheet
          </Button>
        )}
      </div>

      {/* Error banner */}
      {error && (
        <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* ── Manager Feedback Banner (RETURNED) ── */}
      {sheet?.status === 'RETURNED' && sheet.review_comment && (
        <div className="rounded-xl border-2 border-amber-400 bg-amber-50 p-5 shadow-sm">
          <div className="flex items-start gap-3">
            <MessageSquareWarning className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
            <div className="flex-1">
              <p className="font-semibold text-amber-900 text-sm uppercase tracking-wide">
                Manager Feedback — Action Required
              </p>
              <p className="mt-2 text-sm text-amber-900 leading-relaxed whitespace-pre-wrap">
                {sheet.review_comment}
              </p>
              <div className="mt-3">
                <Button
                  size="sm"
                  onClick={() => navigate('/employee/goals')}
                  className="bg-amber-600 hover:bg-amber-700 text-white"
                >
                  Revise My Goal Sheet →
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Locked notice ── */}
      {(sheet?.status === 'LOCKED' || sheet?.status === 'APPROVED') && (
        <div className="rounded-xl border border-purple-200 bg-purple-50 p-4 text-sm text-purple-800 flex items-center gap-3">
          <CheckCircle className="h-5 w-5 text-purple-600 shrink-0" />
          <span>
            Your goal sheet has been{' '}
            <strong>{sheet.status === 'LOCKED' ? 'approved and locked' : 'approved'}</strong>.
            Goals are now read-only. Check-ins are enabled.
          </span>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard
          label="Goals Defined"
          value={sheet ? `${sheet.goal_count} / 8` : '—'}
          sub={
            sheet
              ? sheet.goal_count >= 3
                ? 'Min 3 met ✓'
                : `Need ${3 - sheet.goal_count} more`
              : 'No sheet yet'
          }
          icon={<ClipboardList size={18} />}
          accent="blue"
        />
        <KpiCard
          label="Weightage"
          value={sheet ? `${sheet.total_weightage} %` : '—'}
          sub={
            sheet
              ? sheet.total_weightage === 100
                ? 'Balanced ✓'
                : 'Incomplete!'
              : '—'
          }
          icon={<PieChart size={18} />}
          accent={!sheet || sheet.total_weightage === 100 ? 'green' : 'amber'}
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
          value={
            sheet?.overall_score != null
              ? `${sheet.overall_score.toFixed(1)} / 100`
              : '—'
          }
          sub="Based on latest check-ins"
          icon={<TrendingUp size={18} />}
          accent="purple"
        />
      </div>

      {/* Goals table */}
      {sheet && goals.length > 0 && (
        <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b flex items-center justify-between bg-slate-50">
            <h2 className="font-semibold text-slate-900">My Goals</h2>
            <span className="text-xs text-slate-400">{sheet.period_label}</span>
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
                {goals.map((goal) => {
                  const score = ((goal.achievement_pct ?? 0) / 100) * goal.weightage
                  return (
                    <tr
                      key={goal._id}
                      className="hover:bg-slate-50 transition-colors"
                    >
                      <td className="px-5 py-3 text-slate-500 whitespace-nowrap text-xs">
                        {THRUST_AREA_LABELS[goal.thrust_area]}
                      </td>
                      <td className="px-5 py-3 text-slate-800 max-w-xs">
                        <span className="line-clamp-2">{goal.description}</span>
                      </td>
                      <td className="px-5 py-3 text-right font-medium">
                        {goal.weightage}
                      </td>
                      <td className="px-5 py-3 text-right">
                        {goal.achievement_pct != null ? (
                          <span
                            className={
                              goal.achievement_pct >= 80
                                ? 'font-semibold text-green-600'
                                : goal.achievement_pct >= 50
                                ? 'font-semibold text-amber-600'
                                : 'font-semibold text-red-500'
                            }
                          >
                            {goal.achievement_pct.toFixed(1)} %
                          </span>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-right font-semibold text-slate-700">
                        {goal.achievement_pct != null ? score.toFixed(1) : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot className="bg-slate-50 text-xs font-semibold text-slate-700">
                <tr>
                  <td colSpan={2} className="px-5 py-3">
                    Total
                  </td>
                  <td className="px-5 py-3 text-right">{sheet.total_weightage}</td>
                  <td />
                  <td className="px-5 py-3 text-right">
                    {sheet.overall_score != null
                      ? sheet.overall_score.toFixed(1)
                      : '—'}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* Empty state */}
      {!sheet && !loading && (
        <div className="flex flex-col items-center gap-3 py-16 text-slate-400">
          <ClipboardList size={40} />
          <p className="text-base font-semibold text-slate-600">No goal sheet yet</p>
          <p className="text-sm">
            Start by creating your goal sheet for FY 2025-26.
          </p>
          <Button
            variant="primary"
            size="sm"
            onClick={() => navigate('/employee/goals')}
          >
            Create Goal Sheet
          </Button>
        </div>
      )}
    </div>
  )
}
