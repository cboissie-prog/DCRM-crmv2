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
  permissions: string[]
}

interface AuthState {
  user: User | null
  accessToken: string | null
  isAuthenticated: boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  setUser: (user: User) => void
  hasPermission: (permission: string) => boolean
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      isAuthenticated: false,

      login: async (email: string, password: string) => {
        const { data } = await api.post('/auth/login', { email, password })
        const { user, accessToken } = data.data
        // S'assurer que permissions est toujours un tableau
        const userWithPermissions: User = { ...user, permissions: user.permissions ?? [] }
        // Le refreshToken est stocké en cookie httpOnly par le serveur (inaccessible au JS)
        localStorage.setItem('accessToken', accessToken)
        set({ user: userWithPermissions, accessToken, isAuthenticated: true })
      },

      logout: async () => {
        try {
          // Le serveur supprime le refreshToken DB + efface le cookie
          await api.post('/auth/logout')
        } catch {}
        localStorage.removeItem('accessToken')
        set({ user: null, accessToken: null, isAuthenticated: false })
      },

      setUser: (user: User) => set({ user: { ...user, permissions: user.permissions ?? [] } }),

      hasPermission: (permission: string) => {
        const user = get().user
        if (!user) return false
        // ADMIN bypass : si le rôle est ADMIN, toutes les permissions sont accordées
        if (user.role === 'ADMIN') return true
        return user.permissions.includes(permission)
      },
    }),
    {
      name: 'crm-auth',
      partialize: (state) => ({ user: state.user, accessToken: state.accessToken, isAuthenticated: state.isAuthenticated }),
    }
  )
)
