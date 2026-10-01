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
import { equipmentToOption, type QuickCreateModalProps } from './types'

// Pas de champ « nom » : le modèle Equipment n'en a pas (type, brand, model,
// serialNumber, location, status, notes, companyId, contractId, productId).
const schema = z.object({
  type: z.string().min(1, 'Type requis'),
  brand: z.string().optional(),
  model: z.string().optional(),
  serialNumber: z.string().optional(),
})
type Form = z.infer<typeof schema>

/**
 * Mini-modale de création rapide d'un équipement, utilisée par EntityPicker.
 * Montée uniquement pendant son ouverture : état neuf à chaque fois.
 */
export function QuickEquipmentModal({ open, onClose, context, onCreated }: QuickCreateModalProps) {
  const refs = useReferences()
  const [apiError, setApiError] = useState<string | null>(null)
  const [companyError, setCompanyError] = useState<string | null>(null)
  const [companyId, setCompanyId] = useState<string | null>(context?.companyId ?? null)
  const [companyLabel, setCompanyLabel] = useState<string>('')
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<Form>({
    resolver: zodResolver(schema) as Resolver<Form>,
  })

  const createMutation = useMutation({
    mutationFn: (values: Form) => api.post('/equipment', { ...values, companyId }),
    onSuccess: (res) => onCreated(equipmentToOption(res.data.data)),
    onError: (err: unknown) => {
      setApiError(isAxiosError(err) ? err.response?.data?.error?.message ?? 'Erreur lors de la création' : 'Erreur lors de la création')
    },
  })

  const onSubmit = (values: Form) => {
    if (!companyId) { setCompanyError('Entreprise requise'); return }
    createMutation.mutate(values)
  }

  return (
    <Modal open={open} onClose={onClose} title="Nouvel équipement" size="sm">
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
          <label className="label">Type *</label>
          <select {...register('type')} className={`input ${errors.type ? 'input-error' : ''}`}>
            <option value="">Sélectionner un type</option>
            {refs.options('equipment_type').map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          {errors.type && <p className="form-error">{errors.type.message}</p>}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="form-group">
            <label className="label">Marque</label>
            <input {...register('brand')} className="input" />
          </div>
          <div className="form-group">
            <label className="label">Modèle</label>
            <input {...register('model')} className="input" />
          </div>
        </div>

        <div className="form-group">
          <label className="label">Numéro de série</label>
          <input {...register('serialNumber')} className="input" />
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
