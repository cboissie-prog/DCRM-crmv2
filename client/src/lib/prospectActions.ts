/**
 * Catalogue des actions rapides de prospection — spec
 * docs/superpowers/specs/2026-10-08-prospection-module-design.md §4 (table) et §5 (catalogue
 * client, raccourcis de dates).
 *
 * Un seul catalogue, consommé par `ProspectActionBar` (ligne de tableau + panneau de suivi) :
 * - en mode `prospect`, les actions sont envoyées à `POST /prospection/prospects/:id/actions` ;
 * - en mode `deal` (opportunité déjà dans le pipeline), à `POST /pipeline/opportunities/:id/actions`,
 *   et `NOT_INTERESTED`/`REOPEN` sont masquées (on perd via l'étape Perdu, spec §4).
 *
 * `QUALIFICATION` (grille de qualification) et la qualification elle-même (`QualifyModal`, qui
 * appelle `POST /prospection/prospects/:id/qualify`) ne font pas partie de ce catalogue : la
 * grille a son propre composant (cases à trois états) et la qualification sa propre modale.
 */
import type { ComponentType } from 'react'
import {
  PhoneOff, PhoneCall, CalendarClock, FileText, Mail, CalendarPlus,
  StickyNote, ArrowRightCircle, XCircle, RotateCcw, Star, GitBranch, Circle,
  type LucideProps,
} from 'lucide-react'
import type { ProspectStatus } from '../types'

/** Endpoint des actions à un clic — même catalogue, deux routes selon où vit la fiche (spec §4). */
export function actionsEndpoint(mode: 'prospect' | 'deal', opportunityId: string): string {
  return mode === 'prospect'
    ? `/prospection/prospects/${opportunityId}/actions`
    : `/pipeline/opportunities/${opportunityId}/actions`
}

/** Icône par type d'`Activity` — chronologie du `FollowUpDrawer` (spec §5.5). */
export const ACTIVITY_TYPE_ICON: Record<string, ComponentType<LucideProps>> = {
  CALL_NO_ANSWER: PhoneOff,
  CALL_REACHED: PhoneCall,
  CALLBACK_SET: CalendarClock,
  DOC_SENT: FileText,
  EMAIL_SENT: Mail,
  MEETING_SET: CalendarPlus,
  NOT_INTERESTED: XCircle,
  UNREACHABLE: PhoneOff,
  QUALIFIED: Star,
  NOTE: StickyNote,
  STAGE_CHANGED: GitBranch,
  NEXT_ACTION_SET: ArrowRightCircle,
}

export function activityIcon(type: string): ComponentType<LucideProps> {
  return ACTIVITY_TYPE_ICON[type] ?? Circle
}

// ─── Raccourcis de dates (mini-formulaires « Rappeler le… », RDV, etc.) ────────

function pad(n: number) { return String(n).padStart(2, '0') }

/** Format attendu par un `<input type="datetime-local">`. */
export function toDatetimeLocal(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Dans N jours, à l'heure donnée (9h par défaut). */
export function inDays(days: number, hour = 9): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  d.setHours(hour, 0, 0, 0)
  return toDatetimeLocal(d)
}

/** Lundi prochain (si on est déjà lundi, celui de la semaine suivante), à l'heure donnée. */
export function nextMonday(hour = 9): string {
  const d = new Date()
  const day = d.getDay()
  const diff = day === 0 ? 1 : ((8 - day) % 7 || 7)
  d.setDate(d.getDate() + diff)
  d.setHours(hour, 0, 0, 0)
  return toDatetimeLocal(d)
}

/** Une date de rappel/échéance est-elle aujourd'hui ou dépassée ? */
export function isDueOrOverdue(remindAt?: string | null): boolean {
  if (!remindAt) return false
  const endOfToday = new Date()
  endOfToday.setHours(23, 59, 59, 999)
  return new Date(remindAt).getTime() <= endOfToday.getTime()
}

export interface DateShortcut {
  key: string
  label: string
  getValue: () => string
}

