import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Search, X, ChevronUp, ChevronDown, ChevronsUpDown, Phone, Copy, AlertTriangle,
  ChevronLeft, ChevronRight as ChevronRightIcon,
} from 'lucide-react'
import api from '../../lib/api'
import { useUsersList } from '../../hooks/useApi'
import { useReferences } from '../../hooks/useReferences'
import { usePermission } from '../../hooks/usePermission'
import { formatCurrency, formatDate, formatDateTime, formatRelative, cn } from '../../lib/utils'
import { Modal } from '../../components/ui/Modal'
import { Tooltip } from '../../components/ui/Tooltip'
import { toast } from '../../components/ui/Toast'
import {
  PROSPECT_STATUS_CONFIG, isDueOrOverdue,
} from '../../lib/prospectActions'
import { ProspectActionBar } from '../../components/prospection/ProspectActionBar'
import { FollowUpDrawer } from '../../components/prospection/FollowUpDrawer'
import type { Opportunity, ProspectStatus, User as UserType } from '../../types'

// ─── Types locaux (pas de dépendance circulaire vers PipelinePage.tsx) ────────
interface ListPipelineStage { id: string; key: string; name: string; color: string; order: number; isWon: boolean; isLost: boolean }

interface PipelineListViewProps {
  pipelineId: string
  stages: ListPipelineStage[]
  canAssign: boolean
  onEdit: (opp: Opportunity) => void
}

// Statuts proposés par le menu manuel de cette vue (étape "déjà dans le pipeline") — le
// catalogue complet des 7 statuts (ajout du module Prospection : UNREACHABLE, NOT_INTERESTED,
// QUALIFIED) vit dans `lib/prospectActions.ts` et sert aussi à afficher la pastille sans
// planter sur une fiche qualifiée depuis la prospection (`PROSPECT_STATUS_CONFIG` ci-dessus,
// importé). Les 3 nouveaux statuts se fixent via les actions/la qualification, pas ce menu.
const PROSPECT_STATUS_ORDER: ProspectStatus[] = ['TODO', 'NO_ANSWER', 'REACHED', 'CALLBACK']

// « Contact » (titre, tri sur `title`) a son propre en-tête géré à part ci-dessous ; les autres
// colonnes triables sont générées depuis cette table.
const SORT_COLUMNS: { key: string; label: string }[] = [
  { key: 'prospectStatus', label: 'Statut' },
  { key: 'remindAt', label: 'Prochaine action' },
  { key: 'stage', label: 'Étape' },
  { key: 'value', label: 'Montant HT' },
  { key: 'lastContactedAt', label: 'Dernier contact' },
  { key: 'createdAt', label: 'Créé le' },
]

const PAGE_SIZES = [50, 100, 200]

// ─── Alerte de suivi (spec §4/§5), dupliqué de `PipelinePage.tsx` (pas de dépendance circulaire
// entre les deux, cf. note ci-dessus) : pastille rouge « Aucune prochaine action » ou orange
// « Sans activité depuis N j », calculée côté serveur (`alert`) sur GET /pipeline/opportunities.
function staleDaysCount(opp: Opportunity): number {
  const ref = opp.lastActivityAt ?? opp.updatedAt
  const ms = Date.now() - new Date(ref).getTime()
  return Math.max(0, Math.floor(ms / (24 * 60 * 60 * 1000)))
}

function alertBadge(opp: Opportunity): { label: string; tooltip: string; className: string } | null {
  if (opp.alert === 'NO_NEXT_ACTION') {
    return { label: 'Aucune action', tooltip: 'Aucune prochaine action planifiée', className: 'bg-red-100 text-red-700' }
  }
  if (opp.alert === 'STALE') {
    const n = staleDaysCount(opp)
    return { label: `${n} j sans activité`, tooltip: `Sans activité depuis ${n} jour${n > 1 ? 's' : ''}`, className: 'bg-orange-100 text-orange-700' }
  }
  return null
}

// ─── Cellule montant éditable en ligne ─────────────────────────────────────────
function InlineValueCell({ value, onSave, editable = true }: { value: number; onSave: (v: number) => void; editable?: boolean }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(String(value))
  useEffect(() => { setDraft(String(value)) }, [value])

  const commit = () => {
    setEditing(false)
    const n = parseFloat(draft.replace(',', '.'))
    if (!Number.isNaN(n) && n !== value) onSave(n)
    else setDraft(String(value))
  }

  if (!editable) {
    return <span className="font-medium text-slate-700">{formatCurrency(value)}</span>
  }
  if (!editing) {
    return (
      <button type="button" className="font-medium text-slate-700 hover:underline" onClick={() => setEditing(true)}>
        {formatCurrency(value)}
      </button>
    )
  }
  return (
    <input
      autoFocus
      type="number"
      step="1"
      className="input !py-1 !text-xs w-24"
      value={draft}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setDraft(String(value)); setEditing(false) } }}
    />
  )
}

