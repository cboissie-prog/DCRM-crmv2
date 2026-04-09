import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import type { Resolver } from 'react-hook-form'
import api from '../../lib/api'
import { formatDate, formatRelative, CONTACT_STATUSES, LEAD_SOURCES, ACTIVITY_TYPES, PIPELINE_STAGES, TICKET_STATUSES, TICKET_PRIORITIES, getScoreColor, getScoreBg } from '../../lib/utils'
import { Badge } from '../../components/ui/Badge'
import { Avatar } from '../../components/ui/Avatar'
import { PageSpinner } from '../../components/ui/Spinner'
import { Modal } from '../../components/ui/Modal'
import { toast } from '../../components/ui/Toast'
import { useAuthStore } from '../../store/authStore'
import { ArrowLeft, Mail, Phone, Building2, Star, TrendingUp, Wrench, Clock, Pencil, Trash2 } from 'lucide-react'

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
})
type ContactForm = z.infer<typeof contactSchema>

export function ContactDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const user = useAuthStore(s => s.user)
  const canEdit = ['ADMIN', 'MANAGER', 'COMMERCIAL'].includes(user?.role ?? '')

  const [showEdit, setShowEdit] = useState(false)
  const [showDelete, setShowDelete] = useState(false)

  const { data: contact, isLoading } = useQuery({
    queryKey: ['contact', id],
    queryFn: async () => { const { data } = await api.get(`/contacts/${id}`); return data.data },
    enabled: !!id,
  })

  const editForm = useForm<ContactForm>({ resolver: zodResolver(contactSchema) as Resolver<ContactForm> })

  const editMutation = useMutation({
    mutationFn: (values: ContactForm) => api.put(`/contacts/${id}`, values),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contact', id] })
      qc.invalidateQueries({ queryKey: ['contacts'] })
      setShowEdit(false)
      toast.success('Contact modifié')
    },
    onError: () => toast.error('Erreur lors de la modification'),
  })

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/contacts/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contacts'] })
      toast.success('Contact supprimé')
      navigate('/contacts')
    },
    onError: () => toast.error('Erreur lors de la suppression'),
  })

  const openEdit = () => {
    editForm.reset({
      firstName: contact.firstName ?? '',
      lastName: contact.lastName ?? '',
      email: contact.email ?? '',
      phone: contact.phone ?? '',
      mobile: contact.mobile ?? '',
      position: contact.position ?? '',
      source: contact.source ?? '',
      status: contact.status ?? '',
      notes: contact.notes ?? '',
    })
    setShowEdit(true)
  }

  if (isLoading) return <PageSpinner />
  if (!contact) return <div className="p-8 text-center text-slate-500">Contact introuvable</div>

  return (
    <div className="space-y-5 fade-in">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/contacts')} className="btn-ghost btn-sm p-2 rounded-lg">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <h1 className="page-title">{contact.firstName} {contact.lastName}</h1>
            {contact.position && <p className="page-subtitle">{contact.position}</p>}
          </div>
        </div>
        {canEdit && (
          <div className="flex items-center gap-2">
            <button className="btn-secondary btn-sm flex items-center gap-1.5" onClick={openEdit}>
              <Pencil className="w-3.5 h-3.5" /> Modifier
            </button>
            <button
              className="btn-sm flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-red-600 border border-red-200 hover:bg-red-50 transition-colors"
              onClick={() => setShowDelete(true)}
            >
              <Trash2 className="w-3.5 h-3.5" /> Supprimer
            </button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Infos */}
        <div className="space-y-4">
          <div className="card card-body">
            <div className="flex items-center gap-4 mb-4">
              <Avatar firstName={contact.firstName} lastName={contact.lastName} size="lg" />
              <div>
                <Badge variant={CONTACT_STATUSES[contact.status]?.color}>{CONTACT_STATUSES[contact.status]?.label}</Badge>
                <div className={`mt-1 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold ${getScoreBg(contact.leadScore)} ${getScoreColor(contact.leadScore)}`}>
                  <Star className="w-3 h-3" /> Score : {contact.leadScore}
                </div>
              </div>
            </div>
            <div className="space-y-2 text-sm">
              {contact.email && (
                <div className="flex items-center gap-2 text-slate-600">
                  <Mail className="w-4 h-4 text-slate-400" />
                  <a href={`mailto:${contact.email}`} className="text-primary-600 hover:underline">{contact.email}</a>
                </div>
              )}
              {contact.phone && (
                <div className="flex items-center gap-2 text-slate-600">
                  <Phone className="w-4 h-4 text-slate-400" />
                  <a href={`tel:${contact.phone}`}>{contact.phone}</a>
                </div>
              )}
              {contact.mobile && (
                <div className="flex items-center gap-2 text-slate-600">
                  <Phone className="w-4 h-4 text-slate-400" />
                  {contact.mobile} <span className="text-xs text-slate-400">mobile</span>
                </div>
              )}
              {contact.company && (
                <div className="flex items-center gap-2 text-slate-600 cursor-pointer" onClick={() => navigate(`/companies/${contact.company.id}`)}>
                  <Building2 className="w-4 h-4 text-slate-400" />
                  <span className="text-primary-600 hover:underline">{contact.company.name}</span>
                </div>
              )}
            </div>
            <div className="mt-4 pt-4 border-t border-slate-100 grid grid-cols-2 gap-2 text-xs text-slate-500">
              <div><p className="font-medium text-slate-700">Source</p><p>{LEAD_SOURCES[contact.source]}</p></div>
              <div><p className="font-medium text-slate-700">Créé le</p><p>{formatDate(contact.createdAt)}</p></div>
            </div>
            {contact.notes && (
              <div className="mt-3 pt-3 border-t border-slate-100">
                <p className="text-xs font-medium text-slate-700 mb-1">Notes</p>
                <p className="text-xs text-slate-500">{contact.notes}</p>
              </div>
            )}
          </div>
        </div>

        {/* Activités & données */}
        <div className="lg:col-span-2 space-y-5">
          {/* Opportunités */}
          {contact.opportunities?.length > 0 && (
            <div className="card">
              <div className="card-header">
                <h3 className="font-semibold text-slate-800 flex items-center gap-2"><TrendingUp className="w-4 h-4" /> Opportunités</h3>
              </div>
              <div className="divide-y divide-slate-100">
                {contact.opportunities.map((opp: { id: string; title: string; stage: string; value: number; expectedCloseDate?: string }) => (
                  <div key={opp.id} className="flex items-center justify-between px-4 py-3">
                    <div>
                      <p className="text-sm font-medium text-slate-800">{opp.title}</p>
                      {opp.expectedCloseDate && <p className="text-xs text-slate-400">Closing : {formatDate(opp.expectedCloseDate)}</p>}
                    </div>
                    <div className="flex items-center gap-3">
                      <p className="text-sm font-semibold text-slate-700">{opp.value.toLocaleString('fr-FR')} €</p>
                      <Badge variant={PIPELINE_STAGES[opp.stage]?.color}>{PIPELINE_STAGES[opp.stage]?.label}</Badge>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Tickets */}
          {contact.tickets?.length > 0 && (
            <div className="card">
              <div className="card-header">
                <h3 className="font-semibold text-slate-800 flex items-center gap-2"><Wrench className="w-4 h-4" /> Tickets récents</h3>
              </div>
              <div className="divide-y divide-slate-100">
                {contact.tickets.slice(0, 5).map((tkt: { id: string; reference: string; title: string; status: string; priority: string; createdAt: string }) => (
                  <div key={tkt.id} className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-slate-50" onClick={() => navigate(`/tickets/${tkt.id}`)}>
                    <div>
                      <p className="text-sm font-medium text-slate-800">{tkt.title}</p>
                      <p className="text-xs text-slate-400">{tkt.reference} · {formatDate(tkt.createdAt)}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={TICKET_PRIORITIES[tkt.priority]?.color}>{TICKET_PRIORITIES[tkt.priority]?.label}</Badge>
                      <Badge variant={TICKET_STATUSES[tkt.status]?.color}>{TICKET_STATUSES[tkt.status]?.label}</Badge>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Timeline activités */}
          <div className="card">
            <div className="card-header">
              <h3 className="font-semibold text-slate-800 flex items-center gap-2"><Clock className="w-4 h-4" /> Historique</h3>
            </div>
            {contact.activities?.length === 0 ? (
              <div className="py-8 text-center text-sm text-slate-400">Aucune activité</div>
            ) : (
              <div className="divide-y divide-slate-100">
                {contact.activities?.slice(0, 10).map((act: { id: string; type: string; title: string; description?: string; user?: { firstName: string; lastName: string }; emailOpened?: boolean; createdAt: string }) => {
                  const typeInfo = ACTIVITY_TYPES[act.type] || { label: act.type }
                  return (
                    <div key={act.id} className="flex items-start gap-3 px-4 py-3">
                      <div className="w-7 h-7 bg-slate-100 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 text-xs font-medium text-slate-500">
                        {typeInfo.label.slice(0, 2)}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="text-sm font-medium text-slate-800">{act.title}</p>
                            {act.description && <p className="text-xs text-slate-500 mt-0.5">{act.description}</p>}
                            {act.emailOpened && <p className="text-xs text-emerald-600 mt-0.5">✓ Email ouvert</p>}
                          </div>
                          <p className="text-xs text-slate-400 whitespace-nowrap">{formatRelative(act.createdAt)}</p>
                        </div>
                        {act.user && <p className="text-xs text-slate-400 mt-1">{act.user.firstName} {act.user.lastName}</p>}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Edit Modal ── */}
      <Modal open={showEdit} onClose={() => setShowEdit(false)} title="Modifier le contact">
        <form onSubmit={editForm.handleSubmit(v => editMutation.mutate(v))} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="form-group">
              <label className="label">Prénom *</label>
              <input {...editForm.register('firstName')} className={`input ${editForm.formState.errors.firstName ? 'input-error' : ''}`} />
              {editForm.formState.errors.firstName && <p className="form-error">{editForm.formState.errors.firstName.message}</p>}
            </div>
            <div className="form-group">
              <label className="label">Nom *</label>
              <input {...editForm.register('lastName')} className={`input ${editForm.formState.errors.lastName ? 'input-error' : ''}`} />
              {editForm.formState.errors.lastName && <p className="form-error">{editForm.formState.errors.lastName.message}</p>}
            </div>
          </div>
          <div className="form-group">
            <label className="label">Email</label>
            <input {...editForm.register('email')} type="email" className="input" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="form-group">
              <label className="label">Téléphone</label>
              <input {...editForm.register('phone')} className="input" />
            </div>
            <div className="form-group">
              <label className="label">Mobile</label>
              <input {...editForm.register('mobile')} className="input" />
            </div>
          </div>
          <div className="form-group">
            <label className="label">Poste</label>
            <input {...editForm.register('position')} className="input" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="form-group">
              <label className="label">Source</label>
              <select {...editForm.register('source')} className="input">
                {Object.entries(LEAD_SOURCES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="label">Statut</label>
              <select {...editForm.register('status')} className="input">
                {Object.entries(CONTACT_STATUSES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>
          </div>
          <div className="form-group">
            <label className="label">Notes</label>
            <textarea {...editForm.register('notes')} className="input" rows={2} />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" className="btn-secondary" onClick={() => setShowEdit(false)}>Annuler</button>
            <button type="submit" className="btn-primary" disabled={editMutation.isPending}>Enregistrer</button>
          </div>
        </form>
      </Modal>

      {/* ── Delete Confirm Modal ── */}
      <Modal open={showDelete} onClose={() => setShowDelete(false)} title="Supprimer le contact" size="sm">
        <div className="space-y-4">
          <p className="text-slate-600">
            Êtes-vous sûr de vouloir supprimer <strong>{contact.firstName} {contact.lastName}</strong> ? Cette action est irréversible.
          </p>
          <div className="flex justify-end gap-3">
            <button className="btn-secondary" onClick={() => setShowDelete(false)}>Annuler</button>
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
