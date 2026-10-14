/**
 * todoAccess.ts — règles d'accès du module Todo (spec 2026-10-14-todo-listes-partagees-design.md, §4).
 * Fonctions pures (sauf ensurePersonalList) : testées unitairement.
 */
import prisma from '../prisma/client'

export type ListAccess = 'none' | 'view' | 'edit' | 'own'

export interface TodoPerms {
  canReadAll: boolean   // permission todos:read_all
  canWriteAll: boolean  // permission todos:write_all
}

export interface AccessList {
  ownerId: string
  members?: { userId: string; role: string }[]
}

const RANK: Record<ListAccess, number> = { none: 0, view: 1, edit: 2, own: 3 }

/**
 * Niveau d'accès de userId sur une liste : le plus élevé entre propriété, rôle de membre et
 * permissions globales (un membre VIEWER qui a todos:write_all garde donc l'édition).
 */
export function listAccess(list: AccessList, userId: string, perms: TodoPerms): ListAccess {
  if (list.ownerId === userId) return 'own'
  const role = list.members?.find(m => m.userId === userId)?.role
  let best: ListAccess = 'none'
  const raise = (a: ListAccess) => { if (RANK[a] > RANK[best]) best = a }
  if (role === 'EDITOR') raise('edit')
  else if (role === 'VIEWER') raise('view')
  if (perms.canWriteAll) raise('edit')
  if (perms.canReadAll) raise('view')
  return best
}

/** access >= min ? */
export function atLeast(access: ListAccess, min: Exclude<ListAccess, 'none'>): boolean {
  return RANK[access] >= RANK[min]
}

/** Tâche visible : accès liste >= view et (non privée ou créée par l'appelant). */
export function isTodoVisible(todo: { isPrivate: boolean; ownerId: string }, access: ListAccess, userId: string): boolean {
  return atLeast(access, 'view') && (!todo.isPrivate || todo.ownerId === userId)
}

/** Tâche modifiable : accès liste >= edit et tâche visible. */
export function isTodoEditable(todo: { isPrivate: boolean; ownerId: string }, access: ListAccess, userId: string): boolean {
  return atLeast(access, 'edit') && isTodoVisible(todo, access, userId)
}

/** Crée « Mes tâches » pour l'utilisateur si elle n'existe pas encore. */
export async function ensurePersonalList(userId: string) {
  const existing = await prisma.todoList.findFirst({ where: { ownerId: userId, isPersonal: true } })
  if (existing) return existing
  return prisma.todoList.create({
    data: { name: 'Mes tâches', isPersonal: true, ownerId: userId },
  })
}
