import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams, useLocation, useSearchParams } from 'react-router-dom'
import api from '../../lib/api'
import { useUsersList } from '../../hooks/useApi'
import { usePermissions } from '../../hooks/usePermission'
import { useReferences } from '../../hooks/useReferences'
import {
  formatDate, formatDateTime, formatRelative,
  TICKET_STATUSES, TICKET_PRIORITIES,
} from '../../lib/utils'
import { Badge } from '../../components/ui/Badge'
import { Avatar } from '../../components/ui/Avatar'
import { PageSpinner, Spinner } from '../../components/ui/Spinner'
import { Modal } from '../../components/ui/Modal'
import { toast } from '../../components/ui/Toast'
import { SearchSelect } from '../../components/ui/SearchSelect'
import {
  Plus, Search, ArrowLeft, Clock, MessageSquare,
  ChevronDown, Send, Lock, Unlock, Trash2, Edit2, Timer, Download, X, CalendarPlus, Wrench,
  List, LayoutGrid, ArrowUp, ArrowDown, ArrowUpDown, Paperclip, Upload, History, Star, PlusCircle,
} from 'lucide-react'
import { PageIcon } from '../../components/ui/PageIcon'
import { downloadCsv } from '../../lib/exportCsv'
import { useForm, useWatch, type Resolver } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useAuthStore } from '../../store/authStore'
import type { Ticket, TicketDetail, TicketEvent, TicketAttachment, PaginatedResponse } from '../../types'

// ─── Schémas ────────────────────────────────────────────────────────────────

const ticketSchema = z.object({
  title: z.string().min(1, 'Titre requis'),
  description: z.string().min(1, 'Description requise'),
  category: z.string().min(1, 'Catégorie requise'),
  priority: z.string().min(1, 'Priorité requise'),
  contactId: z.string().optional(),
  companyId: z.string().optional(),
  assignedToId: z.string().optional(),
})
type TicketForm = z.infer<typeof ticketSchema>

const commentSchema = z.object({
  content: z.string().min(1, 'Commentaire requis'),
  isInternal: z.boolean().default(false),
})
type CommentForm = z.infer<typeof commentSchema>

const interventionSchema = z.object({
  startAt: z.string().min(1, 'Date requise'),
  durationMinutes: z.number().min(1),
})
type InterventionForm = z.infer<typeof interventionSchema>

