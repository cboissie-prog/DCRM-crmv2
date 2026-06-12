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

// Handle 401 → refresh (cookie envoyé automatiquement) ou logout
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true
      try {
        // Le cookie refreshToken est envoyé automatiquement grâce à withCredentials
        const { data } = await axios.post(`${BASE_URL}/auth/refresh`, {}, { withCredentials: true })
        const newAccessToken: string = data.data.accessToken
        localStorage.setItem('accessToken', newAccessToken)
        originalRequest.headers.Authorization = `Bearer ${newAccessToken}`

        // Mettre à jour les permissions dans le store depuis le nouveau token
        const payload = parseJwtPayload(newAccessToken)
        if (Array.isArray(payload.permissions)) {
          // Import dynamique pour éviter une dépendance circulaire
          const { useAuthStore } = await import('../store/authStore')
          const user = useAuthStore.getState().user
          if (user) {
            useAuthStore.getState().setUser({ ...user, permissions: payload.permissions as string[] })
          }
        }

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
