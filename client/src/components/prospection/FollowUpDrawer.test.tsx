import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { FollowUpDrawer } from './FollowUpDrawer'
import api from '../../lib/api'

vi.mock('../../lib/api', () => ({
  default: { get: vi.fn(), post: vi.fn() },
}))

const REFERENCE_DOMAINS = [
  {
    domain: 'qualification_criteria',
    label: 'Critères de qualification',
    description: '',
    validate: false,
    keyStyle: 'code' as const,
    hasColor: false,
    hasIcon: false,
    values: [
      { id: '1', key: 'NEED', label: 'Besoin identifié', color: null, icon: null, order: 1, isActive: true, isSystem: true, meta: null },
      { id: '2', key: 'DECISION_MAKER', label: 'Décideur joint', color: null, icon: null, order: 2, isActive: true, isSystem: true, meta: null },
    ],
  },
  {
    domain: 'prospect_documents',
    label: 'Documents',
    description: '',
    validate: false,
    keyStyle: 'code' as const,
    hasColor: false,
    hasIcon: false,
    values: [
      { id: '3', key: 'PLAQUETTE', label: 'Plaquette', color: null, icon: null, order: 1, isActive: true, isSystem: true, meta: null },
    ],
  },
]

const PROSPECT: Record<string, unknown> = {
  id: 'p1',
  title: 'Prospect Test',
  value: 1000,
  probability: 0,
  stage: 'NEW',
  prospectStatus: 'TODO',
  contact: { id: 'c1', firstName: 'Jean', lastName: 'Dupont', phone: '0102030405' },
  company: { id: 'co1', name: 'ACME' },
  list: { id: 'l1', name: 'Liste test' },
  qualification: undefined,
  documentsSent: undefined,
  activities: [
    { id: 'a1', type: 'NOTE', title: 'Note ajoutée', description: 'RAS', createdAt: new Date().toISOString(), user: { id: 'u1', firstName: 'Jean', lastName: 'Dupont' } },
  ],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
}

function renderDrawer(opportunityId: string | null = 'p1') {
  const qc = new QueryClient()
  return render(
    <QueryClientProvider client={qc}>
      <FollowUpDrawer open onClose={() => {}} opportunityId={opportunityId} mode="prospect" />
    </QueryClientProvider> as ReactNode,
  )
}

beforeEach(() => {
  vi.mocked(api.get).mockReset()
  vi.mocked(api.get).mockImplementation(async (url: string) => {
    if (url === '/references') return { data: { data: REFERENCE_DOMAINS } }
    if (url === '/prospection/prospects/p1') return { data: { data: PROSPECT } }
    return { data: { data: [] } }
  })
})

describe('FollowUpDrawer', () => {
  it('affiche les sections de la fiche (spec §5) une fois les données chargées', async () => {
    renderDrawer()

    expect(await screen.findByText('Prospect Test')).toBeInTheDocument()
    expect(screen.getByText('ACME')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Prochaine action' })).toBeInTheDocument()
    expect(screen.getByText('Actions rapides')).toBeInTheDocument()
    expect(screen.getByText('Qualification')).toBeInTheDocument()
    expect(screen.getByText('Documents envoyés')).toBeInTheDocument()
    expect(screen.getByText('Chronologie')).toBeInTheDocument()
  })

  it('affiche la grille de qualification à partir du référentiel qualification_criteria', async () => {
    renderDrawer()
    expect(await screen.findByText('Besoin identifié')).toBeInTheDocument()
    expect(screen.getByText('Décideur joint')).toBeInTheDocument()
  })

  it('affiche les documents du référentiel prospect_documents', async () => {
    renderDrawer()
    expect(await screen.findByText('Plaquette')).toBeInTheDocument()
  })

  it('signale l\'absence de prochaine action (ambre) quand remindAt/nextAction sont vides', async () => {
    renderDrawer()
    expect(await screen.findByText('Aucune : à planifier')).toBeInTheDocument()
  })

  it('le pied propose Qualifier en mode prospect', async () => {
    renderDrawer()
    expect(await screen.findByRole('button', { name: /qualifier/i })).toBeInTheDocument()
  })

  it('affiche un état de chargement avant la réponse serveur', () => {
    renderDrawer()
    expect(screen.getByText('Chargement…')).toBeInTheDocument()
  })
})
