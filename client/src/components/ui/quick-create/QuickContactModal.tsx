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
import { contactToOption, type QuickCreateModalProps } from './types'

const schema = z.object({
  firstName: z.string().min(1, 'Prénom requis'),
  lastName: z.string().min(1, 'Nom requis'),
  email: z.string().email('Email invalide').optional().or(z.literal('')),
  phone: z.string().optional(),
})
type Form = z.infer<typeof schema>

/**
 * Mini-modale de création rapide d'un contact, utilisée par EntityPicker.
 * Montée uniquement pendant son ouverture (état neuf à chaque fois, pas
 * d'effet de réinitialisation). Le champ entreprise est lui-même un
 * EntityPicker — profondeur maximale atteinte ici : son bouton « + Créer »
 * ouvre QuickCompanyModal, qui ne contient aucun champ entité (pas de niveau 2).
 */
export function QuickContactModal({ open, onClose, context, onCreated }: QuickCreateModalProps) {
  const [apiError, setApiError] = useState<string | null>(null)
  const [companyId, setCompanyId] = useState<string | null>(context?.companyId ?? null)
  const [companyLabel, setCompanyLabel] = useState<string>('')
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<Form>({
    resolver: zodResolver(schema) as Resolver<Form>,
  })

  const createMutation = useMutation({
    mutationFn: (values: Form) => api.post('/contacts', { ...values, companyId: companyId || undefined }),
    onSuccess: (res) => onCreated(contactToOption(res.data.data)),
    onError: (err: unknown) => {
      setApiError(isAxiosError(err) ? err.response?.data?.error?.message ?? 'Erreur lors de la création' : 'Erreur lors de la création')
    },
  })

  const onSubmit = (values: Form) => createMutation.mutate(values)

  return (
    <Modal open={open} onClose={onClose} title="Nouveau contact" size="sm">
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="form-group">
            <label className="label">Prénom *</label>
            <input {...register('firstName')} className={`input ${errors.firstName ? 'input-error' : ''}`} autoFocus />
            {errors.firstName && <p className="form-error">{errors.firstName.message}</p>}
          </div>
          <div className="form-group">
            <label className="label">Nom *</label>
            <input {...register('lastName')} className={`input ${errors.lastName ? 'input-error' : ''}`} />
            {errors.lastName && <p className="form-error">{errors.lastName.message}</p>}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="form-group">
            <label className="label">Email</label>
            <input {...register('email')} type="email" className={`input ${errors.email ? 'input-error' : ''}`} />
            {errors.email && <p className="form-error">{errors.email.message}</p>}
          </div>
          <div className="form-group">
            <label className="label">Téléphone</label>
            <input {...register('phone')} className="input" />
          </div>
        </div>

        <div className="form-group">
          <label className="label">Entreprise</label>
          <EntityPicker
            entity="company"
            value={companyId}
            valueLabel={companyLabel}
            onChange={(id, option) => { setCompanyId(id); setCompanyLabel(option?.label ?? '') }}
            noCreate={false}
          />
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