const timeEntrySchema = z.object({
  minutes: z.number({ error: 'Durée requise' }).int().min(1, 'Minimum 1 minute').max(1440, 'Maximum 24h'),
  note: z.string().max(500).optional(),
})
type TimeEntryForm = z.infer<typeof timeEntrySchema>

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatTime(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m > 0 ? `${h}h ${m}min` : `${h}h`
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`
}

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

/** Indicateur SLA : basé sur l'échéance calculée à la création (fallback : âge du ticket) */
function SlaIndicator({ createdAt, slaDeadline }: { createdAt: string; slaDeadline?: string | null }) {
  // Heure courante lue au render pour un indicateur d'affichage (impureté bénigne, non réactive)
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now()

  if (slaDeadline) {
    const deadline = new Date(slaDeadline).getTime()
    const remaining = deadline - now
    if (remaining <= 0) {
      return <span title="SLA dépassé" className="inline-block w-2.5 h-2.5 rounded-full bg-red-500 shrink-0" />
    }
    // Orange quand il reste moins de 25 % du délai (ou moins d'une heure)
    const total = deadline - new Date(createdAt).getTime()
    if (remaining < Math.max(total * 0.25, 60 * 60 * 1000)) {
      return <span title="SLA bientôt dépassé" className="inline-block w-2.5 h-2.5 rounded-full bg-orange-400 shrink-0" />
    }
    return <span title="SLA respecté" className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-500 shrink-0" />
  }

  // Anciens tickets sans échéance : basé sur l'âge depuis la création
  const age = now - new Date(createdAt).getTime()
  const h24 = 24 * 60 * 60 * 1000
  if (age < h24) {
    return <span title="Moins de 24h" className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-500 shrink-0" />
  }
  if (age < 2 * h24) {
    return <span title="24h – 48h" className="inline-block w-2.5 h-2.5 rounded-full bg-orange-400 shrink-0" />
  }
  return <span title="Plus de 48h" className="inline-block w-2.5 h-2.5 rounded-full bg-red-500 shrink-0" />
}

/** Temps restant avant l'échéance SLA (affichage détail) */
function slaRemainingLabel(slaDeadline: string): { label: string; className: string } {
  const remaining = new Date(slaDeadline).getTime() - Date.now()
  if (remaining <= 0) {
    const overdue = Math.abs(remaining)
    return { label: `Dépassé de ${formatTime(Math.max(1, Math.round(overdue / 60000)))}`, className: 'text-red-600' }
  }
  return { label: `Reste ${formatTime(Math.max(1, Math.round(remaining / 60000)))}`, className: remaining < 60 * 60 * 1000 ? 'text-orange-500' : 'text-emerald-600' }
}

// Recherches distantes pour les SearchSelect
interface ContactRow { id: string; firstName: string; lastName: string; company?: { id: string; name: string } | null }

/** Métadonnées portées par une option contact : entreprise liée (pour l'auto-remplissage) */
export interface ContactOptionMeta { companyId: string | null; companyName: string | null }

function toContactOption(c: ContactRow) {
  return {
    id: c.id,
    label: `${c.firstName} ${c.lastName}`,
    sublabel: c.company?.name,
    meta: { companyId: c.company?.id ?? null, companyName: c.company?.name ?? null } satisfies ContactOptionMeta,
  }
}

/**
 * Recherche « souple » : si une entreprise est fournie, priorise ses contacts
 * tout en gardant visibles les contacts sans société (filtre non bloquant).
 */
async function searchContacts(q: string, companyId?: string) {
  const search = q || undefined
  if (!companyId) {
    const { data } = await api.get('/contacts', { params: { search, limit: 20 } })
    return (data.data as ContactRow[]).map(toContactOption)
  }
  const [companyRes, generalRes] = await Promise.all([
    api.get('/contacts', { params: { search, companyId, limit: 15 } }),
    api.get('/contacts', { params: { search, limit: 30 } }),
  ])
  const companyContacts = companyRes.data.data as ContactRow[]
  const noCompanyContacts = (generalRes.data.data as ContactRow[]).filter(c => !c.company)
  const merged = [
    ...companyContacts,
    ...noCompanyContacts.filter(c => !companyContacts.some(cc => cc.id === c.id)),
  ].slice(0, 20)
  return merged.map(toContactOption)
}
async function searchCompanies(q: string) {
  const { data } = await api.get('/companies', { params: { search: q || undefined, limit: 20 } })
  return (data.data as { id: string; name: string; city?: string }[]).map(c => ({
    id: c.id, label: c.name, sublabel: c.city,
  }))
}

// ─── Page liste ─────────────────────────────────────────────────────────────

export function TicketsPage() {
  const location = useLocation()

  // Détail inline si on vient de /tickets/:id via React Router
  const isDetailRoute = location.pathname !== '/tickets'

  if (isDetailRoute) return null // Géré par <Route path="/tickets/:id" />

  return <TicketsListView />
}

type SortState = { by: string; order: 'asc' | 'desc' } | null

function SortableTh({ label, col, sort, onSort }: { label: string; col: string; sort: SortState; onSort: (col: string) => void }) {
  const active = sort?.by === col
  return (
    <th className="cursor-pointer select-none" onClick={() => onSort(col)} title="Trier">
      <span className="inline-flex items-center gap-1">
        {label}
        {active
          ? (sort!.order === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)
          : <ArrowUpDown className="w-3 h-3 opacity-30" />}
      </span>
    </th>
  )
}

export function TicketsListView() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [searchParams] = useSearchParams()
  const perms = usePermissions(['tickets:export', 'tickets:delete', 'tickets:assign', 'tickets:update'])
  const refs = useReferences()

  const [searchInput, setSearchInput] = useState(searchParams.get('search') ?? '')
  const [search, setSearch] = useState(searchInput)

  // Multi-statut : tableau de clés
  const initialStatuses = searchParams.getAll('status')
  const [statusFilters, setStatusFilters] = useState<string[]>(initialStatuses)
  const [showStatusDropdown, setShowStatusDropdown] = useState(false)
  const statusDropdownRef = useRef<HTMLDivElement>(null)

  const [priorityFilter, setPriorityFilter] = useState(searchParams.get('priority') ?? '')
  const [categoryFilter, setCategoryFilter] = useState(searchParams.get('category') ?? '')
  const [assignedFilter, setAssignedFilter] = useState(searchParams.get('assignedToId') ?? '')
  const [page, setPage] = useState(1)
  const [showCreate, setShowCreate] = useState(false)
  const [sort, setSort] = useState<SortState>(null)

  // Recherche debouncée : une requête serveur au plus toutes les 300 ms
  useEffect(() => {
    const t = setTimeout(() => { setSearch(searchInput); setPage(1) }, 300)
    return () => clearTimeout(t)
  }, [searchInput])

  // Vue liste ou cartes (persistée)
  const [viewMode, setViewMode] = useState<'list' | 'cards'>(() =>
    localStorage.getItem('tickets-view-mode') === 'cards' ? 'cards' : 'list')
  const changeView = (m: 'list' | 'cards') => {
    setViewMode(m)
    localStorage.setItem('tickets-view-mode', m)
  }

  const toggleSort = (col: string) => {
    setSort(prev => {
      if (prev?.by !== col) return { by: col, order: col === 'createdAt' || col === 'priority' ? 'desc' : 'asc' }
      if (prev.order === 'desc') return { by: col, order: 'asc' }
      return null // 3e clic : retour au tri par défaut (priorité + date)
    })
    setPage(1)
  }

  // IDs des tickets avec un timer actif dans localStorage
  const readActiveTimers = () => {
    const ids = new Set<string>()
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key?.startsWith('ticket-timer-')) ids.add(key.replace('ticket-timer-', ''))
    }
    return ids
  }
  const [activeTimerIds, setActiveTimerIds] = useState<Set<string>>(readActiveTimers)

  // Rafraîchir les timers actifs au retour sur la liste
  useEffect(() => {
    const handler = () => setActiveTimerIds(readActiveTimers())
    window.addEventListener('focus', handler)
    return () => window.removeEventListener('focus', handler)
  }, [])

  // Fermer le dropdown statut en cliquant hors
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (statusDropdownRef.current && !statusDropdownRef.current.contains(e.target as Node)) {
        setShowStatusDropdown(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const toggleStatus = (key: string) => {
    setStatusFilters(prev =>
      prev.includes(key) ? prev.filter(s => s !== key) : [...prev, key]
    )
    setPage(1)
  }

  const { data, isLoading } = useQuery<PaginatedResponse<Ticket>>({
    queryKey: ['tickets', { search, statusFilters, priorityFilter, categoryFilter, assignedFilter, page, sort }],
    queryFn: async () => {
      const params: Record<string, unknown> = {
        search: search || undefined,
        priority: priorityFilter || undefined,
        category: categoryFilter || undefined,
        assignedToId: assignedFilter || undefined,
        sortBy: sort?.by,
        sortOrder: sort?.order,
        page,
        limit: 25,
      }
      // Envoyer status comme paramètres répétés si multi-sélection
      if (statusFilters.length > 0) {
        params.status = statusFilters
      }
      const { data } = await api.get('/tickets', {
        params,
        // Serializer pour gérer les tableaux : status[]=... → status=...&status=...
        paramsSerializer: (p) => {
          const sp = new URLSearchParams()
          for (const [k, v] of Object.entries(p)) {
            if (v === undefined || v === null) continue
            if (Array.isArray(v)) {
              v.forEach(item => sp.append(k, item))
            } else {
              sp.append(k, String(v))
            }
          }
          return sp.toString()
        },
      })
      return data
    },
    staleTime: 30_000,
  })

  const { data: usersData } = useUsersList({ enabled: perms['tickets:assign'] })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/tickets/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tickets'] }); toast.success('Ticket supprimé') },
    onError: () => toast.error('Erreur lors de la suppression'),
  })

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (window.confirm('Supprimer ce ticket ?')) deleteMutation.mutate(id)
  }

  const hasFilters = search || statusFilters.length > 0 || priorityFilter || categoryFilter || assignedFilter

  const statusLabel = statusFilters.length === 0
    ? 'Tous les statuts'
    : statusFilters.length === 1
      ? TICKET_STATUSES[statusFilters[0]]?.label ?? statusFilters[0]
      : `${statusFilters.length} statuts`

  const handleExport = () => downloadCsv('/tickets/export/csv', {
    search: search || undefined,
    status: statusFilters.length > 0 ? statusFilters : undefined,
    priority: priorityFilter || undefined,
    category: categoryFilter || undefined,
    assignedToId: assignedFilter || undefined,
  }, `tickets-${new Date().toISOString().slice(0, 10)}.csv`)

  return (
    <div className="space-y-5 fade-in">
      <div className="page-header">
        <div className="flex items-center gap-3">
          <PageIcon module="tickets" icon={<Wrench className="w-5 h-5" />} />
          <div>
            <h1 className="page-title">Tickets</h1>
            <p className="page-subtitle">{data?.meta.total || 0} tickets</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Bascule liste / cartes */}
          <div className="flex items-center bg-white border border-slate-200 rounded-lg p-0.5">
            <button
              className={`p-1.5 rounded-md transition-colors ${viewMode === 'list' ? 'bg-indigo-50 text-indigo-600' : 'text-slate-400 hover:text-slate-600'}`}
              onClick={() => changeView('list')}
              title="Vue liste"
            >
              <List className="w-4 h-4" />
            </button>
            <button
              className={`p-1.5 rounded-md transition-colors ${viewMode === 'cards' ? 'bg-indigo-50 text-indigo-600' : 'text-slate-400 hover:text-slate-600'}`}
              onClick={() => changeView('cards')}
              title="Vue cartes"
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
          </div>
          {perms['tickets:export'] && (
            <button className="btn-secondary flex items-center gap-1.5" onClick={handleExport} title="Exporter en CSV (filtres actifs)">
              <Download className="w-4 h-4" /> CSV
            </button>
          )}
          <button className="btn-primary" onClick={() => setShowCreate(true)}>
            <Plus className="w-4 h-4" /> Nouveau ticket
          </button>
        </div>
      </div>

      {/* Filtres */}
      <div className="flex gap-3 flex-wrap items-center">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            className="input pl-9"
            placeholder="Rechercher..."
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
          />
        </div>

        {/* Multi-sélection statut */}
        <div className="relative" ref={statusDropdownRef}>
          <button
            type="button"
            className={`input w-auto flex items-center gap-2 cursor-pointer ${statusFilters.length > 0 ? 'border-indigo-400 ring-1 ring-indigo-200' : ''}`}
            onClick={() => setShowStatusDropdown(s => !s)}
          >
            <span className="flex-1 text-left">{statusLabel}</span>
            <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
          </button>
          {showStatusDropdown && (
            <div className="absolute top-full left-0 mt-1 bg-white rounded-xl shadow-lg border border-slate-100 py-1 z-20 min-w-52">
              {Object.entries(TICKET_STATUSES).map(([k, v]) => (
                <label key={k} className="flex items-center gap-2.5 px-3 py-2 hover:bg-slate-50 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={statusFilters.includes(k)}
                    onChange={() => toggleStatus(k)}
                    className="rounded border-slate-300 text-indigo-600"
                  />
                  <Badge variant={v.color}>{v.label}</Badge>
                </label>
              ))}
              {statusFilters.length > 0 && (
                <div className="border-t border-slate-100 mt-1 pt-1">
                  <button
                    className="w-full text-left px-3 py-1.5 text-xs text-slate-400 hover:text-slate-600"
                    onClick={() => { setStatusFilters([]); setPage(1) }}
                  >
                    Désélectionner tout
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        <select className="input w-auto" value={priorityFilter} onChange={e => { setPriorityFilter(e.target.value); setPage(1) }}>
          <option value="">Toutes priorités</option>
          {Object.entries(TICKET_PRIORITIES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <select className="input w-auto" value={categoryFilter} onChange={e => { setCategoryFilter(e.target.value); setPage(1) }}>
          <option value="">Toutes catégories</option>
          {refs.options('ticket_category').map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        {perms['tickets:assign'] && usersData && (
          <select className="input w-auto" value={assignedFilter} onChange={e => { setAssignedFilter(e.target.value); setPage(1) }}>
            <option value="">Tous les techniciens</option>
            {usersData.map(u => <option key={u.id} value={u.id}>{u.firstName} {u.lastName}</option>)}
          </select>
        )}
        {hasFilters && (
          <button
            className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800 border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white hover:bg-slate-50 transition-colors"
            onClick={() => { setSearchInput(''); setSearch(''); setStatusFilters([]); setPriorityFilter(''); setCategoryFilter(''); setAssignedFilter(''); setPage(1) }}
          >
            <X className="w-3 h-3" /> Réinitialiser
          </button>
        )}
      </div>

      {/* Contenu : table ou cartes */}
      {isLoading ? <PageSpinner /> : viewMode === 'cards' ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {data?.data.length === 0 ? (
            <div className="col-span-full text-center py-12 text-slate-400">Aucun ticket trouvé</div>
          ) : data?.data.map(t => (
            <TicketCard
              key={t.id}
              ticket={t}
              timerActive={activeTimerIds.has(t.id)}
              onClick={() => navigate(`/tickets/${t.id}`)}
              onDelete={perms['tickets:delete'] ? (e) => handleDelete(t.id, e) : undefined}
            />
          ))}
        </div>
      ) : (
        <div className="table-container">
          <table>
            <thead>
              <tr>
                {/* Statut en première position */}
                <SortableTh label="Statut" col="status" sort={sort} onSort={toggleSort} />
                <SortableTh label="Référence" col="reference" sort={sort} onSort={toggleSort} />
                <th>Titre</th>
                <th>Entreprise / Contact</th>
                <SortableTh label="Priorité" col="priority" sort={sort} onSort={toggleSort} />
                <th>SLA</th>
                <SortableTh label="Temps" col="timeSpent" sort={sort} onSort={toggleSort} />
                <th>Technicien</th>
                <SortableTh label="Créé le" col="createdAt" sort={sort} onSort={toggleSort} />
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data?.data.length === 0 ? (
                <tr><td colSpan={10} className="text-center py-12 text-slate-400">Aucun ticket trouvé</td></tr>
              ) : data?.data.map(t => (
                <tr key={t.id} className="cursor-pointer" onClick={() => navigate(`/tickets/${t.id}`)}>
                  {/* Statut — première colonne */}
                  <td>
                    <Badge variant={TICKET_STATUSES[t.status]?.color || 'badge-gray'}>
                      {TICKET_STATUSES[t.status]?.label || t.status}
                    </Badge>
                  </td>
                  <td>
                    <span className="font-mono text-xs text-slate-500">{t.reference}</span>
                  </td>
                  <td>
                    <p className="font-medium text-slate-900 max-w-xs truncate">{t.title}</p>
                    <p className="text-xs text-slate-400">{refs.label('ticket_category', t.category)}</p>
                  </td>
                  <td>
                    <div className="text-sm">
                      {t.company && <p className="text-slate-700">{t.company.name}</p>}
                      {t.contact && <p className="text-xs text-slate-400">{t.contact.firstName} {t.contact.lastName}</p>}
                      {!t.company && !t.contact && <span className="text-slate-300">—</span>}
                    </div>
                  </td>
                  <td>
                    <Badge variant={TICKET_PRIORITIES[t.priority]?.color || 'badge-gray'}>
                      {TICKET_PRIORITIES[t.priority]?.label || t.priority}
                    </Badge>
                  </td>
                  {/* Indicateur SLA */}
                  <td>
                    {t.status !== 'RESOLVED' && t.status !== 'CLOSED' ? (
                      <SlaIndicator createdAt={t.createdAt} slaDeadline={t.slaDeadline} />
                    ) : (
                      <span className="inline-block w-2.5 h-2.5 rounded-full bg-slate-200 shrink-0" title="Clôturé" />
                    )}
                  </td>
                  {/* Colonne Temps */}
                  <td>
                    {activeTimerIds.has(t.id) ? (
                      <div className="flex items-center gap-1.5 text-xs text-amber-600">
                        <span className="inline-block w-2 h-2 rounded-full bg-amber-400 animate-pulse shrink-0" title="Timer en cours" />
                        <span>{t.timeSpent > 0 ? formatTime(t.timeSpent) : 'En cours'}</span>
                      </div>
                    ) : t.timeSpent > 0 ? (
                      <div className="flex items-center gap-1 text-xs text-slate-500">
                        <Clock className="w-3 h-3 shrink-0" />
                        <span>{formatTime(t.timeSpent)}</span>
                      </div>
                    ) : (
                      <span className="text-slate-200">—</span>
                    )}
                  </td>
                  <td>
                    {t.assignedTo ? (
                      <div className="flex items-center gap-2">
                        <Avatar firstName={t.assignedTo.firstName} lastName={t.assignedTo.lastName} size="sm" />
                        <span className="text-sm text-slate-600">{t.assignedTo.firstName}</span>
                      </div>
                    ) : <span className="text-slate-300 text-sm">Non assigné</span>}
                  </td>
                  <td className="text-slate-400 text-xs">{formatDate(t.createdAt)}</td>
                  <td>
                    <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                      <button
                        className="btn-ghost btn-sm p-1.5 rounded-lg"
                        onClick={e => { e.stopPropagation(); navigate(`/tickets/${t.id}`) }}
                        title="Voir le détail"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      {perms['tickets:delete'] && (
                        <button
                          className="btn-ghost btn-sm p-1.5 rounded-lg text-red-400 hover:text-red-600"
                          onClick={e => handleDelete(t.id, e)}
                          title="Supprimer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {data && data.meta.total > 25 && (
        <div className="flex items-center justify-between text-sm text-slate-500">
          <span>{(page - 1) * 25 + 1} – {Math.min(page * 25, data.meta.total)} sur {data.meta.total}</span>
          <div className="flex gap-2">
            <button className="btn-secondary btn-sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Précédent</button>
            <button className="btn-secondary btn-sm" disabled={page * 25 >= data.meta.total} onClick={() => setPage(p => p + 1)}>Suivant</button>
          </div>
        </div>
      )}

      {/* Modal création */}
      <TicketFormModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onSuccess={() => { qc.invalidateQueries({ queryKey: ['tickets'] }); setShowCreate(false) }}
      />
    </div>
  )
}

// ─── Carte ticket (vue cartes) ───────────────────────────────────────────────

function TicketCard({ ticket: t, timerActive, onClick, onDelete }: {
  ticket: Ticket
  timerActive: boolean
  onClick: () => void
  onDelete?: (e: React.MouseEvent) => void
}) {
  const refs = useReferences()
  return (
    <div
      className="card card-body cursor-pointer hover:shadow-md transition-shadow space-y-3 relative group"
      onClick={onClick}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <Badge variant={TICKET_STATUSES[t.status]?.color || 'badge-gray'}>
          {TICKET_STATUSES[t.status]?.label || t.status}
        </Badge>
        <Badge variant={TICKET_PRIORITIES[t.priority]?.color || 'badge-gray'}>
          {TICKET_PRIORITIES[t.priority]?.label || t.priority}
        </Badge>
        {t.status !== 'RESOLVED' && t.status !== 'CLOSED' && (
          <SlaIndicator createdAt={t.createdAt} slaDeadline={t.slaDeadline} />
        )}
        <span className="font-mono text-[11px] text-slate-400 ml-auto">{t.reference}</span>
      </div>

      <div>
        <p className="font-medium text-slate-900 line-clamp-2">{t.title}</p>
        <p className="text-xs text-slate-400 mt-0.5">{refs.label('ticket_category', t.category)}</p>
      </div>

      {(t.company || t.contact) && (
        <div className="text-sm">
          {t.company && <p className="text-slate-700">{t.company.name}</p>}
          {t.contact && <p className="text-xs text-slate-400">{t.contact.firstName} {t.contact.lastName}</p>}
        </div>
      )}

      <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-xs text-slate-400">
        <div className="flex items-center gap-3">
          {t.assignedTo ? (
            <span className="flex items-center gap-1.5">
              <Avatar firstName={t.assignedTo.firstName} lastName={t.assignedTo.lastName} size="sm" />
              <span className="text-slate-600">{t.assignedTo.firstName}</span>
            </span>
          ) : <span className="text-slate-300">Non assigné</span>}
          {timerActive ? (
            <span className="flex items-center gap-1 text-amber-600">
              <span className="inline-block w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
              {t.timeSpent > 0 ? formatTime(t.timeSpent) : 'En cours'}
            </span>
          ) : t.timeSpent > 0 && (
            <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{formatTime(t.timeSpent)}</span>
          )}
          {(t._count?.comments ?? 0) > 0 && (
            <span className="flex items-center gap-1"><MessageSquare className="w-3 h-3" />{t._count?.comments}</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <span>{formatDate(t.createdAt)}</span>
          {onDelete && (
            <button
              className="btn-ghost btn-sm p-1 rounded-lg text-red-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={onDelete}
              title="Supprimer"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Page détail ─────────────────────────────────────────────────────────────

export function TicketDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { user } = useAuthStore()
  const perms = usePermissions(['tickets:update', 'tickets:delete', 'tickets:assign'])
  const refs = useReferences()

  const [showEdit, setShowEdit] = useState(false)
  const [showStatusMenu, setShowStatusMenu] = useState(false)
  const [timerRunning, setTimerRunning] = useState(false)
  const [timerSeconds, setTimerSeconds] = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [showIntervention, setShowIntervention] = useState(false)
  const [showTimeEntry, setShowTimeEntry] = useState(false)

  const { data: ticket, isLoading } = useQuery({
    queryKey: ['ticket', id],
    queryFn: async () => { const { data } = await api.get(`/tickets/${id}`); return data.data as TicketDetail },
    enabled: !!id,
  })

  const invalidateTicket = () => {
    qc.invalidateQueries({ queryKey: ['ticket', id] })
    qc.invalidateQueries({ queryKey: ['tickets'] })
  }

  // Restaurer le timer depuis localStorage au chargement
  useEffect(() => {
    if (!id) return
    const saved = localStorage.getItem(`ticket-timer-${id}`)
    if (saved) {
      const elapsed = Math.floor((Date.now() - parseInt(saved)) / 1000)
      // Restauration ponctuelle de l'état timer depuis localStorage au montage
      setTimerSeconds(elapsed)
      setTimerRunning(true)
    }
  }, [id])

  // Chronomètre
  useEffect(() => {
    if (timerRunning) {
      timerRef.current = setInterval(() => setTimerSeconds(s => s + 1), 1000)
    } else {
      if (timerRef.current) clearInterval(timerRef.current)
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [timerRunning])

  const statusMutation = useMutation({
    mutationFn: (status: string) => api.patch(`/tickets/${id}/status`, { status }),
    onSuccess: () => { invalidateTicket(); setShowStatusMenu(false); toast.success('Statut mis à jour') },
    onError: () => toast.error('Erreur lors de la mise à jour'),
  })

  const timeMutation = useMutation({
    mutationFn: (payload: { minutes: number; note?: string }) => api.patch(`/tickets/${id}/time`, payload),
    onSuccess: () => { invalidateTicket(); toast.success('Temps enregistré') },
    onError: () => toast.error('Erreur lors de l\'enregistrement du temps'),
  })

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/tickets/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tickets'] }); toast.success('Ticket supprimé'); navigate('/tickets') },
    onError: () => toast.error('Erreur lors de la suppression'),
  })

  const handleStartTimer = () => {
    localStorage.setItem(`ticket-timer-${id}`, String(Date.now()))
    setTimerRunning(true)
  }

  const handleStopTimer = () => {
    setTimerRunning(false)
    localStorage.removeItem(`ticket-timer-${id}`)
    const minutes = Math.round(timerSeconds / 60)
    if (minutes > 0) {
      timeMutation.mutate({ minutes, note: 'Chronomètre' })
    }
    setTimerSeconds(0)
  }

  const { register: regComment, handleSubmit: handleComment, reset: resetComment, control: controlComment, formState: { isSubmitting: submittingComment } } = useForm<CommentForm>({
    resolver: zodResolver(commentSchema) as Resolver<CommentForm>,
    defaultValues: { isInternal: false },
  })
  const isInternalComment = useWatch({ control: controlComment, name: 'isInternal' })

  const addCommentMutation = useMutation({
    mutationFn: (values: CommentForm) => api.post(`/tickets/${id}/comments`, values),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['ticket', id] }); resetComment({ content: '', isInternal: false }); toast.success('Commentaire ajouté') },
    onError: () => toast.error('Erreur lors de l\'ajout du commentaire'),
  })

  if (isLoading) return <PageSpinner />
  if (!ticket) return <div className="p-8 text-center text-slate-500">Ticket introuvable</div>

  const timerDisplay = `${String(Math.floor(timerSeconds / 3600)).padStart(2, '0')}:${String(Math.floor((timerSeconds % 3600) / 60)).padStart(2, '0')}:${String(timerSeconds % 60).padStart(2, '0')}`
  const isOpen = ticket.status !== 'RESOLVED' && ticket.status !== 'CLOSED'
  // Heure courante lue au render pour des libellés d'affichage (impureté bénigne, non réactive)
  // eslint-disable-next-line react-hooks/purity
  const nowTs = Date.now()
  const sla = ticket.slaDeadline && isOpen ? slaRemainingLabel(ticket.slaDeadline) : null

  return (
    <div className="space-y-5 fade-in">
      {/* Header */}
      <div className="flex items-start gap-3">
        <button onClick={() => navigate('/tickets')} className="btn-ghost btn-sm p-2 rounded-lg mt-0.5">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-mono text-xs text-slate-400">{ticket.reference}</span>
            <Badge variant={TICKET_PRIORITIES[ticket.priority]?.color || 'badge-gray'}>
              {TICKET_PRIORITIES[ticket.priority]?.label || ticket.priority}
            </Badge>
          </div>
          <h1 className="page-title">{ticket.title}</h1>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          {perms['tickets:update'] && (
            <>
              {/* Chronomètre */}
              <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
                <Timer className="w-4 h-4 text-slate-400" />
                <span className="font-mono text-sm text-slate-700">{timerDisplay}</span>
                {!timerRunning ? (
                  <button
                    className="btn-primary btn-sm text-xs px-2 py-1"
                    onClick={handleStartTimer}
                  >
                    Démarrer
                  </button>
                ) : (
                  <button
                    className="btn-sm bg-red-50 text-red-600 border border-red-200 rounded-lg text-xs px-2 py-1 hover:bg-red-100"
                    onClick={handleStopTimer}
                  >
                    Arrêter
                  </button>
                )}
              </div>
              {/* Planifier intervention */}
              <button
                className="btn-secondary flex items-center gap-2"
                onClick={() => setShowIntervention(true)}
              >
                <CalendarPlus className="w-4 h-4" /> Planifier intervention
              </button>
              {/* Changer statut */}
              <div className="relative">
                <button
                  className="btn-secondary flex items-center gap-2"
                  onClick={() => setShowStatusMenu(s => !s)}
                >
                  <Badge variant={TICKET_STATUSES[ticket.status]?.color || 'badge-gray'}>
                    {TICKET_STATUSES[ticket.status]?.label || ticket.status}
                  </Badge>
                  <ChevronDown className="w-4 h-4" />
                </button>
                {showStatusMenu && (
                  <div className="absolute right-0 top-full mt-1 bg-white rounded-xl shadow-lg border border-slate-100 py-1 z-10 min-w-48">
                    {Object.entries(TICKET_STATUSES).map(([k, v]) => (
                      <button
                        key={k}
                        className="w-full text-left px-4 py-2 text-sm hover:bg-slate-50 flex items-center gap-2"
                        onClick={() => statusMutation.mutate(k)}
                      >
                        <Badge variant={v.color}>{v.label}</Badge>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button className="btn-secondary" onClick={() => setShowEdit(true)}>
                <Edit2 className="w-4 h-4" /> Modifier
              </button>
            </>
          )}
          {perms['tickets:delete'] && (
            <button
              className="btn-ghost text-red-400 hover:text-red-600 p-2 rounded-lg"
              onClick={() => { if (window.confirm('Supprimer ce ticket ?')) deleteMutation.mutate() }}
              title="Supprimer"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Colonne info */}
        <div className="space-y-4">
          <div className="card card-body">
            <h3 className="text-sm font-semibold text-slate-700 mb-3">Informations</h3>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500">Catégorie</span>
                <span className="text-slate-800 font-medium">{refs.label('ticket_category', ticket.category)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Priorité</span>
                <Badge variant={TICKET_PRIORITIES[ticket.priority]?.color}>{TICKET_PRIORITIES[ticket.priority]?.label}</Badge>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Statut</span>
                <Badge variant={TICKET_STATUSES[ticket.status]?.color}>{TICKET_STATUSES[ticket.status]?.label}</Badge>
              </div>
              {ticket.company && (
                <div className="flex justify-between">
                  <span className="text-slate-500">Entreprise</span>
                  <span className="text-slate-800 font-medium">{ticket.company.name}</span>
                </div>
              )}
              {ticket.contact && (
                <div className="flex justify-between">
                  <span className="text-slate-500">Contact</span>
                  <span className="text-slate-800 font-medium">{ticket.contact.firstName} {ticket.contact.lastName}</span>
                </div>
              )}
              {ticket.assignedTo && (
                <div className="flex justify-between items-center">
                  <span className="text-slate-500">Technicien</span>
                  <div className="flex items-center gap-2">
                    <Avatar firstName={ticket.assignedTo.firstName} lastName={ticket.assignedTo.lastName} size="sm" />
                    <span className="text-slate-800 font-medium">{ticket.assignedTo.firstName} {ticket.assignedTo.lastName}</span>
                  </div>
                </div>
              )}
              {ticket.equipment && (
                <div className="flex justify-between">
                  <span className="text-slate-500">Équipement</span>
                  <span className="text-slate-800 font-medium">{ticket.equipment.brand} {ticket.equipment.model}</span>
                </div>
              )}
              {ticket.slaDeadline && (
                <div className="flex justify-between items-center">
                  <span className="text-slate-500">SLA</span>
                  <div className="text-right">
                    <span className="text-slate-800 font-medium block">{formatDateTime(ticket.slaDeadline)}</span>
                    {sla && <span className={`text-xs font-medium ${sla.className}`}>{sla.label}</span>}
                  </div>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-slate-500">Créé le</span>
                <span className="text-slate-800">{formatDate(ticket.createdAt)}</span>
              </div>
              {ticket.createdBy && (
                <div className="flex justify-between">
                  <span className="text-slate-500">Créé par</span>
                  <span className="text-slate-800">{ticket.createdBy.firstName} {ticket.createdBy.lastName}</span>
                </div>
              )}
              {ticket.resolvedAt && (
                <div className="flex justify-between">
                  <span className="text-slate-500">Résolu le</span>
                  <span className="text-slate-800">{formatDate(ticket.resolvedAt)}</span>
                </div>
              )}
              {ticket.npsResponse && (
                <div className="flex justify-between items-center pt-2 border-t border-slate-100">
                  <span className="text-slate-500 flex items-center gap-1"><Star className="w-3.5 h-3.5 text-amber-400" /> Avis client</span>
                  <span className={`font-semibold ${ticket.npsResponse.score >= 9 ? 'text-emerald-600' : ticket.npsResponse.score >= 7 ? 'text-amber-500' : 'text-red-500'}`}>
                    {ticket.npsResponse.score}/10
                  </span>
                </div>
              )}
              {ticket.npsResponse?.comment && (
                <p className="text-xs text-slate-500 italic bg-slate-50 rounded-lg px-3 py-2">« {ticket.npsResponse.comment} »</p>
              )}
            </div>
          </div>

          {/* Temps passé */}
          <div className="card card-body">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
                <Clock className="w-4 h-4 text-slate-400" /> Temps passé
              </h3>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-slate-800">{formatTime(ticket.timeSpent)}</span>
                {perms['tickets:update'] && (
                  <button className="btn-ghost btn-sm p-1 rounded-lg text-indigo-500 hover:text-indigo-700" onClick={() => setShowTimeEntry(true)} title="Ajouter du temps">
                    <PlusCircle className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
            {ticket.timeEntries.length === 0 ? (
              <p className="text-xs text-slate-400">Aucune entrée de temps</p>
            ) : (
              <div className="space-y-2">
                {ticket.timeEntries.map(e => (
                  <div key={e.id} className="flex items-start justify-between gap-2 text-xs border-b border-slate-50 last:border-b-0 pb-2 last:pb-0">
                    <div className="min-w-0">
                      <span className="text-slate-700 font-medium">
                        {e.user ? `${e.user.firstName} ${e.user.lastName}` : 'Inconnu'}
                      </span>
                      {e.note && <p className="text-slate-400 truncate">{e.note}</p>}
                      <p className="text-slate-300">{formatRelative(e.createdAt)}</p>
                    </div>
                    <span className="text-slate-600 font-medium whitespace-nowrap">{formatTime(e.minutes)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Historique */}
          <div className="card card-body">
            <h3 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-1.5">
              <History className="w-4 h-4 text-slate-400" /> Historique
            </h3>
            {ticket.events.length === 0 ? (
              <p className="text-xs text-slate-400">Aucun évènement</p>
            ) : (
              <div className="relative space-y-3">
                {ticket.events.map(e => (
                  <div key={e.id} className="flex gap-2.5 text-xs">
                    <span className={`mt-1 inline-block w-2 h-2 rounded-full shrink-0 ${
                      e.type === 'REOPENED' ? 'bg-orange-400'
                      : e.type === 'NPS_RECEIVED' ? 'bg-amber-400'
                      : e.type === 'CREATED' ? 'bg-indigo-400'
                      : 'bg-slate-300'}`} />
                    <div className="min-w-0">
                      <p className="text-slate-700">{eventLabel(e)}</p>
                      <p className="text-slate-400">
                        {e.author ? `${e.author.firstName} ${e.author.lastName} · ` : ''}{formatRelative(e.createdAt)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Colonne principale */}
        <div className="lg:col-span-2 space-y-5">
          {/* Description */}
          <div className="card card-body">
            <h3 className="text-sm font-semibold text-slate-700 mb-3">Description</h3>
            <p className="text-sm text-slate-600 whitespace-pre-wrap leading-relaxed">{ticket.description}</p>
            {ticket.notes && (
              <>
                <div className="border-t border-slate-100 mt-4 pt-4">
                  <p className="text-xs font-semibold text-slate-500 mb-2 uppercase tracking-wide">Notes internes</p>
                  <p className="text-sm text-slate-600 whitespace-pre-wrap">{ticket.notes}</p>
                </div>
              </>
            )}
          </div>

          {/* Pièces jointes */}
          <AttachmentsCard ticket={ticket} canEdit={perms['tickets:update']} onChanged={invalidateTicket} />

          {/* Interventions liées */}
          <div className="card">
            <div className="card-header flex items-center justify-between">
              <h3 className="font-semibold text-slate-800 flex items-center gap-2">
                <CalendarPlus className="w-4 h-4" />
                Interventions
                <span className="text-xs text-slate-400">({ticket.appointments.length})</span>
              </h3>
            </div>
            {ticket.appointments.length === 0 ? (
              <div className="py-6 text-center text-sm text-slate-400">Aucune intervention planifiée</div>
            ) : (
              <div className="divide-y divide-slate-100">
                {ticket.appointments.map(a => (
                  <div key={a.id} className="px-4 py-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-800 truncate">{a.title}</p>
                      <p className="text-xs text-slate-400">
                        {formatDateTime(a.startAt)}
                        {a.users && a.users.length > 0 && ` · ${a.users.map(u => `${u.user.firstName} ${u.user.lastName}`).join(', ')}`}
                      </p>
                    </div>
                    <span className={`text-xs whitespace-nowrap ${new Date(a.startAt).getTime() > nowTs ? 'text-indigo-500' : 'text-slate-400'}`}>
                      {new Date(a.startAt).getTime() > nowTs ? 'À venir' : 'Passée'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Commentaires */}
          <div className="card">
            <div className="card-header">
              <h3 className="font-semibold text-slate-800 flex items-center gap-2">
                <MessageSquare className="w-4 h-4" />
                Commentaires
                <span className="text-xs text-slate-400">({ticket.comments?.length ?? 0})</span>
              </h3>
            </div>

            {/* Liste commentaires */}
            <div className="divide-y divide-slate-100">
              {ticket.comments?.length === 0 ? (
                <div className="py-8 text-center text-sm text-slate-400">Aucun commentaire</div>
              ) : ticket.comments?.map(c => (
                <div key={c.id} className={`px-4 py-3 ${c.isInternal ? 'bg-amber-50/60' : ''}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-slate-800">{c.authorName}</span>
                      {c.isInternal && (
                        <span className="flex items-center gap-1 text-xs text-amber-600 bg-amber-100 px-1.5 py-0.5 rounded">
                          <Lock className="w-3 h-3" /> Interne
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-slate-400 whitespace-nowrap">{formatRelative(c.createdAt)}</span>
                  </div>
                  <p className="text-sm text-slate-600 mt-1 whitespace-pre-wrap">{c.content}</p>
                </div>
              ))}
            </div>

            {/* Ajouter commentaire */}
            {perms['tickets:update'] && (
              <div className="p-4 border-t border-slate-100">
                <form onSubmit={handleComment((v: CommentForm) => addCommentMutation.mutate(v))} className="space-y-3">
                  <textarea
                    {...regComment('content')}
                    className="input resize-none"
                    rows={3}
                    placeholder="Ajouter un commentaire..."
                  />
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" {...regComment('isInternal')} className="rounded" />
                      <span className="text-sm text-slate-600 flex items-center gap-1">
                        {isInternalComment ? <Lock className="w-3.5 h-3.5 text-amber-500" /> : <Unlock className="w-3.5 h-3.5 text-slate-400" />}
                        Commentaire interne
                      </span>
                    </label>
                    <button type="submit" className="btn-primary btn-sm" disabled={submittingComment || addCommentMutation.isPending}>
                      {(submittingComment || addCommentMutation.isPending) ? <Spinner className="w-3.5 h-3.5" /> : <Send className="w-3.5 h-3.5" />}
                      Envoyer
                    </button>
                  </div>
                </form>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Modal édition */}
      <TicketFormModal
        open={showEdit}
        onClose={() => setShowEdit(false)}
        ticket={ticket}
        onSuccess={() => { invalidateTicket(); setShowEdit(false) }}
      />

      {/* Modal intervention */}
      <InterventionModal
        open={showIntervention}
        onClose={() => setShowIntervention(false)}
        ticket={ticket}
        currentUserId={user?.id}
        onSuccess={invalidateTicket}
      />

      {/* Modal ajout de temps */}
      <TimeEntryModal
        open={showTimeEntry}
        onClose={() => setShowTimeEntry(false)}
        onSubmit={(v) => { timeMutation.mutate(v); setShowTimeEntry(false) }}
      />
    </div>
  )
}

