import { useState, type ReactNode } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import type { Resolver } from 'react-hook-form'
import api from '../../lib/api'
import { formatDate } from '../../lib/utils'
import { Badge } from '../../components/ui/Badge'
import { PageSpinner } from '../../components/ui/Spinner'
import { Modal } from '../../components/ui/Modal'
import { toast } from '../../components/ui/Toast'
import { useAuthStore } from '../../store/authStore'
import { Plus, Search, Pencil, Trash2, Package, Tag, Key, FileText, Monitor, Wrench, Globe, GraduationCap } from 'lucide-react'
import { CONTRACT_TYPES } from '../../lib/utils'

// ── Types ──────────────────────────────────────────────────────────────────────

interface Product {
  id: string
  reference?: string
  name: string
  description?: string
  category: string
  type: string
  price: number
  vatRate: number
  unit: string
  stock?: number
  supplier?: string
  isActive: boolean
  createdAt: string
}

// ── Constants ──────────────────────────────────────────────────────────────────

const CATEGORIES: Record<string, { label: string; color: string; icon: ReactNode }> = {
  HARDWARE:          { label: 'Matériel',           color: 'badge-blue',   icon: <Monitor className="w-4 h-4" /> },
  SOFTWARE:          { label: 'Logiciel / Licence',  color: 'badge-purple', icon: <Key className="w-4 h-4" /> },
  CONTRACT_TEMPLATE: { label: 'Modèle de contrat',   color: 'badge-indigo', icon: <FileText className="w-4 h-4" /> },
  NETWORK:           { label: 'Réseau',              color: 'badge-cyan',   icon: <Globe className="w-4 h-4" /> },
  CASH_REGISTER:     { label: 'Caisse',              color: 'badge-orange', icon: <Package className="w-4 h-4" /> },
  MAINTENANCE:       { label: 'Maintenance',         color: 'badge-yellow', icon: <Wrench className="w-4 h-4" /> },
  WEBSITE:           { label: 'Site web',            color: 'badge-indigo', icon: <Globe className="w-4 h-4" /> },
  TRAINING:          { label: 'Formation',           color: 'badge-green',  icon: <GraduationCap className="w-4 h-4" /> },
  OTHER:             { label: 'Autre',               color: 'badge-gray',   icon: <Package className="w-4 h-4" /> },
}

// Tab groups for the filter bar
const CATEGORY_TABS = [
  { key: '',                  label: 'Tout' },
  { key: 'HARDWARE',          label: 'Matériel' },
  { key: 'SOFTWARE',          label: 'Logiciels & Licences' },
  { key: 'CONTRACT_TEMPLATE', label: 'Modèles de contrat' },
  { key: 'NETWORK',           label: 'Réseau' },
  { key: 'MAINTENANCE',       label: 'Maintenance' },
  { key: 'OTHER_MISC',        label: 'Autres', keys: ['CASH_REGISTER', 'WEBSITE', 'TRAINING', 'OTHER'] },
]

const TYPES: Record<string, { label: string; color: string }> = {
  PRODUCT: { label: 'Produit', color: 'badge-blue' },
  SERVICE: { label: 'Service', color: 'badge-green' },
  SUBSCRIPTION: { label: 'Abonnement', color: 'badge-purple' },
}

// ── Zod schema ─────────────────────────────────────────────────────────────────

const productSchema = z.object({
  reference: z.string().optional(),
  name: z.string().min(1, 'Nom requis'),
  description: z.string().optional(),
  category: z.string().min(1, 'Catégorie requise'),
  type: z.string().min(1, 'Type requis'),
  price: z.coerce.number().min(0, 'Prix invalide'),
  vatRate: z.coerce.number().min(0).max(100).optional(),
  unit: z.string().optional(),
  stock: z.coerce.number().int().min(0).optional().or(z.literal('')),
  supplier: z.string().optional(),
  isActive: z.boolean().optional(),
})
type ProductForm = z.infer<typeof productSchema>

// ── Main page ──────────────────────────────────────────────────────────────────

