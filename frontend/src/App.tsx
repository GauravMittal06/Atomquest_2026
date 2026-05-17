import { useEffect } from 'react'
import { BrowserRouter, useNavigate } from 'react-router-dom'
import { AuthProvider } from '@/contexts/AuthContext'
import { AppRouter } from './AppRouter'
import { setNavigate } from '@/lib/navigationService'

/**
 * Registers React Router's navigate function into the navigation service so
 * the Axios interceptor can perform soft (client-side) redirects instead of
 * hard window.location.href navigations that destroy React state.
 *
 * Must be rendered *inside* <BrowserRouter> to have access to the router context.
 */
function NavigationServiceBridge() {
  const navigate = useNavigate()
  useEffect(() => {
    setNavigate(navigate)
  }, [navigate])
  return null
}

export default function App() {
  return (
    <BrowserRouter>
      <NavigationServiceBridge />
      <AuthProvider>
        <AppRouter />
      </AuthProvider>
    </BrowserRouter>
  )
}
