import type { SearchSelectOption } from '../SearchSelect'
import { formatDate } from '../../../lib/utils'

/**
 * EntityPicker — types partagés entre le composant et les mini-modales de
 * création à la volée. Voir docs/superpowers/specs/2026-10-01-entity-picker-design.md
 */

export type PickerEntity = 'company' | 'contact' | 'equipment' | 'contract' | 'product'

export interface EntityPickerContext {
  /** Filtre et pré-remplissage pour contact / equipment / contract */
  companyId?: string | null
  /** Filtre et pré-remplissage pour product : catégorie (ex. CONTRACT_TEMPLATE) */
  productCategory?: string
  /** Filtre et pré-remplissage pour product : type (ex. software, hardware) */
  productType?: string
}

export interface QuickCreateModalProps {
  open: boolean
  onClose: () => void
  context?: EntityPickerContext
  onCreated: (option: SearchSelectOption) => void
}

interface EntityMeta {
  /** Segment de route REST (`GET/POST /<resource>`) */
  resource: string
  /** Permission RBAC requise pour afficher le bouton « + Créer » */
  permission: string
  /** Préfixe de clé TanStack Query de la liste correspondante (ex. `['companies']`) */
  listQueryKey: string
  /** Libellé générique de l'entité, pour les placeholders */
  label: string
  /** Libellé affiché après une création réussie (toast) */
  successLabel: string
  /** Placeholder par défaut du champ de recherche */
  searchPlaceholder: string
}

export const ENTITY_META: Record<PickerEntity, EntityMeta> = {
  company: {
    resource: 'companies',
    permission: 'companies:create',
    listQueryKey: 'companies',
    label: 'entreprise',
    successLabel: 'Entreprise créée',
    searchPlaceholder: 'Rechercher une entreprise…',
  },
  contact: {
    resource: 'contacts',
    permission: 'contacts:create',
    listQueryKey: 'contacts',
    label: 'contact',
    successLabel: 'Contact créé',
    searchPlaceholder: 'Rechercher un contact…',
  },
  equipment: {
    resource: 'equipment',
    permission: 'equipment:create',
    listQueryKey: 'equipment',
    label: 'équipement',
    successLabel: 'Équipement créé',
    searchPlaceholder: 'Rechercher un équipement…',
  },
  contract: {
    resource: 'contracts',
    permission: 'contracts:create',
    listQueryKey: 'contracts',
    label: 'contrat',
    successLabel: 'Contrat créé',
    searchPlaceholder: 'Rechercher un contrat…',
  },
  product: {
    resource: 'products',
    permission: 'products:create',
    listQueryKey: 'products',
    label: 'produit',
    successLabel: 'Produit créé',
    searchPlaceholder: 'Rechercher un produit…',
  },
}

// ── Construction des options SearchSelect depuis les objets bruts de l'API ──────
// L'objet brut complet est toujours porté dans `option.meta` (pré-remplissage
// dans les pages appelantes).

interface RawCompany {
  id: string
  name: string
  city?: string | null
}

export function companyToOption(raw: RawCompany): SearchSelectOption {
  return { id: raw.id, label: raw.name, sublabel: raw.city || undefined, meta: raw }
}

interface RawContact {
  id: string
  firstName: string
  lastName: string
  company?: { id: string; name: string } | null
}

export function contactToOption(raw: RawContact): SearchSelectOption {
  return {
    id: raw.id,
    label: `${raw.firstName} ${raw.lastName}`.trim(),
    sublabel: raw.company?.name,
    meta: raw,
  }
}

interface RawEquipment {
  id: string
  type: string
  brand?: string | null
  model?: string | null
  serialNumber?: string | null
}

export function equipmentToOption(raw: RawEquipment): SearchSelectOption {
  const label = [raw.brand, raw.model].filter(Boolean).join(' ') || raw.type
  return { id: raw.id, label, sublabel: raw.serialNumber || undefined, meta: raw }
}

interface RawContract {
  id: string
  title: string
  type?: string
  startDate?: string
  endDate?: string
}

export function contractToOption(raw: RawContract): SearchSelectOption {
  const dates = raw.startDate && raw.endDate
    ? `${formatDate(raw.startDate, 'dd/MM/yy')} → ${formatDate(raw.endDate, 'dd/MM/yy')}`
    : undefined
  const sublabel = [raw.type, dates].filter(Boolean).join(' · ') || undefined
  return { id: raw.id, label: raw.title, sublabel, meta: raw }
}

interface RawProduct {
  id: string
  name: string
  reference?: string | null
  price?: number
}

export function productToOption(raw: RawProduct): SearchSelectOption {
  const price = typeof raw.price === 'number' ? `${raw.price.toFixed(2)} € HT` : undefined
  const sublabel = [raw.reference || undefined, price].filter(Boolean).join(' · ') || undefined
  return { id: raw.id, label: raw.name, sublabel, meta: raw }
}
