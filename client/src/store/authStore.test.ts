import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useAuthStore } from './authStore'

// Mock de l'API axios pour éviter de vraies requêtes HTTP
vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return {
    ...actual,
    default: {
      post: vi.fn(),
    },
  }
})

// État initial du store
const initialState = {
  user: null,
  isAuthenticated: false,
}

beforeEach(() => {
  useAuthStore.setState(initialState)
  localStorage.clear()
  vi.clearAllMocks()
})

describe('hasPermission', () => {
  it('retourne false quand il ny a pas dutilisateur', () => {
    expect(useAuthStore.getState().hasPermission('contacts:read')).toBe(false)
  })

  it('retourne true pour ADMIN quelle que soit la permission', () => {
    useAuthStore.setState({
      user: {
        id: '1',
        email: 'admin@test.com',
        firstName: 'Admin',
        lastName: 'Test',
        role: 'ADMIN',
        isActive: true,
        permissions: [],
      },
      isAuthenticated: true,
    })
    expect(useAuthStore.getState().hasPermission('contacts:read')).toBe(true)
    expect(useAuthStore.getState().hasPermission('users:delete')).toBe(true)
    expect(useAuthStore.getState().hasPermission('any:permission')).toBe(true)
  })

  it('retourne true si la permission est dans la liste pour un non-admin', () => {
    useAuthStore.setState({
      user: {
        id: '2',
        email: 'commercial@test.com',
        firstName: 'Com',
        lastName: 'Mercial',
        role: 'COMMERCIAL',
        isActive: true,
        permissions: ['contacts:read', 'companies:read'],
      },
      isAuthenticated: true,
    })
    expect(useAuthStore.getState().hasPermission('contacts:read')).toBe(true)
    expect(useAuthStore.getState().hasPermission('companies:read')).toBe(true)
  })

  it('retourne false si la permission est absente pour un non-admin', () => {
    useAuthStore.setState({
      user: {
        id: '2',
        email: 'commercial@test.com',
        firstName: 'Com',
        lastName: 'Mercial',
        role: 'COMMERCIAL',
        isActive: true,
        permissions: ['contacts:read'],
      },
      isAuthenticated: true,
    })
    expect(useAuthStore.getState().hasPermission('users:delete')).toBe(false)
    expect(useAuthStore.getState().hasPermission('companies:create')).toBe(false)
  })
})

describe('login()', () => {
  it('pose user/permissions/isAuthenticated et écrit localStorage.accessToken', async () => {
    const { default: api } = await import('../lib/api')
    const mockPost = vi.mocked(api.post)
    mockPost.mockResolvedValueOnce({
      data: {
        data: {
          user: {
            id: '3',
            email: 'commercial@test.com',
            firstName: 'Jean',
            lastName: 'Dupont',
            role: 'COMMERCIAL',
            isActive: true,
            permissions: ['contacts:read'],
          },
          accessToken: 'tok',
        },
      },
    })

    await useAuthStore.getState().login('commercial@test.com', 'password')

    const state = useAuthStore.getState()
    expect(state.isAuthenticated).toBe(true)
    expect(state.user?.email).toBe('commercial@test.com')
    expect(state.user?.permissions).toEqual(['contacts:read'])
    expect(localStorage.getItem('accessToken')).toBe('tok')
  })

  it('extrait les permissions du JWT quand la réponse ne les contient pas', async () => {
    const { default: api } = await import('../lib/api')
    const mockPost = vi.mocked(api.post)

    // Fabrique un JWT avec permissions dans le payload
    const jwtPayload = btoa(JSON.stringify({ permissions: ['a:b'] }))
    const fakeJwt = `header.${jwtPayload}.sig`

    mockPost.mockResolvedValueOnce({
      data: {
        data: {
          user: {
            id: '4',
            email: 'tech@test.com',
            firstName: 'Tech',
            lastName: 'Nicien',
            role: 'TECHNICIEN',
            isActive: true,
            // pas de permissions dans la réponse (undefined)
          },
          accessToken: fakeJwt,
        },
      },
    })

    await useAuthStore.getState().login('tech@test.com', 'password')

    const state = useAuthStore.getState()
    expect(state.user?.permissions).toEqual(['a:b'])
  })
})

describe('logout()', () => {
  it('nettoie l\'état et localStorage', async () => {
    const { default: api } = await import('../lib/api')
    const mockPost = vi.mocked(api.post)
    mockPost.mockResolvedValueOnce({})

    // Mettre l'état connecté
    useAuthStore.setState({
      user: {
        id: '5',
        email: 'user@test.com',
        firstName: 'User',
        lastName: 'Test',
        role: 'COMMERCIAL',
        isActive: true,
        permissions: ['contacts:read'],
      },
      isAuthenticated: true,
    })
    localStorage.setItem('accessToken', 'some-token')

    await useAuthStore.getState().logout()

    const state = useAuthStore.getState()
    expect(state.isAuthenticated).toBe(false)
    expect(state.user).toBeNull()
    expect(localStorage.getItem('accessToken')).toBeNull()
  })

  it('nettoie l\'état même si l\'API échoue (best-effort)', async () => {
    const { default: api } = await import('../lib/api')
    const mockPost = vi.mocked(api.post)
    mockPost.mockRejectedValueOnce(new Error('Network error'))

    useAuthStore.setState({
      user: {
        id: '6',
        email: 'user@test.com',
        firstName: 'User',
        lastName: 'Test',
        role: 'COMMERCIAL',
        isActive: true,
        permissions: [],
      },
      isAuthenticated: true,
    })
    localStorage.setItem('accessToken', 'token-to-clear')

    await useAuthStore.getState().logout()

    const state = useAuthStore.getState()
    expect(state.isAuthenticated).toBe(false)
    expect(state.user).toBeNull()
    expect(localStorage.getItem('accessToken')).toBeNull()
  })
})
