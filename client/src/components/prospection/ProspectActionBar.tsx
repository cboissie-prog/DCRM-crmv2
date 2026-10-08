import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useMutation } from '@tanstack/react-query'
import api from '../../lib/api'
import { useReferences } from '../../hooks/useReferences'
import { toast } from '../ui/Toast'
import { Tooltip } from '../ui/Tooltip'
import { cn } from '../../lib/utils'
import {
  visibleActions, DATE_SHORTCUTS, actionsEndpoint, type ProspectActionDef, type ProspectActionValues,
} from '../../lib/prospectActions'
import type { Opportunity } from '../../types'

export interface ProspectActionBarProps {
  opportunity: Opportunity
  /** `prospect` → POST /prospection/prospects/:id/actions · `deal` → POST /pipeline/opportunities/:id/actions */
  mode: 'prospect' | 'deal'
  /** Boutons icône seule avec infobulle (ligne de tableau). `false` : icône + libellé (panneau de suivi). */
  compact?: boolean
  /** Active les raccourcis clavier N (sans réponse) / J (joint) / R (rappeler) de la ligne active. */
  isActiveRow?: boolean
  /** Appelé après succès d'une action, avec la fiche à jour renvoyée par le serveur. */
  onDone?: (updated: Opportunity) => void
  className?: string
}

/**
 * Barre d'actions à un clic — réutilisée par `ProspectListPage` (ligne survolée/sélectionnée),
 * `MyDayTab` (même ligne) et `FollowUpDrawer` (section « Actions rapides »). Spec §5.
 *
 * API publique stable : props ci-dessus. `onDone` laisse l'appelant décider de l'invalidation
 * des requêtes (liste de prospects, panneau ouvert, pipeline…) plutôt que de la deviner ici.
 */
