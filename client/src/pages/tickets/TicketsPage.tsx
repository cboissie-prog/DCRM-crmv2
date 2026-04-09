import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams, useLocation, useSearchParams } from 'react-router-dom'
import api from '../../lib/api'
import {
  formatDate, formatDateTime, formatRelative,
  TICKET_STATUSES, TICKET_PRIORITIES, TICKET_CATEGORIES,
} from '../../lib/utils'
import { Badge } from '../../components/ui/Badge'
import { Avatar } from '../../components/ui/Avatar'
import { PageSpinner, Spinner } from '../../components/ui/Spinner'
import { Modal } from '../../components/ui/Modal'
import { toast } from '../../components/ui/Toast'
import {
  Plus, Search, ArrowLeft, Clock, MessageSquare,
  ChevronDown, Send, Lock, Unlock, Trash2, Edit2, Timer, Download, X,
} from 'lucide-react'
import { downloadCsv } from '../../lib/exportCsv'
import { useForm, type Resolver } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useAuthStore } from '../../store/authStore'
import type { Ticket, TicketComment, PaginatedResponse } from '../../types'

// ─── Schémas ────────────────────────────────────────────────────────────────

const ticketSchema = z.object({
  title: z.string().min(1, 'Titre requis'),
  description: z.string().min(1, 'Description requise'),
  category: z.string().min(1, 'Catégorie requise'),
  priority: z.string().min(1, 'Priorité requise'),
  contactId: z.string().optional(),
  companyId: z.string().optional(),
  contractId: z.string().optional(),
  equipmentId: z.string().optional(),
  assignedToId: z.string().optional(),
})
type TicketForm = z.infer<typeof ticketSchema>

const commentSchema = z.object({
  content: z.string().min(1, 'Commentaire requis'),
  isInternal: z.boolean().default(false),
})
type CommentForm = z.infer<typeof commentSchema>

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatTime(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m > 0 ? `${h}h ${m}min` : `${h}h`
}

// ─── Page liste ─────────────────────────────────────────────────────────────

export function TicketsPage() {
  const location = useLocation()

  // Détail inline si on vient de /tickets/:id via React Router
  const isDetailRoute = location.pathname !== '/tickets'

  if (isDetailRoute) return null // Géré par <Route path="/tickets/:id" />

  return <TicketsListView />
}

