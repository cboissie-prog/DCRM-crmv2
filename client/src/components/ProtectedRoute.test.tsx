import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ProtectedRoute } from './ProtectedRoute'
import { useAuthStore } from '../store/authStore'

const initialState = {
  user: null,
  isAuthenticated: false,
}

beforeEach(() => {
  useAuthStore.setState(initialState)
  localStorage.clear()
})

// Composant enfant fictif pour tester que l'Outlet est rendu
function ChildPage() {
  return <div>Contenu enfant</div>
}

function LoginPage() {
  return <div>Page de login</div>
}

describe('ProtectedRoute', () => {
  it('redirige vers /login si non authentifié', () => {
    // user=null, isAuthenticated=false (état initial)
    render(
      <MemoryRouter initialEntries={['/protected']}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<ProtectedRoute />}>
            <Route path="/protected" element={<ChildPage />} />
          </Route>
        </Routes>
      </MemoryRouter>
    )

    expect(screen.getByText('Page de login')).toBeInTheDocument()
    expect(screen.queryByText('Contenu enfant')).not.toBeInTheDocument()
  })

  it('affiche « Accès refusé » si authentifié sans la permission requise', () => {
    useAuthStore.setState({
      user: {
        id: '1',
        email: 'user@test.com',
        firstName: 'User',
        lastName: 'Test',
        role: 'COMMERCIAL',
        isActive: true,
        permissions: ['contacts:read'],
      },
      isAuthenticated: true,
    })

    render(
      <MemoryRouter initialEntries={['/admin']}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<ProtectedRoute permission="users:read" />}>
            <Route path="/admin" element={<ChildPage />} />
          </Route>
        </Routes>
      </MemoryRouter>
    )

    expect(screen.getByText('Accès refusé')).toBeInTheDocument()
    expect(screen.queryByText('Contenu enfant')).not.toBeInTheDocument()
  })

  it('rend l\'enfant (Outlet) si authentifié avec la permission', () => {
    useAuthStore.setState({
      user: {
        id: '2',
        email: 'user@test.com',
        firstName: 'User',
        lastName: 'Test',
        role: 'COMMERCIAL',
        isActive: true,
        permissions: ['contacts:read'],
      },
      isAuthenticated: true,
    })

    render(
      <MemoryRouter initialEntries={['/contacts']}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<ProtectedRoute permission="contacts:read" />}>
            <Route path="/contacts" element={<ChildPage />} />
          </Route>
        </Routes>
      </MemoryRouter>
    )

    expect(screen.getByText('Contenu enfant')).toBeInTheDocument()
    expect(screen.queryByText('Page de login')).not.toBeInTheDocument()
  })

  it('rend l\'enfant sans vérification de permission si aucune permission requise', () => {
    useAuthStore.setState({
      user: {
        id: '3',
        email: 'user@test.com',
        firstName: 'User',
        lastName: 'Test',
        role: 'TECHNICIEN',
        isActive: true,
        permissions: [],
      },
      isAuthenticated: true,
    })

    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<ProtectedRoute />}>
            <Route path="/dashboard" element={<ChildPage />} />
          </Route>
        </Routes>
      </MemoryRouter>
    )

    expect(screen.getByText('Contenu enfant')).toBeInTheDocument()
  })
})
