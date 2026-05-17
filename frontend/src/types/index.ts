/**
 * TypeScript interfaces that mirror the backend Pydantic models exactly.
 * Sources:
 *   - docs/VALIDATION_RULES.md  (enums, field constraints)
 *   - docs/ROLE_PERMISSIONS.md  (UserRole)
 *   - docs/WORKFLOWS.md         (GoalSheetStatus, state machine)
 *   - docs/CHECKIN_RULES.md     (PeriodLabel, check-in fields)
 */

// ---------------------------------------------------------------------------
// User
// ---------------------------------------------------------------------------

/** Three roles as defined in docs/ROLE_PERMISSIONS.md — do not rename. */
export type UserRole = 'EMPLOYEE' | 'MANAGER' | 'ADMIN'

export interface User {
  _id: string
  employee_id: string
  name: string
  email: string
  role: UserRole
  department: string
  phone?: string
  profile_picture?: string
  /** Required when role === 'EMPLOYEE'; must reference a MANAGER user. */
  manager_id?: string
  /** Resolved server-side for EMPLOYEE users; undefined for MANAGER / ADMIN. */
  reporting_to_name?: string
  is_active: boolean
  created_at: string
}

export interface UserCreate {
  employee_id: string
  name: string
  email: string
  role: UserRole
  department: string
  phone?: string
  manager_id?: string
  password: string
}

export interface UserUpdate {
  name?: string
  phone?: string
  profile_picture?: string
}

export interface Token {
  access_token: string
  token_type: 'bearer'
}

// ---------------------------------------------------------------------------
// Goal — enums from docs/VALIDATION_RULES.md §1 and §2
// ---------------------------------------------------------------------------

/** 8 Thrust Areas from BRD.md §6 / VALIDATION_RULES.md §1 */
export type ThrustArea =
  | 'INNOVATION_TECHNOLOGY'
  | 'QUALITY_PROCESS_EXCELLENCE'
  | 'CUSTOMER_SATISFACTION'
  | 'DELIVERY_TIMELINESS'
  | 'PEOPLE_DEVELOPMENT'
  | 'BUSINESS_GROWTH'
  | 'SAFETY_COMPLIANCE'
  | 'COST_OPTIMISATION'

export const THRUST_AREA_LABELS: Record<ThrustArea, string> = {
  INNOVATION_TECHNOLOGY: 'Innovation & Technology',
  QUALITY_PROCESS_EXCELLENCE: 'Quality & Process Excellence',
  CUSTOMER_SATISFACTION: 'Customer Satisfaction',
  DELIVERY_TIMELINESS: 'Delivery & Timeliness',
  PEOPLE_DEVELOPMENT: 'People Development & Collaboration',
  BUSINESS_GROWTH: 'Business Growth & Revenue',
  SAFETY_COMPLIANCE: 'Safety, Compliance & Risk',
  COST_OPTIMISATION: 'Cost Optimisation',
}

/**
 * UoM types per docs/VALIDATION_RULES.md §UoM Types.
 *
 * Max:      higher actual is better (revenue, conversions)
 * Min:      lower actual is better  (defects, downtime, cost)
 * Timeline: actual delivery date vs. target date — 5-pt penalty per day late
 * Zero:     binary Yes/No outcome
 * Numeric:  legacy alias for Max
 */
export type UoMType = 'Numeric' | 'Min' | 'Max' | 'Timeline' | 'Zero'

export const UOM_TYPE_LABELS: Record<UoMType, string> = {
  Numeric: 'Numeric (legacy)',
  Min: 'Min (lower is better)',
  Max: 'Max (higher is better)',
  Timeline: 'Timeline (date)',
  Zero: 'Zero (Yes / No)',
}

export interface SharedGoalRef {
  is_shared: boolean
  originator_id?: string
  /** Common UUID linking ALL linked goal copies — same as SharedKpi._id */
  link_id?: string
  /** Employee whose check-ins are the authoritative achievement source */
  primary_owner_id?: string
  /** Legacy peer-to-peer field */
  partner_id?: string
  request_status?: 'PENDING' | 'ACCEPTED' | 'DECLINED'
}

