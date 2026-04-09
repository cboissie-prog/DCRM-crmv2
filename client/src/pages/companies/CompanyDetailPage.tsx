import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import type { Resolver } from 'react-hook-form'
import api from '../../lib/api'
import {
  formatDate, formatCurrency,
  PIPELINE_STAGES, TICKET_STATUSES, TICKET_PRIORITIES,
  CONTRACT_STATUSES, CONTRACT_TYPES, EQUIPMENT_TYPES,
} from '../../lib/utils'
import { Badge } from '../../components/ui/Badge'
import { PageSpinner } from '../../components/ui/Spinner'
import { Modal } from '../../components/ui/Modal'
import { toast } from '../../components/ui/Toast'
import { useAuthStore } from '../../store/authStore'
import {
  ArrowLeft, Pencil, Trash2, Building2, Globe, MapPin,
  Users, FileText, TrendingUp, Wrench, Monitor,
} from 'lucide-react'

// ── Schema ────────────────────────────────────────────────────────────────────

const companySchema = z.object({
  name: z.string().min(1, 'Nom requis'),
  siret: z.string().optional(),
  vatNumber: z.string().optional(),
  website: z.string().optional(),
  sector: z.string().optional(),
  employees: z.coerce.number().int().optional().or(z.literal('')),
  annualRevenue: z.coerce.number().optional().or(z.literal('')),
  billingAddress: z.string().optional(),
  deliveryAddress: z.string().optional(),
  city: z.string().optional(),
  postalCode: z.string().optional(),
  country: z.string().optional(),
  notes: z.string().optional(),
  tags: z.string().optional(),
})
type CompanyForm = z.infer<typeof companySchema>

const SECTORS = [
  'Commerce alimentaire', 'Pharmacie', 'Restauration', 'Santé',
  'Commerce habillement', 'Informatique', 'Immobilier', 'Automobile',
  'Industrie', 'Services', 'Autre',
]

type Tab = 'info' | 'contacts' | 'opportunities' | 'tickets' | 'contracts' | 'equipments'

// ── Component ─────────────────────────────────────────────────────────────────

