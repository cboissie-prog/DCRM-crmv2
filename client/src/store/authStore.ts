import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import api from '../lib/api'

interface User {
  id: string
  email: string
  firstName: string
  lastName: string
  phone?: string
  avatar?: string
  role: string
  isActive: boolean
}

interface AuthState {
  user: User | null
  accessToken: string | null
  isAuthenticated: boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  setUser: (user: User) => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      accessToken: null,
      isAuthenticated: false,

      login: async (email: string, password: string) => {
        const { data } = await api.post('/auth/login', { email, password })
        const { user, accessToken } = data.data
        // Le refreshToken est stocké en cookie httpOnly par le serveur (inaccessible au JS)
        localStorage.setItem('accessToken', accessToken)
        set({ user, accessToken, isAuthenticated: true })
      },

      logout: async () => {
        try {
          // Le serveur supprime le refreshToken DB + efface le cookie
          await api.post('/auth/logout')
        } catch {}
        localStorage.removeItem('accessToken')
        set({ user: null, accessToken: null, isAuthenticated: false })
      },

      setUser: (user: User) => set({ user }),
    }),
    {
      name: 'crm-auth',
      partialize: (state) => ({ user: state.user, accessToken: state.accessToken, isAuthenticated: state.isAuthenticated }),
    }
  )
)
