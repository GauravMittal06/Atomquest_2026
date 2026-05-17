/**
 * Admin Users Page — User Management Overview
 *
 * Provides comprehensive view of all users (employees, managers, admins) in the organization.
 * Admin is read-only viewer per docs/ROLE_PERMISSIONS.md — no create/edit/delete operations.
 *
 * Data sources:
 *   GET /api/admin/users — all users with goal sheet status and manager details
 *
 * Features:
 *   - Search by name or employee ID (client-side filtering)
 *   - Role filter dropdown (All / Employee / Manager / Admin)
 *   - Status badges for Role and Goal Sheet Status
 *   - Manager relationship display
 *   - Last check-in date tracking
 *
 * Permissions: docs/ROLE_PERMISSIONS.md §Admin — read-only access to user data
 */
import { useCallback, useEffect, useState } from 'react'
import {
  ChevronDown,
  Loader2,
  Search,
  Users,
} from 'lucide-react'

import api from '@/lib/api'
import { cn } from '@/lib/utils'
import { StatusBadge } from '@/components/shared/StatusBadge'
import type { GoalSheetStatus, UserRole } from '@/types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AdminUserData {
  _id: string
  employee_id: string
  name: string
  email: string
  role: UserRole
  department: string
  phone?: string
  is_active: boolean
  manager_name?: string
  goal_sheet_status?: GoalSheetStatus
  last_checkin_date?: string
  created_at: string
}

type RoleFilter = 'ALL' | UserRole

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ROLE_LABELS: Record<UserRole, string> = {
  EMPLOYEE: 'Employee',
  MANAGER: 'Manager',
  ADMIN: 'Admin',
}

const ROLE_BADGE_STYLES: Record<UserRole, string> = {
  EMPLOYEE: 'bg-blue-50 text-blue-700 border border-blue-200',
  MANAGER: 'bg-purple-50 text-purple-700 border border-purple-200',
  ADMIN: 'bg-slate-50 text-slate-700 border border-slate-200',
}

