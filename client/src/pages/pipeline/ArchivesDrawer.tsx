import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Search, ArchiveRestore } from 'lucide-react'
import { Drawer } from '../../components/ui/Drawer'
import api from '../../lib/api'
import { usePermission } from '../../hooks/usePermission'
import { toast } from '../../components/ui/Toast'
import { formatCurrency, formatDate } from '../../lib/utils'
import type { Opportunity } from '../../types'

interface ArchiveStageLite {
  key: string
  isWon: boolean
  isLost: boolean
}

interface ArchivesDrawerProps {
  open: boolean
  onClose: () => void
  /** Détermine le titre du panneau et les étapes prises en compte (won ou lost) */
  type: 'won' | 'lost'
  pipelineId: string
  stages: ArchiveStageLite[]
  /** Ouvre la modale d'édition existante pour l'opportunité choisie */
  onEditOpportunity: (opp: Opportunity) => void
}

function capitalize(label: string) {
  return label.charAt(0).toUpperCase() + label.slice(1)
}

export function ArchivesDrawer({ open, onClose, type, pipelineId, stages, onEditOpportunity }: ArchivesDrawerProps) {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const canUpdate = usePermission('pipeline:update')

  const { data: opportunities = [], isLoading } = useQuery<Opportunity[]>({
    queryKey: ['pipeline-archives-list', pipelineId, type],
    queryFn: async () => {
      const { data } = await api.get('/pipeline/opportunities', {
        params: { archived: 'only', pipelineId, limit: 200 },
      })
      return data.data ?? data
    },
    enabled: open && !!pipelineId,
    staleTime: 10_000,
  })

  const stageKeys = useMemo(
    () => stages.filter(s => (type === 'won' ? s.isWon : s.isLost)).map(s => s.key),
    [stages, type],
  )

  const filtered = useMemo(() => {
    const byStage = opportunities.filter(o => stageKeys.includes(o.stage))
    const q = search.trim().toLowerCase()
    if (!q) return byStage
    return byStage.filter(o =>
      o.title.toLowerCase().includes(q) || (o.company?.name ?? '').toLowerCase().includes(q),
    )
  }, [opportunities, stageKeys, search])

  // Groupement par mois de clôture (l'ordre d'arrivée — closedAt desc côté serveur — est préservé)
  const grouped = useMemo(() => {
    const groups: { label: string; items: Opportunity[] }[] = []
    for (const opp of filtered) {
      const label = opp.closedAt
        ? capitalize(new Date(opp.closedAt).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }))
        : 'Date de clôture inconnue'
      const existing = groups.find(g => g.label === label)
      if (existing) existing.items.push(opp)
      else groups.push({ label, items: [opp] })
    }
    return groups
  }, [filtered])

  const unarchiveMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/pipeline/opportunities/${id}/unarchive`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pipeline-opportunities'] })
      qc.invalidateQueries({ queryKey: ['pipeline-archives-count'] })
      qc.invalidateQueries({ queryKey: ['pipeline-archives-list'] })
      toast.success('Opportunité désarchivée')
    },
    onError: () => toast.error('Erreur lors du désarchivage'),
  })

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={type === 'won' ? 'Archives — Gagnées' : 'Archives — Perdues'}
    >
      <div className="p-4 space-y-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            className="input pl-9"
            placeholder="Rechercher par titre ou entreprise..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        {isLoading && <p className="text-sm text-slate-400 text-center py-6">Chargement…</p>}

        {!isLoading && grouped.length === 0 && (
          <p className="text-sm text-slate-400 text-center py-6">Aucune opportunité archivée.</p>
        )}

        {grouped.map(group => (
          <div key={group.label} className="space-y-2">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">{group.label}</p>
            <div className="space-y-2">
              {group.items.map(opp => (
                <div
                  key={opp.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => onEditOpportunity(opp)}
                  className="flex items-center justify-between gap-3 p-3 rounded-xl border border-slate-100 hover:border-primary-200 hover:bg-primary-50/40 cursor-pointer transition-colors"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-900 truncate">{opp.title}</p>
                    <p className="text-xs text-slate-500 truncate">{opp.company?.name ?? '—'}</p>
                    <p className="text-xs text-slate-400 mt-0.5">Clôturée le {formatDate(opp.closedAt)}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                    <span className="text-sm font-bold text-slate-900">
                      {formatCurrency(opp.value)} <span className="text-xs font-normal text-slate-400">HT</span>
                    </span>
                    {canUpdate && (
                      <button
                        onClick={(e) => { e.stopPropagation(); unarchiveMutation.mutate(opp.id) }}
                        disabled={unarchiveMutation.isPending}
                        className="flex items-center gap-1 text-xs font-medium text-primary-600 hover:underline disabled:opacity-50"
                      >
                        <ArchiveRestore className="w-3.5 h-3.5" /> Désarchiver
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Drawer>
  )
}
