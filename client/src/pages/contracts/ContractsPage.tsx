import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import api from '../../lib/api'
import { formatDate, formatCurrency, CONTRACT_STATUSES, CONTRACT_TYPES } from '../../lib/utils'
import { Badge } from '../../components/ui/Badge'
import { PageSpinner } from '../../components/ui/Spinner'
import { Modal } from '../../components/ui/Modal'
import { toast } from '../../components/ui/Toast'
import { Plus, Pencil, Trash2, X } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import type { Resolver } from 'react-hook-form'
import type { Contract, Company, PaginatedResponse } from '../../types'
import { useAuthStore } from '../../store/authStore'

const contractSchema = z.object({
  companyId: z.string().min(1, 'Entreprise requise'),
  type: z.string().min(1, 'Type requis'),
  title: z.string().min(1, 'Titre requis'),
  description: z.string().optional(),
  status: z.string().min(1, 'Statut requis'),
  startDate: z.string().min(1, 'Date de début requise'),
  endDate: z.string().min(1, 'Date de fin requise'),
  renewalDate: z.string().optional(),
  monthlyAmount: z.coerce.number().min(0),
  annualAmount: z.coerce.number().min(0),
  slaResponseTime: z.coerce.number().optional(),
  autoRenewal: z.boolean().optional(),
  notes: z.string().optional(),
})
type ContractForm = z.infer<typeof contractSchema>

const CONTRACT_TYPE_OPTIONS = [
  { value: 'IT_MAINTENANCE', label: 'Maintenance IT' },
  { value: 'CASH_REGISTER_MAINTENANCE', label: 'Maintenance caisses' },
  { value: 'WEB_HOSTING', label: 'Hébergement web' },
  { value: 'SOFTWARE_MAINTENANCE', label: 'Maintenance logiciel' },
  { value: 'FULL_SUPPORT', label: 'Support complet' },
]

const CONTRACT_STATUS_OPTIONS = [
  { value: 'ACTIVE', label: 'Actif' },
  { value: 'PENDING', label: 'En attente' },
  { value: 'EXPIRING_SOON', label: 'Expire bientôt' },
  { value: 'EXPIRED', label: 'Expiré' },
  { value: 'CANCELLED', label: 'Annulé' },
]

