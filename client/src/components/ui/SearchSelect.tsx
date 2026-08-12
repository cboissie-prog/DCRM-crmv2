import { useEffect, useRef, useState } from 'react'
import { Search, X, Loader2, ChevronDown } from 'lucide-react'

export interface SearchSelectOption {
  id: string
  label: string
  sublabel?: string
  /** Données additionnelles libres portées par l'option (ex : entreprise d'un contact) */
  meta?: unknown
}

interface SearchSelectProps {
  value: string | null
  /** Libellé de l'option sélectionnée (affiché sans avoir à recharger la liste) */
  valueLabel?: string
  onChange: (id: string | null, option?: SearchSelectOption) => void
  /** Recherche distante — appelée avec la saisie debouncée (vide = premiers résultats) */
  onSearch: (query: string) => Promise<SearchSelectOption[]>
  placeholder?: string
  disabled?: boolean
}

/**
 * Combobox avec recherche distante : remplace les <select> limités aux 100
 * premiers enregistrements (contacts, entreprises…).
 */
export function SearchSelect({ value, valueLabel, onChange, onSearch, placeholder = 'Rechercher…', disabled }: SearchSelectProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [options, setOptions] = useState<SearchSelectOption[]>([])
  const [loading, setLoading] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Recherche debouncée
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    const t = setTimeout(() => {
      onSearch(query.trim())
        .then(res => { if (!cancelled) setOptions(res) })
        .catch(() => { if (!cancelled) setOptions([]) })
        .finally(() => { if (!cancelled) setLoading(false) })
    }, 250)
    return () => { cancelled = true; clearTimeout(t) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, open])

  // Fermeture au clic extérieur
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  const openDropdown = () => {
    if (disabled) return
    setOpen(true)
    setQuery('')
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  return (
    <div ref={rootRef} className="relative">
      {!open ? (
        <button
          type="button"
          disabled={disabled}
          onClick={openDropdown}
          className="input w-full flex items-center gap-2 cursor-pointer text-left disabled:opacity-60"
        >
          <span className={`flex-1 truncate ${value ? 'text-slate-800' : 'text-slate-400'}`}>
            {value ? (valueLabel ?? value) : placeholder}
          </span>
          {value ? (
            <span
              role="button"
              tabIndex={0}
              className="p-0.5 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600"
              onClick={e => { e.stopPropagation(); onChange(null) }}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); onChange(null) } }}
              title="Effacer"
            >
              <X className="w-3.5 h-3.5" />
            </span>
          ) : (
            <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
          )}
        </button>
      ) : (
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={placeholder}
            className="input pl-9 w-full"
          />
          {loading && <Loader2 className="w-4 h-4 text-slate-400 animate-spin absolute right-3 top-1/2 -translate-y-1/2" />}
        </div>
      )}

      {open && (
        <div className="absolute z-30 mt-1 w-full bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden max-h-60 overflow-y-auto">
          {options.length === 0 && !loading ? (
            <p className="px-4 py-3 text-sm text-slate-400">Aucun résultat</p>
          ) : (
            options.map(o => (
              <button
                key={o.id}
                type="button"
                onClick={() => { onChange(o.id, o); setOpen(false) }}
                className={`w-full px-4 py-2 text-left hover:bg-indigo-50 transition-colors text-sm ${o.id === value ? 'bg-indigo-50/60' : ''}`}
              >
                <span className="block text-slate-800 truncate">{o.label}</span>
                {o.sublabel && <span className="block text-xs text-slate-400 truncate">{o.sublabel}</span>}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
