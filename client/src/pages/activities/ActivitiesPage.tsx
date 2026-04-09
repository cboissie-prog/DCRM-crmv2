import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import type { Resolver } from 'react-hook-form'
import api from '../../lib/api'
import { formatRelative, formatDate } from '../../lib/utils'
import { Badge } from '../../components/ui/Badge'
import { Avatar } from '../../components/ui/Avatar'
import { Modal } from '../../components/ui/Modal'
import { PageSpinner } from '../../components/ui/Spinner'
import { toast } from '../../components/ui/Toast'
import { useAuthStore } from '../../store/authStore'
import {
  Plus, Trash2, Phone, Mail, Users, CheckSquare,
  Monitor, Zap, StickyNote, Activity,
} from 'lucide-react'
import type { Activity as ActivityType, Contact, Company, PaginatedResponse } from '../../types'

// ── Activity type config ──────────────────────────────────────────────────────

const ACTIVITY_CONFIG: Record<string, {
  label: string
  icon: React.ReactNode
  badgeVariant: string
  iconBg: string
  iconColor: string
}> = {
  CALL: {
    label: 'Appel',
    icon: <Phone className="w-4 h-4" />,
    badgeVariant: 'badge-blue',
    iconBg: 'bg-blue-100',
    iconColor: 'text-blue-600',
  },
  EMAIL: {
    label: 'Email',
    icon: <Mail className="w-4 h-4" />,
    badgeVariant: 'badge-purple',
    iconBg: 'bg-purple-100',
    iconColor: 'text-purple-600',
  },
  MEETING: {
    label: 'Réunion',
    icon: <Users className="w-4 h-4" />,
    badgeVariant: 'badge-orange',
    iconBg: 'bg-orange-100',
    iconColor: 'text-orange-600',
  },
  NOTE: {
    label: 'Note',
    icon: <StickyNote className="w-4 h-4" />,
    badgeVariant: 'badge-yellow',
    iconBg: 'bg-yellow-100',
    iconColor: 'text-yellow-600',
  },
  TASK: {
    label: 'Tâche',
    icon: <CheckSquare className="w-4 h-4" />,
    badgeVariant: 'badge-green',
    iconBg: 'bg-emerald-100',
    iconColor: 'text-emerald-600',
  },
  DEMO: {
    label: 'Démo',
    icon: <Monitor className="w-4 h-4" />,
    badgeVariant: 'badge-blue',
    iconBg: 'bg-indigo-100',
    iconColor: 'text-indigo-600',
  },
  SYSTEM: {
    label: 'Système',
    icon: <Zap className="w-4 h-4" />,
    badgeVariant: 'badge-gray',
    iconBg: 'bg-slate-100',
    iconColor: 'text-slate-500',
  },
}

// ── Zod schema ─────────────────────────────────────────────────────────────────

const activitySchema = z.object({
  type: z.string().min(1, 'Type requis'),
  title: z.string().min(1, 'Titre requis'),
  description: z.string().optional(),
  contactId: z.string().optional(),
  companyId: z.string().optional(),
  opportunityId: z.string().optional(),
  dueDate: z.string().optional(),
})
type ActivityForm = z.infer<typeof activitySchema>

// ── Main page ──────────────────────────────────────────────────────────────────

