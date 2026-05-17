/**
 * Manager Dashboard
 *
 * Answers: "What does my team need from me right now?"
 *
 * Data sources:
 *   GET /api/users/team        — direct reports
 *   GET /api/goalsheets/       — all team goal sheets (filtered server-side)
 *
 * Information hierarchy:
 *   1. Header: team overview at a glance
 *   2. Compact stat strip: 4 key numbers
 *   3. Requires Attention: action-required rows surfaced first
 *   4. Full team table: all members sorted by urgency
 *   5. Push Shared KPI: collapsed by default — secondary workflow
 *
 * All existing logic preserved: review navigation, admin override detection,
 * status badges, PushSharedKpiForm functionality.
 */
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Loader2,
  RotateCcw,
  ShieldAlert,
  Users,
} from 'lucide-react'

import api from '@/lib/api'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { PushSharedKpiForm } from '@/components/shared-goals/PushSharedKpiForm'
import { useAuth } from '@/contexts/AuthContext'
import type { GoalSheet, GoalSheetStatus, User } from '@/types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns true ONLY when the sheet is currently in the admin-reopened state:
 * status must be RETURNED *and* the audit log must contain an UNLOCKED entry.
 * Once the employee resubmits (RETURNED → SUBMITTED → APPROVED → LOCKED) this
 * returns false, so the "Admin override" label disappears immediately.
 */
function isAdminUnlocked(sheet: GoalSheet): boolean {
  return (
    sheet.status === 'RETURNED' &&
    (sheet.audit_log ?? []).some((e) => e.action === 'UNLOCKED')
  )
}

