/**
 * Admin Dashboard — Operational Overview
 *
 * Answers ONE question: "What requires admin attention right now?"
 *
 * Data sources:
 *   GET /api/users/team          — all employees & managers
 *   GET /api/goalsheets/         — all goal sheets (with embedded audit_log)
 *
 * Deliberate scope:
 *   - KPI strip           — four headline numbers
 *   - Requires Attention  — bottlenecks needing action
 *   - Recent Activity     — lightweight event feed from audit logs
 *   - Status Strip        — compact goal-sheet status breakdown
 *
 * Everything else (unlock workflow, history, CSV export, dept summary,
 * shared KPIs) lives in dedicated pages:
 *   /admin/goalsheets  → governance & unlock
 *   /admin/reports     → analytics, export, history
 *   /admin/completion  → submission & check-in health
 *
 * Permissions: docs/ROLE_PERMISSIONS.md §Admin
 */
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  Loader2,
  ShieldAlert,
  Users,
} from 'lucide-react'

import api from '@/lib/api'
import { StatusBadge } from '@/components/shared/StatusBadge'
import type { GoalSheet, GoalSheetStatus, User } from '@/types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AttentionItem {
  key: string
  label: string
  count: number
  tone: 'red' | 'amber' | 'purple' | 'blue'
  href: string
  description: string
}

interface ActivityEvent {
  id: string
  text: string
  ts: string
  tone: 'purple' | 'green' | 'blue' | 'amber'
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STATUS_ORDER: GoalSheetStatus[] = ['DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED', 'LOCKED']

function relativeTime(ts: string): string {
  try {
    const diff = Date.now() - new Date(ts).getTime()
    const mins = Math.floor(diff / 60_000)
    if (mins < 1) return 'just now'
    if (mins < 60) return `${mins}m ago`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `${hrs}h ago`
    const days = Math.floor(hrs / 24)
    return `${days}d ago`
  } catch {
    return ''
  }
}

function hasUnlockEntry(sheet: GoalSheet): boolean {
  return (sheet.audit_log ?? []).some((e) => e.action === 'UNLOCKED')
}

/** Build a flat list of recent significant events from embedded audit logs. */
function buildActivityFeed(
  sheets: GoalSheet[],
  userMap: Map<string, User>,
  limit = 8,
): ActivityEvent[] {
  const events: { ts: string; text: string; tone: ActivityEvent['tone'] }[] = []

  for (const sheet of sheets) {
    const emp = userMap.get(sheet.employee_id)
    const empName = emp?.name ?? 'An employee'
    for (const entry of sheet.audit_log ?? []) {
      if (!entry.timestamp) continue
      if (entry.action === 'UNLOCKED') {
        const actor = userMap.get(entry.actor_id)
        events.push({
          ts: entry.timestamp,
          text: `${actor?.name ?? 'Admin'} unlocked ${empName}'s goal sheet`,
          tone: 'purple',
        })
      } else if (entry.action === 'LOCKED') {
        const actor = userMap.get(entry.actor_id)
        events.push({
          ts: entry.timestamp,
          text: `${actor?.name ?? 'Manager'} approved & locked ${empName}'s goals`,
          tone: 'green',
        })
      } else if (entry.action === 'SUBMITTED') {
        events.push({
          ts: entry.timestamp,
          text: `${empName} submitted their goal sheet`,
          tone: 'blue',
        })
      } else if (entry.action === 'RETURNED') {
        const actor = userMap.get(entry.actor_id)
        events.push({
          ts: entry.timestamp,
          text: `${actor?.name ?? 'Manager'} returned ${empName}'s sheet for revision`,
          tone: 'amber',
        })
      }
    }
  }

  return events
    .sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime())
    .slice(0, limit)
    .map((e, i) => ({ ...e, id: `${i}-${e.ts}` }))
}

