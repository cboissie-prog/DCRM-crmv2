import { useEffect, useState } from 'react'
import { useParams, useSearchParams, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Search, X, ChevronUp, ChevronDown, ChevronsUpDown, Phone, Copy,
  ChevronLeft, ChevronRight as ChevronRightIcon, ArrowLeft, Archive, ArchiveRestore, Star,
} from 'lucide-react'
import api from '../../lib/api'
import { useUsersList } from '../../hooks/useApi'
import { useProspectLists } from '../../hooks/useProspectLists'
import { usePermission } from '../../hooks/usePermission'
import { formatDateTime, formatRelative, cn } from '../../lib/utils'
import { Modal } from '../../components/ui/Modal'
import { toast } from '../../components/ui/Toast'
import { PROSPECT_STATUS_CONFIG, PROSPECT_STATUS_ORDER, isDueOrOverdue } from '../../lib/prospectActions'
import { ProspectActionBar } from '../../components/prospection/ProspectActionBar'
import { FollowUpDrawer } from '../../components/prospection/FollowUpDrawer'
import { QualifyModal } from '../../components/prospection/QualifyModal'
import type { Opportunity, User as UserType } from '../../types'

const SORT_COLUMNS: { key: string; label: string }[] = [
  { key: 'title', label: 'Prospect' },
  { key: 'prospectStatus', label: 'Statut' },
  { key: 'callAttempts', label: 'Tentatives' },
  { key: 'lastContactedAt', label: 'Dernier contact' },
  { key: 'remindAt', label: 'Prochaine action' },
  { key: 'createdAt', label: 'Créé le' },
]

const PAGE_SIZES = [50, 100, 200]

// Référence stable (plutôt que `data?.rows ?? []`, qui recrée un tableau à chaque rendu quand
// `data` est encore undefined) : évite de faire changer les deps du raccourci clavier Q à
// chaque rendu avant le premier chargement.
const EMPTY_ROWS: Opportunity[] = []

/**
 * Écran de traitement d'une liste de prospection — spec §5 « Écran de traitement d'une liste ».
 * Mécaniques (tri serveur, filtres URL, pagination, sélection multiple) dérivées de
 * `PipelineListView` ; statuts/dates partagés via `lib/prospectActions.ts`.
 */
