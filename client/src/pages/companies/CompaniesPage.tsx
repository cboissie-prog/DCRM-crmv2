import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import type { Resolver } from 'react-hook-form'
import api from '../../lib/api'
import { PageSpinner } from '../../components/ui/Spinner'
import { Modal } from '../../components/ui/Modal'
import { toast } from '../../components/ui/Toast'
import { useAuthStore } from '../../store/authStore'
import { Plus, Search, Building2, Users, Wrench, FileText, TrendingUp, MapPin, Pencil, Trash2, Download, Upload } from 'lucide-react'
import { ImportCsvModal } from '../../components/ui/ImportCsvModal'
import { downloadCsv } from '../../lib/exportCsv'
import type { Company, PaginatedResponse } from '../../types'

const schema = z.object({
  name: z.string().min(1, 'Nom requis'),
  siret: z.string().optional(),
  website: z.string().optional(),
  sector: z.string().optional(),
  employees: z.coerce.number().int().optional(),
  city: z.string().optional(),
  postalCode: z.string().optional(),
  billingAddress: z.string().optional(),
  notes: z.string().optional(),
})
type Form = z.infer<typeof schema>

const SECTORS = ['Commerce alimentaire', 'Pharmacie', 'Restauration', 'Santé', 'Commerce habillement', 'Informatique', 'Immobilier', 'Automobile', 'Industrie', 'Services', 'Autre']