export function ProspectActionBar({ opportunity, mode, compact = false, isActiveRow = false, onDone, className }: ProspectActionBarProps) {
  const refs = useReferences()
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [values, setValues] = useState<ProspectActionValues>({})
  const [errors, setErrors] = useState<Record<string, string> | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  // Bouton d'ancrage du mini-formulaire : le popover est rendu en portail (position fixe) pour ne jamais
  // sortir de la fenêtre ni être coupé par le conteneur défilant du tableau.
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)

  const endpoint = actionsEndpoint(mode, opportunity.id)

  const mutation = useMutation({
    mutationFn: (payload: { action: string } & ProspectActionValues) => api.post(endpoint, payload),
    onSuccess: (res) => {
      setOpenKey(null)
      setValues({})
      setErrors(null)
      onDone?.(res.data?.data as Opportunity)
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message
      toast.error(msg || "Erreur lors de l'action")
    },
  })

  const actions = visibleActions(mode, opportunity.prospectStatus)

  const run = (action: ProspectActionDef, extra: ProspectActionValues = {}) => {
    if (action.fields.length === 0) {
      mutation.mutate({ action: action.key })
      return
    }
    const draft = { ...values, ...extra }
    const errs = action.validate?.(draft) ?? null
    if (errs) { setErrors(errs); setValues(draft); return }
    mutation.mutate({ action: action.key, ...draft })
  }

  const openPopover = (action: ProspectActionDef, el?: HTMLElement | null) => {
    if (action.fields.length === 0) { run(action); return }
    setAnchor(el ?? containerRef.current?.querySelector<HTMLElement>(`[data-action="${action.key}"]`) ?? null)
    setOpenKey(action.key)
    setValues({})
    setErrors(null)
  }

  /** Position fixe du popover : à gauche du bouton si le bord droit déborde, au-dessus si le bas déborde. */
  const popoverStyle = (): React.CSSProperties => {
    const width = 272
    if (!anchor) return { position: 'fixed', top: 80, right: 16, width }
    const r = anchor.getBoundingClientRect()
    const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8))
    const estimatedHeight = 340
    const below = r.bottom + 6 + estimatedHeight <= window.innerHeight
    return below
      ? { position: 'fixed', top: r.bottom + 6, left, width }
      : { position: 'fixed', bottom: Math.max(8, window.innerHeight - r.top + 6), left, width }
  }

  // Ferme le mini-formulaire au clic extérieur
  useEffect(() => {
    if (!openKey) return
    const handler = (e: MouseEvent) => {
      const t = e.target as Node
      if (containerRef.current?.contains(t) || popoverRef.current?.contains(t)) return
      setOpenKey(null)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [openKey])

  // Raccourcis clavier N / J / R sur la ligne active (mode prospect uniquement — Q qualifie, géré par l'appelant)
  useEffect(() => {
    if (!isActiveRow || mode !== 'prospect') return
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      const action = actions.find(a => a.shortcut?.toLowerCase() === e.key.toLowerCase())
      if (action) { e.preventDefault(); openPopover(action) }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActiveRow, mode, actions.length])

  return (
    <div ref={containerRef} className={cn('flex items-center gap-1 flex-wrap', className)}>
      {actions.map(action => {
        const Icon = action.icon
        const open = openKey === action.key
        return (
          <div key={action.key} className="relative">
            <Tooltip content={action.shortcut ? `${action.label} (${action.shortcut})` : action.label}>
              <button
                type="button"
                disabled={mutation.isPending}
                data-action={action.key}
                onClick={e => openPopover(action, e.currentTarget)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-lg border transition-colors disabled:opacity-50',
                  compact ? 'p-1.5' : 'px-2.5 py-1.5 text-xs font-medium',
                  open ? 'bg-primary-50 border-primary-200 text-primary-700' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50 hover:border-slate-300',
                )}
              >
                <Icon className="w-3.5 h-3.5" />
                {!compact && action.label}
              </button>
            </Tooltip>

            {open && createPortal(
              <div ref={popoverRef} style={popoverStyle()} className="z-[1100] bg-white rounded-xl shadow-xl border border-slate-100 p-3 space-y-2.5">
                <p className="text-xs font-semibold text-slate-700">{action.label}</p>

                {action.fields.map(field => (
                  <div key={field.key}>
                    <label className="text-xs text-slate-500">{field.label}{field.required && ' *'}</label>
                    {field.type === 'date' && (
                      <div className="space-y-1.5 mt-1">
                        <div className="flex gap-1 flex-wrap">
                          {DATE_SHORTCUTS.map(s => (
                            <button
                              key={s.key}
                              type="button"
                              className="text-[11px] px-1.5 py-0.5 rounded border border-slate-200 text-slate-600 hover:bg-slate-50"
                              onClick={() => setValues(v => ({ ...v, [field.key]: s.getValue() }))}
                            >
                              {s.label}
                            </button>
                          ))}
                        </div>
                        <input
                          type="datetime-local"
                          className="input !py-1 !text-xs w-full"
                          value={values[field.key] ?? ''}
                          onChange={e => setValues(v => ({ ...v, [field.key]: e.target.value }))}
                        />
                      </div>
                    )}
                    {field.type === 'text' && (
                      <input
                        className="input !py-1 !text-xs w-full mt-1"
                        placeholder={field.placeholder}
                        value={values[field.key] ?? ''}
                        onChange={e => setValues(v => ({ ...v, [field.key]: e.target.value }))}
                      />
                    )}
                    {field.type === 'textarea' && (
                      <textarea
                        className="input !py-1 !text-xs w-full mt-1 resize-none"
                        rows={2}
                        placeholder={field.placeholder}
                        value={values[field.key] ?? ''}
                        onChange={e => setValues(v => ({ ...v, [field.key]: e.target.value }))}
                      />
                    )}
                    {field.type === 'select' && (
                      <select
                        className="input !py-1 !text-xs w-full mt-1"
                        value={values[field.key] ?? ''}
                        onChange={e => setValues(v => ({ ...v, [field.key]: e.target.value }))}
                      >
                        <option value="">—</option>
                        {refs.options(field.refDomain ?? '').map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    )}
                    {errors?.[field.key] && <p className="text-[11px] text-red-600 mt-0.5">{errors[field.key]}</p>}
                  </div>
                ))}

                <div className="flex justify-end gap-2 pt-1">
                  <button type="button" className="text-xs text-slate-400 hover:text-slate-600" onClick={() => setOpenKey(null)}>
                    Annuler
                  </button>
                  <button
                    type="button"
                    className="btn-primary !py-1 !text-xs"
                    disabled={mutation.isPending}
                    onClick={() => run(action)}
                  >
                    Valider
                  </button>
                </div>
              </div>,
              document.body,
            )}
          </div>
        )
      })}
    </div>
  )
}
