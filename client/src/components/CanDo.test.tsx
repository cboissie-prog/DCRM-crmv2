import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CanDo } from './CanDo'
import { useAuthStore } from '../store/authStore'

const initialState = {
  user: null,
  isAuthenticated: false,
}

beforeEach(() => {
  useAuthStore.setState(initialState)
  localStorage.clear()
})

describe('CanDo', () => {
  it('affiche les enfants si la permission est présente', () => {
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

    render(<CanDo permission="contacts:read"><span>Contenu protégé</span></CanDo>)
    expect(screen.getByText('Contenu protégé')).toBeInTheDocument()
  })

  it('affiche le fallback si la permission est absente', () => {
    useAuthStore.setState({
      user: {
        id: '2',
        email: 'user@test.com',
        firstName: 'User',
        lastName: 'Test',
        role: 'COMMERCIAL',
        isActive: true,
        permissions: ['companies:read'],
      },
      isAuthenticated: true,
    })

    render(
      <CanDo permission="contacts:read" fallback={<span>Accès refusé</span>}>
        <span>Contenu protégé</span>
      </CanDo>
    )
    expect(screen.queryByText('Contenu protégé')).not.toBeInTheDocument()
    expect(screen.getByText('Accès refusé')).toBeInTheDocument()
  })

  it('affiche null (pas de fallback) si permission absente et pas de fallback fourni', () => {
    useAuthStore.setState({
      user: {
        id: '3',
        email: 'user@test.com',
        firstName: 'User',
        lastName: 'Test',
        role: 'COMMERCIAL',
        isActive: true,
        permissions: [],
      },
      isAuthenticated: true,
    })

    const { container } = render(
      <CanDo permission="contacts:read">
        <span>Contenu protégé</span>
      </CanDo>
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('affiche toujours les enfants pour un ADMIN', () => {
    useAuthStore.setState({
      user: {
        id: '4',
        email: 'admin@test.com',
        firstName: 'Admin',
        lastName: 'Test',
        role: 'ADMIN',
        isActive: true,
        permissions: [],
      },
      isAuthenticated: true,
    })

    render(
      <CanDo permission="users:delete" fallback={<span>Refusé</span>}>
        <span>Action admin</span>
      </CanDo>
    )
    expect(screen.getByText('Action admin')).toBeInTheDocument()
    expect(screen.queryByText('Refusé')).not.toBeInTheDocument()
  })
})
