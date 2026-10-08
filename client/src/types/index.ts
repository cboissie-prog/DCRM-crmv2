export interface PaginatedResponse<T> {
  success: boolean
  data: T[]
  meta: { total: number; page: number; limit: number }
}

export interface User {
  id: string
  email: string
  firstName: string
  lastName: string
  phone?: string
  avatar?: string
  role: string
  isActive: boolean
  createdAt: string
}

export interface Company {
  id: string
  name: string
  siret?: string
  vatNumber?: string
  website?: string
  sector?: string
  employees?: number
  annualRevenue?: number
  billingAddress?: string
  city?: string
  postalCode?: string
  country: string
  lat?: number
  lng?: number
  notes?: string
  tags?: string
  isActive: boolean
  createdAt: string
  updatedAt: string
  _count?: { contacts: number; tickets: number; contracts: number; opportunities: number }
}

export interface Contact {
  id: string
  firstName: string
  lastName: string
  email?: string
  phone?: string
  mobile?: string
  position?: string
  companyId?: string
  company?: { id: string; name: string }
  source: string
  status: string
  tags?: string
  notes?: string
  leadScore: number
  isActive: boolean
  createdAt: string
  updatedAt: string
}

/**
 * Statut de prospection. `UNREACHABLE` (injoignable, au-delà de `prospectMaxAttempts`),
 * `NOT_INTERESTED` (écarté, avec `lostReason`) et `QUALIFIED` (passé dans le pipeline) ont
 * été ajoutés par le module Prospection — voir
 * docs/superpowers/specs/2026-10-08-prospection-module-design.md §3.
 */
export type ProspectStatus = 'TODO' | 'NO_ANSWER' | 'REACHED' | 'CALLBACK' | 'UNREACHABLE' | 'NOT_INTERESTED' | 'QUALIFIED'

/** Alerte calculée côté serveur sur une opportunité du pipeline (GET /pipeline/opportunities). */
export type OpportunityAlert = 'NO_NEXT_ACTION' | 'STALE' | null

export interface Opportunity {
  id: string
  title: string
  contactId?: string
  contact?: { id: string; firstName: string; lastName: string; phone?: string; mobile?: string; email?: string }
  companyId?: string
  company?: { id: string; name: string }
  pipelineId?: string | null
  stage: string
  value: number
  probability: number
  expectedCloseDate?: string
  closedAt?: string
  archivedAt?: string
  lostReason?: string
  assignedToId?: string
  assignedTo?: { id: string; firstName: string; lastName: string; avatar?: string }
  notes?: string
  tags?: string
  remindAt?: string
  /** Référentiel `lead_source` — origine du prospect/de l'opportunité */
  source?: string
  /** Statut de prospection : À traiter · Sans réponse · Joint · À rappeler · Injoignable · Pas intéressé · Qualifié */
  prospectStatus?: ProspectStatus
  /** Dernier clic Appelé sans réponse / Joint */
  lastContactedAt?: string
  /** Nombre de tentatives d'appel (incrémenté par PATCH /prospect ou action NO_ANSWER/REACHED) */
  callAttempts?: number
  /** Note courte libre : « rappeler le gérant, absent le lundi » */
  nextAction?: string
  /** Liste de prospection d'origine (module Prospection), conservée après qualification */
  listId?: string
  list?: { id: string; name: string; pipelineId?: string }
  /** JSON `{ "<clé qualification_criteria>": true|false|null }` — grille de qualification */
  qualification?: string
  /** JSON `string[]` — clés du référentiel `prospect_documents` déjà envoyées */
  documentsSent?: string
  /** Date de passage dans le pipeline (action QUALIFICATION/qualify) */
  qualifiedAt?: string
  /** Dernière `Activity` liée — tenu par le serveur à chaque action */
  lastActivityAt?: string
  /** Calculé par GET /pipeline/opportunities : sans prochaine action / sans activité récente */
  alert?: OpportunityAlert
  /** Présent sur GET /prospection/prospects/:id et GET /pipeline/opportunities/:id (fiche détaillée) */
  activities?: Activity[]
  appointments?: Appointment[]
  createdAt: string
  updatedAt: string
}

