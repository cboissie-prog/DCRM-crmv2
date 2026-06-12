import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import type { Resolver } from 'react-hook-form'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts'
import {
  TrendingUp, Trophy, Target, Plus, Pencil, Trash2,
} from 'lucide-react'
import api from '../../lib/api'
import { formatCurrency, cn } from '../../lib/utils'
import { Avatar } from '../../components/ui/Avatar'
import { Modal } from '../../components/ui/Modal'
import { PageSpinner } from '../../components/ui/Spinner'
import { toast } from '../../components/ui/Toast'
import { useAuthStore } from '../../store/authStore'

// ─── Types ────────────────────────────────────────────────────────────────────

interface SalesTarget {
  id: string
  userId: string
  period: string
  target: number
  actual: number
  computedActual: number
  user: { id: string; firstName: string; lastName: string; avatar?: string; role: string }
}

interface ForecastStage {
  stageKey: string
  stageName: string
  stageColor: string
  isWon: boolean
  isLost: boolean
  count: number
  totalValue: number
  weighted: number
  avgProba: number
}

interface ForecastData {
  pipelineId: string
  pipelineName: string
  stages: ForecastStage[]
  total: { count: number; value: number; weighted: number }
}

interface PerfData {
  user: { id: string; firstName: string; lastName: string; avatar?: string; role: string }
  wonCount: number
  wonValue: number
  lostCount: number
  activeCount: number
  createdCount: number
  winRate: number
  avgDeal: number
}

interface Pipeline { id: string; name: string; color: string; isDefault: boolean }

// ─── Schema ───────────────────────────────────────────────────────────────────

const targetSchema = z.object({
  userId: z.string().min(1, 'Commercial requis'),
  period: z.string().regex(/^\d{4}-Q[1-4]$/, 'Format: YYYY-QN (ex: 2026-Q2)'),
  target: z.coerce.number().min(0, 'Objectif invalide'),
})
type TargetForm = z.infer<typeof targetSchema>

// ─── Helpers ──────────────────────────────────────────────────────────────────

function periodLabel(period: string) {
  const m = period.match(/^(\d{4})-Q([1-4])$/)
  if (!m) return period
  const quarters = ['', '1er trim.', '2e trim.', '3e trim.', '4e trim.']
  return `${quarters[parseInt(m[2])]} ${m[1]}`
}

function ProgressBar({ value, max, color = '#4f46e5' }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0
  const isOver = max > 0 && value > max
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 bg-slate-100 rounded-full h-2 overflow-hidden">
        <div
          className="h-2 rounded-full transition-all"
          style={{ width: `${pct}%`, background: isOver ? '#10b981' : color }}
        />
      </div>
      <span className={cn('text-xs font-semibold w-10 text-right', isOver ? 'text-emerald-600' : 'text-slate-600')}>
        {pct}%
      </span>
    </div>
  )
}

// ─── Tab : Objectifs ──────────────────────────────────────────────────────────