export function ActivitiesPage() {
  const qc = useQueryClient()
  const user = useAuthStore(s => s.user)

  const canCreate = ['ADMIN', 'MANAGER', 'COMMERCIAL', 'TECHNICIEN'].includes(user?.role ?? '')
  const canDelete = ['ADMIN', 'MANAGER'].includes(user?.role ?? '')

  const [typeFilter, setTypeFilter] = useState('')
  const [page, setPage] = useState(1)
  const [showCreate, setShowCreate] = useState(false)
  const [deletingActivity, setDeletingActivity] = useState<ActivityType | null>(null)

  const LIMIT = 25

  // ── Query ────────────────────────────────────────────────────────────────────
  const { data, isLoading, isError } = useQuery<PaginatedResponse<ActivityType>>({
    queryKey: ['activities', { typeFilter, page }],
    queryFn: async () => {
      const { data } = await api.get('/activities', {
        params: {
          type: typeFilter || undefined,
          page,
          limit: LIMIT,
        },
      })
      return data
    },
    staleTime: 15_000,
  })

  // Contacts & companies for the form selects
  const { data: contactsData } = useQuery<PaginatedResponse<Contact>>({
    queryKey: ['contacts-select'],
    queryFn: async () => {
      const { data } = await api.get('/contacts', { params: { limit: 200 } })
      return data
    },
    staleTime: 60_000,
    enabled: showCreate,
  })
  const { data: companiesData } = useQuery<PaginatedResponse<Company>>({
    queryKey: ['companies-select'],
    queryFn: async () => {
      const { data } = await api.get('/companies', { params: { limit: 200 } })
      return data
    },
    staleTime: 60_000,
    enabled: showCreate,
  })

  // ── Mutations ────────────────────────────────────────────────────────────────
  const createMutation = useMutation({
    mutationFn: (values: ActivityForm) => api.post('/activities', values),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['activities'] })
      setShowCreate(false)
      toast.success('Activité créée')
    },
    onError: () => toast.error('Erreur lors de la création'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/activities/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['activities'] })
      setDeletingActivity(null)
      toast.success('Activité supprimée')
    },
    onError: () => toast.error('Erreur lors de la suppression'),
  })

  // ── Form ─────────────────────────────────────────────────────────────────────
  const form = useForm<ActivityForm>({
    resolver: zodResolver(activitySchema) as Resolver<ActivityForm>,
    defaultValues: { type: 'CALL' },
  })

  const openCreate = () => {
    form.reset({ type: 'CALL' })
    setShowCreate(true)
  }

  const activities = data?.data ?? []
  const total = data?.meta.total ?? 0
  const hasMore = page * LIMIT < total

  return (
    <div className="space-y-5 fade-in">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Activités</h1>
          <p className="page-subtitle">{total} activité{total !== 1 ? 's' : ''} au total</p>
        </div>
        {canCreate && (
          <button className="btn-primary" onClick={openCreate}>
            <Plus className="w-4 h-4" /> Ajouter une activité
          </button>
        )}
      </div>

      {/* Type filter */}
      <div className="flex gap-2 flex-wrap">
        <button
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${typeFilter === '' ? 'bg-primary-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
          onClick={() => { setTypeFilter(''); setPage(1) }}
        >
          Tous
        </button>
        {Object.entries(ACTIVITY_CONFIG).map(([key, cfg]) => (
          <button
            key={key}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${typeFilter === key ? 'bg-primary-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
            onClick={() => { setTypeFilter(key); setPage(1) }}
          >
            {cfg.icon}
            {cfg.label}
          </button>
        ))}
      </div>

      {/* Error / Loading */}
      {isError && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-700">
          Fonctionnalité en cours de déploiement — impossible de charger les activités.
        </div>
      )}

      {isLoading ? <PageSpinner /> : (
        <>
          {activities.length === 0 ? (
            <div className="text-center py-16 text-slate-400">
              <Activity className="w-12 h-12 mx-auto mb-3 text-slate-300" />
              <p className="text-sm font-medium">Aucune activité</p>
              <p className="text-xs mt-1">
                {typeFilter ? `Aucune activité de type "${ACTIVITY_CONFIG[typeFilter]?.label}"` : 'Aucune activité enregistrée pour le moment'}
              </p>
            </div>
          ) : (
            <div className="relative">
              {/* Timeline vertical line */}
              <div className="absolute left-6 top-0 bottom-0 w-px bg-slate-200" />

              <div className="space-y-1">
                {activities.map((activity) => {
                  const cfg = ACTIVITY_CONFIG[activity.type] ?? ACTIVITY_CONFIG['SYSTEM']
                  return (
                    <div key={activity.id} className="relative flex gap-4 pl-4 group">
                      {/* Icon bubble */}
                      <div className={`relative z-10 flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${cfg.iconBg} ${cfg.iconColor} ring-2 ring-white`}>
                        {cfg.icon}
                      </div>

                      {/* Content card */}
                      <div className="flex-1 bg-white border border-slate-100 rounded-xl p-3.5 mb-3 hover:shadow-sm transition-shadow">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            {/* Title row */}
                            <div className="flex items-center gap-2 flex-wrap">
                              <Badge variant={cfg.badgeVariant}>{cfg.label}</Badge>
                              <p className="text-sm font-semibold text-slate-900">{activity.title}</p>
                            </div>

                            {/* Description */}
                            {activity.description && (
                              <p className="text-xs text-slate-500 mt-1">{activity.description}</p>
                            )}

                            {/* Links */}
                            <div className="flex items-center gap-3 mt-2 flex-wrap">
                              {activity.contact && (
                                <Link
                                  to={`/contacts/${activity.contact.id}`}
                                  className="text-xs text-primary-600 hover:underline flex items-center gap-1"
                                  onClick={e => e.stopPropagation()}
                                >
                                  <Users className="w-3 h-3" />
                                  {activity.contact.firstName} {activity.contact.lastName}
                                </Link>
                              )}
                              {activity.company && (
                                <Link
                                  to={`/companies/${activity.company.id}`}
                                  className="text-xs text-slate-500 hover:text-slate-800 hover:underline flex items-center gap-1"
                                  onClick={e => e.stopPropagation()}
                                >
                                  <Monitor className="w-3 h-3" />
                                  {activity.company.name}
                                </Link>
                              )}
                              {activity.dueDate && (
                                <span className="text-xs text-slate-400 flex items-center gap-1">
                                  Prévu : {formatDate(activity.dueDate)}
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Right meta */}
                          <div className="flex flex-col items-end gap-2 flex-shrink-0">
                            <span className="text-xs text-slate-400">{formatRelative(activity.createdAt)}</span>
                            {activity.user && (
                              <div className="flex items-center gap-1.5">
                                <Avatar
                                  firstName={activity.user.firstName}
                                  lastName={activity.user.lastName}
                                  size="sm"
                                />
                                <span className="text-xs text-slate-500">
                                  {activity.user.firstName} {activity.user.lastName}
                                </span>
                              </div>
                            )}
                            {canDelete && (
                              <button
                                className="opacity-0 group-hover:opacity-100 btn-ghost btn-sm p-1 rounded-lg text-slate-400 hover:text-red-500 transition-opacity"
                                title="Supprimer"
                                onClick={() => setDeletingActivity(activity)}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Load more */}
              {hasMore && (
                <div className="flex justify-center pt-2">
                  <button
                    className="btn-secondary"
                    onClick={() => setPage(p => p + 1)}
                  >
                    Charger plus ({total - page * LIMIT} restantes)
                  </button>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* ── Create Modal ── */}
      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Ajouter une activité" size="lg">
        <ActivityFormFields
          form={form}
          contacts={contactsData?.data ?? []}
          companies={companiesData?.data ?? []}
          onSubmit={v => createMutation.mutate(v)}
          isPending={createMutation.isPending}
          onCancel={() => setShowCreate(false)}
        />
      </Modal>

      {/* ── Delete Confirm Modal ── */}
      <Modal open={!!deletingActivity} onClose={() => setDeletingActivity(null)} title="Supprimer l'activité" size="sm">
        <div className="space-y-4">
          <p className="text-slate-600">
            Êtes-vous sûr de vouloir supprimer <strong>{deletingActivity?.title}</strong> ? Cette action est irréversible.
          </p>
          <div className="flex justify-end gap-3">
            <button className="btn-secondary" onClick={() => setDeletingActivity(null)}>Annuler</button>
            <button
              className="px-4 py-2 rounded-lg text-sm font-medium bg-red-600 text-white hover:bg-red-700 transition-colors"
              onClick={() => deletingActivity && deleteMutation.mutate(deletingActivity.id)}
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

// ── ActivityFormFields ─────────────────────────────────────────────────────────

function ActivityFormFields({
  form,
  contacts,
  companies,
  onSubmit,
  isPending,
  onCancel,
}: {
  form: ReturnType<typeof useForm<ActivityForm>>
  contacts: Contact[]
  companies: Company[]
  onSubmit: (v: ActivityForm) => void
  isPending: boolean
  onCancel: () => void
}) {
  const { register, handleSubmit, formState: { errors, isSubmitting } } = form

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        {/* Type */}
        <div className="form-group">
          <label className="label">Type *</label>
          <select {...register('type')} className={`input ${errors.type ? 'input-error' : ''}`}>
            {Object.entries(ACTIVITY_CONFIG).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>
          {errors.type && <p className="form-error">{errors.type.message}</p>}
        </div>

        {/* Date prévue */}
        <div className="form-group">
          <label className="label">Date prévue</label>
          <input {...register('dueDate')} type="datetime-local" className="input" />
        </div>
      </div>

      {/* Titre */}
      <div className="form-group">
        <label className="label">Titre *</label>
        <input
          {...register('title')}
          className={`input ${errors.title ? 'input-error' : ''}`}
          placeholder="Ex : Appel de suivi avec le client"
        />
        {errors.title && <p className="form-error">{errors.title.message}</p>}
      </div>

      {/* Description */}
      <div className="form-group">
        <label className="label">Description</label>
        <textarea {...register('description')} className="input" rows={3} placeholder="Détails de l'activité..." />
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* Contact */}
        <div className="form-group">
          <label className="label">Contact</label>
          <select {...register('contactId')} className="input">
            <option value="">Aucun</option>
            {contacts.map(c => (
              <option key={c.id} value={c.id}>{c.firstName} {c.lastName}</option>
            ))}
          </select>
        </div>

        {/* Entreprise */}
        <div className="form-group">
          <label className="label">Entreprise</label>
          <select {...register('companyId')} className="input">
            <option value="">Aucune</option>
            {companies.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex justify-end gap-3 pt-2">
        <button type="button" className="btn-secondary" onClick={onCancel}>Annuler</button>
        <button type="submit" className="btn-primary" disabled={isSubmitting || isPending}>
          Créer l'activité
        </button>
      </div>
    </form>
  )
}
