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
import { getRoleDisplayLabel } from '@/lib/roleDisplay'
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

export function AppShell({ role, navItems }: AppShellProps) {
  const { user, logout, role: authRole } = useAuth()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const headerRoleLabel = getRoleDisplayLabel(authRole ?? role)

  return (
    <div className="flex h-screen w-full overflow-hidden bg-slate-50">
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
          'sidebar lg:translate-x-0',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        {/* Logo */}
        <div className="sidebar-logo-area">
          <Target size={22} className="text-white" />
          <span className="text-lg font-bold tracking-tight text-white">AtomQuest</span>
          <button
            className="ml-auto lg:hidden text-white"
            onClick={() => setSidebarOpen(false)}
          >
            <X size={18} />
          </button>
        </div>

        {/* Role chip */}
        <div className="px-4 py-2 border-b border-white/10">
          <span className="text-xs font-semibold uppercase tracking-widest text-slate-400">
            {ROLE_LABELS[role]}
          </span>
        </div>

        {/* Nav */}
        <nav className="sidebar-nav">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                isActive ? cn('sidebar-link sidebar-link-active') : 'sidebar-link'
              }
            >
              <span className="opacity-70">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>

        {/* User footer */}
        <div className="sidebar-footer">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">
              {user?.name?.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white truncate">{user?.name}</p>
              <p className="text-xs text-slate-400 truncate">{user?.department}</p>
              {user?.reporting_to_name && (
                <p className="text-xs text-slate-500 truncate mt-0.5">
                  Reports to:{' '}
                  <span className="font-medium text-slate-500">{user.reporting_to_name}</span>
                </p>
              )}
            </div>
          </div>
          <button
            onClick={logout}
            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-red-400 hover:bg-white/5 transition-colors"
          >
            <LogOut size={15} />
            Sign out
          </button>
        </div>
      </aside>

      {/* Main area */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden page-content lg:ml-64">
        {/* Topbar */}
        <header className="topbar">
          <button
            className="lg:hidden text-slate-500 hover:text-slate-700"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu size={20} />
          </button>
          <span className="flex items-center gap-2 text-sm text-slate-500">
            <LayoutDashboard size={15} />
            {headerRoleLabel}
          </span>
          <div className="ml-auto flex items-center gap-4">
            <MockDatePicker />
            <RoleSwitcher />
          </div>
        </header>

        {/* Page content
            The Outlet is keyed by the active user's _id so that an
            impersonation swap (RoleSwitcher) instantly remounts the page —
            mimicking `queryClient.invalidateQueries()` and forcing every
            dashboard's data fetch to re-run with the new JWT. */}
        <main className="main-area">
          <Outlet key={user?._id ?? 'anonymous'} />
        </main>
      </div>
    </div>
  )
}
