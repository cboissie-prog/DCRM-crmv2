import { describe, it, expect } from 'vitest'
import { buildTicketThread } from './ticketThread'
import type { TicketDetail } from '../types'

const BASE_DATE = '2026-01-01T10:00:00.000Z'

function makeTicket(overrides: Partial<TicketDetail> = {}): TicketDetail {
  return {
    id: 't1',
    reference: 'TCK-0001',
    title: 'Imprimante en panne',
    description: 'La caisse ne s\'allume plus',
    category: 'HARDWARE',
    priority: 'HIGH',
    priorityOrder: 1,
    status: 'OPEN',
    timeSpent: 0,
    createdAt: BASE_DATE,
    updatedAt: BASE_DATE,
    createdBy: { id: 'u-alice', firstName: 'Alice', lastName: 'Martin' },
    comments: [],
    events: [],
    timeEntries: [],
    attachments: [],
    appointments: [],
    ...overrides,
  }
}

function typeOf(item: { type: string; subtype?: string }): string {
  return item.type === 'system' ? `system:${item.subtype}` : item.type
}

describe('buildTicketThread', () => {
  it('place la description en premier, suivie de la note interne, à date égale', () => {
    const ticket = makeTicket({ notes: 'Client prévenu par SMS' })
    const items = buildTicketThread(ticket)
    expect(items.map(typeOf)).toEqual(['description', 'note'])
    expect(items[0]).toMatchObject({ type: 'description', text: ticket.description, author: ticket.createdBy })
    expect(items[1]).toMatchObject({ type: 'note', text: 'Client prévenu par SMS', author: ticket.createdBy })
  })

  it('omet l\'item note si ticket.notes est absent', () => {
    const items = buildTicketThread(makeTicket())
    expect(items.map(typeOf)).toEqual(['description'])
  })

  it('respecte l\'ordre fixe à date égale : description, note, event, intervention, time, attachment, comment', () => {
    const ticket = makeTicket({
      notes: 'Note interne',
      comments: [
        { id: 'c1', ticketId: 't1', content: 'Un commentaire', isInternal: false, authorName: 'Bob Technicien', createdAt: BASE_DATE },
      ],
      events: [
        { id: 'e1', ticketId: 't1', type: 'CREATED', createdAt: BASE_DATE },
        { id: 'e2', ticketId: 't1', type: 'TIME_ADDED', toValue: '99', createdAt: BASE_DATE },
      ],
      appointments: [
        {
          id: 'a1', title: 'Intervention sur site', type: 'ON_SITE',
          startAt: '2099-01-01T09:00:00.000Z', endAt: '2099-01-01T10:00:00.000Z', createdAt: BASE_DATE,
          users: [{ user: { id: 'u-carl', firstName: 'Carl', lastName: 'Dupont' } }],
        },
      ],
      timeEntries: [
        { id: 'te1', ticketId: 't1', user: { id: 'u-dana', firstName: 'Dana', lastName: 'Lefevre' }, minutes: 45, note: 'Diagnostic', createdAt: BASE_DATE },
      ],
      attachments: [
        { id: 'att1', ticketId: 't1', filename: 'photo.png', mimeType: 'image/png', size: 1200, uploadedBy: { id: 'u-eve', firstName: 'Eve', lastName: 'Nguyen' }, createdAt: BASE_DATE },
      ],
    })

    const items = buildTicketThread(ticket)

    expect(items.map(typeOf)).toEqual([
      'description',
      'note',
      'system:event',
      'system:intervention',
      'system:time',
      'system:attachment',
      'comment',
    ])
  })

  it('exclut les évènements TIME_ADDED (remplacés par les entrées de temps)', () => {
    const ticket = makeTicket({
      events: [
        { id: 'e1', ticketId: 't1', type: 'CREATED', createdAt: BASE_DATE },
        { id: 'e2', ticketId: 't1', type: 'TIME_ADDED', toValue: '30', createdAt: '2026-01-02T00:00:00.000Z' },
      ],
    })
    const items = buildTicketThread(ticket)
    const systemEvents = items.filter(i => i.type === 'system' && i.subtype === 'event')
    expect(systemEvents).toHaveLength(1)
    expect(systemEvents[0]).toMatchObject({ text: 'Ticket créé' })
  })

  it('trie par date croissante indépendamment de l\'ordre d\'insertion', () => {
    const ticket = makeTicket({
      comments: [
        { id: 'c-late', ticketId: 't1', content: 'Plus tard', isInternal: false, authorName: 'Bob', createdAt: '2026-01-05T00:00:00.000Z' },
        { id: 'c-early', ticketId: 't1', content: 'Plus tôt', isInternal: false, authorName: 'Bob', createdAt: '2026-01-02T00:00:00.000Z' },
      ],
    })
    const items = buildTicketThread(ticket)
    const dates = items.map(i => new Date(i.date).getTime())
    expect(dates).toEqual([...dates].sort((a, b) => a - b))
    expect(items.map(i => i.id)).toEqual(['description-t1', 'comment-c-early', 'comment-c-late'])
  })

  it('marque une intervention future « À venir » et une intervention passée « Passée »', () => {
    const ticket = makeTicket({
      appointments: [
        { id: 'a-future', title: 'RDV futur', type: 'ON_SITE', startAt: '2099-06-01T09:00:00.000Z', endAt: '2099-06-01T10:00:00.000Z', createdAt: BASE_DATE },
        { id: 'a-past', title: 'RDV passé', type: 'ON_SITE', startAt: '2000-06-01T09:00:00.000Z', endAt: '2000-06-01T10:00:00.000Z', createdAt: '2026-01-02T00:00:00.000Z' },
      ],
    })
    const items = buildTicketThread(ticket)
    const future = items.find(i => i.type === 'system' && i.subtype === 'intervention' && i.id === 'intervention-a-future')
    const past = items.find(i => i.type === 'system' && i.subtype === 'intervention' && i.id === 'intervention-a-past')
    expect(future).toMatchObject({ suffix: 'À venir' })
    expect(past).toMatchObject({ suffix: 'Passée' })
    expect(future?.text).toContain('RDV futur')
  })

  it('construit un item pour une pièce jointe orpheline, téléchargeable', () => {
    const attachment = { id: 'att-orphan', ticketId: 't1', filename: 'facture.pdf', mimeType: 'application/pdf', size: 4096, uploadedBy: { id: 'u-eve', firstName: 'Eve', lastName: 'Nguyen' }, createdAt: '2026-01-03T00:00:00.000Z' }
    const ticket = makeTicket({ attachments: [attachment] })
    const items = buildTicketThread(ticket)
    const item = items.find(i => i.type === 'system' && i.subtype === 'attachment')
    expect(item).toMatchObject({
      type: 'system',
      subtype: 'attachment',
      text: 'Pièce jointe ajoutée par Eve Nguyen',
      attachment,
    })
  })

  it('pièce jointe orpheline sans auteur connu : texte générique sans "par"', () => {
    const attachment = { id: 'att-anon', ticketId: 't1', filename: 'notes.txt', mimeType: 'text/plain', size: 10, createdAt: '2026-01-03T00:00:00.000Z' }
    const ticket = makeTicket({ attachments: [attachment] })
    const items = buildTicketThread(ticket)
    const item = items.find(i => i.type === 'system' && i.subtype === 'attachment')
    expect(item?.text).toBe('Pièce jointe ajoutée')
  })
})
