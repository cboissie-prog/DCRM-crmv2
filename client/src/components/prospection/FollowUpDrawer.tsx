import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Phone, Mail, Copy, Check, X, Minus, HelpCircle, Star, Pencil,
  Building2, User as UserIcon, Calendar, AlertTriangle,
} from 'lucide-react'
import api from '../../lib/api'
import { useReferences } from '../../hooks/useReferences'
import { toast } from '../ui/Toast'
import { Drawer } from '../ui/Drawer'
import { Avatar } from '../ui/Avatar'
import { cn, formatRelative, formatDateTime } from '../../lib/utils'
import {
  PROSPECT_STATUS_CONFIG, actionsEndpoint, activityIcon, isDueOrOverdue, DATE_SHORTCUTS,
} from '../../lib/prospectActions'
import { ProspectActionBar } from './ProspectActionBar'
import { QualifyModal } from './QualifyModal'
import type { Opportunity } from '../../types'

export interface FollowUpDrawerProps {
  open: boolean
  onClose: () => void
  /** Identifiant de la fiche (prospect ou opportunité — même objet `Opportunity`, spec §1) */
  opportunityId: string | null
  /** `prospect` : fiche en prospection (listId posé, pipelineId null) · `deal` : opportunité qualifiée */
  mode: 'prospect' | 'deal'
  /** Mode `deal` : bouton « Modifier » du pied — ouvre la modale d'édition existante (fournie par l'appelant, Task 3) */
  onEdit?: (opportunity: Opportunity) => void
  /** Après qualification réussie (mode `prospect`) : la fiche quitte la prospection et entre dans le pipeline */
  onQualified?: (opportunity: Opportunity) => void
}

function parseQualification(raw?: string): Record<string, boolean | null> {
  if (!raw) return {}
  try { const v = JSON.parse(raw); return typeof v === 'object' && v ? v : {} } catch { return {} }
}
function parseDocuments(raw?: string): string[] {
  if (!raw) return []
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v : [] } catch { return [] }
}

/**
 * Panneau de suivi commun prospect / opportunité — spec §5 "Panneau de suivi (`FollowUpDrawer`)".
 *
 * API publique stable (props ci-dessus), réutilisée par `ProspectListPage`/`MyDayTab` (mode
 * `prospect`) et par le Kanban/la vue Liste du pipeline (mode `deal`, Task 3).
 */