export interface Goal {
  _id: string
  goal_sheet_id: string
  owner_id: string
  thrust_area: ThrustArea
  description: string
  uom_type: UoMType
  unit_of_measure: string
  /** Positive number for QUANTITATIVE; text for QUALITATIVE */
  target_value: number | string
  /** Min 5, max 50; sheet total must equal 100 (VALIDATION_RULES.md §4) */
  weightage: number
  shared_goal_ref: SharedGoalRef
  latest_actual_value?: number | string
  achievement_pct?: number
  goal_score?: number
}

export interface GoalCreate {
  thrust_area: ThrustArea
  description: string
  uom_type: UoMType
  unit_of_measure: string
  target_value: number | string
  weightage: number
  shared_goal_ref?: Partial<SharedGoalRef>
}

export interface GoalUpdate extends Partial<GoalCreate> {}

// ---------------------------------------------------------------------------
// Goal Sheet — state machine from docs/WORKFLOWS.md
// ---------------------------------------------------------------------------

/**
 * Status badge colours:
 *   DRAFT → grey | SUBMITTED → blue | RETURNED → amber
 *   APPROVED → green | LOCKED → purple
 */
export type GoalSheetStatus = 'DRAFT' | 'SUBMITTED' | 'RETURNED' | 'APPROVED' | 'LOCKED'

export const STATUS_BADGE_STYLES: Record<GoalSheetStatus, string> = {
  DRAFT: 'bg-gray-100 text-gray-700 border border-gray-300',
  SUBMITTED: 'bg-blue-100 text-blue-700 border border-blue-300',
  RETURNED: 'bg-amber-100 text-amber-700 border border-amber-300',
  APPROVED: 'bg-green-100 text-green-700 border border-green-300',
  LOCKED: 'bg-purple-100 text-purple-700 border border-purple-300',
}

export interface AuditLogEntry {
  /** Normally a GoalSheetStatus value; 'UNLOCKED' is also valid (Admin override). */
  action: GoalSheetStatus | 'UNLOCKED'
  actor_id: string
  actor_role: string
  timestamp: string
  comment?: string
}

/** Body for POST /api/goalsheets/{sheet_id}/unlock */
export interface UnlockRequest {
  reason: string
}

export interface GoalSheet {
  _id: string
  employee_id: string
  period_id: string
  period_label: string
  status: GoalSheetStatus
  goal_count: number
  total_weightage: number
  overall_score?: number
  reviewed_by?: string
  review_comment?: string
  audit_log: AuditLogEntry[]
  created_at: string
  updated_at: string
}

export interface GoalSheetCreate {
  period_id: string
  period_label: string
}

export interface GoalSheetStatusUpdate {
  new_status: GoalSheetStatus
  /** Required when new_status === 'RETURNED' */
  comment?: string
}

// ---------------------------------------------------------------------------
// Check-in — docs/CHECKIN_RULES.md
// ---------------------------------------------------------------------------

/**
 * Quarterly check-in labels.
 *
 * Aligned with the four input windows in docs/CHECKIN_RULES.md
 * (Q1 → July, Q2 → October, Q3 → January, Q4 → March/April).
 * MID_YEAR / YEAR_END are kept as legacy aliases for any historic seed data.
 */
export type PeriodLabel = 'Q1' | 'Q2' | 'Q3' | 'Q4' | 'MID_YEAR' | 'YEAR_END'

export const PERIOD_LABEL_DISPLAY: Record<PeriodLabel, string> = {
  Q1: 'Q1 (Apr–Jun · window: July)',
  Q2: 'Q2 (Jul–Sep · window: October)',
  Q3: 'Q3 (Oct–Dec · window: January)',
  Q4: 'Q4 (Jan–Mar · window: March/April)',
  MID_YEAR: 'Mid-Year (legacy)',
  YEAR_END: 'Year-End (legacy)',
}

export const ACTIVE_PERIOD_LABELS: PeriodLabel[] = ['Q1', 'Q2', 'Q3', 'Q4']

export interface CheckIn {
  _id: string
  goal_id: string
  goal_sheet_id: string
  period_label: PeriodLabel
  actual_value: number | string
  /** 0 | 1 | 2 | 3 | 4 | 5 */
  self_rating?: number
  remarks?: string
  manager_remark?: string
  manager_id?: string
  created_by: string
  check_in_date: string
  is_editable: boolean
}

