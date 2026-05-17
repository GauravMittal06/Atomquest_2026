/**
 * AppShell — sidebar + topbar layout used by all three role dashboards.
 * Navigation items are passed as props so each role can define its own set.
 */
import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import {
  LayoutDashboard,
  LogOut,
  Menu,
  Target,
  X,
} from 'lucide-react'

import { useAuth } from '@/contexts/AuthContext'
import { cn } from '@/lib/utils'
import type { UserRole } from '@/types'
import { MockDatePicker } from '@/components/admin/MockDatePicker'
import { RoleSwitcher } from './RoleSwitcher'

export interface NavItem {
  label: string
  to: string
  icon: React.ReactNode
}

interface AppShellProps {
  role: UserRole
  navItems: NavItem[]
}

const ROLE_LABELS: Record<UserRole, string> = {
  EMPLOYEE: 'Employee',
  MANAGER: 'Manager',
  ADMIN: 'Administrator',
}

const ROLE_ACCENT: Record<UserRole, string> = {
  EMPLOYEE: 'bg-blue-600',
  MANAGER: 'bg-green-600',
  ADMIN: 'bg-purple-600',
}

export function AppShell({ role, navItems }: AppShellProps) {
  const { user, logout } = useAuth()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-30 flex w-64 flex-col bg-white shadow-lg transition-transform duration-200 lg:static lg:translate-x-0',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        {/* Logo */}
        <div className={cn('flex items-center gap-2.5 px-5 py-4 text-white', ROLE_ACCENT[role])}>
          <Target size={22} />
          <span className="text-lg font-bold tracking-tight">AtomQuest</span>
          <button
            className="ml-auto lg:hidden"
            onClick={() => setSidebarOpen(false)}
          >
            <X size={18} />
          </button>
        </div>

        {/* Role chip */}
        <div className="px-4 py-2 border-b">
          <span className="text-xs font-semibold uppercase tracking-widest text-slate-400">
            {ROLE_LABELS[role]}
          </span>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto p-3 space-y-0.5">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-slate-100 text-slate-900'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900',
                )
              }
            >
              <span className="text-slate-400">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>

        {/* User footer */}
        <div className="border-t p-4 space-y-3">
          <div className="flex items-center gap-3">
            <div className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white', ROLE_ACCENT[role])}>
              {user?.name?.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-slate-900 truncate">{user?.name}</p>
              <p className="text-xs text-slate-500 truncate">{user?.department}</p>
              {user?.reporting_to_name && (
                <p className="text-xs text-slate-400 truncate mt-0.5">
                  Reports to:{' '}
                  <span className="font-medium text-slate-500">{user.reporting_to_name}</span>
                </p>
              )}
            </div>
          </div>
          <button
            onClick={logout}
            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-red-600 hover:bg-red-50 transition-colors"
          >
            <LogOut size={15} />
            Sign out
          </button>
        </div>
      </aside>

      {/* Main area */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Topbar */}
        <header className="flex h-14 items-center gap-3 border-b bg-white px-4 shadow-sm">
          <button
            className="lg:hidden text-slate-500 hover:text-slate-700"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu size={20} />
          </button>
          <span className="flex items-center gap-2 text-sm text-slate-500">
            <LayoutDashboard size={15} />
            Dashboard
          </span>
          <div className="ml-auto flex items-center gap-2">
            <MockDatePicker />
            <RoleSwitcher />
          </div>
        </header>

        {/* Page content
            The Outlet is keyed by the active user's _id so that an
            impersonation swap (RoleSwitcher) instantly remounts the page —
            mimicking `queryClient.invalidateQueries()` and forcing every
            dashboard's data fetch to re-run with the new JWT. */}
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet key={user?._id ?? 'anonymous'} />
        </main>
      </div>
    </div>
  )
}