/** Compteurs par liste — renvoyés par GET /prospection/lists */
export interface ProspectListCounts {
  total: number
  todo: number
  contacted: number
  callback: number
  qualified: number
  rejected: number
  unreachable: number
}

/** Liste de prospection (module Prospection) — voir spec §3 `ProspectList`. */
export interface ProspectList {
  id: string
  name: string
  description?: string
  /** Référentiel `lead_source`, appliqué par défaut aux prospects importés dans la liste */
  source: string
  /** Pipeline par défaut à la qualification (défaut serveur : pipeline `isDefault`) */
  pipelineId?: string
  pipeline?: { id: string; name: string }
  /** Commercial par défaut des prospects de la liste */
  assignedToId?: string
  assignedTo?: { id: string; firstName: string; lastName: string }
  status: 'ACTIVE' | 'ARCHIVED'
  createdById?: string
  createdBy?: { id: string; firstName: string; lastName: string }
  createdAt: string
  updatedAt: string
  counts?: ProspectListCounts
}

/** Une ligne du tableau de suivi par commercial (GET /prospection/stats) */
export interface ProspectionStatsRow {
  userId: string
  firstName: string
  lastName: string
  calls: number
  reached: number
  callbacks: number
  docsSent: number
  meetings: number
  qualified: number
  rejected: number
}

export interface Product {
  id: string
  reference?: string
  name: string
  description?: string
  category: string
  type: string
  price: number
  vatRate: number
  unit: string
  stock?: number
  supplier?: string
  imageUrl?: string
  isActive: boolean
  createdAt: string
}

export interface Contract {
  id: string
  reference: string
  companyId: string
  company?: { id: string; name: string }
  type: string
  title: string
  description?: string
  status: string
  startDate: string
  endDate: string
  renewalDate?: string
  monthlyAmount: number
  annualAmount: number
  slaResponseTime?: number
  slaWorkingHours?: string
  autoRenewal: boolean
  notes?: string
  createdAt: string
  _count?: { tickets: number; equipments: number }
}

export interface Ticket {
  id: string
  reference: string
  title: string
  description: string
  category: string
  priority: string
  priorityOrder: number
  status: string
  contactId?: string
  contact?: { id: string; firstName: string; lastName: string }
  companyId?: string
  company?: { id: string; name: string }
  contractId?: string
  equipmentId?: string
  equipment?: { id: string; type: string; brand?: string; model?: string }
  assignedToId?: string
  assignedTo?: { id: string; firstName: string; lastName: string; avatar?: string }
  slaDeadline?: string
  resolvedAt?: string
  closedAt?: string
  timeSpent: number
  notes?: string
  createdAt: string
  updatedAt: string
  _count?: { comments: number; attachments?: number }
}

export interface TicketComment {
  id: string
  ticketId: string
  content: string
  isInternal: boolean
  authorId?: string
  authorName: string
  createdAt: string
  /** Pièces jointes rattachées à ce commentaire (0 à 5, voir ALLOWED_ATTACHMENT_MIMES côté serveur) */
  attachments?: TicketAttachment[]
}

export interface TicketEvent {
  id: string
  ticketId: string
  type: string
  author?: { id: string; firstName: string; lastName: string }
  fromValue?: string
  toValue?: string
  createdAt: string
}

export interface TicketTimeEntry {
  id: string
  ticketId: string
  user?: { id: string; firstName: string; lastName: string }
  minutes: number
  note?: string
  createdAt: string
}

export interface TicketAttachment {
  id: string
  ticketId: string
  filename: string
  mimeType: string
  size: number
  uploadedBy?: { id: string; firstName: string; lastName: string }
  createdAt: string
}

export interface TicketAppointment {
  id: string
  title: string
  type: string
  startAt: string
  endAt: string
  createdAt: string
  users?: { user: { id: string; firstName: string; lastName: string } }[]
}

