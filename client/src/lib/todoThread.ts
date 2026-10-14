import type { TodoComment, TodoDetail, TodoEvent, TodoUserRef } from '../types'

// ─── Types ──────────────────────────────────────────────────────────────────

interface ThreadItemBase {
  /** Clé React stable, unique dans le fil */
  id: string
  /** Date ISO utilisée pour le tri chronologique */
  date: string
}

/** Création de la tâche : créateur, date et description éventuelle */
export interface CreatedThreadItem extends ThreadItemBase {
  type: 'created'
  author?: TodoUserRef | null
  text?: string
}

/** Évènement système (une ligne grise) */
export interface SystemThreadItem extends ThreadItemBase {
  type: 'system'
  text: string
  author?: TodoUserRef | null
}

export interface CommentThreadItem extends ThreadItemBase {
  type: 'comment'
  comment: TodoComment
}

export type TodoThreadItem = CreatedThreadItem | SystemThreadItem | CommentThreadItem

/** Résout un identifiant utilisateur en nom complet (ou undefined si inconnu) */
export type UserNameResolver = (userId: string) => string | undefined

// ─── Libellés ───────────────────────────────────────────────────────────────

const PRIORITY_LABELS: Record<string, string> = { HIGH: 'Haute', NORMAL: 'Normale', LOW: 'Basse' }

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** "JJ/MM/AAAA" en heure locale, sans dépendance de locale pour rester stable en test */
function formatDay(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`
}

/**
 * Libellé français d'un évènement, sans le nom de l'auteur (affiché à part dans l'UI).
 * Pour `ASSIGNED`, `toValue` contient l'identifiant de l'assigné : `resolveUserName`
 * le convertit en nom, à défaut on affiche « un utilisateur ».
 */
export function eventLabel(e: TodoEvent, resolveUserName?: UserNameResolver): string {
  switch (e.type) {
    case 'CREATED': return 'a créé la tâche'
    case 'DONE': return 'a marqué terminée'
    case 'REOPENED': return 'a rouvert'
    case 'ASSIGNED': {
      const name = e.toValue ? resolveUserName?.(e.toValue) : undefined
      return `a assigné à ${name ?? 'un utilisateur'}`
    }
    case 'UNASSIGNED': return "a retiré l'assignation"
    case 'MOVED': return `a déplacé de ${e.fromValue ?? '?'} vers ${e.toValue ?? '?'}`
    case 'DUE_CHANGED': return e.toValue ? `a changé l'échéance au ${formatDay(e.toValue)}` : "a retiré l'échéance"
    case 'PRIORITY_CHANGED': return `a passé la priorité à ${(e.toValue && PRIORITY_LABELS[e.toValue]) || e.toValue || '?'}`
    default: return e.type
  }
}

// ─── Construction du fil ────────────────────────────────────────────────────

const TYPE_ORDER: Record<TodoThreadItem['type'], number> = { created: 0, system: 1, comment: 2 }

/**
 * Construit le fil chronologique d'une tâche : item `created` (créateur, date, description),
 * évènements système et commentaires. L'évènement `CREATED` n'est pas doublé avec l'item `created`.
 */
export function buildTodoThread(detail: TodoDetail, resolveUserName?: UserNameResolver): TodoThreadItem[] {
  const items: TodoThreadItem[] = []

  items.push({
    id: `created-${detail.id}`,
    type: 'created',
    date: detail.createdAt,
    author: detail.owner,
    text: detail.description?.trim() ? detail.description : undefined,
  })

  for (const e of detail.events ?? []) {
    if (e.type === 'CREATED') continue
    items.push({
      id: `event-${e.id}`,
      type: 'system',
      date: e.createdAt,
      text: eventLabel(e, resolveUserName),
      author: e.author,
    })
  }

  for (const c of detail.comments ?? []) {
    items.push({ id: `comment-${c.id}`, type: 'comment', date: c.createdAt, comment: c })
  }

  items.sort((x, y) => {
    const dx = new Date(x.date).getTime()
    const dy = new Date(y.date).getTime()
    if (dx !== dy) return dx - dy
    return TYPE_ORDER[x.type] - TYPE_ORDER[y.type]
  })

  return items
}
