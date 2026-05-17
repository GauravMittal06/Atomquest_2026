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

/** QUANTITATIVE: numeric target | QUALITATIVE: text milestone */
export type UoMType = 'QUANTITATIVE' | 'QUALITATIVE'

export interface SharedGoalRef {
  is_shared: boolean
  originator_id?: string
  partner_id?: string
  request_status?: 'PENDING' | 'ACCEPTED' | 'DECLINED'
  link_id?: string
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
  action: GoalSheetStatus
  actor_id: string
  actor_role: string
  timestamp: string
  comment?: string
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

/** Standard period labels per CHECKIN_RULES.md §3 */
export type PeriodLabel = 'Q1' | 'Q2' | 'MID_YEAR' | 'Q3' | 'Q4' | 'YEAR_END'

export const PERIOD_LABEL_DISPLAY: Record<PeriodLabel, string> = {
  Q1: 'Q1 (Apr–Jun)',
  Q2: 'Q2 (Jul–Sep)',
  MID_YEAR: 'Mid-Year (Oct)',
  Q3: 'Q3 (Oct–Dec)',
  Q4: 'Q4 (Jan–Mar)',
  YEAR_END: 'Year-End (Mar)',
}

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
