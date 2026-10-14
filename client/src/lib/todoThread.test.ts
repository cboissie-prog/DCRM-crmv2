import { describe, it, expect } from 'vitest'
import { buildTodoThread, eventLabel } from './todoThread'
import type { TodoDetail, TodoEvent } from '../types'

const BASE_DATE = '2026-10-01T10:00:00.000Z'
const alice = { id: 'u-alice', firstName: 'Alice', lastName: 'Martin' }

function makeTodo(overrides: Partial<TodoDetail> = {}): TodoDetail {
  return {
    id: 'td1',
    title: 'Appeler le client',
    priority: 'NORMAL',
    isDone: false,
    isPrivate: false,
    ownerId: alice.id,
    owner: alice,
    listId: 'l1',
    commentCount: 0,
    canEdit: true,
    createdAt: BASE_DATE,
    updatedAt: BASE_DATE,
    list: { id: 'l1', name: 'Équipe', isPersonal: false },
    comments: [],
    events: [],
    ...overrides,
  }
}

function makeEvent(overrides: Partial<TodoEvent>): TodoEvent {
  return { id: 'e1', type: 'DONE', createdAt: BASE_DATE, ...overrides }
}

describe('buildTodoThread', () => {
  it("commence par l'item created avec créateur et description", () => {
    const items = buildTodoThread(makeTodo({ description: 'Rappeler avant vendredi' }))
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ type: 'created', author: alice, text: 'Rappeler avant vendredi' })
  })

  it("omet le texte de l'item created sans description", () => {
    const items = buildTodoThread(makeTodo())
    expect(items[0]).toMatchObject({ type: 'created', text: undefined })
  })

  it("ne double pas l'évènement CREATED avec l'item created", () => {
    const items = buildTodoThread(makeTodo({ events: [makeEvent({ id: 'c', type: 'CREATED' })] }))
    expect(items.map(i => i.type)).toEqual(['created'])
  })

  it('trie commentaires et évènements par date croissante', () => {
    const items = buildTodoThread(makeTodo({
      events: [makeEvent({ id: 'e2', type: 'DONE', createdAt: '2026-10-03T10:00:00.000Z' })],
      comments: [
        { id: 'c2', content: 'Fait', authorName: 'Alice Martin', createdAt: '2026-10-04T10:00:00.000Z' },
        { id: 'c1', content: 'En cours', authorName: 'Alice Martin', createdAt: '2026-10-02T10:00:00.000Z' },
      ],
    }))
    expect(items.map(i => i.id)).toEqual(['created-td1', 'comment-c1', 'event-e2', 'comment-c2'])
  })

  it('à date égale : created, puis système, puis commentaire', () => {
    const items = buildTodoThread(makeTodo({
      events: [makeEvent({ id: 'e1', type: 'DONE' })],
      comments: [{ id: 'c1', content: 'Ok', authorName: 'Alice Martin', createdAt: BASE_DATE }],
    }))
    expect(items.map(i => i.type)).toEqual(['created', 'system', 'comment'])
  })

  it("résout le nom de l'assigné via le résolveur", () => {
    const items = buildTodoThread(
      makeTodo({ events: [makeEvent({ type: 'ASSIGNED', toValue: 'u-bob', createdAt: '2026-10-02T10:00:00.000Z' })] }),
      id => (id === 'u-bob' ? 'Bob Durand' : undefined),
    )
    expect(items[1]).toMatchObject({ type: 'system', text: 'a assigné à Bob Durand' })
  })
})

describe('eventLabel', () => {
  it('couvre les évènements simples', () => {
    expect(eventLabel(makeEvent({ type: 'DONE' }))).toBe('a marqué terminée')
    expect(eventLabel(makeEvent({ type: 'REOPENED' }))).toBe('a rouvert')
    expect(eventLabel(makeEvent({ type: 'UNASSIGNED' }))).toBe("a retiré l'assignation")
  })

  it('assignation avec nom inconnu', () => {
    expect(eventLabel(makeEvent({ type: 'ASSIGNED', toValue: 'x' }))).toBe('a assigné à un utilisateur')
  })

  it('déplacement entre listes', () => {
    expect(eventLabel(makeEvent({ type: 'MOVED', fromValue: 'Mes tâches', toValue: 'Équipe' })))
      .toBe('a déplacé de Mes tâches vers Équipe')
  })

  it("changement et retrait d'échéance", () => {
    const iso = new Date(2026, 9, 15, 0, 0, 0).toISOString()
    expect(eventLabel(makeEvent({ type: 'DUE_CHANGED', toValue: iso }))).toBe("a changé l'échéance au 15/10/2026")
    expect(eventLabel(makeEvent({ type: 'DUE_CHANGED', toValue: null }))).toBe("a retiré l'échéance")
  })

  it('changement de priorité', () => {
    expect(eventLabel(makeEvent({ type: 'PRIORITY_CHANGED', toValue: 'HIGH' }))).toBe('a passé la priorité à Haute')
    expect(eventLabel(makeEvent({ type: 'PRIORITY_CHANGED', toValue: 'LOW' }))).toBe('a passé la priorité à Basse')
  })

  it('type inconnu : renvoie le type brut', () => {
    expect(eventLabel(makeEvent({ type: 'WHATEVER' }))).toBe('WHATEVER')
  })
})
