/**
 * Admin Dashboard
 *
 * Data sources:
 *   GET /api/users/team        — all employees (Admin sees everyone)
 *   GET /api/goalsheets/       — all goal sheets
 *   GET /api/shared-kpis/     — all shared KPIs pushed org-wide
 *
 * Includes PushSharedKpiForm to push departmental KPIs to employees
 * (docs/SHARED_GOALS.md + docs/ROLE_PERMISSIONS.md §Admin).
 *
 * KPI cards per docs/REPORTING_REQUIREMENTS.md §6 (Admin Dashboard).
 */
import { useCallback, useEffect, useState } from 'react'
import { Activity, CheckCircle, Loader2, TrendingUp, Users } from 'lucide-react'

import api from '@/lib/api'
import { KpiCard } from '@/components/shared/KpiCard'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { PushSharedKpiForm } from '@/components/shared-goals/PushSharedKpiForm'
import type { GoalSheet, GoalSheetStatus, SharedKpi, SharedKpiPushResponse, User } from '@/types'
import { THRUST_AREA_LABELS } from '@/types'

const STATUS_ORDER: GoalSheetStatus[] = ['DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED', 'LOCKED']

export function AdminDashboard() {
  const [allUsers, setAllUsers] = useState<User[]>([])
  const [allSheets, setAllSheets] = useState<GoalSheet[]>([])
  const [sharedKpis, setSharedKpis] = useState<SharedKpi[]>([])
  const [loading, setLoading] = useState(true)

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
      // Non-fatal — show placeholders
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  function handlePushSuccess(_res: SharedKpiPushResponse) {
    // Refresh shared KPIs list after a successful push
    api.get<SharedKpi[]>('/shared-kpis/').then((r) => setSharedKpis(r.data)).catch(() => {})
  }

  // ---------------------------------------------------------------------------
  // Derived stats
  // ---------------------------------------------------------------------------
  const totalEmployees = allUsers.filter((u) => u.role === 'EMPLOYEE').length

  const statusCounts: Record<GoalSheetStatus, number> = {
    DRAFT: 0, SUBMITTED: 0, RETURNED: 0, APPROVED: 0, LOCKED: 0,
  }
  for (const s of allSheets) {
    if (s.status in statusCounts) statusCounts[s.status as GoalSheetStatus]++
  }
  const total = allSheets.length || 1
  const approved = statusCounts.APPROVED + statusCounts.LOCKED
  const scores = allSheets
    .filter((s) => s.overall_score != null)
    .map((s) => s.overall_score as number)
  const orgScore =
    scores.length
      ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1)
      : '—'

  // Department summary
  const deptMap = new Map<string, { employees: number; scores: number[] }>()
  for (const u of allUsers) {
    if (u.role !== 'EMPLOYEE') continue
    if (!deptMap.has(u.department)) deptMap.set(u.department, { employees: 0, scores: [] })
    deptMap.get(u.department)!.employees++
  }
  for (const s of allSheets) {
    const emp = allUsers.find((u) => u._id === s.employee_id)
    if (emp && s.overall_score != null) {
      deptMap.get(emp.department)?.scores.push(s.overall_score)
    }
  }
  const deptStats = Array.from(deptMap.entries()).map(([dept, d]) => ({
    dept,
    employees: d.employees,
    avgScore: d.scores.length
      ? (d.scores.reduce((a, b) => a + b, 0) / d.scores.length).toFixed(1)
      : '—',
  }))

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Organisation Overview</h1>
        <p className="text-sm text-slate-500 mt-1">FY 2025-26 · All departments</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard
          label="Total Employees"
          value={totalEmployees}
          sub="Active users"
          icon={<Users size={18} />}
          accent="blue"
        />
        <KpiCard
          label="Sheets by Status"
          value={`${approved} Approved`}
          sub={`${statusCounts.SUBMITTED} pending review`}
          icon={<Activity size={18} />}
          accent="amber"
        />
        <KpiCard
          label="Org Score"
          value={orgScore !== '—' ? `${orgScore} / 100` : '—'}
          sub="Approved / Locked only"
          icon={<TrendingUp size={18} />}
          accent="green"
        />
        <KpiCard
          label="Shared KPIs Pushed"
          value={sharedKpis.length}
          sub="This period"
          icon={<CheckCircle size={18} />}
          accent="purple"
        />
      </div>

      {/* ── Push Departmental KPI ── */}
      <PushSharedKpiForm
        teamMembers={allUsers}
        onSuccess={handlePushSuccess}
      />

      {/* ── Existing shared KPIs ── */}
      {sharedKpis.length > 0 && (
        <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b bg-slate-50 flex items-center justify-between">
            <h2 className="font-semibold text-slate-900">Pushed Shared KPIs</h2>
            <span className="text-xs text-slate-400">{sharedKpis.length} total</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500 uppercase tracking-wide">
                <tr>
                  <th className="px-5 py-3 text-left">Description</th>
                  <th className="px-5 py-3 text-left">Thrust Area</th>
                  <th className="px-5 py-3 text-left">Period</th>
                  <th className="px-5 py-3 text-right">Recipients</th>
                  <th className="px-5 py-3 text-right">✓ OK</th>
                  <th className="px-5 py-3 text-right">⏭ Skipped</th>
                  <th className="px-5 py-3 text-left">Primary Owner</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sharedKpis.map((kpi) => {
                  const primaryEmp = allUsers.find((u) => u._id === kpi.primary_owner_id)
                  const successCount = kpi.push_results.filter((r) => r.status === 'SUCCESS').length
                  const skipCount = kpi.push_results.filter((r) => r.status === 'SKIPPED').length
                  return (
                    <tr key={kpi._id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-5 py-3 max-w-xs">
                        <p className="font-medium text-slate-800 line-clamp-1">{kpi.description}</p>
                        <p className="text-xs text-slate-400 mt-0.5">
                          {kpi.uom_type} · {kpi.unit_of_measure} · Target: {String(kpi.target_value)}
                        </p>
                      </td>
                      <td className="px-5 py-3 text-xs text-slate-500 whitespace-nowrap">
                        {THRUST_AREA_LABELS[kpi.thrust_area]}
                      </td>
                      <td className="px-5 py-3 text-slate-500">{kpi.period_label}</td>
                      <td className="px-5 py-3 text-right text-slate-700">{kpi.recipient_ids.length}</td>
                      <td className="px-5 py-3 text-right">
                        <span className="font-semibold text-green-600">{successCount}</span>
                      </td>
                      <td className="px-5 py-3 text-right">
                        <span className={skipCount > 0 ? 'font-semibold text-amber-600' : 'text-slate-300'}>
                          {skipCount}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-slate-600 text-xs">
                        {primaryEmp?.name ?? kpi.primary_owner_id}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Status breakdown + Dept summary */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b">
            <h2 className="font-semibold text-slate-900">Goal Sheet Status Breakdown</h2>
          </div>
          <ul className="divide-y divide-slate-100">
            {STATUS_ORDER.map((st) => (
              <li key={st} className="flex items-center justify-between px-5 py-3">
                <StatusBadge status={st} />
                <div className="flex items-center gap-3">
                  <div className="w-32 h-2 rounded-full bg-slate-100 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-slate-400 transition-all"
                      style={{ width: `${(statusCounts[st] / total) * 100}%` }}
                    />
                  </div>
                  <span className="text-sm font-semibold text-slate-700 w-6 text-right">
                    {statusCounts[st]}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b flex items-center justify-between">
            <h2 className="font-semibold text-slate-900">Department Summary</h2>
          </div>
          {deptStats.length === 0 ? (
            <p className="px-5 py-8 text-sm text-slate-400 italic text-center">
              No department data yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500 uppercase tracking-wide">
                  <tr>
                    <th className="px-5 py-3 text-left">Department</th>
                    <th className="px-5 py-3 text-right">Employees</th>
                    <th className="px-5 py-3 text-right">Avg Score</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {deptStats.map((row) => (
                    <tr key={row.dept} className="hover:bg-slate-50 transition-colors">
                      <td className="px-5 py-3 font-medium text-slate-900">{row.dept}</td>
                      <td className="px-5 py-3 text-right text-slate-600">{row.employees}</td>
                      <td className="px-5 py-3 text-right font-semibold text-slate-700">
                        {row.avgScore}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
