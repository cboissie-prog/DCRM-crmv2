import { useSearchParams } from 'react-router-dom'
import { Sun, List as ListIcon, BarChart3 } from 'lucide-react'
import { cn } from '../../lib/utils'
import { MyDayTab } from './MyDayTab'
import { ListsTab } from './ListsTab'
import { StatsTab } from './StatsTab'

type Tab = 'myday' | 'lists' | 'stats'

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'myday', label: 'Ma journée', icon: <Sun className="w-4 h-4" /> },
  { id: 'lists', label: 'Listes', icon: <ListIcon className="w-4 h-4" /> },
  { id: 'stats', label: 'Suivi', icon: <BarChart3 className="w-4 h-4" /> },
]

/**
 * Page Prospection — onglets Ma journée · Listes · Suivi (spec §5 « Navigation »).
 * Onglet piloté par `?tab=` pour rester lien-partageable (cf. `/pipeline?view=list`).
 */
export function ProspectionPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const tab = (searchParams.get('tab') as Tab) ?? 'myday'
  const current: Tab = TABS.some(t => t.id === tab) ? tab : 'myday'

  const setTab = (id: Tab) => setSearchParams(prev => {
    const next = new URLSearchParams(prev)
    next.set('tab', id)
    return next
  }, { replace: true })

  return (
    <div className="flex flex-col h-full fade-in">
      <div className="mb-4">
        <h1 className="page-title">Prospection</h1>
        <p className="page-subtitle">Listes de prospection, traitement à un clic et suivi des commerciaux</p>
      </div>

      <div className="flex items-center gap-1 border-b border-slate-200 mb-4">
        {TABS.map(t => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              'flex items-center gap-2 px-3.5 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors',
              current === t.id ? 'border-primary-600 text-primary-700' : 'border-transparent text-slate-500 hover:text-slate-800',
            )}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {current === 'myday' && <MyDayTab />}
        {current === 'lists' && <ListsTab />}
        {current === 'stats' && <StatsTab />}
      </div>
    </div>
  )
}
