/**
 * Employee Dashboard — "Where do I stand right now?"
 *
 * Read-only status-at-a-glance: summary cards, goal sheet status banner,
 * and quarterly score trend. Goal definitions live on My Goal Sheet.
 */
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertCircle, ClipboardList } from 'lucide-react'

import api from '@/lib/api'
import { buildQuarterlyScores } from '@/lib/quarterlyScoreTrend'
import { useCycleStatus } from '@/lib/useCycleStatus'
import { formatScore } from '@/utils/scoring'
import { GoalSheetStatusBanner } from '@/components/employee/GoalSheetStatusBanner'
import { ScoreTrendChart } from '@/components/employee/ScoreTrendChart'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useAuth } from '@/contexts/AuthContext'
import { isCheckInWindowOpen, type CheckIn, type Goal, type GoalSheet } from '@/types'

export function EmployeeDashboard() {
  const { user, authVersion } = useAuth()
  const navigate = useNavigate()
  const { status: cycleStatus, loading: cycleLoading } = useCycleStatus()

  const [sheet, setSheet] = useState<GoalSheet | null>(null)
  const [goals, setGoals] = useState<Goal[]>([])
  const [checkins, setCheckins] = useState<CheckIn[]>([])
  const [loading, setLoading] = useState(true)
  const [chartError, setChartError] = useState<string | null>(null)
  const [sheetError, setSheetError] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    setLoading(true)
    setSheetError(null)
    setChartError(null)
    try {
      const res = await api.get<GoalSheet[]>('/goalsheets/')
      const sheets = res.data
      if (sheets.length === 0) {
        setSheet(null)
        setGoals([])
        setCheckins([])
        return
      }
      const latest = sheets.sort(
        (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
      )[0]
      setSheet(latest)

      try {
        const [goalsRes, checkinsRes] = await Promise.all([
          api.get<Goal[]>(`/goals/sheet/${latest._id}`),
          api.get<CheckIn[]>(`/checkins/sheet/${latest._id}`),
        ])
        setGoals(goalsRes.data)
        setCheckins(checkinsRes.data)
      } catch {
        setChartError('Failed to load score trend data.')
        setGoals([])
        setCheckins([])
      }
    } catch {
      setSheetError('Failed to load dashboard data.')
      setSheet(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData, authVersion])

  const checkInWindowOpen = cycleStatus ? isCheckInWindowOpen(cycleStatus.state) : false
  const quarterlyScores = buildQuarterlyScores(goals, checkins)

  if (loading || cycleLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-20 w-full" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="breadcrumb">Employee · Dashboard</p>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="page-title">{user?.name ?? 'My Dashboard'}</h1>
            {checkInWindowOpen && cycleStatus?.active_quarter && (
              <Badge
                variant="outline"
                className="border-emerald-300 bg-emerald-50 text-emerald-700"
              >
                {cycleStatus.active_quarter} Check-in Open
              </Badge>
            )}
          </div>
          {user?.employee_id && (
            <p className="mt-1 text-xs text-slate-500 font-mono">{user.employee_id}</p>
          )}
          {user?.reporting_to_name && (
            <p className="text-xs text-slate-400 mt-1">
              Reports to{' '}
              <span className="font-medium text-slate-600">{user.reporting_to_name}</span>
            </p>
          )}
        </div>

        {!sheet && (
          <Button
            variant="primary"
            size="sm"
            className="btn-primary btn-sm"
            onClick={() => navigate('/employee/goals')}
          >
            Create Goal Sheet
          </Button>
        )}
      </div>

      {sheetError && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertCircle size={14} className="shrink-0" />
          <span>{sheetError}</span>
        </div>
      )}

      {/* Summary cards */}
      {sheet && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile
            label="Goals"
            value={`${sheet.goal_count} / 8`}
            sub={sheet.goal_count >= 3 ? 'Min 3 met ✓' : `Need ${3 - sheet.goal_count} more`}
            warn={sheet.goal_count < 3}
          />
          <StatTile
            label="Weightage"
            value={`${sheet.total_weightage}%`}
            sub={sheet.total_weightage === 100 ? 'Balanced ✓' : 'Must reach 100%'}
            warn={sheet.total_weightage !== 100}
          />
          <StatTile
            label="Score"
            value={formatScore(sheet.overall_score)}
            sub={sheet.overall_score != null ? 'of 100 pts' : 'After check-ins'}
          />
          <StatTile
            label="Period"
            value={sheet.period_label}
            sub={
              cycleStatus
                ? checkInWindowOpen
                  ? `${cycleStatus.active_quarter} check-in open`
                  : cycleStatus.state === 'GOAL_SETTING_OPEN'
                    ? 'Goal setting window'
                    : 'Between windows'
                : 'FY 2025-26'
            }
          />
        </div>
      )}

      {sheet && (
        <GoalSheetStatusBanner
          sheet={sheet}
          checkInWindowOpen={checkInWindowOpen}
        />
      )}

      {sheet && (
        chartError ? (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {chartError}
          </div>
        ) : (
          <ScoreTrendChart data={quarterlyScores} periodLabel={sheet.period_label} />
        )
      )}

      {!sheet && !sheetError && (
        <div className="card p-12 text-center">
          <ClipboardList size={32} className="mx-auto text-slate-300 mb-3" />
          <p className="text-base font-semibold text-slate-700">No goal sheet yet</p>
          <p className="text-sm text-slate-400 mt-1 mb-5 max-w-xs mx-auto">
            Create your goal sheet for FY 2025-26 to get started.
          </p>
          <Button
            variant="primary"
            size="sm"
            className="btn-primary btn-sm"
            onClick={() => navigate('/employee/goals')}
          >
            Create Goal Sheet
          </Button>
        </div>
      )}
    </div>
  )
}

function StatTile({
  label,
  value,
  sub,
  warn = false,
}: {
  label: string
  value: string | number
  sub: string
  warn?: boolean
}) {
  return (
    <div className="card-sm">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
        {label}
      </p>
      <p className={`text-xl font-bold tabular-nums ${warn ? 'text-amber-600' : 'text-slate-900'}`}>
        {value}
      </p>
      <p className={`text-[11px] mt-0.5 truncate ${warn ? 'text-amber-500' : 'text-slate-400'}`}>
        {sub}
      </p>
    </div>
  )
}
