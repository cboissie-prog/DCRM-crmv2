import { Fragment, useState } from 'react'
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
  ChevronLeft, ChevronRight, CheckCircle2, Clock, CalendarRange, Building2,
} from 'lucide-react'
import { PageIcon } from '../../components/ui/PageIcon'

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
  /** null = objectif global (tous pipelines) */
  pipelineId:     string | null
  pipeline:       { id: string; name: string; color: string } | null
  createdAt:      string
}

interface CompanyTarget {
  id:              string
  period:          string
  target:          number
  /** CA gagné par TOUS les commerciaux sur la période, calculé côté serveur */
  computedActual:  number
  /** Somme des objectifs individuels couvrant la période (sans double comptage) */
  allocatedTarget: number
  /** null = objectif global (tous pipelines) */
  pipelineId:      string | null
  pipeline:        { id: string; name: string; color: string } | null
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
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function periodOptions() {
  const year = new Date().getFullYear()
  const opts = []
  for (const y of [year - 1, year, year + 1]) {
    for (let m = 1; m <= 12; m++) opts.push(`${y}-${String(m).padStart(2, '0')}`)
  }
  return opts
}

const MONTH_LABELS = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
]

function periodLabel(p: string) {
  if (/^\d{4}$/.test(p)) return `Année ${p}`
  if (/^\d{4}-\d{2}$/.test(p)) {
    const [year, month] = p.split('-')
    return `${MONTH_LABELS[parseInt(month) - 1] ?? month} ${year}`
  }
  // Ancien format trimestriel (objectifs historiques)
  const [year, q] = p.split('-Q')
  const labels: Record<string, string> = { '1': 'T1', '2': 'T2', '3': 'T3', '4': 'T4' }
  return `${labels[q] ?? q} ${year}`
}

const fmt = (n: number) =>
  n >= 1000 ? `${(n / 1000).toFixed(1).replace('.0', '')} k€` : `${n} €`

// ── Navigation de période ─────────────────────────────────────────────────────

function PeriodNav({ periods, period, onChange }: { periods: string[]; period: string; onChange: (p: string) => void }) {
  const idx       = periods.indexOf(period)
  const current   = currentPeriod()
  const isCurrent = period === current
  // Format YYYY-MM : la comparaison lexicographique suit l'ordre chronologique
  const isFuture  = period > current
  const isPast    = period < current

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <div className="flex items-center bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <button
          onClick={() => idx > 0 && onChange(periods[idx - 1])}
          disabled={idx <= 0}
          className="px-2.5 py-2 text-slate-500 hover:bg-slate-50 hover:text-slate-700 disabled:opacity-30 disabled:hover:bg-white transition-colors"
          title="Période précédente"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <div className="flex items-center gap-2 px-4 py-2 border-x border-slate-100 min-w-[9.5rem] justify-center">
          <CalendarRange className="w-4 h-4 text-indigo-500" />
          <span className="text-sm font-semibold text-slate-800">{periodLabel(period)}</span>
        </div>
        <button
          onClick={() => idx >= 0 && idx < periods.length - 1 && onChange(periods[idx + 1])}
          disabled={idx < 0 || idx >= periods.length - 1}
          className="px-2.5 py-2 text-slate-500 hover:bg-slate-50 hover:text-slate-700 disabled:opacity-30 disabled:hover:bg-white transition-colors"
          title="Période suivante"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {isCurrent && (
        <span className="text-xs font-semibold text-indigo-600 bg-indigo-50 px-2.5 py-1 rounded-full">
          Mois en cours
        </span>
      )}
      {isFuture && (
        <span className="text-xs font-semibold text-amber-600 bg-amber-50 px-2.5 py-1 rounded-full">
          À venir
        </span>
      )}
      {!isCurrent && (
        <button
          onClick={() => onChange(current)}
          className="text-xs font-medium text-slate-400 hover:text-indigo-600 hover:underline transition-colors"
        >
          {isPast ? 'Revenir au mois en cours' : 'Mois en cours'}
        </button>
      )}
    </div>
  )
}

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
  pipelines: PipelineInfo[]
  period:    string
  editing:   SalesTarget | null
  onClose:   () => void
  onSaved:   () => void
}

