import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search, Building2, Loader2 } from 'lucide-react'
import api from '../../lib/api'
import { toast } from './Toast'

/**
 * Recherche d'entreprise via societe.com (proxy serveur /companies/societe/*).
 * S'affiche uniquement si le serveur a un token configuré (SOCIETE_API_TOKEN).
 * À la sélection d'un résultat, récupère la fiche légale et remonte un objet
 * de pré-remplissage au parent via onSelect.
 */

export interface SocietePrefill {
  name:           string
  siret:          string
  vatNumber:      string
  billingAddress: string
  city:           string
  postalCode:     string
  country:        string
  activity:       string
}

interface SearchResult {
  siren:      string
  name:       string
  activity:   string
  city:       string
  postalCode: string
  status:     string
}

export function CompanySearchInput({ onSelect }: { onSelect: (prefill: SocietePrefill) => void }) {
  const [query, setQuery]         = useState('')
  const [debounced, setDebounced] = useState('')
  const [open, setOpen]           = useState(false)
  const [fetchingSiren, setFetchingSiren] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  // Recherche disponible ? (token configuré côté serveur)
  const { data: statusData } = useQuery<{ data: { enabled: boolean } }>({
    queryKey: ['societe-status'],
    queryFn: async () => { const { data } = await api.get('/companies/societe/status'); return data },
    staleTime: Infinity,
  })
  const enabled = statusData?.data.enabled ?? false

  // Debounce de la saisie (l'API est limitée à 60 req/min)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 350)
    return () => clearTimeout(t)
  }, [query])

  const { data: resultsData, isFetching } = useQuery<{ data: SearchResult[] }>({
    queryKey: ['societe-search', debounced],
    queryFn: async () => {
      const { data } = await api.get('/companies/societe/search', { params: { q: debounced } })
      return data
    },
    enabled: enabled && debounced.length >= 3,
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

  if (!enabled) return null

  const pick = async (r: SearchResult) => {
    setFetchingSiren(r.siren)
    try {
      const { data } = await api.get(`/companies/societe/${r.siren}`)
      onSelect(data.data as SocietePrefill)
      setOpen(false)
      setQuery('')
    } catch {
      toast.error('Fiche societe.com indisponible pour cette entreprise')
    } finally {
      setFetchingSiren(null)
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <div className="relative">
        <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          placeholder="Rechercher sur societe.com (nom, min. 3 caractères)…"
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
                disabled={fetchingSiren !== null}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-indigo-50 transition-colors disabled:opacity-50 border-b border-slate-50 last:border-b-0"
              >
                <Building2 className="w-4 h-4 text-slate-300 flex-shrink-0" />
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-medium text-slate-800 truncate">{r.name}</span>
                  <span className="block text-xs text-slate-400 truncate">
                    SIREN {r.siren}
                    {r.city && ` · ${r.postalCode} ${r.city}`}
                    {r.activity && ` · ${r.activity}`}
                  </span>
                </span>
                {fetchingSiren === r.siren
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-500 flex-shrink-0" />
                  : r.status && r.status !== 'active' && (
                      <span className="text-[10px] font-semibold text-red-500 bg-red-50 px-1.5 py-0.5 rounded-full flex-shrink-0">Fermée</span>
                    )}
              </button>
            ))
          )}
          <p className="px-4 py-1.5 text-[10px] text-slate-300 bg-slate-50">Données societe.com</p>
        </div>
      )}
    </div>
  )
}
