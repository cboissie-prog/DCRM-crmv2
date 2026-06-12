import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { differenceInDays, parseISO } from 'date-fns'
import api from '../../lib/api'
import { formatDate, formatCurrency } from '../../lib/utils'
import { Badge } from '../../components/ui/Badge'
import { PageSpinner } from '../../components/ui/Spinner'
import { Modal } from '../../components/ui/Modal'
import { toast } from '../../components/ui/Toast'
import { Plus, Pencil, Trash2, AlertTriangle, X } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import type { Resolver } from 'react-hook-form'
import type { License, Company, Equipment } from '../../types'
import { useAuthStore } from '../../store/authStore'

const LICENSE_TYPES: Record<string, string> = {
  PERPETUAL: 'Perpétuelle',
  ANNUAL: 'Annuelle',
  MONTHLY: 'Mensuelle',
  SUBSCRIPTION: 'Abonnement',
}

const LICENSE_TYPE_OPTIONS = Object.entries(LICENSE_TYPES).map(([value, label]) => ({ value, label }))

const licenseSchema = z.object({
  companyId: z.string().min(1, 'Entreprise requise'),
  equipmentId: z.string().optional(),
  software: z.string().min(1, 'Logiciel requis'),
  vendor: z.string().optional(),
  licenseKey: z.string().optional(),
  seats: z.coerce.number().min(1, 'Au moins 1 poste'),
  type: z.string().min(1, 'Type requis'),
  purchaseDate: z.string().optional(),
  expiryDate: z.string().optional(),
  cost: z.coerce.number().optional(),
  notes: z.string().optional(),
})
type LicenseForm = z.infer<typeof licenseSchema>

function expiryBadge(date?: string | null) {
  if (!date) return null
  const days = differenceInDays(parseISO(date), new Date())
  if (days < 0) return <Badge variant="badge-red">{formatDate(date)} — Expirée</Badge>
  if (days <= 30) return <Badge variant="badge-orange">{formatDate(date)} — {days}j</Badge>
  return <span className="text-slate-500 text-xs">{formatDate(date)}</span>
}

