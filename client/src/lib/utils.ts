import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { format, formatDistanceToNow, parseISO } from 'date-fns'
import { fr } from 'date-fns/locale'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDate(date: string | Date | null | undefined, fmt = 'dd/MM/yyyy') {
  if (!date) return '—'
  const d = typeof date === 'string' ? parseISO(date) : date
  return format(d, fmt, { locale: fr })
}

export function formatDateTime(date: string | Date | null | undefined) {
  return formatDate(date, 'dd/MM/yyyy HH:mm')
}

export function formatRelative(date: string | Date | null | undefined) {
  if (!date) return '—'
  const d = typeof date === 'string' ? parseISO(date) : date
  return formatDistanceToNow(d, { addSuffix: true, locale: fr })
}

const currencyFormatter = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: 0 })
const numberFormatter = new Intl.NumberFormat('fr-FR')

export function formatCurrency(amount: number | null | undefined) {
  if (amount == null) return '—'
  return currencyFormatter.format(amount)
}

export function formatNumber(n: number | null | undefined) {
  if (n == null) return '—'
  return numberFormatter.format(n)
}

export function getInitials(firstName: string, lastName: string) {
  return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase()
}

export function truncate(str: string, length = 50) {
  return str.length > length ? `${str.slice(0, length)}...` : str
}

// Status helpers
export const PIPELINE_STAGES: Record<string, { label: string; color: string }> = {
  NEW: { label: 'Nouveau', color: 'badge-gray' },
  QUALIFICATION: { label: 'Qualification', color: 'badge-blue' },
  PROPOSAL: { label: 'Proposition', color: 'badge-purple' },
  NEGOTIATION: { label: 'Négociation', color: 'badge-orange' },
  WON: { label: 'Gagné', color: 'badge-green' },
  LOST: { label: 'Perdu', color: 'badge-red' },
}

export const TICKET_STATUSES: Record<string, { label: string; color: string }> = {
  NEW: { label: 'Nouveau', color: 'badge-gray' },
  IN_PROGRESS: { label: 'En cours', color: 'badge-blue' },
  WAITING_CLIENT: { label: 'Attente client', color: 'badge-yellow' },
  RESOLVED: { label: 'Résolu', color: 'badge-green' },
  CLOSED: { label: 'Fermé', color: 'badge-gray' },
}

export const TICKET_PRIORITIES: Record<string, { label: string; color: string }> = {
  LOW: { label: 'Faible', color: 'badge-gray' },
  NORMAL: { label: 'Normal', color: 'badge-blue' },
  HIGH: { label: 'Élevé', color: 'badge-orange' },
  CRITICAL: { label: 'Critique', color: 'badge-red' },
}

export const CONTRACT_STATUSES: Record<string, { label: string; color: string }> = {
  ACTIVE: { label: 'Actif', color: 'badge-green' },
  EXPIRING_SOON: { label: 'Expire bientôt', color: 'badge-yellow' },
  EXPIRED: { label: 'Expiré', color: 'badge-red' },
  CANCELLED: { label: 'Annulé', color: 'badge-gray' },
  PENDING: { label: 'En attente', color: 'badge-blue' },
}

export const CONTRACT_TYPES: Record<string, string> = {
  IT_MAINTENANCE: 'Maintenance IT',
  CASH_REGISTER_MAINTENANCE: 'Maintenance caisses',
  WEB_HOSTING: 'Hébergement web',
  SOFTWARE_MAINTENANCE: 'Maintenance logiciel',
  FULL_SUPPORT: 'Support complet',
}

export const CONTACT_STATUSES: Record<string, { label: string; color: string }> = {
  PROSPECT: { label: 'Prospect', color: 'badge-blue' },
  CLIENT: { label: 'Client', color: 'badge-green' },
  INACTIVE: { label: 'Inactif', color: 'badge-gray' },
  LOST: { label: 'Perdu', color: 'badge-red' },
}