export function ContractsPage() {
  const qc = useQueryClient()
  const { user } = useAuthStore()
  const canWrite = user?.role === 'ADMIN' || user?.role === 'MANAGER'
  const [searchParams] = useSearchParams()

  const [typeFilter, setTypeFilter] = useState(searchParams.get('type') ?? '')
  const [statusFilter, setStatusFilter] = useState(searchParams.get('status') ?? '')
  const [page, setPage] = useState(1)
  const [showModal, setShowModal] = useState(false)
  const [editingContract, setEditingContract] = useState<Contract | null>(null)
  const [deletingContract, setDeletingContract] = useState<Contract | null>(null)

  const { data, isLoading } = useQuery<PaginatedResponse<Contract>>({
    queryKey: ['contracts', { typeFilter, statusFilter, page }],
    queryFn: async () => {
      const { data } = await api.get('/contracts', {
        params: {
          type: typeFilter || undefined,
          status: statusFilter || undefined,
          page,
          limit: 25,
        },
      })
      return data
    },
    staleTime: 30_000,
  })

  const { data: companiesData } = useQuery<{ data: Company[] }>({
    queryKey: ['companies-list'],
    queryFn: async () => {
      const { data } = await api.get('/companies', { params: { limit: 200 } })
      return data
    },
    staleTime: 60_000,
  })
  const companies = companiesData?.data ?? []

  const { register, handleSubmit, reset, setValue, formState: { errors, isSubmitting } } = useForm<ContractForm>({
    resolver: zodResolver(contractSchema) as Resolver<ContractForm>,
    defaultValues: { status: 'ACTIVE', autoRenewal: false, monthlyAmount: 0, annualAmount: 0 },
  })

  const { data: contractTemplates } = useQuery<{ data: { id: string; name: string; description?: string; price: number; supplier?: string }[] }>({
    queryKey: ['products-contract-templates'],
    queryFn: async () => { const { data } = await api.get('/products', { params: { category: 'CONTRACT_TEMPLATE', limit: 100 } }); return data },
    staleTime: 120_000,
  })

  const createMutation = useMutation({
    mutationFn: (values: ContractForm) => api.post('/contracts', values),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contracts'] })
      setShowModal(false)
      toast.success('Contrat créé')
    },
    onError: () => toast.error('Erreur lors de la création'),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, values }: { id: string; values: ContractForm }) => api.put(`/contracts/${id}`, values),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contracts'] })
      setShowModal(false)
      setEditingContract(null)
      toast.success('Contrat modifié')
    },
    onError: () => toast.error('Erreur lors de la modification'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/contracts/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contracts'] })
      setDeletingContract(null)
      toast.success('Contrat supprimé')
    },
    onError: () => toast.error('Erreur lors de la suppression'),
  })

  const openCreate = () => {
    setEditingContract(null)
    reset({ status: 'ACTIVE', autoRenewal: false, monthlyAmount: 0, annualAmount: 0 })
    setShowModal(true)
  }

  const openEdit = (contract: Contract) => {
    setEditingContract(contract)
    reset({
      companyId: contract.companyId,
      type: contract.type,
      title: contract.title,
      description: contract.description ?? '',
      status: contract.status,
      startDate: contract.startDate ? contract.startDate.slice(0, 10) : '',
      endDate: contract.endDate ? contract.endDate.slice(0, 10) : '',
      renewalDate: contract.renewalDate ? contract.renewalDate.slice(0, 10) : '',
      monthlyAmount: contract.monthlyAmount,
      annualAmount: contract.annualAmount,
      slaResponseTime: contract.slaResponseTime ?? undefined,
      autoRenewal: contract.autoRenewal,
      notes: contract.notes ?? '',
    })
    setShowModal(true)
  }

  const onSubmit = (values: ContractForm) => {
    if (editingContract) {
      updateMutation.mutate({ id: editingContract.id, values })
    } else {
      createMutation.mutate(values)
    }
  }

  return (
    <div className="space-y-5 fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Contrats</h1>
          <p className="page-subtitle">{data?.meta.total ?? 0} contrats</p>
        </div>
        {canWrite && (
          <button className="btn-primary" onClick={openCreate}>
            <Plus className="w-4 h-4" /> Nouveau contrat
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap items-center">
        <select
          className="input w-auto"
          value={typeFilter}
          onChange={e => { setTypeFilter(e.target.value); setPage(1) }}
        >
          <option value="">Tous les types</option>
          {CONTRACT_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select
          className="input w-auto"
          value={statusFilter}
          onChange={e => { setStatusFilter(e.target.value); setPage(1) }}
        >
          <option value="">Tous les statuts</option>
          {CONTRACT_STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        {(typeFilter || statusFilter) && (
          <button
            className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800 border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white hover:bg-slate-50 transition-colors"
            onClick={() => { setTypeFilter(''); setStatusFilter(''); setPage(1) }}
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
                <th>Entreprise</th>
                <th>Type</th>
                <th>Titre</th>
                <th>Statut</th>
                <th>Mensuel</th>
                <th>Annuel</th>
                <th>Date fin</th>
                <th>Renouvellement</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {!data?.data.length ? (
                <tr><td colSpan={10} className="text-center py-12 text-slate-400">Aucun contrat trouvé</td></tr>
              ) : data.data.map(c => (
                <tr key={c.id}>
                  <td className="font-mono text-xs text-slate-600">{c.reference}</td>
                  <td className="text-slate-700">{c.company?.name ?? '—'}</td>
                  <td className="text-slate-500 text-xs">{CONTRACT_TYPES[c.type] ?? c.type}</td>
                  <td className="font-medium text-slate-900">{c.title}</td>
                  <td>
                    <Badge variant={CONTRACT_STATUSES[c.status]?.color ?? 'badge-gray'}>
                      {CONTRACT_STATUSES[c.status]?.label ?? c.status}
                    </Badge>
                  </td>
                  <td className="text-slate-600 text-sm">{formatCurrency(c.monthlyAmount)}</td>
                  <td className="text-slate-600 text-sm">{formatCurrency(c.annualAmount)}</td>
                  <td className="text-slate-400 text-xs">{formatDate(c.endDate)}</td>
                  <td className="text-slate-400 text-xs">{c.renewalDate ? formatDate(c.renewalDate) : '—'}</td>
                  <td>
                    {canWrite && (
                      <div className="flex items-center gap-1">
                        <button
                          className="btn-ghost btn-sm p-1.5 rounded-lg"
                          onClick={() => openEdit(c)}
                          title="Modifier"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          className="btn-ghost btn-sm p-1.5 rounded-lg text-red-500 hover:text-red-700"
                          onClick={() => setDeletingContract(c)}
                          title="Supprimer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
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

      {/* Create / Edit Modal */}
      <Modal
        open={showModal}
        onClose={() => { setShowModal(false); setEditingContract(null) }}
        title={editingContract ? 'Modifier le contrat' : 'Nouveau contrat'}
        size="lg"
      >
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {!editingContract && contractTemplates && contractTemplates.data.length > 0 && (
            <div className="bg-indigo-50 border border-indigo-100 rounded-lg p-3">
              <label className="label text-indigo-700">Partir d'un modèle</label>
              <select
                className="input border-indigo-200 bg-white"
                defaultValue=""
                onChange={e => {
                  const t = contractTemplates.data.find(x => x.id === e.target.value)
                  if (!t) return
                  setValue('title', t.name)
                  setValue('description', t.description ?? '')
                  setValue('monthlyAmount', t.price)
                  setValue('annualAmount', Math.round(t.price * 12 * 100) / 100)
                  if (t.supplier) setValue('type', t.supplier)
                }}
              >
                <option value="">— Choisir un modèle —</option>
                {contractTemplates.data.map(t => (
                  <option key={t.id} value={t.id}>{t.name}{t.price ? ` — ${t.price} €/mois` : ''}</option>
                ))}
              </select>
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div className="form-group col-span-2">
              <label className="label">Entreprise *</label>
              <select {...register('companyId')} className={`input ${errors.companyId ? 'input-error' : ''}`}>
                <option value="">Sélectionner une entreprise</option>
                {companies.map(co => <option key={co.id} value={co.id}>{co.name}</option>)}
              </select>
              {errors.companyId && <p className="form-error">{errors.companyId.message}</p>}
            </div>
            <div className="form-group">
              <label className="label">Type *</label>
              <select {...register('type')} className={`input ${errors.type ? 'input-error' : ''}`}>
                <option value="">Sélectionner un type</option>
                {CONTRACT_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              {errors.type && <p className="form-error">{errors.type.message}</p>}
            </div>
            <div className="form-group">
              <label className="label">Statut *</label>
              <select {...register('status')} className="input">
                {CONTRACT_STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div className="form-group col-span-2">
              <label className="label">Titre *</label>
              <input {...register('title')} className={`input ${errors.title ? 'input-error' : ''}`} />
              {errors.title && <p className="form-error">{errors.title.message}</p>}
            </div>
            <div className="form-group col-span-2">
              <label className="label">Description</label>
              <textarea {...register('description')} className="input" rows={2} />
            </div>
            <div className="form-group">
              <label className="label">Date de début *</label>
              <input {...register('startDate')} type="date" className={`input ${errors.startDate ? 'input-error' : ''}`} />
              {errors.startDate && <p className="form-error">{errors.startDate.message}</p>}
            </div>
            <div className="form-group">
              <label className="label">Date de fin *</label>
              <input {...register('endDate')} type="date" className={`input ${errors.endDate ? 'input-error' : ''}`} />
              {errors.endDate && <p className="form-error">{errors.endDate.message}</p>}
            </div>
            <div className="form-group">
              <label className="label">Date de renouvellement</label>
              <input {...register('renewalDate')} type="date" className="input" />
            </div>
            <div className="form-group">
              <label className="label">SLA — délai réponse (h)</label>
              <input {...register('slaResponseTime')} type="number" min={0} className="input" />
            </div>
            <div className="form-group">
              <label className="label">Montant mensuel (€)</label>
              <input {...register('monthlyAmount')} type="number" min={0} step={0.01} className="input" />
            </div>
            <div className="form-group">
              <label className="label">Montant annuel (€)</label>
              <input {...register('annualAmount')} type="number" min={0} step={0.01} className="input" />
            </div>
            <div className="form-group col-span-2 flex items-center gap-3">
              <input {...register('autoRenewal')} type="checkbox" id="autoRenewal" className="w-4 h-4 rounded text-primary-600" />
              <label htmlFor="autoRenewal" className="label mb-0 cursor-pointer">Renouvellement automatique</label>
            </div>
            <div className="form-group col-span-2">
              <label className="label">Notes</label>
              <textarea {...register('notes')} className="input" rows={2} />
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" className="btn-secondary" onClick={() => { setShowModal(false); setEditingContract(null) }}>
              Annuler
            </button>
            <button type="submit" className="btn-primary" disabled={isSubmitting || createMutation.isPending || updateMutation.isPending}>
              {editingContract ? 'Enregistrer' : 'Créer le contrat'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Delete confirmation */}
      <Modal open={!!deletingContract} onClose={() => setDeletingContract(null)} title="Supprimer le contrat" size="sm">
        <p className="text-slate-600 mb-6">
          Êtes-vous sûr de vouloir supprimer le contrat <strong>{deletingContract?.reference}</strong> — {deletingContract?.title} ?
          Cette action est irréversible.
        </p>
        <div className="flex justify-end gap-3">
          <button className="btn-secondary" onClick={() => setDeletingContract(null)}>Annuler</button>
          <button
            className="btn-primary bg-red-600 hover:bg-red-700 border-red-600"
            disabled={deleteMutation.isPending}
            onClick={() => deletingContract && deleteMutation.mutate(deletingContract.id)}
          >
            Supprimer
          </button>
        </div>
      </Modal>
    </div>
  )
}
