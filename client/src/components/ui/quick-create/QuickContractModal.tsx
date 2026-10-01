import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { isAxiosError } from 'axios'
import { z } from 'zod'
import type { Resolver } from 'react-hook-form'
import api from '../../../lib/api'
import { Modal } from '../Modal'
import { EntityPicker } from '../EntityPicker'
import { useReferences } from '../../../hooks/useReferences'
import { contractToOption, type QuickCreateModalProps } from './types'

const schema = z.object({
  type: z.string().min(1, 'Type requis'),
  title: z.string().min(1, 'Titre requis'),
  startDate: z.string().min(1, 'Date de début requise'),
  endDate: z.string().min(1, 'Date de fin requise'),
}).refine(v => v.endDate >= v.startDate, {
  message: 'La date de fin doit être postérieure ou égale à la date de début',
  path: ['endDate'],
})
type Form = z.infer<typeof schema>

/**
 * Mini-modale de création rapide d'un contrat, utilisée par EntityPicker.
 * Montée uniquement pendant son ouverture : état neuf à chaque fois.
 */
export function QuickContractModal({ open, onClose, context, onCreated }: QuickCreateModalProps) {
  const refs = useReferences()
  const [apiError, setApiError] = useState<string | null>(null)
  const [companyError, setCompanyError] = useState<string | null>(null)
  const [companyId, setCompanyId] = useState<string | null>(context?.companyId ?? null)
  const [companyLabel, setCompanyLabel] = useState<string>('')
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<Form>({
    resolver: zodResolver(schema) as Resolver<Form>,
  })

  const createMutation = useMutation({
    mutationFn: (values: Form) => api.post('/contracts', { ...values, companyId }),
    onSuccess: (res) => onCreated(contractToOption(res.data.data)),
    onError: (err: unknown) => {
      setApiError(isAxiosError(err) ? err.response?.data?.error?.message ?? 'Erreur lors de la création' : 'Erreur lors de la création')
    },
  })

  const onSubmit = (values: Form) => {
    if (!companyId) { setCompanyError('Entreprise requise'); return }
    createMutation.mutate(values)
  }

  return (
    <Modal open={open} onClose={onClose} title="Nouveau contrat" size="sm">
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div className="form-group">
          <label className="label">Entreprise *</label>
          <EntityPicker
            entity="company"
            value={companyId}
            valueLabel={companyLabel}
            onChange={(id, option) => { setCompanyId(id); setCompanyLabel(option?.label ?? ''); setCompanyError(null) }}
            error={companyError ?? undefined}
            noCreate={false}
          />
        </div>

        <div className="form-group">
          <label className="label">Titre *</label>
          <input {...register('title')} className={`input ${errors.title ? 'input-error' : ''}`} />
          {errors.title && <p className="form-error">{errors.title.message}</p>}
        </div>

        <div className="form-group">
          <label className="label">Type *</label>
          <select {...register('type')} className={`input ${errors.type ? 'input-error' : ''}`}>
            <option value="">Sélectionner</option>
            {refs.options('contract_type').map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          {errors.type && <p className="form-error">{errors.type.message}</p>}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="form-group">
            <label className="label">Date de début *</label>
            <input {...register('startDate')} type="date" className={`input ${errors.startDate ? 'input-error' : ''}`} />
            {errors.startDate && <p className="form-error">{errors.startDate.message}</p>}
          </div>
          <div className="form-group">
            <label className="label">Date de fin *</label>
            <input {...register('endDate')} type="date" className={`input ${errors.endDate ? 'input-error' : ''}`} />
            {errors.endDate && <p className="form-error">{errors.endDate.message}</p>}
          </div>
        </div>

        {apiError && <p className="form-error">{apiError}</p>}

        <div className="flex justify-end gap-3 pt-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Annuler</button>
          <button type="submit" className="btn-primary" disabled={isSubmitting || createMutation.isPending}>
            Créer et sélectionner
          </button>
        </div>
      </form>
    </Modal>
  )
}
