import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { isAfter, parseISO } from 'date-fns'
import api from '../../lib/api'
import { formatDate, EQUIPMENT_TYPES } from '../../lib/utils'
import { Badge } from '../../components/ui/Badge'
import { PageSpinner } from '../../components/ui/Spinner'
import { Modal } from '../../components/ui/Modal'
import { toast } from '../../components/ui/Toast'
import {
  Plus, Pencil, Trash2,
  Monitor, Laptop, Server, Printer, ShoppingCart,
  Network, Router, HardDrive, Tablet, Smartphone, HelpCircle,
} from 'lucide-react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import type { Resolver } from 'react-hook-form'
import type { Equipment, Company, Contract, Product, PaginatedResponse } from '../../types'
import { useAuthStore } from '../../store/authStore'

const EQUIPMENT_STATUSES: Record<string, { label: string; color: string }> = {
  ACTIVE: { label: 'Actif', color: 'badge-green' },
  IN_REPAIR: { label: 'En réparation', color: 'badge-orange' },
  RETIRED: { label: 'Retraité', color: 'badge-gray' },
  LOST: { label: 'Perdu', color: 'badge-red' },
}

const EQUIPMENT_TYPE_OPTIONS = Object.entries(EQUIPMENT_TYPES).map(([value, label]) => ({ value, label }))

const EQUIPMENT_STATUS_OPTIONS = Object.entries(EQUIPMENT_STATUSES).map(([value, { label }]) => ({ value, label }))

// Catégories du catalogue correspondant à du matériel physique inventoriable
// (on exclut les logiciels, modèles de contrat, maintenance, sites web, formations).
const EQUIPMENT_PRODUCT_CATEGORIES = ['HARDWARE', 'NETWORK', 'CASH_REGISTER', 'OTHER']

// Devine le type d'équipement depuis un produit du catalogue (best-effort, modifiable ensuite).
function inferEquipmentType(p: { name: string; category: string }): string {
  if (p.category === 'CASH_REGISTER') return 'CASH_REGISTER'
  const n = p.name.toLowerCase()
  const has = (...kw: string[]) => kw.some(k => n.includes(k))
  if (has('caisse')) return 'CASH_REGISTER'
  if (has('portable', 'laptop')) return 'LAPTOP'
  if (has('serveur', 'server')) return 'SERVER'
  if (has('imprimante', 'printer')) return 'PRINTER'
  if (has('switch', 'commutateur')) return 'SWITCH'
  if (has('routeur', 'router', 'box')) return 'ROUTER'
  if (has('nas')) return 'NAS'
  if (has('écran', 'ecran', 'moniteur', 'screen', 'monitor')) return 'SCREEN'
  if (has('tablette', 'tablet', 'ipad')) return 'TABLET'
  if (has('téléphone', 'telephone', 'smartphone', 'mobile')) return 'PHONE'
  if (has('pc', 'ordinateur', 'desktop', 'bureau', 'unité centrale', 'tour')) return 'DESKTOP'
  return ''
}

function EquipmentTypeIcon({ type }: { type: string }) {
  const cls = 'w-4 h-4 text-slate-400'
  switch (type) {
    case 'DESKTOP': return <Monitor className={cls} />
    case 'LAPTOP': return <Laptop className={cls} />
    case 'SERVER': return <Server className={cls} />
    case 'PRINTER': return <Printer className={cls} />
    case 'CASH_REGISTER': return <ShoppingCart className={cls} />
    case 'SWITCH': return <Network className={cls} />
    case 'ROUTER': return <Router className={cls} />
    case 'NAS': return <HardDrive className={cls} />
    case 'SCREEN': return <Monitor className={cls} />
    case 'TABLET': return <Tablet className={cls} />
    case 'PHONE': return <Smartphone className={cls} />
    default: return <HelpCircle className={cls} />
  }
}