function formatDate(dateStr?: string): string {
  if (!dateStr) return '—'
  try {
    return new Date(dateStr).toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    })
  } catch {
    return '—'
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUserData[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('ALL')

  const loadUsers = useCallback(async () => {
    setLoading(true)
    try {
      const response = await api.get<AdminUserData[]>('/admin/dashboard/users')
      setUsers(response.data)
    } catch {
      // Non-fatal error handling
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadUsers()
  }, [loadUsers])

  // ---------------------------------------------------------------------------
  // Derived data
  // ---------------------------------------------------------------------------

  const filteredUsers = users
    .filter((user) => {
      // Role filter
      if (roleFilter !== 'ALL' && user.role !== roleFilter) {
        return false
      }
      
      // Search filter (name or employee ID)
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase()
        return (
          user.name.toLowerCase().includes(query) ||
          user.employee_id.toLowerCase().includes(query)
        )
      }
      
      return true
    })
    .sort((a, b) => a.name.localeCompare(b.name))

  const roleCounts = users.reduce(
    (acc, user) => {
      acc[user.role]++
      return acc
    },
    { EMPLOYEE: 0, MANAGER: 0, ADMIN: 0 } as Record<UserRole, number>,
  )

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* ── Page header ── */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="breadcrumb">Admin · Users</p>
          <h1 className="page-title">User Management</h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Organization overview · {users.length} total users
          </p>
        </div>
        <span className="inline-flex items-center rounded-full bg-purple-50 px-2.5 py-1 text-xs font-semibold text-purple-700 ring-1 ring-purple-200">
          Admin Only
        </span>
      </div>

      {/* ── Filters and search ── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {/* Search input */}
        <div className="relative flex-1 max-w-sm">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search by name or employee ID..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="input pl-10"
          />
        </div>

        {/* Role filter dropdown */}
        <div className="relative">
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value as RoleFilter)}
            className="input appearance-none pr-8 cursor-pointer"
          >
            <option value="ALL">All Roles ({users.length})</option>
            <option value="EMPLOYEE">Employee ({roleCounts.EMPLOYEE})</option>
            <option value="MANAGER">Manager ({roleCounts.MANAGER})</option>
            <option value="ADMIN">Admin ({roleCounts.ADMIN})</option>
          </select>
          <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
        </div>
      </div>

      {/* ── Results summary ── */}
      {searchQuery.trim() || roleFilter !== 'ALL' ? (
        <div className="flex items-center gap-2 text-sm text-slate-600">
          <Users size={14} />
          <span>
            Showing {filteredUsers.length} of {users.length} users
            {searchQuery.trim() && (
              <span className="text-slate-400"> matching "{searchQuery}"</span>
            )}
          </span>
        </div>
      ) : null}

      {/* ── Users table ── */}
      <div className="card overflow-hidden p-0">
        {filteredUsers.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <Users size={32} className="mx-auto text-slate-300 mb-3" />
            <p className="text-sm text-slate-500 font-medium">No users found</p>
            <p className="text-xs text-slate-400 mt-1">
              {searchQuery.trim()
                ? 'Try adjusting your search criteria'
                : 'No users match the selected filters'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 uppercase tracking-wide border-b border-slate-100">
                <tr>
                  <th className="th text-left">Employee ID</th>
                  <th className="th text-left">Full Name</th>
                  <th className="th text-left">Department</th>
                  <th className="th text-left">Role</th>
                  <th className="th text-left">Status</th>
                  <th className="th text-left">Goal Sheet Status</th>
                  <th className="th text-left">Last Check-in Date</th>
                  <th className="th text-left">Manager Name</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredUsers.map((user) => (
                  <tr key={user._id} className="tr">
                    {/* Employee ID */}
                    <td className="td">
                      <span className="font-mono text-slate-800">{user.employee_id}</span>
                    </td>

                    {/* Full Name */}
                    <td className="td">
                      <div className="flex flex-col">
                        <span className="font-medium text-slate-900">{user.name}</span>
                        <span className="text-xs text-slate-400">{user.email}</span>
                      </div>
                    </td>

                    {/* Department */}
                    <td className="td">{user.department}</td>

                    {/* Role Badge */}
                    <td className="td">
                      <span className={cn(
                        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
                        ROLE_BADGE_STYLES[user.role],
                      )}>
                        {ROLE_LABELS[user.role]}
                      </span>
                    </td>

                    {/* Status */}
                    <td className="td">
                      <span className={cn(
                        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
                        user.is_active
                          ? 'bg-green-50 text-green-700 border border-green-200'
                          : 'bg-red-50 text-red-700 border border-red-200',
                      )}>
                        {user.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>

                    {/* Goal Sheet Status */}
                    <td className="td">
                      {user.goal_sheet_status ? (
                        <StatusBadge status={user.goal_sheet_status} />
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </td>

                    {/* Last Check-in Date */}
                    <td className="td">
                      <span className="text-slate-600">
                        {formatDate(user.last_checkin_date)}
                      </span>
                    </td>

                    {/* Manager Name */}
                    <td className="td">
                      {user.manager_name ? (
                        <span className="text-slate-700">{user.manager_name}</span>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Summary footer ── */}
      <div className="card-sm">
        <div className="flex flex-wrap gap-4 text-xs text-slate-500">
          <span>
            <strong className="text-slate-700">{roleCounts.EMPLOYEE}</strong> Employees
          </span>
          <span>
            <strong className="text-slate-700">{roleCounts.MANAGER}</strong> Managers  
          </span>
          <span>
            <strong className="text-slate-700">{roleCounts.ADMIN}</strong> Admins
          </span>
          <span className="ml-auto">
            Last updated: {new Date().toLocaleTimeString('en-IN', { 
              hour: '2-digit', 
              minute: '2-digit' 
            })}
          </span>
        </div>
      </div>
    </div>
  )
}