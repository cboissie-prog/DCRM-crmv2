import axios from 'axios'

const BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001/api'

export const api = axios.create({
  baseURL: BASE_URL,
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true, // envoie le cookie httpOnly refreshToken automatiquement
})

// Utilitaire pour décoder le payload d'un JWT (pas de vérification de signature — côté serveur uniquement)
export function parseJwtPayload(token: string): Record<string, unknown> {
  try {
    const base64 = token.split('.')[1]
    return JSON.parse(atob(base64))
  } catch {
    return {}
  }
}

// Inject access token
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('accessToken')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// ── Refresh « single-flight » ────────────────────────────────────────────────
// Toutes les requêtes tombant en 401 en même temps partagent UN SEUL appel à
// /auth/refresh. Sinon plusieurs refresh concurrents présentent le même refresh
// token : le 1er le fait tourner (rotation), les suivants présentent un token déjà
// consommé → le serveur détecte une « réutilisation » et révoque TOUTES les sessions
// → déconnexion intempestive. Ce verrou évite cette course.
let refreshPromise: Promise<string> | null = null

async function refreshAccessToken(): Promise<string> {
  if (!refreshPromise) {
    // Le cookie refreshToken est envoyé automatiquement grâce à withCredentials
    refreshPromise = axios
      .post(`${BASE_URL}/auth/refresh`, {}, { withCredentials: true })
      .then(async ({ data }) => {
        const newAccessToken: string = data.data.accessToken
        localStorage.setItem('accessToken', newAccessToken)
        // Met à jour les permissions dans le store depuis le nouveau token
        const payload = parseJwtPayload(newAccessToken)
        if (Array.isArray(payload.permissions)) {
          // Import dynamique pour éviter une dépendance circulaire
          const { useAuthStore } = await import('../store/authStore')
          const user = useAuthStore.getState().user
          if (user) {
            useAuthStore.getState().setUser({ ...user, permissions: payload.permissions as string[] })
          }
        }
        return newAccessToken
      })
      .finally(() => { refreshPromise = null })
  }
  return refreshPromise
}

// Handle 401 → refresh (cookie envoyé automatiquement) ou logout
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config
    if (error.response?.status === 401 && originalRequest && !originalRequest._retry) {
      originalRequest._retry = true
      try {
        const newAccessToken = await refreshAccessToken()
        originalRequest.headers.Authorization = `Bearer ${newAccessToken}`
        return api(originalRequest)
      } catch {
        localStorage.removeItem('accessToken')
        localStorage.removeItem('crm-auth')
        window.location.href = '/login'
      }
    }
    return Promise.reject(error)
  }
)

export default api
