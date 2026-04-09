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

export interface Lead {
  id: string
  contactId: string
  contact: Contact & { company?: { id: string; name: string } | null }
  source: string
  title: string
  description?: string
  score: number
  status: string
  createdAt: string
  updatedAt: string
}

export interface Opportunity {
  id: string
  title: string
  contactId?: string
  contact?: { id: string; firstName: string; lastName: string }
  companyId?: string
  company?: { id: string; name: string }
  stage: string
  value: number
  probability: number
  expectedCloseDate?: string
  closedAt?: string
  lostReason?: string
  assignedToId?: string
  assignedTo?: { id: string; firstName: string; lastName: string; avatar?: string }
  notes?: string
  tags?: string
  remindAt?: string
  createdAt: string
  updatedAt: string
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
  _count?: { comments: number }
}

export interface TicketComment {
  id: string
  ticketId: string
  content: string
  isInternal: boolean
  authorName: string
  createdAt: string
}

export interface Equipment {
  id: string
  companyId: string
  company?: { id: string; name: string }
  contractId?: string
  contract?: { id: string; reference: string; title: string }
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
