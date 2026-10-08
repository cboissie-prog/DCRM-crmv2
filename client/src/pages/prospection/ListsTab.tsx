import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Upload, Archive, ArchiveRestore, List as ListIcon } from 'lucide-react'
import api from '../../lib/api'
import { useUsersList } from '../../hooks/useApi'
import { useReferences } from '../../hooks/useReferences'
import { useProspectLists } from '../../hooks/useProspectLists'
import { usePermission } from '../../hooks/usePermission'
import { formatDate, cn } from '../../lib/utils'
import { Modal } from '../../components/ui/Modal'
import { toast } from '../../components/ui/Toast'
import { ImportProspectsModal } from '../../components/ui/ImportProspectsModal'
import type { ProspectList, User as UserType } from '../../types'

interface SimplePipeline { id: string; name: string; isDefault: boolean }

interface NewListForm {
  name: string
  description: string
  source: string
  pipelineId: string
  assignedToId: string
}

const EMPTY_FORM: NewListForm = { name: '', description: '', source: 'COLD_CALL', pipelineId: '', assignedToId: '' }

export function ListsTab() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const refs = useReferences()
  const canManage = usePermission('prospection:manage')
  const { data: users = [] } = useUsersList<UserType>()
  const { data: pipelines = [] } = useQuery<SimplePipeline[]>({
    queryKey: ['pipelines'],
    queryFn: async () => { const { data } = await api.get('/pipelines'); return data.data ?? [] },
    staleTime: 60_000,
  })

  const [showArchived, setShowArchived] = useState(false)
  const { active, archived, isLoading } = useProspectLists({ includeArchived: true })
  const lists = showArchived ? archived : active

  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState<NewListForm>(EMPTY_FORM)
  const [importListId, setImportListId] = useState<string | null>(null)
  const [archiveTarget, setArchiveTarget] = useState<ProspectList | null>(null)

  const createMutation = useMutation({
    mutationFn: (v: NewListForm) => api.post('/prospection/lists', {
      name: v.name.trim(),
      description: v.description.trim() || undefined,
      source: v.source || undefined,
      pipelineId: v.pipelineId || undefined,
      assignedToId: v.assignedToId || undefined,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['prospection-lists'] })
      toast.success('Liste créée')
      setShowCreate(false)
      setForm(EMPTY_FORM)
    },
    onError: () => toast.error('Erreur lors de la création de la liste'),
  })

  const archiveMutation = useMutation({
    mutationFn: (l: ProspectList) => api.patch(`/prospection/lists/${l.id}/${l.status === 'ARCHIVED' ? 'unarchive' : 'archive'}`),
    onSuccess: (_res, l) => {
      qc.invalidateQueries({ queryKey: ['prospection-lists'] })
      toast.success(l.status === 'ARCHIVED' ? 'Liste réactivée' : 'Liste archivée')
      setArchiveTarget(null)
    },
    onError: () => toast.error("Erreur lors de l'archivage"),
  })

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <button className={cn('btn-secondary text-xs', !showArchived && 'bg-primary-50 border-primary-200 text-primary-700')} onClick={() => setShowArchived(false)}>
            Actives ({active.length})
          </button>
          <button className={cn('btn-secondary text-xs', showArchived && 'bg-primary-50 border-primary-200 text-primary-700')} onClick={() => setShowArchived(true)}>
            Archivées ({archived.length})
          </button>
        </div>
        {canManage && (
          <div className="flex items-center gap-2">
            <button className="btn-secondary" onClick={() => setImportListId('')}>
              <Upload className="w-4 h-4" /> Importer
            </button>
            <button className="btn-primary" onClick={() => setShowCreate(true)}>
              <Plus className="w-4 h-4" /> Nouvelle liste
            </button>
          </div>
        )}
      </div>

      {isLoading && <p className="text-sm text-slate-400 py-8 text-center">Chargement…</p>}

      {!isLoading && lists.length === 0 && (
        <div className="py-16 text-center text-slate-400 text-sm border border-dashed border-slate-200 rounded-xl">
          <ListIcon className="w-8 h-8 mx-auto mb-2 text-slate-200" />
          {showArchived ? 'Aucune liste archivée' : 'Aucune liste de prospection — créez-en une pour commencer.'}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {lists.map(list => {
          const c = list.counts
          const treated = c ? c.total - c.todo : 0
          const progress = c && c.total > 0 ? Math.round((treated / c.total) * 100) : 0
          return (
            <div
              key={list.id}
              className="card p-4 space-y-3 cursor-pointer hover:border-primary-300 hover:shadow-sm transition-colors"
              onClick={() => navigate(`/prospection/listes/${list.id}`)}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold text-slate-900 truncate">{list.name}</p>
                  <p className="text-xs text-slate-400">
                    {refs.label('lead_source', list.source)}
                    {list.assignedTo && <> · {list.assignedTo.firstName} {list.assignedTo.lastName}</>}
                  </p>
                </div>
                {canManage && (
                  <button
                    type="button"
                    title={list.status === 'ARCHIVED' ? 'Réactiver' : 'Archiver'}
                    className="btn-ghost p-1.5 rounded-lg text-slate-400 hover:text-primary-600 flex-shrink-0"
                    onClick={(e) => { e.stopPropagation(); setArchiveTarget(list) }}
                  >
                    {list.status === 'ARCHIVED' ? <ArchiveRestore className="w-4 h-4" /> : <Archive className="w-4 h-4" />}
                  </button>
                )}
              </div>

              {c && (
                <>
                  <div>
                    <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div className="h-full bg-primary-500 rounded-full" style={{ width: `${progress}%` }} />
                    </div>
                    <p className="text-xs text-slate-400 mt-1">{treated} / {c.total} traités</p>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-slate-500 flex-wrap">
                    <span>{c.contacted} joint{c.contacted > 1 ? 's' : ''}</span>
                    <span>{c.callback} à rappeler</span>
                    <span className="text-violet-600">{c.qualified} qualifié{c.qualified > 1 ? 's' : ''}</span>
                    <span className="text-red-500">{c.rejected} écarté{c.rejected > 1 ? 's' : ''}</span>
                  </div>
                </>
              )}
              <p className="text-xs text-slate-400">Créée le {formatDate(list.createdAt)}</p>
            </div>
          )
        })}
      </div>

      {/* ── Nouvelle liste ───────────────────────────────────────────────── */}
      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Nouvelle liste de prospection" size="md">
        <div className="space-y-4">
          <div className="form-group">
            <label className="label">Nom *</label>
            <input className="input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="IT Roanne octobre 2026" autoFocus />
          </div>
          <div className="form-group">
            <label className="label">Description</label>
            <textarea className="input resize-none" rows={2} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="form-group">
              <label className="label">Source par défaut</label>
              <select className="input" value={form.source} onChange={e => setForm(f => ({ ...f, source: e.target.value }))}>
                {refs.options('lead_source').map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="label">Pipeline par défaut à la qualification</label>
              <select className="input" value={form.pipelineId} onChange={e => setForm(f => ({ ...f, pipelineId: e.target.value }))}>
                <option value="">— Pipeline par défaut —</option>
                {pipelines.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          </div>
          <div className="form-group">
            <label className="label">Commercial par défaut</label>
            <select className="input" value={form.assignedToId} onChange={e => setForm(f => ({ ...f, assignedToId: e.target.value }))}>
              <option value="">— Non assigné —</option>
              {users.map(u => <option key={u.id} value={u.id}>{u.firstName} {u.lastName}</option>)}
            </select>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button className="btn-secondary" onClick={() => setShowCreate(false)}>Annuler</button>
            <button className="btn-primary" disabled={!form.name.trim() || createMutation.isPending} onClick={() => createMutation.mutate(form)}>
              Créer
            </button>
          </div>
        </div>
      </Modal>

      {/* ── Archivage ────────────────────────────────────────────────────── */}
      <Modal open={!!archiveTarget} onClose={() => setArchiveTarget(null)} title={archiveTarget?.status === 'ARCHIVED' ? 'Réactiver la liste' : 'Archiver la liste'} size="sm">
        <p className="text-slate-600 mb-6">
          {archiveTarget?.status === 'ARCHIVED'
            ? `Réactiver « ${archiveTarget?.name} » ?`
            : `Archiver « ${archiveTarget?.name} » ? Les prospects restent accessibles mais la liste ne sera plus proposée pour un nouvel import.`}
        </p>
        <div className="flex justify-end gap-3">
          <button className="btn-secondary" onClick={() => setArchiveTarget(null)}>Annuler</button>
          <button className="btn-primary" disabled={archiveMutation.isPending} onClick={() => archiveTarget && archiveMutation.mutate(archiveTarget)}>
            {archiveTarget?.status === 'ARCHIVED' ? 'Réactiver' : 'Archiver'}
          </button>
        </div>
      </Modal>

      {/* ── Import (étape Liste incluse) ────────────────────────────────── */}
      <ImportProspectsModal open={importListId !== null} onClose={() => setImportListId(null)} />
    </div>
  )
}