// ─── Pièces jointes ──────────────────────────────────────────────────────────

function AttachmentsCard({ ticket, canEdit, onChanged }: { ticket: TicketDetail; canEdit: boolean; onChanged: () => void }) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  const handleUpload = async (file: File) => {
    setUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      await api.post(`/tickets/${ticket.id}/attachments`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      toast.success('Pièce jointe ajoutée')
      onChanged()
    } catch (err: unknown) {
      const message = (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message
      toast.error(message ?? 'Erreur lors de l\'upload')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleDownload = async (a: TicketAttachment) => {
    try {
      const response = await api.get(`/tickets/attachments/${a.id}/download`, { responseType: 'blob' })
      const url = URL.createObjectURL(new Blob([response.data]))
      const link = document.createElement('a')
      link.href = url
      link.download = a.filename
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
    } catch {
      toast.error('Erreur lors du téléchargement')
    }
  }

  const handleDelete = async (a: TicketAttachment) => {
    if (!window.confirm(`Supprimer « ${a.filename} » ?`)) return
    try {
      await api.delete(`/tickets/attachments/${a.id}`)
      toast.success('Pièce jointe supprimée')
      onChanged()
    } catch {
      toast.error('Erreur lors de la suppression')
    }
  }

  return (
    <div className="card">
      <div className="card-header flex items-center justify-between">
        <h3 className="font-semibold text-slate-800 flex items-center gap-2">
          <Paperclip className="w-4 h-4" />
          Pièces jointes
          <span className="text-xs text-slate-400">({ticket.attachments.length})</span>
        </h3>
        {canEdit && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept=".png,.jpg,.jpeg,.gif,.webp,.pdf,.txt,.csv,.log,.doc,.docx,.xls,.xlsx,.zip"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleUpload(f) }}
            />
            <button
              className="btn-secondary btn-sm flex items-center gap-1.5"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
            >
              {uploading ? <Spinner className="w-3.5 h-3.5" /> : <Upload className="w-3.5 h-3.5" />}
              Ajouter
            </button>
          </>
        )}
      </div>
      {ticket.attachments.length === 0 ? (
        <div className="py-6 text-center text-sm text-slate-400">Aucune pièce jointe (10 Mo max — images, PDF, documents)</div>
      ) : (
        <div className="divide-y divide-slate-100">
          {ticket.attachments.map(a => (
            <div key={a.id} className="px-4 py-2.5 flex items-center gap-3">
              <Paperclip className="w-4 h-4 text-slate-300 shrink-0" />
              <button
                className="flex-1 min-w-0 text-left group"
                onClick={() => handleDownload(a)}
                title="Télécharger"
              >
                <p className="text-sm text-slate-800 truncate group-hover:text-indigo-600 group-hover:underline">{a.filename}</p>
                <p className="text-xs text-slate-400">
                  {formatFileSize(a.size)}
                  {a.uploadedBy && ` · ${a.uploadedBy.firstName} ${a.uploadedBy.lastName}`}
                  {` · ${formatRelative(a.createdAt)}`}
                </p>
              </button>
              <button
                className="btn-ghost btn-sm p-1.5 rounded-lg text-slate-400 hover:text-indigo-600"
                onClick={() => handleDownload(a)}
                title="Télécharger"
              >
                <Download className="w-3.5 h-3.5" />
              </button>
              {canEdit && (
                <button
                  className="btn-ghost btn-sm p-1.5 rounded-lg text-red-300 hover:text-red-600"
                  onClick={() => handleDelete(a)}
                  title="Supprimer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Modal Formulaire ────────────────────────────────────────────────────────

interface TicketFormModalProps {
  open: boolean
  onClose: () => void
  ticket?: Ticket
  onSuccess: () => void
}

function TicketFormModal({ open, onClose, ticket, onSuccess }: TicketFormModalProps) {
  const perms = usePermissions(['tickets:assign', 'contacts:create', 'companies:create'])
  const refs = useReferences()
  const canAssign = perms['tickets:assign']
  const canCreateContact = perms['contacts:create']
  const canCreateCompany = perms['companies:create']

  const defaults = (t?: Ticket): TicketForm => t ? {
    title: t.title,
    description: t.description,
    category: t.category,
    priority: t.priority,
    contactId: t.contactId || '',
    companyId: t.companyId || '',
    assignedToId: t.assignedToId || '',
  } : { title: '', description: '', priority: 'NORMAL', category: 'OTHER', contactId: '', companyId: '', assignedToId: '' }

  const { register, handleSubmit, reset, setValue, control, formState: { errors, isSubmitting } } = useForm<TicketForm>({
    resolver: zodResolver(ticketSchema),
    defaultValues: defaults(ticket),
  })
  const contactId = useWatch({ control, name: 'contactId' })
  const companyId = useWatch({ control, name: 'companyId' })

  // Libellés des sélections : dérivés du ticket édité ou de la dernière option choisie
  // companyId : entreprise du contact sélectionné (connue une fois le contact choisi via la recherche),
  // utilisée pour réinitialiser le contact si l'entreprise est ensuite changée pour une autre incompatible.
  const [pickedContact, setPickedContact] = useState<{ id: string; label: string; companyId: string | null } | null>(null)
  const [pickedCompany, setPickedCompany] = useState<{ id: string; label: string } | null>(null)
  const contactLabel = contactId
    ? pickedContact?.id === contactId
      ? pickedContact.label
      : ticket?.contactId === contactId && ticket?.contact
        ? `${ticket.contact.firstName} ${ticket.contact.lastName}`
        : undefined
    : undefined
  const companyLabel = companyId
    ? pickedCompany?.id === companyId
      ? pickedCompany.label
      : ticket?.companyId === companyId
        ? ticket?.company?.name
        : undefined
    : undefined

  // Reset quand la modal s'ouvre
  useEffect(() => {
    if (open) reset(defaults(ticket))
  }, [open, ticket, reset])

  const { data: usersData } = useUsersList({ enabled: open && canAssign })

  const mutation = useMutation({
    mutationFn: (values: TicketForm) => {
      // null (et non undefined) pour vider une relation côté serveur
      const payload = {
        ...values,
        contactId: values.contactId || null,
        companyId: values.companyId || null,
        assignedToId: values.assignedToId || null,
      }
      return ticket ? api.put(`/tickets/${ticket.id}`, payload) : api.post('/tickets', payload)
    },
    onSuccess: () => {
      toast.success(ticket ? 'Ticket mis à jour' : 'Ticket créé')
      onSuccess()
    },
    onError: () => toast.error('Erreur lors de l\'enregistrement'),
  })

  // Création à la volée : petits formulaires repliables sous les SearchSelect
  const [showNewContact, setShowNewContact] = useState(false)
  const [newContact, setNewContact] = useState({ firstName: '', lastName: '' })
  const [showNewCompany, setShowNewCompany] = useState(false)
  const [newCompanyName, setNewCompanyName] = useState('')

  const createContactMutation = useMutation({
    mutationFn: () => api.post('/contacts', {
      firstName: newContact.firstName.trim(),
      lastName: newContact.lastName.trim() || '—',
      companyId: companyId || undefined,
    }),
    onSuccess: ({ data }) => {
      const c = data.data as { id: string; firstName: string; lastName: string; companyId?: string | null; company?: { id: string; name: string } | null }
      setValue('contactId', c.id)
      setPickedContact({ id: c.id, label: `${c.firstName} ${c.lastName}`, companyId: c.companyId ?? null })
      if (c.company && !companyId) {
        setValue('companyId', c.company.id)
        setPickedCompany({ id: c.company.id, label: c.company.name })
      }
      setShowNewContact(false)
      setNewContact({ firstName: '', lastName: '' })
      toast.success('Contact créé')
    },
    onError: () => toast.error('Erreur lors de la création du contact'),
  })

  const createCompanyMutation = useMutation({
    mutationFn: () => api.post('/companies', { name: newCompanyName.trim() }),
    onSuccess: ({ data }) => {
      const c = data.data as { id: string; name: string }
      setValue('companyId', c.id)
      setPickedCompany({ id: c.id, label: c.name })
      setShowNewCompany(false)
      setNewCompanyName('')
      toast.success('Entreprise créée')
    },
    onError: () => toast.error('Erreur lors de la création de l\'entreprise'),
  })

  return (
    <Modal open={open} onClose={onClose} title={ticket ? 'Modifier le ticket' : 'Nouveau ticket'} size="lg">
      <form onSubmit={handleSubmit(v => mutation.mutate(v))} className="space-y-4">
        <div className="form-group">
          <label className="label">Titre *</label>
          <input {...register('title')} className={`input ${errors.title ? 'input-error' : ''}`} />
          {errors.title && <p className="form-error">{errors.title.message}</p>}
        </div>

        <div className="form-group">
          <label className="label">Description *</label>
          <textarea {...register('description')} className={`input ${errors.description ? 'input-error' : ''}`} rows={3} />
          {errors.description && <p className="form-error">{errors.description.message}</p>}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="form-group">
            <label className="label">Catégorie *</label>
            <select {...register('category')} className="input">
              {refs.options('ticket_category').map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="label">Priorité *</label>
            <select {...register('priority')} className="input">
              {Object.entries(TICKET_PRIORITIES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="form-group">
            <label className="label">Contact</label>
            <SearchSelect
              value={contactId || null}
              valueLabel={contactLabel}
              placeholder="Rechercher un contact…"
              onSearch={q => searchContacts(q, companyId || undefined)}
              onChange={(id, option) => {
                setValue('contactId', id ?? '')
                if (id && option) {
                  const meta = option.meta as ContactOptionMeta | undefined
                  setPickedContact({ id, label: option.label, companyId: meta?.companyId ?? null })
                  // Auto-remplissage de l'entreprise depuis le contact choisi
                  if (meta?.companyId) {
                    setValue('companyId', meta.companyId)
                    setPickedCompany({ id: meta.companyId, label: meta.companyName || '' })
                  }
                } else {
                  setPickedContact(null)
                }
              }}
            />
            {canCreateContact && (
              showNewContact ? (
                <div className="mt-2 p-2.5 bg-slate-50 rounded-lg border border-slate-200 space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      value={newContact.firstName}
                      onChange={e => setNewContact(v => ({ ...v, firstName: e.target.value }))}
                      placeholder="Prénom *"
                      className="input"
                      autoFocus
                    />
                    <input
                      value={newContact.lastName}
                      onChange={e => setNewContact(v => ({ ...v, lastName: e.target.value }))}
                      placeholder="Nom"
                      className="input"
                    />
                  </div>
                  <div className="flex justify-end gap-2">
                    <button type="button" className="btn-secondary text-xs px-2 py-1" onClick={() => setShowNewContact(false)}>Annuler</button>
                    <button
                      type="button"
                      className="btn-primary text-xs px-2 py-1"
                      disabled={!newContact.firstName.trim() || createContactMutation.isPending}
                      onClick={() => createContactMutation.mutate()}
                    >
                      {createContactMutation.isPending ? <Spinner className="w-3.5 h-3.5" /> : 'Créer'}
                    </button>
                  </div>
                </div>
              ) : (
                <button type="button" onClick={() => setShowNewContact(true)} className="mt-1 text-xs text-primary-600 hover:text-primary-700 inline-flex items-center gap-1">
                  <PlusCircle className="w-3.5 h-3.5" /> Nouveau contact
                </button>
              )
            )}
          </div>
          <div className="form-group">
            <label className="label">Entreprise</label>
            <SearchSelect
              value={companyId || null}
              valueLabel={companyLabel}
              placeholder="Rechercher une entreprise…"
              onSearch={searchCompanies}
              onChange={(id, option) => {
                setValue('companyId', id ?? '')
                if (id && option) setPickedCompany({ id, label: option.label })
                else setPickedCompany(null)
                // Le contact choisi appartient à une autre entreprise : incohérent, on le réinitialise
                if (id && pickedContact?.companyId && pickedContact.companyId !== id) {
                  setValue('contactId', '')
                  setPickedContact(null)
                }
              }}
            />
            {canCreateCompany && (
              showNewCompany ? (
                <div className="mt-2 p-2.5 bg-slate-50 rounded-lg border border-slate-200 space-y-2">
                  <input
                    value={newCompanyName}
                    onChange={e => setNewCompanyName(e.target.value)}
                    placeholder="Nom de l'entreprise *"
                    className="input"
                    autoFocus
                  />
                  <div className="flex justify-end gap-2">
                    <button type="button" className="btn-secondary text-xs px-2 py-1" onClick={() => setShowNewCompany(false)}>Annuler</button>
                    <button
                      type="button"
                      className="btn-primary text-xs px-2 py-1"
                      disabled={!newCompanyName.trim() || createCompanyMutation.isPending}
                      onClick={() => createCompanyMutation.mutate()}
                    >
                      {createCompanyMutation.isPending ? <Spinner className="w-3.5 h-3.5" /> : 'Créer'}
                    </button>
                  </div>
                </div>
              ) : (
                <button type="button" onClick={() => setShowNewCompany(true)} className="mt-1 text-xs text-primary-600 hover:text-primary-700 inline-flex items-center gap-1">
                  <PlusCircle className="w-3.5 h-3.5" /> Nouvelle entreprise
                </button>
              )
            )}
          </div>
        </div>

        {canAssign && (
          <div className="form-group">
            <label className="label">Technicien assigné</label>
            <select {...register('assignedToId')} className="input">
              <option value="">— Non assigné —</option>
              {usersData?.map(u => <option key={u.id} value={u.id}>{u.firstName} {u.lastName}</option>)}
            </select>
          </div>
        )}

        <div className="flex justify-end gap-3 pt-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Annuler</button>
          <button type="submit" className="btn-primary" disabled={isSubmitting || mutation.isPending}>
            {(isSubmitting || mutation.isPending) ? <Spinner className="w-4 h-4" /> : null}
            {ticket ? 'Enregistrer' : 'Créer le ticket'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

// ─── Modal Ajout de temps ────────────────────────────────────────────────────

function TimeEntryModal({ open, onClose, onSubmit }: {
  open: boolean
  onClose: () => void
  onSubmit: (values: TimeEntryForm) => void
}) {
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<TimeEntryForm>({
    resolver: zodResolver(timeEntrySchema),
    defaultValues: { minutes: 30, note: '' },
  })

  useEffect(() => {
    if (open) reset({ minutes: 30, note: '' })
  }, [open, reset])

  return (
    <Modal open={open} onClose={onClose} title="Ajouter du temps" size="sm">
      <form onSubmit={handleSubmit(v => { onSubmit(v); onClose() })} className="space-y-4">
        <div className="form-group">
          <label className="label">Durée (minutes) *</label>
          <input
            type="number"
            min={1}
            max={1440}
            {...register('minutes', { valueAsNumber: true })}
            className={`input ${errors.minutes ? 'input-error' : ''}`}
          />
          {errors.minutes && <p className="form-error">{errors.minutes.message}</p>}
        </div>
        <div className="form-group">
          <label className="label">Note</label>
          <input
            {...register('note')}
            className="input"
            placeholder="Ex : diagnostic sur site, remplacement disque…"
            maxLength={500}
          />
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Annuler</button>
          <button type="submit" className="btn-primary" disabled={isSubmitting}>
            <Clock className="w-4 h-4" /> Enregistrer
          </button>
        </div>
      </form>
    </Modal>
  )
}

// ─── Modal Intervention ──────────────────────────────────────────────────────

interface InterventionModalProps {
  open: boolean
  onClose: () => void
  ticket: TicketDetail
  currentUserId?: string
  onSuccess?: () => void
}

const DURATION_OPTIONS = [
  { value: 30, label: '30 min' },
  { value: 60, label: '1h' },
  { value: 120, label: '2h' },
  { value: 240, label: '4h' },
]

function InterventionModal({ open, onClose, ticket, currentUserId, onSuccess }: InterventionModalProps) {
  const { register, handleSubmit, reset, formState: { isSubmitting, errors } } = useForm<InterventionForm>({
    resolver: zodResolver(interventionSchema),
    defaultValues: { durationMinutes: 60 },
  })

  useEffect(() => {
    if (open) reset({ durationMinutes: 60 })
  }, [open, reset])

  const mutation = useMutation({
    mutationFn: async (values: InterventionForm) => {
      const startAt = new Date(values.startAt)
      const endAt = new Date(startAt.getTime() + values.durationMinutes * 60 * 1000)
      const contactName = ticket.contact
        ? `${ticket.contact.firstName} ${ticket.contact.lastName}`
        : null
      const companyName = ticket.company?.name ?? null
      const titleParts = ['Intervention']
      if (companyName) titleParts.push(companyName)
      if (contactName) titleParts.push(`— ${contactName}`)
      titleParts.push(`[${ticket.reference}]`)

      const payload: Record<string, unknown> = {
        title: titleParts.join(' '),
        description: ticket.title,
        type: 'INTERVENTION',
        startAt: startAt.toISOString(),
        endAt: endAt.toISOString(),
        ticketId: ticket.id,
        userIds: currentUserId ? [currentUserId] : [],
        contactIds: ticket.contactId ? [ticket.contactId] : [],
      }
      const { data } = await api.post('/appointments', payload)
      return data
    },
    onSuccess: () => {
      toast.success('Intervention planifiée')
      onSuccess?.()
      onClose()
    },
    onError: () => toast.error('Erreur lors de la création du rendez-vous'),
  })

  return (
    <Modal open={open} onClose={onClose} title="Planifier une intervention" size="sm">
      <form onSubmit={handleSubmit(v => mutation.mutate(v))} className="space-y-4">
        {/* Infos pré-remplies (lecture seule) */}
        {(ticket.contact || ticket.company) && (
          <div className="bg-slate-50 rounded-lg px-3 py-2.5 text-sm space-y-1">
            {ticket.company && (
              <div className="flex justify-between">
                <span className="text-slate-500">Entreprise</span>
                <span className="font-medium text-slate-800">{ticket.company.name}</span>
              </div>
            )}
            {ticket.contact && (
              <div className="flex justify-between">
                <span className="text-slate-500">Contact</span>
                <span className="font-medium text-slate-800">{ticket.contact.firstName} {ticket.contact.lastName}</span>
              </div>
            )}
          </div>
        )}

        <div className="form-group">
          <label className="label">Date et heure *</label>
          <input
            type="datetime-local"
            {...register('startAt')}
            className={`input ${errors.startAt ? 'input-error' : ''}`}
          />
          {errors.startAt && <p className="form-error">{errors.startAt.message}</p>}
        </div>

        <div className="form-group">
          <label className="label">Durée estimée</label>
          <select {...register('durationMinutes', { valueAsNumber: true })} className="input">
            {DURATION_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Annuler</button>
          <button type="submit" className="btn-primary" disabled={isSubmitting || mutation.isPending}>
            {(isSubmitting || mutation.isPending) ? <Spinner className="w-4 h-4" /> : <CalendarPlus className="w-4 h-4" />}
            Planifier
          </button>
        </div>
      </form>
    </Modal>
  )
}