const equipmentSchema = z.object({
  companyId: z.string().min(1, 'Entreprise requise'),
  contractId: z.string().optional(),
  productId: z.string().optional(),
  type: z.string().min(1, 'Type requis'),
  brand: z.string().optional(),
  model: z.string().optional(),
  serialNumber: z.string().optional(),
  purchaseDate: z.string().optional(),
  warrantyExpiry: z.string().optional(),
  location: z.string().optional(),
  status: z.string().min(1, 'Statut requis'),
  notes: z.string().optional(),
})
type EquipmentForm = z.infer<typeof equipmentSchema>

export function EquipmentPage() {
  const qc = useQueryClient()
  const { user } = useAuthStore()
  const canCreate = user?.role === 'ADMIN' || user?.role === 'MANAGER' || user?.role === 'TECHNICIEN'
  const canDelete = user?.role === 'ADMIN' || user?.role === 'MANAGER'

  const [typeFilter, setTypeFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [companyFilter, setCompanyFilter] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [editingEquipment, setEditingEquipment] = useState<Equipment | null>(null)
  const [deletingEquipment, setDeletingEquipment] = useState<Equipment | null>(null)

  const { data, isLoading } = useQuery<PaginatedResponse<Equipment>>({
    queryKey: ['equipment', { typeFilter, statusFilter, companyFilter }],
    queryFn: async () => {
      const { data } = await api.get('/equipment', {
        params: {
          type: typeFilter || undefined,
          status: statusFilter || undefined,
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

  const { data: contractsData } = useQuery<{ data: Contract[] }>({
    queryKey: ['contracts-list'],
    queryFn: async () => {
      const { data } = await api.get('/contracts', { params: { limit: 200 } })
      return data
    },
    staleTime: 60_000,
  })
  const contracts = contractsData?.data ?? []

  const { data: productsData } = useQuery<{ data: Product[] }>({
    queryKey: ['products-equipment-picker'],
    queryFn: async () => {
      const { data } = await api.get('/products', { params: { limit: 200 } })
      return data
    },
    staleTime: 60_000,
  })
  // On ne propose dans le sélecteur que le matériel physique (produits réels, pas services/abonnements)
  const catalogProducts = (productsData?.data ?? []).filter(
    p => p.isActive && p.type === 'PRODUCT' && EQUIPMENT_PRODUCT_CATEGORIES.includes(p.category),
  )

  const { register, handleSubmit, reset, setValue, getValues, formState: { errors, isSubmitting } } = useForm<EquipmentForm>({
    resolver: zodResolver(equipmentSchema) as Resolver<EquipmentForm>,
    defaultValues: { status: 'ACTIVE' },
  })

  const productReg = register('productId')

  // Pré-remplit marque/modèle/type/notes à partir du produit choisi (tout reste modifiable).
  const handlePickProduct = (productId: string) => {
    if (!productId) return
    const p = catalogProducts.find(x => x.id === productId)
    if (!p) return
    setValue('model', p.name)
    if (p.supplier) setValue('brand', p.supplier)
    const inferred = inferEquipmentType(p)
    if (inferred) setValue('type', inferred)
    if (p.reference && !getValues('notes')) setValue('notes', `Réf. catalogue : ${p.reference}`)
  }

  const createMutation = useMutation({
    mutationFn: (values: EquipmentForm) => api.post('/equipment', values),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['equipment'] })
      setShowModal(false)
      toast.success('Équipement ajouté')
    },
    onError: () => toast.error('Erreur lors de la création'),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, values }: { id: string; values: EquipmentForm }) => api.put(`/equipment/${id}`, values),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['equipment'] })
      setShowModal(false)
      setEditingEquipment(null)
      toast.success('Équipement modifié')
    },
    onError: () => toast.error('Erreur lors de la modification'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/equipment/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['equipment'] })
      setDeletingEquipment(null)
      toast.success('Équipement supprimé')
    },
    onError: () => toast.error('Erreur lors de la suppression'),
  })

  const openCreate = () => {
    setEditingEquipment(null)
    reset({ status: 'ACTIVE', productId: '' })
    setShowModal(true)
  }

  const openEdit = (eq: Equipment) => {
    setEditingEquipment(eq)
    reset({
      companyId: eq.companyId,
      contractId: eq.contractId ?? '',
      productId: eq.productId ?? '',
      type: eq.type,
      brand: eq.brand ?? '',
      model: eq.model ?? '',
      serialNumber: eq.serialNumber ?? '',
      purchaseDate: eq.purchaseDate ? eq.purchaseDate.slice(0, 10) : '',
      warrantyExpiry: eq.warrantyExpiry ? eq.warrantyExpiry.slice(0, 10) : '',
      location: eq.location ?? '',
      status: eq.status,
      notes: eq.notes ?? '',
    })
    setShowModal(true)
  }

  const onSubmit = (values: EquipmentForm) => {
    // Les FK optionnelles vides ('') sont normalisées en NULL côté serveur, ce qui permet
    // aussi de retirer un lien existant lors d'une modification.
    if (editingEquipment) {
      updateMutation.mutate({ id: editingEquipment.id, values })
    } else {
      createMutation.mutate(values)
    }
  }

  const isWarrantyExpired = (date?: string | null) => {
    if (!date) return false
    return isAfter(new Date(), parseISO(date))
  }

  return (
    <div className="space-y-5 fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Parc informatique</h1>
          <p className="page-subtitle">{data?.meta?.total ?? data?.data?.length ?? 0} équipements</p>
        </div>
        {canCreate && (
          <button className="btn-primary" onClick={openCreate}>
            <Plus className="w-4 h-4" /> Ajouter équipement
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
        <select
          className="input flex-1 min-w-[140px]"
          value={typeFilter}
          onChange={e => setTypeFilter(e.target.value)}
        >
          <option value="">Tous les types</option>
          {EQUIPMENT_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select
          className="input flex-1 min-w-[140px]"
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
        >
          <option value="">Tous les statuts</option>
          {EQUIPMENT_STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>

      {/* Table */}
      {isLoading ? <PageSpinner /> : (
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Entreprise</th>
                <th>Type</th>
                <th>Marque / Modèle</th>
                <th>N° série</th>
                <th>Date achat</th>
                <th>Garantie</th>
                <th>Statut</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {!data?.data?.length ? (
                <tr><td colSpan={8} className="text-center py-12 text-slate-400">Aucun équipement trouvé</td></tr>
              ) : data.data.map(eq => (
                <tr key={eq.id}>
                  <td className="text-slate-700">{eq.company?.name ?? '—'}</td>
                  <td>
                    <div className="flex items-center gap-2 text-slate-600">
                      <EquipmentTypeIcon type={eq.type} />
                      <span className="text-xs">{EQUIPMENT_TYPES[eq.type] ?? eq.type}</span>
                    </div>
                  </td>
                  <td className="font-medium text-slate-900">
                    {[eq.brand, eq.model].filter(Boolean).join(' ') || '—'}
                  </td>
                  <td className="font-mono text-xs text-slate-500">{eq.serialNumber ?? '—'}</td>
                  <td className="text-slate-400 text-xs">{formatDate(eq.purchaseDate)}</td>
                  <td>
                    {eq.warrantyExpiry ? (
                      <Badge variant={isWarrantyExpired(eq.warrantyExpiry) ? 'badge-red' : 'badge-green'}>
                        {formatDate(eq.warrantyExpiry)}
                      </Badge>
                    ) : <span className="text-slate-300">—</span>}
                  </td>
                  <td>
                    <Badge variant={EQUIPMENT_STATUSES[eq.status]?.color ?? 'badge-gray'}>
                      {EQUIPMENT_STATUSES[eq.status]?.label ?? eq.status}
                    </Badge>
                  </td>
                  <td>
                    <div className="flex items-center gap-1">
                      {canCreate && (
                        <button
                          className="btn-ghost btn-sm p-1.5 rounded-lg"
                          onClick={() => openEdit(eq)}
                          title="Modifier"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {canDelete && (
                        <button
                          className="btn-ghost btn-sm p-1.5 rounded-lg text-red-500 hover:text-red-700"
                          onClick={() => setDeletingEquipment(eq)}
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
        onClose={() => { setShowModal(false); setEditingEquipment(null) }}
        title={editingEquipment ? 'Modifier l\'équipement' : 'Ajouter un équipement'}
        size="lg"
      >
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {catalogProducts.length > 0 && (
              <div className="form-group sm:col-span-2">
                <label className="label">Pré-remplir depuis le catalogue (optionnel)</label>
                <select
                  {...productReg}
                  onChange={e => { productReg.onChange(e); handlePickProduct(e.target.value) }}
                  className="input"
                >
                  <option value="">— Aucun produit —</option>
                  {catalogProducts.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name}{p.reference ? ` (${p.reference})` : ''}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-slate-400 mt-1">
                  Remplit automatiquement la marque, le modèle et le type. Vous pouvez tout ajuster ensuite.
                </p>
              </div>
            )}
            <div className="form-group sm:col-span-2">
              <label className="label">Entreprise *</label>
              <select {...register('companyId')} className={`input ${errors.companyId ? 'input-error' : ''}`}>
                <option value="">Sélectionner une entreprise</option>
                {companies.map(co => <option key={co.id} value={co.id}>{co.name}</option>)}
              </select>
              {errors.companyId && <p className="form-error">{errors.companyId.message}</p>}
            </div>
            <div className="form-group sm:col-span-2">
              <label className="label">Contrat lié (optionnel)</label>
              <select {...register('contractId')} className="input">
                <option value="">Aucun contrat</option>
                {contracts.map(c => <option key={c.id} value={c.id}>{c.reference} — {c.title}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="label">Type *</label>
              <select {...register('type')} className={`input ${errors.type ? 'input-error' : ''}`}>
                <option value="">Sélectionner un type</option>
                {EQUIPMENT_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              {errors.type && <p className="form-error">{errors.type.message}</p>}
            </div>
            <div className="form-group">
              <label className="label">Statut *</label>
              <select {...register('status')} className="input">
                {EQUIPMENT_STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="label">Marque</label>
              <input {...register('brand')} className="input" />
            </div>
            <div className="form-group">
              <label className="label">Modèle</label>
              <input {...register('model')} className="input" />
            </div>
            <div className="form-group">
              <label className="label">Numéro de série</label>
              <input {...register('serialNumber')} className="input" />
            </div>
            <div className="form-group">
              <label className="label">Emplacement</label>
              <input {...register('location')} className="input" />
            </div>
            <div className="form-group">
              <label className="label">Date d'achat</label>
              <input {...register('purchaseDate')} type="date" className="input" />
            </div>
            <div className="form-group">
              <label className="label">Expiration garantie</label>
              <input {...register('warrantyExpiry')} type="date" className="input" />
            </div>
            <div className="form-group sm:col-span-2">
              <label className="label">Notes</label>
              <textarea {...register('notes')} className="input" rows={2} />
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" className="btn-secondary" onClick={() => { setShowModal(false); setEditingEquipment(null) }}>
              Annuler
            </button>
            <button type="submit" className="btn-primary" disabled={isSubmitting || createMutation.isPending || updateMutation.isPending}>
              {editingEquipment ? 'Enregistrer' : 'Ajouter'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Delete confirmation */}
      <Modal open={!!deletingEquipment} onClose={() => setDeletingEquipment(null)} title="Supprimer l'équipement" size="sm">
        <p className="text-slate-600 mb-6">
          Êtes-vous sûr de vouloir supprimer l'équipement{' '}
          <strong>{[deletingEquipment?.brand, deletingEquipment?.model].filter(Boolean).join(' ') || EQUIPMENT_TYPES[deletingEquipment?.type ?? ''] || 'cet équipement'}</strong> ?
          Cette action est irréversible.
        </p>
        <div className="flex justify-end gap-3">
          <button className="btn-secondary" onClick={() => setDeletingEquipment(null)}>Annuler</button>
          <button
            className="btn-primary bg-red-600 hover:bg-red-700 border-red-600"
            disabled={deleteMutation.isPending}
            onClick={() => deletingEquipment && deleteMutation.mutate(deletingEquipment.id)}
          >
            Supprimer
          </button>
        </div>
      </Modal>
    </div>
  )
}
