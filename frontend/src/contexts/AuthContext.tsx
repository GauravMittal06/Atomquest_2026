/**
 * Global Auth Context.
 *
 * Every session — including DEV impersonation — is backed by a real signed
 * JWT issued by the FastAPI backend. The `impersonate(employee_id)` action
 * powers the topbar User Impersonation Selector and replaces the legacy
 * client-only role toggle that caused 401 auth desync (the Axios interceptor
 * had no token while the backend required one).
 *
 * Flow for impersonate():
 *   1. POST /api/auth/mock-login { employee_id }   → { access_token }
 *   2. localStorage.setItem('access_token', …)     → interceptor uses it
 *   3. GET  /api/users/me                          → canonical user document
 *   4. setState() + bump authVersion               → downstream consumers refetch
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
  /**
   * Monotonically increases on every successful login / impersonation.
   * Consumers can include this in a `useEffect` dependency array to force
   * a refetch when the active identity changes — analogous to React Query's
   * `queryClient.invalidateQueries()`.
   */
  authVersion: number
}

interface AuthContextValue extends AuthState {
  login: (email: string, password: string) => Promise<void>
  logout: () => void
  /**
   * DEV-only: instantly switch the active session to a seeded user.
   * Accepts the human-readable employee_id (e.g. "EMP001", "MGR002", "ADM001").
   * Performs a full mock login so the resulting JWT is honoured by every
   * backend endpoint.
   */
  impersonate: (employeeId: string) => Promise<User>
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const AuthContext = createContext<AuthContextValue | null>(null)

/**
 * Synchronous initial state — avoids a flash of unauthenticated UI when a
 * valid JWT is already in localStorage. The /users/me round-trip happens in
 * an effect immediately after mount.
 */
function getInitialState(): AuthState {
  // Defensively scrub any leftover keys from the previous mock-role design.
  localStorage.removeItem('mock_role')
  sessionStorage.removeItem('mock_role_backup')

  const token = localStorage.getItem('access_token')
  if (token) {
    return {
      user: null,
      role: null,
      isAuthenticated: false,
      isLoading: true,
      authVersion: 0,
    }
  }
  return {
    user: null,
    role: null,
    isAuthenticated: false,
    isLoading: false,
    authVersion: 0,
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(getInitialState)

  // On mount: hydrate the session by validating any persisted JWT.
  useEffect(() => {
    const token = localStorage.getItem('access_token')
    if (!token) return

    api
      .get<User>('/users/me')
      .then(({ data }) => {
        setState((prev) => ({
          user: data,
          role: data.role,
          isAuthenticated: true,
          isLoading: false,
          authVersion: prev.authVersion + 1,
        }))
      })
      .catch(() => {
        localStorage.removeItem('access_token')
        setState({
          user: null,
          role: null,
          isAuthenticated: false,
          isLoading: false,
          authVersion: 0,
        })
      })
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    const form = new URLSearchParams({ username: email, password })
    const { data } = await api.post<Token>('/auth/token', form, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    })
    localStorage.setItem('access_token', data.access_token)
    const { data: me } = await api.get<User>('/users/me')
    setState((prev) => ({
      user: me,
      role: me.role,
      isAuthenticated: true,
      isLoading: false,
      authVersion: prev.authVersion + 1,
    }))
  }, [])

  const logout = useCallback(() => {
    localStorage.removeItem('access_token')
    setState({
      user: null,
      role: null,
      isAuthenticated: false,
      isLoading: false,
      authVersion: 0,
    })
  }, [])

  const impersonate = useCallback(async (employeeId: string): Promise<User> => {
    const { data } = await api.post<Token>('/auth/mock-login', {
      employee_id: employeeId,
    })
    // Persist BEFORE the next request so the Axios interceptor picks up the
    // new token — this is the fix for the original 401 desync.
    localStorage.setItem('access_token', data.access_token)

    const { data: me } = await api.get<User>('/users/me')
    setState((prev) => ({
      user: me,
      role: me.role,
      isAuthenticated: true,
      isLoading: false,
      authVersion: prev.authVersion + 1,
    }))
    return me
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({ ...state, login, logout, impersonate }),
    [state, login, logout, impersonate],
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
