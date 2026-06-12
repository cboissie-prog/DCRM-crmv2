/**
 * GoogleCallbackPage.test.tsx
 * Tests de la page de finalisation OAuth Google.
 *
 * Cas testés :
 *   1. refresh OK + me OK → store peuplé, navigation vers /
 *   2. refresh KO         → navigation vers /login?error=session
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { useAuthStore } from '../../store/authStore'

// ── Mocks ─────────────────────────────────────────────────────────────────────

// mock axios AVANT tous les imports qui l'utilisent transitoirement
// axios.create() doit renvoyer un objet avec interceptors pour que api.ts ne plante pas.
const { mockPost, mockGet } = vi.hoisted(() => ({
  mockPost: vi.fn(),
  mockGet:  vi.fn(),
}))

vi.mock('axios', () => {
  const interceptorStub = { use: vi.fn(), eject: vi.fn() }
  const instanceStub = {
    post: mockPost,
    get:  mockGet,
    interceptors: {
      request:  interceptorStub,
      response: interceptorStub,
    },
  }
  return {
    default: {
      post:        mockPost,
      get:         mockGet,
      create:      vi.fn(() => instanceStub),
      interceptors: {
        request:  interceptorStub,
        response: interceptorStub,
      },
    },
    post:   mockPost,
    get:    mockGet,
    create: vi.fn(() => instanceStub),
  }
})

// Import APRÈS les mocks
import { GoogleCallbackPage } from './GoogleCallbackPage'

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Construit un JWT factice avec les permissions données */
function fakeJwt(permissions: string[] = ['*']): string {
  const payload = Buffer.from(JSON.stringify({ userId: 'admin-id', role: 'ADMIN', permissions })).toString('base64url')
  return `header.${payload}.sig`
}

const FAKE_USER = {
  id:        'admin-id',
  email:     'admin@crm.local',
  firstName: 'Admin',
  lastName:  'CRM',
  role:      'ADMIN',
  isActive:  true,
}

/** Composants helper pour observer la navigation */
function HomePage() { return <div>Accueil</div> }
function LoginPage() {
  const loc = useLocation()
  return <div>Login — {loc.search}</div>
}

/** Monte le composant dans un MemoryRouter avec les routes nécessaires */
function renderCallbackPage(initialPath = '/auth/google/success') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/auth/google/success" element={<GoogleCallbackPage />} />
        <Route path="/"        element={<HomePage />} />
        <Route path="/login"   element={<LoginPage />} />
      </Routes>
    </MemoryRouter>
  )
}

// ── Tests ─────────────────────────────────────────────────────────────────────

const initialState = { user: null, isAuthenticated: false }

beforeEach(() => {
  vi.clearAllMocks()
  useAuthStore.setState(initialState)
  localStorage.clear()
})

describe('GoogleCallbackPage', () => {

  it('cas 1 : refresh OK + me OK → store peuplé, navigation vers /', async () => {
    const accessToken = fakeJwt(['*'])

    // Mock POST /auth/refresh → success
    mockPost.mockResolvedValueOnce({
      data: { data: { accessToken } },
    })

    // Mock GET /auth/me → user data
    mockGet.mockResolvedValueOnce({
      data: { data: FAKE_USER },
    })

    renderCallbackPage()

    // Le spinner doit s'afficher initialement
    expect(screen.getByText(/Connexion avec Google en cours/i)).toBeInTheDocument()

    // Attendre la navigation vers /
    await waitFor(() => {
      expect(screen.getByText('Accueil')).toBeInTheDocument()
    })

    // Le store doit être peuplé
    const state = useAuthStore.getState()
    expect(state.isAuthenticated).toBe(true)
    expect(state.user?.email).toBe('admin@crm.local')
    expect(state.user?.role).toBe('ADMIN')

    // L'accessToken doit être dans localStorage
    expect(localStorage.getItem('accessToken')).toBe(accessToken)
  })

  it('cas 2 : refresh KO → navigation vers /login?error=session', async () => {
    // Mock POST /auth/refresh → erreur
    mockPost.mockRejectedValueOnce(new Error('401 Unauthorized'))

    renderCallbackPage()

    // Attendre la navigation vers /login
    await waitFor(() => {
      expect(screen.getByText(/Login/i)).toBeInTheDocument()
      expect(screen.getByText(/error=session/i)).toBeInTheDocument()
    })

    // Le store ne doit pas être authentifié
    const state = useAuthStore.getState()
    expect(state.isAuthenticated).toBe(false)
    expect(state.user).toBeNull()
  })
})
