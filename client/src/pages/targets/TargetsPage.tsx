import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell,
} from 'recharts'
import api from '../../lib/api'
import { useAuthStore } from '../../store/authStore'
import { Modal } from '../../components/ui/Modal'
import { PageSpinner } from '../../components/ui/Spinner'
import { toast } from '../../components/ui/Toast'
import { Avatar } from '../../components/ui/Avatar'
import {
  Target, TrendingUp, Trophy, Plus, Pencil, Trash2,
  ChevronRight, CheckCircle2, Clock,
} from 'lucide-react'

// ── Types ──────────────────────────────────────────────────────────────────────

interface UserInfo { id: string; firstName: string; lastName: string; avatar?: string; role: string }

interface SalesTarget {
  id:             string
  userId:         string
  user:           UserInfo
  period:         string
  target:         number
  /** CA réalisé, calculé côté serveur depuis les opportunités gagnées de la période */
  computedActual: number
  createdAt:      string
}

interface ForecastSummary {
  weightedTotal: number
  rawTotal:      number
  wonTotal:      number
  count:         number
}

interface ForecastByStage {
  stage:         string
  stageName:     string
  stageColor:    string
  count:         number
  rawValue:      number
  weightedValue: number
  avgProba:      number
}

interface PipelineInfo { id: string; name: string; color: string; isDefault: boolean }

interface PerfData {
  user:         UserInfo
  wonCount:     number
  wonValue:     number
  lostCount:    number
  activeCount:  number
  createdCount: number
  winRate:      number
  avgDeal:      number
}

interface ForecastByUser {
  userId:        string
  firstName:     string
  lastName:      string
  avatar?:       string | null
  count:         number
  rawValue:      number
  weightedValue: number
  wonValue:      number
}

interface TopOpp {
  id:                string
  title:             string
  value:             number
  probability:       number
  weighted:          number
  stage:             string
  expectedCloseDate: string | null
  assignedTo:        { firstName: string; lastName: string } | null
  company:           { id: string; name: string } | null
}

interface ForecastData {
  period:           string
  summary:          ForecastSummary
  byStage:          ForecastByStage[]
  byUser:           ForecastByUser[]
  topOpportunities: TopOpp[]
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function currentPeriod() {
  const now = new Date()
  return `${now.getFullYear()}-Q${Math.floor(now.getMonth() / 3) + 1}`
}

function periodOptions() {
  const year = new Date().getFullYear()
  const opts = []
  for (const y of [year, year - 1]) {
    for (const q of [1, 2, 3, 4]) opts.push(`${y}-Q${q}`)
  }
  return opts
}

function periodLabel(p: string) {
  const [year, q] = p.split('-Q')
  const labels: Record<string, string> = { '1': 'T1', '2': 'T2', '3': 'T3', '4': 'T4' }
  return `${labels[q] ?? q} ${year}`
}

const fmt = (n: number) =>
  n >= 1000 ? `${(n / 1000).toFixed(1).replace('.0', '')} k€` : `${n} €`

// ── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color: string }) {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${color}`}>{value}</p>
      {sub && <p className="text-xs text-slate-400 mt-1">{sub}</p>}
    </div>
  )
}

// ── Progress bar ──────────────────────────────────────────────────────────────

function ProgressBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min(100, Math.round(value / max * 100)) : 0
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
        <div
          className={`h-2 rounded-full transition-all ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs font-semibold text-slate-600 w-10 text-right">{pct}%</span>
    </div>
  )
}

// ── Target form modal ─────────────────────────────────────────────────────────

interface TargetFormProps {
  users:     UserInfo[]
  period:    string
  editing:   SalesTarget | null
  onClose:   () => void
  onSaved:   () => void
}

function TargetFormModal({ users, period, editing, onClose, onSaved }: TargetFormProps) {
  const [userId, setUserId]   = useState(editing?.userId ?? '')
  const [target, setTarget]   = useState(editing?.target.toString() ?? '')
  const [loading, setLoading] = useState(false)

  const onSubmit = async () => {
    if (!editing && !userId) return
    if (!target) return
    const targetValue = parseFloat(target)
    if (isNaN(targetValue) || targetValue <= 0) {
      toast.error("L'objectif doit être un nombre positif")
      return
    }
    setLoading(true)
    try {
      if (editing) {
        await api.put(`/targets/${editing.id}`, { target: targetValue })
        toast.success('Objectif mis à jour')
      } else {
        await api.post('/targets', { userId, period, target: targetValue })
        toast.success('Objectif créé')
      }
      onSaved()
      onClose()
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: { message?: string } } } }
      const msg = axiosErr?.response?.data?.error?.message ?? 'Erreur lors de la sauvegarde'
      toast.error(msg)
    }
    finally { setLoading(false) }
  }

  return (
    <div className="space-y-4">
      {!editing && (
        <div>
          <label className="label">Commercial *</label>
          <select className="input" value={userId} onChange={e => setUserId(e.target.value)}>
            <option value="">— Choisir —</option>
            {users.map(u => (
              <option key={u.id} value={u.id}>{u.firstName} {u.lastName}</option>
            ))}
          </select>
        </div>
      )}
      <div>
        <label className="label">Objectif (€) *</label>
        <input className="input" type="number" min="0" value={target} onChange={e => setTarget(e.target.value)} placeholder="25000" />
      </div>
      <p className="text-xs text-slate-400">Période : <strong>{periodLabel(period)}</strong></p>
      <p className="text-xs text-slate-400">Le réalisé est calculé automatiquement depuis les opportunités gagnées de la période.</p>
      <div className="flex justify-end gap-3 pt-2 border-t border-slate-100">
        <button className="btn-secondary" onClick={onClose}>Annuler</button>
        <button className="btn-primary" onClick={onSubmit} disabled={loading || (!editing && !userId) || !target}>
          {loading ? 'Enregistrement…' : editing ? 'Mettre à jour' : 'Créer'}
        </button>
      </div>
    </div>
  )
}

// ── Onglet Objectifs ──────────────────────────────────────────────────────────

function ObjectifsTab({ period, isAdmin }: { period: string; isAdmin: boolean }) {
  const qc = useQueryClient()
  const [showModal,  setShowModal]  = useState(false)
  const [editing,    setEditing]    = useState<SalesTarget | null>(null)
  const [deleting,   setDeleting]   = useState<SalesTarget | null>(null)

  const { data, isLoading } = useQuery<{ data: SalesTarget[] }>({
    queryKey: ['targets', period],
    queryFn: async () => { const { data } = await api.get(`/targets?period=${period}`); return data },
    staleTime: 30_000,
  })

  const { data: usersData } = useQuery<{ data: UserInfo[] }>({
    queryKey: ['users-list'],
    queryFn: async () => { const { data } = await api.get('/users'); return data },
    enabled: isAdmin,
    staleTime: 60_000,
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/targets/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['targets'] }); setDeleting(null); toast.success('Objectif supprimé') },
    onError: () => toast.error('Erreur'),
  })

  const targets = data?.data ?? []
  const totalTarget = targets.reduce((s, t) => s + t.target, 0)
  const totalActual = targets.reduce((s, t) => s + t.computedActual, 0)
  const globalPct   = totalTarget > 0 ? Math.round(totalActual / totalTarget * 100) : 0
  const users       = (usersData?.data ?? []).filter(u => u.role !== 'TECHNICIEN')

  if (isLoading) return <PageSpinner />

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard label="Total objectif" value={fmt(totalTarget)} color="text-slate-900" />
        <StatCard label="Total réalisé"  value={fmt(totalActual)} color={globalPct >= 100 ? 'text-emerald-600' : 'text-indigo-600'} />
        <StatCard label="Atteinte globale" value={`${globalPct}%`}
          sub={globalPct >= 100 ? 'Objectif dépassé !' : undefined}
          color={globalPct >= 100 ? 'text-emerald-600' : globalPct >= 75 ? 'text-amber-600' : 'text-red-500'} />
        <StatCard label="Commerciaux" value={`${targets.length}`} sub="avec objectif" color="text-slate-900" />
      </div>

      {/* Actions */}
      {isAdmin && (
        <div className="flex justify-end">
          <button className="btn-primary flex items-center gap-2" onClick={() => { setEditing(null); setShowModal(true) }}>
            <Plus className="w-4 h-4" /> Ajouter un objectif
          </button>
        </div>
      )}

      {/* Table */}
      {targets.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <Target className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="font-medium">Aucun objectif pour {periodLabel(period)}</p>
          {isAdmin && <p className="text-sm mt-1">Cliquez sur "Ajouter un objectif" pour commencer</p>}
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-x-auto shadow-sm">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                <th className="px-5 py-3 text-left">Commercial</th>
                <th className="px-5 py-3 text-right">Objectif</th>
                <th className="px-5 py-3 text-right">Réalisé</th>
                <th className="px-5 py-3 text-left w-48">Progression</th>
                {isAdmin && <th className="px-5 py-3" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {targets.map(t => {
                const pct   = t.target > 0 ? Math.round(t.computedActual / t.target * 100) : 0
                const color = pct >= 100 ? 'bg-emerald-500' : pct >= 75 ? 'bg-amber-400' : pct >= 50 ? 'bg-indigo-500' : 'bg-slate-300'
                return (
                  <tr key={t.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <Avatar firstName={t.user.firstName} lastName={t.user.lastName} src={t.user.avatar} size="sm" />
                        <div>
                          <p className="text-sm font-medium text-slate-900">{t.user.firstName} {t.user.lastName}</p>
                          <p className="text-xs text-slate-400 capitalize">{t.user.role.toLowerCase()}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-4 text-right text-sm font-semibold text-slate-700">{fmt(t.target)}</td>
                    <td className="px-5 py-4 text-right">
                      <span className={`text-sm font-bold ${pct >= 100 ? 'text-emerald-600' : 'text-slate-900'}`}>{fmt(t.computedActual)}</span>
                    </td>
                    <td className="px-5 py-4">
                      <ProgressBar value={t.computedActual} max={t.target} color={color} />
                    </td>
                    {isAdmin && (
                      <td className="px-5 py-4">
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => { setEditing(t); setShowModal(true) }}
                            className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-indigo-600 transition-colors">
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => setDeleting(t)}
                            className="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500 transition-colors">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal create/edit */}
      <Modal
        open={showModal}
        onClose={() => { setShowModal(false); setEditing(null) }}
        title={editing ? 'Modifier l\'objectif' : 'Nouvel objectif'}
      >
        <TargetFormModal
          users={users}
          period={period}
          editing={editing}
          onClose={() => { setShowModal(false); setEditing(null) }}
          onSaved={() => qc.invalidateQueries({ queryKey: ['targets'] })}
        />
      </Modal>

      {/* Modal delete */}
      <Modal open={!!deleting} onClose={() => setDeleting(null)} title="Supprimer l'objectif">
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            Supprimer l'objectif de <strong>{deleting?.user.firstName} {deleting?.user.lastName}</strong> pour {periodLabel(period)} ?
          </p>
          <div className="flex justify-end gap-3">
            <button className="btn-secondary" onClick={() => setDeleting(null)}>Annuler</button>
            <button className="btn-danger" onClick={() => deleting && deleteMutation.mutate(deleting.id)} disabled={deleteMutation.isPending}>
              {deleteMutation.isPending ? 'Suppression…' : 'Supprimer'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

// ── Onglet Prévisions ─────────────────────────────────────────────────────────

function PrevisionsTab({ period }: { period: string }) {
  const navigate = useNavigate()
  const [pipelineId, setPipelineId] = useState('')

  const { data: pipelinesData } = useQuery<{ data: PipelineInfo[] }>({
    queryKey: ['pipelines-list'],
    queryFn: async () => { const { data } = await api.get('/pipelines'); return data },
    staleTime: 60_000,
  })
  const pipelines = pipelinesData?.data ?? []

  const { data, isLoading } = useQuery<{ data: ForecastData }>({
    queryKey: ['forecast', period, pipelineId],
    queryFn: async () => {
      const { data } = await api.get('/targets/forecast', { params: { period, pipelineId: pipelineId || undefined } })
      return data
    },
    staleTime: 30_000,
  })

  if (isLoading) return <PageSpinner />

  const forecast = data?.data
  if (!forecast) return null

  const { summary, byStage, byUser, topOpportunities } = forecast

  // Chart data — étapes réelles (nom, couleur) renvoyées par l'API
  const chartData = byStage.map(s => ({
    name: s.stageName,
    'Pipeline brut':     Math.round(s.rawValue),
    'Pipeline pondéré':  Math.round(s.weightedValue),
    color:               s.stageColor,
  }))

  return (
    <div className="space-y-6">
      {/* Filtre pipeline */}
      {pipelines.length > 1 && (
        <div className="flex justify-end">
          <select className="input w-56 text-sm" value={pipelineId} onChange={e => setPipelineId(e.target.value)}>
            <option value="">Tous les pipelines</option>
            {pipelines.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
      )}

      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard label="Pipeline pondéré"  value={fmt(summary.weightedTotal)} sub="Valeur × probabilité" color="text-indigo-600" />
        <StatCard label="Pipeline brut"     value={fmt(summary.rawTotal)}      sub={`${summary.count} opportunité${summary.count > 1 ? 's' : ''}`} color="text-slate-900" />
        <StatCard label="Gagné ce trimestre" value={fmt(summary.wonTotal)}     color="text-emerald-600" />
        <StatCard label="Total projeté"     value={fmt(summary.wonTotal + summary.weightedTotal)} sub="Gagné + pondéré" color="text-violet-600" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Chart par étape */}
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-slate-700 mb-4">Pipeline par étape</h3>
          {chartData.length === 0 ? (
            <div className="flex items-center justify-center h-40 text-slate-300 text-sm">Aucune opportunité en cours</div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={chartData} barCategoryGap="30%">
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tickFormatter={v => `${Math.round(v / 1000)}k`} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v) => [`${Number(v ?? 0).toLocaleString('fr-FR')} €`, '']} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="Pipeline brut"    fill="#e2e8f0" radius={[4,4,0,0]} />
                <Bar dataKey="Pipeline pondéré" fill="#6366f1" radius={[4,4,0,0]}>
                  {chartData.map(d => <Cell key={d.name} fill={d.color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Par commercial */}
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-slate-700 mb-4">Par commercial</h3>
          {byUser.length === 0 ? (
            <div className="flex items-center justify-center h-40 text-slate-300 text-sm">Aucune opportunité assignée</div>
          ) : (
            <div className="space-y-3">
              {byUser.map(u => (
                <div key={u.userId} className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <Avatar firstName={u.firstName} lastName={u.lastName} src={u.avatar ?? undefined} size="xs" />
                      <span className="text-sm font-medium text-slate-700 truncate">{u.firstName} {u.lastName}</span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-slate-500 flex-shrink-0">
                      {u.wonValue > 0 && (
                        <span className="flex items-center gap-1 text-emerald-600 font-medium">
                          <CheckCircle2 className="w-3 h-3" />{fmt(u.wonValue)}
                        </span>
                      )}
                      <span className="font-semibold text-indigo-600">{fmt(Math.round(u.weightedValue))}</span>
                      <span className="text-slate-300">|</span>
                      <span>{u.count} opp.</span>
                    </div>
                  </div>
                  <ProgressBar value={u.weightedValue} max={byUser[0].weightedValue} color="bg-indigo-500" />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Top opportunités */}
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
            <Trophy className="w-4 h-4 text-amber-400" />
            Meilleures chances de closing
            <span className="text-xs text-slate-400 font-normal">(probabilité ≥ 50%)</span>
          </h3>
        </div>
        {topOpportunities.length === 0 ? (
          <div className="flex items-center justify-center h-24 text-slate-400 text-sm">Aucune opportunité qualifiée</div>
        ) : (
          <div className="divide-y divide-slate-50">
            {topOpportunities.map(opp => (
              <div
                key={opp.id}
                className="flex items-center gap-4 px-5 py-3.5 hover:bg-slate-50 cursor-pointer transition-colors group"
                onClick={() => navigate('/pipeline')}
              >
                {/* Prob badge */}
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 text-sm font-bold text-white
                  ${opp.probability >= 75 ? 'bg-emerald-500' : 'bg-amber-400'}`}>
                  {opp.probability}%
                </div>

                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-800 truncate">{opp.title}</p>
                  <div className="flex items-center gap-2 mt-0.5 text-xs text-slate-400">
                    {opp.company && <span>{opp.company.name}</span>}
                    {opp.assignedTo && <><span>·</span><span>{opp.assignedTo.firstName} {opp.assignedTo.lastName}</span></>}
                    {opp.expectedCloseDate && (
                      <><span>·</span>
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {new Date(opp.expectedCloseDate).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
                      </span></>
                    )}
                  </div>
                </div>

                <div className="text-right flex-shrink-0">
                  <p className="text-sm font-bold text-indigo-600">{fmt(opp.weighted)}</p>
                  <p className="text-xs text-slate-400">{fmt(opp.value)} brut</p>
                </div>

                <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-slate-400 transition-colors flex-shrink-0" />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Onglet Performance (managers) ─────────────────────────────────────────────

function PerformanceTab({ period }: { period: string }) {
  const { data: perf = [], isLoading } = useQuery<PerfData[]>({
    queryKey: ['commercial-performance', period],
    queryFn: async () => {
      const { data } = await api.get('/targets/performance', { params: { period } })
      return data.data ?? []
    },
    staleTime: 30_000,
  })

  if (isLoading) return <PageSpinner />

  if (perf.length === 0) {
    return <div className="text-center py-16 text-slate-400">Aucune donnée pour cette période</div>
  }

  return (
    <div className="bg-white border border-slate-200 rounded-2xl overflow-x-auto shadow-sm">
      <table className="w-full">
        <thead>
          <tr className="border-b border-slate-100 bg-slate-50 text-xs font-semibold text-slate-500 uppercase tracking-wide">
            <th className="px-5 py-3 text-left">Commercial</th>
            <th className="px-5 py-3 text-right">Opps créées</th>
            <th className="px-5 py-3 text-right">Actives</th>
            <th className="px-5 py-3 text-right">Gagnées</th>
            <th className="px-5 py-3 text-right">CA gagné</th>
            <th className="px-5 py-3 text-right">Panier moyen</th>
            <th className="px-5 py-3 text-left w-40">Taux de succès</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-50">
          {perf.map(p => (
            <tr key={p.user.id} className="hover:bg-slate-50 transition-colors">
              <td className="px-5 py-4">
                <div className="flex items-center gap-3">
                  <Avatar firstName={p.user.firstName} lastName={p.user.lastName} src={p.user.avatar} size="sm" />
                  <span className="text-sm font-medium text-slate-900">{p.user.firstName} {p.user.lastName}</span>
                </div>
              </td>
              <td className="px-5 py-4 text-right text-sm text-slate-600">{p.createdCount}</td>
              <td className="px-5 py-4 text-right text-sm text-slate-600">{p.activeCount}</td>
              <td className="px-5 py-4 text-right text-sm">
                <span className="font-semibold text-emerald-700">{p.wonCount}</span>
                {p.lostCount > 0 && <span className="text-slate-400 text-xs ml-1">/ {p.lostCount} perdues</span>}
              </td>
              <td className="px-5 py-4 text-right text-sm font-semibold text-slate-900">{fmt(p.wonValue)}</td>
              <td className="px-5 py-4 text-right text-sm text-slate-600">{p.avgDeal > 0 ? fmt(Math.round(p.avgDeal)) : '—'}</td>
              <td className="px-5 py-4">
                <div className="flex items-center gap-2">
                  <div className="w-16 bg-slate-100 rounded-full h-1.5">
                    <div
                      className={`h-1.5 rounded-full ${p.winRate >= 60 ? 'bg-emerald-500' : p.winRate >= 30 ? 'bg-amber-500' : 'bg-red-400'}`}
                      style={{ width: `${p.winRate}%` }}
                    />
                  </div>
                  <span className={`text-sm font-semibold ${p.winRate >= 60 ? 'text-emerald-600' : p.winRate >= 30 ? 'text-amber-600' : 'text-red-500'}`}>
                    {p.winRate}%
                  </span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Page principale ───────────────────────────────────────────────────────────

export function TargetsPage() {
  const user    = useAuthStore(s => s.user)
  const isAdmin = user?.role === 'ADMIN' || user?.role === 'MANAGER'

  const [tab,    setTab]    = useState<'objectifs' | 'previsions' | 'performance'>('objectifs')
  const [period, setPeriod] = useState(currentPeriod)

  // Périodes fournies par l'API (8 derniers trimestres glissants), fallback local
  const { data: periodsData } = useQuery<{ data: string[] }>({
    queryKey: ['target-periods'],
    queryFn: async () => { const { data } = await api.get('/targets/periods'); return data },
    staleTime: 3_600_000,
  })
  const periods = periodsData?.data ?? periodOptions()

  return (
    <div className="space-y-6 fade-in">
      {/* Header */}
      <div className="page-header flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-100 flex items-center justify-center">
            <Target className="w-5 h-5 text-indigo-600" />
          </div>
          <div>
            <h1 className="page-title">Objectifs & Prévisions</h1>
            <p className="page-subtitle">Quotas commerciaux et pipeline pondéré</p>
          </div>
        </div>

        {/* Period selector */}
        <select
          className="input w-36 text-sm"
          value={period}
          onChange={e => setPeriod(e.target.value)}
        >
          {periods.map(p => (
            <option key={p} value={p}>{periodLabel(p)}</option>
          ))}
        </select>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-slate-100 rounded-xl w-fit">
        {[
          { key: 'objectifs' as const,   label: 'Objectifs',   icon: <Target     className="w-4 h-4" /> },
          { key: 'previsions' as const,  label: 'Prévisions',  icon: <TrendingUp className="w-4 h-4" /> },
          ...(isAdmin ? [{ key: 'performance' as const, label: 'Performance', icon: <Trophy className="w-4 h-4" /> }] : []),
        ].map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              tab === t.key
                ? 'bg-white text-indigo-700 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {t.icon}{t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'objectifs'   && <ObjectifsTab   period={period} isAdmin={isAdmin} />}
      {tab === 'previsions'  && <PrevisionsTab  period={period} />}
      {tab === 'performance' && isAdmin && <PerformanceTab period={period} />}
    </div>
  )
}
