/**
 * Employee Quarterly Check-Ins page.
 *
 * Responsibilities (brief + docs/CHECKIN_RULES.md + docs/VALIDATION_RULES.md):
 *   - Show the active CycleStatusBanner so the user knows the calendar state.
 *   - List the employee's approved/locked goals with target + planned wt.%.
 *   - When the input window is OPEN, allow entering Actual + Self-rating
 *     + remarks per goal for the active quarter.
 *   - When the input window is CLOSED, force every input to read-only.
 *   - Compute a live preview of achievement % and goal score using the
 *     same formulas as the backend (lib/progressCalculator.ts mirrors
 *     services/progress_calculator.py).
 */

import { Fragment, useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertCircle,
  CheckCircle2,
  ClipboardCheck,
  Loader2,
  Lock,
  MessageSquare,
  Save,
} from 'lucide-react'

import api from '@/lib/api'
import { cn } from '@/lib/utils'
import { calculateProgress } from '@/lib/progressCalculator'
import { useCycleStatus } from '@/lib/useCycleStatus'
import { CycleStatusBanner } from '@/components/checkins/CycleStatusBanner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { StatusBadge } from '@/components/shared/StatusBadge'
import {
  ACTIVE_PERIOD_LABELS,
  PERIOD_LABEL_DISPLAY,
  THRUST_AREA_LABELS,
  cycleStateToPeriodLabel,
  isCheckInWindowOpen,
  type CheckIn,
  type CheckinComment,
  type Goal,
  type GoalSheet,
  type PeriodLabel,
  type UoMType,
} from '@/types'

// ---------------------------------------------------------------------------
// Local state shape
// ---------------------------------------------------------------------------

interface RowEdit {
  actualValue: string
  selfRating: string
  remarks: string
}

