/**
 * PushSharedKpiForm
 *
 * Admin or Manager pushes a departmental KPI to multiple employees simultaneously.
 *
 * Rules enforced (docs/SHARED_GOALS.md + docs/ROLE_PERMISSIONS.md):
 *   - Only Admin / Manager can push KPIs
 *   - Employees receive a goal copy where only Weightage is editable
 *   - Goal title (description) and target are read-only for all recipients
 *   - Achievement syncs automatically from the designated primary owner
 *
 * Validation mirrors backend (docs/VALIDATION_RULES.md):
 *   - Weightage: 10 – 50 %
 *   - target_value validated per uom_type
 *   - Primary owner must be among selected recipients
 *   - At least 1 recipient required
 */

import { useCallback, useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Loader2,
  Send,
  SkipForward,
  XCircle,
} from 'lucide-react'

import api from '@/lib/api'
import { THRUST_AREA_LABELS, type SharedKpiPushResponse, type User } from '@/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

// ---------------------------------------------------------------------------
// Zod schema
// ---------------------------------------------------------------------------

const THRUST_AREAS = [
  'INNOVATION_TECHNOLOGY', 'QUALITY_PROCESS_EXCELLENCE', 'CUSTOMER_SATISFACTION',
  'DELIVERY_TIMELINESS', 'PEOPLE_DEVELOPMENT', 'BUSINESS_GROWTH',
  'SAFETY_COMPLIANCE', 'COST_OPTIMISATION',
] as const

const UOM_TYPES = ['Numeric', 'Timeline', 'Zero'] as const

const schema = z
  .object({
    period_id: z.string().min(1, 'Period ID is required.'),
    period_label: z.string().min(1, 'Period label is required.').max(50),
    thrust_area: z.enum(THRUST_AREAS, { error: 'Thrust Area is required.' }),
    description: z
      .string()
      .min(10, 'Description must be at least 10 characters.')
      .max(500, 'Max 500 characters.'),
    uom_type: z.enum(UOM_TYPES, { error: 'UoM Type is required.' }),
    unit_of_measure: z.string().min(1, 'Unit is required.').max(50),
    target_value: z.string().min(1, 'Target value is required.'),
    default_weightage: z
      .number({ error: 'Must be a number.' })
      .min(10, 'Minimum 10 %.')
      .max(50, 'Maximum 50 %.'),
    primary_owner_id: z.string().min(1, 'Primary owner is required.'),
  })
  .superRefine((data, ctx) => {
    if (data.uom_type === 'Numeric') {
      const n = parseFloat(data.target_value)
      if (isNaN(n) || n <= 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['target_value'], message: 'Must be a positive number.' })
      }
    } else if (data.uom_type === 'Zero') {
      if (!['Yes', 'No'].includes(data.target_value.trim())) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['target_value'], message: 'Must be "Yes" or "No".' })
      }
    } else if (!data.target_value.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['target_value'], message: 'Required.' })
    }
  })