export function TicketsListView() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { user } = useAuthStore()
  const [searchParams] = useSearchParams()

  const [search, setSearch] = useState(searchParams.get('search') ?? '')
  const [statusFilter, setStatusFilter] = useState(searchParams.get('status') ?? '')
  const [priorityFilter, setPriorityFilter] = useState(searchParams.get('priority') ?? '')
  const [categoryFilter, setCategoryFilter] = useState(searchParams.get('category') ?? '')
  const [assignedFilter, setAssignedFilter] = useState(searchParams.get('assignedToId') ?? '')
  const [page, setPage] = useState(1)
  const [showCreate, setShowCreate] = useState(false)

  const { data, isLoading } = useQuery<PaginatedResponse<Ticket>>({
    queryKey: ['tickets', { search, statusFilter, priorityFilter, categoryFilter, assignedFilter, page }],
    queryFn: async () => {
      const { data } = await api.get('/tickets', {
        params: {
          search: search || undefined,
          status: statusFilter || undefined,
          priority: priorityFilter || undefined,
          category: categoryFilter || undefined,
          assignedToId: assignedFilter || undefined,
          page,
          limit: 25,
        },
      })
      return data
    },
    staleTime: 30_000,
  })

  const { data: usersData } = useQuery({
    queryKey: ['users-list'],
    queryFn: async () => { const { data } = await api.get('/users'); return data.data as { id: string; firstName: string; lastName: string }[] },
    staleTime: 60_000,
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/tickets/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tickets'] }); toast.success('Ticket supprimé') },
    onError: () => toast.error('Erreur lors de la suppression'),
  })

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (window.confirm('Supprimer ce ticket ?')) deleteMutation.mutate(id)
  }

  const canManage = user?.role === 'ADMIN' || user?.role === 'MANAGER'

  return (
    <div className="space-y-5 fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Tickets SAV</h1>
          <p className="page-subtitle">{data?.meta.total || 0} tickets</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="btn-secondary flex items-center gap-1.5"
            onClick={() => downloadCsv('/tickets/export/csv', { status: statusFilter || undefined, priority: priorityFilter || undefined, category: categoryFilter || undefined }, `tickets-${new Date().toISOString().slice(0,10)}.csv`)}
            title="Exporter en CSV"
          >
            <Download className="w-4 h-4" /> CSV
          </button>
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
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1) }}
          />
        </div>
        <select className="input w-auto" value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1) }}>
          <option value="">Tous les statuts</option>
          {Object.entries(TICKET_STATUSES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <select className="input w-auto" value={priorityFilter} onChange={e => { setPriorityFilter(e.target.value); setPage(1) }}>
          <option value="">Toutes priorités</option>
          {Object.entries(TICKET_PRIORITIES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <select className="input w-auto" value={categoryFilter} onChange={e => { setCategoryFilter(e.target.value); setPage(1) }}>
          <option value="">Toutes catégories</option>
          {Object.entries(TICKET_CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        {canManage && usersData && (
          <select className="input w-auto" value={assignedFilter} onChange={e => { setAssignedFilter(e.target.value); setPage(1) }}>
            <option value="">Tous les techniciens</option>
            {usersData.map(u => <option key={u.id} value={u.id}>{u.firstName} {u.lastName}</option>)}
          </select>
        )}
        {(search || statusFilter || priorityFilter || categoryFilter || assignedFilter) && (
          <button
            className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800 border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white hover:bg-slate-50 transition-colors"
            onClick={() => { setSearch(''); setStatusFilter(''); setPriorityFilter(''); setCategoryFilter(''); setAssignedFilter(''); setPage(1) }}
          >
            <X className="w-3 h-3" /> Réinitialiser
          </button>
        )}
      </div>

      {/* Table */}
      {isLoading ? <PageSpinner /> : (
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Référence</th>
                <th>Titre</th>
                <th>Entreprise / Contact</th>
                <th>Priorité</th>
                <th>Statut</th>
                <th>Technicien</th>
                <th>Créé le</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data?.data.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-12 text-slate-400">Aucun ticket trouvé</td></tr>
              ) : data?.data.map(t => (
                <tr key={t.id} className="cursor-pointer" onClick={() => navigate(`/tickets/${t.id}`)}>
                  <td>
                    <span className="font-mono text-xs text-slate-500">{t.reference}</span>
                  </td>
                  <td>
                    <p className="font-medium text-slate-900 max-w-xs truncate">{t.title}</p>
                    <p className="text-xs text-slate-400">{TICKET_CATEGORIES[t.category] || t.category}</p>
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
                  <td>
                    <Badge variant={TICKET_STATUSES[t.status]?.color || 'badge-gray'}>
                      {TICKET_STATUSES[t.status]?.label || t.status}
                    </Badge>
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
                      {canManage && (
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

// ─── Page détail ─────────────────────────────────────────────────────────────

export function TicketDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { user } = useAuthStore()

  const [showEdit, setShowEdit] = useState(false)
  const [showStatusMenu, setShowStatusMenu] = useState(false)
  const [timerRunning, setTimerRunning] = useState(false)
  const [timerSeconds, setTimerSeconds] = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const { data: ticket, isLoading } = useQuery({
    queryKey: ['ticket', id],
    queryFn: async () => { const { data } = await api.get(`/tickets/${id}`); return data.data as Ticket & { comments: TicketComment[] } },
    enabled: !!id,
  })

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
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['ticket', id] }); qc.invalidateQueries({ queryKey: ['tickets'] }); setShowStatusMenu(false); toast.success('Statut mis à jour') },
    onError: () => toast.error('Erreur lors de la mise à jour'),
  })

  const timeMutation = useMutation({
    mutationFn: (minutes: number) => api.patch(`/tickets/${id}/time`, { minutes }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['ticket', id] }); toast.success('Temps enregistré') },
    onError: () => toast.error('Erreur lors de l\'enregistrement du temps'),
  })

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/tickets/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tickets'] }); toast.success('Ticket supprimé'); navigate('/tickets') },
    onError: () => toast.error('Erreur lors de la suppression'),
  })

  const handleStopTimer = () => {
    setTimerRunning(false)
    const minutes = Math.round(timerSeconds / 60)
    if (minutes > 0) {
      timeMutation.mutate(minutes)
    }
    setTimerSeconds(0)
  }

  const { register: regComment, handleSubmit: handleComment, reset: resetComment, watch: watchComment, formState: { isSubmitting: submittingComment } } = useForm<CommentForm>({
    resolver: zodResolver(commentSchema) as Resolver<CommentForm>,
    defaultValues: { isInternal: false },
  })

  const addCommentMutation = useMutation({
    mutationFn: (values: CommentForm) => api.post(`/tickets/${id}/comments`, values),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['ticket', id] }); resetComment({ content: '', isInternal: false }); toast.success('Commentaire ajouté') },
    onError: () => toast.error('Erreur lors de l\'ajout du commentaire'),
  })

  const canManage = user?.role === 'ADMIN' || user?.role === 'MANAGER'

  if (isLoading) return <PageSpinner />
  if (!ticket) return <div className="p-8 text-center text-slate-500">Ticket introuvable</div>

  const timerDisplay = `${String(Math.floor(timerSeconds / 3600)).padStart(2, '0')}:${String(Math.floor((timerSeconds % 3600) / 60)).padStart(2, '0')}:${String(timerSeconds % 60).padStart(2, '0')}`

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
        <div className="flex items-center gap-2">
          {/* Chronomètre */}
          <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
            <Timer className="w-4 h-4 text-slate-400" />
            <span className="font-mono text-sm text-slate-700">{timerDisplay}</span>
            {!timerRunning ? (
              <button
                className="btn-primary btn-sm text-xs px-2 py-1"
                onClick={() => setTimerRunning(true)}
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
          {canManage && (
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
                <span className="text-slate-800 font-medium">{TICKET_CATEGORIES[ticket.category] || ticket.category}</span>
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
                <div className="flex justify-between">
                  <span className="text-slate-500">SLA</span>
                  <span className="text-slate-800 font-medium">{formatDateTime(ticket.slaDeadline)}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-slate-500">Temps passé</span>
                <div className="flex items-center gap-1 text-slate-800 font-medium">
                  <Clock className="w-3.5 h-3.5 text-slate-400" />
                  {formatTime(ticket.timeSpent)}
                </div>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Créé le</span>
                <span className="text-slate-800">{formatDate(ticket.createdAt)}</span>
              </div>
              {ticket.resolvedAt && (
                <div className="flex justify-between">
                  <span className="text-slate-500">Résolu le</span>
                  <span className="text-slate-800">{formatDate(ticket.resolvedAt)}</span>
                </div>
              )}
            </div>
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

          {/* Commentaires */}
          <div className="card">
            <div className="card-header">
              <h3 className="font-semibold text-slate-800 flex items-center gap-2">
                <MessageSquare className="w-4 h-4" />
                Commentaires
                {'_count' in ticket && <span className="text-xs text-slate-400">({(ticket as Ticket & { comments: TicketComment[] }).comments?.length ?? 0})</span>}
              </h3>
            </div>

            {/* Liste commentaires */}
            <div className="divide-y divide-slate-100">
              {(ticket as Ticket & { comments: TicketComment[] }).comments?.length === 0 ? (
                <div className="py-8 text-center text-sm text-slate-400">Aucun commentaire</div>
              ) : (ticket as Ticket & { comments: TicketComment[] }).comments?.map(c => (
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
                      {watchComment('isInternal') ? <Lock className="w-3.5 h-3.5 text-amber-500" /> : <Unlock className="w-3.5 h-3.5 text-slate-400" />}
                      Commentaire interne
                    </span>
                  </label>
                  <button type="submit" className="btn-primary btn-sm" disabled={submittingComment}>
                    {submittingComment ? <Spinner className="w-3.5 h-3.5" /> : <Send className="w-3.5 h-3.5" />}
                    Envoyer
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      </div>

      {/* Modal édition */}
      <TicketFormModal
        open={showEdit}
        onClose={() => setShowEdit(false)}
        ticket={ticket}
        onSuccess={() => { qc.invalidateQueries({ queryKey: ['ticket', id] }); qc.invalidateQueries({ queryKey: ['tickets'] }); setShowEdit(false) }}
      />
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
  const { user } = useAuthStore()
  const canAssign = user?.role === 'ADMIN' || user?.role === 'MANAGER'

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<TicketForm>({
    resolver: zodResolver(ticketSchema),
    defaultValues: ticket ? {
      title: ticket.title,
      description: ticket.description,
      category: ticket.category,
      priority: ticket.priority,
      contactId: ticket.contactId || '',
      companyId: ticket.companyId || '',
      contractId: ticket.contractId || '',
      equipmentId: ticket.equipmentId || '',
      assignedToId: ticket.assignedToId || '',
    } : { priority: 'NORMAL', category: 'OTHER' },
  })

  // Reset quand la modal s'ouvre
  useEffect(() => {
    if (open) {
      reset(ticket ? {
        title: ticket.title,
        description: ticket.description,
        category: ticket.category,
        priority: ticket.priority,
        contactId: ticket.contactId || '',
        companyId: ticket.companyId || '',
        contractId: ticket.contractId || '',
        equipmentId: ticket.equipmentId || '',
        assignedToId: ticket.assignedToId || '',
      } : { priority: 'NORMAL', category: 'OTHER' })
    }
  }, [open, ticket, reset])

  const { data: contactsData } = useQuery({
    queryKey: ['contacts-select'],
    queryFn: async () => { const { data } = await api.get('/contacts', { params: { limit: 100 } }); return data.data as { id: string; firstName: string; lastName: string }[] },
    staleTime: 60_000,
    enabled: open,
  })

  const { data: companiesData } = useQuery({
    queryKey: ['companies-select'],
    queryFn: async () => { const { data } = await api.get('/companies', { params: { limit: 100 } }); return data.data as { id: string; name: string }[] },
    staleTime: 60_000,
    enabled: open,
  })

  const { data: usersData } = useQuery({
    queryKey: ['users-list'],
    queryFn: async () => { const { data } = await api.get('/users'); return data.data as { id: string; firstName: string; lastName: string }[] },
    staleTime: 60_000,
    enabled: open && canAssign,
  })

  const mutation = useMutation({
    mutationFn: (values: TicketForm) => {
      const payload = {
        ...values,
        contactId: values.contactId || undefined,
        companyId: values.companyId || undefined,
        contractId: values.contractId || undefined,
        equipmentId: values.equipmentId || undefined,
        assignedToId: values.assignedToId || undefined,
      }
      return ticket ? api.put(`/tickets/${ticket.id}`, payload) : api.post('/tickets', payload)
    },
    onSuccess: () => {
      toast.success(ticket ? 'Ticket mis à jour' : 'Ticket créé')
      onSuccess()
    },
    onError: () => toast.error('Erreur lors de l\'enregistrement'),
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

        <div className="grid grid-cols-2 gap-4">
          <div className="form-group">
            <label className="label">Catégorie *</label>
            <select {...register('category')} className="input">
              {Object.entries(TICKET_CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="label">Priorité *</label>
            <select {...register('priority')} className="input">
              {Object.entries(TICKET_PRIORITIES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="form-group">
            <label className="label">Contact</label>
            <select {...register('contactId')} className="input">
              <option value="">— Aucun —</option>
              {contactsData?.map(c => <option key={c.id} value={c.id}>{c.firstName} {c.lastName}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="label">Entreprise</label>
            <select {...register('companyId')} className="input">
              <option value="">— Aucune —</option>
              {companiesData?.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
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
          <button type="submit" className="btn-primary" disabled={isSubmitting}>
            {isSubmitting ? <Spinner className="w-4 h-4" /> : null}
            {ticket ? 'Enregistrer' : 'Créer le ticket'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
