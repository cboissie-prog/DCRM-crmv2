import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import type { Resolver } from 'react-hook-form'
import api from '../../lib/api'
import { formatDate, CONTACT_STATUSES, LEAD_SOURCES, getScoreColor, getScoreBg } from '../../lib/utils'
import { Badge } from '../../components/ui/Badge'
import { Avatar } from '../../components/ui/Avatar'
import { PageSpinner } from '../../components/ui/Spinner'
import { Modal } from '../../components/ui/Modal'
import { toast } from '../../components/ui/Toast'
import { useAuthStore } from '../../store/authStore'
import { Plus, Search, Mail, Phone, Building2, Pencil, Trash2, Download, Upload, X } from 'lucide-react'
import { ImportCsvModal } from '../../components/ui/ImportCsvModal'
import { downloadCsv } from '../../lib/exportCsv'
import type { Contact, PaginatedResponse } from '../../types'

const contactSchema = z.object({
  firstName: z.string().min(1, 'Prénom requis'),
  lastName: z.string().min(1, 'Nom requis'),
  email: z.string().email('Email invalide').optional().or(z.literal('')),
  phone: z.string().optional(),
  mobile: z.string().optional(),
  position: z.string().optional(),
  source: z.string().optional(),
  status: z.string().optional(),
  notes: z.string().optional(),
  companyId: z.string().optional(),
  newCompanyName: z.string().optional(),
  newCompanySiret: z.string().optional(),
  newCompanyVatNumber: z.string().optional(),
  newCompanyWebsite: z.string().optional(),
  newCompanySector: z.string().optional(),
  newCompanyCity: z.string().optional(),
  newCompanyPostalCode: z.string().optional(),
  newCompanyBillingAddress: z.string().optional(),
})
type ContactForm = z.infer<typeof contactSchema>

