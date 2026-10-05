import type { TicketAttachment, TicketDetail, TicketEvent } from '../types'
import { formatTime, TICKET_PRIORITIES, TICKET_STATUSES } from './utils'

// ─── Types ──────────────────────────────────────────────────────────────────

export type ThreadItemType = 'description' | 'note' | 'comment' | 'system'
export type SystemThreadSubtype = 'event' | 'intervention' | 'time' | 'attachment'

interface ThreadItemBase {
  /** Clé React stable, unique dans le fil */
  id: string
  /** Date ISO utilisée pour le tri chronologique */
  date: string
}

export interface DescriptionThreadItem extends ThreadItemBase {
  type: 'description'
  text: string
  author?: { firstName: string; lastName: string }
}

export interface NoteThreadItem extends ThreadItemBase {
  type: 'note'
  text: string
  author?: { firstName: string; lastName: string }
}

export interface CommentThreadItem extends ThreadItemBase {
  type: 'comment'
  comment: TicketDetail['comments'][number]
}

export interface SystemThreadItem extends ThreadItemBase {
  type: 'system'
  subtype: SystemThreadSubtype
  text: string
  /** Classe Tailwind du point coloré (ex. "bg-indigo-400") */
  dotColor: string
  author?: { firstName: string; lastName: string }
  /** Présent uniquement pour subtype === 'attachment' : permet le téléchargement/la suppression */
  attachment?: TicketAttachment
  /** Présent uniquement pour subtype === 'intervention' : "À venir" ou "Passée" */
  suffix?: string
}

export type ThreadItem = DescriptionThreadItem | NoteThreadItem | CommentThreadItem | SystemThreadItem

// ─── Libellés ───────────────────────────────────────────────────────────────

/** Libellé français d'un évènement d'historique */
function eventLabel(e: TicketEvent): string {
  const s = (k?: string) => (k ? TICKET_STATUSES[k]?.label ?? k : '')
  const p = (k?: string) => (k ? TICKET_PRIORITIES[k]?.label ?? k : '')
  switch (e.type) {
    case 'CREATED': return 'Ticket créé'
    case 'STATUS_CHANGED': return `Statut : ${s(e.fromValue)} → ${s(e.toValue)}`
    case 'REOPENED': return `Ticket réouvert (${s(e.fromValue)} → ${s(e.toValue)})`
    case 'PRIORITY_CHANGED': return `Priorité : ${p(e.fromValue)} → ${p(e.toValue)}`
    case 'ASSIGNED': return `Assigné à ${e.toValue ?? '?'}`
    case 'UNASSIGNED': return 'Assignation retirée'
    case 'TIME_ADDED': return `Temps ajouté : ${formatTime(parseInt(e.toValue ?? '0', 10) || 0)}`
    case 'ATTACHMENT_ADDED': return `Pièce jointe ajoutée : ${e.toValue ?? ''}`
    case 'NPS_RECEIVED': return `Avis client reçu : ${e.toValue}/10`
    default: return e.type
  }
}

function eventDotColor(e: TicketEvent): string {
  switch (e.type) {
    case 'CREATED': return 'bg-indigo-400'
    case 'REOPENED': return 'bg-orange-400'
    case 'NPS_RECEIVED': return 'bg-amber-400'
    default: return 'bg-slate-300'
  }
}

function fullName(u?: { firstName: string; lastName: string } | null): string {
  return u ? `${u.firstName} ${u.lastName}` : 'Inconnu'
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** "JJ/MM/AAAA à HH:MM", sans dépendance de locale pour rester stable en test */
function formatDayTime(iso: string): string {
  const d = new Date(iso)
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()} à ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

// ─── Ordre de tri à date égale ──────────────────────────────────────────────

const TYPE_ORDER: Record<string, number> = {
  description: 0,
  note: 1,
  'system:event': 2,
  'system:intervention': 3,
  'system:time': 4,
  'system:attachment': 5,
  comment: 6,
}

function orderKey(item: ThreadItem): number {
  return item.type === 'system' ? TYPE_ORDER[`system:${item.subtype}`] : TYPE_ORDER[item.type]
}

// ─── Construction du fil ────────────────────────────────────────────────────

/**
 * Construit le fil chronologique unique d'un ticket : description, note interne,
 * commentaires (avec pièces jointes), évènements système, interventions planifiées,
 * temps ajoutés et pièces jointes orphelines.
 *
 * `TIME_ADDED` est exclu des évènements système : il est remplacé par les entrées
 * de `ticket.timeEntries`, qui portent l'information (auteur, durée, note).
 */
export function buildTicketThread(ticket: TicketDetail): ThreadItem[] {
  const items: ThreadItem[] = []

  items.push({
    id: `description-${ticket.id}`,
    type: 'description',
    date: ticket.createdAt,
    text: ticket.description,
    author: ticket.createdBy,
  })

  if (ticket.notes) {
    items.push({
      id: `note-${ticket.id}`,
      type: 'note',
      date: ticket.createdAt,
      text: ticket.notes,
      author: ticket.createdBy,
    })
  }

  for (const c of ticket.comments ?? []) {
    items.push({
      id: `comment-${c.id}`,
      type: 'comment',
      date: c.createdAt,
      comment: c,
    })
  }

  for (const e of ticket.events ?? []) {
    if (e.type === 'TIME_ADDED') continue
    items.push({
      id: `event-${e.id}`,
      type: 'system',
      subtype: 'event',
      date: e.createdAt,
      text: eventLabel(e),
      dotColor: eventDotColor(e),
      author: e.author,
    })
  }

  for (const a of ticket.appointments ?? []) {
    const upcoming = new Date(a.startAt).getTime() > Date.now()
    const people = a.users && a.users.length > 0
      ? ` · ${a.users.map(u => fullName(u.user)).join(', ')}`
      : ''
    items.push({
      id: `intervention-${a.id}`,
      type: 'system',
      subtype: 'intervention',
      date: a.createdAt,
      text: `Intervention planifiée le ${formatDayTime(a.startAt)} · ${a.title}${people}`,
      dotColor: 'bg-violet-400',
      suffix: upcoming ? 'À venir' : 'Passée',
    })
  }

  for (const t of ticket.timeEntries ?? []) {
    items.push({
      id: `time-${t.id}`,
      type: 'system',
      subtype: 'time',
      date: t.createdAt,
      text: `${fullName(t.user)} a ajouté ${formatTime(t.minutes)}${t.note ? ` · ${t.note}` : ''}`,
      dotColor: 'bg-slate-400',
      author: t.user,
    })
  }

  for (const a of ticket.attachments ?? []) {
    items.push({
      id: `attachment-${a.id}`,
      type: 'system',
      subtype: 'attachment',
      date: a.createdAt,
      text: a.uploadedBy ? `Pièce jointe ajoutée par ${fullName(a.uploadedBy)}` : 'Pièce jointe ajoutée',
      dotColor: 'bg-slate-300',
      author: a.uploadedBy,
      attachment: a,
    })
  }

  items.sort((x, y) => {
    const dx = new Date(x.date).getTime()
    const dy = new Date(y.date).getTime()
    if (dx !== dy) return dx - dy
    return orderKey(x) - orderKey(y)
  })

  return items
}