function TargetFormModal({ users, pipelines, period, editing, onClose, onSaved }: TargetFormProps) {
  const [userId, setUserId]         = useState(editing?.userId ?? '')
  const [pipelineId, setPipelineId] = useState(editing?.pipelineId ?? '')
  const [target, setTarget]         = useState(editing?.target.toString() ?? '')
  const [loading, setLoading]       = useState(false)

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
        await api.put(`/targets/${editing.id}`, { target: targetValue, pipelineId: pipelineId || null })
        toast.success('Objectif mis à jour')
      } else {
        await api.post('/targets', { userId, period, target: targetValue, pipelineId: pipelineId || null })
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
        <label className="label">Pipeline</label>
        <select className="input" value={pipelineId} onChange={e => setPipelineId(e.target.value)}>
          <option value="">Global — tous les pipelines</option>
          {pipelines.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>
      <div>
        <label className="label">Objectif (€) *</label>
        <input className="input" type="number" min="0" value={target} onChange={e => setTarget(e.target.value)} placeholder="25000" />
      </div>
      <p className="text-xs text-slate-400">Période : <strong>{periodLabel(period)}</strong></p>
      <p className="text-xs text-slate-400">
        Le réalisé est calculé automatiquement depuis les opportunités gagnées de la période
        {pipelineId ? ' sur ce pipeline' : ', tous pipelines confondus'}.
      </p>
      <div className="flex justify-end gap-3 pt-2 border-t border-slate-100">
        <button className="btn-secondary" onClick={onClose}>Annuler</button>
        <button className="btn-primary" onClick={onSubmit} disabled={loading || (!editing && !userId) || !target}>
          {loading ? 'Enregistrement…' : editing ? 'Mettre à jour' : 'Créer'}
        </button>
      </div>
    </div>
  )
}

// ── Objectif d'entreprise ─────────────────────────────────────────────────────

interface CompanyTargetFormProps {
  pipelines: PipelineInfo[]
  period:    string
  editing:   CompanyTarget | null
  onClose:   () => void
  onSaved:   () => void
}

function CompanyTargetFormModal({ pipelines, period, editing, onClose, onSaved }: CompanyTargetFormProps) {
  const [pipelineId, setPipelineId] = useState(editing?.pipelineId ?? '')
  const [target, setTarget]         = useState(editing?.target.toString() ?? '')
  const [loading, setLoading]       = useState(false)

  const onSubmit = async () => {
    if (!target) return
    const targetValue = parseFloat(target)
    if (isNaN(targetValue) || targetValue <= 0) {
      toast.error("L'objectif doit être un nombre positif")
      return
    }
    setLoading(true)
    try {
      if (editing) {
        await api.put(`/targets/company/${editing.id}`, { target: targetValue, pipelineId: pipelineId || null })
        toast.success("Objectif d'entreprise mis à jour")
      } else {
        await api.post('/targets/company', { period, target: targetValue, pipelineId: pipelineId || null })
        toast.success("Objectif d'entreprise défini")
      }
      onSaved()
      onClose()
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: { message?: string } } } }
      toast.error(axiosErr?.response?.data?.error?.message ?? 'Erreur lors de la sauvegarde')
    }
    finally { setLoading(false) }
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="label">Pipeline</label>
        <select className="input" value={pipelineId} onChange={e => setPipelineId(e.target.value)}>
          <option value="">Global — tous les pipelines</option>
          {pipelines.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>
      <div>
        <label className="label">Objectif (€) *</label>
        <input className="input" type="number" min="0" value={target} onChange={e => setTarget(e.target.value)} placeholder="500000" />
      </div>
      <p className="text-xs text-slate-400">Période : <strong>{periodLabel(period)}</strong></p>
      <p className="text-xs text-slate-400">
        Le réalisé cumule les opportunités gagnées de <strong>tous les commerciaux</strong> sur la période
        {pipelineId ? ' pour ce pipeline' : ', tous pipelines confondus'}.
        La répartition compare cette cible à la somme des objectifs individuels.
      </p>
      <div className="flex justify-end gap-3 pt-2 border-t border-slate-100">
        <button className="btn-secondary" onClick={onClose}>Annuler</button>
        <button className="btn-primary" onClick={onSubmit} disabled={loading || !target}>
          {loading ? 'Enregistrement…' : editing ? 'Mettre à jour' : 'Définir'}
        </button>
      </div>
    </div>
  )
}

