import { useQuery } from '@tanstack/react-query'
import { Users, UserPlus } from 'lucide-react'
import api from '../../lib/api'
import { cn } from '../../lib/utils'
import { CompanySearchInput } from './CompanySearchInput'
import { EMPTY_PICKER_COMPANY, type ContactPickerCompany, type ContactPickerValue } from '../../lib/contactPicker'

/**
 * Bloc « Contact » réutilisable dans les formulaires de création (lead, ticket…) :
 * bascule contact existant / nouveau contact, avec rattachement à une entreprise
 * existante ou création d'une entreprise à la volée (recherche SIREN pré-remplie).
 *
 * Composant contrôlé : le parent tient le `ContactPickerValue` et le passe à
 * `resolveContactPicker` (lib/contactPicker) à la soumission pour créer
 * entreprise + contact si besoin.
 */
export function ContactInlinePicker({
  value,
  onChange,
  active = true,
  allowNone = false,
  error,
}: {
  value: ContactPickerValue
  onChange: (v: ContactPickerValue) => void
  /** false tant que la modale est fermée : évite de charger les listes inutilement */
  active?: boolean
  /** true : l'option « — Aucun — » est proposée en mode contact existant (ticket) */
  allowNone?: boolean
  error?: string | null
}) {
  const set = (patch: Partial<ContactPickerValue>) => onChange({ ...value, ...patch })
  const setCompany = (patch: Partial<ContactPickerCompany>) => onChange({ ...value, company: { ...value.company, ...patch } })

  const { data: contacts = [] } = useQuery<{ id: string; firstName: string; lastName: string; company?: { name: string } }[]>({
    queryKey: ['contacts-light'],
    queryFn: async () => {
      const { data } = await api.get('/contacts', { params: { limit: 200 } })
      return data.data ?? []
    },
    enabled: active,
    staleTime: 60_000,
  })

  const { data: companies = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['companies-light'],
    queryFn: async () => {
      const { data } = await api.get('/companies', { params: { limit: 200 } })
      return data.data ?? []
    },
    enabled: active && value.mode === 'new',
    staleTime: 60_000,
  })

  return (
    <div>
      <div className="flex rounded-lg border border-slate-200 overflow-hidden mb-3">
        <button
          type="button"
          onClick={() => set({ mode: 'existing' })}
          className={cn(
            'flex-1 flex items-center justify-center gap-1.5 py-2 text-sm font-medium transition-colors',
            value.mode === 'existing' ? 'bg-primary-600 text-white' : 'bg-white text-slate-500 hover:bg-slate-50',
          )}
        >
          <Users className="w-3.5 h-3.5" /> Contact existant
        </button>
        <button
          type="button"
          onClick={() => set({ mode: 'new' })}
          className={cn(
            'flex-1 flex items-center justify-center gap-1.5 py-2 text-sm font-medium transition-colors',
            value.mode === 'new' ? 'bg-primary-600 text-white' : 'bg-white text-slate-500 hover:bg-slate-50',
          )}
        >
          <UserPlus className="w-3.5 h-3.5" /> Nouveau contact
        </button>
      </div>

      {value.mode === 'existing' ? (
        <select
          value={value.contactId}
          onChange={e => set({ contactId: e.target.value })}
          className={`input ${error ? 'input-error' : ''}`}
        >
          <option value="">{allowNone ? '— Aucun —' : 'Choisir un contact'}</option>
          {contacts.map(c => (
            <option key={c.id} value={c.id}>
              {c.firstName} {c.lastName}{c.company ? ` — ${c.company.name}` : ''}
            </option>
          ))}
        </select>
      ) : (
        <div className="space-y-3 p-3 bg-slate-50 rounded-xl border border-slate-100">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input
              value={value.firstName}
              onChange={e => set({ firstName: e.target.value })}
              placeholder="Prénom *"
              className={`input ${error ? 'input-error' : ''}`}
            />
            <input value={value.lastName} onChange={e => set({ lastName: e.target.value })} placeholder="Nom" className="input" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input value={value.email} onChange={e => set({ email: e.target.value })} type="email" placeholder="Email" className="input" />
            <input value={value.phone} onChange={e => set({ phone: e.target.value })} placeholder="Téléphone" className="input" />
          </div>

          {value.companyMode === 'new' ? (
            <div className="space-y-2 p-3 bg-white rounded-xl border border-slate-200">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">Nouvelle entreprise</span>
                <button
                  type="button"
                  onClick={() => onChange({ ...value, companyMode: 'existing', company: { ...EMPTY_PICKER_COMPANY } })}
                  className="text-xs text-slate-400 hover:text-slate-700"
                >
                  ✕ Annuler
                </button>
              </div>
              <CompanySearchInput onSelect={p => onChange({
                ...value,
                company: {
                  ...value.company,
                  name: p.name,
                  siret: p.siret,
                  vatNumber: p.vatNumber,
                  sector: p.activity,
                  city: p.city,
                  postalCode: p.postalCode,
                  billingAddress: p.billingAddress,
                },
              })} />
              <input value={value.company.name} onChange={e => setCompany({ name: e.target.value })} placeholder="Nom de l'entreprise *" className="input" autoFocus />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <input value={value.company.siret} onChange={e => setCompany({ siret: e.target.value })} placeholder="SIRET" className="input" />
                <input value={value.company.vatNumber} onChange={e => setCompany({ vatNumber: e.target.value })} placeholder="N° TVA" className="input" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <input value={value.company.website} onChange={e => setCompany({ website: e.target.value })} placeholder="Site web" className="input" />
                <input value={value.company.sector} onChange={e => setCompany({ sector: e.target.value })} placeholder="Secteur d'activité" className="input" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <input value={value.company.city} onChange={e => setCompany({ city: e.target.value })} placeholder="Ville" className="input" />
                <input value={value.company.postalCode} onChange={e => setCompany({ postalCode: e.target.value })} placeholder="Code postal" className="input" />
              </div>
              <input value={value.company.billingAddress} onChange={e => setCompany({ billingAddress: e.target.value })} placeholder="Adresse de facturation" className="input" />
            </div>
          ) : (
            <div className="flex gap-2">
              <select value={value.companyId} onChange={e => set({ companyId: e.target.value })} className="input flex-1">
                <option value="">Entreprise existante</option>
                {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <button
                type="button"
                onClick={() => set({ companyMode: 'new', companyId: '' })}
                className="btn-secondary text-xs px-2 whitespace-nowrap"
              >
                + Nouvelle
              </button>
            </div>
          )}
        </div>
      )}
      {error && <p className="form-error">{error}</p>}
    </div>
  )
}
