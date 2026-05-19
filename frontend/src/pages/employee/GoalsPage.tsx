/**
 * GoalsPage — Employee "My Goal Sheet"
 *
 * Read-only reference of goal definitions. Check-in inputs and manager
 * comments live on the Check-ins tab. Workflow actions appear below the table.
 */
import { useCallback, useEffect, useState } from 'react'
import {
  AlertCircle,
  ClipboardList,
  Link2,
  Loader2,
  Lock,
  PlusCircle,
  Save,
  Send,
  Trash2,
} from 'lucide-react'

import api from '@/lib/api'
import { cn } from '@/lib/utils'
import { formatScore } from '@/utils/scoring'
import { useCycleStatus } from '@/lib/useCycleStatus'
import { UomTypeBadge } from '@/components/employee/UomTypeBadge'
import { isCheckInWindowOpen, THRUST_AREA_LABELS, type Goal, type GoalSheet } from '@/types'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { CreateGoalSheetForm } from '@/components/goals/CreateGoalSheetForm'

function formatTarget(goal: Goal): string {
  if (goal.target_value == null || goal.target_value === '') return '—'
  const val =
    typeof goal.target_value === 'number'
      ? goal.target_value.toLocaleString()
      : String(goal.target_value)
  return goal.unit_of_measure ? `${val} ${goal.unit_of_measure}` : val
}

