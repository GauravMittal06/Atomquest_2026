/**
 * Auth context with mock role-switching support for development.
 *
 * In development mode the context exposes `switchRole()` so developers can
 * toggle between EMPLOYEE / MANAGER / ADMIN without a real login flow.
 * In production this is driven by the JWT returned by /api/auth/token.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

import api from '@/lib/api'
import type { Token, User, UserRole } from '@/types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AuthState {
  user: User | null
  role: UserRole | null
  isAuthenticated: boolean
  isLoading: boolean
}

interface AuthContextValue extends AuthState {
  login: (email: string, password: string) => Promise<void>
  logout: () => void
  /**
   * DEV ONLY — switches the active role without a round-trip to the server.
   * The mock users below are used so the UI can be explored for each role.
   */
  switchRole: (role: UserRole) => void
}

// ---------------------------------------------------------------------------
// Mock users (DEV only) — one per role as defined in docs/ROLE_PERMISSIONS.md
// ---------------------------------------------------------------------------

const MOCK_USERS: Record<UserRole, User> = {
  EMPLOYEE: {
    _id: 'mock-employee-001',
    employee_id: 'EMP001',
    name: 'Priya Sharma',
    email: 'priya.sharma@atomquest.in',
    role: 'EMPLOYEE',
    department: 'Engineering',
    manager_id: 'mock-manager-001',
    is_active: true,
    created_at: new Date().toISOString(),
  },
  MANAGER: {
    _id: 'mock-manager-001',
    employee_id: 'MGR001',
    name: 'Rahul Mehta',
    email: 'rahul.mehta@atomquest.in',
    role: 'MANAGER',
    department: 'Engineering',
    is_active: true,
    created_at: new Date().toISOString(),
  },
  ADMIN: {
    _id: 'mock-admin-001',
    employee_id: 'ADM001',
    name: 'Sneha Kapoor',
    email: 'sneha.kapoor@atomquest.in',
    role: 'ADMIN',
    department: 'HR & Administration',
    is_active: true,
    created_at: new Date().toISOString(),
  },
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    role: null,
    isAuthenticated: false,
    isLoading: true,
  })

  // On mount: restore session from localStorage (real token or mock role)
  useEffect(() => {
    const token = localStorage.getItem('access_token')
    const mockRole = localStorage.getItem('mock_role') as UserRole | null

    if (mockRole && MOCK_USERS[mockRole]) {
      setState({ user: MOCK_USERS[mockRole], role: mockRole, isAuthenticated: true, isLoading: false })
      return
    }

    if (token) {
      api.get<User>('/users/me')
        .then(({ data }) => {
          setState({ user: data, role: data.role, isAuthenticated: true, isLoading: false })
        })
        .catch(() => {
          localStorage.removeItem('access_token')
          setState({ user: null, role: null, isAuthenticated: false, isLoading: false })
        })
    } else {
      setState((s) => ({ ...s, isLoading: false }))
    }
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    const form = new URLSearchParams({ username: email, password })
    const { data } = await api.post<Token>('/auth/token', form, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    })
    localStorage.setItem('access_token', data.access_token)
    localStorage.removeItem('mock_role')
    const { data: me } = await api.get<User>('/users/me')
    setState({ user: me, role: me.role, isAuthenticated: true, isLoading: false })
  }, [])

  const logout = useCallback(() => {
    localStorage.removeItem('access_token')
    localStorage.removeItem('mock_role')
    setState({ user: null, role: null, isAuthenticated: false, isLoading: false })
  }, [])

  /** DEV ONLY: instantly switch to a mock user of the given role. */
  const switchRole = useCallback((role: UserRole) => {
    localStorage.removeItem('access_token')
    localStorage.setItem('mock_role', role)
    setState({ user: MOCK_USERS[role], role, isAuthenticated: true, isLoading: false })
  }, [])

  const value = useMemo(
    () => ({ ...state, login, logout, switchRole }),
    [state, login, logout, switchRole],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>')
  return ctx
}