export interface CheckInCreate {
  goal_id: string
  period_label: PeriodLabel
  actual_value: number | string
  self_rating?: number
  remarks?: string
}

export interface CheckInUpdate {
  actual_value?: number | string
  self_rating?: number
  remarks?: string
}

// ---------------------------------------------------------------------------
// Shared KPI — docs/SHARED_GOALS.md
// ---------------------------------------------------------------------------

export type PushStatus = 'SUCCESS' | 'SKIPPED' | 'ERROR'

export interface PushRecipientResult {
  employee_id: string
  employee_name?: string
  status: PushStatus
  message: string
  goal_id?: string
  goal_sheet_id?: string
}

export interface SharedKpi {
  _id: string
  link_id: string
  created_by: string
  creator_role: string
  period_id: string
  period_label: string
  thrust_area: ThrustArea
  description: string
  uom_type: UoMType
  unit_of_measure: string
  target_value: number | string
  default_weightage: number
  primary_owner_id: string
  recipient_ids: string[]
  push_results: PushRecipientResult[]
  created_at: string
}

export interface SharedKpiPush {
  period_id: string
  period_label: string
  thrust_area: ThrustArea
  description: string
  uom_type: UoMType
  unit_of_measure: string
  target_value: number | string
  default_weightage: number
  primary_owner_id: string
  recipient_ids: string[]
}

export interface SharedKpiPushResponse {
  link_id: string
  shared_kpi_id: string
  description: string
  push_results: PushRecipientResult[]
  success_count: number
  skip_count: number
  error_count: number
}

// ---------------------------------------------------------------------------
// Cycle status — docs/CHECKIN_RULES.md windows
// ---------------------------------------------------------------------------

export type CycleState =
  | 'GOAL_SETTING_OPEN'
  | 'Q1_OPEN'
  | 'Q2_OPEN'
  | 'Q3_OPEN'
  | 'Q4_OPEN'
  | 'BETWEEN_WINDOWS'

export type CycleBannerTone = 'blue' | 'green' | 'amber' | 'red'

export interface CycleStatus {
  /** ISO date (YYYY-MM-DD) the backend used to compute this status. */
  today: string
  state: CycleState
  /** GOAL_SETTING / Q1 / Q2 / Q3 / Q4 or null when between windows. */
  active_quarter: 'GOAL_SETTING' | PeriodLabel | null
  next_quarter: 'GOAL_SETTING' | PeriodLabel | null
  next_window_opens: string | null
  banner_tone: CycleBannerTone
  banner_title: string
  banner_message: string
  /** True when an Admin has overridden the system date for a demo. */
  is_mocked: boolean
}

/** Convenience: when is a quarterly *check-in* window active for inputs? */
export function isCheckInWindowOpen(state: CycleState): boolean {
  return (
    state === 'Q1_OPEN' ||
    state === 'Q2_OPEN' ||
    state === 'Q3_OPEN' ||
    state === 'Q4_OPEN'
  )
}

/** Map a CycleState to the PeriodLabel of its open quarter, if any. */
export function cycleStateToPeriodLabel(state: CycleState): PeriodLabel | null {
  switch (state) {
    case 'Q1_OPEN':
      return 'Q1'
    case 'Q2_OPEN':
      return 'Q2'
    case 'Q3_OPEN':
      return 'Q3'
    case 'Q4_OPEN':
      return 'Q4'
    default:
      return null
  }
}

// ---------------------------------------------------------------------------
// Check-in Comment — docs/REPORTING_REQUIREMENTS.md §Audit Log Rules
// ---------------------------------------------------------------------------

export interface CheckinComment {
  _id: string
  goal_sheet_id: string
  employee_id: string
  quarter: PeriodLabel
  comment: string
  author_id: string
  author_role: string
  author_name?: string
  created_at: string
}

export interface CheckinCommentCreate {
  goal_sheet_id: string
  employee_id: string
  quarter: PeriodLabel
  comment: string
}

// ---------------------------------------------------------------------------
// API response wrappers
// ---------------------------------------------------------------------------

export interface ApiError {
  detail: string | { msg: string; type: string }[]
}

export interface PaginatedResponse<T> {
  items: T[]
  total: number
  page: number
  size: number
}
