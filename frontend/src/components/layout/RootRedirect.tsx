/**
 * Root router — redirects to the correct role dashboard automatically.
 * Employee → /employee/dashboard
 * Manager  → /manager/dashboard
 * Admin    → /admin/dashboard
 */
import { Navigate } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'

export function RootRedirect() {
  const { role, isLoading } = useAuth()

  if (isLoading) return null

  if (role === 'EMPLOYEE') return <Navigate to="/employee/dashboard" replace />
  if (role === 'MANAGER') return <Navigate to="/manager/dashboard" replace />
  if (role === 'ADMIN') return <Navigate to="/admin/dashboard" replace />

  return <Navigate to="/login" replace />
}
