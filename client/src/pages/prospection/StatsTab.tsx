import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { startOfWeek, endOfWeek, startOfMonth, endOfMonth, format } from 'date-fns'
import { Download } from 'lucide-react'
import api from '../../lib/api'
import { useProspectLists } from '../../hooks/useProspectLists'
import { cn } from '../../lib/utils'
import type { ProspectionStatsRow } from '../../types'

type Period = 'week' | 'month' | 'custom'

function pad(n: number) { return String(n).padStart(2, '0') }
function toDateInput(d: Date) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }

function percent(num: number, den: number): string {
  if (!den) return '—'
  return `${Math.round((num / den) * 100)}%`
}

/** Onglet « Suivi » — tableau par commercial (spec §5), export CSV, période/liste. */
export function StatsTab() {
  const { active: lists } = useProspectLists()
  const [period, setPeriod] = useState<Period>('week')
  const [customFrom, setCustomFrom] = useState(toDateInput(startOfWeek(new Date(), { weekStartsOn: 1 })))
  const [customTo, setCustomTo] = useState(toDateInput(new Date()))
  const [listId, setListId] = useState('')

  const { from, to } = useMemo(() => {
    const now = new Date()
    if (period === 'week') return { from: toDateInput(startOfWeek(now, { weekStartsOn: 1 })), to: toDateInput(endOfWeek(now, { weekStartsOn: 1 })) }
    if (period === 'month') return { from: toDateInput(startOfMonth(now)), to: toDateInput(endOfMonth(now)) }
    return { from: customFrom, to: customTo }
  }, [period, customFrom, customTo])

  const { data: rows = [], isLoading } = useQuery<ProspectionStatsRow[]>({
    queryKey: ['prospection-stats', { listId, from, to }],
    queryFn: async () => {
      const { data } = await api.get('/prospection/stats', { params: { listId: listId || undefined, from, to } })
      return data.data ?? []
    },
    staleTime: 10_000,
  })

  const totals = rows.reduce((acc, r) => ({
    calls: acc.calls + r.calls,
    reached: acc.reached + r.reached,
    callbacks: acc.callbacks + r.callbacks,
    docsSent: acc.docsSent + r.docsSent,
    meetings: acc.meetings + r.meetings,
    qualified: acc.qualified + r.qualified,
    rejected: acc.rejected + r.rejected,
  }), { calls: 0, reached: 0, callbacks: 0, docsSent: 0, meetings: 0, qualified: 0, rejected: 0 })

  const exportCsv = () => {
    const bom = '﻿'
    const header = ['Commercial', 'Appels', 'Joints', 'Rappels', 'Documents', 'RDV', 'Qualifiés', 'Écartés', 'Taux joints/appels', 'Taux qualifiés/joints'].join(';')
    const lines = rows.map(r => [
      `${r.firstName} ${r.lastName}`, r.calls, r.reached, r.callbacks, r.docsSent, r.meetings, r.qualified, r.rejected,
      percent(r.reached, r.calls), percent(r.qualified, r.reached),
    ].join(';'))
    const blob = new Blob([bom + header + '\n' + lines.join('\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `suivi-prospection_${from}_${to}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {(['week', 'month', 'custom'] as Period[]).map(p => (
          <button key={p} type="button" className={cn('btn-secondary text-xs', period === p && 'bg-primary-50 border-primary-200 text-primary-700')} onClick={() => setPeriod(p)}>
            {p === 'week' ? 'Cette semaine' : p === 'month' ? 'Ce mois' : 'Personnalisée'}
          </button>
        ))}
        {period === 'custom' && (
          <>
            <input type="date" className="input !py-1 !text-xs w-auto" value={customFrom} onChange={e => setCustomFrom(e.target.value)} />
            <span className="text-xs text-slate-400">→</span>
            <input type="date" className="input !py-1 !text-xs w-auto" value={customTo} onChange={e => setCustomTo(e.target.value)} />
          </>
        )}
        <select className="input !py-1 !text-xs w-auto" value={listId} onChange={e => setListId(e.target.value)}>
          <option value="">Toutes les listes</option>
          {lists.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        <div className="flex-1" />
        <button type="button" className="btn-secondary text-xs" disabled={rows.length === 0} onClick={exportCsv}>
          <Download className="w-3.5 h-3.5" /> Export CSV
        </button>
      </div>

      <div className="overflow-auto border border-slate-200 rounded-2xl bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50">
            <tr className="border-b border-slate-200">
              <th className="px-3 py-2 text-left font-medium text-slate-500">Commercial</th>
              <th className="px-3 py-2 text-right font-medium text-slate-500">Appels</th>
              <th className="px-3 py-2 text-right font-medium text-slate-500">Joints</th>
              <th className="px-3 py-2 text-right font-medium text-slate-500">Rappels</th>
              <th className="px-3 py-2 text-right font-medium text-slate-500">Documents</th>
              <th className="px-3 py-2 text-right font-medium text-slate-500">RDV</th>
              <th className="px-3 py-2 text-right font-medium text-slate-500">Qualifiés</th>
              <th className="px-3 py-2 text-right font-medium text-slate-500">Écartés</th>
              <th className="px-3 py-2 text-right font-medium text-slate-500">Taux joints/appels</th>
              <th className="px-3 py-2 text-right font-medium text-slate-500">Taux qualifiés/joints</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={10} className="px-3 py-8 text-center text-slate-400 text-xs">Chargement…</td></tr>}
            {!isLoading && rows.length === 0 && <tr><td colSpan={10} className="px-3 py-8 text-center text-slate-400 text-xs">Aucune activité sur la période</td></tr>}
            {rows.map(r => (
              <tr key={r.userId} className="border-b border-slate-100 last:border-0">
                <td className="px-3 py-2 font-medium text-slate-800">{r.firstName} {r.lastName}</td>
                <td className="px-3 py-2 text-right text-slate-600">{r.calls}</td>
                <td className="px-3 py-2 text-right text-slate-600">{r.reached}</td>
                <td className="px-3 py-2 text-right text-slate-600">{r.callbacks}</td>
                <td className="px-3 py-2 text-right text-slate-600">{r.docsSent}</td>
                <td className="px-3 py-2 text-right text-slate-600">{r.meetings}</td>
                <td className="px-3 py-2 text-right text-violet-600 font-medium">{r.qualified}</td>
                <td className="px-3 py-2 text-right text-red-500">{r.rejected}</td>
                <td className="px-3 py-2 text-right text-slate-500">{percent(r.reached, r.calls)}</td>
                <td className="px-3 py-2 text-right text-slate-500">{percent(r.qualified, r.reached)}</td>
              </tr>
            ))}
          </tbody>
          {rows.length > 1 && (
            <tfoot>
              <tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold text-slate-700">
                <td className="px-3 py-2">Total</td>
                <td className="px-3 py-2 text-right">{totals.calls}</td>
                <td className="px-3 py-2 text-right">{totals.reached}</td>
                <td className="px-3 py-2 text-right">{totals.callbacks}</td>
                <td className="px-3 py-2 text-right">{totals.docsSent}</td>
                <td className="px-3 py-2 text-right">{totals.meetings}</td>
                <td className="px-3 py-2 text-right text-violet-600">{totals.qualified}</td>
                <td className="px-3 py-2 text-right text-red-500">{totals.rejected}</td>
                <td className="px-3 py-2 text-right">{percent(totals.reached, totals.calls)}</td>
                <td className="px-3 py-2 text-right">{percent(totals.qualified, totals.reached)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <p className="text-xs text-slate-400">Période du {format(new Date(from), 'dd/MM/yyyy')} au {format(new Date(to), 'dd/MM/yyyy')}.</p>
    </div>
  )
}
