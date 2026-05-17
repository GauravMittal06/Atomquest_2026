/**
 * GoalsPage — Employee's "My Goal Sheet" page.
 *
 * States:
 *   loading  → spinner while fetching existing sheets
 *   no-sheet → shows <CreateGoalSheetForm />
 *   has-draft-sheet → shows sheet overview + goals table + Submit for Approval button
 *   has-submitted/returned/approved/locked sheet → read-only view with status badge
 *
 * Shared goals (docs/SHARED_GOALS.md):
 *   - Displayed with a SHARED badge and lock icon
 *   - All fields except Weightage are read-only for employees
 *   - Inline weightage editing is available when sheet is DRAFT/RETURNED
 *   - Achievement is synced automatically from the primary owner
 *
 * Permissions (docs/ROLE_PERMISSIONS.md):
 *   EMPLOYEE can create, view, edit (Draft/Returned), and submit their own sheet.
 */

import { useCallback, useEffect, useState } from 'react'
import {
  AlertCircle,
  CheckCircle2,
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
import { useCycleStatus } from '@/lib/useCycleStatus'
import { isCheckInWindowOpen, THRUST_AREA_LABELS, type Goal, type GoalSheet } from '@/types'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { CreateGoalSheetForm } from '@/components/goals/CreateGoalSheetForm'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function weightageColour(_w: number, total: number) {
  if (total === 100) return 'text-green-600'
  return 'text-slate-700'
}

// ---------------------------------------------------------------------------
// GoalsPage
// ---------------------------------------------------------------------------

export function GoalsPage() {
  const [phase, setPhase] = useState<'loading' | 'create' | 'view'>('loading')
  const [sheet, setSheet] = useState<GoalSheet | null>(null)
  const [goals, setGoals] = useState<Goal[]>([])
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  const { status: cycleStatus } = useCycleStatus()

  // Inline weightage editing for shared goals (SHARED_GOALS.md — only field employees can change)
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
      // Use the most recent sheet
      const latest = sheets.sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      )[0]
      setSheet(latest)

      const goalsRes = await api.get<Goal[]>(`/goals/sheet/${latest._id}`)
      setGoals(goalsRes.data)
      setPhase('view')
    } catch {
      setPhase('create')
    }
  }, [])

  useEffect(() => {
    loadSheet()
  }, [loadSheet])

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

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
      setSheet((prev) => prev ? { ...prev, status: 'SUBMITTED' } : prev)
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

  // ── Shared-goal inline weightage handlers ──────────────────────────────────
  function handleSharedWeightageChange(goalId: string, value: string) {
    setSharedWeightageEdits((prev) => ({ ...prev, [goalId]: value }))
    setSharedWeightageErrors((prev) => ({ ...prev, [goalId]: '' }))
    setSavedSharedGoals((prev) => { const n = new Set(prev); n.delete(goalId); return n })
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

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (phase === 'loading') {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    )
  }

  if (phase === 'create') {
    const isEditing = !!sheet
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            {isEditing ? 'Edit Goal Sheet' : 'Create Goal Sheet'}
          </h1>
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

  // ── View existing sheet ──
  if (!sheet) return null

  const isEditable = sheet.status === 'DRAFT' || sheet.status === 'RETURNED'
  const canSubmit = sheet.status === 'DRAFT' || sheet.status === 'RETURNED'

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">My Goal Sheet</h1>
          <p className="mt-1 text-sm text-slate-500">
            {sheet.period_label} · {sheet.goal_count} goal{sheet.goal_count !== 1 ? 's' : ''} ·{' '}
            {sheet.total_weightage} % allocated
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={sheet.status} />
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Manager comment (RETURNED status) */}
      {sheet.status === 'RETURNED' && sheet.review_comment && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-amber-700">
            Manager Comment
          </p>
          <p className="text-sm text-amber-900">{sheet.review_comment}</p>
        </div>
      )}

      {/* KPI summary row */}
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
          value={sheet.overall_score != null ? `${sheet.overall_score.toFixed(1)} / 100` : '—'}
          sub="Based on check-ins"
          ok={false}
        />
      </div>

      {/* Goals table */}
      <Card className="overflow-hidden">
        <CardHeader className="flex flex-row items-center justify-between border-b pb-4">
          <CardTitle className="flex items-center gap-2 text-base">
            <ClipboardList className="h-4 w-4 text-slate-400" />
            Goals
          </CardTitle>
          {isEditable && (
            <Button
              variant="outline"
              size="sm"
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
              <thead className="bg-slate-50 text-xs text-slate-500 uppercase tracking-wide">
                <tr>
                  <th className="px-5 py-3 text-left">#</th>
                  <th className="px-5 py-3 text-left">Thrust Area</th>
                  <th className="px-5 py-3 text-left">Description</th>
                  <th className="px-5 py-3 text-left">Type</th>
                  <th className="px-5 py-3 text-left">UoM</th>
                  <th className="px-5 py-3 text-right">Target</th>
                  <th className="px-5 py-3 text-right">Wt. %</th>
                  {(sheet.status === 'APPROVED' || sheet.status === 'LOCKED') ? (
                    <th className="px-5 py-3 text-right">Achievement</th>
                  ) : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {goals.map((goal, i) => {
                  const isShared = goal.shared_goal_ref?.is_shared === true
                  const isPrimaryOwner = goal.shared_goal_ref?.primary_owner_id === goal.owner_id
                  const canEditWeightage = isEditable && isShared
                  const sharedWeightageVal =
                    sharedWeightageEdits[goal._id] ?? String(goal.weightage)
                  const isSavingThis = savingSharedGoal === goal._id
                  const wasSaved = savedSharedGoals.has(goal._id)
                  const weightageErr = sharedWeightageErrors[goal._id]

                  return (
                    <tr
                      key={goal._id}
                      className={[
                        'transition-colors',
                        isShared ? 'bg-indigo-50/30 hover:bg-indigo-50/60' : 'hover:bg-slate-50',
                      ].join(' ')}
                    >
                      <td className="px-5 py-3 text-slate-400 text-xs">{i + 1}</td>
                      <td className="px-5 py-3 whitespace-nowrap text-slate-600 text-xs">
                        {THRUST_AREA_LABELS[goal.thrust_area]}
                      </td>
                      <td className="px-5 py-3 text-slate-800 max-w-xs">
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
                      <td className="px-5 py-3">
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                            goal.uom_type === 'Numeric'
                              ? 'bg-blue-50 text-blue-700'
                              : goal.uom_type === 'Timeline'
                              ? 'bg-amber-50 text-amber-700'
                              : 'bg-violet-50 text-violet-700'
                          }`}
                        >
                          {goal.uom_type}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-slate-500">{goal.unit_of_measure}</td>
                      <td className="px-5 py-3 text-right">
                        {/* Target is ALWAYS read-only for shared goals (SHARED_GOALS.md) */}
                        {isShared ? (
                          <div className="flex items-center justify-end gap-1">
                            <Lock size={10} className="text-indigo-400 shrink-0" />
                            <span className="font-mono text-slate-700">
                              {typeof goal.target_value === 'number'
                                ? goal.target_value.toLocaleString()
                                : <span className="text-xs">{String(goal.target_value).slice(0, 40)}</span>}
                            </span>
                          </div>
                        ) : (
                          <span className="font-mono text-slate-700">
                            {typeof goal.target_value === 'number'
                              ? goal.target_value.toLocaleString()
                              : <span className="text-xs">{String(goal.target_value).slice(0, 40)}</span>}
                          </span>
                        )}
                      </td>

                      {/* Weightage — editable inline for shared goals when DRAFT/RETURNED */}
                      <td className={`px-5 py-3 text-right font-semibold ${weightageColour(goal.weightage, sheet.total_weightage)}`}>
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
                                className={`h-7 w-20 text-right text-xs ${
                                  weightageErr ? 'border-red-400' : ''
                                }`}
                              />
                              <span className="text-xs text-slate-400">%</span>
                              {isSavingThis ? (
                                <Loader2 className="h-4 w-4 animate-spin text-blue-400" />
                              ) : wasSaved && sharedWeightageVal === String(goal.weightage) ? (
                                <span className="text-xs text-green-600 font-medium">✓</span>
                              ) : (
                                <button
                                  onClick={() => handleSaveSharedWeightage(goal)}
                                  className="rounded bg-blue-600 p-0.5 text-white hover:bg-blue-700"
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

                      {(sheet.status === 'APPROVED' || sheet.status === 'LOCKED') && (
                        <td className="px-5 py-3 text-right">
                          {goal.achievement_pct != null ? (
                            <div>
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
                              {isShared && !isPrimaryOwner && (
                                <p className="text-xs text-indigo-400">synced</p>
                              )}
                            </div>
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
                  <td colSpan={6} className="px-5 py-3">
                    Total
                  </td>
                  <td className="px-5 py-3 text-right">
                    <span
                      className={
                        sheet.total_weightage === 100 ? 'text-green-700' : 'text-red-600'
                      }
                    >
                      {sheet.total_weightage} %
                    </span>
                  </td>
                  {(sheet.status === 'APPROVED' || sheet.status === 'LOCKED') && (
                    <td className="px-5 py-3 text-right">{sheet.overall_score?.toFixed(1) ?? '—'}</td>
                  )}
                </tr>
              </tfoot>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Action buttons */}
      <div className="flex flex-wrap items-center gap-3">
        {canSubmit && (
          <Button
            variant="primary"
            onClick={handleSubmitForApproval}
            disabled={isSubmitting || sheet.total_weightage !== 100 || sheet.goal_count < 3}
            className="gap-2"
          >
            {isSubmitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            {isSubmitting ? 'Submitting…' : 'Submit for Approval'}
          </Button>
        )}
        {sheet.status === 'APPROVED' && (
          <Button variant="success" className="gap-2" disabled>
            <CheckCircle2 className="h-4 w-4" />
            Approved — Check-ins Enabled
          </Button>
        )}
        {sheet.status === 'DRAFT' && (
          <Button
            variant="destructive"
            size="sm"
            onClick={handleDeleteDraft}
            disabled={isDeleting}
            className="gap-2"
          >
            {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            {isDeleting ? 'Deleting…' : 'Delete Draft'}
          </Button>
        )}
        {canSubmit && (sheet.total_weightage !== 100 || sheet.goal_count < 3) && (
          <p className="text-xs text-red-500">
            {sheet.total_weightage !== 100
              ? `Total weightage is ${sheet.total_weightage} % (must be 100 %).`
              : `At least 3 goals required (current: ${sheet.goal_count}).`}
          </p>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// SummaryTile
// ---------------------------------------------------------------------------

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
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">{label}</p>
      <p className="mt-1 text-lg font-bold text-slate-900">{value}</p>
      <p className={`mt-0.5 text-xs ${ok ? 'text-green-600' : 'text-slate-400'}`}>{sub}</p>
    </div>
  )
}
