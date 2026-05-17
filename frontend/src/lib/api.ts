import axios from 'axios'
import { navigateTo } from '@/lib/navigationService'

const api = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
})

// Request interceptor — always reads the latest token from localStorage so
// that an impersonation that just updated the token is honoured on the very
// next request (no provider re-render required).
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('access_token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

api.interceptors.response.use(
  (res) => res,
  (error) => {
    if (error.response?.status === 401) {
      // Every session (real login or DEV impersonation) is JWT-backed, so a
      // 401 always means the token is missing/expired/invalid.
      localStorage.removeItem('access_token')
      navigateTo('/login')
    }
    return Promise.reject(error)
  },
)

export default api
