/**
 * Manager Approvals Page
 * 
 * Two-section layout:
 * 1. PENDING APPROVALS - goal sheets in SUBMITTED status awaiting manager review
 * 2. APPROVAL HISTORY - collapsible accordion showing approved/returned sheets
 * 
 * Uses the same dark sidebar + white content layout as other manager pages.
 * Integrates with existing review modal workflow.
 */

import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Eye,
  Loader2,
  RotateCcw,
} from 'lucide-react'

import api from '@/lib/api'
import { StatusBadge } from '@/components/shared/StatusBadge'
import type { GoalSheetStatus } from '@/types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ApprovalItem {
  sheet_id: string
  employee_id: string
  employee_name: string
  employee_code: string
  department: string
  status: GoalSheetStatus
  period_label: string
  goal_count: number
  total_weightage: number
  overall_score?: number
  action_date?: string
  review_comment?: string
  reviewer_name?: string
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ApprovalsPage() {
  const navigate = useNavigate()
  const [pendingApprovals, setPendingApprovals] = useState<ApprovalItem[]>([])
  const [approvalHistory, setApprovalHistory] = useState<ApprovalItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedEmployees, setExpandedEmployees] = useState<Set<string>>(new Set())

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [pendingRes, historyRes] = await Promise.all([
        api.get<ApprovalItem[]>('/manager/approvals?status=submitted'),
        api.get<ApprovalItem[]>('/manager/approvals?status=approved,returned,locked'),
      ])
      
      setPendingApprovals(pendingRes.data)
      setApprovalHistory(historyRes.data)
    } catch (err) {
      console.error('Failed to load approvals:', err)
      setError('Failed to load approval data. Please refresh.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadData() }, [loadData])

  const toggleEmployee = (employeeId: string) => {
    setExpandedEmployees(prev => {
      const next = new Set(prev)
      if (next.has(employeeId)) {
        next.delete(employeeId)
      } else {
        next.add(employeeId)
      }
      return next
    })
  }

  // Group history by employee for accordion display
  const historyByEmployee = approvalHistory.reduce((acc, item) => {
    if (!acc[item.employee_id]) {
      acc[item.employee_id] = {
        employee_name: item.employee_name,
        employee_code: item.employee_code,
        department: item.department,
        sheets: []
      }
    }
    acc[item.employee_id].sheets.push(item)
    return acc
  }, {} as Record<string, {
    employee_name: string
    employee_code: string
    department: string
    sheets: ApprovalItem[]
  }>)

  const formatDate = (dateString?: string) => {
    if (!dateString) return '—'
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    })
  }

  const getActionText = (item: ApprovalItem) => {
    if (item.status === 'APPROVED' || item.status === 'LOCKED') {
      return `Approved by: ${item.reviewer_name || 'Manager'}`
    }
    if (item.status === 'RETURNED') {
      return `Returned by: ${item.reviewer_name || 'Manager'}`
    }
    return '—'
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-7 w-7 animate-spin text-slate-400" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div>
        {/* <p className="breadcrumb">Approvals</p> */}
        <h1 className="page-title">Goal Sheet Approvals</h1>
        <p className="text-xs text-slate-400 mt-0.5">
          Review submitted goal sheets and track approval history
        </p>
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

      {/* ── 1. PENDING APPROVALS ────────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">
            Pending Approvals
          </p>
          {pendingApprovals.length > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
              <Clock size={11} />
              {pendingApprovals.length} pending
            </span>
          )}
        </div>

        <div className="card overflow-hidden p-0">
          {pendingApprovals.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <CheckCircle2 size={28} className="text-slate-300" />
              <p className="text-sm font-semibold text-slate-600">No pending approvals</p>
              <p className="text-xs text-slate-400">
                All submitted goal sheets have been reviewed.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-100">
                  <tr>
                    <th className="th">Employee</th>
                    <th className="th">Department</th>
                    <th className="th">Status</th>
                    <th className="th">Goals</th>
                    <th className="th">Weightage</th>
                    <th className="th">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {pendingApprovals.map((item) => (
                    <tr key={item.sheet_id} className="tr">
                      <td className="td">
                        <div className="flex items-center gap-2">
                          <span className="h-1.5 w-1.5 rounded-full bg-blue-400 flex-shrink-0" />
                          <div>
                            <p className="font-medium text-slate-900 text-sm">{item.employee_name}</p>
                            <p className="text-xs text-slate-400">{item.employee_code}</p>
                          </div>
                        </div>
                      </td>
                      <td className="td">{item.department}</td>
                      <td className="td">
                        <StatusBadge status={item.status} />
                      </td>
                      <td className="td">{item.goal_count}</td>
                      <td className="td">
                        <span className={`text-xs font-medium ${item.total_weightage === 100 ? 'text-emerald-600' : 'text-amber-600'}`}>
                          {item.total_weightage}%
                        </span>
                      </td>
                      <td className="td">
                        <button
                          onClick={() => navigate(`/manager/review/${item.sheet_id}`)}
                          className="btn-primary btn-sm"
                        >
                          Review <ArrowRight size={11} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ── 2. APPROVAL HISTORY ─────────────────────────────────────────── */}
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400 mb-3">
          Approval History
        </p>

        <div className="card overflow-hidden p-0">
          {Object.keys(historyByEmployee).length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <RotateCcw size={28} className="text-slate-300" />
              <p className="text-sm font-semibold text-slate-600">No approval history</p>
              <p className="text-xs text-slate-400">
                Approved and returned goal sheets will appear here.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {Object.entries(historyByEmployee).map(([employeeId, employeeData]) => {
                const isExpanded = expandedEmployees.has(employeeId)
                const latestSheet = employeeData.sheets[0] // Already sorted by date DESC
                
                return (
                  <div key={employeeId}>
                    {/* Employee header row */}
                    <button
                      onClick={() => toggleEmployee(employeeId)}
                      className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-slate-50 transition-colors"
                    >
                      {isExpanded ? (
                        <ChevronDown size={16} className="text-slate-400 flex-shrink-0" />
                      ) : (
                        <ChevronRight size={16} className="text-slate-400 flex-shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-900">{employeeData.employee_name}</p>
                        <p className="text-xs text-slate-400 mt-0.5">
                          {employeeData.department} · {employeeData.sheets.length} approval{employeeData.sheets.length !== 1 ? 's' : ''}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <StatusBadge status={latestSheet.status} />
                        <span className="text-xs text-slate-500">
                          {formatDate(latestSheet.action_date)}
                        </span>
                      </div>
                    </button>

                    {/* Expanded sheet details */}
                    {isExpanded && (
                      <div className="bg-slate-50 border-t border-slate-100">
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead className="bg-slate-100">
                              <tr>
                                <th className="th text-left">Period</th>
                                <th className="th text-left">Status</th>
                                <th className="th text-left">Goals</th>
                                <th className="th text-left">Date</th>
                                <th className="th text-left">Last Action</th>
                                <th className="th text-left">Actions</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-200 bg-white">
                              {employeeData.sheets.map((sheet) => (
                                <tr key={sheet.sheet_id} className="hover:bg-slate-50">
                                  <td className="td">{sheet.period_label}</td>
                                  <td className="td">
                                    <StatusBadge status={sheet.status} />
                                  </td>
                                  <td className="td">{sheet.goal_count}</td>
                                  <td className="td">{formatDate(sheet.action_date)}</td>
                                  <td className="td">
                                    <span className="text-xs text-slate-600">
                                      {getActionText(sheet)}
                                    </span>
                                  </td>
                                  <td className="td">
                                    <button
                                      onClick={() => navigate(`/manager/review/${sheet.sheet_id}`)}
                                      className="btn-ghost btn-sm"
                                    >
                                      <Eye size={12} /> View
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}