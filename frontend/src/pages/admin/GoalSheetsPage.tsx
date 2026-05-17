/**
 * Admin — All Goal Sheets (Governance & Unlock Workflows)
 *
 * This page is the single place for Admin to:
 *   - View all goal sheets across the organisation with status filters
 *   - Unlock LOCKED sheets (LOCKED → RETURNED) with mandatory reason
 *   - Review the full unlock history / governance audit timeline
 *
 * Data sources:
 *   GET /api/users/team                   — employee/manager info
 *   GET /api/goalsheets/                  — all sheets (with embedded audit_log)
 *   GET /api/goalsheets/unlock-history    — sheets with UNLOCKED entries
 *   POST /api/goalsheets/{id}/unlock      — Admin unlock action
 *
 * Permissions: docs/ROLE_PERMISSIONS.md §Admin — "Unlock approved goals", "View audit logs"
 * Workflow:    docs/WORKFLOWS.md §Goal Lifecycle — LOCKED → RETURNED
 * Audit:       docs/REPORTING_REQUIREMENTS.md §Audit Log Rules
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Clock,
  History,
  Loader2,
  ShieldAlert,
  Unlock,
} from 'lucide-react'

import api from '@/lib/api'
import { StatusBadge } from '@/components/shared/StatusBadge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { GoalSheet, GoalSheetStatus, UnlockRequest, User } from '@/types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type StatusFilter = 'ALL' | GoalSheetStatus

interface UnlockHistoryItem {
  sheet_id: string
  employee_name: string
  department: string
  period_label: string
  current_status: string
  unlock_reason: string
  unlocked_by_name: string
  unlocked_at: string | null
  total_unlocks: number
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ALL_STATUSES: GoalSheetStatus[] = ['DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED', 'LOCKED']

function formatTs(ts: string | null | undefined): string {
  if (!ts) return '—'
  try {
    return new Date(ts).toLocaleString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
  } catch { return ts ?? '—' }
}

function hasUnlock(sheet: GoalSheet): boolean {
  return (sheet.audit_log ?? []).some((e) => e.action === 'UNLOCKED')
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AdminGoalSheetsPage() {
  const [allUsers, setAllUsers] = useState<User[]>([])
  const [allSheets, setAllSheets] = useState<GoalSheet[]>([])
  const [unlockHistory, setUnlockHistory] = useState<UnlockHistoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<StatusFilter>('ALL')

  // ── Unlock dialog ──────────────────────────────────────────────────────
  const [unlockTarget, setUnlockTarget] = useState<GoalSheet | null>(null)
  const [unlockReason, setUnlockReason] = useState('')
  const [unlockLoading, setUnlockLoading] = useState(false)
  const [unlockError, setUnlockError] = useState<string | null>(null)
  const reasonRef = useRef<HTMLTextAreaElement | null>(null)

  // ── Active tab ─────────────────────────────────────────────────────────
  const [tab, setTab] = useState<'sheets' | 'history'>('sheets')

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [usersRes, sheetsRes, historyRes] = await Promise.all([
        api.get<User[]>('/users/team'),
        api.get<GoalSheet[]>('/goalsheets/'),
        api.get<UnlockHistoryItem[]>('/goalsheets/unlock-history'),
      ])
      setAllUsers(usersRes.data)
      setAllSheets(sheetsRes.data)
      setUnlockHistory(historyRes.data)
    } catch {
      // Non-fatal
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadData() }, [loadData])

  function openUnlockDialog(sheet: GoalSheet) {
    setUnlockTarget(sheet)
    setUnlockReason('')
    setUnlockError(null)
    setTimeout(() => reasonRef.current?.focus(), 80)
  }

  function closeUnlockDialog() {
    if (unlockLoading) return
    setUnlockTarget(null)
    setUnlockReason('')
    setUnlockError(null)
  }

  async function handleConfirmUnlock() {
    if (!unlockTarget) return
    const reason = unlockReason.trim()
    if (!reason) {
      setUnlockError('A reason is required before unlocking.')
      return
    }
    setUnlockLoading(true)
    setUnlockError(null)
    try {
      const body: UnlockRequest = { reason }
      await api.post(`/goalsheets/${unlockTarget._id}/unlock`, body)
      const [sheetsRes, historyRes] = await Promise.all([
        api.get<GoalSheet[]>('/goalsheets/'),
        api.get<UnlockHistoryItem[]>('/goalsheets/unlock-history'),
      ])
      setAllSheets(sheetsRes.data)
      setUnlockHistory(historyRes.data)
      setUnlockTarget(null)
      setUnlockReason('')
    } catch (err: unknown) {
      const msg =
        err && typeof err === 'object' && 'response' in err
          ? (err as { response?: { data?: { detail?: string } } }).response?.data?.detail
          : null
      setUnlockError(typeof msg === 'string' ? msg : 'Unlock failed. Please try again.')
    } finally {
      setUnlockLoading(false)
    }
  }

  // ---------------------------------------------------------------------------
  // Derived
  // ---------------------------------------------------------------------------

  const userMap = new Map(allUsers.map((u) => [u._id, u]))

  const filteredSheets = filter === 'ALL'
    ? allSheets
    : allSheets.filter((s) => s.status === filter)

  const statusCounts: Record<GoalSheetStatus, number> = {
    DRAFT: 0, SUBMITTED: 0, RETURNED: 0, APPROVED: 0, LOCKED: 0,
  }
  for (const s of allSheets) {
    if (s.status in statusCounts) statusCounts[s.status as GoalSheetStatus]++
  }

  const targetEmp = unlockTarget ? userMap.get(unlockTarget.employee_id) : null

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
      </div>
    )
  }

  return (
    <div className="space-y-5">

      {/* ── Header ── */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">All Goal Sheets</h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Governance · Unlock workflows · Audit trail
          </p>
        </div>
        <span className="inline-flex items-center rounded-full bg-purple-50 px-2.5 py-1 text-xs font-semibold text-purple-700 ring-1 ring-purple-200">
          Admin Only
        </span>
      </div>

      {/* ── Tab switcher ── */}
      <div className="flex gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 w-fit">
        {([['sheets', 'Goal Sheets'], ['history', 'Unlock History']] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`rounded-md px-3.5 py-1.5 text-xs font-semibold transition-colors ${
              tab === key
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {label}
            {key === 'history' && unlockHistory.length > 0 && (
              <span className="ml-1.5 rounded-full bg-purple-100 text-purple-700 px-1.5 py-0.5 text-[10px] font-bold">
                {unlockHistory.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {tab === 'sheets' && (
        <>
          {/* ── Status filter pills ── */}
          <div className="flex flex-wrap gap-2">
            <FilterPill
              active={filter === 'ALL'}
              onClick={() => setFilter('ALL')}
              label={`All (${allSheets.length})`}
            />
            {ALL_STATUSES.map((st) => (
              <FilterPill
                key={st}
                active={filter === st}
                onClick={() => setFilter(st)}
                label={`${st.charAt(0) + st.slice(1).toLowerCase()} (${statusCounts[st]})`}
              />
            ))}
          </div>

          {/* ── Sheets table ── */}
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            {filteredSheets.length === 0 ? (
              <p className="px-5 py-10 text-sm text-slate-400 italic text-center">
                No sheets matching this filter.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-xs text-slate-500 uppercase tracking-wide border-b border-slate-100">
                    <tr>
                      <th className="px-5 py-3 text-left">Employee</th>
                      <th className="px-5 py-3 text-left">Department</th>
                      <th className="px-5 py-3 text-left">Period</th>
                      <th className="px-5 py-3 text-left">Status</th>
                      <th className="px-5 py-3 text-right">Goals</th>
                      <th className="px-5 py-3 text-right">Score</th>
                      <th className="px-5 py-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredSheets.map((sheet) => {
                      const emp = userMap.get(sheet.employee_id)
                      const isAdminUnlocked = hasUnlock(sheet)
                      return (
                        <tr key={sheet._id} className="hover:bg-slate-50 transition-colors">
                          <td className="px-5 py-3">
                            <p className="font-medium text-slate-900">{emp?.name ?? sheet.employee_id}</p>
                            <p className="text-xs text-slate-400">{emp?.employee_id ?? ''}</p>
                          </td>
                          <td className="px-5 py-3 text-slate-500 text-xs">{emp?.department}</td>
                          <td className="px-5 py-3 text-slate-500 text-xs">{sheet.period_label}</td>
                          <td className="px-5 py-3">
                            <div className="flex flex-col gap-1">
                              <StatusBadge status={sheet.status as GoalSheetStatus} />
                              {isAdminUnlocked && (
                                <span className="flex items-center gap-1 text-[10px] text-purple-600">
                                  <ShieldAlert size={9} /> Admin override
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-5 py-3 text-right text-slate-700">{sheet.goal_count}</td>
                          <td className="px-5 py-3 text-right font-semibold text-slate-700">
                            {sheet.overall_score != null ? sheet.overall_score.toFixed(1) : '—'}
                          </td>
                          <td className="px-5 py-3 text-right">
                            {sheet.status === 'LOCKED' ? (
                              <button
                                onClick={() => openUnlockDialog(sheet)}
                                className="inline-flex items-center gap-1.5 rounded-md border border-purple-300 bg-purple-50 px-2.5 py-1.5 text-xs font-semibold text-purple-700 hover:bg-purple-100 transition-colors"
                              >
                                <Unlock size={11} />
                                Unlock
                              </button>
                            ) : (
                              <span className="text-xs text-slate-300">—</span>
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
        </>
      )}

      {tab === 'history' && (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <History size={15} className="text-indigo-500" />
              <h2 className="text-sm font-semibold text-slate-800">Unlock Audit Trail</h2>
            </div>
            <span className="text-xs text-slate-400">{unlockHistory.length} override(s)</span>
          </div>

          {unlockHistory.length === 0 ? (
            <p className="px-5 py-10 text-sm text-slate-400 italic text-center">
              No unlock actions have been recorded yet.
            </p>
          ) : (
            <div className="divide-y divide-slate-100">
              {unlockHistory.map((item, idx) => (
                <div key={item.sheet_id + idx} className="px-5 py-4 flex items-start gap-4">
                  {/* Timeline dot */}
                  <div className="mt-1.5 flex-shrink-0">
                    <div className="h-2 w-2 rounded-full bg-purple-400 ring-2 ring-purple-100" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-slate-900 text-sm">{item.employee_name}</span>
                      <span className="text-xs text-slate-400">·</span>
                      <span className="text-xs text-slate-500">{item.department}</span>
                      <span className="text-xs text-slate-400">·</span>
                      <span className="text-xs text-slate-500">{item.period_label}</span>
                      {(item.current_status as GoalSheetStatus) in { DRAFT: 1, SUBMITTED: 1, RETURNED: 1, APPROVED: 1, LOCKED: 1 } && (
                        <StatusBadge status={item.current_status as GoalSheetStatus} />
                      )}
                      {item.total_unlocks > 1 && (
                        <span className="inline-flex items-center rounded-full bg-amber-100 text-amber-700 text-[10px] font-semibold px-2 py-0.5">
                          {item.total_unlocks}× unlocked
                        </span>
                      )}
                    </div>

                    <div className="mt-2 rounded-md bg-purple-50 border border-purple-100 px-3 py-2">
                      <p className="text-[10px] font-semibold text-purple-600 uppercase tracking-wide mb-0.5">
                        Reason
                      </p>
                      <p className="text-sm text-slate-800 leading-relaxed">
                        {item.unlock_reason || <span className="italic text-slate-400">No reason provided</span>}
                      </p>
                    </div>

                    <div className="mt-1.5 flex items-center gap-3 text-xs text-slate-400">
                      <span className="flex items-center gap-1">
                        <ShieldAlert size={10} className="text-purple-400" />
                        <strong className="text-slate-600">{item.unlocked_by_name}</strong>
                      </span>
                      <span>·</span>
                      <span className="flex items-center gap-1">
                        <Clock size={10} />
                        {formatTs(item.unlocked_at)}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Unlock Reason Dialog ── */}
      <Dialog open={!!unlockTarget} onOpenChange={(open) => { if (!open) closeUnlockDialog() }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-2 mb-1">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-purple-100">
                <Unlock size={16} className="text-purple-600" />
              </div>
              <DialogTitle>Unlock Goal Sheet</DialogTitle>
            </div>
            <DialogDescription>
              Transitions the sheet from{' '}
              <span className="font-semibold text-purple-700">Locked</span> →{' '}
              <span className="font-semibold text-amber-600">Returned</span>.
              The employee can then revise and resubmit.
            </DialogDescription>
          </DialogHeader>

          {/* Context card */}
          {unlockTarget && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm space-y-1.5">
              <ContextRow label="Employee" value={targetEmp?.name ?? unlockTarget.employee_id} />
              <ContextRow label="Department" value={targetEmp?.department ?? '—'} />
              <ContextRow label="Period" value={unlockTarget.period_label} />
              <ContextRow
                label="Status"
                value={<StatusBadge status="LOCKED" />}
              />
            </div>
          )}

          {/* Workflow note */}
          <div className="rounded-md border border-amber-100 bg-amber-50 px-3 py-2.5 text-xs text-amber-800 leading-relaxed">
            The employee will see an unlock notification with this reason and will be
            able to revise and resubmit. This action is permanently logged in the audit trail.
          </div>

          {/* Reason field */}
          <div className="space-y-1.5">
            <label className="block text-sm font-semibold text-slate-700">
              Reason <span className="text-red-500">*</span>
            </label>
            <textarea
              ref={reasonRef}
              rows={4}
              value={unlockReason}
              onChange={(e) => setUnlockReason(e.target.value)}
              placeholder="e.g. Correction required in Q2 targets — employee needs to revise weightage distribution."
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-400 resize-none"
            />
            <p className="text-xs text-slate-400">
              Visible to employee, their manager, and recorded permanently in the audit trail.
            </p>
          </div>

          {unlockError && (
            <p className="text-sm text-red-600">{unlockError}</p>
          )}

          <DialogFooter>
            <button
              onClick={closeUnlockDialog}
              disabled={unlockLoading}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirmUnlock}
              disabled={unlockLoading || !unlockReason.trim()}
              className="inline-flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-700 disabled:opacity-60 transition-colors"
            >
              {unlockLoading ? <Loader2 size={14} className="animate-spin" /> : <Unlock size={14} />}
              {unlockLoading ? 'Unlocking…' : 'Confirm Unlock'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

function FilterPill({
  active,
  onClick,
  label,
}: {
  active: boolean
  onClick: () => void
  label: string
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
        active
          ? 'bg-slate-900 text-white'
          : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
      }`}
    >
      {label}
    </button>
  )
}

function ContextRow({
  label,
  value,
}: {
  label: string
  value: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-slate-500 text-xs">{label}</span>
      <span className="font-medium text-slate-800 text-xs">{value}</span>
    </div>
  )
}
