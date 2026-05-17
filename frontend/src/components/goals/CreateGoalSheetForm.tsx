/**
 * CreateGoalSheetForm
 *
 * Handles BOTH create-new and edit-existing modes.
 *
 * Create mode (no sheetId prop):
 *   POST /api/goals/ — creates sheet + all goals atomically (status = DRAFT)
 *
 * Edit mode (sheetId prop supplied):
 *   - Fetches the existing sheet and goals from the API (useEffect re-runs on sheetId change)
 *   - Pre-populates all personal goals; shared goals show SHARED badge with read-only fields
 *   - On save: PATCHes changed shared-goal weightages → DELETEs old personal goals
 *     → POSTs new personal goals to the existing sheet
 *
 * Validation rules enforced (docs/VALIDATION_RULES.md):
 *   §1  Thrust Area — one of 8 allowed values
 *   §2  UoM Type — Numeric | Timeline | Zero
 *   §2a target_value positive number (Numeric)
 *   §2b target_value non-empty string ≤ 500 chars (Timeline)
 *   §4  Weightage 10–50 per goal; sheet total must equal 100 %
 *   §5  Min 3 / Max 8 goals; duplicate thrust_area + description rejected
 */

import { useState, useEffect } from 'react'
import { type Resolver, useFieldArray, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { AlertCircle, Info, Link2, Loader2, Lock, Plus, Trash2 } from 'lucide-react'

import api from '@/lib/api'
import { cn } from '@/lib/utils'
import { THRUST_AREA_LABELS, type Goal, type GoalSheet } from '@/types'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

// ---------------------------------------------------------------------------
// Zod schema — mirrors backend Pydantic models exactly
// ---------------------------------------------------------------------------

const THRUST_AREAS = [
  'INNOVATION_TECHNOLOGY',
  'QUALITY_PROCESS_EXCELLENCE',
  'CUSTOMER_SATISFACTION',
  'DELIVERY_TIMELINESS',
  'PEOPLE_DEVELOPMENT',
  'BUSINESS_GROWTH',
  'SAFETY_COMPLIANCE',
  'COST_OPTIMISATION',
] as const

const UOM_TYPES = ['Numeric', 'Timeline', 'Zero'] as const

// Flat schema — cross-field validation handled in superRefine so Zod v4's
// discriminated-union type inference issues with optional().default() don't leak
// into the react-hook-form resolver types.
const goalRowSchema = z
  .object({
    uom_type: z.enum(UOM_TYPES, { error: 'Measurement type is required.' }),
    thrust_area: z.enum(THRUST_AREAS, { error: 'Thrust Area is required.' }),
    description: z
      .string()
      .min(10, 'Description must be at least 10 characters.')
      .max(500, 'Description must not exceed 500 characters.'),
    unit_of_measure: z.string().max(50).optional(),
    target_value: z.string().min(1, 'Target Value is required.'),
    weightage: z
      .number({ error: 'Weightage must be a number.' })
      .min(10, 'Minimum weightage per goal is 10 %.'),
  })
  .superRefine((data, ctx) => {
    if (data.uom_type === 'Numeric') {
      if (!data.unit_of_measure?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['unit_of_measure'],
          message: 'Unit of Measure is required (e.g. %, Number, ₹ Lakh).',
        })
      }
      const n = parseFloat(data.target_value)
      if (isNaN(n) || n <= 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['target_value'],
          message: 'Target must be a positive number for Numeric goals.',
        })
      }
    } else if (data.uom_type === 'Zero') {
      if (!['Yes', 'No'].includes(data.target_value.trim())) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['target_value'],
          message: "Target must be 'Yes' or 'No' for Zero goals.",
        })
      }
    } else if (data.uom_type === 'Timeline') {
      if (data.target_value.length > 500) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['target_value'],
          message: 'Target must not exceed 500 characters for Timeline goals.',
        })
      }
    }
  })

