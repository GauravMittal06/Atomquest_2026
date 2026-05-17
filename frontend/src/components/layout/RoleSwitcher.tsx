/**
 * DEV-only role switcher widget shown in the topbar.
 * Allows toggling between EMPLOYEE / MANAGER / ADMIN without a login flow.
 */
import { useAuth } from '@/contexts/AuthContext'
import type { UserRole } from '@/types'

const ROLES: UserRole[] = ['EMPLOYEE', 'MANAGER', 'ADMIN']

const ROLE_COLOURS: Record<UserRole, string> = {
  EMPLOYEE: 'bg-blue-600 text-white',
  MANAGER: 'bg-green-600 text-white',
  ADMIN: 'bg-purple-600 text-white',
}

const INACTIVE = 'bg-slate-100 text-slate-600 hover:bg-slate-200'

export function RoleSwitcher() {
  const { role, switchRole } = useAuth()

  return (
    <div className="flex items-center gap-1 rounded-lg border bg-white p-1 shadow-sm">
      <span className="pr-2 text-xs text-slate-400 font-medium">Dev:</span>
      {ROLES.map((r) => (
        <button
          key={r}
          onClick={() => switchRole(r)}
          className={[
            'rounded px-2 py-0.5 text-xs font-semibold transition-colors',
            role === r ? ROLE_COLOURS[r] : INACTIVE,
          ].join(' ')}
        >
          {r[0] + r.slice(1).toLowerCase()}
        </button>
      ))}
    </div>
  )
}