type FormValues = z.infer<typeof schema>

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props {
  /** Pre-loaded list of potential recipients (team members) */
  teamMembers: User[]
  /** Called after a successful push with the response */
  onSuccess?: (res: SharedKpiPushResponse) => void
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PushSharedKpiForm({ teamMembers, onSuccess }: Props) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [selectedRecipients, setSelectedRecipients] = useState<Set<string>>(new Set())
  const [recipientError, setRecipientError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [pushResult, setPushResult] = useState<SharedKpiPushResponse | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const employees = teamMembers.filter((u) => u.role === 'EMPLOYEE')

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      period_id: 'FY2025-26',
      period_label: 'FY 2025-26',
      default_weightage: 20,
    },
  })

  const uomType = watch('uom_type')
  const primaryOwnerId = watch('primary_owner_id')

  // When primary owner changes, ensure they are selected as recipient
  useEffect(() => {
    if (primaryOwnerId) {
      setSelectedRecipients((prev) => new Set([...prev, primaryOwnerId]))
    }
  }, [primaryOwnerId])

  function toggleRecipient(userId: string) {
    const isPrimary = primaryOwnerId === userId
    setSelectedRecipients((prev) => {
      const next = new Set(prev)
      if (next.has(userId) && !isPrimary) {
        next.delete(userId)
      } else {
        next.add(userId)
      }
      return next
    })
    setRecipientError(null)
  }

  function selectAll() {
    setSelectedRecipients(new Set(employees.map((e) => e._id)))
  }
  function clearAll() {
    // Keep primary owner selected
    const next = new Set<string>()
    if (primaryOwnerId) next.add(primaryOwnerId)
    setSelectedRecipients(next)
  }

  const onSubmit = useCallback(
    async (values: FormValues) => {
      if (selectedRecipients.size === 0) {
        setRecipientError('Select at least one recipient.')
        return
      }
      if (!selectedRecipients.has(values.primary_owner_id)) {
        setRecipientError('Primary owner must be selected as a recipient.')
        return
      }
      setRecipientError(null)
      setIsSubmitting(true)
      setSubmitError(null)
      setPushResult(null)

      const targetVal =
        values.uom_type === 'Numeric'
          ? parseFloat(values.target_value)
          : values.target_value.trim()

      try {
        const res = await api.post<SharedKpiPushResponse>('/shared-kpis/push', {
          ...values,
          target_value: targetVal,
          recipient_ids: Array.from(selectedRecipients),
        })
        setPushResult(res.data)
        onSuccess?.(res.data)
        // Reset form but keep expanded to show results
        reset({
          period_id: 'FY2025-26',
          period_label: 'FY 2025-26',
          default_weightage: 20,
        })
        setSelectedRecipients(new Set())
      } catch (err: unknown) {
        const axiosErr = err as { response?: { data?: { detail?: string } } }
        setSubmitError(
          axiosErr?.response?.data?.detail ?? 'Push failed. Please try again.',
        )
      } finally {
        setIsSubmitting(false)
      }
    },
    [selectedRecipients, onSuccess, reset],
  )

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="rounded-xl border border-indigo-200 bg-white shadow-sm overflow-hidden">
      {/* Header / toggle */}
      <button
        type="button"
        onClick={() => setIsExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-5 py-4 bg-indigo-50 hover:bg-indigo-100 transition-colors text-left"
      >
        <div>
          <p className="font-semibold text-indigo-900">Push Departmental KPI</p>
          <p className="text-xs text-indigo-600 mt-0.5">
            Assign a shared goal to multiple employees at once
          </p>
        </div>
        {isExpanded ? (
          <ChevronUp className="h-5 w-5 text-indigo-600 shrink-0" />
        ) : (
          <ChevronDown className="h-5 w-5 text-indigo-600 shrink-0" />
        )}
      </button>

      {isExpanded && (
        <form onSubmit={handleSubmit(onSubmit)} className="p-5 space-y-6">
          {/* Push result banner */}
          {pushResult && (
            <div className="rounded-lg border border-green-200 bg-green-50 p-4 space-y-2">
              <div className="flex items-center gap-2 font-semibold text-green-800">
                <CheckCircle2 className="h-4 w-4" />
                KPI pushed — {pushResult.success_count} succeeded,{' '}
                {pushResult.skip_count} skipped,{' '}
                {pushResult.error_count} errors
              </div>
              <ul className="space-y-1">
                {pushResult.push_results.map((r) => (
                  <li key={r.employee_id} className="flex items-start gap-2 text-xs">
                    {r.status === 'SUCCESS' ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-green-600 mt-0.5 shrink-0" />
                    ) : r.status === 'SKIPPED' ? (
                      <SkipForward className="h-3.5 w-3.5 text-amber-500 mt-0.5 shrink-0" />
                    ) : (
                      <XCircle className="h-3.5 w-3.5 text-red-500 mt-0.5 shrink-0" />
                    )}
                    <span className={r.status === 'ERROR' ? 'text-red-700' : r.status === 'SKIPPED' ? 'text-amber-700' : 'text-green-700'}>
                      <strong>{r.employee_name ?? r.employee_id}</strong>: {r.message}
                    </span>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={() => setPushResult(null)}
                className="text-xs text-green-700 underline hover:no-underline"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* Submit error */}
          {submitError && (
            <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              {submitError}
            </div>
          )}

          {/* ── Period ── */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label htmlFor="period_id">Period ID</Label>
              <Input id="period_id" {...register('period_id')} placeholder="FY2025-26" />
              {errors.period_id && (
                <p className="text-xs text-red-500">{errors.period_id.message}</p>
              )}
            </div>
            <div className="space-y-1">
              <Label htmlFor="period_label">Period Label</Label>
              <Input id="period_label" {...register('period_label')} placeholder="FY 2025-26" />
              {errors.period_label && (
                <p className="text-xs text-red-500">{errors.period_label.message}</p>
              )}
            </div>
          </div>

          {/* ── KPI Definition ── */}
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-4">
            <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
              KPI Definition — read-only for all recipients
            </p>

            {/* Thrust Area */}
            <div className="space-y-1">
              <Label>Thrust Area</Label>
              <Select onValueChange={(v) => setValue('thrust_area', v as FormValues['thrust_area'])}>
                <SelectTrigger>
                  <SelectValue placeholder="Select thrust area…" />
                </SelectTrigger>
                <SelectContent>
                  {THRUST_AREAS.map((ta) => (
                    <SelectItem key={ta} value={ta}>
                      {THRUST_AREA_LABELS[ta]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.thrust_area && (
                <p className="text-xs text-red-500">{errors.thrust_area.message}</p>
              )}
            </div>

            {/* Description */}
            <div className="space-y-1">
              <Label htmlFor="description">Goal Description (KPI Title)</Label>
              <Textarea
                id="description"
                {...register('description')}
                rows={2}
                placeholder="e.g. Reduce customer escalations by 30 % across all teams in Q3…"
              />
              {errors.description && (
                <p className="text-xs text-red-500">{errors.description.message}</p>
              )}
            </div>

            {/* UoM Type + Unit */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>UoM Type</Label>
                <Select onValueChange={(v) => setValue('uom_type', v as FormValues['uom_type'])}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select type…" />
                  </SelectTrigger>
                  <SelectContent>
                    {UOM_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.uom_type && (
                  <p className="text-xs text-red-500">{errors.uom_type.message}</p>
                )}
              </div>
              <div className="space-y-1">
                <Label htmlFor="unit_of_measure">Unit of Measure</Label>
                <Input
                  id="unit_of_measure"
                  {...register('unit_of_measure')}
                  placeholder="e.g. %, Count, Date"
                />
                {errors.unit_of_measure && (
                  <p className="text-xs text-red-500">{errors.unit_of_measure.message}</p>
                )}
              </div>
            </div>

            {/* Target Value */}
            <div className="space-y-1">
              <Label htmlFor="target_value">
                Target Value
                {uomType === 'Numeric' && <span className="ml-1 text-slate-400 text-xs">(positive number)</span>}
                {uomType === 'Zero' && <span className="ml-1 text-slate-400 text-xs">(Yes / No)</span>}
                {uomType === 'Timeline' && <span className="ml-1 text-slate-400 text-xs">(date or description)</span>}
              </Label>
              {uomType === 'Zero' ? (
                <Select onValueChange={(v) => setValue('target_value', v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Yes or No" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Yes">Yes</SelectItem>
                    <SelectItem value="No">No</SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  id="target_value"
                  {...register('target_value')}
                  type={uomType === 'Numeric' ? 'number' : 'text'}
                  step={uomType === 'Numeric' ? 'any' : undefined}
                  placeholder={
                    uomType === 'Numeric' ? 'e.g. 30' : 'e.g. By end of Q3 2025'
                  }
                />
              )}
              {errors.target_value && (
                <p className="text-xs text-red-500">{errors.target_value.message}</p>
              )}
            </div>

            {/* Default Weightage */}
            <div className="space-y-1">
              <Label htmlFor="default_weightage">
                Default Weightage{' '}
                <span className="text-slate-400 text-xs">(employees may adjust)</span>
              </Label>
              <div className="flex items-center gap-2">
                <Input
                  id="default_weightage"
                  type="number"
                  min={10}
                  max={50}
                  step={5}
                  className="w-28"
                  {...register('default_weightage', { valueAsNumber: true })}
                />
                <span className="text-sm text-slate-500">%</span>
              </div>
              {errors.default_weightage && (
                <p className="text-xs text-red-500">{errors.default_weightage.message}</p>
              )}
            </div>
          </div>

          {/* ── Recipients ── */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-slate-700">
                Recipients{' '}
                <span className="font-normal text-slate-400">
                  ({selectedRecipients.size} selected)
                </span>
              </p>
              <div className="flex gap-2 text-xs">
                <button type="button" onClick={selectAll} className="text-blue-600 hover:underline">
                  Select all
                </button>
                <span className="text-slate-300">|</span>
                <button type="button" onClick={clearAll} className="text-slate-500 hover:underline">
                  Clear
                </button>
              </div>
            </div>

            {employees.length === 0 ? (
              <p className="text-sm text-slate-400 italic">No employees available.</p>
            ) : (
              <div className="rounded-lg border border-slate-200 divide-y divide-slate-100 max-h-56 overflow-y-auto">
                {employees.map((emp) => {
                  const isSelected = selectedRecipients.has(emp._id)
                  const isPrimary = primaryOwnerId === emp._id
                  return (
                    <label
                      key={emp._id}
                      className={[
                        'flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors text-sm',
                        isSelected ? 'bg-indigo-50' : 'hover:bg-slate-50',
                      ].join(' ')}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleRecipient(emp._id)}
                        disabled={isPrimary}
                        className="h-4 w-4 rounded accent-indigo-600"
                      />
                      <div className="flex-1 min-w-0">
                        <span className="font-medium text-slate-800">{emp.name}</span>
                        <span className="ml-2 text-slate-400 text-xs">{emp.employee_id}</span>
                        {emp.department && (
                          <span className="ml-2 text-slate-400 text-xs">· {emp.department}</span>
                        )}
                      </div>
                      {isPrimary && (
                        <span className="shrink-0 rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-semibold text-indigo-700">
                          Primary
                        </span>
                      )}
                    </label>
                  )
                })}
              </div>
            )}
            {recipientError && (
              <p className="text-xs text-red-500">{recipientError}</p>
            )}
          </div>

          {/* ── Primary Owner ── */}
          <div className="space-y-1">
            <Label>
              Primary Owner{' '}
              <span className="text-slate-400 text-xs">
                — whose check-ins drive achievement for all recipients
              </span>
            </Label>
            <Select
              onValueChange={(v) => setValue('primary_owner_id', v)}
              value={primaryOwnerId ?? ''}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select primary owner…" />
              </SelectTrigger>
              <SelectContent>
                {employees.map((emp) => (
                  <SelectItem key={emp._id} value={emp._id}>
                    {emp.name} ({emp.employee_id})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.primary_owner_id && (
              <p className="text-xs text-red-500">{errors.primary_owner_id.message}</p>
            )}
            {primaryOwnerId && (
              <p className="text-xs text-indigo-600 mt-1">
                When{' '}
                <strong>
                  {employees.find((e) => e._id === primaryOwnerId)?.name ?? primaryOwnerId}
                </strong>{' '}
                submits a check-in, achievement % syncs automatically to all linked employee sheets.
              </p>
            )}
          </div>

          {/* Submit */}
          <div className="flex items-center gap-3 pt-2 border-t">
            <Button
              type="submit"
              disabled={isSubmitting || employees.length === 0}
              className="gap-2 bg-indigo-600 hover:bg-indigo-700 text-white"
            >
              {isSubmitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              {isSubmitting
                ? 'Pushing…'
                : `Push KPI to ${selectedRecipients.size} employee${selectedRecipients.size !== 1 ? 's' : ''}`}
            </Button>
            <button
              type="button"
              onClick={() => {
                setIsExpanded(false)
                setPushResult(null)
                setSubmitError(null)
              }}
              className="text-sm text-slate-500 hover:text-slate-700"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
