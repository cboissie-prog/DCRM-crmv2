import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { isAxiosError } from 'axios'
import { z } from 'zod'
import type { Resolver } from 'react-hook-form'
import api from '../../../lib/api'
import { Modal } from '../Modal'
import { CompanySearchInput, type SocietePrefill } from '../CompanySearchInput'
import { companyToOption, type QuickCreateModalProps } from './types'

// Pas de téléphone / email sur le modèle Company (ces champs vivent sur Contact) —
// formulaire minimal aligné sur le schéma serveur réel (server/src/routes/companies.ts).
const schema = z.object({
  name: z.string().min(1, 'Nom requis'),
  siret: z.string().optional(),
  vatNumber: z.string().optional(),
  website: z.string().optional(),
  city: z.string().optional(),
  postalCode: z.string().optional(),
  billingAddress: z.string().optional(),
  country: z.string().optional(),
})
type Form = z.infer<typeof schema>

/**
 * Mini-modale de création rapide d'une entreprise, utilisée par EntityPicker.
 * Montée uniquement pendant son ouverture (EntityPicker ne la rend que si
 * `createOpen` est vrai) : chaque ouverture repart d'un état neuf, sans effet
 * de réinitialisation.
 */
export function QuickCompanyModal({ open, onClose, onCreated }: QuickCreateModalProps) {
  const [apiError, setApiError] = useState<string | null>(null)
  const { register, handleSubmit, setValue, formState: { errors, isSubmitting } } = useForm<Form>({
    resolver: zodResolver(schema) as Resolver<Form>,
  })

  const createMutation = useMutation({
    mutationFn: (values: Form) => api.post('/companies', values),
    onSuccess: (res) => onCreated(companyToOption(res.data.data)),
    onError: (err: unknown) => {
      setApiError(isAxiosError(err) ? err.response?.data?.error?.message ?? 'Erreur lors de la création' : 'Erreur lors de la création')
    },
  })

  const applyPrefill = (p: SocietePrefill) => {
    setValue('name', p.name, { shouldValidate: true })
    setValue('siret', p.siret)
    setValue('vatNumber', p.vatNumber)
    setValue('city', p.city)
    setValue('postalCode', p.postalCode)
    setValue('billingAddress', p.billingAddress)
    setValue('country', p.country)
  }

  const onSubmit = (values: Form) => createMutation.mutate(values)

  return (
    <Modal open={open} onClose={onClose} title="Nouvelle entreprise" size="sm">
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <CompanySearchInput onSelect={applyPrefill} />

        <div className="form-group">
          <label className="label">Raison sociale *</label>
          <input {...register('name')} className={`input ${errors.name ? 'input-error' : ''}`} autoFocus />
          {errors.name && <p className="form-error">{errors.name.message}</p>}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="form-group">
            <label className="label">SIRET</label>
            <input {...register('siret')} className="input" />
          </div>
          <div className="form-group">
            <label className="label">N° TVA</label>
            <input {...register('vatNumber')} className="input" placeholder="FR…" />
          </div>
        </div>

        <div className="form-group">
          <label className="label">Site web</label>
          <input {...register('website')} className="input" placeholder="https://" />
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
