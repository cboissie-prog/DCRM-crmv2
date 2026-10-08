import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Star, Loader2 } from 'lucide-react'
import api from '../../lib/api'
import { toast } from '../ui/Toast'
import { Modal } from '../ui/Modal'
import type { Opportunity } from '../../types'

interface QualifyPipelineStage { id: string; key: string; name: string; order: number; isWon: boolean; isLost: boolean }
interface QualifyPipeline { id: string; name: string; isDefault: boolean; stages: QualifyPipelineStage[] }

export interface QualifyModalProps {
  open: boolean
  onClose: () => void
  /** Fiche à qualifier (mode prospect uniquement — une fiche déjà dans un pipeline ne peut pas être re-qualifiée) */
  opportunity: Opportunity
  /** Appelé après succès — la fiche renvoyée porte déjà `pipelineId`/`stage`/`prospectStatus: 'QUALIFIED'` */
  onQualified?: (updated: Opportunity) => void
}

/**
 * Qualification d'un prospect vers le pipeline — `POST /prospection/prospects/:id/qualify`
 * (spec §4 et §5). Pipeline pré-rempli par la liste d'origine (sinon le pipeline par défaut),
 * étape pré-remplie par la première étape ouverte.
 */
export function QualifyModal({ open, onClose, opportunity, onQualified }: QualifyModalProps) {
  const qc = useQueryClient()
  const [pipelineId, setPipelineId] = useState('')
  const [stage, setStage] = useState('')
  const [title, setTitle] = useState('')
  const [value, setValue] = useState('')
  const [expectedCloseDate, setExpectedCloseDate] = useState('')
  const [nextAction, setNextAction] = useState('')
  const [remindAt, setRemindAt] = useState('')

  const { data: pipelines = [] } = useQuery<QualifyPipeline[]>({
    queryKey: ['pipelines'],
    queryFn: async () => { const { data } = await api.get('/pipelines'); return data.data ?? [] },
    enabled: open,
    staleTime: 60_000,
  })

  // Pré-remplissage à l'ouverture : pipeline de la liste d'origine, sinon le pipeline par défaut.
  useEffect(() => {
    if (!open || pipelines.length === 0) return
    const preferred = pipelines.find(p => p.id === opportunity.list?.pipelineId)
      ?? pipelines.find(p => p.isDefault)
      ?? pipelines[0]
    setPipelineId(preferred.id)
    const openStages = [...preferred.stages].sort((a, b) => a.order - b.order).filter(s => !s.isWon && !s.isLost)
    setStage(openStages[0]?.key ?? '')
    setTitle(opportunity.title)
    setValue(String(opportunity.value ?? ''))
    setExpectedCloseDate('')
    setNextAction(opportunity.nextAction ?? '')
    setRemindAt(opportunity.remindAt?.slice(0, 16) ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pipelines.length])

  const selectedPipeline = pipelines.find(p => p.id === pipelineId)
  const openStages = useMemo(
    () => [...(selectedPipeline?.stages ?? [])].sort((a, b) => a.order - b.order).filter(s => !s.isWon && !s.isLost),
    [selectedPipeline],
  )

  const mutation = useMutation({
    mutationFn: () => api.post(`/prospection/prospects/${opportunity.id}/qualify`, {
      pipelineId: pipelineId || undefined,
      stage: stage || undefined,
      title: title.trim() || undefined,
      value: value ? parseFloat(value.replace(',', '.')) : undefined,
      expectedCloseDate: expectedCloseDate || undefined,
      nextAction: nextAction.trim() || undefined,
      remindAt: remindAt || undefined,
    }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['prospection-prospects'] })
      qc.invalidateQueries({ queryKey: ['prospection-lists'] })
      qc.invalidateQueries({ queryKey: ['pipeline-opportunities'] })
      qc.invalidateQueries({ queryKey: ['pipeline-opportunities-list'] })
      toast.success('Prospect qualifié', `${title || opportunity.title} a rejoint le pipeline.`)
      onQualified?.(res.data?.data as Opportunity)
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message
      toast.error(msg || 'Erreur lors de la qualification')
    },
  })

  return (
    <Modal open={open} onClose={onClose} title="Qualifier vers le pipeline" size="md">
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="form-group">
            <label className="label">Pipeline</label>
            <select className="input" value={pipelineId} onChange={e => { setPipelineId(e.target.value); setStage('') }}>
              {pipelines.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="label">Étape</label>
            <select className="input" value={stage} onChange={e => setStage(e.target.value)}>
              {openStages.map(s => <option key={s.key} value={s.key}>{s.name}</option>)}
            </select>
          </div>
        </div>

        <div className="form-group">
          <label className="label">Titre de l'opportunité</label>
          <input className="input" value={title} onChange={e => setTitle(e.target.value)} required />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="form-group">
            <label className="label">Montant HT</label>
            <input className="input" type="number" step="1" value={value} onChange={e => setValue(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="label">Closing prévu</label>
            <input className="input" type="date" value={expectedCloseDate} onChange={e => setExpectedCloseDate(e.target.value)} />
          </div>
        </div>

        <hr className="border-slate-100" />
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Prochaine action dans le pipeline</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="form-group">
            <label className="label">Libellé</label>
            <input className="input" placeholder="Envoyer la proposition…" value={nextAction} onChange={e => setNextAction(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="label">Date</label>
            <input className="input" type="datetime-local" value={remindAt} onChange={e => setRemindAt(e.target.value)} />
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Annuler</button>
          <button
            type="button"
            className="btn-primary"
            disabled={mutation.isPending || !title.trim() || !pipelineId}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Star className="w-4 h-4" />}
            Qualifier
          </button>
        </div>
      </div>
    </Modal>
  )
}
