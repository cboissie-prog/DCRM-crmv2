import { NavLink, useLocation } from 'react-router-dom'
import {
  LayoutDashboard, Users, TrendingUp,
  Wrench, Calendar, Bell, Settings,
  ChevronDown, Monitor, BarChart2, Zap, LogOut, Activity, LayoutGrid,
} from 'lucide-react'
import { cn } from '../../lib/utils'
import { useAuthStore } from '../../store/authStore'
import { Avatar } from '../ui/Avatar'
import { useState } from 'react'

interface NavItem {
  label: string
  icon: React.ReactNode
  to?: string
  children?: { label: string; to: string; roles?: string[] }[]
  roles?: string[]
}

const navItems: NavItem[] = [
  { label: 'Dashboard', icon: <LayoutDashboard className="w-4 h-4" />, children: [
    { label: 'Tableau de bord', to: '/' },
    { label: 'Activités',      to: '/activities' },
    { label: 'Rapports',       to: '/reports' },
  ]},
  { label: 'Commercial', icon: <TrendingUp className="w-4 h-4" />, children: [
    { label: 'Pipeline',            to: '/pipeline' },
    { label: 'Leads',               to: '/leads' },
    { label: 'Objectifs & Prévisions', to: '/targets' },
  ]},
  { label: 'Agenda', icon: <Calendar className="w-4 h-4" />, to: '/appointments' },
  { label: 'Contacts', icon: <Users className="w-4 h-4" />, children: [
    { label: 'Tous les contacts', to: '/contacts' },
    { label: 'Entreprises',       to: '/companies' },
    { label: 'Cartographie',      to: '/companies/map' },
  ]},
  { label: 'Parc informatique', icon: <Monitor className="w-4 h-4" />, children: [
    { label: 'Clients',     to: '/parc' },
    { label: 'Équipements', to: '/equipment' },
    { label: 'Licences',    to: '/licenses' },
    { label: 'Contrats',    to: '/contracts' },
  ]},
  { label: 'Tickets SAV', icon: <Wrench className="w-4 h-4" />, to: '/tickets' },
  { label: 'Outils', icon: <LayoutGrid className="w-4 h-4" />, children: [
    { label: 'Catalogue produits',   to: '/products' },
    { label: 'Base de connaissance', to: '/knowledge' },
    { label: 'Automatisations',      to: '/automations', roles: ['ADMIN'] },
    { label: 'NPS',                  to: '/nps',         roles: ['ADMIN', 'MANAGER'] },
    { label: 'Utilisateurs',         to: '/users',       roles: ['ADMIN', 'MANAGER'] },
  ]},
]

const bottomItems: NavItem[] = [
  { label: 'Notifications', icon: <Bell className="w-4 h-4" />,     to: '/notifications' },
  { label: 'Paramètres',    icon: <Settings className="w-4 h-4" />, to: '/settings' },
]

export function Sidebar() {
  const location = useLocation()
  const { user, logout } = useAuthStore()
  const [expanded, setExpanded] = useState<string[]>(['Dashboard', 'Commercial', 'Contacts', 'Parc informatique'])

  const toggle = (label: string) =>
    setExpanded(prev => prev.includes(label) ? prev.filter(l => l !== label) : [...prev, label])

  const isActive = (to: string | undefined) =>
    !!to && (location.pathname === to || (to !== '/' && location.pathname.startsWith(to)))

  return (
    <aside className="fixed left-0 top-0 h-screen w-60 bg-white border-r border-slate-200 flex flex-col z-40">
      {/* Logo */}
      <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-100">
        <div className="w-8 h-8 bg-primary-600 rounded-lg flex items-center justify-center">
          <span className="text-white font-bold text-sm">C</span>
        </div>
        <div>
          <p className="text-sm font-bold text-slate-900">MonCRM</p>
          <p className="text-xs text-slate-400">Informatique</p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-0.5">
        {navItems.map((item) => {
          if (item.to) {
            if (item.roles && !(user?.role && item.roles.includes(user.role))) return null
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive: active }) =>
                  cn('sidebar-item', active || (item.to !== '/' && isActive(item.to)) ? 'active' : '')
                }
                end={item.to === '/'}
              >
                {item.icon}
                <span>{item.label}</span>
              </NavLink>
            )
          }

          if (item.children) {
            const visibleChildren = item.children.filter(
              c => !c.roles || (user?.role && c.roles.includes(user.role))
            )
            if (visibleChildren.length === 0) return null

            const isOpen = expanded.includes(item.label)
            const hasActiveChild = visibleChildren.some(c =>
              c.to === '/' ? location.pathname === '/' : location.pathname.startsWith(c.to)
            )

            return (
              <div key={item.label}>
                <button
                  onClick={() => toggle(item.label)}
                  className={cn('sidebar-item w-full', hasActiveChild && 'text-primary-700')}
                >
                  {item.icon}
                  <span className="flex-1 text-left">{item.label}</span>
                  <ChevronDown className={cn('w-3.5 h-3.5 transition-transform', isOpen && 'rotate-180')} />
                </button>
                {isOpen && (
                  <div className="ml-4 mt-0.5 space-y-0.5 border-l-2 border-slate-100 pl-3">
                    {visibleChildren.map(child => (
                      <NavLink
                        key={child.to}
                        to={child.to}
                        end={child.to === '/'}
                        className={({ isActive: active }) =>
                          cn('flex items-center py-1.5 px-2 rounded-md text-xs font-medium transition-colors',
                            active ? 'text-primary-700 bg-primary-50' : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50')
                        }
                      >
                        {child.label}
                      </NavLink>
                    ))}
                  </div>
                )}
              </div>
            )
          }

          return null
        })}

        <div className="pt-2 mt-2 border-t border-slate-100 space-y-0.5">
          {bottomItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to!}
              className={({ isActive: active }) => cn('sidebar-item', active ? 'active' : '')}
            >
              {item.icon}
              <span>{item.label}</span>
            </NavLink>
          ))}
        </div>
      </nav>

      {/* User */}
      {user && (
        <div className="border-t border-slate-100 p-3">
          <div className="flex items-center gap-2.5 px-2 py-2 rounded-lg">
            <Avatar firstName={user.firstName} lastName={user.lastName} size="sm" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-slate-800 truncate">{user.firstName} {user.lastName}</p>
              <p className="text-xs text-slate-400 truncate">{user.role}</p>
            </div>
            <button onClick={() => logout()} className="btn-ghost p-1 rounded-lg" title="Déconnexion">
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
    </aside>
  )
}
