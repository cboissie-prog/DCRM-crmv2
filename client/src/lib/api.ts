import axios from 'axios'

const BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001/api'

export const api = axios.create({
  baseURL: BASE_URL,
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true, // envoie le cookie httpOnly refreshToken automatiquement
})

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
        localStorage.setItem('accessToken', data.data.accessToken)
        originalRequest.headers.Authorization = `Bearer ${data.data.accessToken}`
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
