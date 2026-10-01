import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { isAxiosError } from 'axios'
import { z } from 'zod'
import type { Resolver } from 'react-hook-form'
import api from '../../../lib/api'
import { requiredNumber } from '../../../lib/formFields'
import { Modal } from '../Modal'
import { useReferences } from '../../../hooks/useReferences'
import { productToOption, type QuickCreateModalProps } from './types'

const schema = z.object({
  name: z.string().min(1, 'Nom requis'),
  category: z.string().min(1, 'Catégorie requise'),
  price: requiredNumber(z.number().min(0), 'Prix HT requis'),
  reference: z.string().optional(),
})
type Form = z.infer<typeof schema>

/**
 * Mini-modale de création rapide d'un produit du catalogue, utilisée par
 * EntityPicker. Montée uniquement pendant son ouverture : état neuf à chaque
 * fois, pas d'effet de réinitialisation.
 */
export function QuickProductModal({ open, onClose, context, onCreated }: QuickCreateModalProps) {
  const refs = useReferences()
  const [apiError, setApiError] = useState<string | null>(null)
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<Form>({
    resolver: zodResolver(schema) as Resolver<Form>,
    defaultValues: { category: context?.productCategory ?? '' },
  })

  const createMutation = useMutation({
    mutationFn: (values: Form) => api.post('/products', {
      ...values,
      isActive: true,
      ...(context?.productType ? { type: context.productType } : {}),
    }),
    onSuccess: (res) => onCreated(productToOption(res.data.data)),
    onError: (err: unknown) => {
      setApiError(isAxiosError(err) ? err.response?.data?.error?.message ?? 'Erreur lors de la création' : 'Erreur lors de la création')
    },
  })

  const onSubmit = (values: Form) => createMutation.mutate(values)

  return (
    <Modal open={open} onClose={onClose} title="Nouveau produit" size="sm">
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div className="form-group">
          <label className="label">Nom *</label>
          <input {...register('name')} className={`input ${errors.name ? 'input-error' : ''}`} autoFocus />
          {errors.name && <p className="form-error">{errors.name.message}</p>}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="form-group">
            <label className="label">Catégorie *</label>
            <select {...register('category')} className={`input ${errors.category ? 'input-error' : ''}`}>
              <option value="">Sélectionner</option>
              {refs.options('product_category').map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            {errors.category && <p className="form-error">{errors.category.message}</p>}
          </div>
          <div className="form-group">
            <label className="label">Prix HT (€) *</label>
            <input {...register('price')} type="number" min={0} step={0.01} className={`input ${errors.price ? 'input-error' : ''}`} />
            {errors.price && <p className="form-error">{errors.price.message}</p>}
          </div>
        </div>

        <div className="form-group">
          <label className="label">Référence</label>
          <input {...register('reference')} className="input" />
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