export function FollowUpDrawer({ open, onClose, opportunityId, mode, onEdit, onQualified }: FollowUpDrawerProps) {
  const qc = useQueryClient()
  const refs = useReferences()
  const [note, setNote] = useState('')
  const [editingNextAction, setEditingNextAction] = useState(false)
  const [showQualify, setShowQualify] = useState(false)
  const [naRemindAt, setNaRemindAt] = useState('')
  const [naLabel, setNaLabel] = useState('')

  const detailEndpoint = mode === 'prospect' ? '/prospection/prospects' : '/pipeline/opportunities'
  const queryKey = ['follow-up-drawer', mode, opportunityId]

  // Libellé de l'étape (mode opportunité) : clé → nom via les pipelines
  const { data: pipelines = [] } = useQuery<{ id: string; stages: { key: string; name: string }[] }[]>({
    queryKey: ['pipelines'],
    queryFn: async () => { const { data } = await api.get('/pipelines'); return data.data ?? [] },
    enabled: open && mode === 'deal',
    staleTime: 60_000,
  })
  const { data: opp, isLoading } = useQuery<Opportunity>({
    queryKey,
    queryFn: async () => { const { data } = await api.get(`${detailEndpoint}/${opportunityId}`); return data.data },
    enabled: open && !!opportunityId,
    staleTime: 10_000,
  })

  const invalidateLists = () => {
    qc.invalidateQueries({ queryKey: ['prospection-prospects'] })
    qc.invalidateQueries({ queryKey: ['prospection-lists'] })
    qc.invalidateQueries({ queryKey: ['pipeline-opportunities'] })
    qc.invalidateQueries({ queryKey: ['pipeline-opportunities-list'] })
  }

  const applyUpdate = (updated: Opportunity) => {
    qc.setQueryData(queryKey, updated)
    invalidateLists()
  }

  const actionMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => api.post(actionsEndpoint(mode, opportunityId!), payload),
    onSuccess: (res) => applyUpdate(res.data?.data as Opportunity),
    onError: () => toast.error("Erreur lors de l'action"),
  })

  if (!open) return null

  const status = opp?.prospectStatus ?? 'TODO'
  const qualification = parseQualification(opp?.qualification)
  const documents = parseDocuments(opp?.documentsSent)
  const overdue = isDueOrOverdue(opp?.remindAt)
  const hasNextAction = !!(opp?.remindAt || opp?.nextAction)

  const submitNextAction = () => {
    if (!naRemindAt || !naLabel.trim()) { toast.error('Date et libellé requis'); return }
    actionMutation.mutate({ action: 'NEXT_ACTION', remindAt: naRemindAt, nextAction: naLabel }, {
      onSuccess: () => setEditingNextAction(false),
    })
  }

  const toggleCriterion = (key: string, value: boolean | null) => {
    const next = { ...qualification, [key]: value }
    actionMutation.mutate({ action: 'QUALIFICATION', criteria: next })
  }

  const sendDocument = (key: string) => {
    if (documents.includes(key)) return
    actionMutation.mutate({ action: 'DOC_SENT', document: key })
  }

  const submitNote = () => {
    if (!note.trim()) return
    actionMutation.mutate({ action: 'NOTE', note }, { onSuccess: () => setNote('') })
  }

  return (
    <>
      <Drawer open={open} onClose={onClose} width="w-[560px]" title={opp?.title ?? 'Fiche de suivi'}>
        {isLoading || !opp ? (
          <div className="p-8 text-center text-sm text-slate-400">Chargement…</div>
        ) : (
          <div className="flex flex-col h-full">
            {/* ── En-tête ──────────────────────────────────────────────────── */}
            <div className="px-5 py-4 border-b border-slate-100 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={cn('inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border', PROSPECT_STATUS_CONFIG[status].className)}>
                  {PROSPECT_STATUS_CONFIG[status].label}
                </span>
                {opp.assignedTo && (
                  <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
                    <Avatar firstName={opp.assignedTo.firstName} lastName={opp.assignedTo.lastName} size="xs" />
                    {opp.assignedTo.firstName} {opp.assignedTo.lastName}
                  </span>
                )}
                {mode === 'prospect' && opp.list && (
                  <span className="text-xs text-slate-400">Liste « {opp.list.name} »</span>
                )}
                {mode === 'deal' && (
                  <span className="text-xs text-slate-400">
                    Étape : {pipelines.find(p => p.id === opp.pipelineId)?.stages.find(st => st.key === opp.stage)?.name ?? opp.stage}
                  </span>
                )}
              </div>
              {opp.company && (
                <p className="flex items-center gap-1.5 text-sm text-slate-700"><Building2 className="w-3.5 h-3.5 text-slate-400" /> {opp.company.name}</p>
              )}
              {opp.contact && (
                <p className="flex items-center gap-1.5 text-sm text-slate-700">
                  <UserIcon className="w-3.5 h-3.5 text-slate-400" /> {opp.contact.firstName} {opp.contact.lastName}
                </p>
              )}
              <div className="flex items-center gap-3 flex-wrap">
                {(opp.contact?.phone || opp.contact?.mobile) && (
                  <span className="inline-flex items-center gap-1">
                    <a href={`tel:${opp.contact.phone || opp.contact.mobile}`} className="flex items-center gap-1 text-xs text-primary-600 hover:underline">
                      <Phone className="w-3 h-3" /> {opp.contact.phone || opp.contact.mobile}
                    </a>
                    <button type="button" title="Copier" className="text-slate-300 hover:text-slate-600"
                      onClick={() => { navigator.clipboard?.writeText((opp.contact!.phone || opp.contact!.mobile)!).then(() => toast.success('Numéro copié')).catch(() => {}) }}>
                      <Copy className="w-3 h-3" />
                    </button>
                  </span>
                )}
                {opp.contact?.email && (
                  <a href={`mailto:${opp.contact.email}`} className="flex items-center gap-1 text-xs text-primary-600 hover:underline">
                    <Mail className="w-3 h-3" /> {opp.contact.email}
                  </a>
                )}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto">
              {/* ── 1. Prochaine action ─────────────────────────────────────── */}
              <section className="px-5 py-4 border-b border-slate-100">
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Prochaine action</h3>
                {!editingNextAction ? (
                  <div
                    className={cn(
                      'flex items-center justify-between gap-2 rounded-xl px-3 py-2.5 border',
                      !hasNextAction ? 'bg-amber-50 border-amber-200' : overdue ? 'bg-red-50 border-red-200' : 'bg-slate-50 border-slate-200',
                    )}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {!hasNextAction ? <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0" /> : <Calendar className={cn('w-4 h-4 flex-shrink-0', overdue ? 'text-red-500' : 'text-slate-400')} />}
                      <div className="min-w-0">
                        {hasNextAction ? (
                          <>
                            <p className={cn('text-sm font-medium truncate', overdue ? 'text-red-700' : 'text-slate-800')}>{opp.nextAction || 'Prochaine action'}</p>
                            {opp.remindAt && <p className="text-xs text-slate-500">{formatDateTime(opp.remindAt)}</p>}
                          </>
                        ) : (
                          <p className="text-sm font-medium text-amber-700">Aucune : à planifier</p>
                        )}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="btn-ghost p-1.5 rounded-lg text-slate-400 hover:text-primary-600 flex-shrink-0"
                      onClick={() => { setNaRemindAt(opp.remindAt?.slice(0, 16) ?? ''); setNaLabel(opp.nextAction ?? ''); setEditingNextAction(true) }}
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2 rounded-xl border border-primary-200 bg-primary-50/30 p-3">
                    <div className="flex gap-1.5 flex-wrap">
                      {DATE_SHORTCUTS.map(s => (
                        <button key={s.key} type="button" className="text-[11px] px-1.5 py-0.5 rounded border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                          onClick={() => setNaRemindAt(s.getValue())}>
                          {s.label}
                        </button>
                      ))}
                    </div>
                    <input type="datetime-local" className="input !text-xs" value={naRemindAt} onChange={e => setNaRemindAt(e.target.value)} />
                    <input className="input !text-xs" placeholder="Libellé" value={naLabel} onChange={e => setNaLabel(e.target.value)} />
                    <div className="flex justify-end gap-2">
                      <button type="button" className="text-xs text-slate-400" onClick={() => setEditingNextAction(false)}>Annuler</button>
                      <button type="button" className="btn-primary !py-1 !text-xs" disabled={actionMutation.isPending} onClick={submitNextAction}>Enregistrer</button>
                    </div>
                  </div>
                )}
              </section>

              {/* ── 2. Actions rapides ──────────────────────────────────────── */}
              <section className="px-5 py-4 border-b border-slate-100">
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Actions rapides</h3>
                <ProspectActionBar opportunity={opp} mode={mode} onDone={applyUpdate} />
              </section>

              {/* ── 3. Grille de qualification ──────────────────────────────── */}
              <section className="px-5 py-4 border-b border-slate-100">
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Qualification</h3>
                <div className="space-y-1.5">
                  {refs.options('qualification_criteria').map(c => {
                    const v = qualification[c.value] ?? null
                    return (
                      <div key={c.value} className="flex items-center justify-between gap-2 text-sm">
                        <span className="text-slate-600">{c.label}</span>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <button type="button" title="Oui" onClick={() => toggleCriterion(c.value, true)}
                            className={cn('p-1 rounded-md border', v === true ? 'bg-emerald-100 border-emerald-300 text-emerald-700' : 'border-slate-200 text-slate-300 hover:text-slate-500')}>
                            <Check className="w-3.5 h-3.5" />
                          </button>
                          <button type="button" title="Non" onClick={() => toggleCriterion(c.value, false)}
                            className={cn('p-1 rounded-md border', v === false ? 'bg-red-100 border-red-300 text-red-700' : 'border-slate-200 text-slate-300 hover:text-slate-500')}>
                            <X className="w-3.5 h-3.5" />
                          </button>
                          <button type="button" title="Inconnu" onClick={() => toggleCriterion(c.value, null)}
                            className={cn('p-1 rounded-md border', v == null ? 'bg-slate-200 border-slate-300 text-slate-600' : 'border-slate-200 text-slate-300 hover:text-slate-500')}>
                            {v == null ? <HelpCircle className="w-3.5 h-3.5" /> : <Minus className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                      </div>
                    )
                  })}
                  {refs.options('qualification_criteria').length === 0 && (
                    <p className="text-xs text-slate-400">Aucun critère configuré (Réglages &gt; Listes).</p>
                  )}
                </div>
              </section>

              {/* ── 4. Documents envoyés ─────────────────────────────────────── */}
              <section className="px-5 py-4 border-b border-slate-100">
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Documents envoyés</h3>
                <div className="flex flex-wrap gap-2">
                  {refs.options('prospect_documents').map(d => {
                    const sent = documents.includes(d.value)
                    return (
                      <button
                        key={d.value}
                        type="button"
                        disabled={sent}
                        onClick={() => sendDocument(d.value)}
                        className={cn(
                          'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border',
                          sent ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50',
                        )}
                      >
                        {sent && <Check className="w-3 h-3" />} {d.label}
                      </button>
                    )
                  })}
                </div>
              </section>

              {/* ── 5. Chronologie ───────────────────────────────────────────── */}
              <section className="px-5 py-4">
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Chronologie</h3>
                <div className="space-y-2 mb-3">
                  <textarea
                    className="input !text-xs resize-none w-full"
                    rows={2}
                    placeholder="Ajouter une note…"
                    value={note}
                    onChange={e => setNote(e.target.value)}
                  />
                  <div className="flex justify-end">
                    <button type="button" className="btn-secondary !py-1 !text-xs" disabled={!note.trim() || actionMutation.isPending} onClick={submitNote}>
                      Ajouter la note
                    </button>
                  </div>
                </div>
                <div className="space-y-0">
                  {(opp.activities ?? []).length === 0 && <p className="text-xs text-slate-400">Aucune activité pour le moment.</p>}
                  {(opp.activities ?? []).map(a => {
                    const Icon = activityIcon(a.type)
                    return (
                      <div key={a.id} className="flex items-start gap-2.5 py-2 border-b border-slate-50 last:border-0">
                        <div className="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                          <Icon className="w-3.5 h-3.5 text-slate-500" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-slate-700">{a.title}</p>
                          {a.description && <p className="text-xs text-slate-500 mt-0.5 whitespace-pre-wrap">{a.description}</p>}
                          <p className="text-xs text-slate-400 mt-0.5">
                            {a.user ? `${a.user.firstName} ${a.user.lastName} · ` : ''}{formatRelative(a.createdAt)}
                          </p>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </section>
            </div>

            {/* ── 6. Pied ──────────────────────────────────────────────────── */}
            <div className="px-5 py-3 border-t border-slate-100 flex justify-end gap-2 flex-shrink-0">
              {mode === 'prospect' ? (
                <button type="button" className="btn-primary" onClick={() => setShowQualify(true)}>
                  <Star className="w-4 h-4" /> Qualifier
                </button>
              ) : (
                <button type="button" className="btn-secondary" onClick={() => onEdit?.(opp)}>
                  <Pencil className="w-4 h-4" /> Modifier
                </button>
              )}
            </div>
          </div>
        )}
      </Drawer>

      {opp && (
        <QualifyModal
          open={showQualify}
          onClose={() => setShowQualify(false)}
          opportunity={opp}
          onQualified={(updated) => {
            setShowQualify(false)
            invalidateLists()
            onQualified?.(updated)
            onClose()
          }}
        />
      )}
    </>
  )
}
