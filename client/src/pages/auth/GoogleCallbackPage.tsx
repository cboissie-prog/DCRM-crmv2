import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'
import { useAuthStore } from '../../store/authStore'

const BASE_URL = (import.meta.env.VITE_API_URL ?? 'http://localhost:3001/api') as string

/**
 * Page intermédiaire visitée après la redirection Google OAuth.
 * Le serveur a posé le cookie refreshToken httpOnly et redirigé ici.
 *
 * 1. POST /auth/refresh  → récupère un accessToken frais (cookie envoyé automatiquement)
 * 2. GET  /auth/me       → données utilisateur
 * 3. Peuple le store, redirige vers /
 */
export function GoogleCallbackPage() {
  const navigate = useNavigate()
  const { loginFromSession } = useAuthStore()
  const done = useRef(false)

  useEffect(() => {
    // Strict Mode double-invoke guard
    if (done.current) return
    done.current = true

    async function finalizeSession() {
      try {
        // 1. Refresh → accessToken
        const { data: refreshData } = await axios.post(
          `${BASE_URL}/auth/refresh`,
          {},
          { withCredentials: true }
        )
        const accessToken: string = refreshData.data.accessToken

        // 2. Me → user data
        const { data: meData } = await axios.get(`${BASE_URL}/auth/me`, {
          headers: { Authorization: `Bearer ${accessToken}` },
          withCredentials: true,
        })
        const user = meData.data

        // 3. Peuple le store
        loginFromSession(user, accessToken)

        navigate('/', { replace: true })
      } catch {
        navigate('/login?error=session', { replace: true })
      }
    }

    finalizeSession()
  }, [navigate, loginFromSession])

  return (
    <div className="flex items-center justify-center h-screen bg-slate-50">
      <div className="flex flex-col items-center gap-4">
        <div className="w-10 h-10 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
        <p className="text-sm text-slate-500">Connexion avec Google en cours…</p>
      </div>
    </div>
  )
}
