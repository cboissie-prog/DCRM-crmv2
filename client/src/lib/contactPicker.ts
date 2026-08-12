import api from './api'

/**
 * Types et logique du bloc « Contact » réutilisable (ContactInlinePicker) :
 * valeur contrôlée, validation, et création entreprise + contact à la volée.
 */

export interface ContactPickerCompany {
  name: string
  siret: string
  vatNumber: string
  website: string
  sector: string
  city: string
  postalCode: string
  billingAddress: string
}

export interface ContactPickerValue {
  mode: 'existing' | 'new'
  contactId: string
  firstName: string
  lastName: string
  email: string
  phone: string
  companyMode: 'existing' | 'new'
  companyId: string
  company: ContactPickerCompany
}

export const EMPTY_PICKER_COMPANY: ContactPickerCompany = {
  name: '', siret: '', vatNumber: '', website: '',
  sector: '', city: '', postalCode: '', billingAddress: '',
}

export function makeContactPickerValue(init?: Partial<ContactPickerValue>): ContactPickerValue {
  return {
    mode: 'existing',
    contactId: '',
    firstName: '', lastName: '', email: '', phone: '',
    companyMode: 'existing',
    companyId: '',
    company: { ...EMPTY_PICKER_COMPANY },
    ...init,
  }
}

/** « Jean Michel Dupont » → { firstName: 'Jean', lastName: 'Michel Dupont' } */
export function splitFullName(full?: string | null): { firstName: string; lastName: string } {
  const parts = (full ?? '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return { firstName: '', lastName: '' }
  if (parts.length === 1) return { firstName: parts[0], lastName: '' }
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') }
}

/** 0033601020304 / +33601020304 → 0601020304 (format national lisible) */
export function toNationalPhone(num?: string | null): string {
  if (!num) return ''
  const cleaned = num.replace(/[^\d+]/g, '')
  if (cleaned.startsWith('0033')) return '0' + cleaned.slice(4)
  if (cleaned.startsWith('+33')) return '0' + cleaned.slice(3)
  return num
}

/** Retourne un message d'erreur, ou null si la valeur est soumissible. */
export function validateContactPicker(v: ContactPickerValue, required: boolean): string | null {
  if (v.mode === 'existing') {
    if (required && !v.contactId) return 'Sélectionnez un contact'
    return null
  }
  if (!v.firstName.trim()) return 'Prénom du nouveau contact requis'
  return null
}

/**
 * Crée l'entreprise puis le contact si nécessaire.
 * Retourne les ids à utiliser dans l'entité parente (lead, ticket…).
 */
export async function resolveContactPicker(v: ContactPickerValue): Promise<{ contactId?: string; companyId?: string }> {
  if (v.mode === 'existing') return { contactId: v.contactId || undefined }

  let companyId = v.companyMode === 'existing' ? (v.companyId || undefined) : undefined
  if (v.companyMode === 'new' && v.company.name.trim()) {
    const { data } = await api.post('/companies', {
      name: v.company.name.trim(),
      siret: v.company.siret || undefined,
      vatNumber: v.company.vatNumber || undefined,
      website: v.company.website || undefined,
      sector: v.company.sector || undefined,
      city: v.company.city || undefined,
      postalCode: v.company.postalCode || undefined,
      billingAddress: v.company.billingAddress || undefined,
    })
    companyId = data.data?.id
  }

  const { data } = await api.post('/contacts', {
    firstName: v.firstName.trim(),
    lastName: v.lastName.trim(),
    email: v.email.trim() || undefined,
    phone: v.phone.trim() || undefined,
    companyId: companyId || undefined,
  })
  return { contactId: data.data?.id, companyId }
}