export function ProspectListPage() {
  const { id: listId } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const canManage = usePermission('prospection:manage')
  const { data: users = [] } = useUsersList<UserType>({ enabled: canManage })
  const { all: lists } = useProspectLists({ includeArchived: true })
  const list = lists.find(l => l.id === listId)

  const [searchParams, setSearchParams] = useSearchParams()
  const updateParams = (patch: Record<string, string | undefined>, resetPage = true) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined || v === '') next.delete(k)
        else next.set(k, v)
      }
      if (resetPage && !('page' in patch)) next.set('page', '1')
      return next
    }, { replace: true })
  }

  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1') || 1)
  const limit = PAGE_SIZES.includes(parseInt(searchParams.get('limit') ?? '')) ? parseInt(searchParams.get('limit')!) : 50
  const sortBy = searchParams.get('sortBy') ?? 'createdAt'
  const sortOrder = (searchParams.get('sortOrder') === 'asc' ? 'asc' : 'desc') as 'asc' | 'desc'
  const statusFilter = searchParams.get('prospectStatus') ?? ''
  const assignedToFilter = searchParams.get('assignedToId') ?? ''
  const mine = searchParams.get('mine') === 'true'
  const today = searchParams.get('today') === 'true'
  const neverContacted = searchParams.get('neverContacted') === 'true'
  const search = searchParams.get('search') ?? ''

  const [searchDraft, setSearchDraft] = useState(search)
  useEffect(() => setSearchDraft(search), [search])
  useEffect(() => {
    const t = setTimeout(() => { if (searchDraft !== search) updateParams({ search: searchDraft || undefined }) }, 400)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchDraft])

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [drawerId, setDrawerId] = useState<string | null>(null)
  const [qualifyOpp, setQualifyOpp] = useState<Opportunity | null>(null)
  const [confirmArchiveList, setConfirmArchiveList] = useState(false)

  const queryKey = ['prospection-prospects', {
    listId, page, limit, sortBy, sortOrder, statusFilter, assignedToFilter, mine, today, neverContacted, search,
  }]

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      const { data } = await api.get('/prospection/prospects', {
        params: {
          listId, page, limit, sortBy, sortOrder,
          prospectStatus: statusFilter || undefined,
          assignedToId: assignedToFilter || undefined,
          mine: mine || undefined,
          today: today || undefined,
          neverContacted: neverContacted || undefined,
          search: search || undefined,
        },
      })
      return { rows: (data.data ?? []) as Opportunity[], total: (data.meta?.total ?? 0) as number }
    },
    enabled: !!listId,
    staleTime: 10_000,
  })
  const rows = data?.rows ?? EMPTY_ROWS
  const total = data?.total ?? 0

  useEffect(() => { setSelected(new Set()) }, [listId, page, limit, sortBy, sortOrder, statusFilter, assignedToFilter, mine, today, neverContacted, search])

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ['prospection-prospects'] })
    qc.invalidateQueries({ queryKey: ['prospection-lists'] })
  }

  const bulkMutation = useMutation({
    mutationFn: (payload: { ids: string[]; action: string; value?: string }) => api.post('/pipeline/opportunities/bulk', payload),
    onSuccess: (res) => {
      invalidateAll()
      setSelected(new Set())
      const updated = res.data?.data?.updated as number | undefined
      toast.success('Action appliquée', updated != null ? `${updated} prospect(s) mis à jour.` : undefined)
    },
    onError: () => toast.error("Erreur lors de l'action groupée"),
  })

  const archiveListMutation = useMutation({
    mutationFn: () => api.patch(`/prospection/lists/${listId}/${list?.status === 'ARCHIVED' ? 'unarchive' : 'archive'}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['prospection-lists'] })
      setConfirmArchiveList(false)
      toast.success(list?.status === 'ARCHIVED' ? 'Liste réactivée' : 'Liste archivée')
    },
    onError: () => toast.error("Erreur lors de l'archivage"),
  })

  const toggleSort = (key: string) => {
    if (sortBy === key) updateParams({ sortBy: key, sortOrder: sortOrder === 'asc' ? 'desc' : 'asc' }, false)
    else updateParams({ sortBy: key, sortOrder: 'asc' }, false)
  }
  const toggleSelectAll = () => {
    if (selected.size === rows.length) setSelected(new Set())
    else setSelected(new Set(rows.map(r => r.id)))
  }
  const toggleSelectRow = (id: string) => {
    setSelected(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next })
  }

  // Ligne active : survolée, sinon seule sélectionnée — raccourcis N/J/R (ProspectActionBar) et Q (qualifier)
  const activeRowId = hoveredId ?? (selected.size === 1 ? [...selected][0] : null)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!activeRowId) return
      if (e.key.toLowerCase() !== 'q' || e.metaKey || e.ctrlKey || e.altKey) return
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      const opp = rows.find(r => r.id === activeRowId)
      if (opp) { e.preventDefault(); setQualifyOpp(opp) }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [activeRowId, rows])

  const resetFilters = () => setSearchParams(() => new URLSearchParams(), { replace: true })
  const hasActiveFilters = !!(statusFilter || assignedToFilter || mine || today || neverContacted || search)

  return (
    <div className="flex flex-col flex-1 min-h-0 fade-in">
      {/* ── En-tête ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-3 min-w-0">
          <button className="btn-secondary !px-2" onClick={() => navigate('/prospection?tab=lists')}>
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="min-w-0">
            <h1 className="page-title truncate">{list?.name ?? 'Liste de prospection'}</h1>
            {list && (
              <p className="page-subtitle truncate">
                {list.description || 'Sans description'}
                {list.assignedTo && <> · Par défaut : {list.assignedTo.firstName} {list.assignedTo.lastName}</>}
                {list.status === 'ARCHIVED' && <span className="ml-2 badge badge-gray">Archivée</span>}
              </p>
            )}
          </div>
        </div>
        {canManage && list && (
          <button className="btn-secondary flex-shrink-0" disabled={archiveListMutation.isPending} onClick={() => setConfirmArchiveList(true)}>
            {list.status === 'ARCHIVED' ? <><ArchiveRestore className="w-4 h-4" /> Réactiver</> : <><Archive className="w-4 h-4" /> Archiver la liste</>}
          </button>
        )}
      </div>

      {/* ── Filtres ──────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input className="input pl-9" placeholder="Rechercher un prospect…" value={searchDraft} onChange={e => setSearchDraft(e.target.value)} />
        </div>
        <select className="input w-auto" value={statusFilter} onChange={e => updateParams({ prospectStatus: e.target.value || undefined })}>
          <option value="">Tous les statuts</option>
          {PROSPECT_STATUS_ORDER.map(s => <option key={s} value={s}>{PROSPECT_STATUS_CONFIG[s].label}</option>)}
        </select>
        {canManage && (
          <select className="input w-auto" value={assignedToFilter} onChange={e => updateParams({ assignedToId: e.target.value || undefined })}>
            <option value="">Tous les commerciaux</option>
            {users.map(u => <option key={u.id} value={u.id}>{u.firstName} {u.lastName}</option>)}
          </select>
        )}
        <button className={cn('btn-secondary text-xs', mine && 'bg-primary-50 border-primary-200 text-primary-700')} onClick={() => updateParams({ mine: mine ? undefined : 'true' })}>
          Mes prospects
        </button>
        <button className={cn('btn-secondary text-xs', today && 'bg-primary-50 border-primary-200 text-primary-700')} onClick={() => updateParams({ today: today ? undefined : 'true' })}>
          À rappeler aujourd'hui
        </button>
        <button className={cn('btn-secondary text-xs', neverContacted && 'bg-primary-50 border-primary-200 text-primary-700')} onClick={() => updateParams({ neverContacted: neverContacted ? undefined : 'true' })}>
          Jamais contacté
        </button>
        {hasActiveFilters && (
          <button className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800 border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white hover:bg-slate-50" onClick={resetFilters}>
            <X className="w-3 h-3" /> Réinitialiser
          </button>
        )}
      </div>

      {/* ── Barre de sélection multiple ─────────────────────────────────── */}
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 px-3 py-2 mb-3 bg-primary-50 border border-primary-100 rounded-xl">
          <span className="text-sm font-medium text-primary-700">{selected.size} sélectionné{selected.size > 1 ? 's' : ''}</span>
          {canManage && (
            <select className="input !py-1 !text-xs w-auto" defaultValue=""
              onChange={e => { const v = e.target.value; if (v) { bulkMutation.mutate({ ids: [...selected], action: 'assign', value: v }); e.target.value = '' } }}>
              <option value="" disabled>Assigner à…</option>
              {users.map(u => <option key={u.id} value={u.id}>{u.firstName} {u.lastName}</option>)}
            </select>
          )}
          <select className="input !py-1 !text-xs w-auto" defaultValue=""
            onChange={e => { const v = e.target.value; if (v) { bulkMutation.mutate({ ids: [...selected], action: 'prospectStatus', value: v }); e.target.value = '' } }}>
            <option value="" disabled>Statut de prospection…</option>
            {PROSPECT_STATUS_ORDER.filter(s => s !== 'QUALIFIED').map(s => <option key={s} value={s}>{PROSPECT_STATUS_CONFIG[s].label}</option>)}
          </select>
        </div>
      )}

      {/* ── Tableau ──────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto border border-slate-200 rounded-2xl bg-white">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-slate-50 z-10">
            <tr className="border-b border-slate-200">
              <th className="px-3 py-2 w-8">
                <input type="checkbox" checked={rows.length > 0 && selected.size === rows.length} onChange={toggleSelectAll} />
              </th>
              <th className="px-3 py-2 text-left font-medium text-slate-500">Contact</th>
              {SORT_COLUMNS.map(col => (
                <th key={col.key} className="px-3 py-2 text-left font-medium text-slate-500 cursor-pointer select-none whitespace-nowrap" onClick={() => toggleSort(col.key)}>
                  <span className="inline-flex items-center gap-1">
                    {col.label}
                    {sortBy === col.key ? (sortOrder === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />) : <ChevronsUpDown className="w-3 h-3 text-slate-300" />}
                  </span>
                </th>
              ))}
              <th className="px-3 py-2 text-left font-medium text-slate-500">Traité par</th>
              <th className="px-3 py-2 text-left font-medium text-slate-500 min-w-56">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={10} className="px-3 py-8 text-center text-slate-400 text-xs">Chargement…</td></tr>}
            {!isLoading && rows.length === 0 && <tr><td colSpan={10} className="px-3 py-8 text-center text-slate-400 text-xs">Aucun prospect ne correspond aux filtres</td></tr>}
            {rows.map(opp => {
              const due = isDueOrOverdue(opp.remindAt)
              const isActive = activeRowId === opp.id
              return (
                <tr
                  key={opp.id}
                  className={cn('group border-b border-slate-100 last:border-0', due && 'bg-amber-50/70', selected.has(opp.id) && 'bg-primary-50/40')}
                  onMouseEnter={() => setHoveredId(opp.id)}
                  onMouseLeave={() => setHoveredId(prev => (prev === opp.id ? null : prev))}
                >
                  <td className="px-3 py-2 align-top">
                    <input type="checkbox" checked={selected.has(opp.id)} onChange={() => toggleSelectRow(opp.id)} />
                  </td>
                  <td className="px-3 py-2 align-top min-w-48">
                    <button type="button" className="text-slate-900 hover:text-primary-600 hover:underline text-left" onClick={() => setDrawerId(opp.id)}>
                      {opp.title}
                    </button>
                    {opp.company && <p className="text-xs text-slate-400">{opp.company.name}</p>}
                    {opp.contact && <p className="text-xs text-slate-500">{opp.contact.firstName} {opp.contact.lastName}</p>}
                    {(() => {
                      const phoneNumber = opp.contact?.phone || opp.contact?.mobile
                      if (!phoneNumber) return null
                      return (
                        <div className="flex items-center gap-1 mt-0.5">
                          <a href={`tel:${phoneNumber}`} className="flex items-center gap-1 text-xs text-primary-600 hover:underline">
                            <Phone className="w-3 h-3" /> {phoneNumber}
                          </a>
                          <button type="button" title="Copier le numéro" className="text-slate-300 hover:text-slate-600"
                            onClick={() => { navigator.clipboard?.writeText(phoneNumber).then(() => toast.success('Numéro copié')).catch(() => {}) }}>
                            <Copy className="w-3 h-3" />
                          </button>
                        </div>
                      )
                    })()}
                  </td>
                  <td className="px-3 py-2 align-top">
                    <span className={cn('inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border', PROSPECT_STATUS_CONFIG[opp.prospectStatus ?? 'TODO'].className)}>
                      {PROSPECT_STATUS_CONFIG[opp.prospectStatus ?? 'TODO'].label}
                    </span>
                  </td>
                  <td className="px-3 py-2 align-top text-xs text-slate-500">{opp.callAttempts ?? 0}</td>
                  <td className="px-3 py-2 align-top text-xs text-slate-500 whitespace-nowrap">
                    {opp.lastContactedAt ? formatRelative(opp.lastContactedAt) : 'Jamais'}
                  </td>
                  <td className="px-3 py-2 align-top whitespace-nowrap">
                    {opp.remindAt || opp.nextAction ? (
                      <div>
                        <p className={cn('text-xs font-medium', due ? 'text-red-600' : 'text-slate-700')}>{opp.nextAction || '—'}</p>
                        {opp.remindAt && <p className={cn('text-xs', due ? 'text-red-500' : 'text-slate-400')}>{formatDateTime(opp.remindAt)}</p>}
                      </div>
                    ) : <span className="text-xs text-amber-600">À planifier</span>}
                  </td>
                  <td className="px-3 py-2 align-top text-xs text-slate-500 whitespace-nowrap">{formatRelative(opp.createdAt)}</td>
                  <td className="px-3 py-2 align-top text-xs text-slate-500 whitespace-nowrap">
                    {opp.assignedTo ? `${opp.assignedTo.firstName} ${opp.assignedTo.lastName}` : '—'}
                  </td>
                  <td className={cn('px-3 py-2 align-top transition-opacity', isActive || selected.has(opp.id) ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100')}>
                    <div className="flex items-center gap-1">
                      <ProspectActionBar
                        opportunity={opp}
                        mode="prospect"
                        compact
                        isActiveRow={isActive}
                        onDone={() => invalidateAll()}
                      />
                      <button type="button" title="Qualifier (Q)" className="p-1.5 rounded-lg border border-amber-200 bg-amber-50 text-amber-600 hover:bg-amber-100" onClick={() => setQualifyOpp(opp)}>
                        <Star className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* ── Pagination ───────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-1 py-3 text-xs text-slate-500">
        <span>{total === 0 ? '0 résultat' : `${(page - 1) * limit + 1}–${Math.min(page * limit, total)} sur ${total}`}</span>
        <div className="flex items-center gap-2">
          <select className="input !py-1 !text-xs w-auto" value={limit} onChange={e => updateParams({ limit: e.target.value, page: '1' })}>
            {PAGE_SIZES.map(n => <option key={n} value={n}>{n} / page</option>)}
          </select>
          <button className="btn-secondary !py-1 !text-xs" disabled={page <= 1} onClick={() => updateParams({ page: String(page - 1) }, false)}>
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
          <button className="btn-secondary !py-1 !text-xs" disabled={page * limit >= total} onClick={() => updateParams({ page: String(page + 1) }, false)}>
            <ChevronRightIcon className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* ── Archivage de la liste ───────────────────────────────────────── */}
      <Modal open={confirmArchiveList} onClose={() => setConfirmArchiveList(false)} title={list?.status === 'ARCHIVED' ? 'Réactiver la liste' : 'Archiver la liste'} size="sm">
        <p className="text-slate-600 mb-6">
          {list?.status === 'ARCHIVED'
            ? 'Réactiver cette liste de prospection ?'
            : 'Archiver cette liste ? Les prospects restent accessibles mais la liste ne sera plus proposée pour un nouvel import.'}
        </p>
        <div className="flex justify-end gap-3">
          <button className="btn-secondary" onClick={() => setConfirmArchiveList(false)}>Annuler</button>
          <button className="btn-primary" disabled={archiveListMutation.isPending} onClick={() => archiveListMutation.mutate()}>
            {list?.status === 'ARCHIVED' ? 'Réactiver' : 'Archiver'}
          </button>
        </div>
      </Modal>

      {/* ── Panneau de suivi ─────────────────────────────────────────────── */}
      <FollowUpDrawer
        open={!!drawerId}
        onClose={() => setDrawerId(null)}
        opportunityId={drawerId}
        mode="prospect"
        onQualified={() => setDrawerId(null)}
      />

      {/* ── Qualification directe (bouton étoile / raccourci Q) ─────────── */}
      {qualifyOpp && (
        <QualifyModal
          open={!!qualifyOpp}
          onClose={() => setQualifyOpp(null)}
          opportunity={qualifyOpp}
          onQualified={() => { setQualifyOpp(null); invalidateAll() }}
        />
      )}
    </div>
  )
}
