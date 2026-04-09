import { useQuery } from '@tanstack/react-query'
import api from '../../lib/api'
import { formatDate } from '../../lib/utils'
import { Badge } from '../../components/ui/Badge'
import { PageSpinner } from '../../components/ui/Spinner'
import { useAuthStore } from '../../store/authStore'
import { ThumbsUp, ThumbsDown, Minus, MessageSquare } from 'lucide-react'
import { cn } from '../../lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

interface NpsResponse {
  id: string
  score: number
  comment?: string
  createdAt: string
  contact?: { id: string; firstName: string; lastName: string }
  company?: { id: string; name: string }
}

interface NpsData {
  average: number
  total: number
  promoters: number
  passives: number
  detractors: number
  responses: NpsResponse[]
}

interface NpsApiResponse {
  success: boolean
  data: NpsData
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getNpsScoreBadgeVariant(score: number): string {
  if (score >= 9) return 'badge-green'
  if (score >= 7) return 'badge-yellow'
  return 'badge-red'
}

function getNpsScoreLabel(score: number): string {
  if (score >= 9) return 'Promoteur'
  if (score >= 7) return 'Passif'
  return 'Détracteur'
}

function getNpsScoreColor(nps: number): string {
  if (nps > 50) return 'text-emerald-600'
  if (nps >= 0) return 'text-amber-500'
  return 'text-red-500'
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function NpsPage() {
  const user = useAuthStore(s => s.user)
  const canView = ['ADMIN', 'MANAGER'].includes(user?.role ?? '')

  const { data, isLoading } = useQuery<NpsApiResponse>({
    queryKey: ['nps'],
    queryFn: async () => {
      const { data } = await api.get('/dashboard/nps')
      return data
    },
    staleTime: 60_000,
    enabled: canView,
  })

  // ── Access control ─────────────────────────────────────────────────────────

  if (!canView) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <ThumbsDown className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <h2 className="text-lg font-semibold text-slate-700">Accès refusé</h2>
          <p className="text-slate-400 mt-1">Vous n'avez pas les droits pour consulter cette page.</p>
        </div>
      </div>
    )
  }

  if (isLoading) return <PageSpinner />

  const nps = data?.data

  // Computed NPS score: % promoters - % detractors
  const total = nps?.total ?? 0
  const promoters = nps?.promoters ?? 0
  const passives = nps?.passives ?? 0
  const detractors = nps?.detractors ?? 0

  const npsScore = total > 0
    ? Math.round(((promoters - detractors) / total) * 100)
    : 0

  const promotersPct = total > 0 ? Math.round((promoters / total) * 100) : 0
  const passivesPct = total > 0 ? Math.round((passives / total) * 100) : 0
  const detractorsPct = total > 0 ? Math.round((detractors / total) * 100) : 0

