import { useRef, useState, useEffect, useCallback, useDeferredValue } from 'react'
import { Search, Bell, CheckCheck, Ticket, FileText, Monitor, Key, TrendingUp, Zap, ThumbsUp, Star, AlertTriangle, X, CalendarDays, Clock, Trash2, Building2, Users, Menu } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import api from '../../lib/api'
import { formatRelative } from '../../lib/utils'

// ── Types ──────────────────────────────────────────────────────────────────────

interface Notification {
  id: string
  type: string
  title: string
  message: string
  link?: string
  isRead: boolean
  createdAt: string
}

interface SearchResult {
  id: string
  label: string
  sub: string
  link: string
  type: 'contact' | 'company' | 'ticket' | 'opportunity'
}

interface SearchResults {
  contacts: SearchResult[]
  companies: SearchResult[]
  tickets: SearchResult[]
  opportunities: SearchResult[]
}

// ── Icon par type notif ────────────────────────────────────────────────────────

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

// ── Icon par type résultat ─────────────────────────────────────────────────────

const RESULT_ICON: Record<string, React.ReactNode> = {
  contact:     <Users className="w-3.5 h-3.5 text-blue-500" />,
  company:     <Building2 className="w-3.5 h-3.5 text-violet-500" />,
  ticket:      <Ticket className="w-3.5 h-3.5 text-amber-500" />,
  opportunity: <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />,
}

const RESULT_LABEL: Record<string, string> = {
  contact: 'Contact',
  company: 'Entreprise',
  ticket: 'Ticket',
  opportunity: 'Opportunité',
}

// ── GlobalSearch ──────────────────────────────────────────────────────────────