/** Détail complet d'un ticket (GET /tickets/:id) */
export interface TicketDetail extends Ticket {
  comments: TicketComment[]
  events: TicketEvent[]
  timeEntries: TicketTimeEntry[]
  /** Pièces jointes orphelines (sans commentId, héritage pré-fil unique) */
  attachments: TicketAttachment[]
  appointments: TicketAppointment[]
  npsResponse?: { id: string; score: number; comment?: string; createdAt: string }
  createdBy?: { id: string; firstName: string; lastName: string }
}

export interface Equipment {
  id: string
  companyId: string
  company?: { id: string; name: string }
  contractId?: string
  contract?: { id: string; reference: string; title: string }
  productId?: string
  product?: { id: string; name: string; reference?: string }
  type: string
  brand?: string
  model?: string
  serialNumber?: string
  purchaseDate?: string
  warrantyExpiry?: string
  location?: string
  status: string
  notes?: string
  createdAt: string
  _count?: { tickets: number; licenses: number }
}

export interface License {
  id: string
  companyId: string
  company?: { id: string; name: string }
  equipmentId?: string
  equipment?: { id: string; type: string; brand?: string; model?: string }
  productId?: string
  product?: { id: string; name: string; reference?: string }
  software: string
  vendor?: string
  licenseKey?: string
  seats: number
  type: string
  purchaseDate?: string
  expiryDate?: string
  cost?: number
  notes?: string
  createdAt: string
}

export interface Activity {
  id: string
  type: string
  title: string
  description?: string
  userId?: string
  user?: { id: string; firstName: string; lastName: string; avatar?: string }
  contactId?: string
  contact?: { id: string; firstName: string; lastName: string }
  companyId?: string
  company?: { id: string; name: string }
  opportunityId?: string
  dueDate?: string
  completedAt?: string
  isAutomatic: boolean
  emailOpened?: boolean
  emailOpenedAt?: string
  createdAt: string
}

export interface Appointment {
  id: string
  title: string
  description?: string
  type: string
  startAt: string
  endAt: string
  location?: string
  ticketId?: string
  notes?: string
  createdAt: string
  users?: { user: { id: string; firstName: string; lastName: string; avatar?: string } }[]
  contacts?: { contact: { id: string; firstName: string; lastName: string } }[]
}

export interface Notification {
  id: string
  userId: string
  type: string
  title: string
  message: string
  link?: string
  isRead: boolean
  createdAt: string
}

export interface Todo {
  id: string
  title: string
  description?: string
  priority: string
  isDone: boolean
  isPrivate: boolean
  dueDate?: string
  completedAt?: string
  ownerId: string
  owner: { id: string; firstName: string; lastName: string }
  createdAt: string
  updatedAt: string
}

export interface Call {
  id: string
  externalId?: string
  direction: string
  status: string
  callerNumber: string
  callerName?: string
  receiverNumber?: string
  startedAt: string
  answeredAt?: string
  endedAt?: string
  duration?: number
  category?: string
  priority: string
  notes?: string
  recordingPath?: string
  recordingUrl?: string
  isHandled: boolean
  contactId?: string
  contact?: { id: string; firstName: string; lastName: string; phone?: string; mobile?: string }
  companyId?: string
  company?: { id: string; name: string }
  assignedToId?: string
  assignedTo?: { id: string; firstName: string; lastName: string; avatar?: string }
  tickets?: { id: string; reference: string; title: string; status: string; priority: string }[]
  createdAt: string
  updatedAt: string
  _count?: { tickets: number }
}

export interface DashboardStats {
  contacts: { total: number; newThisMonth: number }
  companies: { total: number }
  tickets: { open: number; critical: number; newThisMonth: number }
  contracts: { active: number; expiringSoon: number }
  opportunities: {
    open: number
    wonThisMonth: number
    pipelineValue: number
    wonValueThisMonth: number
    wonValueLastMonth: number
  }
  mrr: number
  arr: number
  alerts: { licensesExpiringSoon: number; warrantyExpiringSoon: number; contractsExpiringSoon: number; criticalTickets: number }
  pipeline: { stage: string; _count: { id: number }; _sum: { value: number } }[]
  recentActivities: Activity[]
}
