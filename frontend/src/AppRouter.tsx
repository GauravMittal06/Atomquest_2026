import { useEffect } from 'react'
import { Routes, Route, useNavigate } from 'react-router-dom'
import {
  Activity,
  AlertTriangle,
  BarChart2,
  CheckSquare,
  ClipboardList,
  LayoutDashboard,
  ShieldCheck,
  TrendingUp,
  Users,
} from 'lucide-react'

import { setNavigate } from '@/lib/navigationService'
import { AppShell } from '@/components/layout/AppShell'
import { RequireAuth } from '@/components/layout/RequireAuth'
import { RootRedirect } from '@/components/layout/RootRedirect'
import { LoginPage } from '@/pages/auth/LoginPage'
import { EmployeeDashboard } from '@/pages/employee/Dashboard'
import { GoalsPage } from '@/pages/employee/GoalsPage'
import { CheckInsPage } from '@/pages/employee/CheckInsPage'
import { ManagerDashboard } from '@/pages/manager/Dashboard'
import { ReviewPage } from '@/pages/manager/ReviewPage'
import { CheckInReviewPage } from '@/pages/manager/CheckInReviewPage'
import { ApprovalsPage } from '@/pages/manager/ApprovalsPage'
import { AdminDashboard } from '@/pages/admin/Dashboard'
import { AdminCompletionDashboard } from '@/pages/admin/CompletionDashboard'
import { AdminGoalSheetsPage } from '@/pages/admin/GoalSheetsPage'
import { AdminReportsPage } from '@/pages/admin/ReportsPage'
import { AdminUsersPage } from '@/pages/admin/UsersPage'
import { AdminEscalationsPage } from '@/pages/admin/EscalationsPage'
import ManagerEffectivenessPage from '@/pages/admin/ManagerEffectivenessPage'

const employeeNav = [
  { label: 'Dashboard', to: '/employee/dashboard', icon: <LayoutDashboard size={16} /> },
  { label: 'My Goal Sheet', to: '/employee/goals', icon: <ClipboardList size={16} /> },
  { label: 'Check-ins', to: '/employee/checkins', icon: <CheckSquare size={16} /> },
]

const managerNav = [
  { label: 'Dashboard', to: '/manager/dashboard', icon: <LayoutDashboard size={16} /> },
  { label: 'Check-ins', to: '/manager/checkins', icon: <CheckSquare size={16} /> },
  { label: 'Approvals', to: '/manager/approvals', icon: <CheckSquare size={16} /> },
]

const adminNav = [
  { label: 'Dashboard', to: '/admin/dashboard', icon: <LayoutDashboard size={16} /> },
  { label: 'Completion', to: '/admin/completion', icon: <Activity size={16} /> },
  { label: 'Manager Effectiveness', to: '/admin/manager-effectiveness', icon: <TrendingUp size={18} /> },
  { label: 'All Goal Sheets', to: '/admin/goalsheets', icon: <ShieldCheck size={16} /> },
  { label: 'Reports', to: '/admin/reports', icon: <BarChart2 size={16} /> },
  { label: 'Users', to: '/admin/users', icon: <Users size={16} /> },
  { label: 'Escalations', to: '/admin/escalations', icon: <AlertTriangle size={16} /> },
]

export function AppRouter() {
  const navigate = useNavigate()

  // Register React Router's navigate with the singleton so the axios
  // interceptor can perform soft client-side redirects (no page reload).
  useEffect(() => {
    setNavigate(navigate)
  }, [navigate])

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      {/* Protected routes */}
      <Route element={<RequireAuth />}>
        <Route path="/" element={<RootRedirect />} />

        {/* Employee */}
        <Route element={<AppShell role="EMPLOYEE" navItems={employeeNav} />}>
          <Route path="/employee/dashboard" element={<EmployeeDashboard />} />
          <Route path="/employee/goals" element={<GoalsPage />} />
          <Route path="/employee/checkins" element={<CheckInsPage />} />
        </Route>

        {/* Manager */}
        <Route element={<AppShell role="MANAGER" navItems={managerNav} />}>
          <Route path="/manager/dashboard" element={<ManagerDashboard />} />
          <Route path="/manager/review/:sheetId" element={<ReviewPage />} />
          <Route path="/manager/checkins" element={<CheckInReviewPage />} />
          <Route path="/manager/approvals" element={<ApprovalsPage />} />
        </Route>

        {/* Admin */}
        <Route element={<AppShell role="ADMIN" navItems={adminNav} />}>
          <Route path="/admin/dashboard" element={<AdminDashboard />} />
          <Route path="/admin/completion" element={<AdminCompletionDashboard />} />
          <Route path="/admin/manager-effectiveness" element={<ManagerEffectivenessPage />} />
          <Route path="/admin/goalsheets" element={<AdminGoalSheetsPage />} />
          <Route path="/admin/reports" element={<AdminReportsPage />} />
          <Route path="/admin/users" element={<AdminUsersPage />} />
          <Route path="/admin/escalations" element={<AdminEscalationsPage />} />
        </Route>
      </Route>

      <Route path="*" element={<RootRedirect />} />
    </Routes>
  )
}