export function GoalsPage() {
  const [phase, setPhase] = useState<'loading' | 'create' | 'view'>('loading')
  const [sheet, setSheet] = useState<GoalSheet | null>(null)
  const [goals, setGoals] = useState<Goal[]>([])
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  const { status: cycleStatus } = useCycleStatus()

  const [sharedWeightageEdits, setSharedWeightageEdits] = useState<Record<string, string>>({})
  const [sharedWeightageErrors, setSharedWeightageErrors] = useState<Record<string, string>>({})
  const [savingSharedGoal, setSavingSharedGoal] = useState<string | null>(null)
  const [savedSharedGoals, setSavedSharedGoals] = useState<Set<string>>(new Set())

  const loadSheet = useCallback(async () => {
    setError(null)
    try {
      const res = await api.get<GoalSheet[]>('/goalsheets/')
      const sheets = res.data
      if (sheets.length === 0) {
        setPhase('create')
        return
      }
      const latest = sheets.sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      )[0]
      setSheet(latest)

      const goalsRes = await api.get<Goal[]>(`/goals/sheet/${latest._id}`)
      setGoals(goalsRes.data)
      setPhase('view')
    } catch {
      setError('Failed to load goal sheet.')
      setPhase('create')
    }
  }, [])

  useEffect(() => {
    loadSheet()
  }, [loadSheet])

  const handleCreateSuccess = (newSheet: GoalSheet, newGoals: Goal[]) => {
    setSheet(newSheet)
    setGoals(newGoals)
    setPhase('view')
  }

  const handleSubmitForApproval = async () => {
    if (!sheet) return
    setIsSubmitting(true)
    setError(null)
    try {
      await api.patch(`/goals/sheet/${sheet._id}/submit`)
      setSheet((prev) => (prev ? { ...prev, status: 'SUBMITTED' } : prev))
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string } } }
      setError(axiosErr?.response?.data?.detail ?? 'Failed to submit. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDeleteDraft = async () => {
    if (!sheet) return
    if (!window.confirm('Delete this Draft Goal Sheet and all its goals? This cannot be undone.')) return
    setIsDeleting(true)
    try {
      await api.delete(`/goalsheets/${sheet._id}`)
      setSheet(null)
      setGoals([])
      setPhase('create')
    } catch {
      setError('Failed to delete the draft. Please try again.')
    } finally {
      setIsDeleting(false)
    }
  }

  function handleSharedWeightageChange(goalId: string, value: string) {
    setSharedWeightageEdits((prev) => ({ ...prev, [goalId]: value }))
    setSharedWeightageErrors((prev) => ({ ...prev, [goalId]: '' }))
    setSavedSharedGoals((prev) => {
      const n = new Set(prev)
      n.delete(goalId)
      return n
    })
  }

  async function handleSaveSharedWeightage(goal: Goal) {
    const raw = sharedWeightageEdits[goal._id]
    if (raw === undefined) return
    const val = parseFloat(raw)
    if (isNaN(val) || val < 10 || val > 50) {
      setSharedWeightageErrors((prev) => ({ ...prev, [goal._id]: 'Must be 10–50 %' }))
      return
    }
    if (val === goal.weightage) {
      setSavedSharedGoals((prev) => new Set(prev).add(goal._id))
      return
    }
    setSavingSharedGoal(goal._id)
    try {
      const res = await api.patch<Goal>(`/goals/${goal._id}`, { weightage: val })
      setGoals((prev) => prev.map((g) => (g._id === goal._id ? res.data : g)))
      const sheetRes = await api.get<GoalSheet>(`/goalsheets/${sheet!._id}`)
      setSheet(sheetRes.data)
      setSavedSharedGoals((prev) => new Set(prev).add(goal._id))
      setSharedWeightageErrors((prev) => ({ ...prev, [goal._id]: '' }))
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string } } }
      setSharedWeightageErrors((prev) => ({
        ...prev,
        [goal._id]: axiosErr?.response?.data?.detail ?? 'Save failed',
      }))
    } finally {
      setSavingSharedGoal(null)
    }
  }

  if (phase === 'loading') {
    return (
      <div className="space-y-6">
        <Skeleton className="h-16 w-full" />
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  if (phase === 'create') {
    const isEditing = !!sheet
    return (
      <div className="space-y-6">
        <div>
          {/* <p className="breadcrumb">Employee · Goals</p> */}
          <h1 className="page-title">{isEditing ? 'Edit Goal Sheet' : 'Create Goal Sheet'}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {isEditing
              ? 'Update your goals below. Shared goals are read-only except for Weightage.'
              : 'Define your performance goals for the appraisal period. Minimum 3 goals required. Total weightage must equal exactly 100 %.'}
          </p>
        </div>
        <CreateGoalSheetForm
          onSuccess={handleCreateSuccess}
          onCancel={isEditing ? () => setPhase('view') : undefined}
          sheetId={sheet?._id}
        />
      </div>
    )
  }

  if (!sheet) return null

  const isEditable = sheet.status === 'DRAFT' || sheet.status === 'RETURNED'
  const showAchievement = sheet.status === 'APPROVED' || sheet.status === 'LOCKED'

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          {/* <p className="breadcrumb">Employee · Goals</p> */}
          <h1 className="page-title">My Goal Sheet</h1>
          <p className="mt-1 text-sm text-slate-500">
            {sheet.period_label} · {sheet.goal_count} goal{sheet.goal_count !== 1 ? 's' : ''} ·{' '}
            {sheet.total_weightage} % allocated
          </p>
        </div>
        <StatusBadge status={sheet.status} />
      </div>

      {error && (
        <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <SummaryTile
          label="Goals"
          value={`${sheet.goal_count} / 8`}
          sub={sheet.goal_count >= 3 ? '✓ Minimum met' : `Need ${3 - sheet.goal_count} more`}
          ok={sheet.goal_count >= 3}
        />
        <SummaryTile
          label="Weightage"
          value={`${sheet.total_weightage} %`}
          sub={sheet.total_weightage === 100 ? '✓ Balanced' : 'Not balanced'}
          ok={sheet.total_weightage === 100}
        />
        <SummaryTile
          label="Status"
          value={sheet.status}
          sub={
            sheet.status === 'DRAFT'
              ? 'Being edited'
              : sheet.status === 'SUBMITTED'
                ? 'Awaiting review'
                : sheet.status === 'RETURNED'
                  ? 'Needs revision'
                  : sheet.status === 'APPROVED' || sheet.status === 'LOCKED'
                    ? cycleStatus && isCheckInWindowOpen(cycleStatus.state)
                      ? `Check-ins open — ${cycleStatus.active_quarter}`
                      : 'Check-ins closed'
                    : 'Final — locked'
          }
          ok={sheet.status === 'APPROVED' || sheet.status === 'SUBMITTED'}
        />
        <SummaryTile
          label="Score"
          value={sheet.overall_score != null ? `${formatScore(sheet.overall_score)} / 100` : '—'}
          sub="Based on check-ins"
          ok={false}
        />
      </div>

      <Card className={cn('card overflow-hidden p-0')}>
        <CardHeader className="flex flex-row items-center justify-between border-b pb-4">
          <CardTitle className="flex items-center gap-2 text-base">
            <ClipboardList className="h-4 w-4 text-slate-400" />
            Goals
          </CardTitle>
          {isEditable && (
            <Button
              variant="outline"
              size="sm"
              className="btn-outline btn-sm"
              onClick={() => setPhase('create')}
            >
              <PlusCircle className="mr-1.5 h-4 w-4" />
              Edit / Replace Sheet
            </Button>
          )}
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 uppercase tracking-wide">
                <tr>
                  <th className="th">#</th>
                  <th className="th">Thrust Area</th>
                  <th className="th">Description</th>
                  <th className="th">Type</th>
                  <th className="th">UoM</th>
                  <th className="th">Target</th>
                  <th className="th">Wt. %</th>
                  {showAchievement ? <th className="th">Achievement</th> : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {goals.map((goal, i) => {
                  const isShared = goal.shared_goal_ref?.is_shared === true
                  const isPrimaryOwner =
                    goal.shared_goal_ref?.primary_owner_id === goal.owner_id
                  const canEditWeightage = isEditable && isShared
                  const sharedWeightageVal =
                    sharedWeightageEdits[goal._id] ?? String(goal.weightage)
                  const isSavingThis = savingSharedGoal === goal._id
                  const wasSaved = savedSharedGoals.has(goal._id)
                  const weightageErr = sharedWeightageErrors[goal._id]

                  return (
                    <tr key={goal._id} className="tr">
                      <td className="td">{i + 1}</td>
                      <td className="td">{THRUST_AREA_LABELS[goal.thrust_area]}</td>
                      <td className="td">
                        <div className="flex items-start gap-1.5">
                          <span className="line-clamp-2">{goal.description}</span>
                          {isShared && (
                            <span className="shrink-0 inline-flex items-center gap-0.5 rounded-full bg-indigo-100 px-1.5 py-0.5 text-xs font-semibold text-indigo-700 mt-0.5">
                              <Link2 size={9} />
                              SHARED
                            </span>
                          )}
                        </div>
                        {isShared && !isPrimaryOwner && goal.achievement_pct != null && (
                          <p className="text-xs text-indigo-500 mt-0.5">
                            ↻ Achievement synced from primary owner
                          </p>
                        )}
                      </td>
                      <td className="td">
                        <UomTypeBadge uomType={goal.uom_type} />
                      </td>
                      <td className="td">{goal.unit_of_measure}</td>
                      <td className="td">
                        {isShared ? (
                          <span className="inline-flex items-center gap-1">
                            <Lock size={10} className="text-indigo-400 shrink-0" />
                            {formatTarget(goal)}
                          </span>
                        ) : (
                          formatTarget(goal)
                        )}
                      </td>
                      <td className="td">
                        {canEditWeightage ? (
                          <div className="flex flex-col items-end gap-0.5">
                            <div className="flex items-center gap-1">
                              <Input
                                type="number"
                                min={10}
                                max={50}
                                step={5}
                                value={sharedWeightageVal}
                                onChange={(e) =>
                                  handleSharedWeightageChange(goal._id, e.target.value)
                                }
                                className={cn(
                                  'input h-7 w-20 text-xs text-right tabular-nums',
                                  weightageErr && 'input-error',
                                )}
                              />
                              <span className="text-xs text-slate-400">%</span>
                              {isSavingThis ? (
                                <Loader2 className="h-4 w-4 animate-spin text-blue-400" />
                              ) : wasSaved && sharedWeightageVal === String(goal.weightage) ? (
                                <span className="text-xs text-green-600 font-medium">✓</span>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => handleSaveSharedWeightage(goal)}
                                  className="btn-primary btn-sm p-1.5 min-w-0"
                                  title="Save weightage"
                                >
                                  <Save size={11} />
                                </button>
                              )}
                            </div>
                            {weightageErr && (
                              <span className="text-xs text-red-500">{weightageErr}</span>
                            )}
                          </div>
                        ) : (
                          <span>{goal.weightage} %</span>
                        )}
                      </td>
                      {showAchievement && (
                        <td className="td">
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
                              {formatScore(goal.achievement_pct)} %
                            </span>
                          ) : (
                            <span className="text-slate-300">—</span>
                          )}
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
              <tfoot className="bg-slate-50 text-xs font-semibold text-slate-700">
                <tr>
                  <td colSpan={6} className="td">
                    Total
                  </td>
                  <td className="td">
                    <span
                      className={
                        sheet.total_weightage === 100 ? 'text-green-700' : 'text-red-600'
                      }
                    >
                      {sheet.total_weightage} %
                    </span>
                  </td>
                  {showAchievement && (
                    <td className="td">{formatScore(sheet.overall_score)}</td>
                  )}
                </tr>
              </tfoot>
            </table>
          </div>
        </CardContent>
      </Card>

      <ApprovalWorkflowNotice
        sheet={sheet}
        isSubmitting={isSubmitting}
        isDeleting={isDeleting}
        onEdit={() => setPhase('create')}
        onSubmit={handleSubmitForApproval}
        onDelete={handleDeleteDraft}
      />
    </div>
  )
}

function ApprovalWorkflowNotice({
  sheet,
  isSubmitting,
  isDeleting,
  onEdit,
  onSubmit,
  onDelete,
}: {
  sheet: GoalSheet
  isSubmitting: boolean
  isDeleting: boolean
  onEdit: () => void
  onSubmit: () => void
  onDelete: () => void
}) {
  const comment = sheet.review_comment

  if (sheet.status === 'RETURNED') {
    return (
      <Card className="border-amber-200 bg-amber-50">
        <CardHeader>
          <CardTitle className="text-base text-amber-900">Returned for Rework</CardTitle>
          {comment && <CardDescription className="text-amber-800">{comment}</CardDescription>}
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-amber-700">Edit your goals and resubmit for approval.</p>
          <Button variant="outline" className="btn-outline" onClick={onEdit}>
            Edit Goals
          </Button>
        </CardContent>
      </Card>
    )
  }

  if (sheet.status === 'DRAFT') {
    const canSubmit = sheet.total_weightage === 100 && sheet.goal_count >= 3
    return (
      <Card className="border-slate-200 bg-slate-50">
        <CardHeader>
          <CardTitle className="text-base text-slate-800">Draft Goal Sheet</CardTitle>
          <CardDescription className="text-slate-600">
            Your goal sheet is in draft. Submit it for manager approval when ready.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <Button
            variant="primary"
            className="btn-primary"
            onClick={onSubmit}
            disabled={isSubmitting || !canSubmit}
          >
            {isSubmitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            {isSubmitting ? 'Submitting…' : 'Submit for Approval'}
          </Button>
          <Button variant="destructive" size="sm" onClick={onDelete} disabled={isDeleting}>
            {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            {isDeleting ? 'Deleting…' : 'Delete Draft'}
          </Button>
          {!canSubmit && (
            <p className="text-xs text-red-500">
              {sheet.total_weightage !== 100
                ? `Total weightage is ${sheet.total_weightage} % (must be 100 %).`
                : `At least 3 goals required (current: ${sheet.goal_count}).`}
            </p>
          )}
        </CardContent>
      </Card>
    )
  }

  if (sheet.status === 'SUBMITTED') {
    return (
      <Card className="border-blue-200 bg-blue-50">
        <CardHeader>
          <CardTitle className="text-base text-blue-900">Awaiting Manager Review</CardTitle>
          <CardDescription className="text-blue-800">
            Your goal sheet has been submitted and is awaiting manager review.
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  return null
}

function SummaryTile({
  label,
  value,
  sub,
  ok,
}: {
  label: string
  value: string | number
  sub: string
  ok: boolean
}) {
  return (
    <div className="card-sm">
      <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">{label}</p>
      <p className="mt-1 text-lg font-bold text-slate-900">{value}</p>
      <p className={`mt-0.5 text-xs ${ok ? 'text-green-600' : 'text-slate-400'}`}>{sub}</p>
    </div>
  )
}
