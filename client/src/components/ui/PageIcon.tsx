import { moduleTheme, type ModuleKey } from '../../lib/moduleTheme'

interface PageIconProps {
  module: ModuleKey
  icon: React.ReactNode
}

/** Pastille d'en-tête de page : carré arrondi teinté à la couleur du module. */
export function PageIcon({ module, icon }: PageIconProps) {
  const theme = moduleTheme[module]
  return (
    <div className={`w-10 h-10 rounded-xl ${theme.bg} ${theme.icon} flex items-center justify-center flex-shrink-0`}>
      {icon}
    </div>
  )
}
