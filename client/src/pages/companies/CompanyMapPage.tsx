import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import api from '../../lib/api'
import { Building2, Users, Ticket, MapPin, AlertCircle } from 'lucide-react'
import { PageSpinner } from '../../components/ui/Spinner'

// Fix Leaflet default icon paths (broken by bundlers)
delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl:       'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl:     'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
})

interface MapCompany {
  id: string
  name: string
  city: string
  lat: number
  lng: number
  sector: string
  _count: { contacts: number; tickets: number }
}

const SECTOR_COLORS: Record<string, string> = {
  'Informatique':           '#6366f1',
  'Santé':                  '#10b981',
  'Commerce alimentaire':   '#f59e0b',
  'Restauration':           '#ef4444',
  'Pharmacie':              '#3b82f6',
  'Immobilier':             '#8b5cf6',
  'Automobile':             '#64748b',
  'Commerce habillement':   '#ec4899',
}

function sectorColor(sector: string): string {
  return SECTOR_COLORS[sector] ?? '#6366f1'
}

function makeIcon(color: string, hasTickets: boolean): L.DivIcon {
  const ring = hasTickets ? `<circle cx="16" cy="16" r="14" fill="none" stroke="#ef4444" stroke-width="2.5" stroke-dasharray="4 2"/>` : ''
  return L.divIcon({
    className: '',
    iconSize: [32, 32],
    iconAnchor: [16, 32],
    popupAnchor: [0, -34],
    html: `<svg width="32" height="36" viewBox="0 0 32 36" xmlns="http://www.w3.org/2000/svg">
      ${ring}
      <path d="M16 2C10.477 2 6 6.477 6 12c0 7 10 20 10 20S26 19 26 12c0-5.523-4.477-10-10-10z" fill="${color}" stroke="white" stroke-width="2"/>
      <circle cx="16" cy="12" r="4" fill="white"/>
    </svg>`,
  })
}

