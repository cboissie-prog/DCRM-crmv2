import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { EntityPicker } from './EntityPicker'
import { useAuthStore } from '../../store/authStore'
import api from '../../lib/api'

vi.mock('../../lib/api', () => ({
  default: { get: vi.fn(), post: vi.fn() },
}))

// Les mini-modales de création sont mockées : EntityPicker ne doit tester que
// son propre câblage (recherche, permission, invalidation, onChange après
// onCreated), pas le contenu de chaque formulaire de création.
vi.mock('./quick-create/QuickCompanyModal', () => ({
  QuickCompanyModal: ({ open, onCreated }: { open: boolean; onCreated: (o: { id: string; label: string }) => void }) =>
    open ? (
      <button type="button" onClick={() => onCreated({ id: 'new-company-id', label: 'Nouvelle entreprise' })}>
        __confirm-create-company__
      </button>
    ) : null,
}))
vi.mock('./quick-create/QuickContactModal', () => ({
  QuickContactModal: () => null,
}))
vi.mock('./quick-create/QuickEquipmentModal', () => ({
  QuickEquipmentModal: () => null,
}))
vi.mock('./quick-create/QuickContractModal', () => ({
  QuickContractModal: () => null,
}))
vi.mock('./quick-create/QuickProductModal', () => ({
  QuickProductModal: () => null,
}))

function renderWithQueryClient(children: ReactNode) {
  const qc = new QueryClient()
  return render(<QueryClientProvider client={qc}>{children}</QueryClientProvider>)
}

function setAuthUser(permissions: string[]) {
  useAuthStore.setState({
    user: {
      id: 'u1',
      email: 'user@test.com',
      firstName: 'User',
      lastName: 'Test',
      role: 'COMMERCIAL',
      isActive: true,
      permissions,
    },
    isAuthenticated: true,
  })
}

beforeEach(() => {
  useAuthStore.setState({ user: null, isAuthenticated: false })
  localStorage.clear()
  vi.mocked(api.get).mockReset()
  vi.mocked(api.post).mockReset()
  vi.mocked(api.get).mockResolvedValue({ data: { data: [], meta: { total: 0, page: 1, limit: 20 } } })
})

describe('EntityPicker', () => {
  it('appelle la recherche sur la bonne ressource avec search et companyId du contexte', async () => {
    setAuthUser(['contacts:read'])
    renderWithQueryClient(
      <EntityPicker entity="contact" value={null} onChange={() => {}} context={{ companyId: 'company-1' }} />
    )

    // Ouvre le combobox (bouton fermé affichant le placeholder)
    fireEvent.click(screen.getByText('Rechercher un contact…'))
    const input = await screen.findByPlaceholderText('Rechercher un contact…')
    fireEvent.change(input, { target: { value: 'Jean' } })

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith('/contacts', {
        params: { search: 'Jean', limit: 20, companyId: 'company-1' },
      })
    })
  })

  it("masque le bouton « Créer » sans la permission requise", () => {
    setAuthUser(['companies:read'])
    renderWithQueryClient(<EntityPicker entity="company" value={null} onChange={() => {}} />)
    expect(screen.queryByRole('button', { name: /créer/i })).not.toBeInTheDocument()
  })

  it("affiche le bouton « Créer » avec la permission companies:create", () => {
    setAuthUser(['companies:create'])
    renderWithQueryClient(<EntityPicker entity="company" value={null} onChange={() => {}} />)
    expect(screen.getByRole('button', { name: /créer/i })).toBeInTheDocument()
  })

  it('appelle onChange avec l\'entité créée après onCreated', async () => {
    setAuthUser(['companies:create'])
    const handleChange = vi.fn()
    renderWithQueryClient(<EntityPicker entity="company" value={null} onChange={handleChange} />)

    fireEvent.click(screen.getByRole('button', { name: /créer/i }))
    const confirmBtn = await screen.findByText('__confirm-create-company__')
    fireEvent.click(confirmBtn)

    expect(handleChange).toHaveBeenCalledWith('new-company-id', { id: 'new-company-id', label: 'Nouvelle entreprise' })
  })
})
