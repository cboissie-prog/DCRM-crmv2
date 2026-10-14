import { describe, it, expect } from 'vitest'
import { listAccess, atLeast, isTodoVisible, isTodoEditable, type TodoPerms } from '../../src/services/todoAccess'

const NONE: TodoPerms = { canReadAll: false, canWriteAll: false }
const READ_ALL: TodoPerms = { canReadAll: true, canWriteAll: false }
const WRITE_ALL: TodoPerms = { canReadAll: false, canWriteAll: true }

const list = {
  ownerId: 'owner',
  members: [
    { userId: 'editor', role: 'EDITOR' },
    { userId: 'viewer', role: 'VIEWER' },
  ],
}

describe('listAccess', () => {
  it('own pour le propriétaire, même avec des membres', () => {
    expect(listAccess(list, 'owner', NONE)).toBe('own')
  })
  it('edit pour un membre EDITOR, view pour un membre VIEWER', () => {
    expect(listAccess(list, 'editor', NONE)).toBe('edit')
    expect(listAccess(list, 'viewer', NONE)).toBe('view')
  })
  it('none pour un tiers sans permission', () => {
    expect(listAccess(list, 'other', NONE)).toBe('none')
    expect(listAccess({ ownerId: 'owner' }, 'other', NONE)).toBe('none')
  })
  it('todos:read_all donne view, todos:write_all donne edit sur toute liste', () => {
    expect(listAccess(list, 'other', READ_ALL)).toBe('view')
    expect(listAccess(list, 'other', WRITE_ALL)).toBe('edit')
    expect(listAccess(list, 'other', { canReadAll: true, canWriteAll: true })).toBe('edit')
  })
  it('un membre VIEWER avec write_all obtient edit ; own prime toujours', () => {
    expect(listAccess(list, 'viewer', WRITE_ALL)).toBe('edit')
    expect(listAccess(list, 'owner', READ_ALL)).toBe('own')
  })
})

describe('atLeast', () => {
  it('compare les niveaux', () => {
    expect(atLeast('own', 'edit')).toBe(true)
    expect(atLeast('edit', 'edit')).toBe(true)
    expect(atLeast('view', 'edit')).toBe(false)
    expect(atLeast('none', 'view')).toBe(false)
  })
})

describe('visibilité et édition des tâches', () => {
  const pub = { isPrivate: false, ownerId: 'creator' }
  const priv = { isPrivate: true, ownerId: 'creator' }

  it('tâche publique visible dès view, modifiable dès edit', () => {
    expect(isTodoVisible(pub, 'view', 'x')).toBe(true)
    expect(isTodoEditable(pub, 'view', 'x')).toBe(false)
    expect(isTodoEditable(pub, 'edit', 'x')).toBe(true)
    expect(isTodoVisible(pub, 'none', 'x')).toBe(false)
  })
  it('tâche privée : visible/modifiable seulement par son créateur, même avec own/edit sur la liste', () => {
    expect(isTodoVisible(priv, 'own', 'owner')).toBe(false)
    expect(isTodoEditable(priv, 'edit', 'other')).toBe(false)
    expect(isTodoVisible(priv, 'own', 'creator')).toBe(true)
    expect(isTodoEditable(priv, 'own', 'creator')).toBe(true)
  })
})
