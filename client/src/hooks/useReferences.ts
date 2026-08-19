import { useQuery } from '@tanstack/react-query'
import api from '../lib/api'

/**
 * Référentiels personnalisables (Réglages > Listes) — remplace les anciennes
 * constantes en dur de lib/utils.ts pour les domaines gérés en base :
 * ticket_category, call_category, equipment_type, equipment_status,
 * contract_type, license_type, contact_status, lead_source, sector,
 * appointment_type, knowledge_category, product_category.
 *
 * Une seule requête GET /references pour toute l'app (cache 5 min).
 * Les valeurs désactivées restent résolues en libellé (données anciennes)
 * mais sont exclues des options de formulaire.
 */

export interface ReferenceValue {
  id: string
  key: string
  label: string
  color: string | null
  icon: string | null
  order: number
  isActive: boolean
  isSystem: boolean
  meta: Record<string, unknown> | null
}

export interface ReferenceDomainData {
  domain: string
  label: string
  description: string
  validate: boolean
  keyStyle: 'code' | 'free'
  hasColor: boolean
  hasIcon: boolean
  values: ReferenceValue[]
}

export function useReferencesQuery() {
  return useQuery<ReferenceDomainData[]>({
    queryKey: ['references'],
    queryFn: async () => {
      const { data } = await api.get('/references')
      return data.data as ReferenceDomainData[]
    },
    staleTime: 5 * 60_000,
  })
}

export interface ReferencesHelpers {
  isLoading: boolean
  /** Domaines complets (page Réglages). */
  domains: ReferenceDomainData[]
  /** Valeurs actives d'un domaine, triées — pour les selects/filtres. */
  values: (domain: string) => ReferenceValue[]
  /** Options {value,label} actives d'un domaine. */
  options: (domain: string) => { value: string; label: string }[]
  /** Libellé d'une clé (actives ET désactivées) — fallback : la clé brute. */
  label: (domain: string, key: string | null | undefined) => string
  /** Jeton couleur d'une clé (blue, green, …) ou null. */
  color: (domain: string, key: string | null | undefined) => string | null
  /** Nom d'icône lucide d'une clé ou null. */
  icon: (domain: string, key: string | null | undefined) => string | null
  /** Meta JSON d'une clé (ex: isPhysical des catégories produit). */
  meta: (domain: string, key: string | null | undefined) => Record<string, unknown> | null
  /** Valeur complète d'une clé (actives ET désactivées). */
  get: (domain: string, key: string | null | undefined) => ReferenceValue | undefined
}

export function useReferences(): ReferencesHelpers {
  const { data, isLoading } = useReferencesQuery()
  const domains = data ?? []

  const domainData = (domain: string) => domains.find(d => d.domain === domain)
  const get = (domain: string, key: string | null | undefined) =>
    key ? domainData(domain)?.values.find(v => v.key === key) : undefined

  return {
    isLoading,
    domains,
    values: (domain) => (domainData(domain)?.values ?? []).filter(v => v.isActive),
    options: (domain) => (domainData(domain)?.values ?? [])
      .filter(v => v.isActive)
      .map(v => ({ value: v.key, label: v.label })),
    label: (domain, key) => (key ? get(domain, key)?.label ?? key : ''),
    color: (domain, key) => get(domain, key)?.color ?? null,
    icon: (domain, key) => get(domain, key)?.icon ?? null,
    meta: (domain, key) => get(domain, key)?.meta ?? null,
    get,
  }
}