export const LEAD_SOURCES: Record<string, string> = {
  WEBSITE: 'Site web',
  PHONE_INBOUND: 'Appel entrant',
  EMAIL: 'Email',
  TRADE_SHOW: 'Salon',
  REFERRAL: 'Référence',
  COLD_CALL: 'Prospection',
  SOCIAL_MEDIA: 'Réseaux sociaux',
  OTHER: 'Autre',
}

export const PRODUCT_CATEGORIES: Record<string, string> = {
  CASH_REGISTER: 'Caisses enregistreuses',
  HARDWARE: 'Matériel informatique',
  SOFTWARE: 'Logiciels',
  NETWORK: 'Réseau',
  WEBSITE: 'Sites web',
  MAINTENANCE: 'Maintenance',
  TRAINING: 'Formation',
  OTHER: 'Autre',
}

export const EQUIPMENT_TYPES: Record<string, string> = {
  DESKTOP: 'PC Bureau',
  LAPTOP: 'Laptop',
  SERVER: 'Serveur',
  PRINTER: 'Imprimante',
  CASH_REGISTER: 'Caisse enregistreuse',
  SWITCH: 'Switch',
  ROUTER: 'Routeur',
  NAS: 'NAS',
  SCREEN: 'Écran',
  TABLET: 'Tablette',
  PHONE: 'Téléphone',
  OTHER: 'Autre',
}

export const TICKET_CATEGORIES: Record<string, string> = {
  HARDWARE_FAILURE: 'Panne matérielle',
  SOFTWARE_BUG: 'Bug logiciel',
  CASH_REGISTER_SAV: 'SAV Caisse',
  NETWORK: 'Réseau',
  WEBSITE: 'Site web',
  TRAINING: 'Formation',
  OTHER: 'Autre',
}

export const CALL_DIRECTIONS: Record<string, { label: string; color: string }> = {
  INBOUND:  { label: 'Entrant',  color: 'badge-blue' },
  OUTBOUND: { label: 'Sortant',  color: 'badge-purple' },
}

export const CALL_STATUSES: Record<string, { label: string; color: string }> = {
  ANSWERED:    { label: 'Décroché',   color: 'badge-green' },
  MISSED:      { label: 'Manqué',     color: 'badge-red' },
  VOICEMAIL:   { label: 'Messagerie', color: 'badge-gray' },
  IN_PROGRESS: { label: 'En cours',   color: 'badge-blue' },
}

export const CALL_CATEGORIES: Record<string, string> = {
  INCIDENT:    'Incident',
  INFORMATION: 'Renseignement',
  SUPPORT:     'Support technique',
  COMMERCIAL:  'Commercial',
  SAV:         'SAV',
  OTHER:       'Autre',
}

export const CALL_PRIORITIES: Record<string, { label: string; color: string }> = {
  LOW:    { label: 'Faible',  color: 'badge-gray' },
  NORMAL: { label: 'Normal',  color: 'badge-blue' },
  HIGH:   { label: 'Élevée',  color: 'badge-orange' },
  URGENT: { label: 'Urgent',  color: 'badge-red' },
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null) return '—'
  if (seconds < 60) return `${seconds}s`
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  if (m < 60) return s > 0 ? `${m}min ${s}s` : `${m}min`
  const h = Math.floor(m / 60)
  const rm = m % 60
  return rm > 0 ? `${h}h ${rm}min` : `${h}h`
}

export const ACTIVITY_TYPES: Record<string, { label: string; icon: string }> = {
  CALL: { label: 'Appel', icon: 'Phone' },
  EMAIL: { label: 'Email', icon: 'Mail' },
  MEETING: { label: 'Réunion', icon: 'Users' },
  NOTE: { label: 'Note', icon: 'FileText' },
  TASK: { label: 'Tâche', icon: 'CheckSquare' },
  DEMO: { label: 'Démo', icon: 'Monitor' },
  SYSTEM: { label: 'Système', icon: 'Zap' },
}

export function getScoreColor(score: number): string {
  if (score >= 70) return 'text-emerald-600'
  if (score >= 40) return 'text-amber-600'
  return 'text-red-500'
}

export function getScoreBg(score: number): string {
  if (score >= 70) return 'bg-emerald-100'
  if (score >= 40) return 'bg-amber-100'
  return 'bg-red-100'
}
