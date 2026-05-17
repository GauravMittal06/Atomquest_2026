import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Target } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import type { UserRole } from '@/types'

/**
 * DEV quick-login presets. Each button performs a real mock login against
 * /api/auth/mock-login for a representative seeded user — same code path as
 * the topbar User Impersonation Selector — so the resulting JWT is valid.
 */
const QUICK_ROLES: {
  role: UserRole
  employeeId: string
  label: string
  colour: string
}[] = [
  { role: 'EMPLOYEE', employeeId: 'EMP001', label: 'Employee', colour: 'border-blue-400 text-blue-700 hover:bg-blue-50' },
  { role: 'MANAGER',  employeeId: 'MGR001', label: 'Manager',  colour: 'border-green-400 text-green-700 hover:bg-green-50' },
  { role: 'ADMIN',    employeeId: 'ADM001', label: 'Admin',    colour: 'border-purple-400 text-purple-700 hover:bg-purple-50' },
]

export function LoginPage() {
  const { login, impersonate } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await login(email, password)
      navigate('/', { replace: true })
    } catch {
      setError('Invalid email or password.')
    } finally {
      setLoading(false)
    }
  }

  async function handleQuickLogin(employeeId: string) {
    setError('')
    setLoading(true)
    try {
      await impersonate(employeeId)
      navigate('/', { replace: true })
    } catch {
      setError('Quick login failed. Is the backend running and seeded?')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-100 to-slate-200 p-4">
      <div className="w-full max-w-sm space-y-6 rounded-2xl bg-white p-8 shadow-xl">
        {/* Logo */}
        <div className="flex flex-col items-center gap-2">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-slate-900 text-white">
            <Target size={24} />
          </div>
          <h1 className="text-xl font-bold text-slate-900">AtomQuest</h1>
          <p className="text-sm text-slate-500">Goal Tracking Portal</p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
              placeholder="you@company.com"
              required
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
              placeholder="••••••••"
              required
            />
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-slate-900 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-60 transition-colors"
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        {/* Dev quick-login */}
        <div className="border-t pt-4 space-y-2">
          <p className="text-center text-xs text-slate-400 font-medium">Dev: Quick login as</p>
          <div className="flex gap-2">
            {QUICK_ROLES.map(({ role, employeeId, label, colour }) => (
              <button
                key={role}
                type="button"
                disabled={loading}
                onClick={() => handleQuickLogin(employeeId)}
                className={`flex-1 rounded-lg border px-2 py-1.5 text-xs font-semibold transition-colors disabled:opacity-60 ${colour}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