export function ContactsPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const user = useAuthStore(s => s.user)
  const canEdit = ['ADMIN', 'MANAGER', 'COMMERCIAL'].includes(user?.role ?? '')

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [page, setPage] = useState(1)
  const [showCreate, setShowCreate] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [editingContact, setEditingContact] = useState<Contact | null>(null)
  const [deletingContact, setDeletingContact] = useState<Contact | null>(null)

  const { data: companiesData = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['companies-light'],
    queryFn: async () => { const { data } = await api.get('/companies', { params: { limit: 200 } }); return data.data ?? [] },
    staleTime: 60_000,
  })

  const { data, isLoading } = useQuery<PaginatedResponse<Contact>>({
    queryKey: ['contacts', { search, statusFilter, page }],
    queryFn: async () => {
      const { data } = await api.get('/contacts', { params: { search: search || undefined, status: statusFilter || undefined, page, limit: 25 } })
      return data
    },
    staleTime: 30_000,
  })

  // ── Mutations ──────────────────────────────────────────────────────────────

  const createCompanyIfNeeded = async (values: ContactForm): Promise<string | undefined> => {
    if (values.companyId) return values.companyId
    if (!values.newCompanyName?.trim()) return undefined
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
    qc.invalidateQueries({ queryKey: ['companies-light'] })
    return data.data?.id
  }

  const createMutation = useMutation({
    mutationFn: async (values: ContactForm) => {
      const companyId = await createCompanyIfNeeded(values)
      const { newCompanyName, newCompanySiret, newCompanyVatNumber, newCompanyWebsite,
              newCompanySector, newCompanyCity, newCompanyPostalCode, newCompanyBillingAddress, ...rest } = values
      return api.post('/contacts', { ...rest, companyId: companyId || undefined })
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['contacts'] }); setShowCreate(false); toast.success('Contact créé') },
    onError: () => toast.error('Erreur lors de la création'),
  })

  const editMutation = useMutation({
    mutationFn: async ({ id, values }: { id: string; values: ContactForm }) => {
      const companyId = await createCompanyIfNeeded(values)
      const { newCompanyName, newCompanySiret, newCompanyVatNumber, newCompanyWebsite,
              newCompanySector, newCompanyCity, newCompanyPostalCode, newCompanyBillingAddress, ...rest } = values
      return api.put(`/contacts/${id}`, { ...rest, companyId: companyId || undefined })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contacts'] })
      qc.invalidateQueries({ queryKey: ['contact', editingContact?.id] })
      setEditingContact(null)
      toast.success('Contact modifié')
    },
    onError: () => toast.error('Erreur lors de la modification'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/contacts/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contacts'] })
      setDeletingContact(null)
      toast.success('Contact supprimé')
    },
    onError: () => toast.error('Erreur lors de la suppression'),
  })

  // ── Forms ──────────────────────────────────────────────────────────────────

  const createForm = useForm<ContactForm>({ resolver: zodResolver(contactSchema) as Resolver<ContactForm> })
  const editForm = useForm<ContactForm>({ resolver: zodResolver(contactSchema) as Resolver<ContactForm> })

  const openCreate = () => {
    createForm.reset({})
    setShowCreate(true)
  }

  const openEdit = (c: Contact, e: React.MouseEvent) => {
    e.stopPropagation()
    editForm.reset({
      firstName: c.firstName ?? '',
      lastName: c.lastName ?? '',
      email: c.email ?? '',
      phone: c.phone ?? '',
      mobile: c.mobile ?? '',
      position: c.position ?? '',
      source: c.source ?? '',
      status: c.status ?? '',
      notes: c.notes ?? '',
      companyId: c.companyId ?? '',
    })
    setEditingContact(c)
  }

  const openDelete = (c: Contact, e: React.MouseEvent) => {
    e.stopPropagation()
    setDeletingContact(c)
  }

  return (
    <div className="space-y-5 fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Contacts</h1>
          <p className="page-subtitle">{data?.meta.total || 0} contacts</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            className="btn-secondary flex items-center gap-1.5"
            onClick={() => downloadCsv('/contacts/export/csv', { search: search || undefined, status: statusFilter || undefined }, `contacts-${new Date().toISOString().slice(0,10)}.csv`)}
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
            <Plus className="w-4 h-4" /> Nouveau contact
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap items-center">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input className="input pl-9" placeholder="Rechercher..." value={search} onChange={e => { setSearch(e.target.value); setPage(1) }} />
        </div>
        <select className="input w-auto" value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1) }}>
          <option value="">Tous les statuts</option>
          {Object.entries(CONTACT_STATUSES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        {(search || statusFilter) && (
          <button
            className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800 border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white hover:bg-slate-50 transition-colors"
            onClick={() => { setSearch(''); setStatusFilter(''); setPage(1) }}
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
                <th>Contact</th>
                <th>Entreprise</th>
                <th>Statut</th>
                <th>Source</th>
                <th>Score</th>
                <th>Créé le</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data?.data.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-12 text-slate-400">Aucun contact trouvé</td></tr>
              ) : data?.data.map(c => (
                <tr key={c.id} className="cursor-pointer" onClick={() => navigate(`/contacts/${c.id}`)}>
                  <td>
                    <div className="flex items-center gap-3">
                      <Avatar firstName={c.firstName} lastName={c.lastName} size="sm" />
                      <div>
                        <p className="font-medium text-slate-900">{c.firstName} {c.lastName}</p>
                        {c.position && <p className="text-xs text-slate-400">{c.position}</p>}
                      </div>
                    </div>
                  </td>
                  <td>
                    {c.company ? (
                      <div className="flex items-center gap-1.5 text-slate-600">
                        <Building2 className="w-3.5 h-3.5 text-slate-400" />
                        {c.company.name}
                      </div>
                    ) : <span className="text-slate-300">—</span>}
                  </td>
                  <td>
                    <Badge variant={CONTACT_STATUSES[c.status]?.color || 'badge-gray'}>
                      {CONTACT_STATUSES[c.status]?.label || c.status}
                    </Badge>
                  </td>
                  <td className="text-slate-500 text-xs">{LEAD_SOURCES[c.source] || c.source}</td>
                  <td>
                    <div className="flex items-center gap-2">
                      <div className={`px-2 py-0.5 rounded-full text-xs font-bold ${getScoreBg(c.leadScore)} ${getScoreColor(c.leadScore)}`}>
                        {c.leadScore}
                      </div>
                    </div>
                  </td>
                  <td className="text-slate-400 text-xs">{formatDate(c.createdAt)}</td>
                  <td>
                    <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                      {c.email && <a href={`mailto:${c.email}`} className="btn-ghost btn-sm p-1.5 rounded-lg"><Mail className="w-3.5 h-3.5" /></a>}
                      {c.phone && <a href={`tel:${c.phone}`} className="btn-ghost btn-sm p-1.5 rounded-lg"><Phone className="w-3.5 h-3.5" /></a>}
                      {canEdit && (
                        <>
                          <button
                            className="btn-ghost btn-sm p-1.5 rounded-lg text-slate-400 hover:text-primary-600"
                            title="Modifier"
                            onClick={e => openEdit(c, e)}
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            className="btn-ghost btn-sm p-1.5 rounded-lg text-slate-400 hover:text-red-500"
                            title="Supprimer"
                            onClick={e => openDelete(c, e)}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </>
                      )}
                    </div>
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

      {/* ── Create Modal ── */}
      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Nouveau contact">
        <ContactFormFields
          form={createForm}
          companies={companiesData}
          onSubmit={v => createMutation.mutate(v)}
          isPending={createMutation.isPending}
          onCancel={() => setShowCreate(false)}
          submitLabel="Créer le contact"
        />
      </Modal>

      {/* ── Edit Modal ── */}
      <Modal open={!!editingContact} onClose={() => setEditingContact(null)} title="Modifier le contact">
        <ContactFormFields
          form={editForm}
          companies={companiesData}
          onSubmit={v => editingContact && editMutation.mutate({ id: editingContact.id, values: v })}
          isPending={editMutation.isPending}
          onCancel={() => setEditingContact(null)}
          submitLabel="Enregistrer"
        />
      </Modal>

      {/* ── Delete Confirm Modal ── */}
      <Modal open={!!deletingContact} onClose={() => setDeletingContact(null)} title="Supprimer le contact" size="sm">
        <div className="space-y-4">
          <p className="text-slate-600">
            Êtes-vous sûr de vouloir supprimer <strong>{deletingContact?.firstName} {deletingContact?.lastName}</strong> ? Cette action est irréversible.
          </p>
          <div className="flex justify-end gap-3">
            <button className="btn-secondary" onClick={() => setDeletingContact(null)}>Annuler</button>
            <button
              className="px-4 py-2 rounded-lg text-sm font-medium bg-red-600 text-white hover:bg-red-700 transition-colors"
              onClick={() => deletingContact && deleteMutation.mutate(deletingContact.id)}
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
        entity="contacts"
        invalidateKeys={[['contacts']]}
        templateHeaders="Prénom,Nom,Email,Téléphone,Mobile,Poste,Source,Statut,Entreprise,Notes"
        templateExample="Jean,Dupont,jean@example.com,0600000000,,Directeur,Site web,Client,Ma Société SARL,"
      />
    </div>
  )
}

// ── Shared form fields component ──────────────────────────────────────────────

function ContactFormFields({
  form,
  companies,
  onSubmit,
  isPending,
  onCancel,
  submitLabel,
}: {
  form: ReturnType<typeof useForm<ContactForm>>
  companies: { id: string; name: string }[]
  onSubmit: (v: ContactForm) => void
  isPending: boolean
  onCancel: () => void
  submitLabel: string
}) {
  const [newCompanyMode, setNewCompanyMode] = useState(false)
  const { register, handleSubmit, formState: { errors, isSubmitting } } = form

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="form-group">
          <label className="label">Prénom *</label>
          <input {...register('firstName')} className={`input ${errors.firstName ? 'input-error' : ''}`} />
          {errors.firstName && <p className="form-error">{errors.firstName.message}</p>}
        </div>
        <div className="form-group">
          <label className="label">Nom *</label>
          <input {...register('lastName')} className={`input ${errors.lastName ? 'input-error' : ''}`} />
          {errors.lastName && <p className="form-error">{errors.lastName.message}</p>}
        </div>
      </div>

      {/* Entreprise */}
      <div className="form-group">
        <label className="label">Entreprise</label>
        {newCompanyMode ? (
          <div className="space-y-3 p-3 bg-slate-50 rounded-xl border border-slate-100">
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
            <input
              {...register('newCompanyName')}
              placeholder="Nom de l'entreprise *"
              className="input"
              autoFocus
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input {...register('newCompanySiret')} placeholder="SIRET" className="input" />
              <input {...register('newCompanyVatNumber')} placeholder="N° TVA" className="input" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input {...register('newCompanyWebsite')} placeholder="Site web" className="input" />
              <input {...register('newCompanySector')} placeholder="Secteur d'activité" className="input" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input {...register('newCompanyCity')} placeholder="Ville" className="input" />
              <input {...register('newCompanyPostalCode')} placeholder="Code postal" className="input" />
            </div>
            <input {...register('newCompanyBillingAddress')} placeholder="Adresse de facturation" className="input" />
          </div>
        ) : (
          <div className="flex gap-2">
            <select {...register('companyId')} className="input flex-1">
              <option value="">-- Aucune --</option>
              {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <button
              type="button"
              onClick={() => { setNewCompanyMode(true); form.setValue('companyId', '') }}
              className="btn-secondary text-xs px-2 whitespace-nowrap"
            >
              + Nouvelle
            </button>
          </div>
        )}
      </div>

      <div className="form-group">
        <label className="label">Email</label>
        <input {...register('email')} type="email" className="input" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="form-group">
          <label className="label">Téléphone</label>
          <input {...register('phone')} className="input" />
        </div>
        <div className="form-group">
          <label className="label">Mobile</label>
          <input {...register('mobile')} className="input" />
        </div>
      </div>
      <div className="form-group">
        <label className="label">Poste</label>
        <input {...register('position')} className="input" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="form-group">
          <label className="label">Source</label>
          <select {...register('source')} className="input">
            {Object.entries(LEAD_SOURCES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label className="label">Statut</label>
          <select {...register('status')} className="input">
            {Object.entries(CONTACT_STATUSES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </div>
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
