/**
 * Manager Check-in Review page.
 *
 * Per the brief:
 *   - Display Planned vs. Actual data per team member.
 *   - Provide a structured Check-in Comment input that logs timestamped
 *     review notes (author, timestamp, quarter identifier — handled by
 *     backend POST /api/checkin-comments/).
 *
 * Aligned with:
 *   - docs/CHECKIN_RULES.md (banner + period selector)
 *   - docs/VALIDATION_RULES.md (live achievement % uses canonical formulas)
 *   - docs/REPORTING_REQUIREMENTS.md §Audit Log Rules
 *   - docs/ROLE_PERMISSIONS.md §Manager — "Add quarterly feedback comments"
 */

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  MessageSquarePlus,
  Send,
  TrendingUp,
  Users,
} from 'lucide-react'

import api from '@/lib/api'
import { cn } from '@/lib/utils'
import { calculateAchievementPercentage, calculateGoalScore, formatScore, UomType } from '@/utils/scoring'
import { useCycleStatus } from '@/lib/useCycleStatus'
import { CycleStatusBanner } from '@/components/checkins/CycleStatusBanner'
import { KpiCard } from '@/components/shared/KpiCard'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  ACTIVE_PERIOD_LABELS,
  PERIOD_LABEL_DISPLAY,
  THRUST_AREA_LABELS,
  cycleStateToPeriodLabel,
  type CheckIn,
  type CheckinComment,
  type Goal,
  type GoalSheet,
  type PeriodLabel,
  type User,
} from '@/types'

// ---------------------------------------------------------------------------
// Local types
// ---------------------------------------------------------------------------

interface TeamMemberData {
  user: User
  sheet: GoalSheet | null
  goals: Goal[]
  checkins: CheckIn[]
  comments: CheckinComment[]
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CheckInReviewPage() {
  const { status: cycle } = useCycleStatus()

  const [team, setTeam] = useState<TeamMemberData[]>([])
  const [loading, setLoading] = useState(true)
  const [pageError, setPageError] = useState<string | null>(null)

  const [selectedQuarter, setSelectedQuarter] = useState<PeriodLabel>('Q1')
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null)

  // Comment composer state, keyed by goal_sheet_id
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({})
  const [postingComment, setPostingComment] = useState<string | null>(null)
  const [commentErrors, setCommentErrors] = useState<Record<string, string>>({})

  // ---------------------------------------------------------------------------
  // Data loading
  // ---------------------------------------------------------------------------