export function ProductsPage() {
  const qc = useQueryClient()
  const user = useAuthStore(s => s.user)
  const canEdit = ['ADMIN', 'MANAGER'].includes(user?.role ?? '')

  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [page, setPage] = useState(1)
  const [showCreate, setShowCreate] = useState(false)
  const [editingProduct, setEditingProduct] = useState<Product | null>(null)
  const [deletingProduct, setDeletingProduct] = useState<Product | null>(null)

  const { data, isLoading } = useQuery<{ success: boolean; data: Product[]; meta: { total: number } }>({
    queryKey: ['products', { search, categoryFilter, typeFilter, page }],
    queryFn: async () => {
      const { data } = await api.get('/products', {
        params: {
          search: search || undefined,
          category: categoryFilter || undefined,
          type: typeFilter || undefined,
          page,
          limit: 50,
        },
      })
      return data
    },
    staleTime: 30_000,
  })

  // ── Mutations ────────────────────────────────────────────────────────────────

  const createMutation = useMutation({
    mutationFn: (values: ProductForm) => api.post('/products', values),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['products'] }); setShowCreate(false); toast.success('Produit créé') },
    onError: () => toast.error('Erreur lors de la création'),
  })

  const editMutation = useMutation({
    mutationFn: ({ id, values }: { id: string; values: ProductForm }) => api.put(`/products/${id}`, values),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['products'] }); setEditingProduct(null); toast.success('Produit modifié') },
    onError: () => toast.error('Erreur lors de la modification'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/products/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['products'] }); setDeletingProduct(null); toast.success('Produit désactivé') },
    onError: () => toast.error('Erreur lors de la suppression'),
  })

  // ── Forms ────────────────────────────────────────────────────────────────────

  const createForm = useForm<ProductForm>({
    resolver: zodResolver(productSchema) as Resolver<ProductForm>,
    defaultValues: { type: 'PRODUCT', category: 'HARDWARE', vatRate: 20, unit: 'unité', isActive: true },
  })
  const editForm = useForm<ProductForm>({
    resolver: zodResolver(productSchema) as Resolver<ProductForm>,
  })

  const openEdit = (p: Product) => {
    editForm.reset({
      reference: p.reference ?? '',
      name: p.name,
      description: p.description ?? '',
      category: p.category,
      type: p.type,
      price: p.price,
      vatRate: p.vatRate,
      unit: p.unit,
      stock: p.stock ?? undefined,
      supplier: p.supplier ?? '',
      isActive: p.isActive,
    })
    setEditingProduct(p)
  }

  const products = data?.data ?? []
  const total = data?.meta.total ?? 0

  return (
    <div className="space-y-5 fade-in">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Catalogue produits</h1>
          <p className="page-subtitle">{total} produit{total !== 1 ? 's' : ''}</p>
        </div>
        {canEdit && (
          <button className="btn-primary" onClick={() => { createForm.reset({ type: 'PRODUCT', category: 'HARDWARE', vatRate: 20, unit: 'unité', isActive: true }); setShowCreate(true) }}>
            <Plus className="w-4 h-4" /> Nouveau produit
          </button>
        )}
      </div>

      {/* Category tabs */}
      <div className="bg-slate-100 rounded-xl p-1 flex gap-1 flex-wrap">
        {CATEGORY_TABS.map(tab => {
          const tabActive = tab.key === 'OTHER_MISC'
            ? ['CASH_REGISTER', 'WEBSITE', 'TRAINING', 'OTHER'].includes(categoryFilter)
            : categoryFilter === tab.key
          return (
            <button
              key={tab.key}
              onClick={() => { setCategoryFilter(tab.key === 'OTHER_MISC' ? 'OTHER' : tab.key); setPage(1) }}
              className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                tabActive ? 'bg-white text-primary-700 shadow-sm border border-slate-200' : 'text-slate-500 hover:text-slate-800 hover:bg-white/60'
              }`}
            >
              {tab.label}
            </button>
          )
        })}
      </div>

      {/* Search + type filter */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input className="input pl-9" placeholder="Rechercher..." value={search} onChange={e => { setSearch(e.target.value); setPage(1) }} />
        </div>
        <select className="input w-auto" value={typeFilter} onChange={e => { setTypeFilter(e.target.value); setPage(1) }}>
          <option value="">Tous les types</option>
          {Object.entries(TYPES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
      </div>

      {/* Products grid */}
      {isLoading ? <PageSpinner /> : products.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <Package className="w-12 h-12 mx-auto mb-3 text-slate-300" />
          <p className="text-sm font-medium">Aucun produit trouvé</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {products.map(p => (
            <div key={p.id} className={`bg-white border rounded-xl p-4 shadow-sm hover:shadow-md transition-all ${!p.isActive ? 'opacity-60' : 'border-slate-200'}`}>
              {/* Icon + badges */}
              <div className="flex items-start justify-between mb-3">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                  p.category === 'SOFTWARE' ? 'bg-violet-50 text-violet-500' :
                  p.category === 'CONTRACT_TEMPLATE' ? 'bg-indigo-50 text-indigo-500' :
                  p.category === 'HARDWARE' ? 'bg-blue-50 text-blue-500' :
                  'bg-slate-100 text-slate-500'
                }`}>
                  {CATEGORIES[p.category]?.icon ?? <Package className="w-5 h-5" />}
                </div>
                <div className="flex flex-col items-end gap-1">
                  <Badge variant={CATEGORIES[p.category]?.color ?? 'badge-gray'}>{CATEGORIES[p.category]?.label ?? p.category}</Badge>
                  {!p.isActive && <Badge variant="badge-gray">Inactif</Badge>}
                </div>
              </div>

              {/* Name & ref */}
              <p className="text-sm font-semibold text-slate-900 leading-tight">{p.name}</p>
              {p.reference && <p className="text-xs text-slate-400 mt-0.5">Réf. {p.reference}</p>}
              {p.description && <p className="text-xs text-slate-500 mt-1 line-clamp-2">{p.description}</p>}

              {/* Price */}
              <div className="mt-3 flex items-end justify-between">
                <div>
                  {p.category === 'CONTRACT_TEMPLATE' ? (
                    <>
                      <p className="text-lg font-bold text-slate-900">{p.price.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} €<span className="text-xs font-normal text-slate-400">/mois</span></p>
                      <p className="text-xs text-slate-400">TVA {p.vatRate}%</p>
                    </>
                  ) : (
                    <>
                      <p className="text-lg font-bold text-slate-900">{p.price.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} €</p>
                      <p className="text-xs text-slate-400">HT / {p.unit} · TVA {p.vatRate}%</p>
                    </>
                  )}
                </div>
                {p.stock !== undefined && p.stock !== null && (
                  <div className={`text-right text-xs font-medium ${p.stock === 0 ? 'text-red-500' : p.stock < 5 ? 'text-amber-500' : 'text-emerald-600'}`}>
                    Stock : {p.stock}
                  </div>
                )}
              </div>

              {/* Supplier / contract type */}
              {p.supplier && (
                <p className="mt-2 text-xs text-slate-400 flex items-center gap-1">
                  <Tag className="w-3 h-3" />
                  {p.category === 'CONTRACT_TEMPLATE'
                    ? (CONTRACT_TYPES[p.supplier as keyof typeof CONTRACT_TYPES] ?? p.supplier)
                    : p.supplier}
                </p>
              )}

              {/* Actions */}
              {canEdit && (
                <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between">
                  <p className="text-xs text-slate-400">{formatDate(p.createdAt)}</p>
                  <div className="flex items-center gap-1">
                    <button
                      className="btn-ghost btn-sm p-1.5 rounded-lg text-slate-400 hover:text-primary-600"
                      title="Modifier"
                      onClick={() => openEdit(p)}
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      className="btn-ghost btn-sm p-1.5 rounded-lg text-slate-400 hover:text-red-500"
                      title="Désactiver"
                      onClick={() => setDeletingProduct(p)}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {total > 50 && (
        <div className="flex items-center justify-between text-sm text-slate-500">
          <span>{(page - 1) * 50 + 1} – {Math.min(page * 50, total)} sur {total}</span>
          <div className="flex gap-2">
            <button className="btn-secondary btn-sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Précédent</button>
            <button className="btn-secondary btn-sm" disabled={page * 50 >= total} onClick={() => setPage(p => p + 1)}>Suivant</button>
          </div>
        </div>
      )}

      {/* ── Create Modal ── */}
      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Nouveau produit" size="lg">
        <ProductFormFields
          form={createForm}
          onSubmit={v => createMutation.mutate(v)}
          isPending={createMutation.isPending}
          onCancel={() => setShowCreate(false)}
          submitLabel="Créer le produit"
        />
      </Modal>

      {/* ── Edit Modal ── */}
      <Modal open={!!editingProduct} onClose={() => setEditingProduct(null)} title="Modifier le produit" size="lg">
        <ProductFormFields
          form={editForm}
          onSubmit={v => editingProduct && editMutation.mutate({ id: editingProduct.id, values: v })}
          isPending={editMutation.isPending}
          onCancel={() => setEditingProduct(null)}
          submitLabel="Enregistrer"
        />
      </Modal>

      {/* ── Delete Confirm Modal ── */}
      <Modal open={!!deletingProduct} onClose={() => setDeletingProduct(null)} title="Désactiver le produit" size="sm">
        <div className="space-y-4">
          <p className="text-slate-600">
            Êtes-vous sûr de vouloir désactiver <strong>{deletingProduct?.name}</strong> ? Le produit sera masqué du catalogue mais conservé en base.
          </p>
          <div className="flex justify-end gap-3">
            <button className="btn-secondary" onClick={() => setDeletingProduct(null)}>Annuler</button>
            <button
              className="px-4 py-2 rounded-lg text-sm font-medium bg-red-600 text-white hover:bg-red-700 transition-colors"
              onClick={() => deletingProduct && deleteMutation.mutate(deletingProduct.id)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? 'Désactivation...' : 'Désactiver'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

// ── Form fields ────────────────────────────────────────────────────────────────

function ProductFormFields({
  form,
  onSubmit,
  isPending,
  onCancel,
  submitLabel,
}: {
  form: ReturnType<typeof useForm<ProductForm>>
  onSubmit: (v: ProductForm) => void
  isPending: boolean
  onCancel: () => void
  submitLabel: string
}) {
  const { register, handleSubmit, watch, formState: { errors, isSubmitting } } = form
  const watchedCategory = watch('category')
  const isContractTemplate = watchedCategory === 'CONTRACT_TEMPLATE'
  const isSoftware = watchedCategory === 'SOFTWARE'

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="form-group">
          <label className="label">{isContractTemplate ? 'Nom du modèle *' : 'Nom *'}</label>
          <input {...register('name')} className={`input ${errors.name ? 'input-error' : ''}`} placeholder={isContractTemplate ? 'Ex: Maintenance informatique standard' : isSoftware ? 'Ex: Microsoft Office 365' : ''} />
          {errors.name && <p className="form-error">{errors.name.message}</p>}
        </div>
        <div className="form-group">
          <label className="label">Référence</label>
          <input {...register('reference')} className="input" placeholder="REF-001" />
        </div>
      </div>

      <div className="form-group">
        <label className="label">Description</label>
        <textarea {...register('description')} className="input" rows={2} placeholder={isContractTemplate ? 'Détails des prestations incluses...' : ''} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="form-group">
          <label className="label">Catégorie *</label>
          <select {...register('category')} className={`input ${errors.category ? 'input-error' : ''}`}>
            {Object.entries(CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </div>
        {!isContractTemplate && (
          <div className="form-group">
            <label className="label">Type *</label>
            <select {...register('type')} className={`input ${errors.type ? 'input-error' : ''}`}>
              {Object.entries(TYPES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>
        )}
      </div>

      <div className={`grid gap-4 ${isContractTemplate ? 'grid-cols-2' : 'grid-cols-3'}`}>
        <div className="form-group">
          <label className="label">{isContractTemplate ? 'Montant mensuel HT (€) *' : 'Prix HT (€) *'}</label>
          <input {...register('price')} type="number" step="0.01" min="0" className={`input ${errors.price ? 'input-error' : ''}`} />
          {errors.price && <p className="form-error">{errors.price.message}</p>}
        </div>
        <div className="form-group">
          <label className="label">TVA (%)</label>
          <input {...register('vatRate')} type="number" step="0.1" min="0" max="100" className="input" />
        </div>
        {!isContractTemplate && (
          <div className="form-group">
            <label className="label">Unité</label>
            <input {...register('unit')} className="input" placeholder="unité" />
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        {!isContractTemplate && (
          <div className="form-group">
            <label className="label">Stock</label>
            <input {...register('stock')} type="number" min="0" className="input" placeholder="Laisser vide si non suivi" />
          </div>
        )}
        <div className={`form-group ${isContractTemplate ? 'col-span-2' : ''}`}>
          <label className="label">
            {isContractTemplate ? 'Type de contrat' : isSoftware ? 'Éditeur / Fournisseur' : 'Fournisseur'}
          </label>
          {isContractTemplate ? (
            <select {...register('supplier')} className="input">
              <option value="">— Sélectionner —</option>
              {Object.entries(CONTRACT_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          ) : (
            <input {...register('supplier')} className="input" placeholder={isSoftware ? 'Microsoft, Adobe, Bitdefender...' : ''} />
          )}
        </div>
      </div>

      <div className="flex justify-end gap-3 pt-2">
        <button type="button" className="btn-secondary" onClick={onCancel}>Annuler</button>
        <button type="submit" className="btn-primary" disabled={isSubmitting || isPending}>{submitLabel}</button>
      </div>
    </form>
  )
}
