import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import api from '../../lib/api'
import {
  formatDate, formatDateTime, formatRelative, formatDuration,
  CALL_DIRECTIONS, CALL_STATUSES, CALL_CATEGORIES, CALL_PRIORITIES,
  TICKET_CATEGORIES, TICKET_PRIORITIES,
} from '../../lib/utils'
import { Badge } from '../../components/ui/Badge'
import { Avatar } from '../../components/ui/Avatar'
import { PageSpinner, Spinner } from '../../components/ui/Spinner'
import { Modal } from '../../components/ui/Modal'
import { toast } from '../../components/ui/Toast'
import {
  Phone, PhoneIncoming, PhoneOutgoing, PhoneMissed,
  Plus, Search, X, Edit2, Trash2, ArrowLeft,
  Upload, FileText, Ticket, TrendingUp, Calendar,
  Download, Clock, Building2, User, ChevronDown,
} from 'lucide-react'
import { useForm, type Resolver } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useAuthStore } from '../../store/authStore'
import type { Call, PaginatedResponse } from '../../types'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function DirectionIcon({ direction }: { direction: string }) {
  if (direction === 'OUTBOUND') return <PhoneOutgoing className="w-3.5 h-3.5" />
  return <PhoneIncoming className="w-3.5 h-3.5" />
}

// ─── Page liste ───────────────────────────────────────────────────────────────