const TONE_DOT: Record<ActivityEvent['tone'], string> = {
  purple: 'bg-purple-400',
  green: 'bg-emerald-400',
  blue: 'bg-blue-400',
  amber: 'bg-amber-400',
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AdminDashboard() {
  const navigate = useNavigate()

  const [allUsers, setAllUsers] = useState<User[]>([])
  const [allSheets, setAllSheets] = useState<GoalSheet[]>([])
  const [loading, setLoading] = useState(true)

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [usersRes, sheetsRes] = await Promise.all([
        api.get<User[]>('/users/team'),
        api.get<GoalSheet[]>('/goalsheets/'),
      ])
      setAllUsers(usersRes.data)
      setAllSheets(sheetsRes.data)
    } catch {
      // Non-fatal
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  // ---------------------------------------------------------------------------
  // Derived data
  // ---------------------------------------------------------------------------

  const employees = allUsers.filter((u) => u.role === 'EMPLOYEE')
  const userMap = new Map(allUsers.map((u) => [u._id, u]))

  // Status counts
  const statusCounts: Record<GoalSheetStatus, number> = {
    DRAFT: 0, SUBMITTED: 0, RETURNED: 0, APPROVED: 0, LOCKED: 0,
  }
  const sheetByEmployee = new Map<string, GoalSheet>()
  for (const s of allSheets) {
    if (s.status in statusCounts) statusCounts[s.status as GoalSheetStatus]++
    // Keep most recent sheet per employee
    const existing = sheetByEmployee.get(s.employee_id)
    if (!existing || new Date(s.updated_at) > new Date(existing.updated_at)) {
      sheetByEmployee.set(s.employee_id, s)
    }
  }

  const totalUnlocks = allSheets.filter(hasUnlockEntry).length

  // Employees who haven't started any sheet
  const noSheetEmployees = employees.filter((e) => !sheetByEmployee.has(e._id))

  // Sheets needing review (SUBMITTED)
  const submittedSheets = allSheets.filter((s) => s.status === 'SUBMITTED')

  // Sheets returned by admin (RETURNED + has UNLOCKED in audit log)
  const adminReturnedSheets = allSheets.filter(
    (s) => s.status === 'RETURNED' && hasUnlockEntry(s),
  )

  // Sheets returned by manager (RETURNED, no UNLOCKED)
  const managerReturnedSheets = allSheets.filter(
    (s) => s.status === 'RETURNED' && !hasUnlockEntry(s),
  )

  // Locked sheets — available to unlock
  const lockedCount = statusCounts.LOCKED

  // "Requires Attention" items — only show non-zero ones
  const attentionCandidates: AttentionItem[] = [
    {
      key: 'no-sheet',
      label: 'Employees not started',
      count: noSheetEmployees.length,
      tone: 'red',
      href: '/admin/goalsheets',
      description: 'No goal sheet created for this period',
    },
    {
      key: 'submitted',
      label: 'Submitted — awaiting review',
      count: submittedSheets.length,
      tone: 'blue',
      href: '/admin/goalsheets',
      description: 'Waiting for manager approval',
    },
    {
      key: 'admin-returned',
      label: 'Reopened by admin — awaiting revision',
      count: adminReturnedSheets.length,
      tone: 'purple',
      href: '/admin/goalsheets',
      description: 'Employee must revise and resubmit',
    },
    {
      key: 'manager-returned',
      label: 'Returned by manager — awaiting revision',
      count: managerReturnedSheets.length,
      tone: 'amber',
      href: '/admin/goalsheets',
      description: 'Employee must address manager feedback',
    },
  ]
  const attentionItems = attentionCandidates.filter((item) => item.count > 0)

  const activityFeed = buildActivityFeed(allSheets, userMap)

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
      </div>
    )
  }

  return (
    <div className="space-y-5">

      {/* ── Page header ─────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="breadcrumb">Admin · Operations</p>
          <h1 className="page-title">Operations</h1>
          <p className="text-xs text-slate-400 mt-0.5">FY 2025-26 · All departments</p>
        </div>
        <button
          onClick={loadData}
          className="text-xs text-slate-400 hover:text-slate-600 transition-colors"
        >
          Refresh
        </button>
      </div>

      {/* ── KPI Strip ────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiTile
          label="Employees"
          value={employees.length}
          sub={`${employees.length - noSheetEmployees.length} have submitted`}
          icon={<Users size={14} className="text-slate-400" />}
        />
        <KpiTile
          label="Pending Review"
          value={submittedSheets.length}
          sub="Awaiting manager action"
          highlight={submittedSheets.length > 0 ? 'amber' : undefined}
          icon={<Clock size={14} className="text-slate-400" />}
        />
        <KpiTile
          label="Locked Sheets"
          value={lockedCount}
          sub="Approved and finalized"
          icon={<CheckCircle2 size={14} className="text-slate-400" />}
        />
        <KpiTile
          label="Admin Unlocks"
          value={totalUnlocks}
          sub="Total governance overrides"
          icon={<ShieldAlert size={14} className="text-slate-400" />}
        />
      </div>

      {/* ── Main two-column layout ───────────────────────────────────────── */}
      {/* When there are no attention items the section is hidden entirely and
          Recent Activity expands to fill the row naturally. */}
      <div className={`grid grid-cols-1 gap-4 ${attentionItems.length > 0 ? 'lg:grid-cols-5' : ''}`}>

        {/* Requires Attention — 3 cols — hidden when nothing needs action */}
        {attentionItems.length > 0 && (
          <div className="lg:col-span-3">
            <SectionLabel>Requires Attention</SectionLabel>
            <div className="card overflow-hidden p-0">
              <ul className="divide-y divide-slate-100">
                {attentionItems.map((item) => (
                  <AttentionRow
                    key={item.key}
                    item={item}
                    onClick={() => navigate(item.href)}
                  />
                ))}
              </ul>

              {/* Footer shortcut */}
              <div className="border-t border-slate-100 px-4 py-2.5 flex items-center justify-between bg-slate-50">
                <span className="text-xs text-slate-400">
                  {allSheets.length} total sheets · {lockedCount} locked
                </span>
                <button
                  onClick={() => navigate('/admin/goalsheets')}
                  className="flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-900 transition-colors"
                >
                  Manage all sheets <ArrowRight size={11} />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Recent Activity — 2 cols (expands to full width when attention section is hidden) */}
        <div className={attentionItems.length > 0 ? 'lg:col-span-2' : ''}>
          <SectionLabel>Recent Activity</SectionLabel>
          <div className="card overflow-hidden p-0">
            {activityFeed.length === 0 ? (
              <p className="px-4 py-8 text-xs text-slate-400 italic text-center">
                No recent activity yet.
              </p>
            ) : (
              <div className="max-h-80 overflow-y-auto">
                <ul className="divide-y divide-slate-50">
                {activityFeed.map((event) => (
                  <li key={event.id} className="flex items-start gap-2 px-4 py-2">
                    <span className={`mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full ${TONE_DOT[event.tone]}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-slate-700 leading-snug">{event.text}</p>
                      <p className="text-[11px] text-slate-400 mt-0.5">{relativeTime(event.ts)}</p>
                    </div>
                  </li>
                ))}
                </ul>
              </div>
            )}
            <div className="border-t border-slate-100 px-4 py-2.5 bg-slate-50">
              <button
                onClick={() => navigate('/admin/reports')}
                className="flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-800 transition-colors"
              >
                Full audit history <ArrowRight size={11} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Status Strip ─────────────────────────────────────────────────── */}
      <div>
        <SectionLabel>Goal Sheet Status</SectionLabel>
        <div className="card overflow-hidden p-0">
          <div className="flex items-stretch divide-x divide-slate-100">
            {STATUS_ORDER.map((st) => {
              const count = statusCounts[st]
              const total = allSheets.length || 1
              const pct = Math.round((count / total) * 100)
              return (
                <div key={st} className="flex-1 px-4 py-3 min-w-0">
                  <div className="flex items-center justify-between gap-1 mb-1.5">
                    <StatusBadge status={st} className="text-[10px] px-1.5 py-0" />
                    <span className="text-sm font-bold text-slate-800 tabular-nums">{count}</span>
                  </div>
                  <div className="h-1 rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-slate-300 transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1">{pct}%</p>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* ── Workflow Bottlenecks — quick links ───────────────────────────── */}
      <div>
        <SectionLabel>Quick Actions</SectionLabel>
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
          <QuickAction
            label="Unlock Goal Sheets"
            description={`${lockedCount} sheets currently locked`}
            icon={<ShieldAlert size={15} className="text-purple-500" />}
            onClick={() => navigate('/admin/goalsheets')}
          />
          <QuickAction
            label="Completion Health"
            description="Submission & check-in metrics"
            icon={<CheckCircle2 size={15} className="text-emerald-500" />}
            onClick={() => navigate('/admin/completion')}
          />
          <QuickAction
            label="Export Reports"
            description="Download achievement CSV"
            icon={<AlertTriangle size={15} className="text-amber-500" />}
            onClick={() => navigate('/admin/reports')}
          />
        </div>
      </div>

    </div>
  )
}

// ---------------------------------------------------------------------------
// Local presentational sub-components
// ---------------------------------------------------------------------------

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-slate-400">
      {children}
    </p>
  )
}

interface KpiTileProps {
  label: string
  value: string | number
  sub: string
  icon?: React.ReactNode
  highlight?: 'amber' | 'red'
}

function KpiTile({ label, value, sub, icon, highlight }: KpiTileProps) {
  const valueClass = highlight === 'amber'
    ? 'text-amber-600'
    : highlight === 'red'
    ? 'text-red-600'
    : 'text-slate-900'

  return (
    <div className="card-sm">
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
          {label}
        </span>
        {icon}
      </div>
      <p className={`text-2xl font-bold tabular-nums ${valueClass}`}>{value}</p>
      <p className="text-[11px] text-slate-400 mt-0.5 truncate">{sub}</p>
    </div>
  )
}

const ATTENTION_TONE: Record<string, { dot: string; bg: string; text: string; count: string }> = {
  red: {
    dot: 'bg-red-400',
    bg: 'hover:bg-red-50',
    text: 'text-red-700',
    count: 'bg-red-100 text-red-700',
  },
  amber: {
    dot: 'bg-amber-400',
    bg: 'hover:bg-amber-50',
    text: 'text-amber-700',
    count: 'bg-amber-100 text-amber-700',
  },
  purple: {
    dot: 'bg-purple-400',
    bg: 'hover:bg-purple-50',
    text: 'text-purple-700',
    count: 'bg-purple-100 text-purple-700',
  },
  blue: {
    dot: 'bg-blue-400',
    bg: 'hover:bg-blue-50',
    text: 'text-blue-700',
    count: 'bg-blue-100 text-blue-700',
  },
}

function AttentionRow({ item, onClick }: { item: AttentionItem; onClick: () => void }) {
  const t = ATTENTION_TONE[item.tone]
  return (
    <li>
      <button
        onClick={onClick}
        className={`w-full flex items-center gap-3 px-4 py-3.5 text-left transition-colors ${t.bg}`}
      >
        <span className={`h-2 w-2 flex-shrink-0 rounded-full ${t.dot}`} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-slate-800">{item.label}</p>
          <p className="text-xs text-slate-400 mt-0.5">{item.description}</p>
        </div>
        <span className={`flex-shrink-0 rounded-full px-2.5 py-0.5 text-xs font-bold ${t.count}`}>
          {item.count}
        </span>
        <ArrowRight size={13} className="text-slate-300 flex-shrink-0" />
      </button>
    </li>
  )
}

function QuickAction({
  label,
  description,
  icon,
  onClick,
}: {
  label: string
  description: string
  icon: React.ReactNode
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-left shadow-sm hover:bg-slate-50 transition-colors group"
    >
      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-slate-50 border border-slate-100 group-hover:border-slate-200">
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-slate-800">{label}</p>
        <p className="text-xs text-slate-400">{description}</p>
      </div>
      <ArrowRight size={13} className="ml-auto text-slate-300 group-hover:text-slate-500 transition-colors flex-shrink-0" />
    </button>
  )
}
