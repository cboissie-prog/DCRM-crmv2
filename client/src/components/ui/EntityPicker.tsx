import { useState, type ComponentType } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import api from '../../lib/api'
import { usePermission } from '../../hooks/usePermission'
import { toast } from './Toast'
import { SearchSelect, type SearchSelectOption } from './SearchSelect'
import {
  ENTITY_META,
  companyToOption,
  contactToOption,
  equipmentToOption,
  contractToOption,
  productToOption,
  type PickerEntity,
  type EntityPickerContext,
  type QuickCreateModalProps,
} from './quick-create/types'
import { QuickCompanyModal } from './quick-create/QuickCompanyModal'
import { QuickContactModal } from './quick-create/QuickContactModal'
import { QuickEquipmentModal } from './quick-create/QuickEquipmentModal'
import { QuickContractModal } from './quick-create/QuickContractModal'
import { QuickProductModal } from './quick-create/QuickProductModal'

export type { PickerEntity, EntityPickerContext }

export interface EntityPickerProps {
  entity: PickerEntity
  value: string | null
  /** Libellé de la valeur courante, pour l'afficher sans recharger (édition) */
  valueLabel?: string
  onChange: (id: string | null, option?: SearchSelectOption) => void
  context?: EntityPickerContext
  /** Indicatif : le champ est optionnel. SearchSelect permet toujours d'effacer la valeur (bouton ×) ; la prop documente l'intention côté formulaire. */
  allowNone?: boolean
  disabled?: boolean
  placeholder?: string
  error?: string
  /** Masque le bouton « + Créer » même avec la permission (ex. profondeur 2) */
  noCreate?: boolean
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const TO_OPTION: Record<PickerEntity, (raw: any) => SearchSelectOption> = {
  company: companyToOption,
  contact: contactToOption,
  equipment: equipmentToOption,
  contract: contractToOption,
  product: productToOption,
}

const QUICK_MODALS: Record<PickerEntity, ComponentType<QuickCreateModalProps>> = {
  company: QuickCompanyModal,
  contact: QuickContactModal,
  equipment: QuickEquipmentModal,
  contract: QuickContractModal,
  product: QuickProductModal,
}

/**
 * Sélecteur d'entité unique (entreprise / contact / équipement / contrat /
 * produit) : recherche serveur via SearchSelect + création à la volée dans
 * une mini-modale empilée si l'utilisateur a la permission `<entité>:create`.
 *
 * Voir docs/superpowers/specs/2026-10-01-entity-picker-design.md §3.
 */
export function EntityPicker({
  entity,
  value,
  valueLabel,
  onChange,
  context,
  disabled,
  placeholder,
  error,
  noCreate,
}: EntityPickerProps) {
  const qc = useQueryClient()
  const meta = ENTITY_META[entity]
  const canCreate = usePermission(meta.permission)
  const [createOpen, setCreateOpen] = useState(false)

  const handleSearch = async (query: string): Promise<SearchSelectOption[]> => {
    const params: Record<string, string | number> = { search: query, limit: 20 }
    if ((entity === 'contact' || entity === 'equipment' || entity === 'contract') && context?.companyId) {
      params.companyId = context.companyId
    }
    if (entity === 'product') {
      if (context?.productCategory) params.category = context.productCategory
      else if (context?.productCategories?.length) params.category = context.productCategories.join(',')
      if (context?.productType) params.type = context.productType
      params.isActive = 'true'
    }
    const { data } = await api.get(`/${meta.resource}`, { params })
    const rows = (data?.data ?? []) as unknown[]
    return rows.map(TO_OPTION[entity])
  }

  const handleCreated = (option: SearchSelectOption) => {
    qc.invalidateQueries({ queryKey: [meta.listQueryKey] })
    toast.success(meta.successLabel)
    setCreateOpen(false)
    onChange(option.id, option)
  }

  const QuickModal = QUICK_MODALS[entity]
  const showCreateButton = canCreate && !noCreate

  return (
    <div>
      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0">
          <SearchSelect
            value={value}
            valueLabel={valueLabel}
            onChange={onChange}
            onSearch={handleSearch}
            placeholder={placeholder ?? meta.searchPlaceholder}
            disabled={disabled}
          />
        </div>
        {showCreateButton && (
          <button
            type="button"
            className="btn-secondary shrink-0 inline-flex items-center gap-1.5"
            onClick={() => setCreateOpen(true)}
            disabled={disabled}
          >
            <Plus className="w-4 h-4" />
            Créer
          </button>
        )}
      </div>
      {error && <p className="text-xs text-red-600 mt-1">{error}</p>}

      {showCreateButton && createOpen && (
        <QuickModal
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          context={context}
          onCreated={handleCreated}
        />
      )}
    </div>
  )
}