  const loadAll = useCallback(async () => {
    setLoading(true)
    setPageError(null)
    try {
      const [teamRes, sheetsRes] = await Promise.all([
        api.get<User[]>('/users/team'),
        api.get<GoalSheet[]>('/goalsheets/'),
      ])

      const sheetByEmployee = new Map<string, GoalSheet>()
      for (const s of sheetsRes.data) {
        if (s.status !== 'APPROVED' && s.status !== 'LOCKED') continue
        const existing = sheetByEmployee.get(s.employee_id)
        if (!existing || new Date(s.updated_at) > new Date(existing.updated_at)) {
          sheetByEmployee.set(s.employee_id, s)
        }
      }

      const rows: TeamMemberData[] = await Promise.all(
        teamRes.data
          .filter((u) => u.role === 'EMPLOYEE')
          .map(async (u) => {
            const sheet = sheetByEmployee.get(u._id) ?? null
            if (!sheet) {
              return { user: u, sheet: null, goals: [], checkins: [], comments: [] }
            }
            const [goalsRes, checkinsRes, commentsRes] = await Promise.all([
              api.get<Goal[]>(`/goals/sheet/${sheet._id}`),
              api.get<CheckIn[]>(`/checkins/sheet/${sheet._id}`),
              api.get<CheckinComment[]>(
                `/checkin-comments/?goal_sheet_id=${sheet._id}`,
              ),
            ])
            return {
              user: u,
              sheet,
              goals: goalsRes.data,
              checkins: checkinsRes.data,
              comments: commentsRes.data,
            }
          }),
      )

      setTeam(rows)
      // Default to the first employee with an approved sheet
      const firstWithSheet = rows.find((r) => r.sheet)
      if (firstWithSheet) setSelectedEmployeeId(firstWithSheet.user._id)
    } catch {
      setPageError('Failed to load team check-in data. Please try again.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadAll()
  }, [loadAll])

  // Default selectedQuarter to the active quarter when the cycle is known
  useEffect(() => {
    if (!cycle) return
    const active = cycleStateToPeriodLabel(cycle.state)
    if (active) setSelectedQuarter(active)
  }, [cycle])

  // ---------------------------------------------------------------------------
  // Derived state
  // ---------------------------------------------------------------------------

  const active = team.find((t) => t.user._id === selectedEmployeeId) ?? null
  const eligibleTeam = team.filter((t) => t.sheet)

  const summary = useMemo(() => {
    let onTrack = 0
    let atRisk = 0
    let notStarted = 0
    let totalSheets = 0
    let totalScore = 0
    for (const member of eligibleTeam) {
      if (!member.sheet) continue
      totalSheets += 1
      const sheetScore = member.sheet.overall_score ?? 0
      totalScore += sheetScore
      const filed = member.checkins.some((c) => c.period_label === selectedQuarter)
      if (!filed) {
        notStarted += 1
        continue
      }
      const score = computeWeightedScoreForQuarter(member, selectedQuarter)
      if (score >= 70) onTrack += 1
      else atRisk += 1
    }
    return {
      onTrack,
      atRisk,
      notStarted,
      avgScore: totalSheets ? totalScore / totalSheets : null,
    }
  }, [eligibleTeam, selectedQuarter])

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  async function handlePostComment(member: TeamMemberData) {
    if (!member.sheet) return
    const text = (commentDrafts[member.sheet._id] ?? '').trim()
    if (!text) {
      setCommentErrors((prev) => ({
        ...prev,
        [member.sheet!._id]: 'Comment cannot be empty.',
      }))
      return
    }
    setPostingComment(member.sheet._id)
    setCommentErrors((prev) => ({ ...prev, [member.sheet!._id]: '' }))
    try {
      const { data } = await api.post<CheckinComment>('/checkin-comments/', {
        goal_sheet_id: member.sheet._id,
        employee_id: member.user._id,
        quarter: selectedQuarter,
        comment: text,
      })
      setTeam((prev) =>
        prev.map((row) =>
          row.user._id === member.user._id
            ? { ...row, comments: [data, ...row.comments] }
            : row,
        ),
      )
      setCommentDrafts((prev) => ({ ...prev, [member.sheet!._id]: '' }))
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string } } }
      setCommentErrors((prev) => ({
        ...prev,
        [member.sheet!._id]: axiosErr?.response?.data?.detail ?? 'Failed to post comment.',
      }))
    } finally {
      setPostingComment(null)
    }
  }

  // ---------------------------------------------------------------------------
  // Render guards
  // ---------------------------------------------------------------------------

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    )
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          {/* <p className="breadcrumb">Check-ins</p> */}
          <h1 className="page-title">Team Check-In Review</h1>
          <p className="mt-1 text-sm text-slate-500">
            Planned vs. Actual achievements per quarter · structured review notes
          </p>
        </div>
      </header>

      {cycle && <CycleStatusBanner status={cycle} compact />}

      {pageError && (
        <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{pageError}</span>
        </div>
      )}

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard
          label="Team Size"
          value={eligibleTeam.length}
          sub="With active sheets"
          icon={<Users size={18} />}
          accent="blue"
        />
        <KpiCard
          label="On Track"
          value={summary.onTrack}
          sub={`≥ 70 pts weighted in ${selectedQuarter}`}
          icon={<CheckCircle2 size={18} />}
          accent="green"
        />
        <KpiCard
          label="At Risk"
          value={summary.atRisk}
          sub={`Filed but < 70 pts in ${selectedQuarter}`}
          icon={<AlertCircle size={18} />}
          accent="amber"
        />
        <KpiCard
          label="Avg Sheet Score"
          value={formatScore(summary.avgScore)}
          sub="Approved sheets only"
          icon={<TrendingUp size={18} />}
          accent="purple"
        />
      </div>

      {/* Quarter selector */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-slate-700">Quarter:</span>
        {ACTIVE_PERIOD_LABELS.map((q) => {
          const isActive = selectedQuarter === q
          return (
            <button
              key={q}
              type="button"
              onClick={() => setSelectedQuarter(q)}
              className={[
                'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                isActive
                  ? 'border-blue-500 bg-blue-50 text-blue-700'
                  : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50',
              ].join(' ')}
            >
              {q}
            </button>
          )
        })}
        <span className="ml-auto text-xs text-slate-400">
          {PERIOD_LABEL_DISPLAY[selectedQuarter]}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[280px_1fr]">
        {/* Team rail */}
        <aside className="card overflow-hidden p-0">
          <div className="border-b bg-slate-50 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Direct Reports
          </div>
          {eligibleTeam.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-slate-400">
              No approved sheets yet.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {eligibleTeam.map((member) => {
                const filed = member.checkins.some(
                  (c) => c.period_label === selectedQuarter,
                )
                const score = computeWeightedScoreForQuarter(member, selectedQuarter)
                const isActive = selectedEmployeeId === member.user._id
                return (
                  <li key={member.user._id}>
                    <button
                      type="button"
                      onClick={() => setSelectedEmployeeId(member.user._id)}
                      className={[
                        'flex w-full items-center justify-between px-4 py-3 text-left transition-colors',
                        isActive ? 'bg-blue-50' : 'hover:bg-slate-50',
                      ].join(' ')}
                    >
                      <div>
                        <p className="text-sm font-medium text-slate-800">
                          {member.user.name}
                        </p>
                        <p className="text-xs text-slate-400">
                          {member.user.department}
                        </p>
                      </div>
                      <div className="text-right">
                        {filed ? (
                          <span
                            className={
                              score >= 70
                                ? 'text-xs font-semibold text-emerald-600'
                                : score >= 40
                                ? 'text-xs font-semibold text-amber-600'
                                : 'text-xs font-semibold text-red-500'
                            }
                          >
                            {formatScore(score)}{' '}
                            <span className="font-normal text-slate-400">/ 100</span>
                          </span>
                        ) : (
                          <span className="text-xs text-slate-400">No data</span>
                        )}
                      </div>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </aside>

        {/* Selected member detail */}
        <section className="space-y-4">
          {!active || !active.sheet ? (
            <div className="card rounded-lg p-10 text-center text-sm text-slate-400 shadow-sm">
              Select a team member to view their Planned vs Actual breakdown.
            </div>
          ) : (
            <MemberDetail
              member={active}
              quarter={selectedQuarter}
              draft={commentDrafts[active.sheet._id] ?? ''}
              onDraftChange={(v) =>
                setCommentDrafts((prev) => ({ ...prev, [active.sheet!._id]: v }))
              }
              onPostComment={() => handlePostComment(active)}
              isPosting={postingComment === active.sheet._id}
              postError={commentErrors[active.sheet._id]}
            />
          )}
        </section>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Subcomponent — single member's Planned vs Actual table + comment composer
// ---------------------------------------------------------------------------

interface MemberDetailProps {
  member: TeamMemberData
  quarter: PeriodLabel
  draft: string
  onDraftChange: (v: string) => void
  onPostComment: () => void
  isPosting: boolean
  postError?: string
}

function MemberDetail({
  member,
  quarter,
  draft,
  onDraftChange,
  onPostComment,
  isPosting,
  postError,
}: MemberDetailProps) {
  const { user, sheet, goals, checkins, comments } = member
  if (!sheet) return null

  const commentsForQuarter = comments.filter((c) => c.quarter === quarter)
  const otherComments = comments.filter((c) => c.quarter !== quarter)

  return (
    <>
      {/* Header card */}
      <div className="card overflow-hidden p-0">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b bg-slate-50 px-5 py-4">
          <div>
            <p className="text-base font-semibold text-slate-900">{user.name}</p>
            <p className="text-xs text-slate-500">
              {user.department} · {sheet.period_label} ·{' '}
              <StatusBadge status={sheet.status} />
            </p>
          </div>
          <div className="text-right text-xs text-slate-400">
            <p>
              Sheet score{' '}
              <span className="font-semibold text-slate-700">
                {sheet.overall_score != null
                  ? `${formatScore(sheet.overall_score)} / 100`
                  : '—'}
              </span>
            </p>
            <p className="mt-0.5">
              Goals {sheet.goal_count} · Weight {sheet.total_weightage} %
            </p>
          </div>
        </div>

        {/* Planned vs Actual */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 uppercase tracking-wide">
              <tr>
                <th className="th">Goal</th>
                <th className="th">UoM</th>
                <th className="th">Planned (Target)</th>
                <th className="th">Actual ({quarter})</th>
                <th className="th">Achievement</th>
                <th className="th">Wt. Score</th>
                <th className="th">Self ★</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {goals.map((goal) => {
                const checkin = checkins.find(
                  (c) => c.goal_id === goal._id && c.period_label === quarter,
                )
                const actual = checkin?.actual_value
                // Use the new scoring authority formulas
                const uomType = goal.uom_type as UomType
                const achievementPct = calculateAchievementPercentage(uomType, actual, goal.target_value)
                const goalScore = calculateGoalScore(achievementPct, goal.weightage)
                const hasRemarks = !!(checkin?.remarks || checkin?.manager_remark)
                return (
                  <Fragment key={goal._id}>
                    <tr className="tr">
                      <td className="td">
                        <p className="font-medium text-slate-800 line-clamp-2">
                          {goal.description}
                        </p>
                        <p className="mt-0.5 text-xs text-slate-400">
                          {THRUST_AREA_LABELS[goal.thrust_area]}
                        </p>
                      </td>
                      <td className="td">
                        {goal.uom_type === 'Numeric' ? 'Max' : goal.uom_type}
                      </td>
                      <td className="td">
                        {String(goal.target_value)}
                      </td>
                      <td className="td">
                        {actual !== undefined && actual !== null && actual !== ''
                          ? String(actual)
                          : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="td">
                        {achievementPct == null || isNaN(achievementPct) ? (
                          <span className="text-slate-300">—</span>
                        ) : (
                          <span
                            className={
                              achievementPct >= 80
                                ? 'font-semibold text-emerald-600'
                                : achievementPct >= 50
                                ? 'font-semibold text-amber-600'
                                : 'font-semibold text-red-500'
                            }
                          >
                            {formatScore(achievementPct)} %
                          </span>
                        )}
                      </td>
                      <td className="td">
                        {formatScore(goalScore, 2)}
                      </td>
                      <td className="td">
                        {checkin?.self_rating != null
                          ? `${checkin.self_rating}/5`
                          : '—'}
                      </td>
                    </tr>

                    {/* Remarks sub-row — employee note + manager note */}
                    {hasRemarks && (
                      <tr className="tr">
                        <td colSpan={7} className="td">
                          <div className="flex flex-wrap gap-3">
                            {checkin?.remarks && (
                              <div className="flex-1 min-w-[220px] rounded-md border border-slate-200 bg-white px-3 py-2">
                                <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-slate-500">
                                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-slate-400" />
                                  Employee remark
                                </p>
                                <p className="whitespace-pre-wrap text-xs text-slate-700 leading-relaxed">
                                  {checkin.remarks}
                                </p>
                              </div>
                            )}
                            {checkin?.manager_remark && (
                              <div className="flex-1 min-w-[220px] rounded-md border border-blue-100 bg-blue-50/60 px-3 py-2">
                                <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-blue-600">
                                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-blue-400" />
                                  Manager remark
                                </p>
                                <p className="whitespace-pre-wrap text-xs text-slate-700 leading-relaxed">
                                  {checkin.manager_remark}
                                </p>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Structured Check-in Comment composer ── */}
      <div className="card overflow-hidden p-0">
        <div className="flex items-center justify-between border-b bg-slate-50 px-5 py-3">
          <div className="flex items-center gap-2">
            <MessageSquarePlus size={16} className="text-blue-500" />
            <h3 className="text-sm font-semibold text-slate-800">
              Manager Review Note — {quarter}
            </h3>
          </div>
          <span className="text-xs text-slate-400">
            Logged with timestamp & quarter identifier
          </span>
        </div>
        <div className="space-y-3 p-5">
          <Textarea
            value={draft}
            onChange={(e) => onDraftChange(e.target.value)}
            rows={4}
            placeholder={`Document your review for ${user.name.split(' ')[0]} in ${quarter}. Highlight strengths, risks, and the next steps you've agreed on.`}
            className={cn('input resize-none min-h-[6rem]', postError && 'input-error')}
          />
          {postError && (
            <p className="text-xs font-medium text-red-500">{postError}</p>
          )}
          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-400">
              {draft.trim().length} / 2000 characters
            </p>
            <Button
              variant="primary"
              size="sm"
              className="btn-primary btn-sm"
              disabled={isPosting || draft.trim().length === 0}
              onClick={onPostComment}
            >
              {isPosting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
              {isPosting ? 'Logging…' : 'Log review note'}
            </Button>
          </div>
        </div>

        {/* Timeline for this quarter */}
        <CommentTimeline
          title={`${quarter} timeline`}
          comments={commentsForQuarter}
          emptyMessage="No notes logged for this quarter yet."
        />

        {/* Other quarters (collapsed) */}
        {otherComments.length > 0 && (
          <details className="border-t">
            <summary className="cursor-pointer px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500 hover:bg-slate-50">
              View notes from other quarters ({otherComments.length})
            </summary>
            <CommentTimeline
              title=""
              comments={otherComments}
              emptyMessage=""
            />
          </details>
        )}
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// Subcomponent — timeline of structured comments
// ---------------------------------------------------------------------------

function CommentTimeline({
  title,
  comments,
  emptyMessage,
}: {
  title: string
  comments: CheckinComment[]
  emptyMessage: string
}) {
  return (
    <div className="border-t bg-slate-50/70 p-5">
      {title && (
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
          {title}
        </p>
      )}
      {comments.length === 0 ? (
        <p className="text-xs text-slate-400 italic">{emptyMessage}</p>
      ) : (
        <ul className="space-y-3">
          {comments.map((c) => (
            <li
              key={c._id}
              className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm"
            >
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="rounded-full bg-blue-50 px-2 py-0.5 font-semibold text-blue-700">
                  {c.quarter}
                </span>
                <span className="font-medium text-slate-700">
                  {c.author_name ?? 'Reviewer'}
                </span>
                <span className="text-slate-400">· {c.author_role}</span>
                <span className="ml-auto text-slate-400">
                  {new Date(c.created_at).toLocaleString('en-IN', {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })}
                </span>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm text-slate-800">
                {c.comment}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Weighted score for the selected quarter.
 *
 * Formula (docs/VALIDATION_RULES.md):
 *   sheet_score = SUM(goal.goal_score)
 *   goal_score  = (achievement_pct / 100) × weightage
 *
 * Because total weightage = 100 %, the result is on a 0–100 scale and is
 * directly comparable to sheet.overall_score stored on the backend.
 * DO NOT use average(achievement_pct) — that ignores weightage entirely.
 */
function computeWeightedScoreForQuarter(member: TeamMemberData, quarter: PeriodLabel): number {
  let total = 0
  for (const g of member.goals) {
    const c = member.checkins.find(
      (ci) => ci.goal_id === g._id && ci.period_label === quarter,
    )
    if (!c) continue
    
    // Use the new scoring authority formulas
    const uomType = g.uom_type as UomType
    const achievementPct = calculateAchievementPercentage(uomType, c.actual_value, g.target_value)
    const goalScore = calculateGoalScore(achievementPct, g.weightage)
    
    if (goalScore == null || isNaN(goalScore)) continue
    total += goalScore
  }
  return total
}