/** Sort priority: SUBMITTED first (urgent), then RETURNED, then others, then LOCKED last */
function urgencyScore(sheet: GoalSheet | null): number {
  if (!sheet) return 5
  if (sheet.status === 'SUBMITTED') return 0
  if (sheet.status === 'RETURNED' && isAdminUnlocked(sheet)) return 1
  if (sheet.status === 'RETURNED') return 2
  if (sheet.status === 'DRAFT') return 3
  if (sheet.status === 'APPROVED') return 4
  if (sheet.status === 'LOCKED') return 5
  return 6
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TeamRow {
  user: User
  sheet: GoalSheet | null
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ManagerDashboard() {
  const { user } = useAuth()
  const navigate = useNavigate()

  const [rows, setRows] = useState<TeamRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showKpiForm, setShowKpiForm] = useState(false)

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [teamRes, sheetsRes] = await Promise.all([
        api.get<User[]>('/users/team'),
        api.get<GoalSheet[]>('/goalsheets/'),
      ])

      const sheetByEmployee = new Map<string, GoalSheet>()
      for (const s of sheetsRes.data) {
        const existing = sheetByEmployee.get(s.employee_id)
        if (!existing || new Date(s.updated_at) > new Date(existing.updated_at)) {
          sheetByEmployee.set(s.employee_id, s)
        }
      }

      setRows(
        teamRes.data.map((u) => ({
          user: u,
          sheet: sheetByEmployee.get(u._id) ?? null,
        })),
      )
    } catch {
      setError('Failed to load team data. Please refresh.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadData() }, [loadData])

  // ---------------------------------------------------------------------------
  // Derived data
  // ---------------------------------------------------------------------------

  const teamSize = rows.length
  const submitted = rows.filter((r) => r.sheet?.status === 'SUBMITTED')
  const returned = rows.filter(
    (r) => r.sheet?.status === 'RETURNED' && !isAdminUnlocked(r.sheet),
  )
  const adminReturned = rows.filter(
    (r) => r.sheet?.status === 'RETURNED' && r.sheet && isAdminUnlocked(r.sheet),
  )
  const lockedCount = rows.filter(
    (r) => r.sheet?.status === 'LOCKED' || r.sheet?.status === 'APPROVED',
  ).length

  const hasAttentionItems =
    submitted.length > 0 || returned.length > 0 || adminReturned.length > 0

  const scores = rows
    .filter((r) => r.sheet?.overall_score != null)
    .map((r) => r.sheet!.overall_score as number)
  const avgScore = scores.length
    ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1)
    : null

  // Sort rows by urgency
  const sortedRows = [...rows].sort(
    (a, b) => urgencyScore(a.sheet) - urgencyScore(b.sheet),
  )

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-7 w-7 animate-spin text-slate-400" />
      </div>
    )
  }

  return (
    <div className="space-y-4">

      {/* ── 1. Header ──────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="breadcrumb">Manager · Dashboard</p>
          <h1 className="page-title">Team Overview</h1>
          <p className="text-xs text-slate-400 mt-0.5">
            {user?.name} · FY 2025-26 · {teamSize} direct report{teamSize !== 1 ? 's' : ''}
          </p>
        </div>
        {submitted.length > 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
            <Clock size={11} />
            {submitted.length} pending review{submitted.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <span className="flex-1">{error}</span>
          <button onClick={loadData} className="btn-primary btn-sm">
            Retry
          </button>
        </div>
      )}

      {/* ── 2. Compact stat strip ──────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile
          label="Team Size"
          value={teamSize}
          sub="Direct reports"
          icon={<Users size={13} className="text-slate-400" />}
        />
        <StatTile
          label="Pending Review"
          value={submitted.length}
          sub={submitted.length > 0 ? 'Action required' : 'All reviewed'}
          icon={<Clock size={13} className="text-slate-400" />}
          highlight={submitted.length > 0}
        />
        <StatTile
          label="Locked / Approved"
          value={lockedCount}
          sub={`of ${teamSize} team members`}
          icon={<CheckCircle2 size={13} className="text-slate-400" />}
        />
        <StatTile
          label="Avg Score"
          value={avgScore !== null ? avgScore : '—'}
          sub={avgScore !== null ? 'of 100 pts' : 'After check-ins'}
          icon={<AlertTriangle size={13} className="text-slate-400" />}
        />
      </div>

      {/* ── 3. Requires Attention ──────────────────────────────────────── */}
      {hasAttentionItems && (
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-slate-400">
            Requires Attention
          </p>
          <div className="card overflow-hidden p-0">
            <ul className="divide-y divide-slate-100">

              {submitted.map(({ user: member, sheet }) => (
                <li key={member._id}>
                  <button
                    onClick={() => navigate(`/manager/review/${sheet!._id}`)}
                    className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-blue-50/50 transition-colors"
                  >
                    <span className="h-2 w-2 flex-shrink-0 rounded-full bg-blue-400" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-900">{member.name}</p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {member.department} · {sheet?.period_label}
                      </p>
                    </div>
                    <StatusBadge status="SUBMITTED" />
                    <span className="text-xs font-semibold text-blue-600 flex items-center gap-1 ml-2 flex-shrink-0">
                      Review <ArrowRight size={11} />
                    </span>
                  </button>
                </li>
              ))}

              {adminReturned.map(({ user: member }) => (
                <li key={member._id} className="flex items-center gap-3 px-4 py-3.5">
                  <span className="h-2 w-2 flex-shrink-0 rounded-full bg-purple-400" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-900">{member.name}</p>
                    <p className="text-xs text-slate-400 mt-0.5">{member.department} · Reopened by Admin</p>
                  </div>
                  <span className="flex items-center gap-1 rounded-full bg-purple-100 text-purple-700 text-xs font-semibold px-2.5 py-1 flex-shrink-0">
                    <ShieldAlert size={10} /> Admin Reopened
                  </span>
                </li>
              ))}

              {returned.map(({ user: member }) => (
                <li key={member._id} className="flex items-center gap-3 px-4 py-3.5">
                  <span className="h-2 w-2 flex-shrink-0 rounded-full bg-amber-400" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-900">{member.name}</p>
                    <p className="text-xs text-slate-400 mt-0.5">{member.department} · Awaiting revision</p>
                  </div>
                  <span className="flex items-center gap-1 text-xs text-amber-600 font-medium flex-shrink-0">
                    <RotateCcw size={10} /> Returned
                  </span>
                </li>
              ))}

            </ul>
          </div>
        </div>
      )}

      {/* ── 4. Full team table — sorted by urgency ─────────────────────── */}
      <div>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-slate-400">
          All Team Members
        </p>
        <div className="card overflow-hidden p-0">
          {sortedRows.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <Users size={28} className="text-slate-300" />
              <p className="text-sm font-semibold text-slate-600">No team members found</p>
              <p className="text-xs text-slate-400">
                Team members will appear here once assigned to you.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-100">
                  <tr>
                    <th className="th">
                      Employee
                    </th>
                    <th className="th">
                      Department
                    </th>
                    <th className="th">
                      Status
                    </th>
                    <th className="th">
                      Goals
                    </th>
                    <th className="th">
                      Wt.%
                    </th>
                    <th className="th">
                      Score
                    </th>
                    <th className="th">
                      Action
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sortedRows.map(({ user: member, sheet }) => {
                    const isUrgent = sheet?.status === 'SUBMITTED'
                    const hasOverride = sheet && isAdminUnlocked(sheet)

                    return (
                      <tr key={member._id} className="tr">
                        <td className="td">
                          <div className="flex items-center gap-2">
                            {isUrgent && (
                              <span className="h-1.5 w-1.5 rounded-full bg-blue-400 flex-shrink-0" />
                            )}
                            <div>
                              <p className="font-medium text-slate-900 text-sm">{member.name}</p>
                              <p className="text-xs text-slate-400">{member.employee_id}</p>
                            </div>
                          </div>
                        </td>
                        <td className="td">
                          {member.department}
                        </td>
                        <td className="td">
                          {sheet ? (
                            <div className="flex flex-col gap-0.5">
                              <StatusBadge status={sheet.status as GoalSheetStatus} />
                              {hasOverride && (
                                <span className="text-[10px] text-purple-600 flex items-center gap-0.5 mt-0.5">
                                  <ShieldAlert size={9} /> Admin override
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="text-xs text-slate-400 italic">No sheet</span>
                          )}
                        </td>
                        <td className="td">
                          {sheet ? sheet.goal_count : '—'}
                        </td>
                        <td className="td">
                          {sheet ? (
                            <span className={`text-xs font-medium ${sheet.total_weightage === 100 ? 'text-emerald-600' : 'text-amber-600'}`}>
                              {sheet.total_weightage}%
                            </span>
                          ) : '—'}
                        </td>
                        <td className="td">
                          {sheet?.overall_score != null ? sheet.overall_score.toFixed(1) : '—'}
                        </td>
                        <td className="td">
                          {sheet?.status === 'SUBMITTED' ? (
                            <button
                              onClick={() => navigate(`/manager/review/${sheet._id}`)}
                              className="btn-primary btn-sm"
                            >
                              Review <ArrowRight size={11} />
                            </button>
                          ) : sheet?.status === 'RETURNED' && hasOverride ? (
                            <span className="text-[11px] text-purple-600 font-medium">
                              Admin reopened
                            </span>
                          ) : sheet?.status === 'RETURNED' ? (
                            <span className="text-[11px] text-amber-600 font-medium italic">
                              Awaiting revision
                            </span>
                          ) : sheet?.status === 'LOCKED' ? (
                            <span className="text-[11px] text-purple-600 font-medium">✓ Locked</span>
                          ) : sheet?.status === 'APPROVED' ? (
                            <span className="text-[11px] text-emerald-600 font-medium">✓ Approved</span>
                          ) : (
                            <span className="text-[11px] text-slate-300">—</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ── 5. Push Shared KPI — collapsible secondary action ─────────── */}
      <div className="card overflow-hidden p-0">
        <button
          onClick={() => setShowKpiForm((v) => !v)}
          className="w-full flex items-center justify-between px-5 py-3.5 text-left hover:bg-slate-50 transition-colors"
        >
          <div>
            <p className="text-sm font-semibold text-slate-800">Push Shared KPI</p>
            <p className="text-xs text-slate-400 mt-0.5">
              Assign a shared KPI goal to selected team members
            </p>
          </div>
          {showKpiForm
            ? <ChevronUp size={16} className="text-slate-400 flex-shrink-0" />
            : <ChevronDown size={16} className="text-slate-400 flex-shrink-0" />}
        </button>
        {showKpiForm && (
          <div className="border-t border-slate-100 p-5">
            <PushSharedKpiForm teamMembers={rows.map((r) => r.user)} />
          </div>
        )}
      </div>

    </div>
  )
}

// ---------------------------------------------------------------------------
// Local: compact stat tile
// ---------------------------------------------------------------------------

function StatTile({
  label,
  value,
  sub,
  icon,
  highlight = false,
}: {
  label: string
  value: string | number
  sub: string
  icon?: React.ReactNode
  highlight?: boolean
}) {
  return (
    <div className="card-sm">
      <div className="flex items-center justify-between gap-1 mb-1.5">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{label}</p>
        {icon}
      </div>
      <p className={`text-2xl font-bold tabular-nums ${highlight ? 'text-amber-600' : 'text-slate-900'}`}>
        {value}
      </p>
      <p className={`text-[11px] mt-0.5 truncate ${highlight ? 'text-amber-500' : 'text-slate-400'}`}>
        {sub}
      </p>
    </div>
  )
}
