/**
 * Employee Dashboard
 *
 * Answers: "What is my current status and what do I need to do?"
 *
 * Data sources:
 *   GET /api/goalsheets/       — employee's own sheets (server-filtered)
 *   GET /api/goals/sheet/:id   — goals for the most recent sheet
 *   GET /api/system/cycle-status — current appraisal window (CHECKIN_RULES.md)
 *
 * Information hierarchy:
 *   1. Workflow status header     — current state at a glance
 *   2. Attention banners          — only rendered when action is needed
 *   3. Compact stat strip         — 4 key numbers
 *   4. Goals table                — main content body
 *   5. Empty state                — when no sheet exists
 *
 * All existing logic (API calls, navigation, banner conditions) preserved.
 * Only visual hierarchy and component weight changed.
 */
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertCircle,
  CheckCircle2,
  ClipboardList,
  Clock,
  Loader2,
  MessageSquareWarning,
  ShieldAlert,
} from 'lucide-react'

import api from '@/lib/api'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/contexts/AuthContext'
import { useCycleStatus } from '@/lib/useCycleStatus'
import { isCheckInWindowOpen, THRUST_AREA_LABELS, type AuditLogEntry, type Goal, type GoalSheet } from '@/types'

// ---------------------------------------------------------------------------
// Helpers — preserved from previous implementation
// ---------------------------------------------------------------------------

function getLatestUnlockEntry(sheet: GoalSheet): AuditLogEntry | null {
  const entries = (sheet.audit_log ?? []).filter((e) => e.action === 'UNLOCKED')
  if (!entries.length) return null
  return entries.reduce((latest, e) =>
    new Date(e.timestamp) > new Date(latest.timestamp) ? e : latest,
  )
}

