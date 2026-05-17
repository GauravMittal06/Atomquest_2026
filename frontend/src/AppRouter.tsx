import { Routes, Route } from 'react-router-dom'
import {
  BarChart2,
  CheckSquare,
  ClipboardList,
  LayoutDashboard,
  Settings,
  Users,
} from 'lucide-react'

import { AppShell } from '@/components/layout/AppShell'
import { RequireAuth } from '@/components/layout/RequireAuth'
import { RootRedirect } from '@/components/layout/RootRedirect'
import { LoginPage } from '@/pages/auth/LoginPage'
import { EmployeeDashboard } from '@/pages/employee/Dashboard'
import { ManagerDashboard } from '@/pages/manager/Dashboard'
import { AdminDashboard } from '@/pages/admin/Dashboard'

const employeeNav = [
  { label: 'Dashboard', to: '/employee/dashboard', icon: <LayoutDashboard size={16} /> },
  { label: 'My Goal Sheet', to: '/employee/goals', icon: <ClipboardList size={16} /> },
  { label: 'Check-ins', to: '/employee/checkins', icon: <CheckSquare size={16} /> },
  { label: 'Reports', to: '/employee/reports', icon: <BarChart2 size={16} /> },
]

const managerNav = [
  { label: 'Dashboard', to: '/manager/dashboard', icon: <LayoutDashboard size={16} /> },
  { label: 'Team Goals', to: '/manager/team', icon: <Users size={16} /> },
  { label: 'Approvals', to: '/manager/approvals', icon: <CheckSquare size={16} /> },
  { label: 'Reports', to: '/manager/reports', icon: <BarChart2 size={16} /> },
]

const adminNav = [
  { label: 'Dashboard', to: '/admin/dashboard', icon: <LayoutDashboard size={16} /> },
  { label: 'Users', to: '/admin/users', icon: <Users size={16} /> },
  { label: 'All Goal Sheets', to: '/admin/goalsheets', icon: <ClipboardList size={16} /> },
  { label: 'Reports', to: '/admin/reports', icon: <BarChart2 size={16} /> },
  { label: 'Settings', to: '/admin/settings', icon: <Settings size={16} /> },
]

export function AppRouter() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      {/* Protected routes */}
      <Route element={<RequireAuth />}>
        <Route path="/" element={<RootRedirect />} />

        {/* Employee */}
        <Route element={<AppShell role="EMPLOYEE" navItems={employeeNav} />}>
          <Route path="/employee/dashboard" element={<EmployeeDashboard />} />
          {/* Placeholder routes — replace with real pages */}
          <Route path="/employee/goals" element={<ComingSoon title="My Goal Sheet" />} />
          <Route path="/employee/checkins" element={<ComingSoon title="Check-ins" />} />
          <Route path="/employee/reports" element={<ComingSoon title="My Reports" />} />
        </Route>

        {/* Manager */}
        <Route element={<AppShell role="MANAGER" navItems={managerNav} />}>
          <Route path="/manager/dashboard" element={<ManagerDashboard />} />
          <Route path="/manager/team" element={<ComingSoon title="Team Goals" />} />
          <Route path="/manager/approvals" element={<ComingSoon title="Approvals" />} />
          <Route path="/manager/reports" element={<ComingSoon title="Team Reports" />} />
        </Route>

        {/* Admin */}
        <Route element={<AppShell role="ADMIN" navItems={adminNav} />}>
          <Route path="/admin/dashboard" element={<AdminDashboard />} />
          <Route path="/admin/users" element={<ComingSoon title="User Management" />} />
          <Route path="/admin/goalsheets" element={<ComingSoon title="All Goal Sheets" />} />
          <Route path="/admin/reports" element={<ComingSoon title="Organisation Reports" />} />
          <Route path="/admin/settings" element={<ComingSoon title="System Settings" />} />
        </Route>
      </Route>

      <Route path="*" element={<RootRedirect />} />
    </Routes>
  )
}

function ComingSoon({ title }: { title: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-20 text-slate-400">
      <span className="text-5xl">🚧</span>
      <p className="text-lg font-semibold text-slate-600">{title}</p>
      <p className="text-sm">Coming soon — this page will be implemented next.</p>
    </div>
  )
}