/** Demain · Dans 3 jours · Lundi prochain — « Date libre » reste un simple champ datetime-local côté appelant. */
export const DATE_SHORTCUTS: DateShortcut[] = [
  { key: 'tomorrow', label: 'Demain', getValue: () => inDays(1) },
  { key: 'in3days', label: 'Dans 3 jours', getValue: () => inDays(3) },
  { key: 'nextMonday', label: 'Lundi prochain', getValue: () => nextMonday() },
]

// ─── Statuts de prospection : libellés + couleurs (7 valeurs, spec §3) ─────────

export interface ProspectStatusConfig {
  label: string
  className: string
}

export const PROSPECT_STATUS_ORDER: ProspectStatus[] = [
  'TODO', 'NO_ANSWER', 'REACHED', 'CALLBACK', 'UNREACHABLE', 'NOT_INTERESTED', 'QUALIFIED',
]

export const PROSPECT_STATUS_CONFIG: Record<ProspectStatus, ProspectStatusConfig> = {
  TODO:           { label: 'À traiter',     className: 'bg-slate-100 text-slate-600 border-slate-200' },
  NO_ANSWER:      { label: 'Sans réponse',  className: 'bg-amber-50 text-amber-700 border-amber-200' },
  REACHED:        { label: 'Joint',         className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  CALLBACK:       { label: 'À rappeler',    className: 'bg-blue-50 text-blue-700 border-blue-200' },
  UNREACHABLE:    { label: 'Injoignable',   className: 'bg-orange-50 text-orange-700 border-orange-200' },
  NOT_INTERESTED: { label: 'Pas intéressé', className: 'bg-red-50 text-red-700 border-red-200' },
  QUALIFIED:      { label: 'Qualifié',      className: 'bg-violet-50 text-violet-700 border-violet-200' },
}

// ─── Catalogue des actions ──────────────────────────────────────────────────────

export type ProspectActionKey =
  | 'NO_ANSWER' | 'REACHED' | 'CALLBACK' | 'DOC_SENT' | 'EMAIL_SENT'
  | 'MEETING_SET' | 'NOTE' | 'NEXT_ACTION' | 'NOT_INTERESTED' | 'REOPEN'

export type ProspectActionFieldType = 'date' | 'text' | 'textarea' | 'select'

export interface ProspectActionField {
  key: string
  label: string
  type: ProspectActionFieldType
  required?: boolean
  /** Domaine `useReferences` à utiliser pour les options d'un champ `select` */
  refDomain?: string
  placeholder?: string
}

export interface ProspectActionValues {
  [key: string]: string | undefined
}

export interface ProspectActionDef {
  key: ProspectActionKey
  label: string
  icon: ComponentType<LucideProps>
  /** Raccourci clavier dans la ligne active (indiqué en infobulle) — N, J, R… */
  shortcut?: string
  fields: ProspectActionField[]
  /** Masquée en mode `deal` (pipeline) : on y perd via l'étape Perdu plutôt que via cette action */
  prospectOnly?: boolean
  /** N'a de sens que depuis ces statuts (ex. REOPEN depuis NOT_INTERESTED/UNREACHABLE) */
  availableFrom?: ProspectStatus[]
  /** Validation des champs du mini-formulaire — renvoie les erreurs par champ, ou null si ok */
  validate?: (values: ProspectActionValues) => Record<string, string> | null
}

function requireFields(fields: ProspectActionField[], values: ProspectActionValues): Record<string, string> | null {
  const errors: Record<string, string> = {}
  for (const f of fields) {
    if (f.required && !values[f.key]?.trim()) errors[f.key] = 'Champ requis'
  }
  return Object.keys(errors).length > 0 ? errors : null
}

export const PROSPECT_ACTIONS: ProspectActionDef[] = [
  {
    key: 'NO_ANSWER',
    label: 'Sans réponse',
    icon: PhoneOff,
    shortcut: 'N',
    fields: [],
  },
  {
    key: 'REACHED',
    label: 'Joint',
    icon: PhoneCall,
    shortcut: 'J',
    fields: [
      { key: 'nextAction', label: 'Et ensuite ?', type: 'text', required: true, placeholder: 'Envoyer un devis, rappeler le gérant…' },
      { key: 'remindAt', label: 'Prochaine action le', type: 'date', required: true },
      { key: 'note', label: 'Note', type: 'textarea' },
    ],
    validate: (v) => requireFields([
      { key: 'nextAction', label: '', type: 'text', required: true },
      { key: 'remindAt', label: '', type: 'date', required: true },
    ], v),
  },
  {
    key: 'CALLBACK',
    label: 'Rappeler le…',
    icon: CalendarClock,
    shortcut: 'R',
    fields: [
      { key: 'remindAt', label: 'Rappeler le', type: 'date', required: true },
      { key: 'nextAction', label: 'Libellé', type: 'text', placeholder: 'Rappeler après 14h…' },
    ],
    validate: (v) => requireFields([{ key: 'remindAt', label: '', type: 'date', required: true }], v),
  },
  {
    key: 'DOC_SENT',
    label: 'Doc envoyé',
    icon: FileText,
    fields: [
      { key: 'document', label: 'Document', type: 'select', required: true, refDomain: 'prospect_documents' },
    ],
    validate: (v) => requireFields([{ key: 'document', label: '', type: 'select', required: true }], v),
  },
  {
    key: 'EMAIL_SENT',
    label: 'Email envoyé',
    icon: Mail,
    fields: [
      { key: 'note', label: 'Note', type: 'textarea' },
    ],
  },
  {
    key: 'MEETING_SET',
    label: 'RDV pris',
    icon: CalendarPlus,
    fields: [
      { key: 'startAt', label: 'Date du RDV', type: 'date', required: true },
      { key: 'title', label: 'Titre', type: 'text', placeholder: 'Rendez-vous découverte…' },
    ],
    validate: (v) => requireFields([{ key: 'startAt', label: '', type: 'date', required: true }], v),
  },
  {
    key: 'NOTE',
    label: 'Note',
    icon: StickyNote,
    fields: [
      { key: 'note', label: 'Note', type: 'textarea', required: true },
    ],
    validate: (v) => requireFields([{ key: 'note', label: '', type: 'textarea', required: true }], v),
  },
  {
    key: 'NEXT_ACTION',
    label: 'Prochaine action',
    icon: ArrowRightCircle,
    fields: [
      { key: 'remindAt', label: 'Date', type: 'date', required: true },
      { key: 'nextAction', label: 'Libellé', type: 'text', required: true },
    ],
    validate: (v) => requireFields([
      { key: 'remindAt', label: '', type: 'date', required: true },
      { key: 'nextAction', label: '', type: 'text', required: true },
    ], v),
  },
  {
    key: 'NOT_INTERESTED',
    label: 'Pas intéressé',
    icon: XCircle,
    prospectOnly: true,
    fields: [
      { key: 'reason', label: 'Raison', type: 'select', required: true, refDomain: 'not_interested_reasons' },
      { key: 'note', label: 'Note', type: 'textarea' },
    ],
    validate: (v) => requireFields([{ key: 'reason', label: '', type: 'select', required: true }], v),
  },
  {
    key: 'REOPEN',
    label: 'Rouvrir',
    icon: RotateCcw,
    prospectOnly: true,
    availableFrom: ['NOT_INTERESTED', 'UNREACHABLE'],
    fields: [],
  },
]

/** Actions visibles pour un mode donné (deal = pipeline, exclut NOT_INTERESTED/REOPEN) et un statut courant. */
export function visibleActions(mode: 'prospect' | 'deal', currentStatus?: ProspectStatus): ProspectActionDef[] {
  return PROSPECT_ACTIONS.filter(a => {
    if (mode === 'deal' && a.prospectOnly) return false
    if (a.availableFrom && (!currentStatus || !a.availableFrom.includes(currentStatus))) return false
    return true
  })
}

export function getProspectAction(key: ProspectActionKey): ProspectActionDef | undefined {
  return PROSPECT_ACTIONS.find(a => a.key === key)
}