interface RowSavedFlag {
  ok: boolean
  message?: string
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CheckInsPage() {
  const navigate = useNavigate()

  const { status: cycle, loading: cycleLoading } = useCycleStatus()

  const [sheet, setSheet] = useState<GoalSheet | null>(null)
  const [goals, setGoals] = useState<Goal[]>([])
  const [checkins, setCheckins] = useState<CheckIn[]>([])
  const [comments, setComments] = useState<CheckinComment[]>([])
  const [loading, setLoading] = useState(true)
  const [pageError, setPageError] = useState<string | null>(null)

  // Quarter the user is recording for. Defaults to the active quarter if open,
  // else the most recent quarter so the read-only view shows useful data.
  const [selectedQuarter, setSelectedQuarter] = useState<PeriodLabel>('Q1')

  // Per-goal editable state
  const [edits, setEdits] = useState<Record<string, RowEdit>>({})
  const [savingGoal, setSavingGoal] = useState<string | null>(null)
  const [rowFlags, setRowFlags] = useState<Record<string, RowSavedFlag>>({})

  // ---------------------------------------------------------------------------
  // Data loading
  // ---------------------------------------------------------------------------

  const loadData = useCallback(async () => {
    setLoading(true)
    setPageError(null)
    try {
      const sheetsRes = await api.get<GoalSheet[]>('/goalsheets/')
      const usable = sheetsRes.data
        .filter((s) => s.status === 'APPROVED' || s.status === 'LOCKED')
        .sort(
          (a, b) =>
            new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
        )
      const latest = usable[0] ?? null
      setSheet(latest)
      if (!latest) {
        setGoals([])
        setCheckins([])
        setComments([])
        return
      }
      const [goalsRes, checkinsRes, commentsRes] = await Promise.all([
        api.get<Goal[]>(`/goals/sheet/${latest._id}`),
        api.get<CheckIn[]>(`/checkins/sheet/${latest._id}`),
        api.get<CheckinComment[]>(`/checkin-comments/?goal_sheet_id=${latest._id}`),
      ])
      setGoals(goalsRes.data)
      setCheckins(checkinsRes.data)
      setComments(commentsRes.data)
    } catch {
      setPageError('Failed to load check-in data. Please try again.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  // Default selectedQuarter once cycle is known
  useEffect(() => {
    if (!cycle) return
    const active = cycleStateToPeriodLabel(cycle.state)
    if (active) setSelectedQuarter(active)
  }, [cycle])

  // Seed edits for the selected quarter whenever inputs change
  useEffect(() => {
    const next: Record<string, RowEdit> = {}
    for (const g of goals) {
      const existing = checkins.find(
        (c) => c.goal_id === g._id && c.period_label === selectedQuarter,
      )
      next[g._id] = {
        actualValue:
          existing?.actual_value !== undefined && existing?.actual_value !== null
            ? String(existing.actual_value)
            : '',
        selfRating:
          existing?.self_rating !== undefined && existing?.self_rating !== null
            ? String(existing.self_rating)
            : '',
        remarks: existing?.remarks ?? '',
      }
    }
    setEdits(next)
    setRowFlags({})
  }, [goals, checkins, selectedQuarter])

  // ---------------------------------------------------------------------------
  // Derived state
  // ---------------------------------------------------------------------------

  const windowOpen = !!cycle && isCheckInWindowOpen(cycle.state)
  const activeQuarter = cycle ? cycleStateToPeriodLabel(cycle.state) : null
  // Inputs are editable only when (a) a window is open AND (b) the user is
  // entering data for *that* quarter.
  const inputsEditable = windowOpen && selectedQuarter === activeQuarter

  // ---------------------------------------------------------------------------
  // Save handler
  // ---------------------------------------------------------------------------

  function handleEditChange(
    goalId: string,
    field: keyof RowEdit,
    value: string,
  ) {
    setEdits((prev) => ({
      ...prev,
      [goalId]: { ...prev[goalId], [field]: value },
    }))
    setRowFlags((prev) => ({ ...prev, [goalId]: { ok: false } }))
  }

  async function handleSaveRow(goal: Goal) {
    if (!sheet || !inputsEditable) return
    const edit = edits[goal._id]
    if (!edit) return
    if (edit.actualValue.trim() === '') {
      setRowFlags((prev) => ({
        ...prev,
        [goal._id]: { ok: false, message: 'Actual value is required.' },
      }))
      return
    }

    const existing = checkins.find(
      (c) => c.goal_id === goal._id && c.period_label === selectedQuarter,
    )

    const actualPayload =
      goal.uom_type === 'Numeric' ||
      goal.uom_type === 'Max' ||
      goal.uom_type === 'Min'
        ? Number(edit.actualValue)
        : edit.actualValue.trim()

    const selfRating = edit.selfRating === '' ? undefined : Number(edit.selfRating)

    setSavingGoal(goal._id)
    setRowFlags((prev) => ({ ...prev, [goal._id]: { ok: false } }))

    try {
      let updated: CheckIn
      if (existing) {
        const res = await api.patch<CheckIn>(`/checkins/${existing._id}`, {
          actual_value: actualPayload,
          self_rating: selfRating,
          remarks: edit.remarks || undefined,
        })
        updated = res.data
      } else {
        const res = await api.post<CheckIn>('/checkins/', {
          goal_id: goal._id,
          period_label: selectedQuarter,
          actual_value: actualPayload,
          self_rating: selfRating,
          remarks: edit.remarks || undefined,
        })
        updated = res.data
      }
      setCheckins((prev) => {
        const others = prev.filter((c) => c._id !== updated._id)
        return [...others, updated]
      })

      // Re-pull goal achievement / sheet score so the live numbers reflect
      // what the backend now thinks.
      const [goalsRes, sheetRes] = await Promise.all([
        api.get<Goal[]>(`/goals/sheet/${sheet._id}`),
        api.get<GoalSheet>(`/goalsheets/${sheet._id}`),
      ])
      setGoals(goalsRes.data)
      setSheet(sheetRes.data)

      setRowFlags((prev) => ({ ...prev, [goal._id]: { ok: true } }))
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string } } }
      setRowFlags((prev) => ({
        ...prev,
        [goal._id]: {
          ok: false,
          message: axiosErr?.response?.data?.detail ?? 'Save failed.',
        },
      }))
    } finally {
      setSavingGoal(null)
    }
  }

  // ---------------------------------------------------------------------------
  // Render guards
  // ---------------------------------------------------------------------------

  if (loading || cycleLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    )
  }

  if (!sheet) {
    return (
      <div className="space-y-6">
        {cycle && <CycleStatusBanner status={cycle} />}
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-slate-300 bg-white py-16 text-slate-500">
          <ClipboardCheck size={36} className="text-slate-300" />
          <p className="text-base font-semibold text-slate-700">
            No approved Goal Sheet yet
          </p>
          <p className="text-sm">
            Once your manager approves your goal sheet, this is where you'll
            log quarterly check-ins.
          </p>
          <Button variant="primary" className="btn-primary" onClick={() => navigate('/employee/goals')}>
            Go to my Goal Sheet
          </Button>
        </div>
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
          <p className="breadcrumb">Employee · Check-ins</p>
          <h1 className="page-title">Quarterly Check-Ins</h1>
          <p className="mt-1 text-sm text-slate-500">
            {sheet.period_label} · {sheet.goal_count} goal
            {sheet.goal_count !== 1 ? 's' : ''} ·{' '}
            <StatusBadge status={sheet.status} />
          </p>
        </div>
        <div className="text-right text-xs text-slate-400">
          Overall score{' '}
          <span className="font-semibold text-slate-700">
            {sheet.overall_score != null ? `${sheet.overall_score.toFixed(1)} / 100` : '—'}
          </span>
        </div>
      </header>

      {cycle && <CycleStatusBanner status={cycle} />}

      {pageError && (
        <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{pageError}</span>
        </div>
      )}

      {/* Quarter selector */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-slate-700">View / record for:</span>
        {ACTIVE_PERIOD_LABELS.map((q) => {
          const isActive = selectedQuarter === q
          const isOpenNow = activeQuarter === q && windowOpen
          return (
            <button
              key={q}
              type="button"
              onClick={() => setSelectedQuarter(q)}
              className={[
                'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                isActive
                  ? 'border-blue-500 bg-blue-50 text-blue-700'
                  : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50',
              ].join(' ')}
            >
              {q}
              {isOpenNow && (
                <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-emerald-700">
                  open
                </span>
              )}
            </button>
          )
        })}
        <span className="ml-auto text-xs text-slate-400">
          {PERIOD_LABEL_DISPLAY[selectedQuarter]}
        </span>
      </div>

      {/* Goals table */}
      <div className="card overflow-hidden p-0">
        <div className="flex items-center justify-between border-b bg-slate-50 px-5 py-3">
          <h2 className="text-sm font-semibold text-slate-800">
            Goals & Achievements ({selectedQuarter})
          </h2>
          {!inputsEditable && (
            <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
              <Lock size={11} /> read-only
            </span>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 uppercase tracking-wide">
              <tr>
                <th className="th">Goal</th>
                <th className="th">UoM</th>
                <th className="th">Target</th>
                <th className="th">Wt %</th>
                <th className="th">Actual ({selectedQuarter})</th>
                <th className="th">Self ★</th>
                <th className="th">Live Score</th>
                {inputsEditable && <th className="th">Save</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {goals.map((goal) => {
                const edit = edits[goal._id] ?? {
                  actualValue: '',
                  selfRating: '',
                  remarks: '',
                }
                const flag = rowFlags[goal._id]
                const isSavingRow = savingGoal === goal._id
                const livePreview = calculateProgress(
                  goal.uom_type,
                  goal.target_value,
                  edit.actualValue || goal.latest_actual_value,
                  goal.weightage,
                )
                // Locate the saved check-in so we can surface the manager remark
                const existingCheckin = checkins.find(
                  (c) => c.goal_id === goal._id && c.period_label === selectedQuarter,
                )
                const colCount = inputsEditable ? 8 : 7

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
                        <UoMBadge uom={goal.uom_type} />
                      </td>
                      <td className="td">
                        {String(goal.target_value)}
                      </td>
                      <td className="td">
                        {goal.weightage}
                      </td>
                      {/* Actual */}
                      <td className="td">
                        <ActualInput
                          uom={goal.uom_type}
                          value={edit.actualValue}
                          readOnly={!inputsEditable}
                          onChange={(v) => handleEditChange(goal._id, 'actualValue', v)}
                        />
                      </td>
                      {/* Self rating */}
                      <td className="td">
                        <select
                          value={edit.selfRating}
                          disabled={!inputsEditable}
                          onChange={(e) =>
                            handleEditChange(goal._id, 'selfRating', e.target.value)
                          }
                          className={cn(
                            'input h-7 w-auto min-w-16 px-1 text-xs py-1',
                            !inputsEditable && 'opacity-70',
                          )}
                        >
                          <option value="">—</option>
                          {[0, 1, 2, 3, 4, 5].map((r) => (
                            <option key={r} value={r}>
                              {r}
                            </option>
                          ))}
                        </select>
                      </td>
                      {/* Live score */}
                      <td className="td">
                        {livePreview.achievementPct === null ? (
                          <span className="text-slate-300">—</span>
                        ) : (
                          <div className="leading-tight">
                            <span
                              className={
                                livePreview.achievementPct >= 80
                                  ? 'font-semibold text-green-600'
                                  : livePreview.achievementPct >= 50
                                  ? 'font-semibold text-amber-600'
                                  : 'font-semibold text-red-500'
                              }
                            >
                              {livePreview.achievementPct.toFixed(1)} %
                            </span>
                            <p className="text-[11px] text-slate-400">
                              score {(livePreview.goalScore ?? 0).toFixed(2)}
                            </p>
                          </div>
                        )}
                      </td>
                      {inputsEditable && (
                        <td className="td">
                          {isSavingRow ? (
                            <Loader2 className="mx-auto h-4 w-4 animate-spin text-blue-400" />
                          ) : flag?.ok ? (
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-green-600">
                              <CheckCircle2 size={12} /> saved
                            </span>
                          ) : (
                            <button
                              onClick={() => handleSaveRow(goal)}
                              type="button"
                              className="btn-primary btn-sm"
                            >
                              <Save size={11} />
                              Save
                            </button>
                          )}
                          {flag?.message && (
                            <p className="mt-1 text-[11px] text-red-500">
                              {flag.message}
                            </p>
                          )}
                        </td>
                      )}
                    </tr>

                    {/* Manager remark sub-row — read-only, mirrors the blue card in the manager review */}
                    {existingCheckin?.manager_remark && (
                      <tr className="tr">
                        <td colSpan={colCount} className="td">
                          <div className="rounded-md border border-blue-100 bg-blue-50/70 px-3 py-2">
                            <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-blue-600">
                              <span className="inline-block h-1.5 w-1.5 rounded-full bg-blue-400" />
                              Manager remark
                            </p>
                            <p className="whitespace-pre-wrap text-xs leading-relaxed text-slate-700">
                              {existingCheckin.manager_remark}
                            </p>
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

        {/* Employee remarks — one textarea per goal, editable during the open window */}
        <div className="border-t bg-slate-50/60 px-5 py-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Remarks (optional)
          </p>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {goals.map((goal) => (
              <div key={goal._id} className="card-sm border-slate-200 p-3">
                <p className="mb-1 text-xs font-medium text-slate-600 line-clamp-1">
                  {goal.description}
                </p>
                <Textarea
                  rows={2}
                  value={edits[goal._id]?.remarks ?? ''}
                  disabled={!inputsEditable}
                  onChange={(e) =>
                    handleEditChange(goal._id, 'remarks', e.target.value)
                  }
                  placeholder={
                    inputsEditable
                      ? 'Add context for your manager (optional)…'
                      : 'Read-only outside the check-in window.'
                  }
                  className={cn('input min-h-[4.5rem] resize-none text-xs')}
                />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Manager review notes — read-only structured comments for the selected quarter */}
      {(() => {
        const quarterComments = comments.filter((c) => c.quarter === selectedQuarter)
        if (quarterComments.length === 0) return null
        return (
          <div className="card overflow-hidden border-blue-100 p-0">
            <div className="flex items-center gap-2 border-b border-blue-100 bg-blue-50/60 px-5 py-3">
              <MessageSquare size={15} className="text-blue-500" />
              <h2 className="text-sm font-semibold text-blue-800">
                Manager Review Notes — {selectedQuarter}
              </h2>
              <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                <Lock size={10} /> read-only
              </span>
            </div>
            <ul className="divide-y divide-slate-100 p-4 space-y-3">
              {quarterComments.map((c) => (
                <li
                  key={c._id}
                  className="rounded-lg border border-blue-100 bg-blue-50/40 px-4 py-3"
                >
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="rounded-full bg-blue-100 px-2 py-0.5 font-semibold text-blue-700">
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
          </div>
        )
      })()}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Small subcomponents
// ---------------------------------------------------------------------------

function UoMBadge({ uom }: { uom: UoMType }) {
  const tone =
    uom === 'Min'
      ? 'bg-rose-50 text-rose-700'
      : uom === 'Max' || uom === 'Numeric'
      ? 'bg-blue-50 text-blue-700'
      : uom === 'Timeline'
      ? 'bg-amber-50 text-amber-700'
      : 'bg-violet-50 text-violet-700'
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}>
      {uom === 'Numeric' ? 'Max (legacy)' : uom}
    </span>
  )
}

function ActualInput({
  uom,
  value,
  readOnly,
  onChange,
}: {
  uom: UoMType
  value: string
  readOnly: boolean
  onChange: (v: string) => void
}) {
  const inputBase = cn(
    'input h-8 py-2 text-right text-xs font-mono',
    readOnly && 'opacity-70 cursor-not-allowed',
  )

  if (uom === 'Zero') {
    return (
      <select
        value={value}
        disabled={readOnly}
        onChange={(e) => onChange(e.target.value)}
        className={inputBase}
      >
        <option value="">—</option>
        <option value="Yes">Yes</option>
        <option value="No">No</option>
      </select>
    )
  }

  if (uom === 'Timeline') {
    return (
      <Input
        type="date"
        value={value}
        readOnly={readOnly}
        disabled={readOnly}
        onChange={(e) => onChange(e.target.value)}
        className={inputBase}
      />
    )
  }

  return (
    <Input
      type="number"
      step="any"
      value={value}
      readOnly={readOnly}
      disabled={readOnly}
      onChange={(e) => onChange(e.target.value)}
      placeholder="—"
      className={inputBase}
    />
  )
}