export function CallsPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { user } = useAuthStore()
  const [search, setSearch]       = useState('')
  const [dirFilter, setDirFilter] = useState('')
  const [statusFilter, setStatus] = useState('')
  const [catFilter, setCat]       = useState('')
  const [dateFrom, setDateFrom]   = useState('')
  const [dateTo, setDateTo]       = useState('')
  const [page, setPage]           = useState(1)
  const [showCreate, setShowCreate] = useState(false)

  const { data, isLoading } = useQuery<PaginatedResponse<Call>>({
    queryKey: ['calls', { search, dirFilter, statusFilter, catFilter, dateFrom, dateTo, page }],
    queryFn: async () => {
      const { data } = await api.get('/calls', {
        params: {
          search:    search    || undefined,
          direction: dirFilter || undefined,
          status:    statusFilter || undefined,
          category:  catFilter || undefined,
          dateFrom:  dateFrom  || undefined,
          dateTo:    dateTo    || undefined,
          page,
          limit: 25,
        },
      })
      return data
    },
    staleTime: 15_000,
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/calls/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['calls'] }); toast.success('Appel supprimé') },
    onError: () => toast.error('Erreur lors de la suppression'),
  })

  const canManage  = user?.role === 'ADMIN' || user?.role === 'MANAGER'
  const hasFilters = !!(search || dirFilter || statusFilter || catFilter || dateFrom || dateTo)

  const resetFilters = () => {
    setSearch(''); setDirFilter(''); setStatus(''); setCat('')
    setDateFrom(''); setDateTo(''); setPage(1)
  }

  return (
    <div className="space-y-5 fade-in">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Appels téléphoniques</h1>
          <p className="page-subtitle">{data?.meta.total ?? 0} appels</p>
        </div>
        <button className="btn-primary" onClick={() => setShowCreate(true)}>
          <Plus className="w-4 h-4" /> Nouvel appel
        </button>
      </div>

      {/* Filtres */}
      <div className="flex gap-3 flex-wrap items-center">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            className="input pl-9"
            placeholder="Numéro, nom, notes..."
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1) }}
          />
        </div>
        <select className="input flex-none w-36" value={dirFilter} onChange={e => { setDirFilter(e.target.value); setPage(1) }}>
          <option value="">Direction</option>
          {Object.entries(CALL_DIRECTIONS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <select className="input flex-none w-36" value={statusFilter} onChange={e => { setStatus(e.target.value); setPage(1) }}>
          <option value="">Statut</option>
          {Object.entries(CALL_STATUSES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <select className="input flex-none w-40" value={catFilter} onChange={e => { setCat(e.target.value); setPage(1) }}>
          <option value="">Catégorie</option>
          {Object.entries(CALL_CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <div className="flex items-center gap-1.5 flex-none">
          <input type="date" className="input w-36 text-xs" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(1) }} />
          <span className="text-slate-400 text-xs">→</span>
          <input type="date" className="input w-36 text-xs" value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(1) }} />
        </div>
        {hasFilters && (
          <button
            className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800 border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white hover:bg-slate-50 transition-colors"
            onClick={resetFilters}
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
                <th></th>
                <th>Date / Heure</th>
                <th>Appelant</th>
                <th>Entreprise</th>
                <th>Direction</th>
                <th>Statut</th>
                <th>Catégorie</th>
                <th>Durée</th>
                <th>Assigné</th>
                <th>Tickets</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data?.data.length === 0 ? (
                <tr><td colSpan={10} className="text-center py-12 text-slate-400">Aucun appel trouvé</td></tr>
              ) : data?.data.map(call => (
                <tr
                  key={call.id}
                  className={`cursor-pointer ${call.status === 'MISSED' ? 'bg-red-50/40 hover:bg-red-50' : ''}`}
                  onClick={() => navigate(`/calls/${call.id}`)}
                >
                  <td onClick={e => e.stopPropagation()}>
                    <button
                      className="flex items-center justify-center w-full"
                      title={call.isHandled ? 'Traité — cliquer pour marquer non traité' : 'Non traité — cliquer pour marquer traité'}
                      onClick={() => api.put(`/calls/${call.id}`, { isHandled: !call.isHandled }).then(() => qc.invalidateQueries({ queryKey: ['calls'] }))}
                    >
                      <span className={`w-2.5 h-2.5 rounded-full ${call.isHandled ? 'bg-emerald-500' : 'bg-red-400'}`} />
                    </button>
                  </td>
                  <td>
                    <div className="text-sm font-medium text-slate-800">{formatDateTime(call.startedAt)}</div>
                    <div className="text-xs text-slate-400">{formatRelative(call.startedAt)}</div>
                  </td>
                  <td>
                    <div className="flex items-center gap-1.5">
                      {call.status === 'MISSED' && <PhoneMissed className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />}
                      <div>
                        <p className="text-sm font-medium text-slate-800 font-mono">{call.callerNumber}</p>
                        {call.callerName && <p className="text-xs text-slate-500">{call.callerName}</p>}
                        {call.contact && <p className="text-xs text-primary-600">{call.contact.firstName} {call.contact.lastName}</p>}
                      </div>
                    </div>
                  </td>
                  <td>
                    {call.company
                      ? <span className="text-sm text-slate-700">{call.company.name}</span>
                      : <span className="text-slate-300">—</span>}
                  </td>
                  <td>
                    <Badge variant={CALL_DIRECTIONS[call.direction]?.color ?? 'badge-gray'}>
                      <span className="flex items-center gap-1">
                        <DirectionIcon direction={call.direction} />
                        {CALL_DIRECTIONS[call.direction]?.label ?? call.direction}
                      </span>
                    </Badge>
                  </td>
                  <td>
                    <Badge variant={CALL_STATUSES[call.status]?.color ?? 'badge-gray'}>
                      {CALL_STATUSES[call.status]?.label ?? call.status}
                    </Badge>
                  </td>
                  <td>
                    {call.category
                      ? <span className="text-xs text-slate-600">{CALL_CATEGORIES[call.category] ?? call.category}</span>
                      : <span className="text-slate-300">—</span>}
                  </td>
                  <td>
                    <span className="text-sm text-slate-600 font-mono">{formatDuration(call.duration)}</span>
                  </td>
                  <td>
                    {call.assignedTo
                      ? <div className="flex items-center gap-1.5">
                          <Avatar firstName={call.assignedTo.firstName} lastName={call.assignedTo.lastName} size="sm" />
                          <span className="text-xs text-slate-600">{call.assignedTo.firstName}</span>
                        </div>
                      : <span className="text-slate-300 text-xs">—</span>}
                  </td>
                  <td>
                    {(call._count?.tickets ?? 0) > 0
                      ? <span className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full">
                          <Ticket className="w-3 h-3" /> {call._count!.tickets}
                        </span>
                      : <span className="text-slate-300 text-xs">—</span>}
                  </td>
                  <td>
                    <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                      <button
                        className="btn-ghost p-1.5 rounded-lg"
                        onClick={() => navigate(`/calls/${call.id}`)}
                        title="Voir le détail"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      {canManage && (
                        <button
                          className="btn-ghost p-1.5 rounded-lg text-red-400 hover:text-red-600"
                          onClick={() => { if (window.confirm('Supprimer cet appel ?')) deleteMutation.mutate(call.id) }}
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
          <span>{(page - 1) * 25 + 1}–{Math.min(page * 25, data.meta.total)} sur {data.meta.total}</span>
          <div className="flex gap-2">
            <button className="btn-secondary btn-sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Précédent</button>
            <button className="btn-secondary btn-sm" disabled={page * 25 >= data.meta.total} onClick={() => setPage(p => p + 1)}>Suivant</button>
          </div>
        </div>
      )}

      <CallFormModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onSuccess={() => { qc.invalidateQueries({ queryKey: ['calls'] }); setShowCreate(false) }}
      />
    </div>
  )
}

// ─── Page détail ──────────────────────────────────────────────────────────────

export function CallDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { user } = useAuthStore()
  const [showEdit, setShowEdit]           = useState(false)
  const [showTicketModal, setShowTicket]  = useState(false)
  const [showLeadModal, setShowLead]      = useState(false)
  const [activeTab, setActiveTab]         = useState<'info' | 'notes' | 'recording'>('info')
  const [showStatusMenu, setShowStatusMenu] = useState(false)

  const { data: callData, isLoading } = useQuery({
    queryKey: ['call', id],
    queryFn: async () => { const { data } = await api.get(`/calls/${id}`); return data.data as Call },
    enabled: !!id,
  })

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/calls/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['calls'] }); toast.success('Appel supprimé'); navigate('/calls') },
    onError: () => toast.error('Erreur lors de la suppression'),
  })

  const statusMutation = useMutation({
    mutationFn: (status: string) => api.put(`/calls/${id}`, { status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['call', id] })
      qc.invalidateQueries({ queryKey: ['calls'] })
      setShowStatusMenu(false)
      toast.success('Statut mis à jour')
    },
    onError: () => toast.error('Erreur lors de la mise à jour'),
  })

  const handledMutation = useMutation({
    mutationFn: (isHandled: boolean) => api.put(`/calls/${id}`, { isHandled }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['call', id] })
      qc.invalidateQueries({ queryKey: ['calls'] })
    },
    onError: () => toast.error('Erreur lors de la mise à jour'),
  })

  const canManage = user?.role === 'ADMIN' || user?.role === 'MANAGER'
  const call = callData

  if (isLoading) return <PageSpinner />
  if (!call) return <div className="p-8 text-center text-slate-500">Appel introuvable</div>

  return (
    <div className="space-y-5 fade-in">
      {/* Header */}
      <div className="flex items-start gap-3">
        <button onClick={() => navigate('/calls')} className="btn-ghost btn-sm p-2 rounded-lg mt-0.5">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            {/* Statut cliquable */}
            <div className="relative">
              <button
                className="btn-secondary flex items-center gap-1.5 px-2 py-1 text-xs"
                onClick={() => setShowStatusMenu(s => !s)}
              >
                <Badge variant={CALL_STATUSES[call.status]?.color ?? 'badge-gray'}>
                  {CALL_STATUSES[call.status]?.label ?? call.status}
                </Badge>
                <ChevronDown className="w-3 h-3 text-slate-400" />
              </button>
              {showStatusMenu && (
                <div className="absolute left-0 top-full mt-1 bg-white rounded-xl shadow-lg border border-slate-100 py-1 z-10 min-w-44">
                  {Object.entries(CALL_STATUSES).map(([k, v]) => (
                    <button
                      key={k}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 flex items-center gap-2"
                      onClick={() => statusMutation.mutate(k)}
                    >
                      <Badge variant={v.color}>{v.label}</Badge>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <Badge variant={CALL_DIRECTIONS[call.direction]?.color ?? 'badge-gray'}>
              <span className="flex items-center gap-1">
                <DirectionIcon direction={call.direction} />
                {CALL_DIRECTIONS[call.direction]?.label ?? call.direction}
              </span>
            </Badge>
            {call.category && (
              <Badge variant="badge-gray">{CALL_CATEGORIES[call.category] ?? call.category}</Badge>
            )}
            {call.priority && call.priority !== 'NORMAL' && (
              <Badge variant={CALL_PRIORITIES[call.priority]?.color ?? 'badge-gray'}>
                {CALL_PRIORITIES[call.priority]?.label ?? call.priority}
              </Badge>
            )}
            {/* Toggle traité / non traité */}
            <button
              className={`flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full border transition-colors ${
                call.isHandled
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                  : 'bg-red-50 text-red-600 border-red-200 hover:bg-red-100'
              }`}
              onClick={() => handledMutation.mutate(!call.isHandled)}
              title={call.isHandled ? 'Marquer comme non traité' : 'Marquer comme traité'}
            >
              <span className={`w-2 h-2 rounded-full ${call.isHandled ? 'bg-emerald-500' : 'bg-red-400'}`} />
              {call.isHandled ? 'Traité' : 'Non traité'}
            </button>
          </div>
          <h1 className="page-title">
            {call.callerName ?? call.callerNumber}
            <span className="text-slate-400 font-normal text-lg ml-2">— {formatDateTime(call.startedAt)}</span>
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            className="btn-secondary flex items-center gap-1.5"
            onClick={() => setShowTicket(true)}
          >
            <Ticket className="w-4 h-4" /> Créer un ticket
          </button>
          <button
            className="btn-secondary flex items-center gap-1.5"
            onClick={() => setShowLead(true)}
          >
            <TrendingUp className="w-4 h-4" /> Créer un lead
          </button>
          <button className="btn-secondary" onClick={() => setShowEdit(true)}>
            <Edit2 className="w-4 h-4" /> Modifier
          </button>
          {canManage && (
            <button
              className="btn-ghost text-red-400 hover:text-red-600 p-2 rounded-lg"
              onClick={() => { if (window.confirm('Supprimer cet appel ?')) deleteMutation.mutate() }}
              title="Supprimer"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Onglets */}
      <div className="border-b border-slate-200">
        <div className="flex gap-1">
          {(['info', 'notes', 'recording'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2.5 text-sm font-medium transition-colors ${
                activeTab === tab
                  ? 'text-primary-700 border-b-2 border-primary-600'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {tab === 'info' ? 'Informations' : tab === 'notes' ? 'Notes / Transcription' : 'Enregistrement'}
            </button>
          ))}
        </div>
      </div>

      {/* Onglet Informations */}
      {activeTab === 'info' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Colonne infos */}
          <div className="space-y-4">
            <div className="card card-body">
              <h3 className="text-sm font-semibold text-slate-700 mb-3">Téléphonie</h3>
              <dl className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <dt className="text-slate-500">Numéro appelant</dt>
                  <dd className="font-mono font-medium text-slate-800">{call.callerNumber}</dd>
                </div>
                {call.callerName && (
                  <div className="flex justify-between">
                    <dt className="text-slate-500">Nom</dt>
                    <dd className="text-slate-800">{call.callerName}</dd>
                  </div>
                )}
                {call.receiverNumber && (
                  <div className="flex justify-between">
                    <dt className="text-slate-500">Numéro appelé</dt>
                    <dd className="font-mono text-slate-800">{call.receiverNumber}</dd>
                  </div>
                )}
                <div className="flex justify-between">
                  <dt className="text-slate-500">Début</dt>
                  <dd className="text-slate-800">{formatDateTime(call.startedAt)}</dd>
                </div>
                {call.endedAt && (
                  <div className="flex justify-between">
                    <dt className="text-slate-500">Fin</dt>
                    <dd className="text-slate-800">{formatDateTime(call.endedAt)}</dd>
                  </div>
                )}
                <div className="flex justify-between items-center">
                  <dt className="text-slate-500 flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> Durée</dt>
                  <dd className="font-mono font-medium text-slate-800">{formatDuration(call.duration)}</dd>
                </div>
              </dl>
            </div>

            <div className="card card-body">
              <h3 className="text-sm font-semibold text-slate-700 mb-3">Interlocuteur</h3>
              <dl className="space-y-3 text-sm">
                {call.contact ? (
                  <div className="flex justify-between items-center">
                    <dt className="text-slate-500 flex items-center gap-1"><User className="w-3.5 h-3.5" /> Contact</dt>
                    <dd>
                      <button className="text-primary-600 hover:underline font-medium" onClick={() => navigate(`/contacts/${call.contact!.id}`)}>
                        {call.contact.firstName} {call.contact.lastName}
                      </button>
                    </dd>
                  </div>
                ) : (
                  <div className="flex justify-between">
                    <dt className="text-slate-500 flex items-center gap-1"><User className="w-3.5 h-3.5" /> Contact</dt>
                    <dd className="text-slate-400 italic text-xs">Non identifié</dd>
                  </div>
                )}
                {call.company ? (
                  <div className="flex justify-between items-center">
                    <dt className="text-slate-500 flex items-center gap-1"><Building2 className="w-3.5 h-3.5" /> Entreprise</dt>
                    <dd>
                      <button className="text-primary-600 hover:underline font-medium" onClick={() => navigate(`/companies/${call.company!.id}`)}>
                        {call.company.name}
                      </button>
                    </dd>
                  </div>
                ) : (
                  <div className="flex justify-between">
                    <dt className="text-slate-500 flex items-center gap-1"><Building2 className="w-3.5 h-3.5" /> Entreprise</dt>
                    <dd className="text-slate-400 italic text-xs">Non liée</dd>
                  </div>
                )}
                {call.assignedTo && (
                  <div className="flex justify-between items-center">
                    <dt className="text-slate-500">Traité par</dt>
                    <dd className="flex items-center gap-2">
                      <Avatar firstName={call.assignedTo.firstName} lastName={call.assignedTo.lastName} size="sm" />
                      <span className="font-medium text-slate-800">{call.assignedTo.firstName} {call.assignedTo.lastName}</span>
                    </dd>
                  </div>
                )}
              </dl>
            </div>
          </div>

          {/* Colonne principale */}
          <div className="lg:col-span-2 space-y-4">
            {/* Tickets liés */}
            {call.tickets && call.tickets.length > 0 && (
              <div className="card">
                <div className="card-header">
                  <h3 className="font-semibold text-slate-800 flex items-center gap-2">
                    <Ticket className="w-4 h-4" /> Tickets créés depuis cet appel
                  </h3>
                </div>
                <div className="divide-y divide-slate-100">
                  {call.tickets.map(t => (
                    <div
                      key={t.id}
                      className="flex items-center justify-between px-4 py-3 hover:bg-slate-50 cursor-pointer"
                      onClick={() => navigate(`/tickets/${t.id}`)}
                    >
                      <div>
                        <p className="text-xs font-mono text-slate-400">{t.reference}</p>
                        <p className="text-sm font-medium text-slate-800">{t.title}</p>
                      </div>
                      <Badge variant={TICKET_PRIORITIES[t.priority]?.color ?? 'badge-gray'}>
                        {TICKET_PRIORITIES[t.priority]?.label ?? t.priority}
                      </Badge>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Résumé notes si présentes */}
            {call.notes && (
              <div className="card card-body">
                <h3 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
                  <FileText className="w-4 h-4" /> Notes
                </h3>
                <p className="text-sm text-slate-600 whitespace-pre-wrap leading-relaxed">{call.notes}</p>
                <button className="mt-3 text-xs text-primary-600 hover:underline" onClick={() => setActiveTab('notes')}>
                  Modifier les notes →
                </button>
              </div>
            )}

            {!call.notes && call.tickets?.length === 0 && (
              <div className="card card-body text-center py-10">
                <Phone className="w-8 h-8 text-slate-200 mx-auto mb-3" />
                <p className="text-sm text-slate-400">Aucune action liée à cet appel pour l'instant.</p>
                <div className="flex justify-center gap-3 mt-4">
                  <button className="btn-secondary btn-sm" onClick={() => setShowTicket(true)}>
                    <Ticket className="w-3.5 h-3.5" /> Créer un ticket
                  </button>
                  <button className="btn-secondary btn-sm" onClick={() => setActiveTab('notes')}>
                    <FileText className="w-3.5 h-3.5" /> Ajouter des notes
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Onglet Notes */}
      {activeTab === 'notes' && (
        <div className="max-w-2xl">
          <NotesEditor call={call} onUpdated={() => qc.invalidateQueries({ queryKey: ['call', id] })} />
        </div>
      )}

      {/* Onglet Enregistrement */}
      {activeTab === 'recording' && (
        <div className="max-w-2xl">
          <RecordingPanel call={call} onUploaded={() => qc.invalidateQueries({ queryKey: ['call', id] })} />
        </div>
      )}

      {/* Modals */}
      <CallFormModal
        open={showEdit}
        call={call}
        onClose={() => setShowEdit(false)}
        onSuccess={() => { qc.invalidateQueries({ queryKey: ['call', id] }); qc.invalidateQueries({ queryKey: ['calls'] }); setShowEdit(false) }}
      />
      <TicketFromCallModal
        open={showTicketModal}
        call={call}
        onClose={() => setShowTicket(false)}
        onSuccess={() => { qc.invalidateQueries({ queryKey: ['call', id] }); setShowTicket(false); toast.success('Ticket créé') }}
      />
      <LeadFromCallModal
        open={showLeadModal}
        call={call}
        onClose={() => setShowLead(false)}
        onSuccess={() => { setShowLead(false); toast.success('Lead créé') }}
      />
    </div>
  )
}

// ─── Notes editor ─────────────────────────────────────────────────────────────

function NotesEditor({ call, onUpdated }: { call: Call; onUpdated: () => void }) {
  const [notes, setNotes] = useState(call.notes ?? '')
  const [saving, setSaving] = useState(false)
  const dirty = notes !== (call.notes ?? '')

  const save = async () => {
    setSaving(true)
    try {
      await api.put(`/calls/${call.id}`, { notes })
      onUpdated()
      toast.success('Notes enregistrées')
    } catch {
      toast.error('Erreur lors de l\'enregistrement')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="card card-body space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
          <FileText className="w-4 h-4" /> Notes & transcription
        </h3>
        {dirty && (
          <button className="btn-primary btn-sm" onClick={save} disabled={saving}>
            {saving ? <Spinner className="w-3.5 h-3.5" /> : null}
            Enregistrer
          </button>
        )}
      </div>
      <textarea
        className="input resize-none w-full"
        rows={16}
        placeholder="Saisissez vos notes ou la transcription de l'appel..."
        value={notes}
        onChange={e => setNotes(e.target.value)}
      />
      {dirty && <p className="text-xs text-amber-600">Modifications non enregistrées</p>}
    </div>
  )
}

// ─── Recording panel ──────────────────────────────────────────────────────────

function RecordingPanel({ call, onUploaded }: { call: Call; onUploaded: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const hasRecording = !!(call.recordingPath || call.recordingUrl)
  const streamUrl = call.recordingPath
    ? `${import.meta.env.VITE_API_URL ?? ''}/api/calls/${call.id}/recording/stream`
    : call.recordingUrl ?? undefined

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    const fd = new FormData()
    fd.append('recording', file)
    try {
      await api.post(`/calls/${call.id}/recording`, fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      onUploaded()
      toast.success('Enregistrement uploadé')
    } catch {
      toast.error('Erreur lors de l\'upload')
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <div className="card card-body space-y-4">
      <h3 className="text-sm font-semibold text-slate-700">Enregistrement audio</h3>
      {hasRecording && streamUrl ? (
        <div className="space-y-3">
          <audio controls className="w-full" src={streamUrl} />
          <div className="flex gap-2">
            <a href={streamUrl} download className="btn-secondary btn-sm flex items-center gap-1.5">
              <Download className="w-3.5 h-3.5" /> Télécharger
            </a>
            <button className="btn-secondary btn-sm flex items-center gap-1.5" onClick={() => fileRef.current?.click()}>
              <Upload className="w-3.5 h-3.5" /> Remplacer
            </button>
          </div>
        </div>
      ) : (
        <div className="border-2 border-dashed border-slate-200 rounded-xl p-8 text-center">
          <Phone className="w-8 h-8 text-slate-300 mx-auto mb-3" />
          <p className="text-sm font-medium text-slate-600 mb-1">Aucun enregistrement</p>
          <p className="text-xs text-slate-400 mb-4">
            L'enregistrement sera ajouté automatiquement par la VoIP, ou uploadez-le manuellement.
          </p>
          <button
            className="btn-primary btn-sm mx-auto"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? <Spinner className="w-3.5 h-3.5" /> : <Upload className="w-3.5 h-3.5" />}
            Uploader un fichier audio
          </button>
        </div>
      )}
      <input ref={fileRef} type="file" accept="audio/*" className="hidden" onChange={handleUpload} />
    </div>
  )
}

// ─── Modal création / édition ─────────────────────────────────────────────────

const callFormSchema = z.object({
  callerNumber:   z.string().min(1, 'Numéro requis'),
  callerName:     z.string().optional(),
  receiverNumber: z.string().optional(),
  direction:      z.string(),
  status:         z.string(),
  category:       z.string().optional(),
  priority:       z.string(),
  duration:       z.coerce.number().optional(),
  startedAt:      z.string().optional(),
  notes:          z.string().optional(),
  contactId:      z.string().optional(),
  companyId:      z.string().optional(),
  assignedToId:   z.string().optional(),
})
type CallFormData = z.infer<typeof callFormSchema>

interface CallFormModalProps {
  open: boolean
  onClose: () => void
  call?: Call
  onSuccess: () => void
}

function CallFormModal({ open, onClose, call, onSuccess }: CallFormModalProps) {
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<CallFormData>({
    resolver: zodResolver(callFormSchema) as Resolver<CallFormData>,
    defaultValues: call ? {
      callerNumber:   call.callerNumber,
      callerName:     call.callerName ?? '',
      receiverNumber: call.receiverNumber ?? '',
      direction:      call.direction,
      status:         call.status,
      category:       call.category ?? '',
      priority:       call.priority,
      duration:       call.duration,
      startedAt:      call.startedAt ? call.startedAt.slice(0, 16) : '',
      notes:          call.notes ?? '',
      contactId:      call.contactId ?? '',
      companyId:      call.companyId ?? '',
      assignedToId:   call.assignedToId ?? '',
    } : {
      direction: 'INBOUND',
      status:    'ANSWERED',
      priority:  'NORMAL',
      startedAt: new Date().toISOString().slice(0, 16),
    },
  })

  useEffect(() => {
    if (open) {
      reset(call ? {
        callerNumber:   call.callerNumber,
        callerName:     call.callerName ?? '',
        receiverNumber: call.receiverNumber ?? '',
        direction:      call.direction,
        status:         call.status,
        category:       call.category ?? '',
        priority:       call.priority,
        duration:       call.duration,
        startedAt:      call.startedAt ? call.startedAt.slice(0, 16) : '',
        notes:          call.notes ?? '',
        contactId:      call.contactId ?? '',
        companyId:      call.companyId ?? '',
        assignedToId:   call.assignedToId ?? '',
      } : {
        direction: 'INBOUND',
        status:    'ANSWERED',
        priority:  'NORMAL',
        startedAt: new Date().toISOString().slice(0, 16),
      })
    }
  }, [open, call, reset])

  const { data: contactsData } = useQuery({
    queryKey: ['contacts-select'],
    queryFn: async () => { const { data } = await api.get('/contacts', { params: { limit: 200 } }); return data.data as { id: string; firstName: string; lastName: string }[] },
    enabled: open,
    staleTime: 60_000,
  })
  const { data: companiesData } = useQuery({
    queryKey: ['companies-select'],
    queryFn: async () => { const { data } = await api.get('/companies', { params: { limit: 200 } }); return data.data as { id: string; name: string }[] },
    enabled: open,
    staleTime: 60_000,
  })
  const { data: usersData } = useQuery({
    queryKey: ['users-list'],
    queryFn: async () => { const { data } = await api.get('/users'); return data.data as { id: string; firstName: string; lastName: string }[] },
    enabled: open,
    staleTime: 60_000,
  })

  const mutation = useMutation({
    mutationFn: (values: CallFormData) => {
      const payload = {
        ...values,
        contactId:    values.contactId    || undefined,
        companyId:    values.companyId    || undefined,
        assignedToId: values.assignedToId || undefined,
        category:     values.category     || undefined,
        duration:     values.duration     || undefined,
      }
      return call ? api.put(`/calls/${call.id}`, payload) : api.post('/calls', payload)
    },
    onSuccess: () => { toast.success(call ? 'Appel mis à jour' : 'Appel créé'); onSuccess() },
    onError: () => toast.error('Erreur lors de l\'enregistrement'),
  })

  return (
    <Modal open={open} onClose={onClose} title={call ? 'Modifier l\'appel' : 'Nouvel appel'} size="lg">
      <form onSubmit={handleSubmit(v => mutation.mutate(v))} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="form-group">
            <label className="label">Numéro appelant *</label>
            <input {...register('callerNumber')} className={`input font-mono ${errors.callerNumber ? 'input-error' : ''}`} placeholder="+33..." />
            {errors.callerNumber && <p className="form-error">{errors.callerNumber.message}</p>}
          </div>
          <div className="form-group">
            <label className="label">Nom appelant</label>
            <input {...register('callerName')} className="input" />
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="form-group">
            <label className="label">Direction</label>
            <select {...register('direction')} className="input">
              {Object.entries(CALL_DIRECTIONS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="label">Statut</label>
            <select {...register('status')} className="input">
              {Object.entries(CALL_STATUSES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="label">Priorité</label>
            <select {...register('priority')} className="input">
              {Object.entries(CALL_PRIORITIES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="form-group">
            <label className="label">Catégorie</label>
            <select {...register('category')} className="input">
              <option value="">— Aucune —</option>
              {Object.entries(CALL_CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="label">Durée (secondes)</label>
            <input {...register('duration')} type="number" className="input" placeholder="ex : 180" min={0} />
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="form-group">
            <label className="label">Date / Heure début</label>
            <input {...register('startedAt')} type="datetime-local" className="input" />
          </div>
          <div className="form-group">
            <label className="label">Numéro appelé</label>
            <input {...register('receiverNumber')} className="input font-mono" />
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
        <div className="form-group">
          <label className="label">Traité par</label>
          <select {...register('assignedToId')} className="input">
            <option value="">— Non assigné —</option>
            {usersData?.map(u => <option key={u.id} value={u.id}>{u.firstName} {u.lastName}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label className="label">Notes</label>
          <textarea {...register('notes')} className="input resize-none" rows={3} placeholder="Notes ou transcription..." />
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Annuler</button>
          <button type="submit" className="btn-primary" disabled={isSubmitting}>
            {isSubmitting ? <Spinner className="w-4 h-4" /> : null}
            {call ? 'Enregistrer' : 'Créer l\'appel'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

// ─── Modal ticket depuis appel ────────────────────────────────────────────────

const ticketFromCallSchema = z.object({
  title:        z.string().min(1, 'Titre requis'),
  description:  z.string().min(1, 'Description requise'),
  category:     z.string().min(1),
  priority:     z.string().min(1),
  contactId:    z.string().optional(),
  companyId:    z.string().optional(),
  assignedToId: z.string().optional(),
})
type TicketFromCallData = z.infer<typeof ticketFromCallSchema>

function TicketFromCallModal({ open, call, onClose, onSuccess }: { open: boolean; call: Call; onClose: () => void; onSuccess: () => void }) {
  const { user } = useAuthStore()
  const canAssign = user?.role === 'ADMIN' || user?.role === 'MANAGER'

  const defaultTitle = call.category
    ? `[${CALL_CATEGORIES[call.category] ?? call.category}] Appel du ${formatDate(call.startedAt)}`
    : `Appel du ${formatDateTime(call.startedAt)}${call.callerName ? ` — ${call.callerName}` : ` — ${call.callerNumber}`}`

  const defaultDesc = call.notes
    ? `Appel du ${formatDateTime(call.startedAt)} (${call.callerNumber}).\n\n${call.notes}`
    : `Appel du ${formatDateTime(call.startedAt)}.\nNuméro : ${call.callerNumber}${call.callerName ? `\nNom : ${call.callerName}` : ''}`

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<TicketFromCallData>({
    resolver: zodResolver(ticketFromCallSchema) as Resolver<TicketFromCallData>,
    defaultValues: {
      title: defaultTitle, description: defaultDesc,
      category: call.category === 'INCIDENT' ? 'HARDWARE_FAILURE' : 'OTHER',
      priority: call.priority === 'URGENT' ? 'CRITICAL' : call.priority === 'HIGH' ? 'HIGH' : 'NORMAL',
      contactId: call.contactId ?? '', companyId: call.companyId ?? '',
    },
  })

  useEffect(() => {
    if (open) reset({
      title: defaultTitle, description: defaultDesc,
      category: call.category === 'INCIDENT' ? 'HARDWARE_FAILURE' : 'OTHER',
      priority: call.priority === 'URGENT' ? 'CRITICAL' : call.priority === 'HIGH' ? 'HIGH' : 'NORMAL',
      contactId: call.contactId ?? '', companyId: call.companyId ?? '',
    })
  }, [open])

  const { data: contactsData } = useQuery({ queryKey: ['contacts-select'], queryFn: async () => { const { data } = await api.get('/contacts', { params: { limit: 200 } }); return data.data as { id: string; firstName: string; lastName: string }[] }, enabled: open, staleTime: 60_000 })
  const { data: companiesData } = useQuery({ queryKey: ['companies-select'], queryFn: async () => { const { data } = await api.get('/companies', { params: { limit: 200 } }); return data.data as { id: string; name: string }[] }, enabled: open, staleTime: 60_000 })
  const { data: usersData } = useQuery({ queryKey: ['users-list'], queryFn: async () => { const { data } = await api.get('/users'); return data.data as { id: string; firstName: string; lastName: string }[] }, enabled: open && canAssign, staleTime: 60_000 })

  const mutation = useMutation({
    mutationFn: async (values: TicketFromCallData) => {
      const { data } = await api.post('/tickets', { ...values, callId: call.id, contactId: values.contactId || undefined, companyId: values.companyId || undefined, assignedToId: values.assignedToId || undefined })
      return data
    },
    onSuccess, onError: () => toast.error('Erreur lors de la création du ticket'),
  })

  return (
    <Modal open={open} onClose={onClose} title="Créer un ticket depuis cet appel" size="lg">
      <form onSubmit={handleSubmit(v => mutation.mutate(v))} className="space-y-4">
        <div className="form-group">
          <label className="label">Titre *</label>
          <input {...register('title')} className={`input ${errors.title ? 'input-error' : ''}`} />
          {errors.title && <p className="form-error">{errors.title.message}</p>}
        </div>
        <div className="form-group">
          <label className="label">Description *</label>
          <textarea {...register('description')} className={`input ${errors.description ? 'input-error' : ''}`} rows={4} />
          {errors.description && <p className="form-error">{errors.description.message}</p>}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
            {isSubmitting ? <Spinner className="w-4 h-4" /> : <Ticket className="w-4 h-4" />}
            Créer le ticket
          </button>
        </div>
      </form>
    </Modal>
  )
}

// ─── Modal lead depuis appel ──────────────────────────────────────────────────

const leadFromCallSchema = z.object({
  title:       z.string().min(1, 'Titre requis'),
  description: z.string().optional(),
  source:      z.string(),
  contactId:   z.string().min(1, 'Contact requis pour un lead'),
})
type LeadFromCallData = z.infer<typeof leadFromCallSchema>

function LeadFromCallModal({ open, call, onClose, onSuccess }: { open: boolean; call: Call; onClose: () => void; onSuccess: () => void }) {
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<LeadFromCallData>({
    resolver: zodResolver(leadFromCallSchema) as Resolver<LeadFromCallData>,
    defaultValues: { title: `Lead — ${call.callerName ?? call.callerNumber} — ${formatDate(call.startedAt)}`, description: call.notes ?? '', source: 'PHONE_INBOUND', contactId: call.contactId ?? '' },
  })

  useEffect(() => {
    if (open) reset({ title: `Lead — ${call.callerName ?? call.callerNumber} — ${formatDate(call.startedAt)}`, description: call.notes ?? '', source: 'PHONE_INBOUND', contactId: call.contactId ?? '' })
  }, [open])

  const { data: contactsData } = useQuery({ queryKey: ['contacts-select'], queryFn: async () => { const { data } = await api.get('/contacts', { params: { limit: 200 } }); return data.data as { id: string; firstName: string; lastName: string }[] }, enabled: open, staleTime: 60_000 })

  const mutation = useMutation({
    mutationFn: async (values: LeadFromCallData) => {
      const { data } = await api.post('/pipeline/leads', { title: values.title, description: values.description || undefined, source: values.source, contactId: values.contactId })
      return data
    },
    onSuccess, onError: () => toast.error('Erreur lors de la création du lead'),
  })

  return (
    <Modal open={open} onClose={onClose} title="Créer un lead depuis cet appel" size="md">
      <form onSubmit={handleSubmit(v => mutation.mutate(v))} className="space-y-4">
        <div className="form-group">
          <label className="label">Titre du lead *</label>
          <input {...register('title')} className={`input ${errors.title ? 'input-error' : ''}`} />
          {errors.title && <p className="form-error">{errors.title.message}</p>}
        </div>
        <div className="form-group">
          <label className="label">Contact * <span className="text-xs text-slate-400">(requis pour créer un lead)</span></label>
          <select {...register('contactId')} className={`input ${errors.contactId ? 'input-error' : ''}`}>
            <option value="">— Sélectionner un contact —</option>
            {contactsData?.map(c => <option key={c.id} value={c.id}>{c.firstName} {c.lastName}</option>)}
          </select>
          {errors.contactId && <p className="form-error">{errors.contactId.message}</p>}
          {!call.contactId && <p className="text-xs text-amber-600 mt-1">Cet appel n'a pas de contact identifié. Sélectionnez-en un ou créez-le d'abord.</p>}
        </div>
        <div className="form-group">
          <label className="label">Source</label>
          <select {...register('source')} className="input">
            <option value="PHONE_INBOUND">Appel entrant</option>
            <option value="COLD_CALL">Appel sortant (prospection)</option>
            <option value="OTHER">Autre</option>
          </select>
        </div>
        <div className="form-group">
          <label className="label">Description</label>
          <textarea {...register('description')} className="input resize-none" rows={3} />
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Annuler</button>
          <button type="submit" className="btn-primary" disabled={isSubmitting}>
            {isSubmitting ? <Spinner className="w-4 h-4" /> : <TrendingUp className="w-4 h-4" />}
            Créer le lead
          </button>
        </div>
      </form>
    </Modal>
  )
}
