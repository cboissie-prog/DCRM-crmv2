import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import api from '../../lib/api'
import { formatCurrency, formatRelative, PIPELINE_STAGES, ACTIVITY_TYPES } from '../../lib/utils'
import { PageSpinner } from '../../components/ui/Spinner'
import { Badge } from '../../components/ui/Badge'
import { Avatar } from '../../components/ui/Avatar'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area, Cell } from 'recharts'
import { Users, Building2, Wrench, FileText, TrendingUp, AlertTriangle, Euro, ArrowUp, ArrowDown, Minus, Clock, Key, Shield, ChevronRight, CalendarDays, CheckCircle2, MapPin } from 'lucide-react'
import type { DashboardStats } from '../../types'

function KpiCard({ icon, label, value, sub, trend }: {
  icon: React.ReactNode; label: string; value: string; sub?: string; trend?: { value: number; label: string }
}) {
  const trendSign = trend ? (trend.value > 0 ? 'positive' : trend.value < 0 ? 'negative' : 'neutral') : null
  return (
    <div className="kpi-card">
      <div className="flex items-start justify-between">
        <div className="w-10 h-10 rounded-xl bg-primary-50 flex items-center justify-center text-primary-600">
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

// ── Helpers ───────────────────────────────────────────────────────────────────

const PRIORITY_CONFIG: Record<string, { label: string; className: string }> = {
  LOW:      { label: 'Basse',    className: 'bg-slate-100 text-slate-500' },
  MEDIUM:   { label: 'Moyenne',  className: 'bg-blue-100 text-blue-600' },
  HIGH:     { label: 'Haute',    className: 'bg-amber-100 text-amber-700' },
  CRITICAL: { label: 'Critique', className: 'bg-red-100 text-red-600' },
}

const APPT_TYPE_COLORS: Record<string, string> = {
  CLIENT_MEETING: 'bg-blue-500',
  INTERVENTION:   'bg-violet-500',
  CALL:           'bg-emerald-500',
  TRAINING:       'bg-amber-500',
  DELIVERY:       'bg-indigo-500',
  OTHER:          'bg-slate-400',
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
              <div className={`w-1 self-stretch rounded-full flex-shrink-0 ${APPT_TYPE_COLORS[a.type] ?? 'bg-slate-400'}`} />
              <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
                <CalendarDays className="w-4 h-4 text-blue-500" />
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
            const p = PRIORITY_CONFIG[t.priority] ?? PRIORITY_CONFIG.MEDIUM
            return (
              <Link key={t.id} to={`/tickets/${t.id}`} className="flex items-start gap-3 px-4 py-3 hover:bg-slate-50 transition-colors group">
                <div className="w-1 self-stretch rounded-full flex-shrink-0 bg-amber-400" />
                <div className="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center flex-shrink-0">
                  <Wrench className="w-4 h-4 text-amber-500" />
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
      <div>
        <h1 className="page-title">Tableau de bord</h1>
        <p className="page-subtitle">Vue d'ensemble de votre activité</p>
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
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          icon={<Euro className="w-5 h-5" />}
          label="CA ce mois"
          value={formatCurrency(stats.opportunities.wonValueThisMonth)}
          sub="Opportunités gagnées"
          trend={{ value: wonVariation, label: 'vs mois dernier' }}
        />
        <KpiCard
          icon={<TrendingUp className="w-5 h-5" />}
          label="Pipeline commercial"
          value={formatCurrency(stats.opportunities.pipelineValue)}
          sub={`${stats.opportunities.open} opportunité(s) en cours`}
        />
        <KpiCard
          icon={<FileText className="w-5 h-5" />}
          label="MRR"
          value={formatCurrency(stats.mrr)}
          sub={`ARR : ${formatCurrency(stats.arr)}`}
        />
        <KpiCard
          icon={<Wrench className="w-5 h-5" />}
          label="Tickets ouverts"
          value={String(stats.tickets.open)}
          sub={`${stats.tickets.critical} critique(s)`}
        />
      </div>

      {/* KPIs row 2 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard icon={<Users className="w-5 h-5" />} label="Contacts" value={String(stats.contacts.total)} sub={`+${stats.contacts.newThisMonth} ce mois`} />
        <KpiCard icon={<Building2 className="w-5 h-5" />} label="Entreprises" value={String(stats.companies.total)} />
        <KpiCard icon={<Shield className="w-5 h-5" />} label="Contrats actifs" value={String(stats.contracts.active)} sub={`${stats.contracts.expiringSoon} expirent bientôt`} />
        <KpiCard icon={<Clock className="w-5 h-5" />} label="Tickets ce mois" value={String(stats.tickets.newThisMonth)} sub="Nouveaux tickets" />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Revenue chart */}
        <div className="lg:col-span-2 card">
          <div className="card-header">
            <h3 className="font-semibold text-slate-900">Chiffre d'affaires — 12 derniers mois</h3>
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
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
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
      </div>
    </div>
  )
}
