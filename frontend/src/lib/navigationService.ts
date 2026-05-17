/**
 * navigationService — singleton that holds a React Router navigate ref.
 *
 * Why it exists:
 *   The axios interceptor runs outside React component scope, so it cannot
 *   call React Router's useNavigate() hook directly. Instead, AppRouter
 *   calls setNavigate() once on mount to register the navigate function here.
 *   The interceptor then calls navigateTo() for a soft client-side redirect
 *   that does NOT trigger a full page reload (unlike window.location.href).
 */

import type { NavigateFunction } from 'react-router-dom'

let _navigate: NavigateFunction | null = null

export function setNavigate(fn: NavigateFunction): void {
  _navigate = fn
}

export function navigateTo(path: string): void {
  if (_navigate) {
    _navigate(path, { replace: true })
  } else {
    // Fallback: soft pushState so at least no hard reload occurs.
    window.history.pushState({}, '', path)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }
}