export function PipelineListView({ pipelineId, stages, canAssign, onEdit }: PipelineListViewProps) {
  const qc = useQueryClient()
  const refs = useReferences()
  const canUpdate = usePermission('pipeline:update')
  const { data: users = [] } = useUsersList<UserType>({ enabled: canAssign })

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
  const stageFilter = searchParams.get('stage') ?? ''
  const sourceFilter = searchParams.get('source') ?? ''
  const prospectStatusFilter = searchParams.get('prospectStatus') ?? ''
  const assignedToFilter = searchParams.get('assignedToId') ?? ''
  const search = searchParams.get('search') ?? ''
  const remindToday = searchParams.get('remindToday') === 'true'
  const neverContacted = searchParams.get('neverContacted') === 'true'
  const staleDays = searchParams.get('staleDays') ?? ''

  // Recherche texte debouncée (évite une requête par caractère saisi)
  const [searchDraft, setSearchDraft] = useState(search)
  useEffect(() => setSearchDraft(search), [search])
  useEffect(() => {
    const t = setTimeout(() => { if (searchDraft !== search) updateParams({ search: searchDraft || undefined }) }, 400)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchDraft])

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirmArchive, setConfirmArchive] = useState(false)
  // Ligne active : survolée, sinon seule sélectionnée — affiche la `ProspectActionBar` compacte
  // (même convention que `ProspectListPage`, spec §5).
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  // Panneau de suivi commun (mode `deal`) ouvert au clic sur le titre d'une ligne (Task 3).
  const [drawerId, setDrawerId] = useState<string | null>(null)

  const queryKey = ['pipeline-opportunities-list', {
    pipelineId, page, limit, sortBy, sortOrder, stageFilter, sourceFilter,
    prospectStatusFilter, assignedToFilter, search, remindToday, neverContacted, staleDays,
  }]

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      const { data } = await api.get('/pipeline/opportunities', {
        params: {
          pipelineId: pipelineId || undefined,
          page, limit, sortBy, sortOrder,
          stage: stageFilter || undefined,
          source: sourceFilter || undefined,
          prospectStatus: prospectStatusFilter || undefined,
          assignedToId: assignedToFilter || undefined,
          search: search || undefined,
          remindToday: remindToday || undefined,
          neverContacted: neverContacted || undefined,
          staleDays: staleDays || undefined,
          archived: 'exclude',
        },
      })
      return { rows: (data.data ?? []) as Opportunity[], total: (data.meta?.total ?? 0) as number }
    },
    enabled: !!pipelineId,
    staleTime: 15_000,
  })
  const rows = data?.rows ?? []
  const total = data?.total ?? 0

  // La sélection ne doit pas survivre à un changement de page/filtres
  useEffect(() => { setSelected(new Set()) }, [pipelineId, page, limit, sortBy, sortOrder, stageFilter, sourceFilter, prospectStatusFilter, assignedToFilter, search, remindToday, neverContacted, staleDays])

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ['pipeline-opportunities-list'] })
    qc.invalidateQueries({ queryKey: ['pipeline-opportunities'] })
  }

  const stageMutation = useMutation({
    mutationFn: ({ id, stage }: { id: string; stage: string }) => api.patch(`/pipeline/opportunities/${id}/stage`, { stage }),
    onSuccess: invalidateAll,
    onError: () => toast.error("Erreur lors du changement d'étape"),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) => api.put(`/pipeline/opportunities/${id}`, data),
    onSuccess: invalidateAll,
    onError: () => toast.error('Erreur lors de la mise à jour'),
  })

  const bulkMutation = useMutation({
    mutationFn: (payload: { ids: string[]; action: string; value?: string }) =>
      api.post('/pipeline/opportunities/bulk', payload),
    onSuccess: (res) => {
      invalidateAll()
      setSelected(new Set())
      setConfirmArchive(false)
      const updated = (res.data?.data?.updated) as number | undefined
      toast.success('Action appliquée', updated != null ? `${updated} opportunité(s) mise(s) à jour.` : undefined)
    },
    onError: () => toast.error("Erreur lors de l'action groupée"),
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
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const activeRowId = hoveredId ?? (selected.size === 1 ? [...selected][0] : null)

  const resetFilters = () => {
    setSearchParams(() => new URLSearchParams(), { replace: true })
  }
  const hasActiveFilters = !!(stageFilter || sourceFilter || prospectStatusFilter || assignedToFilter || search || remindToday || neverContacted || staleDays)

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* ── Filtres ──────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            className="input pl-9"
            placeholder="Rechercher un prospect…"
            value={searchDraft}
            onChange={e => setSearchDraft(e.target.value)}
          />
        </div>
        <select className="input w-auto" value={stageFilter} onChange={e => updateParams({ stage: e.target.value || undefined })}>
          <option value="">Toutes les étapes</option>
          {stages.map(s => <option key={s.key} value={s.key}>{s.name}</option>)}
        </select>
        <select className="input w-auto" value={sourceFilter} onChange={e => updateParams({ source: e.target.value || undefined })}>
          <option value="">Toutes les sources</option>
          {refs.options('lead_source').map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select className="input w-auto" value={prospectStatusFilter} onChange={e => updateParams({ prospectStatus: e.target.value || undefined })}>
          <option value="">Tous les statuts</option>
          {PROSPECT_STATUS_ORDER.map(s => <option key={s} value={s}>{PROSPECT_STATUS_CONFIG[s].label}</option>)}
        </select>
        {canAssign && (
          <select className="input w-auto" value={assignedToFilter} onChange={e => updateParams({ assignedToId: e.target.value || undefined })}>
            <option value="">Tous les commerciaux</option>
            {users.map(u => <option key={u.id} value={u.id}>{u.firstName} {u.lastName}</option>)}
          </select>
        )}
        <button
          className={cn('btn-secondary text-xs', remindToday && 'bg-primary-50 border-primary-200 text-primary-700')}
          onClick={() => updateParams({ remindToday: remindToday ? undefined : 'true' })}
        >
          À rappeler aujourd'hui
        </button>
        <button
          className={cn('btn-secondary text-xs', neverContacted && 'bg-primary-50 border-primary-200 text-primary-700')}
          onClick={() => updateParams({ neverContacted: neverContacted ? undefined : 'true' })}
        >
          Jamais contacté
        </button>
        <button
          className={cn('btn-secondary text-xs', staleDays === '7' && 'bg-primary-50 border-primary-200 text-primary-700')}
          onClick={() => updateParams({ staleDays: staleDays === '7' ? undefined : '7' })}
        >
          Sans contact depuis 7 j
        </button>
        {hasActiveFilters && (
          <button className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800 border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white hover:bg-slate-50" onClick={resetFilters}>
            <X className="w-3 h-3" /> Réinitialiser
          </button>
        )}
      </div>

      {/* ── Barre de sélection multiple ─────────────────────────────────── */}
      {canUpdate && selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 px-3 py-2 mb-3 bg-primary-50 border border-primary-100 rounded-xl">
          <span className="text-sm font-medium text-primary-700">{selected.size} sélectionnée{selected.size > 1 ? 's' : ''}</span>
          {canAssign && (
            <select
              className="input !py-1 !text-xs w-auto"
              defaultValue=""
              onChange={e => { const v = e.target.value; if (v) { bulkMutation.mutate({ ids: [...selected], action: 'assign', value: v }); e.target.value = '' } }}
            >
              <option value="" disabled>Assigner à…</option>
              {users.map(u => <option key={u.id} value={u.id}>{u.firstName} {u.lastName}</option>)}
            </select>
          )}
          <select
            className="input !py-1 !text-xs w-auto"
            defaultValue=""
            onChange={e => { const v = e.target.value; if (v && stages.some(s => s.key === v)) bulkMutation.mutate({ ids: [...selected], action: 'stage', value: v }); e.target.value = '' }}
          >
            <option value="" disabled>Déplacer vers l'étape…</option>
            {stages.map(s => <option key={s.key} value={s.key}>{s.name}</option>)}
          </select>
          <select
            className="input !py-1 !text-xs w-auto"
            defaultValue=""
            onChange={e => { const v = e.target.value; if (v) { bulkMutation.mutate({ ids: [...selected], action: 'prospectStatus', value: v }); e.target.value = '' } }}
          >
            <option value="" disabled>Statut de prospection…</option>
            {PROSPECT_STATUS_ORDER.map(s => <option key={s} value={s}>{PROSPECT_STATUS_CONFIG[s].label}</option>)}
          </select>
          <button className="btn-secondary !text-xs" onClick={() => setConfirmArchive(true)}>Archiver</button>
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
              <th
                className="px-3 py-2 text-left font-medium text-slate-500 cursor-pointer select-none whitespace-nowrap"
                onClick={() => toggleSort('title')}
              >
                <span className="inline-flex items-center gap-1">
                  Contact
                  {sortBy === 'title' ? (sortOrder === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />) : <ChevronsUpDown className="w-3 h-3 text-slate-300" />}
                </span>
              </th>
              {SORT_COLUMNS.map(col => (
                <th
                  key={col.key}
                  className="px-3 py-2 text-left font-medium text-slate-500 cursor-pointer select-none whitespace-nowrap"
                  onClick={() => toggleSort(col.key)}
                >
                  <span className="inline-flex items-center gap-1">
                    {col.label}
                    {sortBy === col.key ? (sortOrder === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />) : <ChevronsUpDown className="w-3 h-3 text-slate-300" />}
                  </span>
                </th>
              ))}
              <th className="px-3 py-2 text-left font-medium text-slate-500">Source</th>
              <th className="px-3 py-2 text-left font-medium text-slate-500 min-w-40">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={10} className="px-3 py-8 text-center text-slate-400 text-xs">Chargement…</td></tr>
            )}
            {!isLoading && rows.length === 0 && (
              <tr><td colSpan={10} className="px-3 py-8 text-center text-slate-400 text-xs">Aucun prospect ne correspond aux filtres</td></tr>
            )}
            {rows.map(opp => {
              const due = isDueOrOverdue(opp.remindAt)
              const neverContactedRow = (opp.prospectStatus ?? 'TODO') === 'TODO' && !opp.lastContactedAt
              const stage = stages.find(s => s.key === opp.stage)
              const isActive = activeRowId === opp.id
              const badge = alertBadge(opp)
              return (
                <tr
                  key={opp.id}
                  className={cn('group border-b border-slate-100 last:border-0', due && 'bg-amber-50/70', neverContactedRow && 'font-semibold', selected.has(opp.id) && 'bg-primary-50/40')}
                  onMouseEnter={() => setHoveredId(opp.id)}
                  onMouseLeave={() => setHoveredId(prev => (prev === opp.id ? null : prev))}
                >
                  <td className="px-3 py-2 align-top">
                    <input type="checkbox" checked={selected.has(opp.id)} onChange={() => toggleSelectRow(opp.id)} />
                  </td>
                  {/* Contact + Prospect (titre/entreprise) — clic sur le titre : panneau de suivi (mode deal) */}
                  <td className="px-3 py-2 align-top min-w-48">
                    <button type="button" className="text-slate-900 hover:text-primary-600 hover:underline text-left" onClick={() => setDrawerId(opp.id)}>
                      {opp.title}
                    </button>
                    {opp.company && <p className="text-xs text-slate-400">{opp.company.name}</p>}
                    {opp.contact && (
                      <p className="text-xs text-slate-500">{opp.contact.firstName} {opp.contact.lastName}</p>
                    )}
                    {(() => {
                      const phoneNumber = opp.contact?.phone || opp.contact?.mobile
                      if (!phoneNumber) return null
                      return (
                        <div className="flex items-center gap-1 mt-0.5">
                          <a href={`tel:${phoneNumber}`} className="flex items-center gap-1 text-xs text-primary-600 hover:underline">
                            <Phone className="w-3 h-3" /> {phoneNumber}
                          </a>
                          <button
                            type="button"
                            title="Copier le numéro"
                            onClick={() => { navigator.clipboard?.writeText(phoneNumber).then(() => toast.success('Numéro copié')).catch(() => {}) }}
                            className="text-slate-300 hover:text-slate-600"
                          >
                            <Copy className="w-3 h-3" />
                          </button>
                        </div>
                      )
                    })()}
                  </td>
                  {/* Statut de prospection (pastille — modifié via les actions rapides, colonne Actions) */}
                  <td className="px-3 py-2 align-top">
                    <span className={cn('inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border', PROSPECT_STATUS_CONFIG[opp.prospectStatus ?? 'TODO'].className)}>
                      {PROSPECT_STATUS_CONFIG[opp.prospectStatus ?? 'TODO'].label}
                    </span>
                  </td>
                  {/* Prochaine action : date + libellé + pastille d'alerte (spec §4/§5) */}
                  <td className="px-3 py-2 align-top whitespace-nowrap">
                    <div className="flex items-center gap-1.5">
                      {opp.remindAt || opp.nextAction ? (
                        <div>
                          <p className={cn('text-xs font-medium', due ? 'text-red-600' : 'text-slate-700')}>{opp.nextAction || '—'}</p>
                          {opp.remindAt && <p className={cn('text-xs', due ? 'text-red-500' : 'text-slate-400')}>{formatDateTime(opp.remindAt)}</p>}
                        </div>
                      ) : <span className="text-xs text-amber-600">À planifier</span>}
                      {badge && (
                        <Tooltip content={badge.tooltip}>
                          <span className={cn('inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold flex-shrink-0 whitespace-nowrap', badge.className)}>
                            <AlertTriangle className="w-3 h-3" />
                          </span>
                        </Tooltip>
                      )}
                    </div>
                  </td>
                  {/* Étape */}
                  <td className="px-3 py-2 align-top">
                    <select
                      className="input !py-1 !text-xs w-auto"
                      value={opp.stage}
                      disabled={!canUpdate}
                      onChange={e => stageMutation.mutate({ id: opp.id, stage: e.target.value })}
                    >
                      {stages.map(s => <option key={s.key} value={s.key}>{s.name}</option>)}
                      {stage === undefined && <option value={opp.stage}>{opp.stage}</option>}
                    </select>
                  </td>
                  {/* Montant */}
                  <td className="px-3 py-2 align-top">
                    <InlineValueCell value={opp.value} editable={canUpdate} onSave={v => updateMutation.mutate({ id: opp.id, data: { value: v } })} />
                  </td>
                  {/* Dernier contact */}
                  <td className="px-3 py-2 align-top text-xs text-slate-500 whitespace-nowrap">
                    {opp.lastContactedAt ? formatRelative(opp.lastContactedAt) : 'Jamais'}
                    {!!opp.callAttempts && <span className="ml-1 text-slate-400">({opp.callAttempts})</span>}
                  </td>
                  {/* Créé le */}
                  <td className="px-3 py-2 align-top text-xs text-slate-500 whitespace-nowrap">{formatDate(opp.createdAt)}</td>
                  {/* Source */}
                  <td className="px-3 py-2 align-top text-xs text-slate-500 whitespace-nowrap">{refs.label('lead_source', opp.source) || '—'}</td>
                  {/* Actions rapides — remplace les anciens menus Statut/Rappel (journalisées en Activity) */}
                  <td className={cn('px-3 py-2 align-top transition-opacity', isActive || selected.has(opp.id) ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100')}>
                    {canUpdate && (
                      <ProspectActionBar
                        opportunity={opp}
                        mode="deal"
                        compact
                        isActiveRow={isActive}
                        onDone={() => invalidateAll()}
                      />
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* ── Pagination ───────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-1 py-3 text-xs text-slate-500">
        <span>
          {total === 0 ? '0 résultat' : `${(page - 1) * limit + 1}–${Math.min(page * limit, total)} sur ${total}`}
        </span>
        <div className="flex items-center gap-2">
          <select
            className="input !py-1 !text-xs w-auto"
            value={limit}
            onChange={e => updateParams({ limit: e.target.value, page: '1' })}
          >
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

      {/* ── Confirmation archivage groupé ───────────────────────────────── */}
      <Modal open={confirmArchive} onClose={() => setConfirmArchive(false)} title="Archiver les opportunités sélectionnées" size="sm">
        <p className="text-slate-600 mb-6">
          Archiver {selected.size} opportunité{selected.size > 1 ? 's' : ''} ? Les opportunités dont l'étape est encore
          ouverte seront ignorées.
        </p>
        <div className="flex justify-end gap-3">
          <button className="btn-secondary" onClick={() => setConfirmArchive(false)}>Annuler</button>
          <button
            className="btn-primary bg-red-600 hover:bg-red-700 focus:ring-red-500"
            disabled={bulkMutation.isPending}
            onClick={() => bulkMutation.mutate({ ids: [...selected], action: 'archive' })}
          >
            Archiver
          </button>
        </div>
      </Modal>

      {/* ── Panneau de suivi (mode deal) — clic sur le titre d'une ligne ────── */}
      <FollowUpDrawer
        open={!!drawerId}
        onClose={() => setDrawerId(null)}
        opportunityId={drawerId}
        mode="deal"
        onEdit={(opportunity) => { setDrawerId(null); onEdit(opportunity) }}
      />
    </div>
  )
}
