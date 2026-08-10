import { Prisma } from '@prisma/client'
import prisma from '../prisma/client'
import logger from './logger'

/** Statuts et priorités reconnus — miroir de TICKET_STATUSES / TICKET_PRIORITIES côté client. */
export const TICKET_STATUS = ['NEW', 'IN_PROGRESS', 'WAITING_CLIENT', 'RESOLVED', 'CLOSED'] as const
export const TICKET_PRIORITY = ['LOW', 'NORMAL', 'HIGH', 'CRITICAL'] as const

/** Statuts « ouverts » : un retour vers l'un d'eux depuis RESOLVED/CLOSED est une réouverture. */
export const OPEN_STATUSES = ['NEW', 'IN_PROGRESS', 'WAITING_CLIENT'] as const

/**
 * Poids numérique de la priorité (colonne Ticket.priorityOrder) : `priority` est un String,
 * un orderBy dessus trie alphabétiquement (NORMAL avant CRITICAL).
 */
const PRIORITY_ORDER: Record<string, number> = { LOW: 0, NORMAL: 1, HIGH: 2, CRITICAL: 3 }

export function priorityOrderOf(priority: string | undefined): number {
  return PRIORITY_ORDER[priority ?? 'NORMAL'] ?? 1
}

// ─── SLA ─────────────────────────────────────────────────────────────────────

const SLA_SETTING_KEYS: Record<string, string> = {
  CRITICAL: 'slaHoursCritical',
  HIGH:     'slaHoursHigh',
  NORMAL:   'slaHoursNormal',
  LOW:      'slaHoursLow',
}

/** Valeurs par défaut (heures) — miroir des DEFAULTS de routes/settings.ts */
const SLA_DEFAULT_HOURS: Record<string, number> = { CRITICAL: 4, HIGH: 8, NORMAL: 24, LOW: 72 }

/**
 * Échéance SLA d'un ticket : date de référence + N heures selon la priorité.
 * Les heures sont paramétrables (Settings slaHours*), fallback sur les valeurs par défaut.
 */
export async function computeSlaDeadline(priority: string | undefined, from: Date = new Date()): Promise<Date> {
  const p = priority && SLA_SETTING_KEYS[priority] ? priority : 'NORMAL'
  let hours = SLA_DEFAULT_HOURS[p]
  try {
    const row = await prisma.setting.findUnique({ where: { key: SLA_SETTING_KEYS[p] } })
    const n = parseInt(row?.value ?? '', 10)
    if (!isNaN(n) && n > 0) hours = n
  } catch { /* fallback sur la valeur par défaut */ }
  return new Date(from.getTime() + hours * 60 * 60 * 1000)
}

// ─── Référence ───────────────────────────────────────────────────────────────

/**
 * Référence TKT-<année>-<n° zero-padded>, calculée depuis la dernière référence de l'année.
 * Un simple count() redescend après une suppression et produit des doublons.
 */
export async function generateTicketRef(tx: Prisma.TransactionClient): Promise<string> {
  const year = new Date().getFullYear()
  const prefix = `TKT-${year}-`
  const last = await tx.ticket.findFirst({
    where: { reference: { startsWith: prefix } },
    orderBy: { reference: 'desc' },
    select: { reference: true },
  })
  const lastNum = last ? parseInt(last.reference.slice(prefix.length), 10) : 0
  return `${prefix}${String((isNaN(lastNum) ? 0 : lastNum) + 1).padStart(4, '0')}`
}

// ─── Transitions de statut ───────────────────────────────────────────────────

/**
 * Données de mise à jour pour une transition de statut : pose resolvedAt/closedAt à
 * l'entrée dans RESOLVED/CLOSED, les remet à null en cas de réouverture.
 * Retourne aussi si la transition est une réouverture (pour l'historique).
 */
export function statusTransitionData(prev: string, next: string): { data: Record<string, unknown>; reopened: boolean } {
  const data: Record<string, unknown> = { status: next }
  const wasTerminal = prev === 'RESOLVED' || prev === 'CLOSED'
  const reopened = wasTerminal && (OPEN_STATUSES as readonly string[]).includes(next)
  if (next === 'RESOLVED' && prev !== 'RESOLVED') data.resolvedAt = new Date()
  if (next === 'CLOSED' && prev !== 'CLOSED') data.closedAt = new Date()
  if (reopened) { data.resolvedAt = null; data.closedAt = null }
  if (next === 'RESOLVED' && prev === 'CLOSED') data.closedAt = null
  return { data, reopened }
}

// ─── Historique ──────────────────────────────────────────────────────────────

/**
 * Trace un évènement dans l'historique du ticket. Best-effort : une erreur est loguée
 * mais ne fait jamais échouer l'opération principale (déjà validée en base).
 */
export async function logTicketEvent(params: {
  ticketId: string
  type: 'CREATED' | 'STATUS_CHANGED' | 'PRIORITY_CHANGED' | 'ASSIGNED' | 'UNASSIGNED' | 'REOPENED' | 'TIME_ADDED' | 'ATTACHMENT_ADDED' | 'NPS_RECEIVED'
  authorId?: string | null
  fromValue?: string | null
  toValue?: string | null
}): Promise<void> {
  try {
    await prisma.ticketEvent.create({
      data: {
        ticketId:  params.ticketId,
        type:      params.type,
        authorId:  params.authorId ?? null,
        fromValue: params.fromValue ?? null,
        toValue:   params.toValue ?? null,
      },
    })
  } catch (err) {
    logger.error({ err, ticketId: params.ticketId, type: params.type }, 'Échec de l\'écriture de l\'historique ticket')
  }
}

// ─── Notifications ───────────────────────────────────────────────────────────

/** Crée une notification pour chaque utilisateur (dédupliqués). Best-effort. */
export async function notifyUsers(userIds: (string | null | undefined)[], notif: {
  type: string
  title: string
  message: string
  link: string
}): Promise<void> {
  const unique = [...new Set(userIds.filter((id): id is string => !!id))]
  if (unique.length === 0) return
  try {
    await prisma.notification.createMany({
      data: unique.map(userId => ({ userId, ...notif })),
    })
  } catch (err) {
    logger.error({ err, type: notif.type }, 'Échec de la création des notifications ticket')
  }
}

/** IDs des ADMIN / MANAGER actifs (destinataires des alertes tickets critiques). */
export async function activeManagerIds(): Promise<string[]> {
  const users = await prisma.user.findMany({
    where: { role: { in: ['ADMIN', 'MANAGER'] }, isActive: true },
    select: { id: true },
  })
  return users.map(u => u.id)
}