export function CompanyDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const user = useAuthStore(s => s.user)
  const canEdit = ['ADMIN', 'MANAGER'].includes(user?.role ?? '')

  const [tab, setTab] = useState<Tab>('info')
  const [showEdit, setShowEdit] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  // ── Query ──────────────────────────────────────────────────────────────────

  const { data: company, isLoading } = useQuery({
    queryKey: ['company', id],
    queryFn: async () => {
      const { data } = await api.get(`/companies/${id}`)
      return data.data
    },
    enabled: !!id,
  })

  // ── Mutations ──────────────────────────────────────────────────────────────

  const editMutation = useMutation({
    mutationFn: (values: CompanyForm) => api.put(`/companies/${id}`, values),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['company', id] })
      qc.invalidateQueries({ queryKey: ['companies'] })
      setShowEdit(false)
      toast.success('Entreprise modifiée')
    },
    onError: () => toast.error('Erreur lors de la modification'),
  })

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/companies/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['companies'] })
      toast.success('Entreprise supprimée')
      navigate('/companies')
    },
    onError: () => toast.error('Erreur lors de la suppression'),
  })

  // ── Form ───────────────────────────────────────────────────────────────────

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<CompanyForm>({
    resolver: zodResolver(companySchema) as Resolver<CompanyForm>,
  })

  const openEdit = () => {
    if (!company) return
    reset({
      name: company.name ?? '',
      siret: company.siret ?? '',
      vatNumber: company.vatNumber ?? '',
      website: company.website ?? '',
      sector: company.sector ?? '',
      employees: company.employees ?? '',
      annualRevenue: company.annualRevenue ?? '',
      billingAddress: company.billingAddress ?? '',
      deliveryAddress: company.deliveryAddress ?? '',
      city: company.city ?? '',
      postalCode: company.postalCode ?? '',
      country: company.country ?? '',
      notes: company.notes ?? '',
      tags: company.tags ?? '',
    })
    setShowEdit(true)
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  if (isLoading) return <PageSpinner />
  if (!company) return <div className="p-8 text-center text-slate-500">Entreprise introuvable</div>

  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: 'info', label: 'Informations' },
    { key: 'contacts', label: 'Contacts', count: company.contacts?.length },
    { key: 'opportunities', label: 'Opportunités', count: company.opportunities?.length },
    { key: 'tickets', label: 'Tickets', count: company.tickets?.length },
    { key: 'contracts', label: 'Contrats', count: company.contracts?.length },
    { key: 'equipments', label: 'Équipements', count: company.equipments?.length },
  ]

  return (
    <div className="space-y-5 fade-in">
      {/* Header */}
      <div className="flex items-start gap-3">
        <button onClick={() => navigate('/companies')} className="btn-ghost btn-sm p-2 rounded-lg mt-1">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="page-title">{company.name}</h1>
            {company.sector && (
              <Badge variant="badge-blue">{company.sector}</Badge>
            )}
            <Badge variant={company.isActive ? 'badge-green' : 'badge-gray'}>
              {company.isActive ? 'Actif' : 'Inactif'}
            </Badge>
          </div>
          {company.city && (
            <p className="page-subtitle flex items-center gap-1">
              <MapPin className="w-3.5 h-3.5" /> {company.city}
              {company.postalCode && ` (${company.postalCode})`}
            </p>
          )}
        </div>
        {canEdit && (
          <div className="flex gap-2">
            <button className="btn-secondary btn-sm flex items-center gap-1.5" onClick={openEdit}>
              <Pencil className="w-3.5 h-3.5" /> Modifier
            </button>
            <button
              className="btn-sm flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-red-600 hover:bg-red-50 border border-red-200 transition-colors"
              onClick={() => setShowDeleteConfirm(true)}
            >
              <Trash2 className="w-3.5 h-3.5" /> Supprimer
            </button>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="border-b border-slate-200">
        <nav className="flex gap-1 -mb-px">
          {tabs.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                tab === t.key
                  ? 'border-primary-600 text-primary-700'
                  : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
              }`}
            >
              {t.label}
              {t.count !== undefined && t.count > 0 && (
                <span className="ml-1.5 px-1.5 py-0.5 text-xs rounded-full bg-slate-100 text-slate-600">{t.count}</span>
              )}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab content */}
      {tab === 'info' && <TabInfo company={company} />}
      {tab === 'contacts' && <TabContacts contacts={company.contacts ?? []} onNavigate={navigate} />}
      {tab === 'opportunities' && <TabOpportunities opportunities={company.opportunities ?? []} />}
      {tab === 'tickets' && <TabTickets tickets={company.tickets ?? []} onNavigate={navigate} />}
      {tab === 'contracts' && <TabContracts contracts={company.contracts ?? []} />}
      {tab === 'equipments' && <TabEquipments equipments={company.equipments ?? []} />}

      {/* Edit Modal */}
      <Modal open={showEdit} onClose={() => setShowEdit(false)} title="Modifier l'entreprise" size="lg">
        <form onSubmit={handleSubmit(v => editMutation.mutate(v))} className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
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
              <label className="label">N° TVA</label>
              <input {...register('vatNumber')} className="input" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="form-group">
              <label className="label">Site web</label>
              <input {...register('website')} className="input" placeholder="https://" />
            </div>
            <div className="form-group">
              <label className="label">Secteur</label>
              <select {...register('sector')} className="input">
                <option value="">Choisir...</option>
                {SECTORS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="form-group">
              <label className="label">Nb. employés</label>
              <input {...register('employees')} type="number" className="input" />
            </div>
            <div className="form-group">
              <label className="label">CA annuel (€)</label>
              <input {...register('annualRevenue')} type="number" className="input" />
            </div>
          </div>
          <div className="form-group">
            <label className="label">Adresse de facturation</label>
            <input {...register('billingAddress')} className="input" />
          </div>
          <div className="form-group">
            <label className="label">Adresse de livraison</label>
            <input {...register('deliveryAddress')} className="input" />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="form-group col-span-1">
              <label className="label">Ville</label>
              <input {...register('city')} className="input" />
            </div>
            <div className="form-group col-span-1">
              <label className="label">Code postal</label>
              <input {...register('postalCode')} className="input" />
            </div>
            <div className="form-group col-span-1">
              <label className="label">Pays</label>
              <input {...register('country')} className="input" />
            </div>
          </div>
          <div className="form-group">
            <label className="label">Tags</label>
            <input {...register('tags')} className="input" placeholder="tag1, tag2..." />
          </div>
          <div className="form-group">
            <label className="label">Notes</label>
            <textarea {...register('notes')} className="input" rows={3} />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" className="btn-secondary" onClick={() => setShowEdit(false)}>Annuler</button>
            <button type="submit" className="btn-primary" disabled={isSubmitting || editMutation.isPending}>
              {editMutation.isPending ? 'Enregistrement...' : 'Enregistrer'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Delete confirm Modal */}
      <Modal open={showDeleteConfirm} onClose={() => setShowDeleteConfirm(false)} title="Supprimer l'entreprise" size="sm">
        <div className="space-y-4">
          <p className="text-slate-600">
            Êtes-vous sûr de vouloir supprimer <strong>{company.name}</strong> ? Cette action est irréversible.
          </p>
          <div className="flex justify-end gap-3">
            <button className="btn-secondary" onClick={() => setShowDeleteConfirm(false)}>Annuler</button>
            <button
              className="px-4 py-2 rounded-lg text-sm font-medium bg-red-600 text-white hover:bg-red-700 transition-colors"
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? 'Suppression...' : 'Supprimer'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

// ── Tab: Informations ─────────────────────────────────────────────────────────

function TabInfo({ company }: { company: Record<string, unknown> }) {
  const c = company as {
    siret?: string; vatNumber?: string; website?: string
    billingAddress?: string; deliveryAddress?: string; city?: string
    postalCode?: string; country?: string; annualRevenue?: number
    employees?: number; notes?: string; tags?: string; createdAt?: string
  }

  const rows: { label: string; value: React.ReactNode }[] = [
    { label: 'SIRET', value: c.siret || '—' },
    { label: 'N° TVA', value: c.vatNumber || '—' },
    {
      label: 'Site web', value: c.website
        ? <a href={c.website} target="_blank" rel="noopener noreferrer" className="text-primary-600 hover:underline flex items-center gap-1"><Globe className="w-3.5 h-3.5" />{c.website}</a>
        : '—',
    },
    { label: 'Adresse facturation', value: c.billingAddress || '—' },
    { label: 'Adresse livraison', value: c.deliveryAddress || '—' },
    {
      label: 'Ville / CP', value: [c.city, c.postalCode].filter(Boolean).join(' ') || '—',
    },
    { label: 'Pays', value: c.country || '—' },
    { label: 'CA annuel', value: c.annualRevenue != null ? formatCurrency(c.annualRevenue as number) : '—' },
    { label: 'Employés', value: c.employees != null ? String(c.employees) : '—' },
  ]

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="card card-body space-y-3">
        <h3 className="font-semibold text-slate-800 flex items-center gap-2 mb-1"><Building2 className="w-4 h-4" /> Informations générales</h3>
        <dl className="space-y-2.5 text-sm">
          {rows.map(r => (
            <div key={r.label} className="flex justify-between gap-4">
              <dt className="text-slate-500 shrink-0">{r.label}</dt>
              <dd className="text-slate-800 text-right">{r.value}</dd>
            </div>
          ))}
        </dl>
      </div>
      <div className="space-y-4">
        {c.notes && (
          <div className="card card-body">
            <h3 className="font-semibold text-slate-800 mb-2 text-sm">Notes</h3>
            <p className="text-sm text-slate-600 whitespace-pre-wrap">{c.notes}</p>
          </div>
        )}
        {c.tags && (
          <div className="card card-body">
            <h3 className="font-semibold text-slate-800 mb-2 text-sm">Tags</h3>
            <div className="flex flex-wrap gap-1.5">
              {String(c.tags).split(',').map(t => t.trim()).filter(Boolean).map(tag => (
                <span key={tag} className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded-full text-xs">{tag}</span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Tab: Contacts ─────────────────────────────────────────────────────────────

function TabContacts({ contacts, onNavigate }: { contacts: Record<string, unknown>[]; onNavigate: (path: string) => void }) {
  if (contacts.length === 0) return <EmptyTab icon={<Users className="w-10 h-10 text-slate-200" />} label="Aucun contact" />
  return (
    <div className="table-container">
      <table>
        <thead>
          <tr>
            <th>Nom</th>
            <th>Poste</th>
            <th>Email</th>
            <th>Téléphone</th>
            <th>Statut</th>
          </tr>
        </thead>
        <tbody>
          {contacts.map((c) => {
            const contact = c as { id: string; firstName: string; lastName: string; position?: string; email?: string; phone?: string; status: string }
            return (
              <tr key={contact.id} className="cursor-pointer" onClick={() => onNavigate(`/contacts/${contact.id}`)}>
                <td className="font-medium text-slate-900">{contact.firstName} {contact.lastName}</td>
                <td className="text-slate-500 text-sm">{contact.position || '—'}</td>
                <td className="text-slate-500 text-sm">{contact.email || '—'}</td>
                <td className="text-slate-500 text-sm">{contact.phone || '—'}</td>
                <td>
                  <Badge variant="badge-blue">{contact.status}</Badge>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── Tab: Opportunités ─────────────────────────────────────────────────────────

function TabOpportunities({ opportunities }: { opportunities: Record<string, unknown>[] }) {
  if (opportunities.length === 0) return <EmptyTab icon={<TrendingUp className="w-10 h-10 text-slate-200" />} label="Aucune opportunité" />
  return (
    <div className="table-container">
      <table>
        <thead>
          <tr>
            <th>Titre</th>
            <th>Stage</th>
            <th>Valeur</th>
            <th>Probabilité</th>
            <th>Closing</th>
          </tr>
        </thead>
        <tbody>
          {opportunities.map(o => {
            const opp = o as { id: string; title: string; stage: string; value: number; probability: number; expectedCloseDate?: string }
            return (
              <tr key={opp.id}>
                <td className="font-medium text-slate-900">{opp.title}</td>
                <td>
                  <Badge variant={PIPELINE_STAGES[opp.stage]?.color}>{PIPELINE_STAGES[opp.stage]?.label || opp.stage}</Badge>
                </td>
                <td className="font-semibold text-slate-700">{formatCurrency(opp.value)}</td>
                <td className="text-slate-500">{opp.probability}%</td>
                <td className="text-slate-400 text-sm">{opp.expectedCloseDate ? formatDate(opp.expectedCloseDate) : '—'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── Tab: Tickets ──────────────────────────────────────────────────────────────

function TabTickets({ tickets, onNavigate }: { tickets: Record<string, unknown>[]; onNavigate: (path: string) => void }) {
  if (tickets.length === 0) return <EmptyTab icon={<Wrench className="w-10 h-10 text-slate-200" />} label="Aucun ticket" />
  return (
    <div className="table-container">
      <table>
        <thead>
          <tr>
            <th>Référence</th>
            <th>Titre</th>
            <th>Priorité</th>
            <th>Statut</th>
            <th>Créé le</th>
          </tr>
        </thead>
        <tbody>
          {tickets.map(t => {
            const tkt = t as { id: string; reference: string; title: string; priority: string; status: string; createdAt: string }
            return (
              <tr key={tkt.id} className="cursor-pointer" onClick={() => onNavigate(`/tickets/${tkt.id}`)}>
                <td className="text-xs text-slate-400 font-mono">{tkt.reference}</td>
                <td className="font-medium text-slate-900">{tkt.title}</td>
                <td>
                  <Badge variant={TICKET_PRIORITIES[tkt.priority]?.color}>{TICKET_PRIORITIES[tkt.priority]?.label || tkt.priority}</Badge>
                </td>
                <td>
                  <Badge variant={TICKET_STATUSES[tkt.status]?.color}>{TICKET_STATUSES[tkt.status]?.label || tkt.status}</Badge>
                </td>
                <td className="text-slate-400 text-sm">{formatDate(tkt.createdAt)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── Tab: Contrats ─────────────────────────────────────────────────────────────

function TabContracts({ contracts }: { contracts: Record<string, unknown>[] }) {
  if (contracts.length === 0) return <EmptyTab icon={<FileText className="w-10 h-10 text-slate-200" />} label="Aucun contrat" />
  return (
    <div className="table-container">
      <table>
        <thead>
          <tr>
            <th>Référence</th>
            <th>Type</th>
            <th>Statut</th>
            <th>Mensuel</th>
            <th>Fin</th>
          </tr>
        </thead>
        <tbody>
          {contracts.map(c => {
            const ct = c as { id: string; reference: string; type: string; status: string; monthlyAmount: number; endDate: string }
            return (
              <tr key={ct.id}>
                <td className="text-xs text-slate-400 font-mono">{ct.reference}</td>
                <td className="text-slate-700 text-sm">{CONTRACT_TYPES[ct.type] || ct.type}</td>
                <td>
                  <Badge variant={CONTRACT_STATUSES[ct.status]?.color}>{CONTRACT_STATUSES[ct.status]?.label || ct.status}</Badge>
                </td>
                <td className="font-semibold text-slate-700">{formatCurrency(ct.monthlyAmount)}</td>
                <td className="text-slate-400 text-sm">{formatDate(ct.endDate)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── Tab: Équipements ──────────────────────────────────────────────────────────

function TabEquipments({ equipments }: { equipments: Record<string, unknown>[] }) {
  if (equipments.length === 0) return <EmptyTab icon={<Monitor className="w-10 h-10 text-slate-200" />} label="Aucun équipement" />
  return (
    <div className="table-container">
      <table>
        <thead>
          <tr>
            <th>Type</th>
            <th>Marque</th>
            <th>Modèle</th>
            <th>Statut</th>
            <th>Localisation</th>
          </tr>
        </thead>
        <tbody>
          {equipments.map(e => {
            const eq = e as { id: string; type: string; brand?: string; model?: string; status: string; location?: string }
            return (
              <tr key={eq.id}>
                <td className="text-slate-700 text-sm">{EQUIPMENT_TYPES[eq.type] || eq.type}</td>
                <td className="text-slate-500 text-sm">{eq.brand || '—'}</td>
                <td className="text-slate-500 text-sm">{eq.model || '—'}</td>
                <td>
                  <Badge variant="badge-gray">{eq.status}</Badge>
                </td>
                <td className="text-slate-400 text-sm">{eq.location || '—'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyTab({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-3 text-slate-400">
      {icon}
      <p className="text-sm">{label}</p>
    </div>
  )
}
