import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import api from '../../lib/api'
import { formatRelative } from '../../lib/utils'
import { PageSpinner } from '../../components/ui/Spinner'
import { toast } from '../../components/ui/Toast'
import {
  Bell, CheckCheck, Ticket, FileText, Monitor, Key,
  TrendingUp, Zap, ThumbsUp, Star, AlertTriangle, CalendarDays, Clock, Trash2, X,
} from 'lucide-react'

interface Notification {
  id: string
  type: string
  title: string
  message: string
  link?: string
  isRead: boolean
  createdAt: string
}

const TYPE_ICON: Record<string, React.ReactNode> = {
  TICKET_ASSIGNED:       <Ticket className="w-4 h-4 text-blue-500" />,
  TICKET_URGENT:         <AlertTriangle className="w-4 h-4 text-red-500" />,
  CONTRACT_EXPIRING:     <FileText className="w-4 h-4 text-amber-500" />,
  LICENSE_EXPIRING:      <Key className="w-4 h-4 text-amber-500" />,
  WARRANTY_EXPIRING:     <Monitor className="w-4 h-4 text-amber-500" />,
  OPPORTUNITY_INACTIVE:  <TrendingUp className="w-4 h-4 text-slate-400" />,
  AUTOMATION_TRIGGERED:  <Zap className="w-4 h-4 text-violet-500" />,
  NPS_RECEIVED:          <ThumbsUp className="w-4 h-4 text-emerald-500" />,
  LEAD_SCORED:           <Star className="w-4 h-4 text-yellow-500" />,
  CHURN_RISK:            <AlertTriangle className="w-4 h-4 text-red-500" />,
  APPOINTMENT_CREATED:   <CalendarDays className="w-4 h-4 text-indigo-500" />,
  APPOINTMENT_REMINDER:  <Clock className="w-4 h-4 text-indigo-500" />,
}

export function NotificationsPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()

  const { data, isLoading } = useQuery<{ data: Notification[]; meta: { unreadCount: number } }>({
    queryKey: ['notifications'],
    queryFn: async () => { const { data } = await api.get('/notifications'); return data },
    staleTime: 20_000,
  })

  const readOneMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/notifications/${id}/read`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  })

  const readAllMutation = useMutation({
    mutationFn: () => api.patch('/notifications/read-all'),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['notifications'] }); toast.success('Toutes les notifications marquées comme lues') },
  })

  const deleteOneMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/notifications/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  })

  const deleteAllMutation = useMutation({
    mutationFn: () => api.delete('/notifications/all'),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['notifications'] }); toast.success('Notifications supprimées') },
  })

  const notifications = data?.data ?? []
  const unread = data?.meta?.unreadCount ?? 0

  const handleClick = (notif: Notification) => {
    if (!notif.isRead) readOneMutation.mutate(notif.id)
    if (notif.link) navigate(notif.link)
  }

  if (isLoading) return <PageSpinner />

  return (
    <div className="space-y-5 fade-in max-w-2xl">
      <div className="page-header">
        <div>
          <h1 className="page-title">Notifications</h1>
          <p className="page-subtitle">{unread > 0 ? `${unread} non lue${unread > 1 ? 's' : ''}` : 'Tout est lu'}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {unread > 0 && (
            <button
              className="btn-secondary flex items-center gap-1.5"
              onClick={() => readAllMutation.mutate()}
              disabled={readAllMutation.isPending}
            >
              <CheckCheck className="w-4 h-4" />
              Tout marquer comme lu
            </button>
          )}
          {notifications.length > 0 && (
            <button
              className="btn-secondary flex items-center gap-1.5 text-red-500 hover:text-red-600 hover:bg-red-50 border-red-200"
              onClick={() => deleteAllMutation.mutate()}
              disabled={deleteAllMutation.isPending}
            >
              <Trash2 className="w-4 h-4" />
              Tout supprimer
            </button>
          )}
        </div>
      </div>

      {notifications.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <Bell className="w-12 h-12 mx-auto mb-3 text-slate-200" />
          <p className="text-sm font-medium">Aucune notification</p>
        </div>
      ) : (
        <div className="card divide-y divide-slate-100">
          {notifications.map(notif => (
            <div
              key={notif.id}
              className={`group flex items-start gap-3 px-3 sm:px-5 py-4 transition-colors ${!notif.isRead ? 'bg-blue-50/40' : ''}`}
            >
              <div
                className={`flex items-start gap-4 flex-1 min-w-0 ${notif.link ? 'cursor-pointer hover:bg-slate-50' : ''}`}
                onClick={() => handleClick(notif)}
              >
                <div className="w-9 h-9 rounded-xl bg-white border border-slate-100 shadow-sm flex items-center justify-center flex-shrink-0 mt-0.5">
                  {TYPE_ICON[notif.type] ?? <Bell className="w-4 h-4 text-slate-400" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-3">
                    <p className={`text-sm ${notif.isRead ? 'text-slate-700' : 'font-semibold text-slate-900'}`}>
                      {notif.title}
                    </p>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-xs text-slate-400">{formatRelative(notif.createdAt)}</span>
                      {!notif.isRead && (
                        <span className="w-2 h-2 rounded-full bg-blue-500" />
                      )}
                    </div>
                  </div>
                  <p className="text-sm text-slate-500 mt-0.5">{notif.message}</p>
                </div>
              </div>
              <button
                onClick={() => deleteOneMutation.mutate(notif.id)}
                className="opacity-0 group-hover:opacity-100 p-1.5 rounded-md text-slate-300 hover:text-red-500 hover:bg-red-50 transition-all flex-shrink-0 mt-0.5"
                title="Supprimer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