  const responses = nps?.responses ?? []
  const sortedResponses = [...responses].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  )

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6 fade-in">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">NPS & Satisfaction client</h1>
          <p className="page-subtitle">{total} réponse{total !== 1 ? 's' : ''} collectée{total !== 1 ? 's' : ''}</p>
        </div>
      </div>

      {/* NPS Dashboard */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-5">
        {/* Main NPS Score */}
        <div className="card flex flex-col items-center justify-center py-8 md:col-span-1">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
            Score NPS
          </p>
          <p className={cn('text-6xl font-bold tabular-nums', getNpsScoreColor(npsScore))}>
            {total > 0 ? (npsScore > 0 ? `+${npsScore}` : npsScore) : '—'}
          </p>
          <p className="text-xs text-slate-400 mt-2">% promoteurs − % détracteurs</p>
        </div>

        {/* KPI Cards */}
        <div className="card flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center shrink-0">
            <ThumbsUp className="w-5 h-5 text-emerald-600" />
          </div>
          <div>
            <p className="text-2xl font-bold text-slate-900">{promoters}</p>
            <p className="text-sm text-slate-500">Promoteurs</p>
            <p className="text-xs text-emerald-600 font-medium">{promotersPct}% · scores 9–10</p>
          </div>
        </div>

        <div className="card flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center shrink-0">
            <Minus className="w-5 h-5 text-amber-500" />
          </div>
          <div>
            <p className="text-2xl font-bold text-slate-900">{passives}</p>
            <p className="text-sm text-slate-500">Passifs</p>
            <p className="text-xs text-amber-500 font-medium">{passivesPct}% · scores 7–8</p>
          </div>
        </div>

        <div className="card flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center shrink-0">
            <ThumbsDown className="w-5 h-5 text-red-500" />
          </div>
          <div>
            <p className="text-2xl font-bold text-slate-900">{detractors}</p>
            <p className="text-sm text-slate-500">Détracteurs</p>
            <p className="text-xs text-red-500 font-medium">{detractorsPct}% · scores 0–6</p>
          </div>
        </div>
      </div>

      {/* Progress bar */}
      {total > 0 && (
        <div className="card">
          <p className="text-sm font-medium text-slate-700 mb-3">Répartition des réponses</p>
          <div className="flex h-4 rounded-full overflow-hidden gap-0.5">
            {promotersPct > 0 && (
              <div
                className="bg-emerald-500 transition-all"
                style={{ width: `${promotersPct}%` }}
                title={`Promoteurs : ${promotersPct}%`}
              />
            )}
            {passivesPct > 0 && (
              <div
                className="bg-amber-400 transition-all"
                style={{ width: `${passivesPct}%` }}
                title={`Passifs : ${passivesPct}%`}
              />
            )}
            {detractorsPct > 0 && (
              <div
                className="bg-red-400 transition-all"
                style={{ width: `${detractorsPct}%` }}
                title={`Détracteurs : ${detractorsPct}%`}
              />
            )}
          </div>
          <div className="flex justify-between text-xs text-slate-400 mt-2">
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" />
              Promoteurs {promotersPct}%
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-400 inline-block" />
              Passifs {passivesPct}%
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-red-400 inline-block" />
              Détracteurs {detractorsPct}%
            </span>
          </div>
        </div>
      )}

      {/* Responses list */}
      <div>
        <h2 className="text-base font-semibold text-slate-800 mb-3">
          Réponses récentes
        </h2>

        {sortedResponses.length === 0 ? (
          <div className="card text-center py-16">
            <MessageSquare className="w-10 h-10 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-500 font-medium">Aucune réponse NPS pour l'instant.</p>
            <p className="text-slate-400 text-sm mt-1">
              Les scores sont collectés automatiquement après la résolution des tickets.
            </p>
          </div>
        ) : (
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Entreprise</th>
                  <th>Contact</th>
                  <th>Score</th>
                  <th>Commentaire</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {sortedResponses.map(r => (
                  <tr key={r.id}>
                    <td className="font-medium text-slate-800">
                      {r.company?.name ?? <span className="text-slate-300">—</span>}
                    </td>
                    <td className="text-slate-600">
                      {r.contact
                        ? `${r.contact.firstName} ${r.contact.lastName}`
                        : <span className="text-slate-300">—</span>
                      }
                    </td>
                    <td>
                      <div className="flex items-center gap-2">
                        <Badge variant={getNpsScoreBadgeVariant(r.score)}>
                          {r.score}
                        </Badge>
                        <span className="text-xs text-slate-400">
                          {getNpsScoreLabel(r.score)}
                        </span>
                      </div>
                    </td>
                    <td className="text-slate-500 text-sm max-w-xs">
                      {r.comment
                        ? <span className="line-clamp-2">{r.comment}</span>
                        : <span className="text-slate-300">—</span>
                      }
                    </td>
                    <td className="text-slate-400 text-xs whitespace-nowrap">
                      {formatDate(r.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
