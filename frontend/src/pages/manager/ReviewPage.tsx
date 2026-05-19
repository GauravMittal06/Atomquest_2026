/**
 * Manager L1 — Review Goal Sheet Page
 *
 * Permissions (docs/ROLE_PERMISSIONS.md §Manager):
 *   - Review submitted goals
 *   - Edit targets and weightages
 *   - Approve goals (→ LOCKED)
 *   - Return goals for rework (requires comment)
 *
 * Workflow (docs/WORKFLOWS.md):
 *   SUBMITTED → APPROVED → LOCKED  (Approve action)
 *   SUBMITTED → RETURNED            (Return for Rework action — comment required)
 *
 * Validation (docs/VALIDATION_RULES.md):
 *   - weightage: 10 % – 50 % per goal
 *   - total weightage must equal 100 % before approving
 *   - target_value validated per uom_type
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  AlertCircle,
  ArrowLeft,
  CheckCheck,
  Loader2,
  RotateCcw,
  Save,
} from 'lucide-react'

import api from '@/lib/api'
import { formatScore } from '@/utils/scoring'
import { cn } from '@/lib/utils'
import {
  THRUST_AREA_LABELS,
  type Goal,
  type GoalSheet,
  type UoMType,
  type User,
} from '@/types'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'

// ---------------------------------------------------------------------------
// Local types
// ---------------------------------------------------------------------------

interface EditState {
  target_value: string
  weightage: string
}

interface RowError {
  target_value?: string
  weightage?: string
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function validateTarget(raw: string, uomType: UoMType): string | undefined {
  if (uomType === 'Numeric') {
    const n = parseFloat(raw)
    if (isNaN(n) || n <= 0) return 'Must be a positive number'
  } else if (uomType === 'Zero') {
    if (!['Yes', 'No'].includes(raw.trim())) return 'Must be "Yes" or "No"'
  } else {
    // Timeline
    if (!raw.trim()) return 'Required'
    if (raw.trim().length > 500) return 'Max 500 characters'
  }
  return undefined
}

function validateWeightage(raw: string): string | undefined {
  const n = parseFloat(raw)
  if (isNaN(n)) return 'Must be a number'
  if (n < 10 || n > 50) return 'Must be 10 – 50 %'
  return undefined
}

// ---------------------------------------------------------------------------
// ReviewPage
// ---------------------------------------------------------------------------

export function ReviewPage() {
  const { sheetId } = useParams<{ sheetId: string }>()
  const navigate = useNavigate()

  const [sheet, setSheet] = useState<GoalSheet | null>(null)
  const [goals, setGoals] = useState<Goal[]>([])
  const [employee, setEmployee] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [pageError, setPageError] = useState<string | null>(null)

  // Per-row inline edit state (goalId → {target_value, weightage})
  const [edits, setEdits] = useState<Record<string, EditState>>({})
  // Per-row dirty tracking (has the user changed a value since last save?)
  const [dirty, setDirty] = useState<Record<string, boolean>>({})
  // Per-row validation errors
  const [rowErrors, setRowErrors] = useState<Record<string, RowError>>({})
  // Which goal is currently being saved
  const [savingGoal, setSavingGoal] = useState<string | null>(null)
  // Which goals have been successfully saved in this session
  const [savedGoals, setSavedGoals] = useState<Set<string>>(new Set())

  // Return-for-rework panel
  const [showReturnPanel, setShowReturnPanel] = useState(false)
  const [returnComment, setReturnComment] = useState('')
  const [returnCommentError, setReturnCommentError] = useState<string | null>(null)
  const [isReturning, setIsReturning] = useState(false)

  // Approve & Lock
  const [isApproving, setIsApproving] = useState(false)

  const returnPanelRef = useRef<HTMLDivElement>(null)

  // ---------------------------------------------------------------------------
  // Data loading
  // ---------------------------------------------------------------------------

  const loadData = useCallback(async () => {
    if (!sheetId) return
    setLoading(true)
    setPageError(null)
    try {
      const [sheetRes, goalsRes] = await Promise.all([
        api.get<GoalSheet>(`/goalsheets/${sheetId}`),
        api.get<Goal[]>(`/goals/sheet/${sheetId}`),
      ])

      const fetchedSheet = sheetRes.data
      const fetchedGoals = goalsRes.data
      setSheet(fetchedSheet)
      setGoals(fetchedGoals)

      // Best-effort fetch of employee display name
      try {
        const empRes = await api.get<User>(`/users/${fetchedSheet.employee_id}`)
        setEmployee(empRes.data)
      } catch {
        // Non-critical — fall back to raw employee_id
      }

      // Seed inline-edit state from current goal values
      const initialEdits: Record<string, EditState> = {}
      fetchedGoals.forEach((g) => {
        initialEdits[g._id] = {
          target_value: String(g.target_value),
          weightage: String(g.weightage),
        }
      })
      setEdits(initialEdits)
    } catch {
      setPageError('Failed to load goal sheet. Please try again.')
    } finally {
      setLoading(false)
    }
  }, [sheetId])

  useEffect(() => {
    loadData()
  }, [loadData])

  // ---------------------------------------------------------------------------
  // Derived state
  // ---------------------------------------------------------------------------

  // Live total weightage using saved DB values (not unsaved edit-box values)
  const dbTotal = goals.reduce((sum, g) => sum + g.weightage, 0)
  const isBalanced = Math.abs(Math.round(dbTotal * 100) / 100 - 100) < 0.01

  // Unsaved edits total for the live indicator
  const editTotal = goals.reduce((sum, g) => {
    const raw = edits[g._id]?.weightage
    const parsed = raw !== undefined ? parseFloat(raw) : g.weightage
    return sum + (isNaN(parsed) ? 0 : parsed)
  }, 0)
  const editTotalDisplay = Math.round(editTotal * 100) / 100

  const isSubmittedSheet = sheet?.status === 'SUBMITTED'

  // ---------------------------------------------------------------------------
  // Inline edit handlers
  // ---------------------------------------------------------------------------

  function handleEditChange(
    goalId: string,
    field: keyof EditState,
    value: string,
  ) {
    setEdits((prev) => ({
      ...prev,
      [goalId]: { ...prev[goalId], [field]: value },
    }))
    setDirty((prev) => ({ ...prev, [goalId]: true }))
    // Clear saved indicator when user starts editing again
    setSavedGoals((prev) => {
      const next = new Set(prev)
      next.delete(goalId)
      return next
    })
    // Clear field-level error on change
    setRowErrors((prev) => ({
      ...prev,
      [goalId]: { ...prev[goalId], [field]: undefined },
    }))
  }

  async function handleSaveRow(goalId: string, goal: Goal) {
    const edit = edits[goalId]
    if (!edit) return

    // Client-side validation
    const errs: RowError = {
      target_value: validateTarget(edit.target_value, goal.uom_type),
      weightage: validateWeightage(edit.weightage),
    }
    const hasErrors = !!(errs.target_value || errs.weightage)
    setRowErrors((prev) => ({ ...prev, [goalId]: errs }))
    if (hasErrors) return

    const newWeightage = parseFloat(edit.weightage)
    const newTarget =
      goal.uom_type === 'Numeric'
        ? parseFloat(edit.target_value)
        : edit.target_value.trim()

    // Skip if nothing changed
    const sameWeight = newWeightage === goal.weightage
    const sameTarget = String(newTarget) === String(goal.target_value)
    if (sameWeight && sameTarget) {
      setDirty((prev) => ({ ...prev, [goalId]: false }))
      return
    }

    setSavingGoal(goalId)
    try {
      const payload: { target_value?: number | string; weightage?: number } = {}
      if (!sameTarget) payload.target_value = newTarget
      if (!sameWeight) payload.weightage = newWeightage

      const res = await api.patch<Goal>(`/goals/manager/${goalId}`, payload)
      setGoals((prev) => prev.map((g) => (g._id === goalId ? res.data : g)))

      // Refresh sheet-level totals (total_weightage on the sheet doc)
      const sheetRes = await api.get<GoalSheet>(`/goalsheets/${sheetId}`)
      setSheet(sheetRes.data)

      setDirty((prev) => ({ ...prev, [goalId]: false }))
      setSavedGoals((prev) => new Set(prev).add(goalId))
      setRowErrors((prev) => ({ ...prev, [goalId]: {} }))
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string } } }
      setRowErrors((prev) => ({
        ...prev,
        [goalId]: {
          target_value: axiosErr?.response?.data?.detail ?? 'Save failed',
        },
      }))
    } finally {
      setSavingGoal(null)
    }
  }

  // ---------------------------------------------------------------------------
  // Approve handler
  // ---------------------------------------------------------------------------

  async function handleApprove() {
    if (!sheetId) return
    setIsApproving(true)
    setPageError(null)
    try {
      await api.patch(`/goalsheets/${sheetId}/approve`)
      navigate('/manager/dashboard')
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string } } }
      setPageError(
        axiosErr?.response?.data?.detail ?? 'Approval failed. Please try again.',
      )
    } finally {
      setIsApproving(false)
    }
  }

  // ---------------------------------------------------------------------------
  // Return for rework handler
  // ---------------------------------------------------------------------------

  function handleShowReturn() {
    setShowReturnPanel(true)
    setTimeout(
      () => returnPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
      50,
    )
  }

  async function handleReturn() {
    if (!sheetId) return
    if (!returnComment.trim()) {
      setReturnCommentError('A feedback comment is required before returning.')
      return
    }
    setReturnCommentError(null)
    setIsReturning(true)
    setPageError(null)
    try {
      await api.patch(`/goalsheets/${sheetId}/status`, {
        new_status: 'RETURNED',
        comment: returnComment.trim(),
      })
      navigate('/manager/dashboard')
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string } } }
      setPageError(
        axiosErr?.response?.data?.detail ?? 'Return failed. Please try again.',
      )
    } finally {
      setIsReturning(false)
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

  if (!sheet) {
    return (
      <p className="py-12 text-center text-slate-500">Goal sheet not found.</p>
    )
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const employeeName =
    employee?.name ?? employee?.employee_id ?? sheet.employee_id
  const canApproveOrReturn = isSubmittedSheet

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <button
            onClick={() => navigate('/manager/dashboard')}
            type="button"
            className="btn-outline mb-2 flex items-center gap-1 self-start text-sm py-2"
          >
            <ArrowLeft size={14} />
            Back to Team
          </button>
          <p className="breadcrumb">Review</p>
          <h1 className="page-title">Review Goal Sheet</h1>
          <p className="mt-1 text-sm text-slate-500">
            {employeeName}
            {employee?.department ? ` · ${employee.department}` : ''}
            {' · '}
            {sheet.period_label}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <StatusBadge status={sheet.status} />
        </div>
      </div>

      {/* ── Page-level error banner ── */}
      {pageError && (
        <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{pageError}</span>
        </div>
      )}

      {/* ── Weightage imbalance warning (live) ── */}
      {!isBalanced && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Total weightage is{' '}
            <strong>{dbTotal.toFixed(2)} %</strong> — save your edits, then
            ensure the total equals exactly 100 % before approving.
          </span>
        </div>
      )}

      {/* ── Summary tiles ── */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <SummaryTile
          label="Goals"
          value={`${sheet.goal_count} / 8`}
          sub={sheet.goal_count >= 3 ? '✓ Min met' : `Need ${3 - sheet.goal_count} more`}
          ok={sheet.goal_count >= 3}
        />
        <SummaryTile
          label="Total Weightage"
          value={`${dbTotal.toFixed(2)} %`}
          sub={isBalanced ? '✓ Balanced' : 'Must equal 100 %'}
          ok={isBalanced}
        />
        <SummaryTile
          label="Live Edit Total"
          value={`${editTotalDisplay} %`}
          sub="Includes unsaved edits"
          ok={Math.abs(editTotalDisplay - 100) < 0.01}
        />
        <SummaryTile
          label="Status"
          value={sheet.status}
          sub={
            sheet.status === 'SUBMITTED'
              ? 'Awaiting your review'
              : sheet.status === 'LOCKED'
              ? 'Approved & locked'
              : sheet.status === 'APPROVED'
              ? 'Approved'
              : sheet.status === 'RETURNED'
              ? 'Returned for rework'
              : 'Draft'
          }
          ok={sheet.status === 'SUBMITTED'}
        />
      </div>

      {/* ── Goals table with inline editing ── */}
      <div className="card overflow-hidden p-0">
        <div className="flex items-center justify-between px-5 py-4 border-b bg-slate-50">
          <h2 className="font-semibold text-slate-900">Goal Details</h2>
          {isSubmittedSheet && (
            <span className="text-xs text-slate-400 italic">
              Edit Target or Weightage inline, then click Save on that row
            </span>
          )}
        </div>
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
                {isSubmittedSheet && (
                  <th className="th">Save</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {goals.map((goal, i) => {
                const edit = edits[goal._id] ?? {
                  target_value: String(goal.target_value),
                  weightage: String(goal.weightage),
                }
                const errs = rowErrors[goal._id] ?? {}
                const isSavingRow = savingGoal === goal._id
                const isDirtyRow = dirty[goal._id]
                const wasSaved = savedGoals.has(goal._id)

                return (
                  <tr key={goal._id} className="tr">
                    <td className="td">{i + 1}</td>

                    <td className="td">
                      {THRUST_AREA_LABELS[goal.thrust_area]}
                    </td>

                    <td className="td">
                      <span className="line-clamp-2">{goal.description}</span>
                    </td>

                    <td className="td">
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

                    <td className="td">
                      {goal.unit_of_measure}
                    </td>

                    {/* Target — editable when SUBMITTED */}
                    <td className="td">
                      {isSubmittedSheet ? (
                        <div className="flex flex-col items-end gap-0.5">
                          {goal.uom_type === 'Zero' ? (
                            <select
                              value={edit.target_value}
                              onChange={(e) =>
                                handleEditChange(goal._id, 'target_value', e.target.value)
                              }
                              className={cn(
                                'input h-auto py-1.5 text-right text-xs',
                                errs.target_value && 'input-error',
                              )}
                            >
                              <option value="Yes">Yes</option>
                              <option value="No">No</option>
                            </select>
                          ) : (
                            <Input
                              value={edit.target_value}
                              onChange={(e) =>
                                handleEditChange(goal._id, 'target_value', e.target.value)
                              }
                              className={cn(
                                'input h-7 py-2 text-right text-xs font-mono',
                                errs.target_value && 'input-error',
                              )}
                            />
                          )}
                          {errs.target_value && (
                            <span className="text-xs text-red-500">{errs.target_value}</span>
                          )}
                        </div>
                      ) : (
                        <span className="block text-right font-mono text-slate-700">
                          {typeof goal.target_value === 'number'
                            ? goal.target_value.toLocaleString()
                            : String(goal.target_value).slice(0, 40)}
                        </span>
                      )}
                    </td>

                    {/* Weightage — editable when SUBMITTED */}
                    <td className="td">
                      {isSubmittedSheet ? (
                        <div className="flex flex-col items-end gap-0.5">
                          <div className="flex items-center gap-1">
                            <Input
                              type="number"
                              min={10}
                              max={50}
                              step={5}
                              value={edit.weightage}
                              onChange={(e) =>
                                handleEditChange(goal._id, 'weightage', e.target.value)
                              }
                              className={cn(
                                'input h-7 w-20 py-2 text-right text-xs font-semibold tabular-nums',
                                errs.weightage && 'input-error',
                              )}
                            />
                            <span className="text-xs text-slate-400">%</span>
                          </div>
                          {errs.weightage && (
                            <span className="text-xs text-red-500">{errs.weightage}</span>
                          )}
                        </div>
                      ) : (
                        <span className="block text-right font-semibold text-slate-700">
                          {goal.weightage} %
                        </span>
                      )}
                    </td>

                    {/* Save button per row */}
                    {isSubmittedSheet && (
                      <td className="td">
                        {isSavingRow ? (
                          <Loader2 className="mx-auto h-4 w-4 animate-spin text-blue-400" />
                        ) : wasSaved && !isDirtyRow ? (
                          <span className="text-xs font-medium text-green-600">✓ Saved</span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleSaveRow(goal._id, goal)}
                            disabled={!isDirtyRow}
                            className="btn-primary btn-sm disabled:opacity-50"
                          >
                            <Save size={11} />
                            Save
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
            <tfoot className="bg-slate-50 text-xs font-semibold text-slate-700">
              <tr>
                <td colSpan={isSubmittedSheet ? 6 : 5} className="td">
                  Total Weightage
                </td>
                <td className="td">
                  <span className={isBalanced ? 'text-green-700' : 'text-red-600'}>
                    {dbTotal.toFixed(2)} %
                  </span>
                </td>
                {isSubmittedSheet && <td className="td" />}
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* ── Audit log (collapsed preview) ── */}
      {sheet.audit_log && sheet.audit_log.length > 0 && (
        <details className="card overflow-hidden p-0">
          <summary className="cursor-pointer px-5 py-4 font-semibold text-slate-700 text-sm select-none hover:bg-slate-50">
            Audit History ({sheet.audit_log.length} entries)
          </summary>
          <div className="divide-y divide-slate-100 px-5 pb-4">
            {[...sheet.audit_log].reverse().map((entry, idx) => (
              <div key={idx} className="flex items-start justify-between py-3 gap-4">
                <div className="flex items-center gap-2">
                  {entry.action === 'UNLOCKED' ? (
                    <span className="inline-flex items-center rounded-full border border-amber-200/60 bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-800">
                      Unlocked
                    </span>
                  ) : (
                    <StatusBadge status={entry.action} />
                  )}
                  <span className="text-xs text-slate-500 capitalize">{entry.actor_role}</span>
                </div>
                <div className="text-right text-xs text-slate-400">
                  {new Date(entry.timestamp).toLocaleString('en-IN', {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })}
                </div>
                {entry.comment && (
                  <p className="w-full text-xs text-slate-600 italic mt-1">
                    "{entry.comment}"
                  </p>
                )}
              </div>
            ))}
          </div>
        </details>
      )}

      {/* ── Action bar ── */}
      {canApproveOrReturn && (
        <div className="card flex flex-wrap items-center gap-3 shadow-sm">
          <Button
            onClick={handleApprove}
            disabled={isApproving || !isBalanced || Object.values(dirty).some(Boolean)}
            className="btn-primary gap-2"
          >
            {isApproving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CheckCheck className="h-4 w-4" />
            )}
            {isApproving ? 'Approving…' : 'Approve & Lock'}
          </Button>

          <Button
            variant="outline"
            onClick={handleShowReturn}
            disabled={isApproving || isReturning}
            className="btn-outline gap-2"
          >
            <RotateCcw className="h-4 w-4" />
            Return for Rework
          </Button>

          {/* Hints */}
          <div className="ml-auto text-xs text-slate-400 space-y-0.5 text-right">
            {Object.values(dirty).some(Boolean) && (
              <p className="text-amber-600 font-medium">
                You have unsaved edits — save all rows first.
              </p>
            )}
            {!isBalanced && (
              <p className="text-red-500 font-medium">
                Total weightage must equal 100 % to approve.
              </p>
            )}
          </div>
        </div>
      )}

      {/* ── Return for Rework panel ── */}
      {showReturnPanel && (
        <div
          ref={returnPanelRef}
          className="rounded-xl border border-amber-300 bg-amber-50 p-5 space-y-4 shadow-sm"
        >
          <div>
            <p className="font-semibold text-amber-900">Return for Rework</p>
            <p className="mt-1 text-sm text-amber-700">
              Explain what the employee needs to change. This comment is
              mandatory and will be displayed prominently on their dashboard.
            </p>
          </div>

          <Textarea
            value={returnComment}
            onChange={(e) => {
              setReturnComment(e.target.value)
              if (e.target.value.trim()) setReturnCommentError(null)
            }}
            placeholder="Enter your feedback (required)…"
            rows={4}
            className={cn(
              'input resize-none',
              returnCommentError && 'input-error',
            )}
          />
          {returnCommentError && (
            <p className="text-xs text-red-600 font-medium">{returnCommentError}</p>
          )}
          <p className="text-xs text-amber-600">
            {returnComment.trim().length} / 1000 characters
          </p>

          <div className="flex items-center gap-3">
            <Button
              onClick={handleReturn}
              disabled={isReturning}
              className="btn-danger gap-2"
            >
              {isReturning ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RotateCcw className="h-4 w-4" />
              )}
              {isReturning ? 'Returning…' : 'Confirm Return'}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setShowReturnPanel(false)
                setReturnComment('')
                setReturnCommentError(null)
              }}
              className="btn-outline"
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
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
    <div className="card-sm">
      <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">{label}</p>
      <p className="mt-1 text-lg font-bold text-slate-900 truncate">{value}</p>
      <p className={`mt-0.5 text-xs ${ok ? 'text-green-600' : 'text-slate-400'}`}>{sub}</p>
    </div>
  )
}