function GlobalSearch() {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [activeIdx, setActiveIdx] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const deferredQuery = useDeferredValue(query)

  const { data, isFetching } = useQuery<SearchResults>({
    queryKey: ['global-search', deferredQuery],
    queryFn: async () => {
      const { data } = await api.get('/search', { params: { q: deferredQuery } })
      return data.data
    },
    enabled: deferredQuery.length >= 2,
    staleTime: 10_000,
  })

  const allResults: SearchResult[] = data
    ? [...data.contacts, ...data.companies, ...data.tickets, ...data.opportunities]
    : []

  const handleSelect = useCallback((result: SearchResult) => {
    navigate(result.link)
    setQuery('')
    setOpen(false)
    setActiveIdx(-1)
    inputRef.current?.blur()
  }, [navigate])

  // Keyboard nav
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open || allResults.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIdx(i => Math.min(i + 1, allResults.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && activeIdx >= 0) {
      e.preventDefault()
      handleSelect(allResults[activeIdx])
    } else if (e.key === 'Escape') {
      setOpen(false)
      inputRef.current?.blur()
    }
  }

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (
        dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
        inputRef.current && !inputRef.current.contains(e.target as Node)
      ) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // Reset active index when results change
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setActiveIdx(-1) }, [data])

  const showDropdown = open && query.length >= 2

  const sections = data ? [
    { key: 'contacts',     label: 'Contacts',     items: data.contacts },
    { key: 'companies',    label: 'Entreprises',   items: data.companies },
    { key: 'tickets',      label: 'Tickets',       items: data.tickets },
    { key: 'opportunities', label: 'Opportunités', items: data.opportunities },
  ].filter(s => s.items.length > 0) : []

  return (
    <div className="relative flex-1 max-w-lg">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
      <input
        ref={inputRef}
        type="text"
        placeholder="Rechercher un contact, entreprise, ticket…"
        className="input pl-9 bg-slate-50 h-9 text-sm w-full"
        value={query}
        onChange={e => { setQuery(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        autoComplete="off"
      />
      {query && (
        <button
          onClick={() => { setQuery(''); setOpen(false) }}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}

      {showDropdown && (
        <div
          ref={dropdownRef}
          className="absolute top-11 left-0 w-full bg-white border border-slate-200 rounded-xl shadow-xl z-50 overflow-hidden"
        >
          {isFetching && allResults.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-slate-400">Recherche…</div>
          ) : sections.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-slate-400">Aucun résultat pour « {query} »</div>
          ) : (
            <div className="max-h-96 overflow-y-auto py-1">
              {sections.map(section => {
                return (
                  <div key={section.key}>
                    <div className="px-3 py-1.5 text-[11px] font-semibold text-slate-400 uppercase tracking-wide">
                      {section.label}
                    </div>
                    {section.items.map(result => {
                      const globalIdx = allResults.indexOf(result)
                      return (
                        <button
                          key={result.id}
                          className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors ${globalIdx === activeIdx ? 'bg-primary-50' : 'hover:bg-slate-50'}`}
                          onClick={() => handleSelect(result)}
                          onMouseEnter={() => setActiveIdx(globalIdx)}
                        >
                          <div className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0">
                            {RESULT_ICON[result.type]}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-slate-900 truncate">{result.label}</p>
                            {result.sub && <p className="text-xs text-slate-500 truncate">{result.sub}</p>}
                          </div>
                          <span className="text-[10px] text-slate-400 flex-shrink-0">{RESULT_LABEL[result.type]}</span>
                        </button>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Header ────────────────────────────────────────────────────────────────────

export function Header({ onMenuClick }: { onMenuClick: () => void }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [showPanel, setShowPanel] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)

  const { data: notifData } = useQuery({
    queryKey: ['notifications'],
    queryFn: async () => { const { data } = await api.get('/notifications'); return data },
    refetchInterval: 30_000,
    staleTime: 20_000,
  })

  const unread: number = notifData?.meta?.unreadCount || 0
  const notifications: Notification[] = notifData?.data ?? []

  const readOneMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/notifications/${id}/read`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  })

  const readAllMutation = useMutation({
    mutationFn: () => api.patch('/notifications/read-all'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  })

  const deleteOneMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/notifications/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  })

  const deleteAllMutation = useMutation({
    mutationFn: () => api.delete('/notifications/all'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  })

  // Close notif panel on outside click
  useEffect(() => {
    if (!showPanel) return
    const handler = (e: MouseEvent) => {
      if (
        panelRef.current && !panelRef.current.contains(e.target as Node) &&
        btnRef.current && !btnRef.current.contains(e.target as Node)
      ) {
        setShowPanel(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showPanel])

  const handleNotifClick = (notif: Notification) => {
    if (!notif.isRead) readOneMutation.mutate(notif.id)
    if (notif.link) navigate(notif.link)
    setShowPanel(false)
  }

  return (
    <header className="fixed top-0 left-0 lg:left-64 right-0 h-14 bg-white border-b border-slate-200 flex items-center gap-3 px-4 lg:px-6 z-[1001]">
      {/* Hamburger — mobile only */}
      <button
        onClick={onMenuClick}
        className="lg:hidden btn-ghost p-2 rounded-lg flex-shrink-0"
        aria-label="Ouvrir le menu"
      >
        <Menu className="w-5 h-5" />
      </button>
      <GlobalSearch />

      <div className="flex items-center gap-2 ml-auto relative">
        <button
          ref={btnRef}
          onClick={() => setShowPanel(v => !v)}
          className="relative btn-ghost p-2 rounded-lg"
        >
          <Bell className="w-5 h-5" />
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-red-500 text-white text-xs rounded-full flex items-center justify-center font-medium">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </button>

        {/* ── Notification panel ── */}
        {showPanel && (
          <div
            ref={panelRef}
            className="absolute right-0 top-10 w-[calc(100vw-2rem)] max-w-sm sm:max-w-96 bg-white border border-slate-200 rounded-xl shadow-xl z-50 overflow-hidden"
          >
            {/* Panel header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <Bell className="w-4 h-4 text-slate-500" />
                <span className="text-sm font-semibold text-slate-800">Notifications</span>
                {unread > 0 && (
                  <span className="px-1.5 py-0.5 bg-red-100 text-red-600 text-xs font-bold rounded-full">{unread}</span>
                )}
              </div>
              <div className="flex items-center gap-1">
                {unread > 0 && (
                  <button
                    onClick={() => readAllMutation.mutate()}
                    disabled={readAllMutation.isPending}
                    className="flex items-center gap-1 text-xs text-primary-600 hover:text-primary-700 px-2 py-1 rounded-md hover:bg-primary-50 transition-colors"
                    title="Tout marquer comme lu"
                  >
                    <CheckCheck className="w-3.5 h-3.5" />
                    Tout lire
                  </button>
                )}
                {notifications.length > 0 && (
                  <button
                    onClick={() => deleteAllMutation.mutate()}
                    disabled={deleteAllMutation.isPending}
                    className="flex items-center gap-1 text-xs text-red-500 hover:text-red-600 px-2 py-1 rounded-md hover:bg-red-50 transition-colors"
                    title="Tout supprimer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
                <button onClick={() => setShowPanel(false)} className="btn-ghost p-1 rounded-lg">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Notification list */}
            <div className="overflow-y-auto max-h-96">
              {notifications.length === 0 ? (
                <div className="py-10 text-center text-sm text-slate-400">
                  <Bell className="w-8 h-8 mx-auto mb-2 text-slate-200" />
                  Aucune notification
                </div>
              ) : (
                notifications.slice(0, 20).map(notif => (
                  <div
                    key={notif.id}
                    className={`group flex items-start gap-3 px-4 py-3 border-b border-slate-50 transition-colors hover:bg-slate-50 ${!notif.isRead ? 'bg-blue-50/40' : ''}`}
                  >
                    <div
                      className="flex items-start gap-3 flex-1 min-w-0 cursor-pointer"
                      onClick={() => handleNotifClick(notif)}
                    >
                      <div className="w-8 h-8 rounded-lg bg-white border border-slate-100 shadow-sm flex items-center justify-center flex-shrink-0 mt-0.5">
                        {TYPE_ICON[notif.type] ?? <Bell className="w-4 h-4 text-slate-400" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <p className={`text-sm leading-snug ${notif.isRead ? 'text-slate-700' : 'font-semibold text-slate-900'}`}>
                            {notif.title}
                          </p>
                          {!notif.isRead && (
                            <span className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0 mt-1.5" />
                          )}
                        </div>
                        <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{notif.message}</p>
                        <p className="text-xs text-slate-400 mt-1">{formatRelative(notif.createdAt)}</p>
                      </div>
                    </div>
                    <button
                      onClick={() => deleteOneMutation.mutate(notif.id)}
                      className="opacity-0 group-hover:opacity-100 p-1 rounded-md text-slate-300 hover:text-red-500 hover:bg-red-50 transition-all flex-shrink-0 mt-0.5"
                      title="Supprimer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))
              )}
            </div>

            {/* Panel footer */}
            {notifications.length > 0 && (
              <div className="px-4 py-2.5 border-t border-slate-100 text-center">
                <button
                  onClick={() => { navigate('/notifications'); setShowPanel(false) }}
                  className="text-xs text-primary-600 hover:text-primary-700 font-medium"
                >
                  Voir toutes les notifications ({notifications.length})
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  )
}