function ObjectifsTab() {
  const qc = useQueryClient()
  const { user: me } = useAuthStore()
  const isManager = me?.role === 'ADMIN' || me?.role === 'MANAGER'

  const [selectedPeriod, setSelectedPeriod] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [editingTarget, setEditingTarget] = useState<SalesTarget | null>(null)
  const [deletingTarget, setDeletingTarget] = useState<SalesTarget | null>(null)

  const { data: periods = [] } = useQuery<string[]>({
    queryKey: ['report-periods'],
    queryFn: async () => { const { data } = await api.get('/reports/periods'); return data.data ?? [] },
    staleTime: 3_600_000,
  })

  const currentPeriod = selectedPeriod || periods[periods.length - 1] || ''

  const { data: targets = [], isLoading } = useQuery<SalesTarget[]>({
    queryKey: ['sales-targets', currentPeriod],
    queryFn: async () => {
      const { data } = await api.get('/reports/sales-targets', { params: { period: currentPeriod || undefined } })
      return data.data ?? []
    },
    enabled: !!currentPeriod,
    staleTime: 30_000,
  })

  const { data: users = [] } = useQuery<{ id: string; firstName: string; lastName: string }[]>({
    queryKey: ['users-list'],
    queryFn: async () => { const { data } = await api.get('/users'); return data.data ?? [] },
    enabled: isManager,
    staleTime: 60_000,
  })

  const createMutation = useMutation({
    mutationFn: (v: TargetForm) => api.post('/reports/sales-targets', v),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['sales-targets'] }); setShowCreate(false); toast.success('Objectif créé') },
    onError: (err: unknown) => toast.error((err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message || 'Erreur'),
  })
  const updateMutation = useMutation({
    mutationFn: ({ id, target }: { id: string; target: number }) => api.put(`/reports/sales-targets/${id}`, { target }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['sales-targets'] }); setEditingTarget(null); toast.success('Objectif modifié') },
    onError: () => toast.error('Erreur'),
  })
  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/reports/sales-targets/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['sales-targets'] }); setDeletingTarget(null); toast.success('Objectif supprimé') },
    onError: () => toast.error('Erreur'),
  })

  const form = useForm<TargetForm>({
    resolver: zodResolver(targetSchema) as Resolver<TargetForm>,
    defaultValues: { period: currentPeriod },
  })
  const editForm = useForm<{ target: number }>({ defaultValues: { target: 0 } })

  const openEdit = (t: SalesTarget) => {
    setEditingTarget(t)
    editForm.reset({ target: t.target })
  }

  // Stats globales pour la période
  const totalTarget = targets.reduce((s, t) => s + t.target, 0)
  const totalActual = targets.reduce((s, t) => s + t.computedActual, 0)

  return (
    <div className="space-y-5">
      {/* Période selector */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex flex-wrap items-center gap-2 bg-slate-100 rounded-xl p-1">
          {periods.map(p => (
            <button
              key={p}
              onClick={() => setSelectedPeriod(p)}
              className={cn(
                'px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
                currentPeriod === p ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700',
              )}
            >
              {periodLabel(p)}
            </button>
          ))}
        </div>
        {isManager && (
          <button className="btn-primary" onClick={() => { form.reset({ period: currentPeriod }); setShowCreate(true) }}>
            <Plus className="w-4 h-4" /> Nouvel objectif
          </button>
        )}
      </div>

      {/* KPIs globaux */}
      {targets.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-white rounded-2xl border border-slate-200 p-4">
            <p className="text-xs text-slate-500 mb-1">Objectif total</p>
            <p className="text-xl font-bold text-slate-900">{formatCurrency(totalTarget)}</p>
          </div>
          <div className="bg-white rounded-2xl border border-slate-200 p-4">
            <p className="text-xs text-slate-500 mb-1">CA réalisé</p>
            <p className="text-xl font-bold text-slate-900">{formatCurrency(totalActual)}</p>
          </div>
          <div className="bg-white rounded-2xl border border-slate-200 p-4">
            <p className="text-xs text-slate-500 mb-2">Progression globale</p>
            <ProgressBar value={totalActual} max={totalTarget} />
          </div>
        </div>
      )}

      {/* Table */}
      {isLoading ? <PageSpinner /> : (
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Commercial</th>
                <th>Période</th>
                <th>Objectif</th>
                <th>Réalisé</th>
                <th>Progression</th>
                <th>Écart</th>
                {isManager && <th></th>}
              </tr>
            </thead>
            <tbody>
              {targets.length === 0 ? (
                <tr><td colSpan={isManager ? 7 : 6} className="text-center py-12 text-slate-400">
                  Aucun objectif défini pour cette période
                </td></tr>
              ) : targets.map(t => {
                const actual = t.computedActual
                const diff = actual - t.target
                return (
                  <tr key={t.id}>
                    <td>
                      <div className="flex items-center gap-2">
                        <Avatar firstName={t.user.firstName} lastName={t.user.lastName} size="sm" />
                        <span className="font-medium text-slate-900">{t.user.firstName} {t.user.lastName}</span>
                      </div>
                    </td>
                    <td className="text-slate-500">{periodLabel(t.period)}</td>
                    <td className="font-semibold text-slate-800">{formatCurrency(t.target)}</td>
                    <td className="font-semibold text-slate-800">{formatCurrency(actual)}</td>
                    <td className="w-48"><ProgressBar value={actual} max={t.target} /></td>
                    <td>
                      <span className={cn('text-sm font-semibold', diff >= 0 ? 'text-emerald-600' : 'text-red-500')}>
                        {diff >= 0 ? '+' : ''}{formatCurrency(diff)}
                      </span>
                    </td>
                    {isManager && (
                      <td>
                        <div className="flex items-center gap-1">
                          <button className="btn-ghost p-1.5 rounded-lg text-slate-400 hover:text-primary-600" onClick={() => openEdit(t)}>
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button className="btn-ghost p-1.5 rounded-lg text-slate-400 hover:text-red-500" onClick={() => setDeletingTarget(t)}>
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

      {/* Create modal */}
      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Nouvel objectif" size="sm">
        <form onSubmit={form.handleSubmit(v => createMutation.mutate(v))} className="space-y-4">
          <div className="form-group">
            <label className="label">Commercial *</label>
            <select {...form.register('userId')} className="input">
              <option value="">Choisir…</option>
              {users.map(u => <option key={u.id} value={u.id}>{u.firstName} {u.lastName}</option>)}
            </select>
            {form.formState.errors.userId && <p className="form-error">{form.formState.errors.userId.message}</p>}
          </div>
          <div className="form-group">
            <label className="label">Période *</label>
            <select {...form.register('period')} className="input">
              {periods.map(p => <option key={p} value={p}>{periodLabel(p)}</option>)}
            </select>
            {form.formState.errors.period && <p className="form-error">{form.formState.errors.period.message}</p>}
          </div>
          <div className="form-group">
            <label className="label">Objectif (€) *</label>
            <input {...form.register('target')} type="number" min={0} step={500} className="input" placeholder="25000" />
            {form.formState.errors.target && <p className="form-error">{form.formState.errors.target.message}</p>}
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" className="btn-secondary" onClick={() => setShowCreate(false)}>Annuler</button>
            <button type="submit" className="btn-primary" disabled={createMutation.isPending}>Créer</button>
          </div>
        </form>
      </Modal>

      {/* Edit modal */}
      <Modal open={!!editingTarget} onClose={() => setEditingTarget(null)} title="Modifier l'objectif" size="sm">
        {editingTarget && (
          <form onSubmit={editForm.handleSubmit(v => updateMutation.mutate({ id: editingTarget.id, target: v.target }))} className="space-y-4">
            <p className="text-sm text-slate-600">
              {editingTarget.user.firstName} {editingTarget.user.lastName} — {periodLabel(editingTarget.period)}
            </p>
            <div className="form-group">
              <label className="label">Objectif (€) *</label>
              <input {...editForm.register('target', { valueAsNumber: true })} type="number" min={0} step={500} className="input" />
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" className="btn-secondary" onClick={() => setEditingTarget(null)}>Annuler</button>
              <button type="submit" className="btn-primary" disabled={updateMutation.isPending}>Enregistrer</button>
            </div>
          </form>
        )}
      </Modal>

      {/* Delete confirm */}
      <Modal open={!!deletingTarget} onClose={() => setDeletingTarget(null)} title="Supprimer l'objectif" size="sm">
        <p className="text-slate-600 mb-6">Supprimer l'objectif de <strong>{deletingTarget?.user.firstName} {deletingTarget?.user.lastName}</strong> pour {deletingTarget ? periodLabel(deletingTarget.period) : ''} ?</p>
        <div className="flex justify-end gap-3">
          <button className="btn-secondary" onClick={() => setDeletingTarget(null)}>Annuler</button>
          <button className="btn-primary bg-red-600 hover:bg-red-700 focus:ring-red-500" onClick={() => deletingTarget && deleteMutation.mutate(deletingTarget.id)} disabled={deleteMutation.isPending}>Supprimer</button>
        </div>
      </Modal>
    </div>
  )
}

// ─── Tab : Prévisions pipeline ────────────────────────────────────────────────

function PrevisionTab() {
  const { data: pipelines = [] } = useQuery<Pipeline[]>({
    queryKey: ['pipelines'],
    queryFn: async () => { const { data } = await api.get('/pipelines'); return data.data ?? [] },
    staleTime: 60_000,
  })

  const [selectedPipelineId, setSelectedPipelineId] = useState('')
  const activePipeline = pipelines.find(p => p.id === selectedPipelineId) ?? pipelines.find(p => p.isDefault) ?? pipelines[0]

  const { data: forecast, isLoading } = useQuery<ForecastData>({
    queryKey: ['pipeline-forecast', activePipeline?.id],
    queryFn: async () => {
      const { data } = await api.get('/reports/pipeline-forecast', { params: { pipelineId: activePipeline?.id } })
      return data.data
    },
    enabled: !!activePipeline,
    staleTime: 30_000,
  })

  const activeStages = forecast?.stages.filter(s => !s.isWon && !s.isLost) ?? []
  const chartData = activeStages.map(s => ({ name: s.stageName, valeur: Math.round(s.totalValue), pondérée: Math.round(s.weighted), color: s.stageColor }))

  return (
    <div className="space-y-5">
      {/* Pipeline selector */}
      {pipelines.length > 1 && (
        <div className="flex items-center gap-2 bg-slate-100 rounded-xl p-1 w-fit">
          {pipelines.map(p => (
            <button
              key={p.id}
              onClick={() => setSelectedPipelineId(p.id)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
                (activePipeline?.id === p.id) ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700',
              )}
            >
              <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />
              {p.name}
            </button>
          ))}
        </div>
      )}

      {isLoading ? <PageSpinner /> : !forecast ? null : (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-white rounded-2xl border border-slate-200 p-4">
              <p className="text-xs text-slate-500 mb-1">Opportunités actives</p>
              <p className="text-2xl font-bold text-slate-900">{forecast.total.count}</p>
            </div>
            <div className="bg-white rounded-2xl border border-slate-200 p-4">
              <p className="text-xs text-slate-500 mb-1">Valeur brute pipeline</p>
              <p className="text-2xl font-bold text-slate-900">{formatCurrency(forecast.total.value)}</p>
            </div>
            <div className="bg-white rounded-2xl border border-slate-200 p-4">
              <p className="text-xs text-slate-500 mb-1">Prévision pondérée</p>
              <p className="text-2xl font-bold text-primary-700">{formatCurrency(forecast.total.weighted)}</p>
              <p className="text-xs text-slate-400 mt-0.5">valeur × probabilité</p>
            </div>
          </div>

          {/* Chart */}
          {chartData.length > 0 && (
            <div className="bg-white rounded-2xl border border-slate-200 p-5">
              <h3 className="text-sm font-semibold text-slate-900 mb-4">Valeur par étape</h3>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={chartData} margin={{ left: 10, right: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={v => `${Math.round(v / 1000)}k€`} />
                  <Tooltip formatter={(v, name) => [formatCurrency(Number(v)), name === 'valeur' ? 'Valeur brute' : 'Pondérée']} />
                  <Bar dataKey="valeur" radius={[4, 4, 0, 0]} opacity={0.4}>
                    {chartData.map((d, i) => <Cell key={i} fill={d.color} />)}
                  </Bar>
                  <Bar dataKey="pondérée" radius={[4, 4, 0, 0]}>
                    {chartData.map((d, i) => <Cell key={i} fill={d.color} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <div className="flex items-center gap-6 justify-center mt-2">
                <div className="flex items-center gap-1.5 text-xs text-slate-500"><div className="w-3 h-3 rounded-sm bg-slate-300" /> Valeur brute</div>
                <div className="flex items-center gap-1.5 text-xs text-slate-500"><div className="w-3 h-3 rounded-sm bg-primary-500" /> Pondérée</div>
              </div>
            </div>
          )}

          {/* Table par étape */}
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Étape</th>
                  <th>Nb opps</th>
                  <th>Valeur brute</th>
                  <th>Proba moy.</th>
                  <th>Prévision pondérée</th>
                </tr>
              </thead>
              <tbody>
                {forecast.stages.map(s => (
                  <tr key={s.stageKey} className={s.isWon || s.isLost ? 'opacity-60' : ''}>
                    <td>
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: s.stageColor }} />
                        <span className="font-medium text-slate-800">{s.stageName}</span>
                        {s.isWon && <span className="text-xs text-emerald-600 font-semibold">Gagné</span>}
                        {s.isLost && <span className="text-xs text-red-500 font-semibold">Perdu</span>}
                      </div>
                    </td>
                    <td className="text-slate-600">{s.count}</td>
                    <td className="font-medium text-slate-800">{formatCurrency(s.totalValue)}</td>
                    <td className="text-slate-500">{s.isWon ? '100%' : s.isLost ? '0%' : `${s.avgProba}%`}</td>
                    <td className="font-semibold text-primary-700">{formatCurrency(s.weighted)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

// ─── Tab : Performance commerciaux ───────────────────────────────────────────

function PerformanceTab() {
  const [selectedPeriod, setSelectedPeriod] = useState('')

  const { data: periods = [] } = useQuery<string[]>({
    queryKey: ['report-periods'],
    queryFn: async () => { const { data } = await api.get('/reports/periods'); return data.data ?? [] },
    staleTime: 3_600_000,
  })

  const currentPeriod = selectedPeriod || 'all'

  const { data: perf = [], isLoading } = useQuery<PerfData[]>({
    queryKey: ['commercial-performance', currentPeriod],
    queryFn: async () => {
      const { data } = await api.get('/reports/commercial-performance', {
        params: { period: currentPeriod === 'all' ? undefined : currentPeriod },
      })
      return data.data ?? []
    },
    staleTime: 30_000,
  })

  return (
    <div className="space-y-5">
      {/* Période selector */}
      <div className="flex flex-wrap items-center gap-2 bg-slate-100 rounded-xl p-1 w-fit">
        <button
          onClick={() => setSelectedPeriod('')}
          className={cn('px-3 py-1.5 rounded-lg text-sm font-medium transition-colors', currentPeriod === 'all' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700')}
        >
          Tout
        </button>
        {periods.slice(-4).map(p => (
          <button
            key={p}
            onClick={() => setSelectedPeriod(p)}
            className={cn('px-3 py-1.5 rounded-lg text-sm font-medium transition-colors', currentPeriod === p ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700')}
          >
            {periodLabel(p)}
          </button>
        ))}
      </div>

      {isLoading ? <PageSpinner /> : perf.length === 0 ? (
        <div className="text-center py-16 text-slate-400">Aucune donnée pour cette période</div>
      ) : (
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Commercial</th>
                <th>Opps créées</th>
                <th>Actives</th>
                <th>Gagnées</th>
                <th>CA gagné</th>
                <th>Panier moyen</th>
                <th>Taux de succès</th>
              </tr>
            </thead>
            <tbody>
              {perf.map(p => (
                <tr key={p.user.id}>
                  <td>
                    <div className="flex items-center gap-2">
                      <Avatar firstName={p.user.firstName} lastName={p.user.lastName} size="sm" />
                      <span className="font-medium text-slate-900">{p.user.firstName} {p.user.lastName}</span>
                    </div>
                  </td>
                  <td className="text-slate-600">{p.createdCount}</td>
                  <td className="text-slate-600">{p.activeCount}</td>
                  <td>
                    <span className="font-semibold text-emerald-700">{p.wonCount}</span>
                    {p.lostCount > 0 && <span className="text-slate-400 text-xs ml-1">/ {p.lostCount} perdues</span>}
                  </td>
                  <td className="font-semibold text-slate-900">{formatCurrency(p.wonValue)}</td>
                  <td className="text-slate-600">{p.avgDeal > 0 ? formatCurrency(p.avgDeal) : '—'}</td>
                  <td>
                    <div className="flex items-center gap-2">
                      <div className="w-16 bg-slate-100 rounded-full h-1.5">
                        <div
                          className={cn('h-1.5 rounded-full', p.winRate >= 60 ? 'bg-emerald-500' : p.winRate >= 30 ? 'bg-amber-500' : 'bg-red-400')}
                          style={{ width: `${p.winRate}%` }}
                        />
                      </div>
                      <span className={cn('text-sm font-semibold', p.winRate >= 60 ? 'text-emerald-600' : p.winRate >= 30 ? 'text-amber-600' : 'text-red-500')}>
                        {p.winRate}%
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─── Page principale ──────────────────────────────────────────────────────────

type Tab = 'objectifs' | 'previsions' | 'performance'

const TABS: { id: Tab; label: string; icon: React.ReactNode; managerOnly: boolean }[] = [
  { id: 'objectifs', label: 'Objectifs commerciaux', icon: <Target className="w-4 h-4" />, managerOnly: false },
  { id: 'previsions', label: 'Prévisions pipeline', icon: <TrendingUp className="w-4 h-4" />, managerOnly: false },
  { id: 'performance', label: 'Performance', icon: <Trophy className="w-4 h-4" />, managerOnly: true },
]

export function ReportsPage() {
  const { user } = useAuthStore()
  const isManager = user?.role === 'ADMIN' || user?.role === 'MANAGER'
  const [activeTab, setActiveTab] = useState<Tab>('objectifs')

  const visibleTabs = TABS.filter(t => !t.managerOnly || isManager)

  return (
    <div className="space-y-5 fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Rapports</h1>
          <p className="page-subtitle">Objectifs, prévisions et performance commerciale</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 bg-slate-100 rounded-xl p-1 w-fit">
        {visibleTabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors',
              activeTab === tab.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700',
            )}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {activeTab === 'objectifs' && <ObjectifsTab />}
      {activeTab === 'previsions' && <PrevisionTab />}
      {activeTab === 'performance' && isManager && <PerformanceTab />}
    </div>
  )
}