export function LicensesPage() {
  const qc = useQueryClient()
  const { user } = useAuthStore()
  const canCreate = user?.role === 'ADMIN' || user?.role === 'MANAGER' || user?.role === 'TECHNICIEN'
  const canDelete = user?.role === 'ADMIN' || user?.role === 'MANAGER'
  const [searchParams] = useSearchParams()

  const [expiringOnly, setExpiringOnly] = useState(searchParams.get('expiringSoon') === 'true')
  const [companyFilter, setCompanyFilter] = useState(searchParams.get('companyId') ?? '')
  const [showModal, setShowModal] = useState(false)
  const [editingLicense, setEditingLicense] = useState<License | null>(null)
  const [deletingLicense, setDeletingLicense] = useState<License | null>(null)

  const { data, isLoading } = useQuery<{ data: License[] }>({
    queryKey: ['licenses', { expiringOnly, companyFilter }],
    queryFn: async () => {
      const { data } = await api.get('/licenses', {
        params: {
          expiringSoon: expiringOnly || undefined,
          companyId: companyFilter || undefined,
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

  const { data: equipmentData } = useQuery<{ data: Equipment[] }>({
    queryKey: ['equipment-list'],
    queryFn: async () => {
      const { data } = await api.get('/equipment', { params: { limit: 200 } })
      return data
    },
    staleTime: 60_000,
  })
  const equipments = equipmentData?.data ?? []

  const { register, handleSubmit, reset, setValue, formState: { errors, isSubmitting } } = useForm<LicenseForm>({
    resolver: zodResolver(licenseSchema) as Resolver<LicenseForm>,
    defaultValues: { seats: 1, type: 'ANNUAL' },
  })

  const { data: softwareCatalog } = useQuery<{ data: { id: string; name: string; supplier?: string; price: number; type: string }[] }>({
    queryKey: ['products-software'],
    queryFn: async () => { const { data } = await api.get('/products', { params: { category: 'SOFTWARE', limit: 200 } }); return data },
    staleTime: 120_000,
  })

  const createMutation = useMutation({
    mutationFn: (values: LicenseForm) => api.post('/licenses', values),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['licenses'] })
      setShowModal(false)
      toast.success('Licence ajoutée')
    },
    onError: () => toast.error('Erreur lors de la création'),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, values }: { id: string; values: LicenseForm }) => api.put(`/licenses/${id}`, values),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['licenses'] })
      setShowModal(false)
      setEditingLicense(null)
      toast.success('Licence modifiée')
    },
    onError: () => toast.error('Erreur lors de la modification'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/licenses/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['licenses'] })
      setDeletingLicense(null)
      toast.success('Licence supprimée')
    },
    onError: () => toast.error('Erreur lors de la suppression'),
  })

  const openCreate = () => {
    setEditingLicense(null)
    reset({ seats: 1, type: 'ANNUAL' })
    setShowModal(true)
  }

  const openEdit = (lic: License) => {
    setEditingLicense(lic)
    reset({
      companyId: lic.companyId,
      equipmentId: lic.equipmentId ?? '',
      software: lic.software,
      vendor: lic.vendor ?? '',
      licenseKey: lic.licenseKey ?? '',
      seats: lic.seats,
      type: lic.type,
      purchaseDate: lic.purchaseDate ? lic.purchaseDate.slice(0, 10) : '',
      expiryDate: lic.expiryDate ? lic.expiryDate.slice(0, 10) : '',
      cost: lic.cost ?? undefined,
      notes: lic.notes ?? '',
    })
    setShowModal(true)
  }

  const onSubmit = (values: LicenseForm) => {
    const payload = { ...values, equipmentId: values.equipmentId || undefined }
    if (editingLicense) {
      updateMutation.mutate({ id: editingLicense.id, values: payload })
    } else {
      createMutation.mutate(payload)
    }
  }

  const licenses = data?.data ?? []

  return (
    <div className="space-y-5 fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Licences</h1>
          <p className="page-subtitle">{licenses.length} licence{licenses.length !== 1 ? 's' : ''}</p>
        </div>
        {canCreate && (
          <button className="btn-primary" onClick={openCreate}>
            <Plus className="w-4 h-4" /> Ajouter licence
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap items-center">
        <select
          className="input flex-1 min-w-[160px]"
          value={companyFilter}
          onChange={e => setCompanyFilter(e.target.value)}
        >
          <option value="">Toutes les entreprises</option>
          {companies.map(co => <option key={co.id} value={co.id}>{co.name}</option>)}
        </select>
        <label className="flex items-center gap-2 cursor-pointer select-none text-sm text-slate-600">
          <div
            className={`relative w-10 h-5 rounded-full transition-colors cursor-pointer ${expiringOnly ? 'bg-primary-600' : 'bg-slate-200'}`}
            onClick={() => setExpiringOnly(v => !v)}
          >
            <div className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${expiringOnly ? 'translate-x-5' : ''}`} />
          </div>
          <AlertTriangle className="w-4 h-4 text-orange-500" />
          Expirant bientôt
        </label>
        {(companyFilter || expiringOnly) && (
          <button
            className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800 border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white hover:bg-slate-50 transition-colors"
            onClick={() => { setCompanyFilter(''); setExpiringOnly(false) }}
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
                <th>Entreprise</th>
                <th>Logiciel</th>
                <th>Fournisseur</th>
                <th>Type</th>
                <th>Postes</th>
                <th>Expiration</th>
                <th>Coût annuel</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {!licenses.length ? (
                <tr><td colSpan={8} className="text-center py-12 text-slate-400">Aucune licence trouvée</td></tr>
              ) : licenses.map(lic => (
                <tr key={lic.id}>
                  <td className="text-slate-700">{lic.company?.name ?? '—'}</td>
                  <td className="font-medium text-slate-900">{lic.software}</td>
                  <td className="text-slate-500 text-sm">{lic.vendor ?? '—'}</td>
                  <td>
                    <Badge variant="badge-blue">{LICENSE_TYPES[lic.type] ?? lic.type}</Badge>
                  </td>
                  <td className="text-slate-600 text-sm">{lic.seats}</td>
                  <td>{expiryBadge(lic.expiryDate)}</td>
                  <td className="text-slate-600 text-sm">{formatCurrency(lic.cost)}</td>
                  <td>
                    <div className="flex items-center gap-1">
                      {canCreate && (
                        <button
                          className="btn-ghost btn-sm p-1.5 rounded-lg"
                          onClick={() => openEdit(lic)}
                          title="Modifier"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {canDelete && (
                        <button
                          className="btn-ghost btn-sm p-1.5 rounded-lg text-red-500 hover:text-red-700"
                          onClick={() => setDeletingLicense(lic)}
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

      {/* Create / Edit Modal */}
      <Modal
        open={showModal}
        onClose={() => { setShowModal(false); setEditingLicense(null) }}
        title={editingLicense ? 'Modifier la licence' : 'Ajouter une licence'}
        size="lg"
      >
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {!editingLicense && softwareCatalog && softwareCatalog.data.length > 0 && (
            <div className="bg-violet-50 border border-violet-100 rounded-lg p-3">
              <label className="label text-violet-700">Choisir depuis le catalogue</label>
              <select
                className="input border-violet-200 bg-white"
                defaultValue=""
                onChange={e => {
                  const p = softwareCatalog.data.find(x => x.id === e.target.value)
                  if (!p) return
                  setValue('software', p.name)
                  setValue('vendor', p.supplier ?? '')
                  setValue('cost', p.price)
                  setValue('type', p.type === 'SUBSCRIPTION' ? 'ANNUAL' : 'PERPETUAL')
                }}
              >
                <option value="">— Sélectionner un logiciel —</option>
                {softwareCatalog.data.map(p => (
                  <option key={p.id} value={p.id}>{p.name}{p.supplier ? ` (${p.supplier})` : ''}</option>
                ))}
              </select>
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="form-group sm:col-span-2">
              <label className="label">Entreprise *</label>
              <select {...register('companyId')} className={`input ${errors.companyId ? 'input-error' : ''}`}>
                <option value="">Sélectionner une entreprise</option>
                {companies.map(co => <option key={co.id} value={co.id}>{co.name}</option>)}
              </select>
              {errors.companyId && <p className="form-error">{errors.companyId.message}</p>}
            </div>
            <div className="form-group sm:col-span-2">
              <label className="label">Équipement lié (optionnel)</label>
              <select {...register('equipmentId')} className="input">
                <option value="">Aucun équipement</option>
                {equipments.map(eq => (
                  <option key={eq.id} value={eq.id}>
                    {[eq.brand, eq.model].filter(Boolean).join(' ') || eq.type} — {eq.company?.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label className="label">Logiciel *</label>
              <input {...register('software')} className={`input ${errors.software ? 'input-error' : ''}`} />
              {errors.software && <p className="form-error">{errors.software.message}</p>}
            </div>
            <div className="form-group">
              <label className="label">Fournisseur</label>
              <input {...register('vendor')} className="input" />
            </div>
            <div className="form-group sm:col-span-2">
              <label className="label">Clé de licence</label>
              <input {...register('licenseKey')} className="input font-mono" placeholder="XXXXX-XXXXX-XXXXX" />
            </div>
            <div className="form-group">
              <label className="label">Type *</label>
              <select {...register('type')} className="input">
                {LICENSE_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="label">Nombre de postes *</label>
              <input {...register('seats')} type="number" min={1} className={`input ${errors.seats ? 'input-error' : ''}`} />
              {errors.seats && <p className="form-error">{errors.seats.message}</p>}
            </div>
            <div className="form-group">
              <label className="label">Date d'achat</label>
              <input {...register('purchaseDate')} type="date" className="input" />
            </div>
            <div className="form-group">
              <label className="label">Date d'expiration</label>
              <input {...register('expiryDate')} type="date" className="input" />
            </div>
            <div className="form-group sm:col-span-2">
              <label className="label">Coût annuel (€)</label>
              <input {...register('cost')} type="number" min={0} step={0.01} className="input" />
            </div>
            <div className="form-group sm:col-span-2">
              <label className="label">Notes</label>
              <textarea {...register('notes')} className="input" rows={2} />
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" className="btn-secondary" onClick={() => { setShowModal(false); setEditingLicense(null) }}>
              Annuler
            </button>
            <button type="submit" className="btn-primary" disabled={isSubmitting || createMutation.isPending || updateMutation.isPending}>
              {editingLicense ? 'Enregistrer' : 'Ajouter'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Delete confirmation */}
      <Modal open={!!deletingLicense} onClose={() => setDeletingLicense(null)} title="Supprimer la licence" size="sm">
        <p className="text-slate-600 mb-6">
          Êtes-vous sûr de vouloir supprimer la licence <strong>{deletingLicense?.software}</strong> ?
          Cette action est irréversible.
        </p>
        <div className="flex justify-end gap-3">
          <button className="btn-secondary" onClick={() => setDeletingLicense(null)}>Annuler</button>
          <button
            className="btn-primary bg-red-600 hover:bg-red-700 border-red-600"
            disabled={deleteMutation.isPending}
            onClick={() => deletingLicense && deleteMutation.mutate(deletingLicense.id)}
          >
            Supprimer
          </button>
        </div>
      </Modal>
    </div>
  )
}
