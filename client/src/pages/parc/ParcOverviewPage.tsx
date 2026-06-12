import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import api from '../../lib/api'
import { PageSpinner } from '../../components/ui/Spinner'
import { Monitor, Key, FileText, AlertTriangle, Building2, ChevronRight, MapPin, CheckCircle2 } from 'lucide-react'

interface ParcCompany {
  id: string
  name: string
  city?: string
  sector?: string
  equipmentCount: number
  licenseCount: number
  contractCount: number
  activeContracts: number
  warrantyExpired: number
  warrantyExpiring: number
  licenseExpired: number
  licenseExpiring: number
  alertCount: number
}

export function ParcOverviewPage() {
  const navigate = useNavigate()

  const { data, isLoading } = useQuery<{ data: ParcCompany[] }>({
    queryKey: ['parc-overview'],
    queryFn: async () => { const { data } = await api.get('/parc/overview'); return data },
    staleTime: 30_000,
  })

  const companies = data?.data ?? []
  const totalAlerts = companies.reduce((s, c) => s + c.alertCount, 0)
  const withAlerts = companies.filter(c => c.alertCount > 0).length

  if (isLoading) return <PageSpinner />

  return (
    <div className="space-y-6 fade-in">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Parc informatique</h1>
          <p className="page-subtitle">{companies.length} client{companies.length !== 1 ? 's' : ''} · {totalAlerts} alerte{totalAlerts !== 1 ? 's' : ''}</p>
        </div>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4 flex items-center gap-3">
          <div className="w-9 h-9 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0">
            <Building2 className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <p className="text-xs text-slate-500">Clients</p>
            <p className="text-xl font-bold text-slate-900">{companies.length}</p>
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4 flex items-center gap-3">
          <div className="w-9 h-9 bg-slate-100 rounded-lg flex items-center justify-center flex-shrink-0">
            <Monitor className="w-5 h-5 text-slate-600" />
          </div>
          <div>
            <p className="text-xs text-slate-500">Équipements</p>
            <p className="text-xl font-bold text-slate-900">{companies.reduce((s, c) => s + c.equipmentCount, 0)}</p>
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4 flex items-center gap-3">
          <div className="w-9 h-9 bg-purple-100 rounded-lg flex items-center justify-center flex-shrink-0">
            <Key className="w-5 h-5 text-purple-600" />
          </div>
          <div>
            <p className="text-xs text-slate-500">Licences</p>
            <p className="text-xl font-bold text-slate-900">{companies.reduce((s, c) => s + c.licenseCount, 0)}</p>
          </div>
        </div>
        <div className={`border rounded-xl p-4 flex items-center gap-3 ${withAlerts > 0 ? 'bg-red-50 border-red-200' : 'bg-emerald-50 border-emerald-200'}`}>
          <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${withAlerts > 0 ? 'bg-red-100' : 'bg-emerald-100'}`}>
            {withAlerts > 0
              ? <AlertTriangle className="w-5 h-5 text-red-600" />
              : <CheckCircle2 className="w-5 h-5 text-emerald-600" />
            }
          </div>
          <div>
            <p className={`text-xs ${withAlerts > 0 ? 'text-red-600' : 'text-emerald-600'}`}>Alertes</p>
            <p className={`text-xl font-bold ${withAlerts > 0 ? 'text-red-700' : 'text-emerald-700'}`}>{totalAlerts}</p>
          </div>
        </div>
      </div>

      {/* Company cards */}
      {companies.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <Monitor className="w-12 h-12 mx-auto mb-3 text-slate-200" />
          <p className="text-sm font-medium">Aucun parc client trouvé</p>
          <p className="text-xs mt-1">Ajoutez des équipements, licences ou contrats à une entreprise pour les voir apparaître ici</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {companies.map(c => (
            <CompanyCard key={c.id} company={c} onClick={() => navigate(`/parc/${c.id}`)} />
          ))}
        </div>
      )}
    </div>
  )
}

function CompanyCard({ company: c, onClick }: { company: ParcCompany; onClick: () => void }) {
  const hasAlerts = c.alertCount > 0

  return (
    <div
      onClick={onClick}
      className={`bg-white rounded-xl border shadow-sm cursor-pointer hover:shadow-md transition-all group
        ${hasAlerts ? 'border-red-200 hover:border-red-300' : 'border-slate-200 hover:border-primary-300'}`}
    >
      {/* Card header */}
      <div className="px-5 pt-4 pb-3 flex items-start justify-between">
        <div className="flex items-start gap-3 min-w-0">
          <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5
            ${hasAlerts ? 'bg-red-100' : 'bg-slate-100'}`}>
            <Building2 className={`w-5 h-5 ${hasAlerts ? 'text-red-600' : 'text-slate-500'}`} />
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-slate-900 truncate group-hover:text-primary-700 transition-colors">{c.name}</p>
            {(c.city || c.sector) && (
              <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-1 truncate">
                {c.city && <><MapPin className="w-3 h-3 flex-shrink-0" />{c.city}</>}
                {c.city && c.sector && <span className="mx-1">·</span>}
                {c.sector && c.sector}
              </p>
            )}
          </div>
        </div>
        <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-primary-500 flex-shrink-0 mt-1 transition-colors" />
      </div>

      {/* Alert banner */}
      {hasAlerts && (
        <div className="mx-4 mb-3 px-3 py-2 bg-red-50 border border-red-100 rounded-lg">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />
            <div className="text-xs text-red-700 space-y-0.5">
              {c.warrantyExpired > 0 && (
                <p>{c.warrantyExpired} garantie{c.warrantyExpired > 1 ? 's' : ''} expirée{c.warrantyExpired > 1 ? 's' : ''}</p>
              )}
              {c.warrantyExpiring > 0 && (
                <p>{c.warrantyExpiring} garantie{c.warrantyExpiring > 1 ? 's' : ''} bientôt expirée{c.warrantyExpiring > 1 ? 's' : ''}</p>
              )}
              {c.licenseExpired > 0 && (
                <p>{c.licenseExpired} licence{c.licenseExpired > 1 ? 's' : ''} expirée{c.licenseExpired > 1 ? 's' : ''}</p>
              )}
              {c.licenseExpiring > 0 && (
                <p>{c.licenseExpiring} licence{c.licenseExpiring > 1 ? 's' : ''} bientôt expirée{c.licenseExpiring > 1 ? 's' : ''}</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Counters */}
      <div className="px-4 pb-4 grid grid-cols-3 gap-2">
        <Counter icon={<Monitor className="w-3.5 h-3.5" />} label="Équipements" value={c.equipmentCount} />
        <Counter icon={<Key className="w-3.5 h-3.5" />} label="Licences" value={c.licenseCount} />
        <Counter icon={<FileText className="w-3.5 h-3.5" />} label="Contrats actifs" value={c.activeContracts} total={c.contractCount} />
      </div>
    </div>
  )
}

function Counter({ icon, label, value, total }: { icon: React.ReactNode; label: string; value: number; total?: number }) {
  return (
    <div className="bg-slate-50 rounded-lg px-2.5 py-2 text-center">
      <div className="flex items-center justify-center gap-1 text-slate-400 mb-1">{icon}</div>
      <p className="text-base font-bold text-slate-800">
        {value}
        {total !== undefined && total !== value && <span className="text-xs font-normal text-slate-400">/{total}</span>}
      </p>
      <p className="text-xs text-slate-400 leading-tight">{label}</p>
    </div>
  )
}