function formatTs(ts: string): string {
  try {
    return new Date(ts).toLocaleString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
  } catch { return ts }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function EmployeeDashboard() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const { status: cycleStatus } = useCycleStatus()

  const [sheet, setSheet] = useState<GoalSheet | null>(null)
  const [goals, setGoals] = useState<Goal[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

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

  useEffect(() => { loadData() }, [loadData])

  // Derived values
  const unlockEntry = sheet ? getLatestUnlockEntry(sheet) : null
  const isAdminReturned = sheet?.status === 'RETURNED' && !!unlockEntry
  const isManagerReturned = sheet?.status === 'RETURNED' && !unlockEntry && !!sheet.review_comment
  const isLockedOrApproved = sheet?.status === 'LOCKED' || sheet?.status === 'APPROVED'
  const needsAction = isAdminReturned || isManagerReturned || sheet?.status === 'DRAFT'

  // Cycle window chip: only say "Goal Setting Open" when the employee can
  // actually edit their sheet. If the sheet is SUBMITTED / APPROVED / LOCKED
  // the goal-setting window is irrelevant to the user — don't imply editability.
  const sheetIsEditable = !sheet || sheet.status === 'DRAFT' || sheet.status === 'RETURNED'
  const cycleChipVisible = !!cycleStatus && (
    cycleStatus.state !== 'GOAL_SETTING_OPEN' || sheetIsEditable
  )
  const checkInWindowOpen = cycleStatus ? isCheckInWindowOpen(cycleStatus.state) : false

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-7 w-7 animate-spin text-slate-400" />
      </div>
    )
  }

  return (
    <div className="space-y-4">

      {/* ── 1. Header: workflow status at a glance ─────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">
            {user?.name?.split(' ')[0]}'s Goals
          </h1>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            {sheet ? (
              <>
                <span className="text-xs text-slate-400">{sheet.period_label}</span>
                <span className="text-slate-300 text-xs">·</span>
                <StatusBadge status={sheet.status} />
                {needsAction && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-700 text-[10px] font-semibold px-2 py-0.5">
                    <AlertCircle size={9} /> Action needed
                  </span>
                )}
              </>
            ) : (
              <span className="text-xs text-slate-400">No goal sheet for this period</span>
            )}
          </div>
          {user?.reporting_to_name && (
            <p className="text-xs text-slate-400 mt-1">
              Reports to <span className="font-medium text-slate-600">{user.reporting_to_name}</span>
            </p>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Cycle window indicator — only shown when it reflects an actionable state */}
          {cycleChipVisible && cycleStatus && (
            <div className={`hidden sm:flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium ${
              cycleStatus.state === 'GOAL_SETTING_OPEN'
                ? 'border-blue-200 bg-blue-50 text-blue-700'
                : checkInWindowOpen
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                : 'border-slate-200 bg-slate-50 text-slate-500'
            }`}>
              <Clock size={11} />
              {cycleStatus.state === 'GOAL_SETTING_OPEN'
                ? 'Goal Setting Open'
                : checkInWindowOpen
                ? `${cycleStatus.active_quarter} Check-in Open`
                : 'Between Windows'}
            </div>
          )}
          {!sheet && (
            <Button variant="primary" size="sm" onClick={() => navigate('/employee/goals')}>
              Create Goal Sheet
            </Button>
          )}
          {sheet?.status === 'DRAFT' && (
            <Button variant="primary" size="sm" onClick={() => navigate('/employee/goals')}>
              Continue Editing →
            </Button>
          )}
        </div>
      </div>

      {/* ── Error ── */}
      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertCircle size={14} className="shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* ── 2. Attention banners — only when action needed ─────────────── */}

      {/* Admin unlock banner */}
      {isAdminReturned && unlockEntry && (
        <div className="rounded-lg border border-purple-200 bg-purple-50 p-4">
          <div className="flex items-start gap-3">
            <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-purple-100">
              <ShieldAlert size={13} className="text-purple-600" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-sm font-semibold text-purple-900">Goal Sheet Reopened by Admin</p>
                <StatusBadge status="RETURNED" />
              </div>
              {unlockEntry.comment && (
                <p className="mt-1.5 text-xs text-slate-700 bg-white rounded border border-purple-100 px-3 py-2 leading-relaxed">
                  <span className="font-semibold text-purple-700">Reason: </span>
                  {unlockEntry.comment}
                </p>
              )}
              <div className="mt-2 flex items-center justify-between gap-3 flex-wrap">
                <p className="text-[11px] text-purple-600 flex items-center gap-1">
                  <Clock size={10} /> Unlocked {formatTs(unlockEntry.timestamp)}
                </p>
                <button
                  onClick={() => navigate('/employee/goals')}
                  className="text-xs font-semibold text-purple-700 hover:text-purple-900 underline underline-offset-2 transition-colors"
                >
                  Revise & Resubmit →
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Manager feedback banner */}
      {isManagerReturned && sheet?.review_comment && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
          <div className="flex items-start gap-3">
            <MessageSquareWarning size={16} className="mt-0.5 shrink-0 text-amber-600" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-amber-900">Manager Feedback — Action Required</p>
              <p className="mt-1.5 text-sm text-amber-800 leading-relaxed whitespace-pre-wrap">
                {sheet.review_comment}
              </p>
              <div className="mt-2">
                <button
                  onClick={() => navigate('/employee/goals')}
                  className="text-xs font-semibold text-amber-700 hover:text-amber-900 underline underline-offset-2 transition-colors"
                >
                  Revise My Goal Sheet →
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Locked / approved — subtle confirmation, not a banner */}
      {isLockedOrApproved && (
        <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 text-xs text-slate-600">
          <CheckCircle2 size={13} className="text-emerald-500 shrink-0" />
          <span>
            Goal sheet{' '}
            <strong className="text-slate-800">
              {sheet.status === 'LOCKED' ? 'approved and locked' : 'approved'}
            </strong>.{' '}
            Goals are read-only.{' '}
            {checkInWindowOpen
              ? <span className="text-emerald-700 font-medium">Check-ins enabled for {cycleStatus?.active_quarter}.</span>
              : <span className="text-slate-500">Check-ins closed — between windows.</span>}
          </span>
        </div>
      )}

      {/* ── 3. Compact stat strip ──────────────────────────────────────── */}
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
            value={sheet.overall_score != null ? `${sheet.overall_score.toFixed(1)}` : '—'}
            sub={sheet.overall_score != null ? 'of 100 pts' : 'After check-ins'}
          />
          <StatTile
            label="Period"
            value={sheet.period_label}
            sub={cycleStatus
              ? checkInWindowOpen
                ? `${cycleStatus.active_quarter} check-in open`
                : cycleStatus.state === 'GOAL_SETTING_OPEN'
                ? 'Goal setting window'
                : 'Between windows'
              : 'FY 2025-26'}
          />
        </div>
      )}

      {/* ── 4. Goals table — main content ─────────────────────────────── */}
      {sheet && goals.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100 bg-slate-50">
            <h2 className="text-sm font-semibold text-slate-900">My Goals</h2>
            <div className="flex items-center gap-3">
              <span className="text-xs text-slate-400">{sheet.period_label}</span>
              <button
                onClick={() => navigate('/employee/goals')}
                className="text-xs font-medium text-slate-500 hover:text-slate-800 transition-colors"
              >
                Manage →
              </button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  <th className="px-5 py-2.5 text-left text-xs font-medium text-slate-500 uppercase tracking-wide">
                    Thrust Area
                  </th>
                  <th className="px-5 py-2.5 text-left text-xs font-medium text-slate-500 uppercase tracking-wide">
                    Description
                  </th>
                  <th className="px-5 py-2.5 text-right text-xs font-medium text-slate-500 uppercase tracking-wide">
                    Wt.%
                  </th>
                  <th className="px-5 py-2.5 text-right text-xs font-medium text-slate-500 uppercase tracking-wide">
                    Achievement
                  </th>
                  <th className="px-5 py-2.5 text-right text-xs font-medium text-slate-500 uppercase tracking-wide">
                    Score
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {goals.map((goal) => {
                  const score = ((goal.achievement_pct ?? 0) / 100) * goal.weightage
                  return (
                    <tr key={goal._id} className="hover:bg-slate-50/60 transition-colors">
                      <td className="px-5 py-3 text-xs text-slate-500 whitespace-nowrap">
                        {THRUST_AREA_LABELS[goal.thrust_area]}
                      </td>
                      <td className="px-5 py-3 text-slate-800 max-w-xs">
                        <span className="line-clamp-2 text-sm">{goal.description}</span>
                      </td>
                      <td className="px-5 py-3 text-right text-sm font-medium text-slate-700">
                        {goal.weightage}
                      </td>
                      <td className="px-5 py-3 text-right">
                        {goal.achievement_pct != null ? (
                          <span className={
                            goal.achievement_pct >= 80
                              ? 'text-sm font-semibold text-emerald-600'
                              : goal.achievement_pct >= 50
                              ? 'text-sm font-semibold text-amber-600'
                              : 'text-sm font-semibold text-red-500'
                          }>
                            {goal.achievement_pct.toFixed(1)}%
                          </span>
                        ) : (
                          <span className="text-xs text-slate-300">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-right text-sm font-semibold text-slate-700">
                        {goal.achievement_pct != null ? score.toFixed(1) : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot className="bg-slate-50 border-t border-slate-100">
                <tr>
                  <td colSpan={2} className="px-5 py-2.5 text-xs font-semibold text-slate-600">
                    Total
                  </td>
                  <td className="px-5 py-2.5 text-right text-sm font-bold text-slate-800">
                    {sheet.total_weightage}
                  </td>
                  <td />
                  <td className="px-5 py-2.5 text-right text-sm font-bold text-slate-800">
                    {sheet.overall_score != null ? sheet.overall_score.toFixed(1) : '—'}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* Goals defined but no check-ins yet */}
      {sheet && goals.length === 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <ClipboardList size={28} className="mx-auto text-slate-300 mb-3" />
          <p className="text-sm font-semibold text-slate-600">No goals added yet</p>
          <p className="text-xs text-slate-400 mt-1 mb-4">
            Add at least 3 goals to your goal sheet before submitting.
          </p>
          <Button size="sm" variant="primary" onClick={() => navigate('/employee/goals')}>
            Add Goals →
          </Button>
        </div>
      )}

      {/* ── 5. Empty state — no sheet ─────────────────────────────────── */}
      {!sheet && (
        <div className="rounded-xl border border-slate-200 bg-white p-12 text-center shadow-sm">
          <ClipboardList size={32} className="mx-auto text-slate-300 mb-3" />
          <p className="text-base font-semibold text-slate-700">No goal sheet yet</p>
          <p className="text-sm text-slate-400 mt-1 mb-5 max-w-xs mx-auto">
            Create your goal sheet for FY 2025-26 to get started.
          </p>
          <Button variant="primary" size="sm" onClick={() => navigate('/employee/goals')}>
            Create Goal Sheet
          </Button>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Local: compact stat tile (same pattern as Admin dashboard KpiTile)
// ---------------------------------------------------------------------------

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
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
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
