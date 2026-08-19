import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import api from '../../lib/api'
import { formatCurrency, formatRelative, PIPELINE_STAGES, ACTIVITY_TYPES } from '../../lib/utils'
import { PageSpinner } from '../../components/ui/Spinner'
import { Badge } from '../../components/ui/Badge'
import { Avatar } from '../../components/ui/Avatar'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area, Cell, PieChart, Pie, Legend } from 'recharts'
import { Users, Building2, Wrench, FileText, TrendingUp, AlertTriangle, Euro, ArrowUp, ArrowDown, Minus, Clock, Key, Shield, ChevronRight, CalendarDays, CheckCircle2, MapPin, ArrowRight, RefreshCw, LayoutDashboard } from 'lucide-react'
import type { DashboardStats } from '../../types'
import { moduleTheme, type ModuleKey } from '../../lib/moduleTheme'
import { PageIcon } from '../../components/ui/PageIcon'
import { useReferences } from '../../hooks/useReferences'
import { colorStyle } from '../../lib/referenceUi'

function KpiCard({ icon, label, value, sub, trend, module }: {
  icon: React.ReactNode; label: string; value: string; sub?: string
  trend?: { value: number; label: string }; module: ModuleKey
}) {
  const trendSign = trend ? (trend.value > 0 ? 'positive' : trend.value < 0 ? 'negative' : 'neutral') : null
  const theme = moduleTheme[module]
  return (
    <div className="kpi-card">
      <div className="flex items-start justify-between">
        <div className={`w-10 h-10 rounded-xl ${theme.bg} ${theme.icon} flex items-center justify-center`}>
          {icon}
        </div>
        {trend && (
          <div className={`flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full ${
            trendSign === 'positive' ? 'bg-emerald-50 text-emerald-600' :
            trendSign === 'negative' ? 'bg-red-50 text-red-600' : 'bg-slate-100 text-slate-500'
          }`}>
            {trendSign === 'positive' ? <ArrowUp className="w-3 h-3" /> : trendSign === 'negative' ? <ArrowDown className="w-3 h-3" /> : <Minus className="w-3 h-3" />}
            {Math.abs(trend.value)}%
          </div>
        )}
      </div>
      <div>
        <p className="text-2xl font-bold text-slate-900">{value}</p>
        <p className="text-sm font-medium text-slate-600 mt-0.5">{label}</p>
        {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
      </div>
    </div>
  )
}

// ── Types additionnels (KPIs / charts / alerts) ───────────────────────────────

interface KpisData {
  contactsCount: number
  openTickets: number
  pipelineWeightedValue: number
  wonThisMonth: { count: number; value: number }
}

interface ChartsData {
  pipelineByStage: { stage: string; stageName: string; count: number; value: number }[]
  ticketsByStatus: { status: string; label: string; count: number }[]
}

interface AlertsData {
  expiringContracts: {
    id: string; reference: string; title: string; endDate: string
    company: { id: string; name: string }
  }[]
  staleOpportunities: {
    id: string; title: string; stage: string; value: number; updatedAt: string
    company?: { id: string; name: string }
  }[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const TICKET_STATUS_COLORS: Record<string, string> = {
  NEW:            '#6366f1',
  IN_PROGRESS:    '#f59e0b',
  WAITING_CLIENT: '#94a3b8',
  RESOLVED:       '#10b981',
  CLOSED:         '#64748b',
}

function daysUntil(dateStr: string) {
  const diff = new Date(dateStr).getTime() - Date.now()
  return Math.ceil(diff / (1000 * 60 * 60 * 24))
}

function daysSince(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime()
  return Math.floor(diff / (1000 * 60 * 60 * 24))
}

// ── Skeletons de chargement ───────────────────────────────────────────────────

function KpiSkeleton() {
  return (
    <div className="kpi-card animate-pulse">
      <div className="w-10 h-10 rounded-xl bg-slate-200" />
      <div className="mt-3 space-y-2">
        <div className="h-7 w-24 bg-slate-200 rounded" />
        <div className="h-4 w-32 bg-slate-100 rounded" />
      </div>
    </div>
  )
}

function CardSkeleton({ height = 'h-48' }: { height?: string }) {
  return (
    <div className={`card ${height} animate-pulse`}>
      <div className="card-header">
        <div className="h-5 w-40 bg-slate-200 rounded" />
      </div>
      <div className="p-4 space-y-3">
        <div className="h-4 bg-slate-100 rounded w-full" />
        <div className="h-4 bg-slate-100 rounded w-3/4" />
        <div className="h-4 bg-slate-100 rounded w-5/6" />
      </div>
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const PRIORITY_CONFIG: Record<string, { label: string; className: string }> = {
  LOW:      { label: 'Basse',    className: 'bg-slate-100 text-slate-500' },
  NORMAL:   { label: 'Normal',   className: 'bg-blue-100 text-blue-600' },
  HIGH:     { label: 'Haute',    className: 'bg-amber-100 text-amber-700' },
  CRITICAL: { label: 'Critique', className: 'bg-red-100 text-red-600' },
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}

// ── Widget Ma journée ─────────────────────────────────────────────────────────

interface TodayData {
  appointments: {
    id: string; title: string; type: string; startAt: string; endAt: string; location?: string
    contacts: { contact: { firstName: string; lastName: string } }[]
  }[]
  urgentTickets: {
    id: string; ref: string; title: string; priority: string
    company?: { name: string }
  }[]
  overdueActivities: {
    id: string; title: string; type: string; dueDate?: string
    company?: { name: string }
    contact?: { firstName: string; lastName: string }
  }[]
}

function TodayWidget({ today }: { today?: TodayData }) {
  const refs = useReferences()
  const appts = today?.appointments ?? []
  const tickets = today?.urgentTickets ?? []
  const activities = today?.overdueActivities ?? []
  const total = appts.length + tickets.length + activities.length

  const todayLabel = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })

  return (
    <div className="card">
      <div className="card-header">
        <div className="flex items-center gap-2">
          <CalendarDays className="w-4 h-4 text-primary-500" />
          <h3 className="font-semibold text-slate-900">Ma journée</h3>
          <span className="text-xs text-slate-400 capitalize">{todayLabel}</span>
        </div>
        {total === 0 && (
          <span className="text-xs text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full font-medium flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3" /> Rien de prévu
          </span>
        )}
      </div>

      {total === 0 ? (
        <div className="py-8 text-center text-sm text-slate-400">
          Profitez de cette journée calme !
        </div>
      ) : (
        <div className="divide-y divide-slate-100">

          {/* RDV du jour */}
          {appts.map(a => (
            <Link key={a.id} to="/appointments" className="flex items-start gap-3 px-4 py-3 hover:bg-slate-50 transition-colors group">
              <div className={`w-1 self-stretch rounded-full flex-shrink-0 ${colorStyle(refs.color('appointment_type', a.type)).bar}`} />
              <div className="w-8 h-8 rounded-lg bg-module-agenda-50 flex items-center justify-center flex-shrink-0">
                <CalendarDays className="w-4 h-4 text-module-agenda-600" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-900 truncate">{a.title}</p>
                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                  <span className="text-xs font-medium text-primary-600">
                    {fmtTime(a.startAt)} – {fmtTime(a.endAt)}
                  </span>
                  {a.location && (
                    <span className="flex items-center gap-0.5 text-xs text-slate-400">
                      <MapPin className="w-3 h-3" />{a.location}
                    </span>
                  )}
                  {a.contacts.length > 0 && (
                    <span className="text-xs text-slate-400">
                      {a.contacts.map(c => `${c.contact.firstName} ${c.contact.lastName}`).join(', ')}
                    </span>
                  )}
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-slate-500 flex-shrink-0 mt-1" />
            </Link>
          ))}

          {/* Tickets urgents */}
          {tickets.map(t => {
            const p = PRIORITY_CONFIG[t.priority] ?? PRIORITY_CONFIG.NORMAL
            return (
              <Link key={t.id} to={`/tickets/${t.id}`} className="flex items-start gap-3 px-4 py-3 hover:bg-slate-50 transition-colors group">
                <div className="w-1 self-stretch rounded-full flex-shrink-0 bg-module-tickets-400" />
                <div className="w-8 h-8 rounded-lg bg-module-tickets-50 flex items-center justify-center flex-shrink-0">
                  <Wrench className="w-4 h-4 text-module-tickets-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-900 truncate">{t.title}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-xs text-slate-400">{t.ref}</span>
                    {t.company && <span className="text-xs text-slate-400">{t.company.name}</span>}
                    <span className={`text-xs font-semibold px-1.5 py-0.5 rounded-full ${p.className}`}>{p.label}</span>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-slate-500 flex-shrink-0 mt-1" />
              </Link>
            )
          })}

          {/* Activités à faire */}
          {activities.map(a => {
            const isOverdue = a.dueDate && new Date(a.dueDate) < new Date(new Date().setHours(0, 0, 0, 0))
            return (
              <Link key={a.id} to="/activities" className="flex items-start gap-3 px-4 py-3 hover:bg-slate-50 transition-colors group">
                <div className={`w-1 self-stretch rounded-full flex-shrink-0 ${isOverdue ? 'bg-red-400' : 'bg-slate-300'}`} />
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${isOverdue ? 'bg-red-50' : 'bg-slate-100'}`}>
                  <Clock className={`w-4 h-4 ${isOverdue ? 'text-red-500' : 'text-slate-400'}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-900 truncate">{a.title}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    {a.dueDate && (
                      <span className={`text-xs font-medium ${isOverdue ? 'text-red-500' : 'text-slate-500'}`}>
                        {isOverdue ? 'En retard — ' : ''}
                        {new Date(a.dueDate).toLocaleDateString('fr-FR')}
                      </span>
                    )}
                    {a.company && <span className="text-xs text-slate-400">{a.company.name}</span>}
                    {a.contact && <span className="text-xs text-slate-400">{a.contact.firstName} {a.contact.lastName}</span>}
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-slate-500 flex-shrink-0 mt-1" />
              </Link>
            )
          })}

        </div>
      )}
    </div>
  )
}

const STAGE_COLORS: Record<string, string> = {
  NEW: '#94a3b8', QUALIFICATION: '#60a5fa', PROPOSAL: '#a78bfa', NEGOTIATION: '#fb923c', WON: '#34d399', LOST: '#f87171'
}

// ── Donut Tickets par statut ──────────────────────────────────────────────────

function TicketsPieChart({ data, isLoading }: { data?: ChartsData['ticketsByStatus']; isLoading: boolean }) {
  if (isLoading) return <CardSkeleton height="h-80" />
  const chartData = (data ?? []).map(d => ({
    name: d.label,
    value: d.count,
    fill: TICKET_STATUS_COLORS[d.status] ?? '#94a3b8',
  }))
  const total = chartData.reduce((s, d) => s + d.value, 0)

  return (
    <div className="card">
      <div className="card-header">
        <h3 className="font-semibold text-slate-900">Tickets par statut</h3>
        <span className="text-xs text-slate-400">{total} au total</span>
      </div>
      <div className="p-4">
        {chartData.length === 0 ? (
          <div className="h-48 flex items-center justify-center text-sm text-slate-400">Aucun ticket</div>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie data={chartData} cx="50%" cy="50%" innerRadius={55} outerRadius={85} paddingAngle={3} dataKey="value">
                {chartData.map((entry, i) => (
                  <Cell key={i} fill={entry.fill} />
                ))}
              </Pie>
              <Tooltip formatter={(val, name) => [val, name]} />
              <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
            </PieChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}

// ── Alertes détaillées (contrats expirants + opportunités inactives) ──────────

function AlertsSection({ alerts, isLoading }: { alerts?: AlertsData; isLoading: boolean }) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <CardSkeleton height="h-56" />
        <CardSkeleton height="h-56" />
      </div>
    )
  }

  const contracts = alerts?.expiringContracts ?? []
  const opps      = alerts?.staleOpportunities ?? []

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Contrats expirant */}
      <div className="card">
        <div className="card-header">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-amber-500" />
            <h3 className="font-semibold text-slate-900">Contrats expirant bientôt</h3>
          </div>
          <Link to="/contracts" className="text-xs text-primary-600 hover:underline flex items-center gap-0.5">
            Voir tout <ArrowRight className="w-3 h-3" />
          </Link>
        </div>
        {contracts.length === 0 ? (
          <div className="py-8 text-center text-sm text-slate-400">
            <CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-emerald-400" />
            Aucun contrat n'expire dans les 60 prochains jours
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {contracts.map(c => {
              const days = daysUntil(c.endDate)
              const urgent = days <= 14
              return (
                <Link key={c.id} to="/contracts" className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 transition-colors group">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                    urgent ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-600'
                  }`}>
                    {days}j
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-900 truncate">{c.title}</p>
                    <p className="text-xs text-slate-400">
                      {c.company.name} · expire le {new Date(c.endDate).toLocaleDateString('fr-FR')}
                    </p>
                  </div>
                  <Badge variant={urgent ? 'badge-red' : 'badge-yellow'}>
                    {urgent ? 'Urgent' : 'Bientôt'}
                  </Badge>
                </Link>
              )
            })}
          </div>
        )}
      </div>

      {/* Opportunités sans activité */}
      <div className="card">
        <div className="card-header">
          <div className="flex items-center gap-2">
            <RefreshCw className="w-4 h-4 text-slate-400" />
            <h3 className="font-semibold text-slate-900">Opportunités sans activité (+14j)</h3>
          </div>
          <Link to="/pipeline" className="text-xs text-primary-600 hover:underline flex items-center gap-0.5">
            Voir pipeline <ArrowRight className="w-3 h-3" />
          </Link>
        </div>
        {opps.length === 0 ? (
          <div className="py-8 text-center text-sm text-slate-400">
            <CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-emerald-400" />
            Toutes les opportunités sont à jour
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {opps.map(o => {
              const days = daysSince(o.updatedAt)
              return (
                <Link key={o.id} to="/pipeline" className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 transition-colors group">
                  <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center text-xs font-bold text-slate-500 flex-shrink-0">
                    {days}j
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-900 truncate">{o.title}</p>
                    <p className="text-xs text-slate-400">
                      {o.company?.name ?? 'Sans entreprise'} · {formatCurrency(o.value)} HT
                    </p>
                  </div>
                  <span className="text-xs text-slate-400 flex-shrink-0">
                    {formatRelative(o.updatedAt)}
                  </span>
                </Link>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

export function DashboardPage() {
  const { data: stats, isLoading } = useQuery<DashboardStats>({
    queryKey: ['dashboard-stats'],
    queryFn: async () => { const { data } = await api.get('/dashboard/stats'); return data.data },
    refetchInterval: 60_000,
  })

  const { data: revenueData } = useQuery({
    queryKey: ['dashboard-revenue'],
    queryFn: async () => { const { data } = await api.get('/dashboard/revenue'); return data.data },
    staleTime: 5 * 60_000,
  })

  const { data: churnRisks } = useQuery({
    queryKey: ['churn-risks'],
    queryFn: async () => { const { data } = await api.get('/dashboard/churn-risks'); return data.data },
    staleTime: 5 * 60_000,
  })

  const { data: today } = useQuery({
    queryKey: ['dashboard-today'],
    queryFn: async () => { const { data } = await api.get('/dashboard/today'); return data.data },
    refetchInterval: 60_000,
    staleTime: 30_000,
  })

  const { data: kpis, isLoading: kpisLoading } = useQuery<KpisData>({
    queryKey: ['dashboard-kpis'],
    queryFn: async () => { const { data } = await api.get('/dashboard/kpis'); return data.data },
    refetchInterval: 60_000,
  })

  const { data: charts, isLoading: chartsLoading } = useQuery<ChartsData>({
    queryKey: ['dashboard-charts'],
    queryFn: async () => { const { data } = await api.get('/dashboard/charts'); return data.data },
    refetchInterval: 5 * 60_000,
    staleTime: 2 * 60_000,
  })

  const { data: alerts, isLoading: alertsLoading } = useQuery<AlertsData>({
    queryKey: ['dashboard-alerts'],
    queryFn: async () => { const { data } = await api.get('/dashboard/alerts'); return data.data },
    refetchInterval: 5 * 60_000,
    staleTime: 2 * 60_000,
  })

  if (isLoading) return <PageSpinner />
  if (!stats) return null

  const wonVariation = stats.opportunities.wonValueLastMonth > 0
    ? Math.round(((stats.opportunities.wonValueThisMonth - stats.opportunities.wonValueLastMonth) / stats.opportunities.wonValueLastMonth) * 100)
    : 0

  const pipelineData = Object.entries(PIPELINE_STAGES)
    .filter(([key]) => key !== 'WON' && key !== 'LOST')
    .map(([key, val]) => {
      const found = stats.pipeline.find(p => p.stage === key)
      return { name: val.label, value: found?._sum?.value || 0, count: found?._count?.id || 0 }
    })

  return (
    <div className="space-y-6 fade-in">
      {/* Header */}
      <div className="flex items-center gap-3">
        <PageIcon module="dashboard" icon={<LayoutDashboard className="w-5 h-5" />} />
        <div>
          <h1 className="page-title">Tableau de bord</h1>
          <p className="page-subtitle">Vue d'ensemble de votre activité</p>
        </div>
      </div>

      {/* Alerts */}
      {(stats.alerts.criticalTickets > 0 || stats.alerts.contractsExpiringSoon > 0 || stats.alerts.licensesExpiringSoon > 0) && (
        <div className="flex flex-wrap gap-2">
          {stats.alerts.criticalTickets > 0 && (
            <Link
              to="/tickets?priority=CRITICAL"
              className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-2 rounded-lg hover:bg-red-100 transition-colors cursor-pointer"
            >
              <AlertTriangle className="w-4 h-4" />
              <strong>{stats.alerts.criticalTickets}</strong> ticket(s) critique(s) en cours
              <ChevronRight className="w-3.5 h-3.5 ml-1 opacity-60" />
            </Link>
          )}
          {stats.alerts.contractsExpiringSoon > 0 && (
            <Link
              to="/contracts?status=EXPIRING_SOON"
              className="flex items-center gap-2 bg-amber-50 border border-amber-200 text-amber-700 text-sm px-4 py-2 rounded-lg hover:bg-amber-100 transition-colors cursor-pointer"
            >
              <FileText className="w-4 h-4" />
              <strong>{stats.alerts.contractsExpiringSoon}</strong> contrat(s) expirant dans 60j
              <ChevronRight className="w-3.5 h-3.5 ml-1 opacity-60" />
            </Link>
          )}
          {stats.alerts.licensesExpiringSoon > 0 && (
            <Link
              to="/licenses?expiringSoon=true"
              className="flex items-center gap-2 bg-blue-50 border border-blue-200 text-blue-700 text-sm px-4 py-2 rounded-lg hover:bg-blue-100 transition-colors cursor-pointer"
            >
              <Key className="w-4 h-4" />
              <strong>{stats.alerts.licensesExpiringSoon}</strong> licence(s) expirant bientôt
              <ChevronRight className="w-3.5 h-3.5 ml-1 opacity-60" />
            </Link>
          )}
        </div>
      )}

      {/* KPIs row 1 */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <KpiCard
          module="commercial"
          icon={<Euro className="w-5 h-5" />}
          label="CA ce mois (HT)"
          value={formatCurrency(stats.opportunities.wonValueThisMonth)}
          sub="Opportunités gagnées"
          trend={{ value: wonVariation, label: 'vs mois dernier' }}
        />
        <KpiCard
          module="commercial"
          icon={<TrendingUp className="w-5 h-5" />}
          label="Pipeline commercial (HT)"
          value={formatCurrency(stats.opportunities.pipelineValue)}
          sub={`${stats.opportunities.open} opportunité(s) en cours`}
        />
        {kpisLoading ? (
          <KpiSkeleton />
        ) : (
          <KpiCard
            module="commercial"
            icon={<TrendingUp className="w-5 h-5" />}
            label="Pipeline pondéré (HT)"
            value={formatCurrency(kpis?.pipelineWeightedValue ?? 0)}
            sub="Valeur × probabilité"
          />
        )}
        <KpiCard
          module="parc"
          icon={<FileText className="w-5 h-5" />}
          label="MRR (HT)"
          value={formatCurrency(stats.mrr)}
          sub={`ARR : ${formatCurrency(stats.arr)} HT`}
        />
        <KpiCard
          module="tickets"
          icon={<Wrench className="w-5 h-5" />}
          label="Tickets ouverts"
          value={String(stats.tickets.open)}
          sub={`${stats.tickets.critical} critique(s)`}
        />
      </div>

      {/* KPIs row 2 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard module="contacts" icon={<Users className="w-5 h-5" />} label="Contacts" value={String(stats.contacts.total)} sub={`+${stats.contacts.newThisMonth} ce mois`} />
        <KpiCard module="contacts" icon={<Building2 className="w-5 h-5" />} label="Entreprises" value={String(stats.companies.total)} />
        <KpiCard module="parc" icon={<Shield className="w-5 h-5" />} label="Contrats actifs" value={String(stats.contracts.active)} sub={`${stats.contracts.expiringSoon} expirent bientôt`} />
        <KpiCard module="tickets" icon={<Clock className="w-5 h-5" />} label="Tickets ce mois" value={String(stats.tickets.newThisMonth)} sub="Nouveaux tickets" />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Revenue chart */}
        <div className="lg:col-span-2 card">
          <div className="card-header">
            <h3 className="font-semibold text-slate-900">Chiffre d'affaires HT — 12 derniers mois</h3>
          </div>
          <div className="p-4">
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={revenueData || []} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#4f46e5" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="#4f46e5" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v/1000}k€`} />
                <Tooltip formatter={(v) => [formatCurrency(v as number), 'CA']} labelStyle={{ color: '#1e293b' }} />
                <Area type="monotone" dataKey="value" stroke="#4f46e5" strokeWidth={2} fill="url(#colorRevenue)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Pipeline */}
        <div className="card">
          <div className="card-header">
            <h3 className="font-semibold text-slate-900">Pipeline par étape</h3>
          </div>
          <div className="p-4">
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={pipelineData} layout="vertical" margin={{ left: 10, right: 20 }}>
                <XAxis type="number" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v/1000}k€`} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} width={80} />
                <Tooltip formatter={(v) => [formatCurrency(v as number), 'Valeur']} />
                <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                  {pipelineData.map((_entry, i) => (
                    <Cell key={i} fill={Object.values(STAGE_COLORS)[i] || '#94a3b8'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Ma journée */}
      <TodayWidget today={today} />

      {/* Bottom row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent activities */}
        <div className="card">
          <div className="card-header">
            <h3 className="font-semibold text-slate-900">Activités récentes</h3>
          </div>
          <div className="divide-y divide-slate-100">
            {stats.recentActivities.slice(0, 7).map(act => {
              const typeInfo = ACTIVITY_TYPES[act.type] || { label: act.type, icon: 'Zap' }
              return (
                <div key={act.id} className="flex items-start gap-3 px-4 py-3">
                  <div className="w-7 h-7 bg-slate-100 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
                    <span className="text-xs text-slate-500">{typeInfo.label.slice(0, 2)}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-800 truncate">{act.title}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      {act.company && <span className="text-xs text-slate-500">{act.company.name}</span>}
                      <span className="text-xs text-slate-400">{formatRelative(act.createdAt)}</span>
                    </div>
                  </div>
                  {act.user && <Avatar firstName={act.user.firstName} lastName={act.user.lastName} size="sm" />}
                </div>
              )
            })}
          </div>
        </div>

        {/* Churn risks */}
        <div className="card">
          <div className="card-header">
            <h3 className="font-semibold text-slate-900">Alertes churn — Clients à risque</h3>
          </div>
          <div className="divide-y divide-slate-100">
            {(!churnRisks || churnRisks.length === 0) ? (
              <div className="py-8 text-center text-sm text-slate-400">Aucun client à risque</div>
            ) : churnRisks.slice(0, 6).map((risk: { company: { id: string; name: string; city?: string }; score: number; daysSinceContact: number; openTickets: number }) => (
              <div key={risk.company.id} className="flex items-center gap-3 px-4 py-3">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                  risk.score >= 60 ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-600'
                }`}>
                  {risk.score}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-800 truncate">{risk.company.name}</p>
                  <p className="text-xs text-slate-400">
                    {risk.daysSinceContact < 999 ? `Dernier contact il y a ${risk.daysSinceContact}j` : 'Jamais contacté'}
                    {risk.openTickets > 0 && ` • ${risk.openTickets} ticket(s) ouvert(s)`}
                  </p>
                </div>
                <Badge variant={risk.score >= 60 ? 'badge-red' : 'badge-yellow'}>
                  {risk.score >= 60 ? 'Élevé' : 'Modéré'}
                </Badge>
              </div>
            ))}
          </div>
        </div>

        {/* Tickets par statut */}
        <TicketsPieChart data={charts?.ticketsByStatus} isLoading={chartsLoading} />
      </div>

      {/* Alertes détaillées */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <AlertTriangle className="w-4 h-4 text-amber-500" />
          <h2 className="text-base font-semibold text-slate-800">Alertes &amp; à traiter</h2>
        </div>
        <AlertsSection alerts={alerts} isLoading={alertsLoading} />
      </div>
    </div>
  )
}
