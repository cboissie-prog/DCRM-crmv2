import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import api, { parseJwtPayload } from '../lib/api'

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
  isAuthenticated: boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  setUser: (user: User) => void
  hasPermission: (permission: string) => boolean
  /** Utilisé après OAuth Google : initialise la session depuis un accessToken frais + données user */
  loginFromSession: (user: Omit<User, 'permissions'>, accessToken: string) => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      isAuthenticated: false,

      login: async (email: string, password: string) => {
        const { data } = await api.post('/auth/login', { email, password })
        const { user, accessToken } = data.data
        // Récupérer permissions depuis la réponse ; fallback en parsant le JWT si absent
        let permissions: string[] = user.permissions ?? null
        if (!permissions) {
          const payload = parseJwtPayload(accessToken)
          permissions = Array.isArray(payload.permissions) ? (payload.permissions as string[]) : []
        }
        const userWithPermissions: User = { ...user, permissions }
        // Le refreshToken est stocké en cookie httpOnly par le serveur (inaccessible au JS)
        // accessToken : source unique = localStorage['accessToken'] (lu par l'intercepteur Axios)
        localStorage.setItem('accessToken', accessToken)
        set({ user: userWithPermissions, isAuthenticated: true })
      },

      logout: async () => {
        try {
          // Le serveur supprime le refreshToken DB + efface le cookie
          await api.post('/auth/logout')
        } catch {
          // logout best-effort : on nettoie localement même si l'API échoue
        }
        localStorage.removeItem('accessToken')
        set({ user: null, isAuthenticated: false })
      },

      setUser: (user: User) => set({ user: { ...user, permissions: user.permissions ?? [] } }),

      loginFromSession: (userData: Omit<User, 'permissions'>, accessToken: string) => {
        const payload = parseJwtPayload(accessToken)
        const permissions: string[] = Array.isArray(payload.permissions) ? (payload.permissions as string[]) : []
        localStorage.setItem('accessToken', accessToken)
        set({ user: { ...userData, permissions }, isAuthenticated: true })
      },

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
      // accessToken n'est PAS persisté dans Zustand — source unique : localStorage['accessToken']
      // L'intercepteur Axios lit directement localStorage, pas le store.
      partialize: (state) => ({ user: state.user, isAuthenticated: state.isAuthenticated }),
    }
  )
)
