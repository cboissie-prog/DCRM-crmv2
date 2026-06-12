import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import type { Resolver } from 'react-hook-form'
import {
  TrendingUp, Search, Building2,
  AlertCircle, Plus, Pencil, Trash2,
  PhoneOff, ArrowRightCircle, RotateCcw, UserPlus, Users, X,
} from 'lucide-react'
import api from '../../lib/api'
import { useAuthStore } from '../../store/authStore'
import { formatDate, formatRelative, LEAD_SOURCES, getScoreColor, getScoreBg, cn } from '../../lib/utils'
import { Badge } from '../../components/ui/Badge'
import { Avatar } from '../../components/ui/Avatar'
import { PageSpinner } from '../../components/ui/Spinner'
import { Modal } from '../../components/ui/Modal'
import { toast } from '../../components/ui/Toast'
import type { Lead } from '../../types'

const LEAD_STATUSES: Record<string, { label: string; color: string }> = {
  NEW:         { label: 'Nouveau',        color: 'badge-gray'   },
  CONTACTED:   { label: 'Contacté',       color: 'badge-blue'   },
  UNREACHABLE: { label: 'Non joignable',  color: 'badge-orange' },
  QUALIFIED:   { label: 'Qualifié',       color: 'badge-purple' },
  CONVERTED:   { label: 'Converti',       color: 'badge-green'  },
  LOST:        { label: 'Perdu',          color: 'badge-red'    },
}

// Affichage simplifié : Traité / Non traité
function leadSimpleStatus(status: string): { label: string; variant: string } {
  if (status === 'CONVERTED') return { label: 'Traité', variant: 'badge-green' }
  return { label: 'Non traité', variant: 'badge-gray' }
}

// ── Interfaces ─────────────────────────────────────────────────────────────────

interface PipelineStage { id: string; key: string; name: string; color: string; isWon: boolean; isLost: boolean; order: number }
interface Pipeline { id: string; name: string; color: string; isDefault: boolean; stages: PipelineStage[] }

// ── Lead form schema ───────────────────────────────────────────────────────────

const leadSchema = z.object({
  contactId: z.string().optional(),
  // New contact fields (used when contactId is empty)
  newFirstName: z.string().optional(),
  newLastName: z.string().optional(),
  newEmail: z.string().optional(),
  newPhone: z.string().optional(),
  newCompanyId: z.string().optional(),
  newCompanyName: z.string().optional(),
  newCompanySiret: z.string().optional(),
  newCompanyVatNumber: z.string().optional(),
  newCompanyWebsite: z.string().optional(),
  newCompanySector: z.string().optional(),
  newCompanyCity: z.string().optional(),
  newCompanyPostalCode: z.string().optional(),
  newCompanyBillingAddress: z.string().optional(),
  title: z.string().min(1, 'Titre requis'),
  description: z.string().optional(),
  source: z.string().optional(),
  score: z.coerce.number().int().min(0).max(100).optional(),
  status: z.string().optional(),
})
type LeadForm = z.infer<typeof leadSchema>

// ── Add to pipeline modal ──────────────────────────────────────────────────────