function CompanyTargetCard({ period, canWrite, pipelines }: { period: string; canWrite: boolean; pipelines: PipelineInfo[] }) {
  const qc = useQueryClient()
  const [showModal, setShowModal] = useState(false)
  const [editing,   setEditing]   = useState<CompanyTarget | null>(null)
  const [deleting,  setDeleting]  = useState<CompanyTarget | null>(null)

  const { data, isLoading } = useQuery<{ data: CompanyTarget[] }>({
    queryKey: ['company-targets', period],
    queryFn: async () => { const { data } = await api.get(`/targets/company?period=${period}`); return data },
    staleTime: 30_000,
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/targets/company/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['company-targets'] }); setDeleting(null); toast.success("Objectif d'entreprise supprimé") },
    onError: () => toast.error('Erreur'),
  })

  const targets    = data?.data ?? []
  const global     = targets.find(t => !t.pipelineId) ?? null
  const byPipeline = targets.filter(t => t.pipelineId)

  // Sans double comptage : la cible globale prime, sinon somme des pipelines
  const effTarget    = global ? global.target          : byPipeline.reduce((s, t) => s + t.target, 0)
  const effActual    = global ? global.computedActual  : byPipeline.reduce((s, t) => s + t.computedActual, 0)
  const effAllocated = global ? global.allocatedTarget : byPipeline.reduce((s, t) => s + t.allocatedTarget, 0)

  const pct       = effTarget > 0 ? Math.round(effActual / effTarget * 100) : 0
  const pctColor  = pct >= 100 ? 'bg-emerald-500' : pct >= 75 ? 'bg-amber-400' : pct >= 50 ? 'bg-indigo-500' : 'bg-slate-300'
  const remaining = effTarget - effAllocated

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm border-l-4 border-l-indigo-500">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 mb-4">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center flex-shrink-0">
            <Building2 className="w-4 h-4 text-indigo-600" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-800 truncate">Objectif d'entreprise</p>
            <p className="text-xs text-slate-400">{periodLabel(period)}</p>
          </div>
        </div>
        {canWrite && (
          <button
            onClick={() => { setEditing(null); setShowModal(true) }}
            className="flex items-center gap-1.5 text-xs font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 px-2.5 py-1.5 rounded-lg transition-colors flex-shrink-0"
            title="Définir un objectif d'entreprise pour cette période"
          >
            <Plus className="w-3.5 h-3.5" /> Définir
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="h-24 flex items-center justify-center text-slate-300 text-sm">Chargement…</div>
      ) : targets.length === 0 ? (
        <div className="py-6 text-center text-slate-400">
          <p className="text-sm font-medium">Aucun objectif d'entreprise pour {periodLabel(period).toLowerCase()}</p>
          {canWrite && <p className="text-xs mt-1">Cliquez sur « Définir » pour fixer le cap collectif</p>}
        </div>
      ) : (
        <div className="space-y-4">
          {/* Réalisé */}
          <div>
            <div className="flex items-baseline justify-between mb-1.5">
              <p className="text-2xl font-bold text-slate-900">
                {fmt(effActual)} <span className="text-sm font-medium text-slate-400">/ {fmt(effTarget)}</span>
              </p>
              <span className={`text-sm font-bold ${pct >= 100 ? 'text-emerald-600' : pct >= 75 ? 'text-amber-600' : 'text-indigo-600'}`}>
                {pct}%{pct >= 100 && ' 🎉'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide w-14 flex-shrink-0">Réalisé</span>
              <div className="flex-1"><ProgressBar value={effActual} max={effTarget} color={pctColor} /></div>
            </div>
          </div>

          {/* Répartition sur les commerciaux */}
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide w-14 flex-shrink-0">Réparti</span>
              <div className="flex-1"><ProgressBar value={effAllocated} max={effTarget} color="bg-violet-400" /></div>
            </div>
            <p className={`text-xs mt-1 pl-16 ${remaining > 0 ? 'text-amber-600' : 'text-slate-400'}`}>
              {fmt(effAllocated)} répartis en objectifs individuels
              {remaining > 0 && <> — <strong>{fmt(remaining)} restent à répartir</strong></>}
              {remaining === 0 && effTarget > 0 && ' — répartition complète'}
              {remaining < 0 && <> — les objectifs individuels dépassent la cible de {fmt(-remaining)}</>}
            </p>
          </div>

          {/* Détail des cibles (global + ventilation par pipeline) */}
          {(byPipeline.length > 0 || canWrite) && (
            <div className="border-t border-slate-100 pt-3 space-y-1.5">
              {targets.map(t => {
                const tPct = t.target > 0 ? Math.round(t.computedActual / t.target * 100) : 0
                return (
                  <div key={t.id} className="flex items-center gap-2 text-xs">
                    {t.pipeline ? (
                      <span className="inline-flex items-center gap-1.5 font-medium text-slate-600 bg-slate-100 px-2 py-0.5 rounded-full flex-shrink-0">
                        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: t.pipeline.color }} />
                        {t.pipeline.name}
                      </span>
                    ) : (
                      <span className="font-medium text-indigo-500 bg-indigo-50 px-2 py-0.5 rounded-full flex-shrink-0">Global</span>
                    )}
                    <span className="text-slate-500 ml-auto flex-shrink-0">
                      {fmt(t.computedActual)} / <strong className="text-slate-700">{fmt(t.target)}</strong>
                      <span className={`ml-1.5 font-semibold ${tPct >= 100 ? 'text-emerald-600' : 'text-slate-400'}`}>({tPct}%)</span>
                    </span>
                    {canWrite && (
                      <span className="flex items-center flex-shrink-0">
                        <button onClick={() => { setEditing(t); setShowModal(true) }}
                          className="p-1 rounded-md hover:bg-slate-100 text-slate-300 hover:text-indigo-600 transition-colors">
                          <Pencil className="w-3 h-3" />
                        </button>
                        <button onClick={() => setDeleting(t)}
                          className="p-1 rounded-md hover:bg-red-50 text-slate-300 hover:text-red-500 transition-colors">
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Modal create/edit */}
      <Modal
        open={showModal}
        onClose={() => { setShowModal(false); setEditing(null) }}
        title={editing ? "Modifier l'objectif d'entreprise" : "Objectif d'entreprise"}
      >
        <CompanyTargetFormModal
          pipelines={pipelines}
          period={period}
          editing={editing}
          onClose={() => { setShowModal(false); setEditing(null) }}
          onSaved={() => qc.invalidateQueries({ queryKey: ['company-targets'] })}
        />
      </Modal>

      {/* Modal delete */}
      <Modal open={!!deleting} onClose={() => setDeleting(null)} title="Supprimer l'objectif d'entreprise">
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            Supprimer l'objectif d'entreprise{deleting?.pipeline ? <> du pipeline <strong>{deleting.pipeline.name}</strong></> : ' global'} pour {periodLabel(period)} ?
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

/** Bandeau : objectif d'entreprise de la période sélectionnée + celui de l'année */
function CompanyTargetsBanner({ period, canWrite, pipelines }: { period: string; canWrite: boolean; pipelines: PipelineInfo[] }) {
  const year = period.slice(0, 4)
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <CompanyTargetCard period={period} canWrite={canWrite} pipelines={pipelines} />
      <CompanyTargetCard period={year}   canWrite={canWrite} pipelines={pipelines} />
    </div>
  )
}

// ── Onglet Objectifs ──────────────────────────────────────────────────────────

function ObjectifsTab({ period, canWrite, canReadCompany, canWriteCompany }: {
  period: string; canWrite: boolean; canReadCompany: boolean; canWriteCompany: boolean
}) {
  const qc = useQueryClient()
  const [showModal,  setShowModal]  = useState(false)
  const [editing,    setEditing]    = useState<SalesTarget | null>(null)
  const [deleting,   setDeleting]   = useState<SalesTarget | null>(null)

  const { data, isLoading } = useQuery<{ data: SalesTarget[] }>({
    queryKey: ['targets', period],
    queryFn: async () => { const { data } = await api.get(`/targets?period=${period}`); return data },
    staleTime: 30_000,
  })

  // Utilisateurs éligibles = ceux dont le rôle a la permission targets:read
  const { data: usersData } = useQuery<{ data: UserInfo[] }>({
    queryKey: ['targets-eligible-users'],
    queryFn: async () => { const { data } = await api.get('/targets/eligible-users'); return data },
    enabled: canWrite,
    staleTime: 60_000,
  })

  const { data: pipelinesData } = useQuery<{ data: PipelineInfo[] }>({
    queryKey: ['pipelines-list'],
    queryFn: async () => { const { data } = await api.get('/pipelines'); return data },
    enabled: canWrite || canWriteCompany,
    staleTime: 60_000,
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/targets/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['targets'] }); setDeleting(null); toast.success('Objectif supprimé') },
    onError: () => toast.error('Erreur'),
  })

  const targets = data?.data ?? []

  // Regroupement par commercial — sans double comptage : l'objectif global d'un
  // commercial est son quota de référence, ses objectifs par pipeline en sont la
  // ventilation. Sans objectif global, le quota effectif = somme des pipelines.
  interface UserGroup {
    user:            UserInfo
    global:          SalesTarget | null
    byPipeline:      SalesTarget[]
    effectiveTarget: number
    effectiveActual: number
  }
  const groups: UserGroup[] = []
  for (const t of targets) {
    let g = groups.find(x => x.user.id === t.userId)
    if (!g) { g = { user: t.user, global: null, byPipeline: [], effectiveTarget: 0, effectiveActual: 0 }; groups.push(g) }
    if (t.pipelineId) g.byPipeline.push(t)
    else g.global = t
  }
  for (const g of groups) {
    g.effectiveTarget = g.global ? g.global.target         : g.byPipeline.reduce((s, t) => s + t.target, 0)
    g.effectiveActual = g.global ? g.global.computedActual : g.byPipeline.reduce((s, t) => s + t.computedActual, 0)
  }

  const totalTarget = groups.reduce((s, g) => s + g.effectiveTarget, 0)
  const totalActual = groups.reduce((s, g) => s + g.effectiveActual, 0)
  const globalPct   = totalTarget > 0 ? Math.round(totalActual / totalTarget * 100) : 0
  const users       = usersData?.data ?? []

  if (isLoading) return <PageSpinner />

  return (
    <div className="space-y-6">
      {/* Objectif d'entreprise (période sélectionnée + année) */}
      {canReadCompany && (
        <CompanyTargetsBanner period={period} canWrite={canWriteCompany} pipelines={pipelinesData?.data ?? []} />
      )}

      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard label="Total objectif" value={fmt(totalTarget)} sub="sans double comptage" color="text-slate-900" />
        <StatCard label="Total réalisé"  value={fmt(totalActual)} color={globalPct >= 100 ? 'text-emerald-600' : 'text-indigo-600'} />
        <StatCard label="Atteinte globale" value={`${globalPct}%`}
          sub={globalPct >= 100 ? 'Objectif dépassé !' : undefined}
          color={globalPct >= 100 ? 'text-emerald-600' : globalPct >= 75 ? 'text-amber-600' : 'text-red-500'} />
        <StatCard label="Commerciaux" value={`${groups.length}`} sub="avec objectif" color="text-slate-900" />
      </div>

      {/* Actions */}
      {canWrite && (
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
          {canWrite && <p className="text-sm mt-1">Cliquez sur "Ajouter un objectif" pour commencer</p>}
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-x-auto shadow-sm">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                <th className="px-5 py-3 text-left">Commercial</th>
                <th className="px-5 py-3 text-left">Pipeline</th>
                <th className="px-5 py-3 text-right">Objectif</th>
                <th className="px-5 py-3 text-right">Réalisé</th>
                <th className="px-5 py-3 text-left w-48">Progression</th>
                {canWrite && <th className="px-5 py-3" />}
              </tr>
            </thead>
            <tbody>
              {groups.map((g, gi) => {
                const rows = [...(g.global ? [g.global] : []), ...g.byPipeline]
                const ventilated = g.byPipeline.reduce((s, t) => s + t.target, 0)
                const showVentilation = g.global !== null && g.byPipeline.length > 0
                const ventilPct = showVentilation && g.global!.target > 0
                  ? Math.round(ventilated / g.global!.target * 100) : 0
                return (
                  <Fragment key={g.user.id}>
                    {rows.map((t, ri) => {
                      const pct   = t.target > 0 ? Math.round(t.computedActual / t.target * 100) : 0
                      const color = pct >= 100 ? 'bg-emerald-500' : pct >= 75 ? 'bg-amber-400' : pct >= 50 ? 'bg-indigo-500' : 'bg-slate-300'
                      return (
                        <tr
                          key={t.id}
                          className={`hover:bg-slate-50 transition-colors ${ri === 0 && gi > 0 ? 'border-t border-slate-200' : ri > 0 ? 'border-t border-slate-50' : ''}`}
                        >
                          <td className="px-5 py-4">
                            {ri === 0 ? (
                              <div className="flex items-center gap-3">
                                <Avatar firstName={g.user.firstName} lastName={g.user.lastName} src={g.user.avatar} size="sm" />
                                <div>
                                  <p className="text-sm font-medium text-slate-900">{g.user.firstName} {g.user.lastName}</p>
                                  <p className="text-xs text-slate-400 capitalize">{g.user.role.toLowerCase()}</p>
                                </div>
                              </div>
                            ) : (
                              <span className="block pl-11 text-slate-300 text-xs">└</span>
                            )}
                          </td>
                          <td className="px-5 py-4">
                            {t.pipeline ? (
                              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 bg-slate-100 px-2 py-1 rounded-full">
                                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: t.pipeline.color }} />
                                {t.pipeline.name}
                              </span>
                            ) : (
                              <span className="text-xs font-medium text-indigo-500 bg-indigo-50 px-2 py-1 rounded-full">Global</span>
                            )}
                          </td>
                          <td className="px-5 py-4 text-right text-sm font-semibold text-slate-700">{fmt(t.target)}</td>
                          <td className="px-5 py-4 text-right">
                            <span className={`text-sm font-bold ${pct >= 100 ? 'text-emerald-600' : 'text-slate-900'}`}>{fmt(t.computedActual)}</span>
                          </td>
                          <td className="px-5 py-4">
                            <ProgressBar value={t.computedActual} max={t.target} color={color} />
                          </td>
                          {canWrite && (
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
                    {showVentilation && (
                      <tr className="bg-slate-50/60">
                        <td colSpan={canWrite ? 6 : 5} className="px-5 py-2">
                          <p className={`text-xs pl-11 ${ventilated > g.global!.target ? 'text-amber-600 font-medium' : 'text-slate-400'}`}>
                            Ventilation par pipeline : {fmt(ventilated)} sur un objectif global de {fmt(g.global!.target)} ({ventilPct} %)
                            {ventilated > g.global!.target && ' — la somme des pipelines dépasse l\'objectif global'}
                            {ventilated < g.global!.target && ` — ${fmt(g.global!.target - ventilated)} non ventilés`}
                          </p>
                        </td>
                      </tr>
                    )}
                  </Fragment>
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
          pipelines={pipelinesData?.data ?? []}
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
        <StatCard label="Gagné ce mois-ci"   value={fmt(summary.wonTotal)}     color="text-emerald-600" />
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
  const hasPermission = useAuthStore(s => s.hasPermission)
  const canWrite        = hasPermission('targets:write')          // attribuer/modifier des objectifs
  const canReadAll      = hasPermission('targets:read_all')       // vue équipe (Performance)
  const canReadCompany  = hasPermission('company_targets:read')   // voir l'objectif d'entreprise
  const canWriteCompany = hasPermission('company_targets:write')  // définir l'objectif d'entreprise

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
      <div className="page-header">
        <div className="flex items-center gap-3">
          <PageIcon module="commercial" icon={<Target className="w-5 h-5" />} />
          <div>
            <h1 className="page-title">Objectifs & Prévisions</h1>
            <p className="page-subtitle">Quotas commerciaux et pipeline pondéré</p>
          </div>
        </div>
      </div>

      {/* Tabs + navigation de période */}
      <div className="space-y-3">
        <div className="flex gap-1 p-1 bg-slate-100 rounded-xl w-fit">
          {[
            { key: 'objectifs' as const,   label: 'Objectifs',   icon: <Target     className="w-4 h-4" /> },
            { key: 'previsions' as const,  label: 'Prévisions',  icon: <TrendingUp className="w-4 h-4" /> },
            ...(canReadAll ? [{ key: 'performance' as const, label: 'Performance', icon: <Trophy className="w-4 h-4" /> }] : []),
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

        <PeriodNav periods={periods} period={period} onChange={setPeriod} />
      </div>

      {/* Tab content */}
      {tab === 'objectifs'   && (
        <ObjectifsTab period={period} canWrite={canWrite} canReadCompany={canReadCompany} canWriteCompany={canWriteCompany} />
      )}
      {tab === 'previsions'  && <PrevisionsTab  period={period} />}
      {tab === 'performance' && canReadAll && <PerformanceTab period={period} />}
    </div>
  )
}