const formSchema = z
  .object({
    period_label: z
      .string()
      .min(1, 'Appraisal period is required.')
      .max(50, 'Period label must not exceed 50 characters.'),
    goals: z
      .array(goalRowSchema)
      .min(3, 'You must define at least 3 goals.')
      .max(8, 'You cannot define more than 8 goals.'),
  })
  .superRefine((data, ctx) => {
    const total = data.goals.reduce((sum, g) => sum + (g.weightage || 0), 0)
    if (Math.round(total * 100) / 100 !== 100) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['goals'],
        message: `Total weightage must equal exactly 100 %. Current total: ${total.toFixed(2)} %`,
      })
    }

    const seen = new Map<string, number>()
    data.goals.forEach((g, idx) => {
      const key = `${g.thrust_area}||${g.description.trim().toLowerCase()}`
      if (seen.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['goals', idx, 'description'],
          message: 'Duplicate: a goal with the same Thrust Area and Description already exists.',
        })
      } else {
        seen.set(key, idx)
      }
    })
  })

type FormValues = z.infer<typeof formSchema>

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_GOAL = {
  uom_type: 'Numeric' as const,
  thrust_area: undefined as unknown as typeof THRUST_AREAS[number],
  description: '',
  unit_of_measure: '',
  target_value: '',
  weightage: 0,
}

const PERIOD_OPTIONS = [
  { value: 'fy-2025-26', label: 'FY 2025-26' },
  { value: 'fy-2026-27', label: 'FY 2026-27' },
]

const UOM_TYPE_LABELS: Record<typeof UOM_TYPES[number], string> = {
  Numeric: 'Numeric — measured by a number',
  Timeline: 'Timeline — measured by a date / milestone',
  Zero: 'Zero — binary Yes / No outcome',
}

/** Per-row metadata tracking goal identity (for edit mode) */
interface GoalMeta {
  goalId?: string    // DB _id of the existing goal, undefined for new goals added in edit mode
  isShared: boolean  // true when shared_goal_ref.is_shared === true
}