export function CompaniesPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const user = useAuthStore(s => s.user)
  const canEdit = ['ADMIN', 'MANAGER'].includes(user?.role ?? '')

  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [showCreate, setShowCreate] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [editingCompany, setEditingCompany] = useState<Company | null>(null)
  const [deletingCompany, setDeletingCompany] = useState<Company | null>(null)

  const { data, isLoading } = useQuery<PaginatedResponse<Company>>({
    queryKey: ['companies', { search, page }],
    queryFn: async () => {
      const { data } = await api.get('/companies', { params: { search: search || undefined, page, limit: 25 } })
      return data
    },
    staleTime: 30_000,
  })

  // ── Mutations ──────────────────────────────────────────────────────────────

  const createMutation = useMutation({
    mutationFn: (v: Form) => api.post('/companies', v),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['companies'] }); setShowCreate(false); toast.success('Entreprise créée') },
    onError: () => toast.error('Erreur lors de la création'),
  })

  const editMutation = useMutation({
    mutationFn: ({ id, values }: { id: string; values: Form }) => api.put(`/companies/${id}`, values),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['companies'] })
      qc.invalidateQueries({ queryKey: ['company', editingCompany?.id] })
      setEditingCompany(null)
      toast.success('Entreprise modifiée')
    },
    onError: () => toast.error('Erreur lors de la modification'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/companies/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['companies'] })
      setDeletingCompany(null)
      toast.success('Entreprise supprimée')
    },
    onError: () => toast.error('Erreur lors de la suppression'),
  })

  // ── Forms ──────────────────────────────────────────────────────────────────

  const createForm = useForm<Form>({ resolver: zodResolver(schema) as Resolver<Form> })
  const editForm = useForm<Form>({ resolver: zodResolver(schema) as Resolver<Form> })

  const openCreate = () => {
    createForm.reset({})
    setShowCreate(true)
  }

  const openEdit = (c: Company, e: React.MouseEvent) => {
    e.stopPropagation()
    editForm.reset({
      name: c.name ?? '',
      siret: c.siret ?? '',
      website: c.website ?? '',
      sector: c.sector ?? '',
      employees: c.employees ?? undefined,
      city: c.city ?? '',
      postalCode: c.postalCode ?? '',
      billingAddress: c.billingAddress ?? '',
      notes: c.notes ?? '',
    })
    setEditingCompany(c)
  }

  const openDelete = (c: Company, e: React.MouseEvent) => {
    e.stopPropagation()
    setDeletingCompany(c)
  }

  return (
    <div className="space-y-5 fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Entreprises</h1>
          <p className="page-subtitle">{data?.meta.total || 0} entreprises</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="btn-secondary flex items-center gap-1.5"
            onClick={() => downloadCsv('/companies/export/csv', { search: search || undefined }, `entreprises-${new Date().toISOString().slice(0,10)}.csv`)}
            title="Exporter en CSV"
          >
            <Download className="w-4 h-4" /> Export
          </button>
          {canEdit && (
            <button className="btn-secondary flex items-center gap-1.5" onClick={() => setShowImport(true)} title="Importer depuis CSV">
              <Upload className="w-4 h-4" /> Import
            </button>
          )}
          <button className="btn-primary" onClick={openCreate}>
            <Plus className="w-4 h-4" /> Nouvelle entreprise
          </button>
        </div>
      </div>

      <div className="flex gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input className="input pl-9" placeholder="Rechercher..." value={search} onChange={e => { setSearch(e.target.value); setPage(1) }} />
        </div>
      </div>

      {isLoading ? <PageSpinner /> : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {data?.data.length === 0 ? (
            <div className="col-span-3 empty-state">
              <Building2 className="w-14 h-14 text-slate-200 mb-3" />
              <p className="text-slate-500">Aucune entreprise trouvée</p>
            </div>
          ) : data?.data.map(c => (
            <div
              key={c.id}
              className="card p-5 cursor-pointer hover:border-primary-200 hover:shadow-md transition-all"
              onClick={() => navigate(`/companies/${c.id}`)}
            >
              <div className="flex items-start gap-3 mb-3">
                <div className="w-10 h-10 bg-slate-100 rounded-xl flex items-center justify-center flex-shrink-0">
                  <Building2 className="w-5 h-5 text-slate-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-slate-900 truncate">{c.name}</p>
                  {c.sector && <p className="text-xs text-slate-500">{c.sector}</p>}
                  {c.city && (
                    <div className="flex items-center gap-1 text-xs text-slate-400 mt-0.5">
                      <MapPin className="w-3 h-3" /> {c.city}
                    </div>
                  )}
                </div>
                {canEdit && (
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100" onClick={e => e.stopPropagation()}>
                    <button
                      className="btn-ghost p-1.5 rounded-lg"
                      title="Modifier"
                      onClick={e => openEdit(c, e)}
                    >
                      <Pencil className="w-3.5 h-3.5 text-slate-400 hover:text-primary-600" />
                    </button>
                    <button
                      className="btn-ghost p-1.5 rounded-lg"
                      title="Supprimer"
                      onClick={e => openDelete(c, e)}
                    >
                      <Trash2 className="w-3.5 h-3.5 text-slate-400 hover:text-red-500" />
                    </button>
                  </div>
                )}
              </div>
              {/* Action buttons visible on hover — duplicate row below card footer */}
              {canEdit && (
                <div className="flex gap-1 mb-2 justify-end" onClick={e => e.stopPropagation()}>
                  <button
                    className="btn-ghost btn-sm flex items-center gap-1 px-2 py-1 text-xs text-slate-500 hover:text-primary-600"
                    onClick={e => openEdit(c, e)}
                  >
                    <Pencil className="w-3 h-3" /> Modifier
                  </button>
                  <button
                    className="btn-ghost btn-sm flex items-center gap-1 px-2 py-1 text-xs text-slate-500 hover:text-red-500"
                    onClick={e => openDelete(c, e)}
                  >
                    <Trash2 className="w-3 h-3" /> Supprimer
                  </button>
                </div>
              )}
              <div className="grid grid-cols-4 gap-2 pt-3 border-t border-slate-100">
                <div className="text-center">
                  <div className="flex items-center justify-center gap-1 text-xs text-slate-500">
                    <Users className="w-3 h-3" /> <span className="font-semibold text-slate-700">{c._count?.contacts || 0}</span>
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">Contacts</p>
                </div>
                <div className="text-center">
                  <div className="flex items-center justify-center gap-1 text-xs text-slate-500">
                    <TrendingUp className="w-3 h-3" /> <span className="font-semibold text-slate-700">{c._count?.opportunities || 0}</span>
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">Opport.</p>
                </div>
                <div className="text-center">
                  <div className="flex items-center justify-center gap-1 text-xs text-slate-500">
                    <Wrench className="w-3 h-3" /> <span className="font-semibold text-slate-700">{c._count?.tickets || 0}</span>
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">Tickets</p>
                </div>
                <div className="text-center">
                  <div className="flex items-center justify-center gap-1 text-xs text-slate-500">
                    <FileText className="w-3 h-3" /> <span className="font-semibold text-slate-700">{c._count?.contracts || 0}</span>
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">Contrats</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {data && data.meta.total > 25 && (
        <div className="flex items-center justify-between text-sm text-slate-500">
          <span>{(page - 1) * 25 + 1} – {Math.min(page * 25, data.meta.total)} sur {data.meta.total}</span>
          <div className="flex gap-2">
            <button className="btn-secondary btn-sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Précédent</button>
            <button className="btn-secondary btn-sm" disabled={page * 25 >= data.meta.total} onClick={() => setPage(p => p + 1)}>Suivant</button>
          </div>
        </div>
      )}

      {/* ── Create Modal ── */}
      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Nouvelle entreprise">
        <CompanyForm
          form={createForm}
          onSubmit={v => createMutation.mutate(v)}
          isPending={createMutation.isPending}
          onCancel={() => setShowCreate(false)}
          submitLabel="Créer"
        />
      </Modal>

      {/* ── Edit Modal ── */}
      <Modal open={!!editingCompany} onClose={() => setEditingCompany(null)} title="Modifier l'entreprise">
        <CompanyForm
          form={editForm}
          onSubmit={v => editingCompany && editMutation.mutate({ id: editingCompany.id, values: v })}
          isPending={editMutation.isPending}
          onCancel={() => setEditingCompany(null)}
          submitLabel="Enregistrer"
        />
      </Modal>

      {/* ── Delete Confirm Modal ── */}
      <Modal open={!!deletingCompany} onClose={() => setDeletingCompany(null)} title="Supprimer l'entreprise" size="sm">
        <div className="space-y-4">
          <p className="text-slate-600">
            Êtes-vous sûr de vouloir supprimer <strong>{deletingCompany?.name}</strong> ? Cette action est irréversible.
          </p>
          <div className="flex justify-end gap-3">
            <button className="btn-secondary" onClick={() => setDeletingCompany(null)}>Annuler</button>
            <button
              className="px-4 py-2 rounded-lg text-sm font-medium bg-red-600 text-white hover:bg-red-700 transition-colors"
              onClick={() => deletingCompany && deleteMutation.mutate(deletingCompany.id)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? 'Suppression...' : 'Supprimer'}
            </button>
          </div>
        </div>
      </Modal>

      {/* ── Import CSV Modal ── */}
      <ImportCsvModal
        isOpen={showImport}
        onClose={() => setShowImport(false)}
        entity="companies"
        invalidateKeys={[['companies'], ['companies-light']]}
        templateHeaders="Nom,SIRET,N° TVA,Site web,Secteur,Ville,Code postal,Adresse,Notes"
        templateExample="Ma Société SARL,12345678900012,FR12345678900,https://example.com,Informatique,Paris,75001,1 rue de la Paix,"
      />
    </div>
  )
}

// ── Shared form component ─────────────────────────────────────────────────────

function CompanyForm({
  form,
  onSubmit,
  isPending,
  onCancel,
  submitLabel,
}: {
  form: ReturnType<typeof useForm<Form>>
  onSubmit: (v: Form) => void
  isPending: boolean
  onCancel: () => void
  submitLabel: string
}) {
  const { register, handleSubmit, formState: { errors, isSubmitting } } = form
  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="form-group">
        <label className="label">Raison sociale *</label>
        <input {...register('name')} className={`input ${errors.name ? 'input-error' : ''}`} />
        {errors.name && <p className="form-error">{errors.name.message}</p>}
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="form-group">
          <label className="label">SIRET</label>
          <input {...register('siret')} className="input" />
        </div>
        <div className="form-group">
          <label className="label">Site web</label>
          <input {...register('website')} className="input" placeholder="https://" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="form-group">
          <label className="label">Secteur</label>
          <select {...register('sector')} className="input">
            <option value="">Choisir...</option>
            {SECTORS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label className="label">Nb. employés</label>
          <input {...register('employees')} type="number" className="input" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="form-group">
          <label className="label">Ville</label>
          <input {...register('city')} className="input" />
        </div>
        <div className="form-group">
          <label className="label">Code postal</label>
          <input {...register('postalCode')} className="input" />
        </div>
      </div>
      <div className="form-group">
        <label className="label">Adresse de facturation</label>
        <input {...register('billingAddress')} className="input" />
      </div>
      <div className="form-group">
        <label className="label">Notes</label>
        <textarea {...register('notes')} className="input" rows={2} />
      </div>
      <div className="flex justify-end gap-3 pt-2">
        <button type="button" className="btn-secondary" onClick={onCancel}>Annuler</button>
        <button type="submit" className="btn-primary" disabled={isSubmitting || isPending}>{submitLabel}</button>
      </div>
    </form>
  )
}
