/**
 * Human-readable portal role labels for the app chrome.
 * Keys match UserRole in docs/ROLE_PERMISSIONS.md.
 */
import type { UserRole } from '@/types'

export const ROLE_DISPLAY_MAP: Record<UserRole, string> = {
  EMPLOYEE: 'Employee',
  MANAGER: 'L1 Manager',
  ADMIN: 'Admin',
}

const PORTAL_FALLBACK = 'Portal'

/** Resolves a role enum to the topbar label; never returns undefined/null. */
export function getRoleDisplayLabel(role: string | null | undefined): string {
  if (role && role in ROLE_DISPLAY_MAP) {
    return ROLE_DISPLAY_MAP[role as UserRole]
  }
  if (role) {
    console.warn('Unknown user role:', role)
  }
  return PORTAL_FALLBACK
}
