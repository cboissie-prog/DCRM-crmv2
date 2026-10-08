import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Phone, Copy, Star, Bell, Target } from 'lucide-react'
import api from '../../lib/api'
import { toast } from '../../components/ui/Toast'
import { formatDateTime, cn } from '../../lib/utils'
import { PROSPECT_STATUS_CONFIG, isDueOrOverdue } from '../../lib/prospectActions'
import { ProspectActionBar } from '../../components/prospection/ProspectActionBar'
import { FollowUpDrawer } from '../../components/prospection/FollowUpDrawer'
import { QualifyModal } from '../../components/prospection/QualifyModal'
import type { Opportunity } from '../../types'

const ATTACK_PAGE = 20

function DayRow({ opp, onOpen, onQualify, onDone }: {
  opp: Opportunity
  onOpen: (id: string) => void
  onQualify: (opp: Opportunity) => void
  onDone: () => void
}) {
  const due = isDueOrOverdue(opp.remindAt)
  const status = opp.prospectStatus ?? 'TODO'
  return (
    <div className={cn('flex items-center gap-3 px-3 py-2.5 rounded-xl border', due ? 'bg-red-50 border-red-100' : 'bg-white border-slate-100')}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <button type="button" className="text-sm font-medium text-slate-900 hover:text-primary-600 hover:underline" onClick={() => onOpen(opp.id)}>
            {opp.title}
          </button>
          <span className={cn('inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border', PROSPECT_STATUS_CONFIG[status].className)}>
            {PROSPECT_STATUS_CONFIG[status].label}
          </span>
        </div>
        <div className="flex items-center gap-3 text-xs text-slate-400 flex-wrap mt-0.5">
          {opp.company && <span>{opp.company.name}</span>}
          {(opp.contact?.phone || opp.contact?.mobile) && (
            <span className="inline-flex items-center gap-1">
              <a href={`tel:${opp.contact.phone || opp.contact.mobile}`} className="flex items-center gap-1 text-primary-600 hover:underline">
                <Phone className="w-3 h-3" /> {opp.contact.phone || opp.contact.mobile}
              </a>
              <button type="button" title="Copier" className="text-slate-300 hover:text-slate-600"
                onClick={() => { navigator.clipboard?.writeText((opp.contact!.phone || opp.contact!.mobile)!).then(() => toast.success('Numéro copié')).catch(() => {}) }}>
                <Copy className="w-3 h-3" />
              </button>
            </span>
          )}
          {opp.remindAt && <span className={due ? 'text-red-600 font-medium' : ''}>{formatDateTime(opp.remindAt)}</span>}
          {opp.nextAction && <span>« {opp.nextAction} »</span>}
        </div>
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        <ProspectActionBar opportunity={opp} mode="prospect" compact onDone={onDone} />
        <button type="button" title="Qualifier" className="p-1.5 rounded-lg border border-amber-200 bg-amber-50 text-amber-600 hover:bg-amber-100" onClick={() => onQualify(opp)}>
          <Star className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  )
}

/** Onglet « Ma journée » — spec §5 : rappels du jour + jamais contactés, filtre Mes prospects. */
export function MyDayTab() {
  const qc = useQueryClient()
  const [mineOnly, setMineOnly] = useState(true)
  const [attackLimit, setAttackLimit] = useState(ATTACK_PAGE)
  const [drawerId, setDrawerId] = useState<string | null>(null)
  const [qualifyOpp, setQualifyOpp] = useState<Opportunity | null>(null)

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['prospection-prospects'] })
    qc.invalidateQueries({ queryKey: ['prospection-lists'] })
  }

  const remindersQuery = useQuery({
    queryKey: ['prospection-prospects', 'myday-reminders', { mineOnly }],
    queryFn: async () => {
      const { data } = await api.get('/prospection/prospects', {
        params: { today: true, mine: mineOnly || undefined, sortBy: 'remindAt', sortOrder: 'asc', limit: 100 },
      })
      return { rows: (data.data ?? []) as Opportunity[], total: (data.meta?.total ?? 0) as number }
    },
    staleTime: 10_000,
  })

  const attackQuery = useQuery({
    queryKey: ['prospection-prospects', 'myday-attack', { mineOnly, attackLimit }],
    queryFn: async () => {
      const { data } = await api.get('/prospection/prospects', {
        params: { neverContacted: true, mine: mineOnly || undefined, sortBy: 'createdAt', sortOrder: 'asc', limit: attackLimit },
      })
      return { rows: (data.data ?? []) as Opportunity[], total: (data.meta?.total ?? 0) as number }
    },
    staleTime: 10_000,
  })

  const reminders = remindersQuery.data?.rows ?? []
  const toAttack = attackQuery.data?.rows ?? []
  const totalReminders = remindersQuery.data?.total ?? 0
  const totalAttack = attackQuery.data?.total ?? 0

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-slate-600">
          <strong className="text-slate-900">{totalReminders}</strong> rappel{totalReminders > 1 ? 's' : ''} ·{' '}
          <strong className="text-slate-900">{totalAttack}</strong> à attaquer
        </p>
        <button
          type="button"
          className={cn('btn-secondary text-xs', mineOnly && 'bg-primary-50 border-primary-200 text-primary-700')}
          onClick={() => setMineOnly(v => !v)}
        >
          Mes prospects
        </button>
      </div>

      {/* ── À rappeler aujourd'hui ───────────────────────────────────────── */}
      <section className="space-y-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
          <Bell className="w-4 h-4 text-red-500" /> À rappeler aujourd'hui
        </h2>
        {remindersQuery.isLoading && <p className="text-sm text-slate-400 py-4">Chargement…</p>}
        {!remindersQuery.isLoading && reminders.length === 0 && (
          <p className="text-sm text-slate-400 py-4 border border-dashed border-slate-200 rounded-xl text-center">Aucun rappel pour aujourd'hui.</p>
        )}
        <div className="space-y-1.5">
          {reminders.map(opp => (
            <DayRow key={opp.id} opp={opp} onOpen={setDrawerId} onQualify={setQualifyOpp} onDone={invalidate} />
          ))}
        </div>
      </section>

      {/* ── À attaquer ───────────────────────────────────────────────────── */}
      <section className="space-y-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
          <Target className="w-4 h-4 text-primary-500" /> À attaquer
        </h2>
        {attackQuery.isLoading && <p className="text-sm text-slate-400 py-4">Chargement…</p>}
        {!attackQuery.isLoading && toAttack.length === 0 && (
          <p className="text-sm text-slate-400 py-4 border border-dashed border-slate-200 rounded-xl text-center">Rien de neuf à attaquer.</p>
        )}
        <div className="space-y-1.5">
          {toAttack.map(opp => (
            <DayRow key={opp.id} opp={opp} onOpen={setDrawerId} onQualify={setQualifyOpp} onDone={invalidate} />
          ))}
        </div>
        {totalAttack > toAttack.length && (
          <div className="flex justify-center pt-2">
            <button type="button" className="btn-secondary text-xs" onClick={() => setAttackLimit(v => v + ATTACK_PAGE)}>
              Suivants ({totalAttack - toAttack.length} restants)
            </button>
          </div>
        )}
      </section>

      <FollowUpDrawer open={!!drawerId} onClose={() => setDrawerId(null)} opportunityId={drawerId} mode="prospect" onQualified={() => setDrawerId(null)} />

      {qualifyOpp && (
        <QualifyModal open={!!qualifyOpp} onClose={() => setQualifyOpp(null)} opportunity={qualifyOpp} onQualified={() => { setQualifyOpp(null); invalidate() }} />
      )}
    </div>
  )
}
