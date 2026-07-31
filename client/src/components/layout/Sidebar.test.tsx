import { describe, it, expect, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { useAuthStore } from '../../store/authStore'

beforeEach(() => {
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
  localStorage.clear()
})

function renderSidebar(initialPath = '/') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Sidebar isOpen onClose={() => {}} />
    </MemoryRouter>
  )
}

describe('Sidebar — couleurs par module', () => {
  it('colore chaque icône de navigation avec la teinte de son module', () => {
    const { container } = renderSidebar()
    for (const cls of [
      'text-module-dashboard-600',
      'text-module-calls-600',
      'text-module-commercial-600',
      'text-module-agenda-600',
      'text-module-contacts-600',
      'text-module-parc-600',
      'text-module-tickets-600',
      'text-module-tools-600',
    ]) {
      expect(container.querySelector(`.${cls}`), `${cls} absent`).not.toBeNull()
    }
  })

  it('applique la teinte du module sur l’item actif', () => {
    const { container } = renderSidebar('/tickets')
    const active = container.querySelector('.bg-module-tickets-50')
    expect(active).not.toBeNull()
    expect(active!.className).toContain('text-module-tickets-700')
  })

  it('laisse Notifications et Paramètres neutres (pas de classe module)', () => {
    const { getByText } = renderSidebar()
    const notif = getByText('Notifications').closest('a')!
    expect(notif.innerHTML).not.toContain('text-module-')
  })
})
