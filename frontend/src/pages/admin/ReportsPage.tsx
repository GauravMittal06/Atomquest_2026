/**
 * Admin — Reports & Analytics
 *
 * Consolidates all non-operational reporting and analytics:
 *   - Planned vs Actual Achievement CSV export
 *   - Department summary
 *   - Pushed Shared KPIs history
 *
 * Data sources:
 *   GET /api/users/team                      — employee/manager info
 *   GET /api/goalsheets/                     — all goal sheets
 *   GET /api/shared-kpis/                    — all shared KPIs
 *   GET /api/goalsheets/export/achievement   — CSV blob (Admin only)
 *
 * Permissions: docs/ROLE_PERMISSIONS.md §Admin — "Export reports"
 * Audit:       docs/REPORTING_REQUIREMENTS.md §Required Reports
 */
import { useCallback, useEffect, useState } from 'react'
import {
  BarChart2,
  Building2,
  Download,
  Loader2,
} from 'lucide-react'

import api from '@/lib/api'
import { formatScore } from '@/utils/scoring'
import type { GoalSheet, GoalSheetStatus, SharedKpi, User } from '@/types'
import { THRUST_AREA_LABELS } from '@/types'

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AdminReportsPage() {
  const [allUsers, setAllUsers] = useState<User[]>([])
  const [allSheets, setAllSheets] = useState<GoalSheet[]>([])
  const [sharedKpis, setSharedKpis] = useState<SharedKpi[]>([])
  const [loading, setLoading] = useState(true)

  // ── Export state ─────────────────────────────────────────────────────────
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const [exportSuccess, setExportSuccess] = useState(false)

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [usersRes, sheetsRes, kpisRes] = await Promise.all([
        api.get<User[]>('/users/team'),
        api.get<GoalSheet[]>('/goalsheets/'),
        api.get<SharedKpi[]>('/shared-kpis/'),
      ])
      setAllUsers(usersRes.data)
      setAllSheets(sheetsRes.data)
      setSharedKpis(kpisRes.data)
    } catch {
      // Non-fatal
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadData() }, [loadData])

  async function handleExport() {
    setExporting(true)
    setExportError(null)
    setExportSuccess(false)
    try {
      const res = await api.get('/goalsheets/export/achievement', { responseType: 'blob' })
      const blob = new Blob([res.data as BlobPart], { type: 'text/csv' })
      const url = window.URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      const disposition: string = (res.headers as Record<string, string>)['content-disposition'] ?? ''
      const match = disposition.match(/filename="?([^"]+)"?/)
      anchor.download = match ? match[1] : 'achievement_report.csv'
      anchor.href = url
      document.body.appendChild(anchor)
      anchor.click()
      document.body.removeChild(anchor)
      window.URL.revokeObjectURL(url)
      setExportSuccess(true)
      setTimeout(() => setExportSuccess(false), 3000)
    } catch {
      setExportError('Export failed. Please try again.')
    } finally {
      setExporting(false)
    }
  }

  // ---------------------------------------------------------------------------
  // Derived
  // ---------------------------------------------------------------------------

  const employees = allUsers.filter((u) => u.role === 'EMPLOYEE')

  const deptMap = new Map<string, { employees: number; scores: number[]; statusCounts: Record<GoalSheetStatus, number> }>()
  for (const u of employees) {
    if (!deptMap.has(u.department)) {
      deptMap.set(u.department, {
        employees: 0,
        scores: [],
        statusCounts: { DRAFT: 0, SUBMITTED: 0, RETURNED: 0, APPROVED: 0, LOCKED: 0 },
      })
    }
    deptMap.get(u.department)!.employees++
  }
  for (const s of allSheets) {
    const emp = allUsers.find((u) => u._id === s.employee_id)
    if (!emp) continue
    const dept = deptMap.get(emp.department)
    if (!dept) continue
    if (s.overall_score != null) dept.scores.push(s.overall_score)
    if (s.status in dept.statusCounts) dept.statusCounts[s.status as GoalSheetStatus]++
  }
  const deptStats = Array.from(deptMap.entries())
    .map(([dept, d]) => ({
      dept,
      employees: d.employees,
      avgScore: d.scores.length
        ? formatScore(d.scores.reduce((a, b) => a + b, 0) / d.scores.length)
        : '—',
      locked: d.statusCounts.LOCKED,
      submitted: d.statusCounts.SUBMITTED,
    }))
    .sort((a, b) => a.dept.localeCompare(b.dept))

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
      </div>
    )
  }

  return (
    <div className="space-y-6">

      {/* ── Header ── */}
      <div>
        {/* <p className="breadcrumb">Admin · Reports</p> */}
        <h1 className="page-title">Reports & Analytics</h1>
        <p className="text-xs text-slate-400 mt-0.5">
          Export, department analysis, and shared KPI history
        </p>
      </div>

      {/* ── Section 1: Export ── */}
      <section>
        <SectionLabel icon={<Download size={13} />}>Planned vs Actual Achievement</SectionLabel>
        <div className="card">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <p className="text-sm font-semibold text-slate-800">Achievement Report CSV</p>
              <p className="text-xs text-slate-500 mt-1 max-w-sm">
                Exports all goal sheets with planned targets, actual achievements, scores,
                check-in history, and audit trail columns.
              </p>
            </div>
            <div className="flex flex-col items-end gap-1.5">
              <button
                onClick={handleExport}
                disabled={exporting}
                className="btn-primary"
              >
                {exporting
                  ? <Loader2 size={14} className="animate-spin" />
                  : <Download size={14} />}
                {exporting ? 'Exporting…' : 'Download CSV'}
              </button>
              {exportSuccess && (
                <p className="text-xs text-emerald-600 font-medium">Downloaded successfully</p>
              )}
              {exportError && (
                <p className="text-xs text-red-600">{exportError}</p>
              )}
            </div>
          </div>

          {/* Field listing */}
          <div className="mt-4 rounded-md bg-slate-50 border border-slate-100 px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2">
              Report columns
            </p>
            <div className="flex flex-wrap gap-1.5">
              {[
                'employee_id', 'employee_name', 'department', 'period_label', 'sheet_status',
                'thrust_area', 'goal_description', 'planned_target_value', 'latest_actual_value',
                'achievement_pct', 'goal_score', 'weightage', 'overall_score',
                'goal_approved_date', 'checkin_quarter', 'manager_checkin_comment',
                'last_modified_by', 'last_modified_date',
              ].map((col) => (
                <span
                  key={col}
                  className="rounded bg-white border border-slate-200 px-2 py-0.5 text-[10px] font-mono text-slate-600"
                >
                  {col}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Section 2: Department Summary ── */}
      <section>
        <SectionLabel icon={<Building2 size={13} />}>Department Summary</SectionLabel>
        <div className="card overflow-hidden p-0">
          {deptStats.length === 0 ? (
            <p className="px-5 py-8 text-sm text-slate-400 italic text-center">
              No department data yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 uppercase tracking-wide border-b border-slate-100">
                  <tr>
                    <th className="th">Department</th>
                    <th className="th">Employees</th>
                    <th className="th">Submitted</th>
                    <th className="th">Locked</th>
                    <th className="th">Avg Score</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {deptStats.map((row) => (
                    <tr key={row.dept} className="tr">
                      <td className="td">{row.dept}</td>
                      <td className="td">{row.employees}</td>
                      <td className="td">
                        <span className={row.submitted > 0 ? 'font-medium text-blue-600' : 'text-slate-300'}>
                          {row.submitted}
                        </span>
                      </td>
                      <td className="td">
                        <span className={row.locked > 0 ? 'font-medium text-purple-600' : 'text-slate-300'}>
                          {row.locked}
                        </span>
                      </td>
                      <td className="td">
                        {row.avgScore ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {/* ── Section 3: Pushed Shared KPI history ── */}
      {sharedKpis.length > 0 && (
        <section>
          <SectionLabel icon={<BarChart2 size={13} />}>Pushed KPI History</SectionLabel>
          <div className="card overflow-hidden p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 uppercase tracking-wide border-b border-slate-100">
                  <tr>
                    <th className="th">Description</th>
                    <th className="th">Thrust Area</th>
                    <th className="th">Period</th>
                    <th className="th">Recipients</th>
                    <th className="th">✓ OK</th>
                    <th className="th">⏭ Skipped</th>
                    <th className="th">Primary Owner</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sharedKpis.map((kpi) => {
                    const primaryEmp = allUsers.find((u) => u._id === kpi.primary_owner_id)
                    const successCount = kpi.push_results.filter((r) => r.status === 'SUCCESS').length
                    const skipCount = kpi.push_results.filter((r) => r.status === 'SKIPPED').length
                    return (
                      <tr key={kpi._id} className="tr">
                        <td className="td">
                          <p className="font-medium text-slate-800 line-clamp-1">{kpi.description}</p>
                          <p className="text-xs text-slate-400 mt-0.5">
                            {kpi.uom_type} · {kpi.unit_of_measure} · Target: {String(kpi.target_value)}
                          </p>
                        </td>
                        <td className="td">
                          {THRUST_AREA_LABELS[kpi.thrust_area]}
                        </td>
                        <td className="td">{kpi.period_label}</td>
                        <td className="td">{kpi.recipient_ids.length}</td>
                        <td className="td">
                          <span className="font-semibold text-green-600">{successCount}</span>
                        </td>
                        <td className="td">
                          <span className={skipCount > 0 ? 'font-semibold text-amber-600' : 'text-slate-300'}>
                            {skipCount}
                          </span>
                        </td>
                        <td className="td">
                          {primaryEmp?.name ?? kpi.primary_owner_id}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

function SectionLabel({
  icon,
  children,
}: {
  icon?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center gap-1.5 mb-2.5">
      {icon && <span className="text-slate-400">{icon}</span>}
      <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">
        {children}
      </p>
    </div>
  )
}
