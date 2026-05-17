/**
 * DEV-only User Impersonation Selector shown in the topbar.
 *
 * Replaces the legacy Employee/Manager/Admin button toggle that only updated
 * local UI state. Picking an option now performs a full mock login against
 * POST /api/auth/mock-login, stores the resulting JWT in the global Auth
 * Context, and navigates to the impersonated user's role home — so every
 * dashboard immediately renders that user's MongoDB state.
 *
 * Users mirror the seeded fixtures in backend/seed.py exactly.
 */
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertCircle, Loader2, UserRound } from 'lucide-react'

import { useAuth } from '@/contexts/AuthContext'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { UserRole } from '@/types'

// ---------------------------------------------------------------------------
// Seeded users (must match backend/seed.py)
// ---------------------------------------------------------------------------

interface SeedUser {
  employee_id: string
  name: string
  role: UserRole
}

const ADMINS: SeedUser[] = [
  { employee_id: 'ADM001', name: 'Sneha Kapoor', role: 'ADMIN' },
]

const MANAGERS: SeedUser[] = [
  { employee_id: 'MGR001', name: 'Rahul Mehta', role: 'MANAGER' },
  { employee_id: 'MGR002', name: 'Ananya Krishnan', role: 'MANAGER' },
]

const EMPLOYEES: SeedUser[] = [
  { employee_id: 'EMP001', name: 'Arjun Nair', role: 'EMPLOYEE' },
  { employee_id: 'EMP002', name: 'Priya Sharma', role: 'EMPLOYEE' },
  { employee_id: 'EMP003', name: 'Kavya Reddy', role: 'EMPLOYEE' },
  { employee_id: 'EMP004', name: 'Siddharth Joshi', role: 'EMPLOYEE' },
  { employee_id: 'EMP005', name: 'Meera Iyer', role: 'EMPLOYEE' },
]

const ALL_USERS: SeedUser[] = [...ADMINS, ...MANAGERS, ...EMPLOYEES]

const ROLE_HOME: Record<UserRole, string> = {
  EMPLOYEE: '/employee/dashboard',
  MANAGER: '/manager/dashboard',
  ADMIN: '/admin/dashboard',
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function RoleSwitcher() {
  const { user, impersonate } = useAuth()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const currentValue = user?.employee_id ?? ''

  async function handleSelect(employeeId: string) {
    if (busy || employeeId === currentValue) return
    const target = ALL_USERS.find((u) => u.employee_id === employeeId)
    if (!target) return

    setBusy(true)
    setError(null)
    try {
      const me = await impersonate(employeeId)
      // Navigate to the impersonated user's role home so the AppShell chrome
      // (sidebar colour + nav items) matches the new identity. The Outlet is
      // keyed by user._id in AppShell, so same-role swaps also remount the
      // page content and re-run every dashboard fetch.
      navigate(ROLE_HOME[me.role], { replace: true })
    } catch {
      setError('Switch failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex items-center gap-2">
      <span className="hidden lg:inline text-xs font-semibold uppercase tracking-wider text-slate-400">
      </span>
      <Select
        value={currentValue}
        onValueChange={handleSelect}
        disabled={busy}
      >
        <SelectTrigger
          className="h-8 w-[240px] text-xs"
          aria-label="Impersonate a seeded user"
        >
          {busy ? (
            <span className="flex items-center gap-1.5 text-slate-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Switching session…
            </span>
          ) : (
            <span className="flex items-center gap-1.5">
              <UserRound className="h-3.5 w-3.5 text-slate-400" />
              <SelectValue placeholder="Select a user…" />
            </span>
          )}
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectLabel>Admin</SelectLabel>
            {ADMINS.map((u) => (
              <SelectItem key={u.employee_id} value={u.employee_id}>
                {u.name} · {u.employee_id}
              </SelectItem>
            ))}
          </SelectGroup>

          <SelectSeparator />

          <SelectGroup>
            <SelectLabel>Managers</SelectLabel>
            {MANAGERS.map((u) => (
              <SelectItem key={u.employee_id} value={u.employee_id}>
                {u.name} · {u.employee_id}
              </SelectItem>
            ))}
          </SelectGroup>

          <SelectSeparator />

          <SelectGroup>
            <SelectLabel>Employees</SelectLabel>
            {EMPLOYEES.map((u) => (
              <SelectItem key={u.employee_id} value={u.employee_id}>
                {u.name} · {u.employee_id}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>

      {error && (
        <span
          className="flex items-center gap-1 text-xs text-red-600"
          role="alert"
        >
          <AlertCircle className="h-3.5 w-3.5" />
          {error}
        </span>
      )}
    </div>
  )
}
