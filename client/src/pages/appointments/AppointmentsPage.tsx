import { useState, useEffect, useCallback, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import type { Resolver } from 'react-hook-form'
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  CalendarDays,
  List,
  MapPin,
  Clock,
  Users,
  Pencil,
  Trash2,
  X,
} from 'lucide-react'
import api from '../../lib/api'
import { cn, formatDateTime } from '../../lib/utils'
import { Avatar } from '../../components/ui/Avatar'
import { PageSpinner } from '../../components/ui/Spinner'
import { Modal } from '../../components/ui/Modal'
import { toast } from '../../components/ui/Toast'
import { useAuthStore } from '../../store/authStore'
import type { Appointment, User, Contact, Ticket } from '../../types'

// ── Types ─────────────────────────────────────────────────────────────────────

const APPOINTMENT_TYPES: Record<string, { label: string; color: string; bg: string; dot: string }> = {
  CLIENT_MEETING: { label: 'RDV Client',    color: 'text-indigo-700', bg: 'bg-indigo-100', dot: 'bg-indigo-500' },
  INTERVENTION:   { label: 'Intervention',  color: 'text-orange-700', bg: 'bg-orange-100', dot: 'bg-orange-500' },
  CALL:           { label: 'Appel',         color: 'text-green-700',  bg: 'bg-green-100',  dot: 'bg-green-500'  },
  TRAINING:       { label: 'Formation',     color: 'text-purple-700', bg: 'bg-purple-100', dot: 'bg-purple-500' },
  DELIVERY:       { label: 'Livraison',     color: 'text-blue-700',   bg: 'bg-blue-100',   dot: 'bg-blue-500'   },
  OTHER:          { label: 'Autre',         color: 'text-slate-700',  bg: 'bg-slate-100',  dot: 'bg-slate-400'  },
}

const FRENCH_MONTHS = [
  'Janvier','Février','Mars','Avril','Mai','Juin',
  'Juillet','Août','Septembre','Octobre','Novembre','Décembre',
]
const FRENCH_DAYS = ['Lun','Mar','Mer','Jeu','Ven','Sam','Dim']

const HOUR_START  = 0
const HOUR_END    = 24
const HOUR_HEIGHT = 44 // px par heure

// ── Zod schema ────────────────────────────────────────────────────────────────

const appointmentSchema = z.object({
  title:       z.string().min(1, 'Titre requis'),
  type:        z.string().min(1, 'Type requis'),
  startAt:     z.string().min(1, 'Date de début requise'),
  endAt:       z.string().min(1, 'Date de fin requise'),
  location:    z.string().optional(),
  description: z.string().optional(),
  notes:       z.string().optional(),
  ticketId:    z.string().optional(),
  userIds:     z.array(z.string()).optional(),
  contactIds:  z.array(z.string()).optional(),
})
type AppointmentForm = z.infer<typeof appointmentSchema>

// ── Helpers ───────────────────────────────────────────────────────────────────

function toLocalDatetimeInput(iso: string | undefined): string {
  if (!iso) return ''
  // Convert ISO to YYYY-MM-DDTHH:mm (local)
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function dateToISOLocal(localDt: string): string {
  // datetime-local value "YYYY-MM-DDTHH:mm" → local Date → ISO string
  return new Date(localDt).toISOString()
}

function getWeekStart(d: Date): Date {
  const day = d.getDay() // 0=Sun…6=Sat
  const diff = day === 0 ? -6 : 1 - day // ramener au lundi
  const monday = new Date(d)
  monday.setDate(d.getDate() + diff)
  monday.setHours(0, 0, 0, 0)
  return monday
}

function getWeekDays(start: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    return d
  })
}

function apptPositionStyle(appt: Appointment): React.CSSProperties {
  const start = new Date(appt.startAt)
  const end   = new Date(appt.endAt)
  const startMin = (start.getHours() - HOUR_START) * 60 + start.getMinutes()
  const endMin   = Math.min(
    (end.getHours() - HOUR_START) * 60 + end.getMinutes(),
    (HOUR_END - HOUR_START) * 60
  )
  const duration = Math.max(endMin - startMin, 20)
  return {
    top:    `${(startMin / 60) * HOUR_HEIGHT}px`,
    height: `${(duration / 60) * HOUR_HEIGHT - 2}px`,
  }
}

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
}

function dateToInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T09:00`
}

// ── Main component ─────────────────────────────────────────────────────────────

export function AppointmentsPage() {
  const qc = useQueryClient()
  const user = useAuthStore(s => s.user)
  const canSeeOthers = ['ADMIN', 'MANAGER'].includes(user?.role ?? '')

  // ── View state ─────────────────────────────────────────────────────────────
  const [viewMode, setViewMode] = useState<'calendar' | 'list'>('calendar')
  const today = new Date()
  const [weekStart, setWeekStart] = useState<Date>(() => getWeekStart(today))
  const [now, setNow] = useState(new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(id)
  }, [])

  const gridScrollRef = useRef<HTMLDivElement>(null)

  // ── Filters ────────────────────────────────────────────────────────────────
  const [typeFilter, setTypeFilter]   = useState('')
  const [userFilter, setUserFilter]   = useState('')

  // ── Modal state ────────────────────────────────────────────────────────────
  const [showCreate, setShowCreate]           = useState(false)
  const [editingAppt, setEditingAppt]         = useState<Appointment | null>(null)
  const [deletingAppt, setDeletingAppt]       = useState<Appointment | null>(null)
  const [detailAppt, setDetailAppt]           = useState<Appointment | null>(null)
  const [_prefilledDate, setPrefilledDate]     = useState<string>('')

  // ── Date range for query ────────────────────────────────────────────────────
  const weekEnd = new Date(weekStart)
  weekEnd.setDate(weekStart.getDate() + 6)
  weekEnd.setHours(23, 59, 59)
  const fromDate = weekStart.toISOString()
  const toDate   = weekEnd.toISOString()

  // ── Queries ────────────────────────────────────────────────────────────────
  const { data: apptData, isLoading } = useQuery<{ data: Appointment[] }>({
    queryKey: ['appointments', weekStart.toISOString(), typeFilter, userFilter],
    queryFn: async () => {
      const { data } = await api.get('/appointments', {
        params: {
          from: viewMode === 'calendar' ? fromDate : undefined,
          to:   viewMode === 'calendar' ? toDate   : undefined,
          type: typeFilter || undefined,
          userId: userFilter || undefined,
        },
      })
      return data
    },
    staleTime: 30_000,
  })

  const { data: usersData } = useQuery<{ data: User[] }>({
    queryKey: ['users-list'],
    queryFn: async () => { const { data } = await api.get('/users'); return data },
    staleTime: 60_000,
  })

  const { data: contactsData } = useQuery<{ data: Contact[] }>({
    queryKey: ['contacts-list'],
    queryFn: async () => { const { data } = await api.get('/contacts', { params: { limit: 200 } }); return data },
    staleTime: 60_000,
  })

  const { data: ticketsData } = useQuery<{ data: Ticket[] }>({
    queryKey: ['tickets-list'],
    queryFn: async () => { const { data } = await api.get('/tickets', { params: { limit: 200 } }); return data },
    staleTime: 60_000,
  })

  const appointments: Appointment[] = apptData?.data ?? []
  const users:        User[]        = usersData?.data ?? []
  const contacts:     Contact[]     = contactsData?.data ?? []
  const tickets:      Ticket[]      = ticketsData?.data ?? []

  // Scroll initial vers 8h une fois le DOM de la grille disponible
  useEffect(() => {
    if (viewMode === 'calendar' && !isLoading && gridScrollRef.current) {
      gridScrollRef.current.scrollTop = (8 - HOUR_START) * HOUR_HEIGHT
    }
  }, [viewMode, isLoading])

  // ── Mutations ──────────────────────────────────────────────────────────────
  const createMutation = useMutation({
    mutationFn: (values: AppointmentForm) => api.post('/appointments', {
      ...values,
      startAt:    dateToISOLocal(values.startAt),
      endAt:      dateToISOLocal(values.endAt),
      userIds:    values.userIds ?? [],
      contactIds: values.contactIds ?? [],
      ticketId:   values.ticketId || undefined,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['appointments'] })
      setShowCreate(false)
      toast.success('Rendez-vous créé')
    },
    onError: () => toast.error('Erreur lors de la création'),
  })

  const editMutation = useMutation({
    mutationFn: ({ id, values }: { id: string; values: AppointmentForm }) =>
      api.put(`/appointments/${id}`, {
        ...values,
        startAt:    dateToISOLocal(values.startAt),
        endAt:      dateToISOLocal(values.endAt),
        userIds:    values.userIds ?? [],
        contactIds: values.contactIds ?? [],
        ticketId:   values.ticketId || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['appointments'] })
      setEditingAppt(null)
      setDetailAppt(null)
      toast.success('Rendez-vous modifié')
    },
    onError: () => toast.error('Erreur lors de la modification'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/appointments/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['appointments'] })
      setDeletingAppt(null)
      setDetailAppt(null)
      toast.success('Rendez-vous supprimé')
    },
    onError: () => toast.error('Erreur lors de la suppression'),
  })

  // ── Forms ──────────────────────────────────────────────────────────────────
  const createForm = useForm<AppointmentForm>({
    resolver: zodResolver(appointmentSchema) as Resolver<AppointmentForm>,
    defaultValues: { type: 'CLIENT_MEETING', userIds: user?.id ? [user.id] : [], contactIds: [] },
  })
  const editForm = useForm<AppointmentForm>({
    resolver: zodResolver(appointmentSchema) as Resolver<AppointmentForm>,
  })

  const openCreate = useCallback((prefilled?: string) => {
    const start = prefilled || dateToInputValue(today)
    const endD  = new Date(start)
    endD.setHours(endD.getHours() + 1)
    const end   = toLocalDatetimeInput(endD.toISOString())
    createForm.reset({
      title: '', type: 'CLIENT_MEETING',
      startAt: start, endAt: end,
      location: '', description: '', notes: '',
      ticketId: '', userIds: user?.id ? [user.id] : [], contactIds: [],
    })
    setPrefilledDate(prefilled ?? '')
    setShowCreate(true)
  }, [createForm, today])

  const openEdit = useCallback((appt: Appointment) => {
    editForm.reset({
      title:       appt.title ?? '',
      type:        appt.type ?? 'CLIENT_MEETING',
      startAt:     toLocalDatetimeInput(appt.startAt),
      endAt:       toLocalDatetimeInput(appt.endAt),
      location:    appt.location ?? '',
      description: appt.description ?? '',
      notes:       appt.notes ?? '',
      ticketId:    appt.ticketId ?? '',
      userIds:     appt.users?.map(u => u.user.id) ?? [],
      contactIds:  appt.contacts?.map(c => c.contact.id) ?? [],
    })
    setDetailAppt(null)
    setEditingAppt(appt)
  }, [editForm])

  // ── Navigation semaine ─────────────────────────────────────────────────────
  const prevWeek = () => setWeekStart(ws => { const d = new Date(ws); d.setDate(d.getDate() - 7); return d })
  const nextWeek = () => setWeekStart(ws => { const d = new Date(ws); d.setDate(d.getDate() + 7); return d })
  const goToday  = () => setWeekStart(getWeekStart(today))

  // ── Semaine courante ────────────────────────────────────────────────────────
  const weekDays = getWeekDays(weekStart)
  const hours    = Array.from({ length: HOUR_END - HOUR_START }, (_, i) => HOUR_START + i)

  const getApptsByDay = (day: Date) =>
    appointments.filter(a => isSameDay(new Date(a.startAt), day))

  // ── Sorted list view ───────────────────────────────────────────────────────
  const sortedAppointments = [...appointments].sort(
    (a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime()
  )

  // ── Reload when switching to list (no date range) ──────────────────────────
  useEffect(() => {
    qc.invalidateQueries({ queryKey: ['appointments'] })
  }, [viewMode, qc])

  // ── Render ─────────────────────────────────────────────────────────────────
  // En vue calendrier : hauteur fixe = viewport - header(56px) - padding(48px)
  // En vue liste : défilement normal de page
  const isCalendar = viewMode === 'calendar'

  return (
    <div className={cn('fade-in', isCalendar ? 'flex flex-col h-[calc(100vh-104px)] gap-4' : 'space-y-5')}>
      {/* Header + Filters — zone fixe */}
      <div className={isCalendar ? 'flex-none space-y-3' : 'space-y-5'}>
      <div className="page-header">
        <div>
          <h1 className="page-title">Agenda & Interventions</h1>
          <p className="page-subtitle">{appointments.length} événement{appointments.length !== 1 ? 's' : ''}</p>
        </div>
        <div className="flex items-center gap-2">
          {/* View toggle */}
          <div className="flex bg-slate-100 rounded-lg p-0.5">
            <button
              className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
                viewMode === 'calendar' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700')}
              onClick={() => setViewMode('calendar')}
            >
              <CalendarDays className="w-3.5 h-3.5" /> Semaine
            </button>
            <button
              className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
                viewMode === 'list' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700')}
              onClick={() => setViewMode('list')}
            >
              <List className="w-3.5 h-3.5" /> Liste
            </button>
          </div>
          <button className="btn-primary" onClick={() => openCreate()}>
            <Plus className="w-4 h-4" /> Nouveau RDV
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <select className="input w-auto" value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
          <option value="">Tous les types</option>
          {Object.entries(APPOINTMENT_TYPES).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
        {canSeeOthers && (
          <select className="input w-auto" value={userFilter} onChange={e => setUserFilter(e.target.value)}>
            <option value="">Tous les techniciens/commerciaux</option>
            {users.map(u => (
              <option key={u.id} value={u.id}>{u.firstName} {u.lastName}</option>
            ))}
          </select>
        )}
      </div>
      </div>{/* fin zone fixe */}

      {isLoading ? <PageSpinner /> : (
        <>
          {/* ── Week Calendar View ── */}
          {viewMode === 'calendar' && (
            <div className="card overflow-hidden flex flex-col flex-1 min-h-0">
              {/* Week navigation */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
                <div className="flex items-center gap-1">
                  <button className="btn-ghost btn-sm p-1.5 rounded-lg" onClick={prevWeek}>
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button className="btn-ghost btn-sm p-1.5 rounded-lg" onClick={nextWeek}>
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
                <h2 className="text-base font-semibold text-slate-900">
                  {(() => {
                    const start = weekDays[0], end = weekDays[6]
                    const sameMonth = start.getMonth() === end.getMonth()
                    return sameMonth
                      ? `${start.getDate()} – ${end.getDate()} ${FRENCH_MONTHS[start.getMonth()]} ${start.getFullYear()}`
                      : `${start.getDate()} ${FRENCH_MONTHS[start.getMonth()]} – ${end.getDate()} ${FRENCH_MONTHS[end.getMonth()]} ${end.getFullYear()}`
                  })()}
                </h2>
                <button
                  className="btn-secondary btn-sm text-xs px-3 py-1.5"
                  onClick={goToday}
                >
                  Aujourd'hui
                </button>
              </div>

              {/* Day headers */}
              <div className="grid border-b border-slate-100" style={{ gridTemplateColumns: '52px repeat(7, 1fr)' }}>
                <div /> {/* spacer for hours column */}
                {weekDays.map((day, i) => {
                  const isToday = isSameDay(day, today)
                  return (
                    <div key={i} className={cn('py-2 text-center border-l border-slate-100', isToday && 'bg-primary-50')}>
                      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">{FRENCH_DAYS[i]}</p>
                      <p className={cn(
                        'text-sm font-bold mt-0.5',
                        isToday ? 'text-primary-600' : 'text-slate-700',
                      )}>
                        {day.getDate()}
                      </p>
                    </div>
                  )
                })}
              </div>

              {/* Time grid */}
              <div ref={gridScrollRef} className="flex-1 overflow-y-auto min-h-0">
                <div className="grid relative" style={{ gridTemplateColumns: '52px repeat(7, 1fr)' }}>

                  {/* Hours column */}
                  <div>
                    {hours.map(h => (
                      <div key={h} style={{ height: HOUR_HEIGHT }} className="border-b border-slate-100 flex items-start justify-end pr-2 pt-1">
                        <span className="text-xs text-slate-400 font-medium">{String(h).padStart(2, '0')}h</span>
                      </div>
                    ))}
                  </div>

                  {/* Day columns */}
                  {weekDays.map((day, di) => {
                    const isToday = isSameDay(day, today)
                    const dayAppts = getApptsByDay(day)

                    return (
                      <div
                        key={di}
                        className={cn('border-l border-slate-100 relative', isToday && 'bg-primary-50/30')}
                        style={{ height: (HOUR_END - HOUR_START) * HOUR_HEIGHT }}
                      >
                        {/* Hour grid lines */}
                        {hours.map(h => (
                          <div
                            key={h}
                            className="absolute left-0 right-0 border-b border-slate-100 cursor-pointer hover:bg-slate-50/80 transition-colors"
                            style={{ top: (h - HOUR_START) * HOUR_HEIGHT, height: HOUR_HEIGHT }}
                            onClick={() => {
                              const d = new Date(day)
                              d.setHours(h, 0, 0, 0)
                              openCreate(toLocalDatetimeInput(d.toISOString()))
                            }}
                          />
                        ))}

                        {/* Ligne heure actuelle */}
                        {isToday && (() => {
                          const nowMin = (now.getHours() - HOUR_START) * 60 + now.getMinutes()
                          if (nowMin < 0 || nowMin > (HOUR_END - HOUR_START) * 60) return null
                          const top = (nowMin / 60) * HOUR_HEIGHT
                          return (
                            <div className="absolute left-0 right-0 z-20 pointer-events-none" style={{ top }}>
                              <div className="relative flex items-center">
                                <span className="w-2 h-2 rounded-full bg-red-500 shrink-0 -ml-1" />
                                <div className="flex-1 h-px bg-red-500" />
                              </div>
                            </div>
                          )
                        })()}

                        {/* Appointments */}
                        {dayAppts.map(a => {
                          const meta = APPOINTMENT_TYPES[a.type] ?? APPOINTMENT_TYPES.OTHER
                          const style = apptPositionStyle(a)
                          const start = new Date(a.startAt)
                          const end   = new Date(a.endAt)
                          const timeStr = `${String(start.getHours()).padStart(2,'0')}:${String(start.getMinutes()).padStart(2,'0')} – ${String(end.getHours()).padStart(2,'0')}:${String(end.getMinutes()).padStart(2,'0')}`
                          const shortDuration = (parseInt(style.height as string) < 40)

                          return (
                            <button
                              key={a.id}
                              className={cn(
                                'absolute left-0.5 right-0.5 rounded-md px-1.5 py-1 text-left overflow-hidden z-10 hover:z-30',
                                'border transition-opacity hover:opacity-90 shadow-sm',
                                meta.bg, meta.color,
                              )}
                              style={{ ...style, borderColor: 'transparent' }}
                              onClick={e => { e.stopPropagation(); setDetailAppt(a) }}
                              title={`${a.title} — ${timeStr}`}
                            >
                              <p className="text-xs font-semibold leading-tight truncate">{a.title}</p>
                              {!shortDuration && (
                                <p className="text-xs opacity-70 leading-tight">{timeStr}</p>
                              )}
                            </button>
                          )
                        })}
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          )}

          {/* ── List View ── */}
          {viewMode === 'list' && (
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Date / Heure</th>
                    <th>Type</th>
                    <th>Titre</th>
                    <th>Participants</th>
                    <th>Lieu</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {sortedAppointments.length === 0 ? (
                    <tr><td colSpan={6} className="text-center py-12 text-slate-400">Aucun rendez-vous trouvé</td></tr>
                  ) : sortedAppointments.map(a => {
                    const meta = APPOINTMENT_TYPES[a.type] ?? APPOINTMENT_TYPES.OTHER
                    return (
                      <tr key={a.id} className="cursor-pointer" onClick={() => setDetailAppt(a)}>
                        <td className="whitespace-nowrap">
                          <p className="text-sm font-medium text-slate-900">{formatDateTime(a.startAt)}</p>
                          <p className="text-xs text-slate-400">→ {formatDateTime(a.endAt)}</p>
                        </td>
                        <td>
                          <span className={cn('inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium', meta.bg, meta.color)}>
                            <span className={cn('w-1.5 h-1.5 rounded-full', meta.dot)} />
                            {meta.label}
                          </span>
                        </td>
                        <td>
                          <p className="font-medium text-slate-900">{a.title}</p>
                          {a.description && <p className="text-xs text-slate-400 truncate max-w-xs">{a.description}</p>}
                        </td>
                        <td>
                          <div className="flex -space-x-1">
                            {a.users?.slice(0, 4).map(u => (
                              <Avatar key={u.user.id} firstName={u.user.firstName} lastName={u.user.lastName} size="xs" className="ring-2 ring-white" />
                            ))}
                            {(a.users?.length ?? 0) > 4 && (
                              <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-slate-200 text-xs text-slate-600 ring-2 ring-white">
                                +{(a.users?.length ?? 0) - 4}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="text-slate-500 text-sm">
                          {a.location ? (
                            <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{a.location}</span>
                          ) : <span className="text-slate-300">—</span>}
                        </td>
                        <td>
                          <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                            <button
                              className="btn-ghost btn-sm p-1.5 rounded-lg text-slate-400 hover:text-primary-600"
                              title="Modifier"
                              onClick={() => openEdit(a)}
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              className="btn-ghost btn-sm p-1.5 rounded-lg text-slate-400 hover:text-red-500"
                              title="Supprimer"
                              onClick={() => setDeletingAppt(a)}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* ── Detail Side Panel (Modal) ── */}
      {detailAppt && (
        <AppointmentDetailModal
          appointment={detailAppt}
          onClose={() => setDetailAppt(null)}
          onEdit={() => openEdit(detailAppt)}
          onDelete={() => { setDetailAppt(null); setDeletingAppt(detailAppt) }}
        />
      )}

      {/* ── Create Modal ── */}
      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Nouveau rendez-vous" size="lg">
        <AppointmentFormFields
          form={createForm}
          onSubmit={v => createMutation.mutate(v)}
          isPending={createMutation.isPending}
          onCancel={() => setShowCreate(false)}
          submitLabel="Créer le rendez-vous"
          users={users}
          contacts={contacts}
          tickets={tickets}
        />
      </Modal>

      {/* ── Edit Modal ── */}
      <Modal open={!!editingAppt} onClose={() => setEditingAppt(null)} title="Modifier le rendez-vous" size="lg">
        <AppointmentFormFields
          form={editForm}
          onSubmit={v => editingAppt && editMutation.mutate({ id: editingAppt.id, values: v })}
          isPending={editMutation.isPending}
          onCancel={() => setEditingAppt(null)}
          submitLabel="Enregistrer"
          users={users}
          contacts={contacts}
          tickets={tickets}
        />
      </Modal>

      {/* ── Delete Confirm Modal ── */}
      <Modal open={!!deletingAppt} onClose={() => setDeletingAppt(null)} title="Supprimer le rendez-vous" size="sm">
        <div className="space-y-4">
          <p className="text-slate-600">
            Êtes-vous sûr de vouloir supprimer <strong>{deletingAppt?.title}</strong> ?
            Cette action est irréversible.
          </p>
          <div className="flex justify-end gap-3">
            <button className="btn-secondary" onClick={() => setDeletingAppt(null)}>Annuler</button>
            <button
              className="px-4 py-2 rounded-lg text-sm font-medium bg-red-600 text-white hover:bg-red-700 transition-colors disabled:opacity-50"
              onClick={() => deletingAppt && deleteMutation.mutate(deletingAppt.id)}
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

// ── Detail Modal ──────────────────────────────────────────────────────────────

function AppointmentDetailModal({
  appointment: a,
  onClose,
  onEdit,
  onDelete,
}: {
  appointment: Appointment
  onClose: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const meta = APPOINTMENT_TYPES[a.type] ?? APPOINTMENT_TYPES.OTHER

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-end p-4">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md h-full max-h-[calc(100vh-2rem)] flex flex-col fade-in overflow-hidden">
        {/* Header */}
        <div className={cn('px-5 py-4 flex items-start justify-between', meta.bg)}>
          <div className="flex-1 min-w-0">
            <span className={cn('inline-flex items-center gap-1.5 text-xs font-semibold mb-1', meta.color)}>
              <span className={cn('w-1.5 h-1.5 rounded-full', meta.dot)} />
              {meta.label}
            </span>
            <h2 className="text-lg font-bold text-slate-900 truncate">{a.title}</h2>
          </div>
          <button onClick={onClose} className="btn-ghost btn-sm rounded-lg p-1.5 ml-2 shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Dates */}
          <div className="flex items-start gap-3">
            <Clock className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium text-slate-900">{formatDateTime(a.startAt)}</p>
              <p className="text-xs text-slate-500">→ {formatDateTime(a.endAt)}</p>
            </div>
          </div>

          {/* Location */}
          {a.location && (
            <div className="flex items-center gap-3">
              <MapPin className="w-4 h-4 text-slate-400 shrink-0" />
              <span className="text-sm text-slate-700">{a.location}</span>
            </div>
          )}

          {/* Description */}
          {a.description && (
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Description</p>
              <p className="text-sm text-slate-700 whitespace-pre-line">{a.description}</p>
            </div>
          )}

          {/* Notes */}
          {a.notes && (
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Notes</p>
              <p className="text-sm text-slate-700 whitespace-pre-line">{a.notes}</p>
            </div>
          )}

          {/* Participants */}
          {(a.users?.length ?? 0) > 0 && (
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                <Users className="inline w-3.5 h-3.5 mr-1" />Participants
              </p>
              <div className="space-y-1.5">
                {a.users?.map(u => (
                  <div key={u.user.id} className="flex items-center gap-2">
                    <Avatar firstName={u.user.firstName} lastName={u.user.lastName} size="xs" />
                    <span className="text-sm text-slate-700">{u.user.firstName} {u.user.lastName}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Contacts */}
          {(a.contacts?.length ?? 0) > 0 && (
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Contacts liés</p>
              <div className="space-y-1.5">
                {a.contacts?.map(c => (
                  <div key={c.contact.id} className="flex items-center gap-2">
                    <Avatar firstName={c.contact.firstName} lastName={c.contact.lastName} size="xs" />
                    <span className="text-sm text-slate-700">{c.contact.firstName} {c.contact.lastName}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="border-t border-slate-100 px-5 py-3 flex justify-end gap-2 shrink-0">
          <button className="btn-secondary btn-sm flex items-center gap-1.5" onClick={onEdit}>
            <Pencil className="w-3.5 h-3.5" /> Modifier
          </button>
          <button
            className="btn-sm px-3 py-1.5 rounded-lg text-sm font-medium bg-red-50 text-red-600 hover:bg-red-100 transition-colors flex items-center gap-1.5"
            onClick={onDelete}
          >
            <Trash2 className="w-3.5 h-3.5" /> Supprimer
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Form fields component ─────────────────────────────────────────────────────

function AppointmentFormFields({
  form,
  onSubmit,
  isPending,
  onCancel,
  submitLabel,
  users,
  contacts,
  tickets,
}: {
  form: ReturnType<typeof useForm<AppointmentForm>>
  onSubmit: (v: AppointmentForm) => void
  isPending: boolean
  onCancel: () => void
  submitLabel: string
  users: User[]
  contacts: Contact[]
  tickets: Ticket[]
}) {
  const { register, handleSubmit, control, formState: { errors, isSubmitting } } = form

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
      {/* Titre + Type */}
      <div className="grid grid-cols-2 gap-4">
        <div className="form-group col-span-2 sm:col-span-1">
          <label className="label">Titre *</label>
          <input {...register('title')} className={`input ${errors.title ? 'input-error' : ''}`} placeholder="Titre du rendez-vous" />
          {errors.title && <p className="form-error">{errors.title.message}</p>}
        </div>
        <div className="form-group col-span-2 sm:col-span-1">
          <label className="label">Type *</label>
          <select {...register('type')} className={`input ${errors.type ? 'input-error' : ''}`}>
            {Object.entries(APPOINTMENT_TYPES).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>
          {errors.type && <p className="form-error">{errors.type.message}</p>}
        </div>
      </div>

      {/* Dates */}
      <div className="grid grid-cols-2 gap-4">
        <div className="form-group">
          <label className="label">Début *</label>
          <input {...register('startAt')} type="datetime-local" className={`input ${errors.startAt ? 'input-error' : ''}`} />
          {errors.startAt && <p className="form-error">{errors.startAt.message}</p>}
        </div>
        <div className="form-group">
          <label className="label">Fin *</label>
          <input {...register('endAt')} type="datetime-local" className={`input ${errors.endAt ? 'input-error' : ''}`} />
          {errors.endAt && <p className="form-error">{errors.endAt.message}</p>}
        </div>
      </div>

      {/* Lieu */}
      <div className="form-group">
        <label className="label">Lieu</label>
        <input {...register('location')} className="input" placeholder="Adresse ou lieu" />
      </div>

      {/* Description */}
      <div className="form-group">
        <label className="label">Description</label>
        <textarea {...register('description')} className="input" rows={2} placeholder="Description du rendez-vous..." />
      </div>

      {/* Notes */}
      <div className="form-group">
        <label className="label">Notes internes</label>
        <textarea {...register('notes')} className="input" rows={2} placeholder="Notes privées..." />
      </div>

      {/* Participants (multi-select) */}
      <div className="form-group">
        <label className="label">Participants (utilisateurs)</label>
        <Controller
          control={control}
          name="userIds"
          render={({ field }) => (
            <MultiSelectField
              options={users.map(u => ({ value: u.id, label: `${u.firstName} ${u.lastName}` }))}
              value={field.value ?? []}
              onChange={field.onChange}
              placeholder="Ajouter des participants..."
            />
          )}
        />
      </div>

      {/* Contacts liés (multi-select) */}
      <div className="form-group">
        <label className="label">Contacts liés</label>
        <Controller
          control={control}
          name="contactIds"
          render={({ field }) => (
            <MultiSelectField
              options={contacts.map(c => ({ value: c.id, label: `${c.firstName} ${c.lastName}` }))}
              value={field.value ?? []}
              onChange={field.onChange}
              placeholder="Ajouter des contacts..."
            />
          )}
        />
      </div>

      {/* Ticket lié */}
      <div className="form-group">
        <label className="label">Ticket lié (optionnel)</label>
        <select {...register('ticketId')} className="input">
          <option value="">Aucun ticket</option>
          {tickets.map(t => (
            <option key={t.id} value={t.id}>[{t.reference}] {t.title}</option>
          ))}
        </select>
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-3 pt-2 sticky bottom-0 bg-white pb-1">
        <button type="button" className="btn-secondary" onClick={onCancel}>Annuler</button>
        <button type="submit" className="btn-primary" disabled={isSubmitting || isPending}>
          {isSubmitting || isPending ? 'Enregistrement...' : submitLabel}
        </button>
      </div>
    </form>
  )
}

// ── MultiSelect helper ────────────────────────────────────────────────────────

function MultiSelectField({
  options,
  value,
  onChange,
  placeholder,
}: {
  options: { value: string; label: string }[]
  value: string[]
  onChange: (v: string[]) => void
  placeholder: string
}) {
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)

  const filtered = options.filter(
    o => o.label.toLowerCase().includes(search.toLowerCase()) && !value.includes(o.value)
  )

  const remove = (v: string) => onChange(value.filter(id => id !== v))
  const add    = (v: string) => { onChange([...value, v]); setSearch('') }

  const selectedLabels = value.map(v => options.find(o => o.value === v)?.label ?? v)

  return (
    <div className="relative">
      {/* Selected tags */}
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-1.5">
          {value.map((v, i) => (
            <span key={v} className="inline-flex items-center gap-1 px-2 py-0.5 bg-primary-50 text-primary-700 rounded text-xs font-medium">
              {selectedLabels[i]}
              <button type="button" onClick={() => remove(v)} className="hover:text-primary-900">
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Search input */}
      <div className="relative">
        <input
          type="text"
          className="input text-sm"
          placeholder={placeholder}
          value={search}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onChange={e => { setSearch(e.target.value); setOpen(true) }}
        />
      </div>

      {/* Dropdown */}
      {open && filtered.length > 0 && (
        <div className="absolute z-10 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-40 overflow-y-auto">
          {filtered.map(o => (
            <button
              key={o.value}
              type="button"
              className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 text-slate-700"
              onMouseDown={() => add(o.value)}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
