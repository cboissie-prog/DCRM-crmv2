import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search, Building2, Loader2 } from 'lucide-react'
import api from '../../lib/api'

/**
 * Recherche d'entreprise française via l'API publique gouv « Recherche
 * d'entreprises » (proxy serveur /companies/entreprises/search — gratuite,
 * sans clé). Les résultats embarquent la fiche complète : la sélection
 * remonte directement l'objet de pré-remplissage au parent via onSelect.
 */

export interface SocietePrefill {
  siren:          string
  name:           string
  siret:          string
  vatNumber:      string
  billingAddress: string
  city:           string
  postalCode:     string
  country:        string
  activity:       string   // code NAF (ex: 77.33Z)
  status:         string   // 'A' = active
}

export function CompanySearchInput({ onSelect }: { onSelect: (prefill: SocietePrefill) => void }) {
  const [query, setQuery]         = useState('')
  const [debounced, setDebounced] = useState('')
  const [open, setOpen]           = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  // Debounce de la saisie (l'API publique est limitée à 7 req/s par IP)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 350)
    return () => clearTimeout(t)
  }, [query])

  const { data: resultsData, isFetching } = useQuery<{ data: SocietePrefill[] }>({
    queryKey: ['entreprises-search', debounced],
    queryFn: async () => {
      const { data } = await api.get('/companies/entreprises/search', { params: { q: debounced } })
      return data
    },
    enabled: debounced.length >= 3,
    staleTime: 60_000,
  })
  const results = debounced.length >= 3 ? (resultsData?.data ?? []) : []

  // Fermeture au clic extérieur
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  const pick = (r: SocietePrefill) => {
    onSelect(r)
    setOpen(false)
    setQuery('')
  }

  return (
    <div ref={rootRef} className="relative">
      <div className="relative">
        <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          placeholder="Rechercher une entreprise (nom ou SIREN, min. 3 caractères)…"
          className="input pl-9"
        />
        {isFetching && <Loader2 className="w-4 h-4 text-slate-400 animate-spin absolute right-3 top-1/2 -translate-y-1/2" />}
      </div>

      {open && debounced.length >= 3 && (
        <div className="absolute z-30 mt-1 w-full bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden max-h-72 overflow-y-auto">
          {results.length === 0 && !isFetching ? (
            <p className="px-4 py-3 text-sm text-slate-400">Aucune entreprise trouvée</p>
          ) : (
            results.map(r => (
              <button
                key={r.siren}
                type="button"
                onClick={() => pick(r)}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-indigo-50 transition-colors border-b border-slate-50 last:border-b-0"
              >
                <Building2 className="w-4 h-4 text-slate-300 flex-shrink-0" />
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-medium text-slate-800 truncate">{r.name}</span>
                  <span className="block text-xs text-slate-400 truncate">
                    SIREN {r.siren}
                    {r.city && ` · ${r.postalCode} ${r.city}`}
                    {r.activity && ` · NAF ${r.activity}`}
                  </span>
                </span>
                {r.status && r.status !== 'A' && (
                  <span className="text-[10px] font-semibold text-red-500 bg-red-50 px-1.5 py-0.5 rounded-full flex-shrink-0">Fermée</span>
                )}
              </button>
            ))
          )}
          <p className="px-4 py-1.5 text-[10px] text-slate-300 bg-slate-50">Données publiques — annuaire-entreprises.data.gouv.fr</p>
        </div>
      )}
    </div>
  )
}