export function CompanyMapPage() {
  const navigate = useNavigate()
  const mapRef    = useRef<HTMLDivElement>(null)
  const leafletRef = useRef<L.Map | null>(null)
  const [selected, setSelected] = useState<MapCompany | null>(null)
  const [showPanel, setShowPanel] = useState(false)

  const { data, isLoading, isError } = useQuery<MapCompany[]>({
    queryKey: ['companies-map'],
    queryFn: async () => { const { data } = await api.get('/companies/data/map'); return data.data ?? [] },
    staleTime: 60_000,
  })

  useEffect(() => {
    if (!mapRef.current || !data || leafletRef.current) return

    const map = L.map(mapRef.current, {
      center: [45.75, 4.85],
      zoom: 12,
      zoomControl: true,
    })

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(map)

    data.forEach(company => {
      const color = sectorColor(company.sector)
      const icon  = makeIcon(color, company._count.tickets > 0)
      const marker = L.marker([company.lat, company.lng], { icon })

      marker.bindTooltip(company.name, { permanent: false, direction: 'top', offset: [0, -32] })
      marker.on('click', () => { setSelected(company); setShowPanel(false) })
      marker.addTo(map)
    })

    if (data.length > 0) {
      const bounds = L.latLngBounds(data.map(c => [c.lat, c.lng]))
      map.fitBounds(bounds, { padding: [48, 48] })
    }

    leafletRef.current = map
    return () => { map.remove(); leafletRef.current = null }
  }, [data])

  // Stats
  const sectors   = data ? [...new Set(data.map(c => c.sector))].sort() : []
  const withTickets = data ? data.filter(c => c._count.tickets > 0).length : 0

  const renderSidePanel = (): React.ReactNode => (
    <>
      {/* Selected company */}
      {selected ? (
        <div className="p-4 border-b border-slate-100 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-slate-900">{selected.name}</p>
              <p className="text-xs text-slate-500 mt-0.5">{selected.city}</p>
            </div>
            <button onClick={() => setSelected(null)} className="text-slate-300 hover:text-slate-500 text-lg leading-none flex-shrink-0">×</button>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium px-2 py-0.5 rounded-full text-white" style={{ backgroundColor: sectorColor(selected.sector) }}>
              {selected.sector}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-slate-50 rounded-lg p-2.5 text-center">
              <div className="flex items-center justify-center gap-1 text-slate-400 mb-1">
                <Users className="w-3 h-3" />
                <span className="text-[10px] font-medium uppercase tracking-wide">Contacts</span>
              </div>
              <p className="text-xl font-bold text-slate-900">{selected._count.contacts}</p>
            </div>
            <div className={`rounded-lg p-2.5 text-center ${selected._count.tickets > 0 ? 'bg-red-50' : 'bg-slate-50'}`}>
              <div className={`flex items-center justify-center gap-1 mb-1 ${selected._count.tickets > 0 ? 'text-red-400' : 'text-slate-400'}`}>
                <Ticket className="w-3 h-3" />
                <span className="text-[10px] font-medium uppercase tracking-wide">Tickets</span>
              </div>
              <p className={`text-xl font-bold ${selected._count.tickets > 0 ? 'text-red-600' : 'text-slate-900'}`}>{selected._count.tickets}</p>
            </div>
          </div>
          <button onClick={() => navigate(`/companies/${selected.id}`)} className="w-full btn-primary text-sm py-2">
            Voir la fiche
          </button>
        </div>
      ) : (
        <div className="p-4 border-b border-slate-100">
          <p className="text-xs text-slate-400 text-center">Cliquez sur un marqueur pour voir les détails</p>
        </div>
      )}

      {/* Sectors legend */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Secteurs</p>
        <div className="space-y-1.5">
          {sectors.map(sector => {
            const count = data?.filter(c => c.sector === sector).length ?? 0
            return (
              <div key={sector} className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: sectorColor(sector) }} />
                  <span className="text-xs text-slate-600 truncate">{sector}</span>
                </div>
                <span className="text-xs font-medium text-slate-400 flex-shrink-0">{count}</span>
              </div>
            )
          })}
        </div>
        <div className="pt-3 border-t border-slate-100 space-y-1.5">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Légende</p>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <svg width="16" height="18" viewBox="0 0 32 36" className="flex-shrink-0">
              <path d="M16 2C10.477 2 6 6.477 6 12c0 7 10 20 10 20S26 19 26 12c0-5.523-4.477-10-10-10z" fill="#6366f1" stroke="white" strokeWidth="2"/>
              <circle cx="16" cy="12" r="4" fill="white"/>
            </svg>
            Entreprise géolocalisée
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <svg width="16" height="18" viewBox="0 0 32 36" className="flex-shrink-0">
              <circle cx="16" cy="16" r="14" fill="none" stroke="#ef4444" strokeWidth="2.5" strokeDasharray="4 2"/>
              <path d="M16 2C10.477 2 6 6.477 6 12c0 7 10 20 10 20S26 19 26 12c0-5.523-4.477-10-10-10z" fill="#6366f1" stroke="white" strokeWidth="2"/>
              <circle cx="16" cy="12" r="4" fill="white"/>
            </svg>
            Tickets en cours
          </div>
        </div>
        <div className="pt-3 border-t border-slate-100 space-y-1">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Toutes les entreprises</p>
          {data?.map(c => (
            <button
              key={c.id}
              onClick={() => { setSelected(c); setShowPanel(false) }}
              className={`w-full text-left px-2.5 py-2 rounded-lg hover:bg-slate-50 transition-colors flex items-center gap-2 ${selected?.id === c.id ? 'bg-indigo-50' : ''}`}
            >
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: sectorColor(c.sector) }} />
              <span className="text-xs text-slate-700 truncate flex-1">{c.name}</span>
              {c._count.tickets > 0 && <span className="text-[10px] font-bold text-red-500 flex-shrink-0">{c._count.tickets}</span>}
            </button>
          ))}
        </div>
      </div>
    </>
  )

  return (
    <div className="-m-4 md:-m-6 flex flex-col h-[calc(100vh-3.5rem)] fade-in">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 sm:px-6 py-3 sm:py-4 border-b border-slate-200 bg-white flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-indigo-100 flex items-center justify-center flex-shrink-0">
            <MapPin className="w-4 h-4 text-indigo-600" />
          </div>
          <div>
            <h1 className="text-base sm:text-lg font-semibold text-slate-900">Cartographie clients</h1>
            <p className="text-xs text-slate-500">Entreprises géolocalisées</p>
          </div>
        </div>
        {data && (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="flex items-center gap-1.5 text-slate-600">
              <Building2 className="w-4 h-4 text-indigo-500" />
              <strong className="text-slate-900">{data.length}</strong>
              <span className="hidden sm:inline">entreprise{data.length > 1 ? 's' : ''}</span>
            </span>
            <span className="flex items-center gap-1.5 text-slate-600">
              <Ticket className="w-4 h-4 text-red-400" />
              <strong className="text-slate-900">{withTickets}</strong>
              <span className="hidden sm:inline">avec tickets</span>
            </span>
            <span className="flex items-center gap-1.5 text-slate-600">
              <MapPin className="w-4 h-4 text-slate-400" />
              <strong className="text-slate-900">{sectors.length}</strong>
              <span className="hidden sm:inline">secteur{sectors.length > 1 ? 's' : ''}</span>
            </span>
            {/* Bouton liste — mobile uniquement */}
            <button
              onClick={() => setShowPanel(v => !v)}
              className="lg:hidden btn-secondary btn-sm flex items-center gap-1.5"
            >
              <Building2 className="w-3.5 h-3.5" />
              Liste
            </button>
          </div>
        )}
      </div>

      <div className="flex flex-1 overflow-hidden relative">
        {/* Map — pleine largeur sur mobile */}
        <div className="flex-1 relative">
          {isLoading && (
            <div className="absolute inset-0 flex items-center justify-center bg-slate-50 z-10">
              <PageSpinner />
            </div>
          )}
          {isError && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-slate-50 z-10">
              <AlertCircle className="w-10 h-10 text-red-400" />
              <p className="text-sm text-slate-500">Impossible de charger les données</p>
            </div>
          )}
          {data?.length === 0 && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-slate-50 z-10">
              <MapPin className="w-10 h-10 text-slate-300" />
              <p className="text-sm text-slate-500">Aucune entreprise géolocalisée</p>
              <p className="text-xs text-slate-400">Ajoutez des coordonnées lat/lng aux entreprises</p>
            </div>
          )}
          <div ref={mapRef} className="w-full h-full" />

          {/* Fiche entreprise sélectionnée — overlay bas sur mobile */}
          {selected && (
            <div className="lg:hidden absolute bottom-0 left-0 right-0 bg-white border-t border-slate-200 shadow-xl z-20 p-4 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-slate-900">{selected.name}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{selected.city}</p>
                </div>
                <button onClick={() => setSelected(null)} className="text-slate-300 hover:text-slate-500 text-lg leading-none flex-shrink-0">×</button>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium px-2 py-0.5 rounded-full text-white" style={{ backgroundColor: sectorColor(selected.sector) }}>
                  {selected.sector}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-slate-50 rounded-lg p-2.5 text-center">
                  <div className="flex items-center justify-center gap-1 text-slate-400 mb-1">
                    <Users className="w-3 h-3" />
                    <span className="text-[10px] font-medium uppercase tracking-wide">Contacts</span>
                  </div>
                  <p className="text-xl font-bold text-slate-900">{selected._count.contacts}</p>
                </div>
                <div className={`rounded-lg p-2.5 text-center ${selected._count.tickets > 0 ? 'bg-red-50' : 'bg-slate-50'}`}>
                  <div className={`flex items-center justify-center gap-1 mb-1 ${selected._count.tickets > 0 ? 'text-red-400' : 'text-slate-400'}`}>
                    <Ticket className="w-3 h-3" />
                    <span className="text-[10px] font-medium uppercase tracking-wide">Tickets</span>
                  </div>
                  <p className={`text-xl font-bold ${selected._count.tickets > 0 ? 'text-red-600' : 'text-slate-900'}`}>{selected._count.tickets}</p>
                </div>
              </div>
              <button onClick={() => navigate(`/companies/${selected.id}`)} className="w-full btn-primary text-sm py-2">
                Voir la fiche
              </button>
            </div>
          )}
        </div>

        {/* Panneau latéral — desktop toujours visible */}
        <div className="hidden lg:flex w-72 flex-shrink-0 border-l border-slate-200 bg-white flex-col overflow-hidden">
          {renderSidePanel()}
        </div>

        {/* Panneau mobile — overlay depuis la droite */}
        {showPanel && (
          <>
            <div className="lg:hidden fixed inset-0 bg-black/30 z-30" onClick={() => setShowPanel(false)} />
            <div className="lg:hidden absolute right-0 top-0 bottom-0 w-72 max-w-[85vw] bg-white border-l border-slate-200 flex flex-col overflow-hidden z-40 shadow-xl">
              <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
                <p className="text-sm font-semibold text-slate-800">Entreprises</p>
                <button onClick={() => setShowPanel(false)} className="text-slate-400 hover:text-slate-600">
                  <AlertCircle className="w-4 h-4" style={{ display: 'none' }} />
                  <span className="text-lg leading-none">×</span>
                </button>
              </div>
              {renderSidePanel()}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
