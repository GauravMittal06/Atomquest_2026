/**
 * Admin — All Goal Sheets (Governance & Unlock Workflows)
 *
 * Hierarchical accordion grouped by employee:
 *   GET /api/admin/all-goal-sheets  — employees with nested goal sheets
 *   GET /api/goalsheets/unlock-history
 *   POST /api/goalsheets/{id}/unlock
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Building2,
  Clock,
  FileSearch,
  History,
  Loader2,
  ShieldAlert,
  Unlock,
} from 'lucide-react'

import api from '@/lib/api'
import { cn } from '@/lib/utils'
import { formatScore as formatScoreUtil } from '@/utils/scoring'
import { StatusBadge } from '@/components/shared/StatusBadge'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type {
  AdminAllGoalSheetsResponse,
  AdminEmployeeGoalSheet,
  AdminEmployeeGoalSheets,
  GoalSheetStatus,
  UnlockRequest,
} from '@/types'

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

interface UnlockTarget {
  sheet: AdminEmployeeGoalSheet
  employee: AdminEmployeeGoalSheets
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

// Use centralized score formatting from utils/scoring.ts
const formatScore = formatScoreUtil

function sheetLabel(sheet: AdminEmployeeGoalSheet): string {
  const rev = sheet.revision > 1 ? ` (Revision ${sheet.revision})` : ''
  return `${sheet.fy}${rev}`
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AdminGoalSheetsPage() {
  const [data, setData] = useState<AdminAllGoalSheetsResponse | null>(null)
  const [unlockHistory, setUnlockHistory] = useState<UnlockHistoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<StatusFilter>('ALL')
  const [departmentFilter, setDepartmentFilter] = useState('')

  const [unlockTarget, setUnlockTarget] = useState<UnlockTarget | null>(null)
  const [unlockReason, setUnlockReason] = useState('')
  const [unlockLoading, setUnlockLoading] = useState(false)
  const [unlockError, setUnlockError] = useState<string | null>(null)
  const reasonRef = useRef<HTMLTextAreaElement | null>(null)

  const [tab, setTab] = useState<'sheets' | 'history'>('sheets')

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const params: Record<string, string> = {}
      if (filter !== 'ALL') params.status = filter
      if (departmentFilter) params.department = departmentFilter

      const [sheetsRes, historyRes] = await Promise.all([
        api.get<AdminAllGoalSheetsResponse>('/admin/all-goal-sheets', { params }),
        api.get<UnlockHistoryItem[]>('/goalsheets/unlock-history'),
      ])
      setData(sheetsRes.data)
      setUnlockHistory(historyRes.data)
    } catch {
      // Non-fatal
    } finally {
      setLoading(false)
    }
  }, [filter, departmentFilter])

  useEffect(() => { loadData() }, [loadData])

  function clearFilters() {
    setFilter('ALL')
    setDepartmentFilter('')
  }

  function openSheetUnlock(employee: AdminEmployeeGoalSheets, sheet: AdminEmployeeGoalSheet) {
    setUnlockTarget({ sheet, employee })
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

    if (unlockTarget.sheet.status !== 'LOCKED') {
      setUnlockError('No locked goal sheets to unlock.')
      return
    }

    setUnlockLoading(true)
    setUnlockError(null)
    try {
      const body: UnlockRequest = { reason }
      await api.post(`/goalsheets/${unlockTarget.sheet.sheet_id}/unlock`, body)
      await loadData()
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

  const employees = data?.employees ?? []
  const departments = data?.departments ?? []
  const totalSheets = data?.total_sheets ?? 0
  const filteredSheets = data?.filtered_sheet_count ?? totalSheets
  const statusCounts = data?.status_counts ?? {
    DRAFT: 0, SUBMITTED: 0, RETURNED: 0, APPROVED: 0, LOCKED: 0,
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
      </div>
    )
  }

  return (
    <div className="space-y-5">

      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="breadcrumb">Admin · Goal Sheets</p>
          <h1 className="page-title">All Goal Sheets</h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Governance · Unlock workflows · Audit trail
          </p>
        </div>
        <span className="inline-flex items-center rounded-full bg-purple-50 px-2.5 py-1 text-xs font-semibold text-purple-700 ring-1 ring-purple-200">
          Admin Only
        </span>
      </div>

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
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex flex-wrap gap-2">
              <FilterPill
                active={filter === 'ALL'}
                onClick={() => setFilter('ALL')}
                label={`All (${filter === 'ALL' && !departmentFilter ? totalSheets : filteredSheets})`}
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

            <div className="flex items-center gap-2 ml-auto">
              <Building2 size={14} className="text-slate-400" />
              <select
                value={departmentFilter}
                onChange={(e) => setDepartmentFilter(e.target.value)}
                className="input py-1.5 text-xs min-w-[160px]"
              >
                <option value="">All departments</option>
                {departments.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="card overflow-hidden p-0">
            {employees.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <FileSearch className="h-10 w-10 text-slate-300 mb-3" />
                <p className="text-sm text-slate-500">
                  No goal sheets match the selected filters.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-4"
                  onClick={clearFilters}
                >
                  Clear filters
                </Button>
              </div>
            ) : (
              <Accordion type="multiple" className="w-full divide-y divide-slate-200">
                {employees.map((emp) => (
                  <AccordionItem key={emp.user_id} value={emp.user_id} className="border-0">
                    <AccordionTrigger className="hover:no-underline hover:bg-slate-50/50">
                      <EmployeeRow employee={emp} />
                    </AccordionTrigger>
                    <AccordionContent className="bg-slate-50/50 py-2">
                      <Accordion type="multiple" className="px-3">
                        {emp.goal_sheets.map((sheet) => (
                          <AccordionItem
                            key={sheet.sheet_id}
                            value={sheet.sheet_id}
                            className="rounded-lg border border-slate-200 bg-white mb-2 overflow-hidden border-l-0"
                          >
                            <AccordionTrigger className="py-3 px-4 hover:no-underline hover:bg-slate-50/50">
                              <GoalSheetRow
                                sheet={sheet}
                                onUnlock={(e) => {
                                  e.stopPropagation()
                                  openSheetUnlock(emp, sheet)
                                }}
                              />
                            </AccordionTrigger>
                            <AccordionContent className="px-4 pb-3">
                              {sheet.goals.length === 0 ? (
                                <p className="text-xs text-slate-400 italic py-2">No goals on this sheet.</p>
                              ) : (
                                <div className="overflow-x-auto rounded-md border border-slate-100 ml-4 pl-4 border-l-2 border-l-blue-200">
                                  <table className="w-full text-xs">
                                    <thead className="bg-slate-50 text-slate-500 uppercase tracking-wide">
                                      <tr>
                                        <th className="th">Thrust Area</th>
                                        <th className="th">Description</th>
                                        <th className="th">Weight</th>
                                        <th className="th">Achievement</th>
                                        <th className="th">Score</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                      {sheet.goals.map((g) => (
                                        <tr key={g.goal_id}>
                                          <td className="td">{g.thrust_area_label}</td>
                                          <td className="td max-w-xs truncate" title={g.description}>
                                            {g.description}
                                          </td>
                                          <td className="td">{g.weightage ?? '—'}%</td>
                                          <td className="td">
                                            {g.achievement_pct != null ? `${formatScore(g.achievement_pct)}%` : '—'}
                                          </td>
                                          <td className="td">
                                            {formatScore(g.goal_score)}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              )}
                            </AccordionContent>
                          </AccordionItem>
                        ))}
                      </Accordion>
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            )}
          </div>

          <p className="text-xs text-slate-400 text-center">
            {employees.length} employee{employees.length !== 1 ? 's' : ''} · {filteredSheets} of {totalSheets} goal sheet{totalSheets !== 1 ? 's' : ''}
          </p>
        </>
      )}

      {tab === 'history' && (
        <div className="card overflow-hidden p-0">
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
            </DialogDescription>
          </DialogHeader>

          {unlockTarget && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm space-y-1.5">
              <ContextRow
                label="Employee"
                value={`${unlockTarget.employee.name} (${unlockTarget.employee.employee_id})`}
              />
              <ContextRow label="Department" value={unlockTarget.employee.department} />
              <ContextRow label="Period" value={sheetLabel(unlockTarget.sheet)} />
            </div>
          )}

          <div className="rounded-md border border-amber-100 bg-amber-50 px-3 py-2.5 text-xs text-amber-800 leading-relaxed">
            The employee will see an unlock notification with this reason and will be
            able to revise and resubmit. This action is permanently logged in the audit trail.
          </div>

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
              className={cn('input resize-none', unlockError && 'input-error')}
            />
          </div>

          {unlockError && <p className="text-sm text-red-600">{unlockError}</p>}

          <DialogFooter>
            <button onClick={closeUnlockDialog} disabled={unlockLoading} className="btn-outline">
              Cancel
            </button>
            <button
              onClick={handleConfirmUnlock}
              disabled={unlockLoading || !unlockReason.trim()}
              className="btn-primary"
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
// Row components
// ---------------------------------------------------------------------------

function EmployeeRow({ employee }: { employee: AdminEmployeeGoalSheets }) {
  return (
    <div className="flex flex-1 flex-wrap items-center gap-x-2 gap-y-2 w-full min-w-0 pr-2">
      <span className="font-medium text-base text-slate-900">{employee.name}</span>
      <span className="inline-flex items-center rounded-full bg-slate-100 text-slate-500 text-xs px-2 py-0.5">
        {employee.employee_id}
      </span>

      <span className="border-l border-slate-200 mx-3 h-4 inline-block" aria-hidden />
      <span className="text-sm text-slate-500">{employee.department}</span>

      <span className="border-l border-slate-200 mx-3 h-4 inline-block" aria-hidden />
      <span className="text-sm text-slate-500">{employee.manager}</span>

      {employee.latest_status && (
        <>
          <span className="border-l border-slate-200 mx-3 h-4 inline-block hidden sm:inline" aria-hidden />
          <StatusBadge status={employee.latest_status} />
        </>
      )}

      <span className="border-l border-slate-200 mx-3 h-4 inline-block hidden md:inline" aria-hidden />
      <span className="text-sm">
        <span className="text-slate-500">Score: </span>
        <span className="font-medium text-slate-900">{formatScore(employee.latest_score)}</span>
      </span>

      <span className="inline-flex items-center rounded-full bg-slate-100 text-slate-700 text-xs px-2 py-0.5 ml-1">
        {employee.goal_sheet_count} sheet{employee.goal_sheet_count !== 1 ? 's' : ''}
      </span>
    </div>
  )
}

function GoalSheetRow({
  sheet,
  onUnlock,
}: {
  sheet: AdminEmployeeGoalSheet
  onUnlock: (e: React.MouseEvent) => void
}) {
  return (
    <div className="flex flex-1 items-center gap-x-3 gap-y-1 w-full min-w-0 pr-2 border-l-2 border-blue-200 ml-4 pl-4 text-sm">
      <span className="font-medium text-slate-800">{sheetLabel(sheet)}</span>
      <StatusBadge status={sheet.status} />
      {sheet.has_admin_unlock && (
        <span className="flex items-center gap-1 text-[10px] text-purple-600">
          <ShieldAlert size={9} /> Admin override
        </span>
      )}
      <span className="text-slate-500">
        Goals: {sheet.goals_count}
      </span>
      <span className="text-slate-500">
        Score: {formatScore(sheet.score)}
      </span>

      {sheet.status === 'LOCKED' && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="ml-auto shrink-0"
          onClick={onUnlock}
        >
          <Unlock size={12} />
          Unlock
        </Button>
      )}
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