function AddToPipelineModal({ lead, open, onClose }: { lead: Lead | null; open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const [selectedPipelineId, setSelectedPipelineId] = useState<string>('')
  const [selectedStage, setSelectedStage] = useState<string>('')

  const { data: pipelines = [] } = useQuery<Pipeline[]>({
    queryKey: ['pipelines'],
    queryFn: async () => { const { data } = await api.get('/pipelines'); return data.data ?? [] },
    staleTime: 60_000,
    enabled: open,
  })

  // Auto-select default pipeline when loaded
  const activePipeline = pipelines.find(p => p.id === selectedPipelineId) ?? pipelines.find(p => p.isDefault) ?? pipelines[0]
  const activeStages = activePipeline?.stages.filter(s => !s.isWon && !s.isLost) ?? []

  const convertMutation = useMutation({
    mutationFn: ({ pipelineId, stage }: { pipelineId: string; stage: string }) =>
      api.post(`/pipeline/leads/${lead!.id}/convert`, { pipelineId, stage }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pipeline-leads'] })
      qc.invalidateQueries({ queryKey: ['pipeline-opportunities'] })
      toast.success('Opportunité créée dans le pipeline !')
      onClose()
    },
    onError: () => toast.error('Erreur lors de la création'),
  })

  const handleSubmit = () => {
    const pid = selectedPipelineId || activePipeline?.id
    const stg = selectedStage || activeStages[0]?.key
    if (!pid || !stg) { toast.error('Sélectionnez un pipeline et une étape'); return }
    convertMutation.mutate({ pipelineId: pid, stage: stg })
  }

  if (!lead) return null

  return (
    <Modal open={open} onClose={onClose} title="Ajouter au pipeline" size="sm">
      <div className="space-y-4">
        {/* Lead info */}
        <div className="p-3 bg-slate-50 border border-slate-100 rounded-xl flex items-center gap-3">
          <Avatar firstName={lead.contact.firstName} lastName={lead.contact.lastName} size="sm" />
          <div>
            <p className="text-sm font-semibold text-slate-900">{lead.contact.firstName} {lead.contact.lastName}</p>
            <p className="text-xs text-slate-500">{lead.title}</p>
          </div>
        </div>

        {/* Pipeline selector */}
        <div className="form-group">
          <label className="label">Pipeline *</label>
          {pipelines.length === 0 ? (
            <p className="text-sm text-slate-400">Chargement...</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {pipelines.map(p => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => { setSelectedPipelineId(p.id); setSelectedStage('') }}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border transition-colors',
                    (selectedPipelineId === p.id || (!selectedPipelineId && p.isDefault))
                      ? 'bg-primary-50 border-primary-300 text-primary-700 font-medium'
                      : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300',
                  )}
                >
                  <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />
                  {p.name}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Stage selector */}
        {activeStages.length > 0 && (
          <div className="form-group">
            <label className="label">Étape *</label>
            <div className="flex flex-wrap gap-2">
              {activeStages.map(s => (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => setSelectedStage(s.key)}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border transition-colors',
                    (selectedStage === s.key || (!selectedStage && activeStages[0]?.key === s.key))
                      ? 'font-medium'
                      : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300',
                  )}
                  style={
                    (selectedStage === s.key || (!selectedStage && activeStages[0]?.key === s.key))
                      ? { background: `${s.color}20`, borderColor: s.color, color: s.color }
                      : undefined
                  }
                >
                  <span className="w-2 h-2 rounded-full" style={{ background: s.color }} />
                  {s.name}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex justify-end gap-3 pt-2">
          <button className="btn-secondary" onClick={onClose}>Annuler</button>
          <button
            className="btn-primary"
            onClick={handleSubmit}
            disabled={convertMutation.isPending || pipelines.length === 0}
          >
            <ArrowRightCircle className="w-4 h-4" /> Ajouter au pipeline
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────────

export function LeadsPage() {
  const { isAuthenticated } = useAuthStore()
  const user = useAuthStore(s => s.user)
  const qc = useQueryClient()
  const canEdit = ['ADMIN', 'MANAGER', 'COMMERCIAL'].includes(user?.role ?? '')

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [pipelineLead, setPipelineLead] = useState<Lead | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [editingLead, setEditingLead] = useState<Lead | null>(null)
  const [deletingLead, setDeletingLead] = useState<Lead | null>(null)

  // ── Queries ────────────────────────────────────────────────────────────────

  const { data: leads = [], isLoading } = useQuery<Lead[]>({
    queryKey: ['pipeline-leads', { search, statusFilter }],
    queryFn: async () => {
      const { data } = await api.get('/pipeline/leads', { params: { search: search || undefined, status: statusFilter || undefined } })
      return data.data ?? data
    },
    enabled: isAuthenticated,
    staleTime: 30_000,
  })

  const { data: contacts = [] } = useQuery<{ id: string; firstName: string; lastName: string; company?: { name: string } }[]>({
    queryKey: ['contacts-light'],
    queryFn: async () => {
      const { data } = await api.get('/contacts', { params: { limit: 200 } })
      return data.data ?? []
    },
    staleTime: 60_000,
  })

  const { data: companies = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['companies-light'],
    queryFn: async () => {
      const { data } = await api.get('/companies', { params: { limit: 200 } })
      return data.data ?? []
    },
    staleTime: 60_000,
  })

  // ── Mutations ──────────────────────────────────────────────────────────────

  const createMutation = useMutation({
    mutationFn: async (values: LeadForm) => {
      let contactId = values.contactId
      // Create contact inline if no existing contact selected
      if (!contactId && values.newFirstName) {
        // Créer l'entreprise si nécessaire
        let companyId = values.newCompanyId
        if (!companyId && values.newCompanyName?.trim()) {
          const { data } = await api.post('/companies', {
            name: values.newCompanyName.trim(),
            siret: values.newCompanySiret || undefined,
            vatNumber: values.newCompanyVatNumber || undefined,
            website: values.newCompanyWebsite || undefined,
            sector: values.newCompanySector || undefined,
            city: values.newCompanyCity || undefined,
            postalCode: values.newCompanyPostalCode || undefined,
            billingAddress: values.newCompanyBillingAddress || undefined,
          })
          companyId = data.data?.id
        }
        const { data } = await api.post('/contacts', {
          firstName: values.newFirstName,
          lastName: values.newLastName || '',
          email: values.newEmail || undefined,
          phone: values.newPhone || undefined,
          companyId: companyId || undefined,
        })
        contactId = data.data?.id ?? data.id
      }
      if (!contactId) throw new Error('Contact requis')
      return api.post('/pipeline/leads', {
        contactId,
        title: values.title,
        description: values.description,
        source: values.source,
        score: values.score,
        status: 'NEW',
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pipeline-leads'] })
      qc.invalidateQueries({ queryKey: ['contacts-light'] })
      setShowCreate(false)
      toast.success('Lead créé')
    },
    onError: (err: any) => toast.error(err?.message || 'Erreur lors de la création'),
  })

  const editMutation = useMutation({
    mutationFn: ({ id, values }: { id: string; values: LeadForm }) => api.put(`/pipeline/leads/${id}`, { contactId: values.contactId, title: values.title, description: values.description, source: values.source, score: values.score }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['pipeline-leads'] }); setEditingLead(null); toast.success('Lead modifié') },
    onError: () => toast.error('Erreur lors de la modification'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/pipeline/leads/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['pipeline-leads'] }); setDeletingLead(null); toast.success('Lead supprimé') },
    onError: () => toast.error('Erreur lors de la suppression'),
  })

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api.patch(`/pipeline/leads/${id}/status`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pipeline-leads'] }),
    onError: () => toast.error('Erreur lors de la mise à jour'),
  })

  // ── Forms ──────────────────────────────────────────────────────────────────

  const createForm = useForm<LeadForm>({ resolver: zodResolver(leadSchema) as Resolver<LeadForm>, defaultValues: { score: 50, source: 'MANUAL' } })
  const editForm = useForm<LeadForm>({ resolver: zodResolver(leadSchema) as Resolver<LeadForm> })

  const openEdit = (l: Lead) => {
    editForm.reset({
      contactId: l.contactId ?? '',
      title: l.title,
      description: l.description ?? '',
      source: l.source ?? '',
      score: l.score,
      status: l.status,
    })
    setEditingLead(l)
  }

  // ── Stats ──────────────────────────────────────────────────────────────────

  const totalLeads = leads.length
  const toContactLeads = leads.filter(l => l.status !== 'CONVERTED').length
  const avgScore = leads.length > 0 ? Math.round(leads.reduce((acc, l) => acc + l.score, 0) / leads.length) : 0

  // Filtre simplifié client-side : 'treated' | 'untreated' | ''
  const filteredLeads = statusFilter === 'treated'
    ? leads.filter(l => l.status === 'CONVERTED')
    : statusFilter === 'untreated'
    ? leads.filter(l => l.status !== 'CONVERTED')
    : leads

  // Tri par date de création, plus récent en premier
  const sortedLeads = [...filteredLeads].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

  return (
    <div className="space-y-5 fade-in">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Leads</h1>
          <p className="page-subtitle">{totalLeads} leads</p>
        </div>
        {canEdit && (
          <button className="btn-primary" onClick={() => { createForm.reset({ score: 50, source: 'MANUAL' }); setShowCreate(true) }}>
            <Plus className="w-4 h-4" /> Nouveau lead
          </button>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl border border-slate-200 p-4 flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-primary-100 flex items-center justify-center">
            <TrendingUp className="w-5 h-5 text-primary-600" />
          </div>
          <div>
            <p className="text-xs text-slate-500">Total leads</p>
            <p className="text-xl font-bold text-slate-900">{totalLeads}</p>
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 p-4 flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center">
            <ArrowRightCircle className="w-5 h-5 text-amber-600" />
          </div>
          <div>
            <p className="text-xs text-slate-500">À traiter</p>
            <p className="text-xl font-bold text-slate-900">{toContactLeads}</p>
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 p-4 flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center">
            <AlertCircle className="w-5 h-5 text-amber-600" />
          </div>
          <div>
            <p className="text-xs text-slate-500">Score moyen</p>
            <p className="text-xl font-bold text-slate-900">{avgScore}</p>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap items-center">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input className="input pl-9" placeholder="Rechercher un lead..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select className="input w-auto" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="">Tous</option>
          <option value="untreated">Non traité</option>
          <option value="treated">Traité</option>
        </select>
        {(search || statusFilter) && (
          <button
            className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800 border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white hover:bg-slate-50 transition-colors"
            onClick={() => { setSearch(''); setStatusFilter('') }}
          >
            <X className="w-3 h-3" /> Réinitialiser
          </button>
        )}
      </div>

      {/* Table */}
      {isLoading ? <PageSpinner /> : (
        <div className="table-container overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>Statut</th>
                <th>Lead</th>
                <th>Contact</th>
                <th>Entreprise</th>
                <th>Source</th>
                <th>Score</th>
                <th>Créé</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sortedLeads.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-12 text-slate-400">Aucun lead trouvé</td></tr>
              ) : sortedLeads.map(lead => {
                const simpleStatus = leadSimpleStatus(lead.status)
                return (
                <tr key={lead.id}>
                  <td>
                    <Badge variant={simpleStatus.variant}>{simpleStatus.label}</Badge>
                  </td>
                  <td>
                    <div>
                      <p className="font-medium text-slate-900">{lead.title}</p>
                      {lead.description && <p className="text-xs text-slate-400 mt-0.5 line-clamp-1">{lead.description}</p>}
                    </div>
                  </td>
                  <td>
                    <div className="flex items-center gap-2">
                      <Avatar firstName={lead.contact.firstName} lastName={lead.contact.lastName} size="sm" />
                      <span className="text-sm text-slate-700">{lead.contact.firstName} {lead.contact.lastName}</span>
                    </div>
                  </td>
                  <td>
                    {lead.contact.company ? (
                      <div className="flex items-center gap-1.5 text-slate-600 text-sm">
                        <Building2 className="w-3.5 h-3.5 text-slate-400" />
                        {lead.contact.company.name}
                      </div>
                    ) : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="text-slate-500 text-xs">{LEAD_SOURCES[lead.source] || lead.source}</td>
                  <td>
                    <div className="flex items-center gap-2">
                      <div className={cn('px-2 py-0.5 rounded-full text-xs font-bold', getScoreBg(lead.score), getScoreColor(lead.score))}>
                        {lead.score}
                      </div>
                      <div className="w-16 bg-slate-100 rounded-full h-1.5">
                        <div
                          className={cn('h-1.5 rounded-full', lead.score >= 70 ? 'bg-emerald-500' : lead.score >= 40 ? 'bg-amber-500' : 'bg-red-500')}
                          style={{ width: `${lead.score}%` }}
                        />
                      </div>
                    </div>
                  </td>
                  <td className="text-slate-400 text-xs" title={formatDate(lead.createdAt)}>{formatRelative(lead.createdAt)}</td>
                  <td>
                    <div className="flex items-center gap-1">
                      {/* → Pipeline : tous les leads actifs sauf déjà convertis */}
                      {!['CONVERTED', 'LOST'].includes(lead.status) && canEdit && (
                        <button
                          className="btn-sm flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium bg-primary-50 text-primary-700 border border-primary-200 hover:bg-primary-100 transition-colors"
                          onClick={() => setPipelineLead(lead)}
                          title="Ajouter au pipeline"
                        >
                          <ArrowRightCircle className="w-3 h-3" /> Pipeline
                        </button>
                      )}
                      {/* Non joignable */}
                      {(lead.status === 'NEW' || lead.status === 'UNREACHABLE') && canEdit && (
                        <button
                          className="btn-sm flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium bg-slate-50 text-slate-500 border border-slate-200 hover:bg-slate-100 transition-colors"
                          onClick={() => statusMutation.mutate({ id: lead.id, status: lead.status === 'UNREACHABLE' ? 'NEW' : 'UNREACHABLE' })}
                          disabled={statusMutation.isPending}
                          title={lead.status === 'UNREACHABLE' ? 'Remettre en nouveau' : 'Non joignable'}
                        >
                          {lead.status === 'UNREACHABLE' ? <RotateCcw className="w-3 h-3" /> : <PhoneOff className="w-3 h-3" />}
                        </button>
                      )}
                      {/* Réactiver si perdu */}
                      {lead.status === 'LOST' && canEdit && (
                        <button
                          className="btn-sm flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium bg-slate-50 text-slate-500 border border-slate-200 hover:bg-slate-100 transition-colors"
                          onClick={() => statusMutation.mutate({ id: lead.id, status: 'NEW' })}
                          disabled={statusMutation.isPending}
                          title="Réactiver le lead"
                        >
                          <RotateCcw className="w-3 h-3" /> Réactiver
                        </button>
                      )}
                      {canEdit && (
                        <>
                          <button className="btn-ghost btn-sm p-1.5 rounded-lg text-slate-400 hover:text-primary-600" onClick={() => openEdit(lead)}>
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button className="btn-ghost btn-sm p-1.5 rounded-lg text-slate-400 hover:text-red-500" onClick={() => setDeletingLead(lead)}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Create Modal ── */}
      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Nouveau lead">
        <LeadFormFields
          form={createForm}
          contacts={contacts}
          companies={companies}
          onSubmit={v => createMutation.mutate(v)}
          isPending={createMutation.isPending}
          onCancel={() => setShowCreate(false)}
          submitLabel="Créer le lead"
        />
      </Modal>

      {/* ── Edit Modal ── */}
      <Modal open={!!editingLead} onClose={() => setEditingLead(null)} title="Modifier le lead">
        <LeadFormFields
          form={editForm}
          contacts={contacts}
          companies={companies}
          onSubmit={v => editingLead && editMutation.mutate({ id: editingLead.id, values: v })}
          isPending={editMutation.isPending}
          onCancel={() => setEditingLead(null)}
          submitLabel="Enregistrer"
          showStatus
          editMode
        />
      </Modal>

      {/* ── Delete Modal ── */}
      <Modal open={!!deletingLead} onClose={() => setDeletingLead(null)} title="Supprimer le lead" size="sm">
        <div className="space-y-4">
          <p className="text-slate-600">Êtes-vous sûr de vouloir supprimer <strong>{deletingLead?.title}</strong> ?</p>
          <div className="flex justify-end gap-3">
            <button className="btn-secondary" onClick={() => setDeletingLead(null)}>Annuler</button>
            <button className="px-4 py-2 rounded-lg text-sm font-medium bg-red-600 text-white hover:bg-red-700 transition-colors" onClick={() => deletingLead && deleteMutation.mutate(deletingLead.id)} disabled={deleteMutation.isPending}>
              {deleteMutation.isPending ? 'Suppression...' : 'Supprimer'}
            </button>
          </div>
        </div>
      </Modal>

      {/* ── Add to pipeline Modal ── */}
      <AddToPipelineModal lead={pipelineLead} open={!!pipelineLead} onClose={() => setPipelineLead(null)} />
    </div>
  )
}

// ── Lead form fields ───────────────────────────────────────────────────────────

function LeadFormFields({
  form,
  contacts,
  companies,
  onSubmit,
  isPending,
  onCancel,
  submitLabel,
  showStatus = false,
  editMode = false,
}: {
  form: ReturnType<typeof useForm<LeadForm>>
  contacts: { id: string; firstName: string; lastName: string; company?: { name: string } }[]
  companies: { id: string; name: string }[]
  onSubmit: (v: LeadForm) => void
  isPending: boolean
  onCancel: () => void
  submitLabel: string
  showStatus?: boolean
  editMode?: boolean
}) {
  const [contactMode, setContactMode] = useState<'existing' | 'new'>('existing')
  const [newCompanyMode, setNewCompanyMode] = useState(false)
  const { register, handleSubmit, formState: { errors, isSubmitting } } = form

  const handleFormSubmit = (v: LeadForm) => {
    if (contactMode === 'existing' && !v.contactId) {
      form.setError('contactId', { message: 'Sélectionnez un contact' })
      return
    }
    if (contactMode === 'new' && !v.newFirstName) {
      form.setError('newFirstName', { message: 'Prénom requis' })
      return
    }
    onSubmit(v)
  }

  return (
    <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-4">

      {/* Contact toggle — masqué en mode édition */}
      {!editMode && (
        <div className="form-group">
          <label className="label">Contact *</label>
          <div className="flex rounded-lg border border-slate-200 overflow-hidden mb-3">
            <button
              type="button"
              onClick={() => setContactMode('existing')}
              className={cn(
                'flex-1 flex items-center justify-center gap-1.5 py-2 text-sm font-medium transition-colors',
                contactMode === 'existing' ? 'bg-primary-600 text-white' : 'bg-white text-slate-500 hover:bg-slate-50',
              )}
            >
              <Users className="w-3.5 h-3.5" /> Contact existant
            </button>
            <button
              type="button"
              onClick={() => setContactMode('new')}
              className={cn(
                'flex-1 flex items-center justify-center gap-1.5 py-2 text-sm font-medium transition-colors',
                contactMode === 'new' ? 'bg-primary-600 text-white' : 'bg-white text-slate-500 hover:bg-slate-50',
              )}
            >
              <UserPlus className="w-3.5 h-3.5" /> Nouveau contact
            </button>
          </div>

          {contactMode === 'existing' ? (
            <>
              <select {...register('contactId')} className={`input ${errors.contactId ? 'input-error' : ''}`}>
                <option value="">Choisir un contact</option>
                {contacts.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.firstName} {c.lastName}{c.company ? ` — ${c.company.name}` : ''}
                  </option>
                ))}
              </select>
              {errors.contactId && <p className="form-error">{errors.contactId.message}</p>}
            </>
          ) : (
            <div className="space-y-3 p-3 bg-slate-50 rounded-xl border border-slate-100">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <input
                    {...register('newFirstName')}
                    placeholder="Prénom *"
                    className={`input ${errors.newFirstName ? 'input-error' : ''}`}
                  />
                  {errors.newFirstName && <p className="form-error">{errors.newFirstName.message}</p>}
                </div>
                <input {...register('newLastName')} placeholder="Nom" className="input" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input {...register('newEmail')} type="email" placeholder="Email" className="input" />
                <input {...register('newPhone')} placeholder="Téléphone" className="input" />
              </div>
              {newCompanyMode ? (
                <div className="space-y-2 p-3 bg-white rounded-xl border border-slate-200">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">Nouvelle entreprise</span>
                    <button
                      type="button"
                      onClick={() => { setNewCompanyMode(false); form.setValue('newCompanyName', '') }}
                      className="text-xs text-slate-400 hover:text-slate-700"
                    >
                      ✕ Annuler
                    </button>
                  </div>
                  <input {...register('newCompanyName')} placeholder="Nom de l'entreprise *" className="input" autoFocus />
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <input {...register('newCompanySiret')} placeholder="SIRET" className="input" />
                    <input {...register('newCompanyVatNumber')} placeholder="N° TVA" className="input" />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <input {...register('newCompanyWebsite')} placeholder="Site web" className="input" />
                    <input {...register('newCompanySector')} placeholder="Secteur d'activité" className="input" />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <input {...register('newCompanyCity')} placeholder="Ville" className="input" />
                    <input {...register('newCompanyPostalCode')} placeholder="Code postal" className="input" />
                  </div>
                  <input {...register('newCompanyBillingAddress')} placeholder="Adresse de facturation" className="input" />
                </div>
              ) : (
                <div className="flex gap-2">
                  <select {...register('newCompanyId')} className="input flex-1">
                    <option value="">Entreprise existante</option>
                    {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  <button
                    type="button"
                    onClick={() => { setNewCompanyMode(true); form.setValue('newCompanyId', '') }}
                    className="btn-secondary text-xs px-2 whitespace-nowrap"
                  >
                    + Nouvelle
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* En mode édition, contact simple (non modifiable) */}
      {editMode && (
        <div className="form-group">
          <label className="label">Contact</label>
          <select {...register('contactId')} className="input">
            <option value="">Choisir un contact</option>
            {contacts.map(c => (
              <option key={c.id} value={c.id}>
                {c.firstName} {c.lastName}{c.company ? ` — ${c.company.name}` : ''}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="form-group">
        <label className="label">Titre *</label>
        <input {...register('title')} className={`input ${errors.title ? 'input-error' : ''}`} placeholder="Ex : Intérêt pour solution caisse" />
        {errors.title && <p className="form-error">{errors.title.message}</p>}
      </div>

      <div className="form-group">
        <label className="label">Description</label>
        <textarea {...register('description')} className="input" rows={2} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="form-group">
          <label className="label">Source</label>
          <select {...register('source')} className="input">
            {Object.entries(LEAD_SOURCES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label className="label">Score (0-100)</label>
          <input {...register('score')} type="number" min={0} max={100} className="input" />
        </div>
      </div>

      {showStatus && (
        <div className="form-group">
          <label className="label">Statut</label>
          <select {...register('status')} className="input">
            {Object.entries(LEAD_STATUSES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </div>
      )}

      <div className="flex justify-end gap-3 pt-2">
        <button type="button" className="btn-secondary" onClick={onCancel}>Annuler</button>
        <button type="submit" className="btn-primary" disabled={isSubmitting || isPending}>{submitLabel}</button>
      </div>
    </form>
  )
}