/** Convert a Goal document to a form row value */
function goalToFormRow(goal: Goal): FormValues['goals'][number] {
  const tv =
    typeof goal.target_value === 'number'
      ? String(goal.target_value)
      : (goal.target_value as string)

  const uomType = UOM_TYPES.includes(goal.uom_type as typeof UOM_TYPES[number])
    ? (goal.uom_type as typeof UOM_TYPES[number])
    : 'Numeric'

  const defaultUom =
    uomType === 'Timeline' ? 'Date' : uomType === 'Zero' ? 'Yes/No' : ''

  return {
    uom_type: uomType,
    thrust_area: goal.thrust_area,
    description: goal.description,
    unit_of_measure: goal.unit_of_measure || defaultUom,
    target_value: uomType === 'Zero' ? (tv === 'Yes' || tv === 'No' ? tv : 'Yes') : tv,
    weightage: goal.weightage,
  }
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface CreateGoalSheetFormProps {
  onSuccess: (sheet: GoalSheet, goals: Goal[]) => void
  /** Called when the user clicks Cancel in edit mode */
  onCancel?: () => void
  /**
   * When provided the form is in edit mode.
   * The form fetches the existing sheet + goals from the API using this ID,
   * then pre-populates the form. The useEffect re-fires whenever sheetId changes.
   */
  sheetId?: string
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CreateGoalSheetForm({
  onSuccess,
  onCancel,
  sheetId,
}: CreateGoalSheetFormProps) {
  const isEditMode = !!sheetId

  const [submitMode, setSubmitMode] = useState<'draft' | 'submit'>('draft')
  const [serverError, setServerError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  // Sheet-loading state (edit mode — the form fetches its own data)
  const [sheetFetching, setSheetFetching] = useState(!!sheetId)
  const [sheetFetchError, setSheetFetchError] = useState<string | null>(null)
  const [activeSheet, setActiveSheet] = useState<GoalSheet | null>(null)
  const [originalGoals, setOriginalGoals] = useState<Goal[]>([])

  // Parallel metadata array — one entry per form field, tracking DB id and shared status
  const [goalsMeta, setGoalsMeta] = useState<GoalMeta[]>([
    { isShared: false },
    { isShared: false },
    { isShared: false },
  ])

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema) as Resolver<FormValues>,
    defaultValues: {
      period_label: 'FY 2025-26',
      goals: [{ ...DEFAULT_GOAL }, { ...DEFAULT_GOAL }, { ...DEFAULT_GOAL }],
    },
    mode: 'onChange',
  })

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: 'goals',
  })

  // ---------------------------------------------------------------------------
  // Fetch existing sheet data whenever sheetId changes (edit mode)
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!sheetId) return

    setSheetFetching(true)
    setSheetFetchError(null)

    Promise.all([
      api.get<GoalSheet>(`/goalsheets/${sheetId}`),
      api.get<Goal[]>(`/goals/sheet/${sheetId}`),
    ])
      .then(([sheetRes, goalsRes]) => {
        const fetchedSheet = sheetRes.data
        const fetchedGoals = goalsRes.data

        setActiveSheet(fetchedSheet)
        setOriginalGoals(fetchedGoals)

        const newMeta: GoalMeta[] = fetchedGoals.map((g) => ({
          goalId: g._id,
          isShared: g.shared_goal_ref?.is_shared === true,
        }))
        setGoalsMeta(newMeta)

        // Reset the entire form with fetched values — this is what makes the
        // fields appear pre-filled on every sheetId change.
        form.reset({
          period_label: fetchedSheet.period_label,
          goals: fetchedGoals.map(goalToFormRow),
        })
      })
      .catch(() => {
        setSheetFetchError('Failed to load goal sheet data. Please try again.')
      })
      .finally(() => {
        setSheetFetching(false)
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheetId])

  // Wrappers that keep goalsMeta in sync with the field array
  const handleAppend = () => {
    append({ ...DEFAULT_GOAL })
    setGoalsMeta((prev) => [...prev, { isShared: false }])
  }

  const handleRemove = (index: number) => {
    remove(index)
    setGoalsMeta((prev) => prev.filter((_, i) => i !== index))
  }

  const watchedGoals = form.watch('goals')
  const totalWeightage = watchedGoals.reduce((sum, g) => sum + (Number(g.weightage) || 0), 0)
  const weightageOk = Math.round(totalWeightage * 100) / 100 === 100

  // ---------------------------------------------------------------------------
  // Submit handler
  // ---------------------------------------------------------------------------

  const onSubmit = async (values: FormValues) => {
    setServerError(null)
    setIsLoading(true)

    try {
      if (isEditMode && activeSheet) {
        // ── Edit mode: update existing sheet in-place ─────────────────────

        // Step 1: PATCH shared goal weightages only when they changed
        for (let i = 0; i < values.goals.length; i++) {
          const meta = goalsMeta[i]
          if (!meta?.isShared || !meta.goalId) continue
          const original = originalGoals.find((g) => g._id === meta.goalId)
          if (original && values.goals[i].weightage !== original.weightage) {
            await api.patch(`/goals/${meta.goalId}`, { weightage: values.goals[i].weightage })
          }
        }

        // Step 2: DELETE all existing personal goals (they will be recreated below)
        const existingPersonalIds = goalsMeta
          .filter((m) => !m.isShared && m.goalId)
          .map((m) => m.goalId!)
        for (const id of existingPersonalIds) {
          await api.delete(`/goals/${id}`)
        }

        // Step 3: POST new personal goals to the existing sheet
        for (let i = 0; i < values.goals.length; i++) {
          if (goalsMeta[i]?.isShared) continue
          const g = values.goals[i]
          await api.post(`/goals/sheet/${activeSheet._id}`, {
            thrust_area: g.thrust_area,
            description: g.description,
            uom_type: g.uom_type,
            unit_of_measure: g.unit_of_measure || 'Milestone',
            target_value:
              g.uom_type === 'Numeric' ? parseFloat(g.target_value as string) : g.target_value,
            weightage: g.weightage,
          })
        }

        // Step 4: Fetch the refreshed sheet and goals
        const [sheetRes, goalsRes] = await Promise.all([
          api.get<GoalSheet>(`/goalsheets/${activeSheet._id}`),
          api.get<Goal[]>(`/goals/sheet/${activeSheet._id}`),
        ])

        // Step 5: Optionally submit for approval
        if (submitMode === 'submit') {
          await api.patch(`/goals/sheet/${activeSheet._id}/submit`)
          sheetRes.data.status = 'SUBMITTED'
        }

        onSuccess(sheetRes.data, goalsRes.data)
      } else {
        // ── Create mode: single-shot POST ────────────────────────────────

        const periodId =
          PERIOD_OPTIONS.find((p) => p.label === values.period_label)?.value ??
          values.period_label.toLowerCase().replace(/\s+/g, '-')

        const payload = {
          period_id: periodId,
          period_label: values.period_label,
          goals: values.goals.map((g) => ({
            thrust_area: g.thrust_area,
            description: g.description,
            uom_type: g.uom_type,
            unit_of_measure: g.unit_of_measure || 'Milestone',
            target_value:
              g.uom_type === 'Numeric' ? parseFloat(g.target_value as string) : g.target_value,
            weightage: g.weightage,
          })),
        }

        const createRes = await api.post<{ sheet: GoalSheet; goals: Goal[] }>('/goals/', payload)
        const { sheet, goals } = createRes.data

        if (submitMode === 'submit') {
          await api.patch(`/goals/sheet/${sheet._id}/submit`)
          sheet.status = 'SUBMITTED'
        }

        onSuccess(sheet, goals)
      }
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: unknown } } }
      const detail = axiosErr?.response?.data?.detail
      if (Array.isArray(detail)) {
        setServerError(detail.map((d: { msg: string }) => d.msg).join(' · '))
      } else if (typeof detail === 'string') {
        setServerError(detail)
      } else {
        setServerError('An unexpected error occurred. Please try again.')
      }
    } finally {
      setIsLoading(false)
    }
  }

  // ---------------------------------------------------------------------------
  // Render — loading / error states while fetching in edit mode
  // ---------------------------------------------------------------------------

  if (sheetFetching) {
    return (
      <div className="flex items-center justify-center gap-3 py-16 text-sm text-slate-500">
        <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
        Loading goal sheet…
      </div>
    )
  }

  if (sheetFetchError) {
    return (
      <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="flex-1">
          <p>{sheetFetchError}</p>
          <button
            className="mt-2 text-xs font-medium underline hover:no-underline"
            onClick={() => {
              setSheetFetchError(null)
              setSheetFetching(true)
              Promise.all([
                api.get<GoalSheet>(`/goalsheets/${sheetId}`),
                api.get<Goal[]>(`/goals/sheet/${sheetId}`),
              ])
                .then(([sheetRes, goalsRes]) => {
                  setActiveSheet(sheetRes.data)
                  setOriginalGoals(goalsRes.data)
                  const newMeta = goalsRes.data.map((g) => ({
                    goalId: g._id,
                    isShared: g.shared_goal_ref?.is_shared === true,
                  }))
                  setGoalsMeta(newMeta)
                  form.reset({
                    period_label: sheetRes.data.period_label,
                    goals: goalsRes.data.map(goalToFormRow),
                  })
                })
                .catch(() => setSheetFetchError('Failed to load goal sheet data. Please try again.'))
                .finally(() => setSheetFetching(false))
            }}
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  // ---------------------------------------------------------------------------
  // Main form render
  // ---------------------------------------------------------------------------

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">

        {/* Server-level error banner */}
        {serverError && (
          <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{serverError}</span>
          </div>
        )}

        {/* ── Period selector / locked display ── */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Appraisal Period</CardTitle>
            <CardDescription>
              {isEditMode
                ? 'The appraisal period is fixed for an existing goal sheet.'
                : 'Select the performance period this Goal Sheet covers.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isEditMode ? (
              <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 max-w-xs">
                <Lock className="h-4 w-4 shrink-0 text-slate-400" />
                <span className="text-sm font-medium text-slate-700">
                  {activeSheet?.period_label ?? form.getValues('period_label')}
                </span>
              </div>
            ) : (
              <FormField
                control={form.control}
                name="period_label"
                render={({ field }) => (
                  <FormItem className="max-w-xs">
                    <FormLabel>Period</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select period" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {PERIOD_OPTIONS.map((p) => (
                          <SelectItem key={p.value} value={p.label}>
                            {p.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}
          </CardContent>
        </Card>

        {/* ── Weightage summary bar ── */}
        <div
          className={cn(
            'flex items-center justify-between rounded-lg border px-4 py-3 text-sm font-medium',
            weightageOk
              ? 'border-green-200 bg-green-50 text-green-700'
              : 'border-amber-200 bg-amber-50 text-amber-700',
          )}
        >
          <div className="flex items-center gap-2">
            <Info className="h-4 w-4" />
            <span>Total Weightage: {totalWeightage.toFixed(2)} %</span>
          </div>
          <span>{weightageOk ? '✓ Balanced' : `Need ${(100 - totalWeightage).toFixed(2)} % more`}</span>
        </div>

        {/* Global goals-array error (weightage total / count) */}
        {form.formState.errors.goals?.root?.message && (
          <p className="text-xs font-medium text-red-600">
            {form.formState.errors.goals.root.message}
          </p>
        )}
        {typeof form.formState.errors.goals?.message === 'string' && (
          <p className="text-xs font-medium text-red-600">
            {form.formState.errors.goals.message}
          </p>
        )}

        {/* ── Goal rows ── */}
        {fields.map((field, index) => (
          <GoalRow
            key={field.id}
            index={index}
            form={form}
            isShared={goalsMeta[index]?.isShared ?? false}
            canRemove={!(goalsMeta[index]?.isShared) && fields.length > 3}
            onRemove={() => handleRemove(index)}
          />
        ))}

        {/* Add goal button */}
        {fields.length < 8 && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleAppend}
            className="gap-2"
          >
            <Plus className="h-4 w-4" />
            Add Goal ({fields.length}/8)
          </Button>
        )}

        {/* ── Action buttons ── */}
        <div className="flex flex-wrap items-center gap-3 pt-2">
          <Button
            type="submit"
            variant="outline"
            disabled={isLoading}
            onClick={() => setSubmitMode('draft')}
          >
            {isLoading && submitMode === 'draft' ? 'Saving…' : 'Save as Draft'}
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={isLoading}
            onClick={() => setSubmitMode('submit')}
          >
            {isLoading && submitMode === 'submit' ? 'Submitting…' : 'Submit for Approval'}
          </Button>
          {onCancel && (
            <Button
              type="button"
              variant="ghost"
              disabled={isLoading}
              onClick={onCancel}
            >
              Cancel
            </Button>
          )}
          <p className="text-xs text-slate-400">
            Min 3 · Max 8 goals · Min 10 % per goal · Total must equal 100 %
          </p>
        </div>
      </form>
    </Form>
  )
}

// ---------------------------------------------------------------------------
// GoalRow — individual goal card
// ---------------------------------------------------------------------------

interface GoalRowProps {
  index: number
  form: ReturnType<typeof useForm<FormValues>>
  canRemove: boolean
  onRemove: () => void
  /** When true, all fields except Weightage are rendered read-only (SHARED_GOALS.md) */
  isShared?: boolean
}

function GoalRow({ index, form, canRemove, onRemove, isShared = false }: GoalRowProps) {
  const uomType = form.watch(`goals.${index}.uom_type`)

  return (
    <Card className={cn('relative', isShared && 'border-indigo-200 bg-indigo-50/20')}>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <div className="flex items-center gap-2">
          <CardTitle className="text-sm text-slate-500 font-normal">
            Goal <span className="font-semibold text-slate-800">#{index + 1}</span>
          </CardTitle>
          {isShared && (
            <span className="inline-flex items-center gap-1 rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-semibold text-indigo-700">
              <Link2 size={10} />
              SHARED
            </span>
          )}
        </div>
        {canRemove && !isShared && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-slate-400 hover:text-red-500"
            onClick={onRemove}
            title="Remove this goal"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </CardHeader>

      <CardContent className="grid gap-4">
        {/* Shared-goal notice */}
        {isShared && (
          <div className="flex items-center gap-1.5 rounded-md border border-indigo-100 bg-indigo-50 px-3 py-2 text-xs text-indigo-600">
            <Lock size={11} className="shrink-0" />
            This is a shared goal assigned to you. All fields are read-only except Weightage.
          </div>
        )}

        {/* Row 1: Thrust Area + UoM Type */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {/* Thrust Area */}
          <FormField
            control={form.control}
            name={`goals.${index}.thrust_area`}
            render={({ field }) => (
              <FormItem>
                <FormLabel>Thrust Area <span className="text-red-500">*</span></FormLabel>
                <Select
                  onValueChange={field.onChange}
                  value={field.value ?? ''}
                  disabled={isShared}
                >
                  <FormControl>
                    <SelectTrigger className={cn(isShared && 'cursor-not-allowed opacity-70')}>
                      <SelectValue placeholder="Select thrust area" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {Object.entries(THRUST_AREA_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          {/* UoM Type */}
          <FormField
            control={form.control}
            name={`goals.${index}.uom_type`}
            render={({ field }) => (
              <FormItem>
                <FormLabel>Measurement Type <span className="text-red-500">*</span></FormLabel>
                <Select
                  onValueChange={field.onChange}
                  value={field.value}
                  disabled={isShared}
                >
                  <FormControl>
                    <SelectTrigger className={cn(isShared && 'cursor-not-allowed opacity-70')}>
                      <SelectValue placeholder="Select type" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {UOM_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {UOM_TYPE_LABELS[t]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormDescription>
                  {uomType === 'Numeric'
                    ? 'Achievement tracked as a number.'
                    : uomType === 'Timeline'
                    ? 'Achievement tracked against a date or deadline.'
                    : 'Achievement tracked as a binary Yes / No outcome.'}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {/* Row 2: Description */}
        <FormField
          control={form.control}
          name={`goals.${index}.description`}
          render={({ field }) => (
            <FormItem>
              <FormLabel>Goal Description <span className="text-red-500">*</span></FormLabel>
              <FormControl>
                <Textarea
                  placeholder="Describe what this goal achieves and how success is measured… (10–500 characters)"
                  rows={3}
                  disabled={isShared}
                  className={cn(isShared && 'cursor-not-allowed opacity-70 resize-none')}
                  {...field}
                />
              </FormControl>
              <div className="flex justify-between">
                <FormMessage />
                {!isShared && (
                  <span
                    className={cn(
                      'ml-auto text-xs',
                      (field.value?.length ?? 0) > 480 ? 'text-amber-600' : 'text-slate-400',
                    )}
                  >
                    {field.value?.length ?? 0}/500
                  </span>
                )}
              </div>
            </FormItem>
          )}
        />

        {/* Row 3: Unit of Measure + Target + Weightage */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {/* Unit of Measure */}
          <FormField
            control={form.control}
            name={`goals.${index}.unit_of_measure`}
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  Unit of Measure
                  {uomType === 'Numeric' && !isShared && <span className="text-red-500"> *</span>}
                </FormLabel>
                <FormControl>
                  <Input
                    placeholder={
                      uomType === 'Numeric'
                        ? 'e.g. %, ₹ Lakh, Days'
                        : uomType === 'Timeline'
                        ? 'Date'
                        : 'Yes/No'
                    }
                    disabled={isShared}
                    className={cn(isShared && 'cursor-not-allowed opacity-70')}
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {/* Target Value */}
          <FormField
            control={form.control}
            name={`goals.${index}.target_value`}
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  Target Value <span className="text-red-500">*</span>
                  {isShared && (
                    <Lock size={10} className="ml-1 inline text-indigo-400" />
                  )}
                </FormLabel>
                <FormControl>
                  {uomType === 'Numeric' ? (
                    <Input
                      type={isShared ? 'text' : 'number'}
                      step="any"
                      min="0.0001"
                      placeholder="e.g. 95"
                      disabled={isShared}
                      readOnly={isShared}
                      className={cn(isShared && 'cursor-not-allowed opacity-70')}
                      {...field}
                    />
                  ) : uomType === 'Timeline' ? (
                    <Input
                      placeholder="e.g. 2026-03-31 or Q4 FY 2025-26"
                      disabled={isShared}
                      readOnly={isShared}
                      className={cn(isShared && 'cursor-not-allowed opacity-70')}
                      {...field}
                    />
                  ) : (
                    <Select
                      onValueChange={field.onChange}
                      value={field.value as string}
                      disabled={isShared}
                    >
                      <SelectTrigger className={cn(isShared && 'cursor-not-allowed opacity-70')}>
                        <SelectValue placeholder="Yes or No" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Yes">Yes</SelectItem>
                        <SelectItem value="No">No</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {/* Weightage — always editable, even for shared goals */}
          <FormField
            control={form.control}
            name={`goals.${index}.weightage`}
            render={({ field }) => (
              <FormItem>
                <FormLabel>Weightage % <span className="text-red-500">*</span></FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    step="0.01"
                    min="10"
                    max="50"
                    placeholder="10–50"
                    value={field.value === 0 ? '' : field.value}
                    onChange={(e) =>
                      field.onChange(e.target.value === '' ? 0 : parseFloat(e.target.value))
                    }
                  />
                </FormControl>
                <FormDescription>
                  Min 10 %{isShared ? ' · Only editable field for shared goals' : ' · Max 50 %'}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
      </CardContent>
    </Card>
  )
}
